// IM-06 (#191) composition entry for the Resolution Receipt boundary.
//
// The reading service holds its own current Decision for
// `project.resolution_receipt.read`; this entry proves that Decision through
// the shared composition boundary (registered Envelope, exact operation,
// payload hash, actor, Scope, session and the current covering capability
// grant) and only then calls the owning EnterpriseProject handler. The exact
// Receipt content address, its Project Scope and the session authentication
// context are bound before the owning read runs, so a Decision issued for
// another operation, session, Scope or payload can never be replayed here.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import {
  COMMAND_RECEIPT_OBJECT_TYPE,
  GET_RESOLUTION_RECEIPT_PURPOSE,
  GET_RESOLUTION_RECEIPT_QUERY,
  handleGetResolutionReceipt,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  SCOPE_MISMATCH,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
} from '@zhiju/identity-policy';
import {
  contentHash,
  contractViolation,
  createDecisionBoundary,
  decisionReference,
  digest,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  uuid,
  type DecisionBoundary,
  type RequestScope,
} from './decision-boundary.js';

export interface ResolutionReceiptEntryConfig {
  /** Owning EnterpriseProject database handle over an application-owned pool. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Owning IdentityPolicy dependencies; the Decision ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /** Capability code the transport evaluates for the registered purpose. */
  readonly capabilities: {
    readonly read: string;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface ResolutionReceiptSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
}

export interface ResolutionReceiptEntry {
  /** `project.get_resolution_receipt@1.0` through the trusted boundary. */
  read(
    envelope: unknown,
    session: ResolutionReceiptSession,
  ): Promise<EnterpriseProject.ProjectGetResolutionReceiptResult>;
}

/**
 * The requested exact Receipt content address: the registered CommandReceipt
 * object type, an exact Project scope and a complete content hash. The ref
 * Scope must also be the Envelope Scope, so the Decision is validated for
 * exactly the Project whose receipt is read.
 */
function receiptReference(
  payloadRef: unknown,
  envelopeScope: unknown,
): { readonly ref: Common.ContentAddressedRef; readonly scope: RequestScope } {
  const ref = record(payloadRef);
  const refScope = record(ref.scope);
  const objectId = uuid(ref.objectId);
  const enterpriseId = uuid(refScope.enterpriseId);
  const projectId = uuid(refScope.projectId);
  const hash = digest(ref.contentHash);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== COMMAND_RECEIPT_OBJECT_TYPE ||
    objectId === undefined ||
    enterpriseId === undefined ||
    projectId === undefined ||
    hash === undefined
  ) {
    entryError(API_VALUE_INVALID, 'commandReceiptRef must be an exact Receipt content address');
  }
  const requestScope = record(envelopeScope);
  if (requestScope.enterpriseId !== enterpriseId || requestScope.projectId !== projectId) {
    entryError(SCOPE_MISMATCH, 'scopeRef must carry the requested Receipt Project scope');
  }
  return {
    ref: {
      kind: 'CONTENT_ADDRESSED',
      objectType: COMMAND_RECEIPT_OBJECT_TYPE,
      objectId,
      scope: { enterpriseId, projectId },
      contentHash: contentHash(hash),
    },
    scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
  };
}

export function createResolutionReceiptEntry(
  config: ResolutionReceiptEntryConfig,
): ResolutionReceiptEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);

  return {
    async read(envelope, session) {
      const violation = contractViolation(registry, GET_RESOLUTION_RECEIPT_QUERY, envelope);
      if (violation !== null) {
        entryError(violation, 'the read Envelope does not satisfy its registered contract');
      }
      const query = record(envelope);
      if (query.consistencyRequirement !== 'AUTHORITATIVE') {
        entryError(API_VALUE_INVALID, 'the read Query must be AUTHORITATIVE');
      }
      const payload = record(query.payload);
      const receipt = receiptReference(payload.commandReceiptRef, query.scopeRef);
      const scope = receipt.scope;
      // The trusted session is the only accepted source of the authentication
      // context: the Envelope reference and the Decision must both belong to
      // exactly this session, so a Decision issued for another session can
      // never be replayed through this entry.
      const sessionHash = sessionAuthenticationContextHash(session);
      const authenticationContext = record(query.authenticationContextRef);
      const envelopeAuthenticationContextHash = digest(authenticationContext.contentHash);
      if (envelopeAuthenticationContextHash === undefined) {
        entryError(AUTHORIZATION_DECISION_INVALID, 'the Query must pin an authentication context');
      }
      if (envelopeAuthenticationContextHash !== sessionHash.toString('hex')) {
        entryError(
          AUTHORIZATION_DECISION_INVALID,
          'the Query authentication context is not the trusted session',
        );
      }
      const payloadHash = payloadHashOf(payload);
      const decision = await boundary.validatedDecision({
        decisionRef: decisionReference(query.authorizationDecisionRef),
        commandType: GET_RESOLUTION_RECEIPT_QUERY,
        purpose: GET_RESOLUTION_RECEIPT_PURPOSE,
        capability: config.capabilities.read,
        scope,
        payloadHash,
        authenticationContextHash: sessionHash,
        actorRef: query.requester,
      });
      return handleGetResolutionReceipt(
        config.enterpriseProjectDb,
        boundary.enterpriseProjectContext(decision, scope, query.correlationId as string),
        {
          commandReceiptRef: receipt.ref,
        } as EnterpriseProject.ProjectGetResolutionReceiptPayload,
      );
    },
  };
}
