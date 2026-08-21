import { createHash } from 'node:crypto';

import type { Common, IntegrationGateway } from '@zhiju/contracts';
import {
  apiError,
  parseUuidV7,
  type ApiError,
  type ApiErrorCategory,
  type ObjectRef as KernelObjectRef,
  type RetryDisposition,
  type ScopeRef as KernelScopeRef,
} from '@zhiju/shared-kernel';

export const INTEGRATION_SENSITIVE_DATA_REJECTED = 'INTEGRATION_SENSITIVE_DATA_REJECTED';

const INBOUND_ENVELOPE_OBJECT_TYPE = 'integration.inbound_envelope';
const CHANNEL_BINDING_OBJECT_TYPE = 'integration.channel_binding';
const INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT = 'INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT';

type ObjectRef = Common.ObjectRef;
type ContentAddressedRef = Common.ContentAddressedRef;
type ContentHash = Common.ContentHash;
type IdentityReference = ObjectRef | ContentAddressedRef;

export interface InboundContractDescriptor {
  readonly providerSchemaMajor: number;
  readonly requiredExtensions: readonly string[];
}

export interface InboundEnvelopeAcceptanceRequest {
  readonly inboundEnvelopeRef: ContentAddressedRef;
  readonly submission: IntegrationGateway.InboundEnvelopeSubmission;
  readonly correlationId: string;
  readonly contract?: InboundContractDescriptor;
  /** Normalized source message reference supplied by the recall adapter. */
  readonly recalledMessageRef?: Common.ExternalRef;
  readonly dispatchCommand?: () => ContentAddressedRef | undefined;
}

export interface InboundEnvelopeRecord {
  readonly inboundEnvelopeRef: ContentAddressedRef;
  readonly externalEventRef: Common.ExternalRef;
  readonly payloadHash: ContentHash;
  readonly status: IntegrationGateway.InboundStatus;
  readonly targetCommandRef?: ContentAddressedRef;
}

export interface QuarantineRecord {
  readonly definition: IntegrationGateway.QuarantineDefinition;
}

export type InboundEnvelopeAcceptanceResult =
  | {
      readonly ok: true;
      readonly disposition: 'ACCEPTED' | 'IDEMPOTENT_REPLAY';
      readonly record: InboundEnvelopeRecord;
    }
  | {
      readonly ok: false;
      readonly error: ApiError;
      readonly quarantine: QuarantineRecord;
    };

export type InboundContractValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ApiError; readonly quarantine: QuarantineRecord };

export interface ExternalCallOutcome {
  readonly outcome: IntegrationGateway.ObservedOutcome;
  readonly externalRef?: Common.ExternalRef;
  readonly errorCode?: Common.ReasonCode;
}

export interface ExecuteExternalAttemptRequest {
  readonly attemptRef: ObjectRef;
  readonly adapterKind: IntegrationGateway.AdapterKind;
  readonly stableIdempotencyKey: Common.NonEmptyString;
  readonly requestPayloadHash: ContentHash;
  readonly timeoutMs: number;
  readonly correlationId: string;
  readonly call: (signal: AbortSignal) => Promise<ExternalCallOutcome>;
}

export interface AdapterAttemptRecord {
  readonly attemptRef: ObjectRef;
  readonly adapterKind: IntegrationGateway.AdapterKind;
  readonly status: IntegrationGateway.AttemptStatus;
  readonly stableIdempotencyKeyHash: ContentHash;
  readonly requestPayloadHash: ContentHash;
  readonly externalRef?: Common.ExternalRef;
  readonly errorCode?: Common.ReasonCode;
  readonly updatedAt: Common.UtcInstant;
}

export type ExecuteExternalAttemptResult =
  | {
      readonly ok: true;
      readonly disposition: 'STARTED' | 'IDEMPOTENT_REPLAY';
      readonly attempt: AdapterAttemptRecord;
    }
  | { readonly ok: false; readonly error: ApiError };

export interface ChannelAuthorizationPort {
  authorize(input: {
    readonly bindingRef: ObjectRef;
    readonly principalRef: Common.PrincipalRef;
    readonly targetScope: Common.ScopeRef;
  }): boolean;
}

export interface RegisterChannelBindingRequest {
  readonly bindingRef: ObjectRef;
  readonly scope: Common.ScopeRef;
}

export interface AuthorizeChannelActionRequest {
  readonly bindingRef: ObjectRef;
  readonly principalRef: Common.PrincipalRef;
  readonly targetScope: Common.ScopeRef;
  readonly correlationId: string;
}

export type AuthorizeChannelActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: ApiError };

export interface MessageOriginIdentity {
  readonly adapterCode: Common.NamespaceCode;
  readonly accountExternalRef: Common.ExternalRef;
  readonly messageRef: Common.ExternalRef;
}

export interface RecordMessageRecallRequest extends MessageOriginIdentity {
  readonly recallEnvelopeRef: ContentAddressedRef;
  readonly recalledAt: Common.UtcInstant;
}

export interface MessageOriginRecord {
  readonly messageRef: Common.ExternalRef;
  readonly sourceEnvelopeRefs: readonly ContentAddressedRef[];
  readonly status: 'ACTIVE' | 'WITHDRAWN';
  readonly recalledAt?: Common.UtcInstant;
}

export interface RenderResultObservation {
  readonly revisionRef: ContentAddressedRef;
  readonly inputHash: ContentHash;
  readonly rendererId: Common.NamespaceCode;
  readonly rendererVersion: Common.NonEmptyString;
}

export interface ValidateRenderResultRequest {
  readonly request: IntegrationGateway.RenderRequest;
  readonly result: RenderResultObservation;
  readonly correlationId: string;
}

export type ValidateRenderResultResult =
  { readonly ok: true } | { readonly ok: false; readonly error: ApiError };

export interface SafeAuditInput {
  readonly correlationId: string;
  readonly eventCode: Common.ReasonCode;
  readonly diagnosticHash: ContentHash;
  readonly attemptRef?: ObjectRef;
  readonly runRef?: ObjectRef;
  readonly metadata?: unknown;
}

export interface SafeAuditRecord {
  readonly correlationId: string;
  readonly eventCode: Common.ReasonCode;
  readonly diagnosticHash: ContentHash;
  readonly attemptRef?: ObjectRef;
  readonly runRef?: ObjectRef;
  readonly recordedAt: Common.UtcInstant;
}

export type RecordAuditResult =
  | { readonly ok: true; readonly record: SafeAuditRecord }
  | { readonly ok: false; readonly error: ApiError };

export interface IntegrationGatewayRuntimeOptions {
  readonly authorizationPort?: ChannelAuthorizationPort;
  readonly supportedProviderSchemaMajor?: number;
  readonly supportedRequiredExtensions?: readonly string[];
  readonly now?: () => Common.UtcInstant;
}

/** Process-local stand-in for IntegrationGateway runtime facts; not durable persistence. */
export class IntegrationGatewayRuntime {
  private readonly inboundByIdentity = new Map<string, InboundEnvelopeRecord>();

  private readonly quarantines: QuarantineRecord[] = [];

  private readonly attemptsByStableKeyHash = new Map<string, AdapterAttemptRecord>();

  private readonly attemptsByRef = new Map<string, AdapterAttemptRecord>();

  private readonly bindings = new Map<string, Common.ScopeRef>();

  private readonly originsByMessage = new Map<string, MessageOriginRecord>();

  private readonly auditRecords: SafeAuditRecord[] = [];

  private readonly authorizationPort: ChannelAuthorizationPort;

  private readonly supportedProviderSchemaMajor: number;

  private readonly supportedRequiredExtensions: ReadonlySet<string>;

  private readonly now: () => Common.UtcInstant;

  constructor(options: IntegrationGatewayRuntimeOptions = {}) {
    this.authorizationPort = options.authorizationPort ?? { authorize: () => false };
    this.supportedProviderSchemaMajor = options.supportedProviderSchemaMajor ?? 2;
    this.supportedRequiredExtensions = new Set(options.supportedRequiredExtensions ?? []);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  acceptInboundEnvelope(
    request: InboundEnvelopeAcceptanceRequest,
  ): InboundEnvelopeAcceptanceResult {
    if (request.inboundEnvelopeRef.objectType !== INBOUND_ENVELOPE_OBJECT_TYPE) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'inbound envelope reference has an unsupported object type',
          fieldPath: '/inboundEnvelopeRef/objectType',
          violatedRule: 'inbound facts require the registered inbound envelope object type',
          correlationId: request.correlationId,
          targetRef: request.inboundEnvelopeRef,
        }),
        quarantine: this.quarantine({
          inboundEnvelopeRef: request.inboundEnvelopeRef,
          conflictRefs: [request.inboundEnvelopeRef],
          observedHashes: [request.submission.payloadHash],
          reasonCode: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
          safeDiagnostic: 'Inbound envelope object type was rejected before command mapping.',
          quarantinedAt: this.now(),
        }),
      };
    }

    if (request.contract !== undefined) {
      const contract = this.validateInboundContract({
        ...request.contract,
        payloadHash: request.submission.payloadHash,
        inboundEnvelopeRef: request.inboundEnvelopeRef,
        correlationId: request.correlationId,
      });
      if (!contract.ok) {
        return contract;
      }
    }

    if (
      request.submission.externalEventType === 'im.message.recalled_v1' &&
      request.recalledMessageRef === undefined
    ) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'recall events require the recalled message reference',
          fieldPath: '/recalledMessageRef',
          violatedRule: 'im.message.recalled_v1 must name the withdrawn origin message',
          correlationId: request.correlationId,
          targetRef: request.inboundEnvelopeRef,
        }),
        quarantine: this.quarantine({
          inboundEnvelopeRef: request.inboundEnvelopeRef,
          conflictRefs: [request.inboundEnvelopeRef],
          observedHashes: [request.submission.payloadHash],
          reasonCode: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
          safeDiagnostic: 'Recall event omitted the recalled message reference.',
          quarantinedAt: this.now(),
        }),
      };
    }

    const identity = inboundIdentityKey(request.submission);
    const existing = this.inboundByIdentity.get(identity);
    if (existing !== undefined) {
      if (sameHash(existing.payloadHash, request.submission.payloadHash)) {
        return { ok: true, disposition: 'IDEMPOTENT_REPLAY', record: existing };
      }

      const quarantine = this.quarantine({
        inboundEnvelopeRef: request.inboundEnvelopeRef,
        conflictRefs: [existing.inboundEnvelopeRef, request.inboundEnvelopeRef],
        observedHashes: [existing.payloadHash, request.submission.payloadHash],
        reasonCode: 'INTEGRATION_INBOUND_PAYLOAD_HASH_MISMATCH',
        safeDiagnostic: 'Inbound event identity was reused with a different payload hash.',
        quarantinedAt: this.now(),
      });
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_INBOUND_EVENT_REPLAY_CONFLICT',
          category: 'CONFLICT',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: 'inbound event identity is already bound to a different payload hash',
          fieldPath: '/submission/payloadHash',
          violatedRule: 'one external event identity must retain one canonical payload hash',
          correlationId: request.correlationId,
          targetRef: request.inboundEnvelopeRef,
        }),
        quarantine,
      };
    }

    const claimed: InboundEnvelopeRecord = Object.freeze({
      inboundEnvelopeRef: request.inboundEnvelopeRef,
      externalEventRef: request.submission.externalEventRef,
      payloadHash: request.submission.payloadHash,
      status: 'ACCEPTED',
    });
    this.inboundByIdentity.set(identity, claimed);

    if (request.submission.externalEventType === 'im.message.receive_v1') {
      this.recordMessageReceived(
        {
          adapterCode: request.submission.adapterCode,
          accountExternalRef: request.submission.accountExternalRef,
          messageRef: request.submission.externalEventRef,
        },
        request.inboundEnvelopeRef,
      );
    }
    if (
      request.submission.externalEventType === 'im.message.recalled_v1' &&
      request.recalledMessageRef !== undefined
    ) {
      this.recordMessageRecall({
        adapterCode: request.submission.adapterCode,
        accountExternalRef: request.submission.accountExternalRef,
        messageRef: request.recalledMessageRef,
        recallEnvelopeRef: request.inboundEnvelopeRef,
        recalledAt: request.submission.occurredAt ?? request.submission.receivedAt,
      });
    }

    const targetCommandRef = request.dispatchCommand?.();
    const record: InboundEnvelopeRecord =
      targetCommandRef === undefined ? claimed : Object.freeze({ ...claimed, targetCommandRef });
    if (targetCommandRef !== undefined) {
      this.inboundByIdentity.set(identity, record);
    }

    return { ok: true, disposition: 'ACCEPTED', record };
  }

  validateInboundContract(input: {
    readonly providerSchemaMajor: number;
    readonly requiredExtensions: readonly string[];
    readonly payloadHash: ContentHash;
    readonly inboundEnvelopeRef: ContentAddressedRef;
    readonly correlationId: string;
  }): InboundContractValidationResult {
    const unsupportedExtension = input.requiredExtensions.find(
      (extension) => !this.supportedRequiredExtensions.has(extension),
    );
    if (
      input.providerSchemaMajor !== this.supportedProviderSchemaMajor ||
      unsupportedExtension !== undefined
    ) {
      const quarantine = this.quarantine({
        inboundEnvelopeRef: input.inboundEnvelopeRef,
        conflictRefs: [input.inboundEnvelopeRef],
        observedHashes: [input.payloadHash],
        reasonCode: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
        safeDiagnostic: 'Provider contract version or required extension is unsupported.',
        quarantinedAt: this.now(),
      });
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED',
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'provider contract cannot be mapped by this adapter version',
          fieldPath: '/submission/externalEventType',
          violatedRule: 'unknown Provider Major and required extensions must be rejected',
          correlationId: input.correlationId,
          targetRef: input.inboundEnvelopeRef,
        }),
        quarantine,
      };
    }
    return { ok: true };
  }

  async executeExternalAttempt(
    request: ExecuteExternalAttemptRequest,
  ): Promise<ExecuteExternalAttemptResult> {
    if (request.stableIdempotencyKey.length === 0 || request.timeoutMs <= 0) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT',
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'attempt requires a non-empty stable key and positive timeout',
          fieldPath: '/request/stableIdempotencyKey',
          violatedRule: 'external attempts require a stable key and positive timeout window',
          correlationId: request.correlationId,
          targetRef: request.attemptRef,
        }),
      };
    }

    const stableIdempotencyKeyHash = sha256(request.stableIdempotencyKey);
    const stableKeyHash = stableIdempotencyKeyHash.digest;
    const existing = this.attemptsByStableKeyHash.get(stableKeyHash);
    if (existing !== undefined) {
      if (
        !sameHash(existing.requestPayloadHash, request.requestPayloadHash) ||
        !sameObjectRef(existing.attemptRef, request.attemptRef)
      ) {
        return {
          ok: false,
          error: rejection({
            code: INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT,
            category: 'CONFLICT',
            retryDisposition: 'RELOAD_AND_REEVALUATE',
            safeMessage: 'stable idempotency key is already bound to a different attempt',
            fieldPath: '/request/requestPayloadHash',
            violatedRule: 'one stable key must retain one attempt identity and request hash',
            correlationId: request.correlationId,
            targetRef: request.attemptRef,
          }),
        };
      }
      return { ok: true, disposition: 'IDEMPOTENT_REPLAY', attempt: existing };
    }

    const initial: AdapterAttemptRecord = Object.freeze({
      attemptRef: request.attemptRef,
      adapterKind: request.adapterKind,
      status: 'IN_FLIGHT',
      stableIdempotencyKeyHash,
      requestPayloadHash: request.requestPayloadHash,
      updatedAt: this.now(),
    });
    this.attemptsByStableKeyHash.set(stableKeyHash, initial);
    this.attemptsByRef.set(objectRefKey(request.attemptRef), initial);

    const abort = new AbortController();
    const timeoutMarker = Symbol('external-call-timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof timeoutMarker>((resolve) => {
      timer = setTimeout(() => {
        resolve(timeoutMarker);
      }, request.timeoutMs);
    });
    const call = Promise.resolve().then(() => request.call(abort.signal));

    let outcome: ExternalCallOutcome | typeof timeoutMarker;
    try {
      outcome = await Promise.race([call, timeout]);
    } catch {
      outcome = { outcome: 'FAILED', errorCode: 'INTEGRATION_ADAPTER_UNKNOWN' };
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (outcome === timeoutMarker) {
      abort.abort();
      void call.then(
        () => undefined,
        () => undefined,
      );
    }

    const finalStatus: IntegrationGateway.AttemptStatus =
      outcome === timeoutMarker
        ? 'UNKNOWN'
        : outcome.outcome === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : outcome.outcome === 'FAILED'
            ? 'FAILED'
            : 'UNKNOWN';
    const errorCode =
      outcome === timeoutMarker
        ? 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN'
        : (outcome.errorCode ??
          (outcome.outcome === 'UNKNOWN' ? 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN' : undefined));
    const finalAttempt: AdapterAttemptRecord = Object.freeze({
      ...initial,
      status: finalStatus,
      updatedAt: this.now(),
      ...(outcome === timeoutMarker || outcome.externalRef === undefined
        ? {}
        : { externalRef: outcome.externalRef }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    this.attemptsByStableKeyHash.set(stableKeyHash, finalAttempt);
    this.attemptsByRef.set(objectRefKey(request.attemptRef), finalAttempt);
    return { ok: true, disposition: 'STARTED', attempt: finalAttempt };
  }

  getAttempt(attemptRef: ObjectRef): AdapterAttemptRecord | undefined {
    return this.attemptsByRef.get(objectRefKey(attemptRef));
  }

  registerChannelBinding(request: RegisterChannelBindingRequest): void {
    if (request.bindingRef.objectType !== CHANNEL_BINDING_OBJECT_TYPE) {
      throw new TypeError('bindingRef must address an integration.channel_binding object');
    }
    this.bindings.set(objectRefKey(request.bindingRef), request.scope);
  }

  authorizeChannelAction(request: AuthorizeChannelActionRequest): AuthorizeChannelActionResult {
    const bindingScope = this.bindings.get(objectRefKey(request.bindingRef));
    if (bindingScope === undefined) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_CHANNEL_BINDING_NOT_FOUND',
          category: 'NOT_FOUND',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'channel binding is not available for this action',
          fieldPath: '/bindingRef',
          violatedRule: 'channel actions require an active registered binding',
          correlationId: request.correlationId,
          targetRef: request.bindingRef,
        }),
      };
    }
    if (!sameScopeRef(bindingScope, request.targetScope)) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_CHANNEL_BINDING_SCOPE_MISMATCH',
          category: 'AUTHORIZATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'channel binding does not authorize the requested scope',
          fieldPath: '/targetScope',
          violatedRule: 'binding scope must equal the target scope before authorization',
          correlationId: request.correlationId,
          targetRef: request.bindingRef,
        }),
      };
    }
    if (
      !this.authorizationPort.authorize({
        bindingRef: request.bindingRef,
        principalRef: request.principalRef,
        targetScope: request.targetScope,
      })
    ) {
      return {
        ok: false,
        error: rejection({
          code: 'INTEGRATION_CHANNEL_MEMBER_NOT_AUTHORIZED',
          category: 'AUTHORIZATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'channel action is not authorized for this principal',
          fieldPath: '/principalRef',
          violatedRule: 'binding membership cannot substitute for explicit authorization',
          correlationId: request.correlationId,
          targetRef: request.bindingRef,
        }),
      };
    }
    return { ok: true };
  }

  recordMessageReceived(
    identity: MessageOriginIdentity,
    envelopeRef: ContentAddressedRef,
  ): MessageOriginRecord {
    const key = messageOriginKey(identity);
    const existing = this.originsByMessage.get(key);
    const sourceEnvelopeRefs = appendUniqueRef(existing?.sourceEnvelopeRefs ?? [], envelopeRef);
    const record: MessageOriginRecord = Object.freeze({
      messageRef: identity.messageRef,
      sourceEnvelopeRefs,
      status: existing?.status ?? 'ACTIVE',
      ...(existing?.recalledAt === undefined ? {} : { recalledAt: existing.recalledAt }),
    });
    this.originsByMessage.set(key, record);
    return record;
  }

  recordMessageRecall(request: RecordMessageRecallRequest): MessageOriginRecord {
    const key = messageOriginKey(request);
    const existing = this.originsByMessage.get(key);
    const sourceEnvelopeRefs = appendUniqueRef(
      existing?.sourceEnvelopeRefs ?? [],
      request.recallEnvelopeRef,
    );
    const record: MessageOriginRecord = Object.freeze({
      messageRef: request.messageRef,
      sourceEnvelopeRefs,
      status: 'WITHDRAWN',
      recalledAt: request.recalledAt,
    });
    this.originsByMessage.set(key, record);
    return record;
  }

  getMessageOrigin(identity: MessageOriginIdentity): MessageOriginRecord | undefined {
    return this.originsByMessage.get(messageOriginKey(identity));
  }

  validateRenderResult(request: ValidateRenderResultRequest): ValidateRenderResultResult {
    if (!sameObjectRef(request.request.revisionRef, request.result.revisionRef)) {
      return {
        ok: false,
        error: renderMismatchError(
          request.correlationId,
          request.result.revisionRef,
          '/result/revisionRef',
          'RenderSucceeded revision must equal the requested revision',
        ),
      };
    }
    if (!sameHash(request.request.inputHash, request.result.inputHash)) {
      return {
        ok: false,
        error: renderMismatchError(
          request.correlationId,
          request.result.revisionRef,
          '/result/inputHash',
          'RenderSucceeded inputHash must equal the requested inputHash',
        ),
      };
    }
    if (
      request.request.rendererId !== request.result.rendererId ||
      request.request.rendererVersion !== request.result.rendererVersion
    ) {
      return {
        ok: false,
        error: renderMismatchError(
          request.correlationId,
          request.result.revisionRef,
          '/result/renderer',
          'RenderSucceeded renderer identity must equal the requested renderer',
        ),
      };
    }
    return { ok: true };
  }

  recordAudit(input: SafeAuditInput): RecordAuditResult {
    const sensitiveKind = findSensitiveDataKind(input.metadata);
    if (sensitiveKind !== undefined) {
      return {
        ok: false,
        error: rejection({
          code: INTEGRATION_SENSITIVE_DATA_REJECTED,
          category: 'POLICY',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'sensitive provider data cannot enter IntegrationGateway audit records',
          fieldPath: '/metadata',
          violatedRule: `${sensitiveKind} must be rejected before audit persistence`,
          correlationId: input.correlationId,
          ...(input.attemptRef === undefined && input.runRef === undefined
            ? {}
            : { targetRef: input.attemptRef ?? input.runRef }),
        }),
      };
    }

    const record: SafeAuditRecord = Object.freeze({
      correlationId: input.correlationId,
      eventCode: input.eventCode,
      diagnosticHash: input.diagnosticHash,
      recordedAt: this.now(),
      ...(input.attemptRef === undefined ? {} : { attemptRef: input.attemptRef }),
      ...(input.runRef === undefined ? {} : { runRef: input.runRef }),
    });
    this.auditRecords.push(record);
    return { ok: true, record };
  }

  getQuarantines(): readonly QuarantineRecord[] {
    return [...this.quarantines];
  }

  getAuditRecords(): readonly SafeAuditRecord[] {
    return [...this.auditRecords];
  }

  private quarantine(definition: IntegrationGateway.QuarantineDefinition): QuarantineRecord {
    const record: QuarantineRecord = Object.freeze({ definition: Object.freeze(definition) });
    this.quarantines.push(record);
    return record;
  }
}

function rejection(input: {
  readonly code: string;
  readonly category: ApiErrorCategory;
  readonly retryDisposition: RetryDisposition;
  readonly safeMessage: string;
  readonly violatedRule: string;
  readonly correlationId: string;
  readonly fieldPath?: string;
  readonly targetRef?: IdentityReference;
}): ApiError {
  const kernelTargetRef =
    input.targetRef === undefined ? undefined : toKernelObjectRef(input.targetRef);
  const fieldViolations =
    input.fieldPath === undefined
      ? []
      : [
          {
            code: input.code,
            fieldPath: input.fieldPath,
            violatedRule: input.violatedRule,
            ...(kernelTargetRef === undefined ? {} : { targetRef: kernelTargetRef }),
          },
        ];
  return apiError({
    code: input.code,
    category: input.category,
    safeMessage: input.safeMessage,
    fieldViolations,
    retryDisposition: input.retryDisposition,
    correlationId: input.correlationId,
    ...(kernelTargetRef === undefined ? {} : { targetRef: kernelTargetRef }),
  });
}

function renderMismatchError(
  correlationId: string,
  targetRef: IdentityReference,
  fieldPath: string,
  violatedRule: string,
): ApiError {
  return rejection({
    code: 'INTEGRATION_RENDER_INPUT_MISMATCH',
    category: 'INTEGRITY',
    retryDisposition: 'DO_NOT_RETRY',
    safeMessage: 'render result does not match the requested render input',
    fieldPath,
    violatedRule,
    correlationId,
    targetRef,
  });
}

function sha256(value: string): ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(value, 'utf8').digest('hex'),
    canonicalizationVersion: '1',
  };
}

function sameHash(left: ContentHash, right: ContentHash): boolean {
  return left.digest === right.digest;
}

function sameObjectRef(left: IdentityReference, right: IdentityReference): boolean {
  if (
    left.kind !== right.kind ||
    left.objectType !== right.objectType ||
    left.objectId !== right.objectId ||
    !sameScopeRef(left.scope, right.scope)
  ) {
    return false;
  }
  if (left.kind === 'CONTENT_ADDRESSED' && right.kind === 'CONTENT_ADDRESSED') {
    return (
      left.immutableVersionId === right.immutableVersionId &&
      sameHash(left.contentHash, right.contentHash)
    );
  }
  return true;
}

function sameScopeRef(left: Common.ScopeRef, right: Common.ScopeRef): boolean {
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

function toKernelObjectRef(ref: IdentityReference): KernelObjectRef {
  const scope: KernelScopeRef = {
    ...(ref.scope.enterpriseId === undefined
      ? {}
      : { enterpriseId: parseUuidV7(ref.scope.enterpriseId) }),
    ...(ref.scope.projectId === undefined ? {} : { projectId: parseUuidV7(ref.scope.projectId) }),
  };
  return {
    kind: 'OBJECT',
    objectType: ref.objectType,
    objectId: parseUuidV7(ref.objectId),
    scope,
  };
}

function objectRefKey(ref: ObjectRef): string {
  return [
    ref.kind,
    ref.objectType,
    ref.objectId,
    ref.scope.enterpriseId ?? '',
    ref.scope.projectId ?? '',
  ].join('\u0000');
}

function externalRefKey(ref: Common.ExternalRef): string {
  const tenant = ref.tenantOrAccountRef === undefined ? '' : objectRefKey(ref.tenantOrAccountRef);
  return [ref.system, tenant, ref.resourceType, ref.externalId].join('\u0000');
}

function inboundIdentityKey(submission: IntegrationGateway.InboundEnvelopeSubmission): string {
  return [
    submission.adapterCode,
    externalRefKey(submission.accountExternalRef),
    externalRefKey(submission.externalEventRef),
  ].join('\u0000');
}

function messageOriginKey(identity: MessageOriginIdentity): string {
  return [
    identity.adapterCode,
    externalRefKey(identity.accountExternalRef),
    externalRefKey(identity.messageRef),
  ].join('\u0000');
}

function appendUniqueRef(
  refs: readonly ContentAddressedRef[],
  candidate: ContentAddressedRef,
): readonly ContentAddressedRef[] {
  if (
    refs.some(
      (ref) => sameObjectRef(ref, candidate) && sameHash(ref.contentHash, candidate.contentHash),
    )
  ) {
    return refs;
  }
  return [...refs, candidate];
}

function findSensitiveDataKind(
  value: unknown,
): 'ACCESS_TOKEN' | 'APP_SECRET' | 'WEBHOOK_BODY' | undefined {
  return findSensitiveDataKindAtPath(value, [], new WeakSet<object>());
}

function findSensitiveDataKindAtPath(
  value: unknown,
  ancestors: readonly string[],
  seen: WeakSet<object>,
): 'ACCESS_TOKEN' | 'APP_SECRET' | 'WEBHOOK_BODY' | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeKey(key);
    const directKind = sensitiveKeyKind(normalizedKey, ancestors);
    if (directKind !== undefined) {
      return directKind;
    }
    const nestedKind = findSensitiveDataKindAtPath(child, [...ancestors, normalizedKey], seen);
    if (nestedKind !== undefined) {
      return nestedKind;
    }
  }
  return undefined;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function sensitiveKeyKind(
  normalizedKey: string,
  ancestors: readonly string[],
): 'ACCESS_TOKEN' | 'APP_SECRET' | 'WEBHOOK_BODY' | undefined {
  if (
    normalizedKey === 'accesstoken' ||
    normalizedKey === 'authorization' ||
    normalizedKey === 'bearertoken' ||
    normalizedKey === 'token'
  ) {
    return 'ACCESS_TOKEN';
  }
  if (
    normalizedKey === 'appsecret' ||
    normalizedKey === 'secret' ||
    normalizedKey === 'encryptkey' ||
    normalizedKey === 'verificationtoken'
  ) {
    return 'APP_SECRET';
  }
  if (
    normalizedKey === 'webhookbody' ||
    normalizedKey === 'rawwebhookbody' ||
    (normalizedKey === 'body' && ancestors.includes('webhook'))
  ) {
    return 'WEBHOOK_BODY';
  }
  return undefined;
}
