import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { InitialContextSuite } from './initial-context-suite.js';
import type {
  createFormalCompletionEntry,
  InitialContextCapabilityCodes,
} from '@zhiju/api/composition';
import {
  type Common,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
} from '@zhiju/contracts';
import type {
  ActorSnapshotRef,
  IdentityCryptoPorts,
  TaskExecutionCreationCapabilityCodes,
  WorkOrderDraftReadCapabilityCodes,
} from '@zhiju/identity-policy';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import type {
  assembleInitialContext,
  CommandResult,
  recoverControlledFinalRuns,
  TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import type { KyselyPlugin } from 'kysely';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { createDeliveryCompletionPlanFixture } from './delivery-completion-plan-fixture.js';
export const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;

export const gateEnabled = Boolean(databaseUrl);

export const PROBE_ROLE = 'im06_wi216_probe';

export const PROBE_PASSWORD = 'im06-wi216-probe';

export const OPERATOR = 'cc01cc01-cc01-7c01-8c01-cc01cc01cc01';

export const OPERATOR_ACTOR = 'cc02cc02-cc02-7c02-8c02-cc02cc02cc02';

export const OTHER_PRINCIPAL = 'cc03cc03-cc03-7c03-8c03-cc03cc03cc03';

export const OTHER_ACTOR = 'cc04cc04-cc04-7c04-8c04-cc04cc04cc04';

export const REQUEST_DECISION = 'cc05cc05-cc05-7c05-8c05-cc05cc05cc05';

export const CORRELATION = 'cc06cc06-cc06-7c06-8c06-cc06cc06cc06';

export const AUTH_CONTEXT_ID = 'cc07cc07-cc07-7c07-8c07-cc07cc07cc07';

export const AUTH_HASH = Buffer.alloc(32, 0x75);

export const OTHER_AUTH_HASH = Buffer.alloc(32, 0x76);

export const DECISION_HASH = Buffer.alloc(32, 0x77);

export const contextSnapshotCapabilityCodes: InitialContextCapabilityCodes = {
  contextSnapshotBuildV11: 'wi216.cap.ctxbuild.v1_1',
  contextSnapshotRead: 'wi216.cap.ctxread',
  contextSnapshotDraftReadV11: 'wi216.cap.ctxdraftread',
};

export const dependencyCapabilities = {
  resolvePolicy: 'wi216.cap.resolve',
  readContextSourceSlice: 'wi216.cap.sliceread',
} as const;

export const CAPTURE_CAPABILITY = 'wi216.cap.capture';

export const RECORD_CAPABILITY = 'wi216.cap.record';

export const creationCapabilityCodes: TaskExecutionCreationCapabilityCodes = {
  taskV1: 'wi216.cap.task.v1',
  taskV2: 'wi216.cap.task.v2',
  workOrderV1: 'wi216.cap.workorder.v1',
  workOrderV11: 'wi216.cap.workorder.v1_1',
};

export const draftReadCapabilityCodes: WorkOrderDraftReadCapabilityCodes = {
  workOrderDraftReadV11: 'wi216.cap.draftread.v1_1',
  workOrderDraftReadV2: 'wi216.cap.draftread.v2',
};

export const ACTIONS = {
  taskV1: 'execution.task.create.v1',
  taskV2: 'execution.task.create.v2',
  workOrderV1: 'execution.work_order.create.v1',
  workOrderV11: 'execution.work_order.create.v1_1',
  ctxBuild: 'execution.context.build.initial.v1_1',
  ctxRead: 'execution.context.snapshot.read',
  ctxDraftRead: 'execution.work_order.draft_snapshot.read.for_context_build.v1_1',
} as const;

export const TASK_V1 = 'execution.task';

export const TASK_V2 = 'zhiju.execution.task';

export const WORK_ORDER_V1 = 'execution.work_order';

export const WORK_ORDER_V11 = 'zhiju.execution.work_order';

export const CONTEXT_SNAPSHOT_OBJECT = 'zhiju.execution.context_snapshot';

export const CONTEXT_SNAPSHOT_LEGACY_OBJECT = 'zhiju.project.context_snapshot';

export const DRAFT_SNAPSHOT_OBJECT = 'zhiju.execution.work_order_draft_snapshot';

export const SLICE_OBJECT = 'zhiju.project.context_source_slice';

export const POLICY_OBJECT = 'zhiju.identity.policy';

export const ACTOR_SNAPSHOT_OBJECT = 'identity.actor_snapshot';

export const PRINCIPAL_OBJECT = 'zhiju.identity.principal';

export const AUTH_CONTEXT_OBJECT = 'zhiju.identity.authentication_context';

export const BUILD_COMMAND = 'execution.build_initial_context_snapshot';

export const BUILD_VERSION = '1.1';

export const READ_QUERY = 'execution.get_context_snapshot';

export const READ_VERSION = '1.0';

export const BUILDER_PROFILE = 'execution.context_builder.policy@1.0';

export const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';

export const PAST = new Date('2026-01-01T00:00:00.000Z');

export const PURPOSE_DOCUMENT = 'document.write';

export const PURPOSE_FORM = 'record.form.read';

export const PURPOSE_REVIEW = 'review.read';

export const SLICE_KINDS = [
  'project',
  'enterprise_profile',
  'qms_configuration',
  'product_scope',
  'enterprise_facts',
];

export const BUILDER_POLICY = {
  main: ['cc10cc10-cc10-7c10-8c10-cc10cc10cc10', 'cc20cc20-cc20-7c20-8c20-cc20cc20cc20'],
  noProjection: ['cc11cc11-cc11-7c11-8c11-cc11cc11cc11', 'cc21cc21-cc21-7c21-8c21-cc21cc21cc21'],
  wrongProfile: ['cc12cc12-cc12-7c12-8c12-cc12cc12cc12', 'cc22cc22-cc22-7c22-8c22-cc22cc22cc22'],
  future: ['cc13cc13-cc13-7c13-8c13-cc13cc13cc13', 'cc23cc23-cc23-7c23-8c23-cc23cc23cc23'],
  supersededFirst: ['cc14cc14-cc14-7c14-8c14-cc14cc14cc14', 'cc24cc24-cc24-7c24-8c24-cc24cc24cc24'],
  successor: ['cc14cc14-cc14-7c14-8c14-cc14cc14cc14', 'cc25cc25-cc25-7c25-8c25-cc25cc25cc25'],
  alt: ['cc16cc16-cc16-7c16-8c16-cc16cc16cc16', 'cc26cc26-cc26-7c26-8c26-cc26cc26cc26'],
} as const;

export const CAPTURE_POLICY = {
  main: ['cc30cc30-cc30-7c30-8c30-cc30cc30cc30', 'cc40cc40-cc40-7c40-8c40-cc40cc40cc40'],
  ttl: ['cc31cc31-cc31-7c31-8c31-cc31cc31cc31', 'cc41cc41-cc41-7c41-8c41-cc41cc41cc41'],
  revokedFirst: ['cc32cc32-cc32-7c32-8c32-cc32cc32cc32', 'cc42cc42-cc42-7c42-8c42-cc42cc42cc42'],
  successor: ['cc32cc32-cc32-7c32-8c32-cc32cc32cc32', 'cc43cc43-cc43-7c43-8c43-cc43cc43cc43'],
} as const;

export const POLICY_SNAPSHOT_ID = 'cc50cc50-cc50-7c50-8c50-cc50cc50cc50';

export const V1_TASK_FIXTURE = new URL(
  '../fixtures/contracts/execution-create-task-command-valid.json',
  import.meta.url,
);

export const V2_TASK_FIXTURE = new URL(
  '../fixtures/contracts/task-v2/create-task-v2-command-valid.json',
  import.meta.url,
);

export const WORK_ORDER_CONTRACT_FIXTURE = new URL(
  '../fixtures/contracts/core/work-order-valid.json',
  import.meta.url,
);

export const PUBLIC_API_CATALOG = new URL(
  '../../contracts/registry/public-api.v1.json',
  import.meta.url,
);

export const COMPATIBILITY_BASELINE = new URL(
  '../../contracts/baselines/v1.0/operations.index.json',
  import.meta.url,
);

export interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
}

export function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7c)).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed');
      },
      decryptField() {
        throw new Error('not needed');
      },
    },
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function objectRef(objectType: string, objectId: string, scope: Record<string, string>) {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

export function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

export function payloadOf(url: URL): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { payload: Record<string, unknown> };
  return structuredClone(fixture.payload);
}

export function rewriteFixtureScopes(value: unknown, fixture: Fixture): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteFixtureScopes(item, fixture);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'scope' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      node[key] =
        'projectId' in (child as Record<string, unknown>)
          ? { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId }
          : { enterpriseId: fixture.enterpriseId };
      continue;
    }
    rewriteFixtureScopes(child, fixture);
  }
}

export function failureOf(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : String(error),
  };
}

export const INFRASTRUCTURE_ERRNO = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

export const INFRASTRUCTURE_SQLSTATE = /^(?:08[0-9A-Z]{3}|57P0[1-3]|53300|53400)$/u;

export const INFRASTRUCTURE_DRIVER_MESSAGE =
  /^(?:Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error)/u;

export function isInfrastructureFailure(error: unknown): boolean {
  const { code, message } = failureOf(error);
  if (INFRASTRUCTURE_ERRNO.has(code) || INFRASTRUCTURE_SQLSTATE.test(code)) return true;
  return code === '' && INFRASTRUCTURE_DRIVER_MESSAGE.test(message);
}

export function resultCode(result: CommandResult): string {
  if (result.status === 'REJECTED') return result.errorCode;
  if (result.status === 'DUPLICATE') return result.errorCode ?? 'DUPLICATE';
  return 'COMMITTED';
}

export function profileReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

export function policyKey(pair: readonly [string, string], fixture: Fixture): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: POLICY_OBJECT,
    objectId: pair[0],
    versionId: pair[1],
    scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
  } as unknown as Common.VersionedRef;
}

export function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}

export interface Principal {
  readonly principalId: string;
  readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE';
  readonly actorSnapshotId: string;
  readonly actorRef: ActorSnapshotRef;
  readonly authHash: Buffer;
}

export interface BuildInput {
  readonly idempotencyKey: string;
  readonly workOrderId?: string;
  readonly draftRef?: unknown;
  readonly targetId?: string;
  readonly sourceSlices?: unknown[];
  readonly purpose?: string;
  readonly projectionType?: string;
  readonly audience?: { principalId: string; principalKind: string };
  readonly builderPolicyRef?: unknown;
  /** `present: false` omits the member; `present: true` carries `value` verbatim. */
  readonly expiry?: { readonly present: boolean; readonly value?: unknown };
  readonly principal?: Principal;
  readonly decisionNow?: Date;
  readonly commandVersion?: string;
  readonly commandId?: string;
  readonly requestMutate?: (request: Record<string, unknown>) => void;
}

export interface AppRoleContext {
  readonly principalId?: string;
  readonly principalKind?: string;
  readonly actorSnapshotId?: string;
  readonly allowedProjectIds: readonly string[];
  readonly enterpriseId?: string;
}

export interface LegacyImportRow {
  readonly snapshotId: string;
  readonly objectId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly payloadHash: Buffer;
  readonly canonicalPayload: Record<string, unknown>;
  readonly projectContextContract: Record<string, unknown>;
  readonly contractRef: Record<string, unknown>;
  readonly objectType?: string;
  readonly provenance?: {
    readonly manifestId?: string;
    readonly batchId?: string;
    readonly sourceSystem?: string;
    readonly toolVersion?: string;
  };
}

export type AssemblyInput = Parameters<typeof assembleInitialContext>[0];

export interface PreparedDeliverySource {
  plan: Awaited<ReturnType<typeof createDeliveryCompletionPlanFixture>>;
  taskId: string;
  complete: () => ReturnType<ReturnType<typeof createFormalCompletionEntry>['evaluateTask']>;
}

export interface DeliveryScheduleHooks {
  completionPlugin?: KyselyPlugin;
  taskId?: string;
  plan?: PreparedDeliverySource['plan'];
  additionalTaskIds?: readonly string[];
  onPrepared: (source: PreparedDeliverySource) => void;
}

/** Test-only transport boundary; the callback receives an already committed target. */
export interface ControlledExitHooks {
  declareUsage?: boolean;
  stage?: (stage: string, material: CanonicalJsonObject) => Promise<void>;
  afterCommit?: (command: CanonicalJsonObject, committed: unknown) => Promise<void>;
  invokeCommand?: (
    command: CanonicalJsonObject,
    invokeEntry: () => Promise<unknown>,
    replayWithNewEntry: () => Promise<unknown>,
  ) => Promise<unknown>;
  commandStatus?: (commandId: unknown) => 'COMMITTED' | 'DUPLICATE';
  runtime?: (driver: LocalSyntheticRuntimeDriver) => void;
  deliveryTail?: InitialContextSuite['verifyDeliveryTail'];
}

export interface RecoveryFixture {
  runRef: Common.ObjectRef;
  attemptRef: Common.ObjectRef;
  workOrderRef: Common.ObjectRef;
  resultId: string;
  scanContext: TaskExecutionTransactionContext;
  ports: Parameters<typeof recoverControlledFinalRuns>[2];
  driver: LocalSyntheticRuntimeDriver;
}
