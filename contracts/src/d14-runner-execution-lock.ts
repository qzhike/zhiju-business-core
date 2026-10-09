import { sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import Ajv2020Import from 'ajv/dist/2020.js';
import type { AnySchemaObject, ErrorObject, Options, ValidateFunction } from 'ajv';

import type { Common } from './generated/types/common.js';
import { compareUtcInstants, parseUtcInstant } from './utc-instant.js';

// =============================================================================
// D14 / RD-01 internal Runner execution lock (`d14.runner_execution_lock@1.0`)
// =============================================================================
//
// Owning design: `.vibe/decisions/d14-rd01-runner-profile-lock.md` §2, approved
// at `8e8d2715b815179e92a18f444fb0eca13d58d466` and independently reviewed in
// `.vibe/reviews/pr-261/Review.md`. This module owns the closed machine schema,
// the static types, the producer and the validator of the three separated
// evidence layers:
//
//   * ApprovedConfiguration — the human-selected Runtime/provider/model, data
//     policy and control/isolation support set. Selecting parameters is not
//     deployment evidence.
//   * InstallationObservation — one read-only observation of one environment at
//     one trusted instant. A development-workstation (Darwin) observation cannot
//     substitute for the Ubuntu deployment observation.
//   * MaterializedLock — the complete, current, pin-bound instance a future OMP
//     Driver may consume.
//
// The descriptor is internal. It is deliberately not a public Command, not a
// registry selector and not a registered TypedReference: nothing here adds an
// operation to `contracts/registry/public-api.v1.json`, and no canonical
// `objectType` is reserved for it. `assertD14RunnerLockIsInternalDescriptor`
// keeps that boundary testable. Public Package@1.0, the synthetic CLI profiles
// and every existing acceptance set are untouched.
//
// Hash domains stay separate and are enforced by *shape*, not convention:
// `contentHash` is SHA-256 over `cv1` canonical JSON excluding the object's own
// hash field, while `bytesSha256` is a bare digest over actual file/build bytes.
// A canonical hash object in a bytes slot, or a bare digest in a `contentHash`
// slot, is rejected by the closed schema.
// =============================================================================

/** Internal descriptor type name. Never registered as a public operation. */
export const D14_RUNNER_EXECUTION_LOCK_TYPE = 'd14.runner_execution_lock';
/** Internal descriptor version of the execution lock. */
export const D14_RUNNER_EXECUTION_LOCK_VERSION = '1.0';
/** Approved first-version analysis profile code. */
export const D14_RUNNER_PROFILE_CODE = 'd14.analysis@1';
/** Approved configuration descriptor version. */
export const D14_RUNNER_CONFIGURATION_VERSION = 'd14.runner.configuration@1.0';
/** Approved installation observation descriptor version. */
export const D14_RUNNER_OBSERVATION_VERSION = 'd14.runner.observation@1.0';
/** Approved provider/model identity of the first D14 profile. */
export const D14_RUNNER_APPROVED_MODEL: {
  readonly runtimeCode: string;
  readonly provider: string;
  readonly modelId: string;
  readonly approvedModelVersion: string;
} = Object.freeze({
  runtimeCode: 'omp',
  provider: 'deepseek',
  modelId: 'deepseek-flash',
  approvedModelVersion: 'DeepSeek-V4.1-Flash',
});

/**
 * The closed OMP tool surface: only these four tools, and only against ordinary
 * files inside the per-Run root — no URL or internal URI scheme.
 */
export const D14_RUNNER_ALLOWED_TOOLS = Object.freeze(['read', 'grep', 'glob', 'write'] as const);

/** The three Run controls the first profile supports. */
export const D14_RUNNER_SUPPORTED_CONTROLS = Object.freeze([
  'HOST_HEARTBEAT',
  'CLI_PROGRESS',
  'PROVIDER_USAGE',
] as const);

/** The three IM-DG-006 controls the first profile rejects. */
export const D14_RUNNER_UNSUPPORTED_CONTROLS = Object.freeze([
  'record_run_suspension',
  'resume_suspended_run',
  'acknowledge_run_cancellation',
] as const);

/** Closed capabilities that must be `DISABLED` for the first profile. */
export const D14_RUNNER_DISABLED_CAPABILITIES = Object.freeze([
  'configurationDiscovery',
  'extensions',
  'hooks',
  'plugins',
  'subagents',
  'memory',
  'advisor',
  'auxiliaryModels',
  'fallback',
  'contextPromotion',
  'autoCompression',
  'autoTitle',
] as const);

/** Closed isolation mechanisms the deployment Host must enforce per Run. */
export const D14_RUNNER_ISOLATION_MECHANISMS = Object.freeze([
  'perRunUid',
  'perRunMountNamespace',
  'perRunPidNamespace',
  'perRunNetworkNamespace',
  'nonRoot',
  'dropCapabilities',
  'noNewPrivileges',
  'readOnlyRootfs',
  'mandatoryAccessControl',
  'seccompProfile',
  'cgroupLimits',
] as const);

/** Closed capability observations an installation probe may record. */
export const D14_RUNNER_OBSERVED_CAPABILITIES = Object.freeze([
  'OMP_PRINT',
  'OMP_JSON',
  'OMP_NO_SESSION',
  'OMP_TOOLS_SELECTOR',
  'OMP_NO_EXTENSIONS',
  'OMP_NO_SKILLS',
  'OMP_NO_RULES',
] as const);

/** Closed facts an installation probe explicitly did *not* establish. */
export const D14_RUNNER_UNPROBED_ITEMS = Object.freeze([
  'DEPLOYMENT_HOST_IMAGE',
  'UBUNTU_CLI_BUILD',
  'ADAPTER_BUILD',
  'HOST_ISOLATION',
  'PROVIDER_MODEL_VERSION_BINDING',
  'CUSTOMER_DATA_AUTHORIZATION',
  'PUBLISHED_TEMPLATES',
  'STARTUP_RULES',
  'V02_EVIDENCE_TOOLS',
] as const);

/** Rejection codes of the producer and the internal preflight boundary. */
export type D14LockRejectionCode =
  | 'D14_LOCK_SCHEMA_INVALID'
  | 'D14_LOCK_VERSION_UNSUPPORTED'
  | 'D14_LOCK_LAYER_HASH_MISMATCH'
  | 'D14_LOCK_PIN_MISSING'
  | 'D14_LOCK_REFERENCE_INVALID'
  | 'D14_LOCK_SCOPE_CONFLICT'
  | 'D14_LOCK_BINDING_MISMATCH'
  | 'D14_LOCK_OBSERVATION_NOT_DEPLOYMENT'
  | 'D14_LOCK_ELIGIBILITY_FAILED'
  | 'D14_LOCK_TOOL_SURFACE_VIOLATION'
  | 'D14_LOCK_CONTROL_UNSUPPORTED'
  | 'D14_LOCK_CUSTOMER_CONFIGURATION_REJECTED'
  | 'D14_LOCK_SECRET_MATERIAL_REJECTED';

export interface D14LockValidationError {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export type D14LockValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly D14LockValidationError[] };

/** Raised by the producer when a candidate cannot yield an admissible lock. */
export class D14LockRejection extends Error {
  readonly code: D14LockRejectionCode;
  readonly reasons: readonly string[];

  constructor(code: D14LockRejectionCode, reasons: readonly string[]) {
    super(`${code}: ${reasons.join('; ')}`);
    this.name = 'D14LockRejection';
    this.code = code;
    this.reasons = [...reasons];
  }
}

/** A `{ref, contentHash}` binding to a canonical object or descriptor. */
export interface D14PinnedRef {
  readonly ref: D14CanonicalRef;
  readonly contentHash: Common.ContentHash;
  readonly bytesSha256?: string;
  readonly publicationReceiptRef?: D14CanonicalRef;
}

/** The four exact canonical reference kinds a lock pin may carry. */
export type D14CanonicalRef =
  Common.ObjectRef | Common.VersionedRef | Common.ContentAddressedRef | Common.SnapshotRef;

export interface D14ToolPin {
  readonly toolCode: string;
  readonly toolVersion: string;
  readonly codeRef: D14CanonicalRef;
  readonly codeBytesSha256: string;
  readonly runtime: { readonly runtimeCode: string; readonly runtimeVersion: string };
  readonly dependencyLockBytesSha256: string;
  readonly buildSha256: string;
  readonly commandTemplate: string;
}

export interface D14ApprovedConfiguration {
  readonly configurationVersion: string;
  readonly profileCode: string;
  readonly runtime: {
    readonly runtimeCode: 'omp';
    readonly productName: 'Oh-My-Pi';
    readonly invocationMode: 'LOCAL_PROCESS';
    readonly interactive: false;
  };
  readonly model: {
    readonly provider: 'deepseek';
    readonly modelId: 'deepseek-flash';
    readonly approvedModelVersion: 'DeepSeek-V4.1-Flash';
    readonly effort: 'EXPLICIT';
    readonly maxOutputTokens: number;
    readonly maxContextTokens: number;
    readonly maxTurns: number;
    readonly costBudgetUsdMax: number;
  };
  readonly toolSurface: {
    readonly allowedTools: readonly string[];
    readonly uriOrSchemeToolArguments: 'DENIED';
    readonly rootPlainFilesOnly: true;
    readonly permissionRules: D14PinnedRef;
  };
  readonly skillAllowlist: readonly string[];
  readonly mcpAllowlist: readonly string[];
  readonly disabledCapabilities: Readonly<Record<string, 'DISABLED'>>;
  readonly isolationPolicy: Readonly<Record<string, true>>;
  readonly dataPolicy: {
    readonly customerMaterialEgress: 'CONDITIONAL_APPROVAL_REQUIRED';
    readonly requiresCustomerDataApproval: true;
    readonly policy: D14PinnedRef;
  };
  readonly controlPolicy: {
    readonly wallClockSecondsMax: 900;
    readonly workOrderSecondsMax: 1800;
    readonly maxAttempts: 2;
    readonly dispatchObservationWindowSeconds: 30;
    readonly hostHeartbeatSeconds: 15;
    readonly runLeaseSeconds: 60;
    readonly stopGraceSeconds: 5;
    readonly runCostBudgetUsdMax: 5;
    readonly totalCostBudgetUsdMax: 10;
    readonly memoryBytesMax: 2147483648;
    readonly pidsMax: 32;
    readonly outputBytesMax: 33554432;
    readonly supportedControls: readonly string[];
    readonly unsupportedControls: readonly string[];
  };
  readonly selectionEvidence: D14PinnedRef;
  readonly designReview: D14PinnedRef;
  readonly technicalApproval: D14PinnedRef;
  readonly reviewedRevision: string;
  readonly configurationHash: Common.ContentHash;
}

export interface D14InstallationObservation {
  readonly observationId: string;
  readonly observationVersion: string;
  readonly observedAt: string;
  readonly platform: {
    readonly osFamily: 'linux' | 'darwin';
    readonly osRelease: string;
    readonly kernelVersion: string;
    readonly architecture: string;
  };
  readonly cli: {
    /** The schema accepts only `omp`; the probe readback stays a plain string. */
    readonly executableCode: string;
    readonly resolvedExecutablePath: string;
    readonly observedCliVersion: string;
    readonly cliBinarySha256: string;
  };
  readonly adapter: {
    readonly adapterCode: string;
    readonly adapterVersion: string;
    readonly sourceSha256: string;
    readonly buildSha256: string;
  };
  readonly harness: {
    readonly harnessId: string;
    readonly harnessVersion: string;
  };
  readonly observedCapabilities: readonly string[];
  readonly unprobedItems: readonly string[];
  readonly observationHash: Common.ContentHash;
}

/** The eight isolation/control/boundary policies every lock must pin. */
export type D14PolicyKey =
  'filesystem' | 'network' | 'tool' | 'data' | 'resource' | 'control' | 'retention' | 'cleanup';

/** The eight exact scope anchors every lock must pin. */
export type D14ScopeAnchorKey =
  | 'enterprise'
  | 'project'
  | 'task'
  | 'workOrder'
  | 'workOrderContract'
  | 'run'
  | 'attempt'
  | 'package';

/** Lock payload. `lockHash` is deliberately outside its own signed domain. */
export interface D14MaterializedLockPayload {
  readonly lockId: string;
  readonly lockVersion: string;
  readonly profileCode: string;
  readonly identity: {
    readonly approvedConfigurationVersion: string;
    readonly approvedConfigurationHash: Common.ContentHash;
    readonly installationObservationId: string;
    readonly installationObservationHash: Common.ContentHash;
    readonly reviewedRevision: string;
    readonly selectionEvidence: D14PinnedRef;
    readonly designReview: D14PinnedRef;
    readonly technicalApproval: D14PinnedRef;
  };
  readonly runtime: {
    readonly executableCode: 'omp';
    readonly resolvedExecutablePath: string;
    readonly observedCliVersion: string;
    readonly cliBinarySha256: string;
    readonly cliBuildSha256: string;
    readonly cliDependencyLockBytesSha256: string;
    readonly adapterCode: string;
    readonly adapterVersion: string;
    readonly adapterSourceSha256: string;
    readonly adapterBuildSha256: string;
    readonly harnessId: string;
    readonly harnessVersion: string;
    readonly hostImageDigest: string;
    readonly hostOsRelease: string;
    readonly hostKernelVersion: string;
    readonly hostArchitecture: string;
    readonly launcherVersion: string;
    readonly launcherDigest: string;
    readonly parserVersion: string;
    readonly parserDigest: string;
  };
  readonly model: {
    readonly provider: 'deepseek';
    readonly modelId: 'deepseek-flash';
    readonly approvedModelVersion: 'DeepSeek-V4.1-Flash';
    readonly modelConfigHash: Common.ContentHash;
    readonly fixedVersionBinding: D14PinnedRef;
    readonly perInvocationVerificationRule: D14PinnedRef;
    readonly identityBindingPolicy: D14PinnedRef;
    readonly apiTransport: D14PinnedRef;
    readonly apiEndpoint: D14PinnedRef;
    readonly networkPolicy: D14PinnedRef;
    readonly dataPolicy: D14PinnedRef;
  };
  readonly promptTools: {
    readonly systemPrompt: D14PinnedRef;
    readonly taskPrompt: D14PinnedRef;
    readonly effectiveSettingsHash: Common.ContentHash;
    readonly toolPermissionRules: D14PinnedRef;
    readonly toolAllowlist: readonly string[];
    readonly skillAllowlist: readonly string[];
    readonly mcpAllowlist: readonly string[];
    readonly disabledCapabilities: Readonly<Record<string, 'DISABLED'>>;
  };
  readonly templates: {
    readonly templateRefs: readonly D14PinnedRef[];
    readonly ruleBundle: D14PinnedRef;
    readonly startupRules: D14PinnedRef;
    readonly vocabulary: D14PinnedRef;
  };
  readonly outputTools: {
    readonly inputAliasManifest: {
      readonly schemaRef: D14CanonicalRef;
      readonly schemaVersion: string;
      readonly bytesSha256: string;
    };
    readonly preparationSource: D14PinnedRef;
    readonly preparationContext: D14PinnedRef;
    readonly outputProfile: D14PinnedRef;
    readonly outputSchema: D14PinnedRef;
    readonly reader: D14ToolPin;
    readonly validator: D14ToolPin;
    readonly renderer: D14ToolPin;
  };
  readonly boundary: {
    readonly policies: Readonly<Record<D14PolicyKey, D14PinnedRef>>;
    readonly scope: Readonly<Record<D14ScopeAnchorKey, D14PinnedRef>>;
    readonly analysisRequestKey: string;
    readonly inputManifestBytesSha256: string;
    readonly leaseId: string;
    readonly fencingToken: string;
    readonly issuedAt: string;
    readonly validUntil: string;
    readonly phase: 'PREPARING' | 'INITIAL_SCOPE_RECOVERY';
    readonly frozenStartRef?: D14CanonicalRef;
    readonly outputRoot: D14PinnedRef;
  };
}

export interface D14MaterializedLock extends D14MaterializedLockPayload {
  readonly lockHash: Common.ContentHash;
}

/** Input of the deterministic producer: three layers plus one trusted instant. */
export interface D14LockProductionInput {
  readonly approvedConfiguration: unknown;
  readonly installationObservation: unknown;
  readonly lockPayload: unknown;
  readonly trustedNow: string;
}

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const UUID_V7_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const NAMESPACE_PATTERN = '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$';
const UTC_INSTANT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$';
const GIT_REVISION_PATTERN = '^[0-9a-f]{40}$';
const ABSOLUTE_POSIX_PATH_PATTERN = '^/[A-Za-z0-9._/-]+$';
const SAFE_TOKEN_PATTERN = '^[A-Za-z0-9._:@+-]{1,200}$';
const OCI_DIGEST_PATTERN = '^sha256:[0-9a-f]{64}$';
const COMMAND_TEMPLATE_PATTERN = '^[A-Za-z0-9 ._/=:@,+<>-]{1,500}$';

const NAMESPACE_REGEX = new RegExp(NAMESPACE_PATTERN, 'u');
const UUID_V7_REGEX = new RegExp(UUID_V7_PATTERN, 'u');
const DIGEST_REGEX = new RegExp(DIGEST_PATTERN, 'u');
/** Secret-shaped material that must never appear as a locked string value. */
const SECRET_VALUE_REGEXES = Object.freeze([
  /^sk-[A-Za-z0-9_-]{16,}$/u,
  /^Bearer\s/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
]);

/** Customer/personal discovery roots that can never become execution config. */
const CUSTOMER_CONFIGURATION_MARKERS = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  '.claude',
  '.omp/',
  '.pi/',
  '.qoder',
  'mcp.json',
  'skills/',
]);

/** Static reference discriminator table (closed set of canonical kinds). */
const REFERENCE_KINDS: Record<string, true> = {
  OBJECT: true,
  VERSIONED: true,
  CONTENT_ADDRESSED: true,
  SNAPSHOT: true,
};

const REJECTION_CODE_BY_KEYWORD: Record<string, D14LockRejectionCode> = {
  d14Reference: 'D14_LOCK_REFERENCE_INVALID',
  d14Scope: 'D14_LOCK_SCOPE_CONFLICT',
  d14Pin: 'D14_LOCK_PIN_MISSING',
  d14LockHash: 'D14_LOCK_LAYER_HASH_MISMATCH',
  d14Binding: 'D14_LOCK_BINDING_MISMATCH',
  d14ModelVersion: 'D14_LOCK_BINDING_MISMATCH',
  d14ToolSurface: 'D14_LOCK_TOOL_SURFACE_VIOLATION',
  d14ControlPolicy: 'D14_LOCK_CONTROL_UNSUPPORTED',
  d14CustomerConfiguration: 'D14_LOCK_CUSTOMER_CONFIGURATION_REJECTED',
  d14Secret: 'D14_LOCK_SECRET_MATERIAL_REJECTED',
};

const contentHashSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['algorithm', 'canonicalizationVersion', 'digest'],
  properties: {
    algorithm: { const: 'SHA-256' },
    canonicalizationVersion: { const: '1' },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const scopeRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enterpriseId: { type: 'string', pattern: UUID_V7_PATTERN },
    projectId: { type: 'string', pattern: UUID_V7_PATTERN },
  },
};

const commonDefs = {
  contentHash: contentHashSchema,
  scopeRef: scopeRefSchema,
  objectRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'scope'],
    properties: {
      kind: { const: 'OBJECT' },
      objectType: { type: 'string', pattern: NAMESPACE_PATTERN },
      objectId: { type: 'string', pattern: UUID_V7_PATTERN },
      scope: { $ref: '#/$defs/scopeRef' },
    },
  },
  versionedRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'versionId', 'scope'],
    properties: {
      kind: { const: 'VERSIONED' },
      objectType: { type: 'string', pattern: NAMESPACE_PATTERN },
      objectId: { type: 'string', pattern: UUID_V7_PATTERN },
      versionId: { type: 'string', pattern: UUID_V7_PATTERN },
      scope: { $ref: '#/$defs/scopeRef' },
    },
  },
  contentAddressedRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'scope', 'contentHash'],
    properties: {
      kind: { const: 'CONTENT_ADDRESSED' },
      objectType: { type: 'string', pattern: NAMESPACE_PATTERN },
      objectId: { type: 'string', pattern: UUID_V7_PATTERN },
      immutableVersionId: { type: 'string', pattern: UUID_V7_PATTERN },
      scope: { $ref: '#/$defs/scopeRef' },
      contentHash: { $ref: '#/$defs/contentHash' },
    },
  },
  snapshotRef: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'objectType', 'objectId', 'snapshotId', 'scope', 'contentHash'],
    properties: {
      kind: { const: 'SNAPSHOT' },
      objectType: { type: 'string', pattern: NAMESPACE_PATTERN },
      objectId: { type: 'string', pattern: UUID_V7_PATTERN },
      snapshotId: { type: 'string', pattern: UUID_V7_PATTERN },
      scope: { $ref: '#/$defs/scopeRef' },
      contentHash: { $ref: '#/$defs/contentHash' },
    },
  },
  canonicalRef: {
    oneOf: [
      { $ref: '#/$defs/objectRef' },
      { $ref: '#/$defs/versionedRef' },
      { $ref: '#/$defs/contentAddressedRef' },
      { $ref: '#/$defs/snapshotRef' },
    ],
  },
  pinnedObject: {
    type: 'object',
    additionalProperties: false,
    required: ['ref', 'contentHash'],
    properties: {
      ref: { $ref: '#/$defs/canonicalRef' },
      contentHash: { $ref: '#/$defs/contentHash' },
      bytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
      publicationReceiptRef: { $ref: '#/$defs/canonicalRef' },
    },
  },
  publishedObject: {
    type: 'object',
    additionalProperties: false,
    required: ['ref', 'contentHash', 'bytesSha256', 'publicationReceiptRef'],
    properties: {
      ref: { $ref: '#/$defs/canonicalRef' },
      contentHash: { $ref: '#/$defs/contentHash' },
      bytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
      publicationReceiptRef: { $ref: '#/$defs/canonicalRef' },
    },
  },
  toolPin: {
    type: 'object',
    additionalProperties: false,
    required: [
      'toolCode',
      'toolVersion',
      'codeRef',
      'codeBytesSha256',
      'runtime',
      'dependencyLockBytesSha256',
      'buildSha256',
      'commandTemplate',
    ],
    properties: {
      toolCode: { type: 'string', pattern: NAMESPACE_PATTERN },
      toolVersion: { type: 'string', minLength: 1, maxLength: 64 },
      codeRef: { $ref: '#/$defs/canonicalRef' },
      codeBytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
      runtime: {
        type: 'object',
        additionalProperties: false,
        required: ['runtimeCode', 'runtimeVersion'],
        properties: {
          runtimeCode: { type: 'string', pattern: NAMESPACE_PATTERN },
          runtimeVersion: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
      dependencyLockBytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
      buildSha256: { type: 'string', pattern: DIGEST_PATTERN },
      commandTemplate: { type: 'string', pattern: COMMAND_TEMPLATE_PATTERN },
    },
  },
};

const disabledCapabilitiesSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...D14_RUNNER_DISABLED_CAPABILITIES],
  properties: Object.fromEntries(
    D14_RUNNER_DISABLED_CAPABILITIES.map((key) => [key, { const: 'DISABLED' }]),
  ),
};

// Closed *value* sets are enforced by the policy validator rather than by an
// `enum`, so an extra/unknown tool or control rejects with its own policy code.
const allowedToolsSchema = { type: 'array', items: { type: 'string' } };
const controlSetSchema = { type: 'array', items: { type: 'string' } };

const allowlistSchema = { type: 'array', items: { type: 'string' } };

const controlPolicySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'wallClockSecondsMax',
    'workOrderSecondsMax',
    'maxAttempts',
    'dispatchObservationWindowSeconds',
    'hostHeartbeatSeconds',
    'runLeaseSeconds',
    'stopGraceSeconds',
    'runCostBudgetUsdMax',
    'totalCostBudgetUsdMax',
    'memoryBytesMax',
    'pidsMax',
    'outputBytesMax',
    'supportedControls',
    'unsupportedControls',
  ],
  properties: {
    wallClockSecondsMax: { const: 900 },
    workOrderSecondsMax: { const: 1800 },
    maxAttempts: { const: 2 },
    dispatchObservationWindowSeconds: { const: 30 },
    hostHeartbeatSeconds: { const: 15 },
    runLeaseSeconds: { const: 60 },
    stopGraceSeconds: { const: 5 },
    runCostBudgetUsdMax: { const: 5 },
    totalCostBudgetUsdMax: { const: 10 },
    memoryBytesMax: { const: 2147483648 },
    pidsMax: { const: 32 },
    outputBytesMax: { const: 33554432 },
    supportedControls: controlSetSchema,
    unsupportedControls: controlSetSchema,
  },
};

const approvedConfigurationSchema = {
  $id: 'https://schemas.zhiju.local/internal/d14/1.0/approvedConfiguration',
  $defs: commonDefs,
  type: 'object',
  additionalProperties: false,
  required: [
    'configurationVersion',
    'profileCode',
    'runtime',
    'model',
    'toolSurface',
    'skillAllowlist',
    'mcpAllowlist',
    'disabledCapabilities',
    'isolationPolicy',
    'dataPolicy',
    'controlPolicy',
    'selectionEvidence',
    'designReview',
    'technicalApproval',
    'reviewedRevision',
    'configurationHash',
  ],
  properties: {
    configurationVersion: { const: D14_RUNNER_CONFIGURATION_VERSION },
    profileCode: { const: D14_RUNNER_PROFILE_CODE },
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: ['runtimeCode', 'productName', 'invocationMode', 'interactive'],
      properties: {
        runtimeCode: { const: 'omp' },
        productName: { const: 'Oh-My-Pi' },
        invocationMode: { const: 'LOCAL_PROCESS' },
        interactive: { const: false },
      },
    },
    model: {
      type: 'object',
      additionalProperties: false,
      required: [
        'provider',
        'modelId',
        'approvedModelVersion',
        'effort',
        'maxOutputTokens',
        'maxContextTokens',
        'maxTurns',
        'costBudgetUsdMax',
      ],
      properties: {
        provider: { const: 'deepseek' },
        modelId: { const: 'deepseek-flash' },
        approvedModelVersion: { const: 'DeepSeek-V4.1-Flash' },
        effort: { const: 'EXPLICIT' },
        maxOutputTokens: { type: 'integer', minimum: 1 },
        maxContextTokens: { type: 'integer', minimum: 1 },
        maxTurns: { type: 'integer', minimum: 1 },
        costBudgetUsdMax: { const: 5 },
      },
    },
    toolSurface: {
      type: 'object',
      additionalProperties: false,
      required: [
        'allowedTools',
        'uriOrSchemeToolArguments',
        'rootPlainFilesOnly',
        'permissionRules',
      ],
      properties: {
        allowedTools: allowedToolsSchema,
        uriOrSchemeToolArguments: { const: 'DENIED' },
        rootPlainFilesOnly: { const: true },
        permissionRules: { $ref: '#/$defs/pinnedObject' },
      },
    },
    skillAllowlist: allowlistSchema,
    mcpAllowlist: allowlistSchema,
    disabledCapabilities: disabledCapabilitiesSchema,
    isolationPolicy: {
      type: 'object',
      additionalProperties: false,
      required: [...D14_RUNNER_ISOLATION_MECHANISMS],
      properties: Object.fromEntries(
        D14_RUNNER_ISOLATION_MECHANISMS.map((key) => [key, { const: true }]),
      ),
    },
    dataPolicy: {
      type: 'object',
      additionalProperties: false,
      required: ['customerMaterialEgress', 'requiresCustomerDataApproval', 'policy'],
      properties: {
        customerMaterialEgress: { const: 'CONDITIONAL_APPROVAL_REQUIRED' },
        requiresCustomerDataApproval: { const: true },
        policy: { $ref: '#/$defs/pinnedObject' },
      },
    },
    controlPolicy: controlPolicySchema,
    selectionEvidence: { $ref: '#/$defs/pinnedObject' },
    designReview: { $ref: '#/$defs/pinnedObject' },
    technicalApproval: { $ref: '#/$defs/pinnedObject' },
    reviewedRevision: { type: 'string', pattern: GIT_REVISION_PATTERN },
    configurationHash: { $ref: '#/$defs/contentHash' },
  },
};

const installationObservationSchema = {
  $id: 'https://schemas.zhiju.local/internal/d14/1.0/installationObservation',
  $defs: commonDefs,
  type: 'object',
  additionalProperties: false,
  required: [
    'observationId',
    'observationVersion',
    'observedAt',
    'platform',
    'cli',
    'adapter',
    'harness',
    'observedCapabilities',
    'unprobedItems',
    'observationHash',
  ],
  properties: {
    observationId: { type: 'string', pattern: UUID_V7_PATTERN },
    observationVersion: { const: D14_RUNNER_OBSERVATION_VERSION },
    observedAt: { type: 'string', pattern: UTC_INSTANT_PATTERN },
    platform: {
      type: 'object',
      additionalProperties: false,
      required: ['osFamily', 'osRelease', 'kernelVersion', 'architecture'],
      properties: {
        osFamily: { enum: ['linux', 'darwin'] },
        osRelease: { type: 'string', minLength: 1, maxLength: 128 },
        kernelVersion: { type: 'string', minLength: 1, maxLength: 128 },
        architecture: { enum: ['x64', 'arm64'] },
      },
    },
    cli: {
      type: 'object',
      additionalProperties: false,
      required: [
        'executableCode',
        'resolvedExecutablePath',
        'observedCliVersion',
        'cliBinarySha256',
      ],
      properties: {
        executableCode: { const: 'omp' },
        resolvedExecutablePath: { type: 'string', pattern: ABSOLUTE_POSIX_PATH_PATTERN },
        observedCliVersion: { type: 'string', minLength: 1, maxLength: 64 },
        cliBinarySha256: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
    adapter: {
      type: 'object',
      additionalProperties: false,
      required: ['adapterCode', 'adapterVersion', 'sourceSha256', 'buildSha256'],
      properties: {
        adapterCode: { type: 'string', pattern: NAMESPACE_PATTERN },
        adapterVersion: { type: 'string', minLength: 1, maxLength: 64 },
        sourceSha256: { type: 'string', pattern: DIGEST_PATTERN },
        buildSha256: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
    harness: {
      type: 'object',
      additionalProperties: false,
      required: ['harnessId', 'harnessVersion'],
      properties: {
        harnessId: { type: 'string', pattern: NAMESPACE_PATTERN },
        harnessVersion: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
    observedCapabilities: {
      type: 'array',
      uniqueItems: true,
      items: { enum: [...D14_RUNNER_OBSERVED_CAPABILITIES] },
    },
    unprobedItems: {
      type: 'array',
      uniqueItems: true,
      items: { enum: [...D14_RUNNER_UNPROBED_ITEMS] },
    },
    observationHash: { $ref: '#/$defs/contentHash' },
  },
};

const lockPayloadBase = {
  $defs: commonDefs,
  type: 'object',
  additionalProperties: false,
  required: [
    'lockId',
    'lockVersion',
    'profileCode',
    'identity',
    'runtime',
    'model',
    'promptTools',
    'templates',
    'outputTools',
    'boundary',
  ],
  properties: {
    lockId: { type: 'string', pattern: UUID_V7_PATTERN },
    lockVersion: { const: D14_RUNNER_EXECUTION_LOCK_VERSION },
    profileCode: { const: D14_RUNNER_PROFILE_CODE },
    identity: {
      type: 'object',
      additionalProperties: false,
      required: [
        'approvedConfigurationVersion',
        'approvedConfigurationHash',
        'installationObservationId',
        'installationObservationHash',
        'reviewedRevision',
        'selectionEvidence',
        'designReview',
        'technicalApproval',
      ],
      properties: {
        approvedConfigurationVersion: { const: D14_RUNNER_CONFIGURATION_VERSION },
        approvedConfigurationHash: { $ref: '#/$defs/contentHash' },
        installationObservationId: { type: 'string', pattern: UUID_V7_PATTERN },
        installationObservationHash: { $ref: '#/$defs/contentHash' },
        reviewedRevision: { type: 'string', pattern: GIT_REVISION_PATTERN },
        selectionEvidence: { $ref: '#/$defs/pinnedObject' },
        designReview: { $ref: '#/$defs/pinnedObject' },
        technicalApproval: { $ref: '#/$defs/pinnedObject' },
      },
    },
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: [
        'executableCode',
        'resolvedExecutablePath',
        'observedCliVersion',
        'cliBinarySha256',
        'cliBuildSha256',
        'cliDependencyLockBytesSha256',
        'adapterCode',
        'adapterVersion',
        'adapterSourceSha256',
        'adapterBuildSha256',
        'harnessId',
        'harnessVersion',
        'hostImageDigest',
        'hostOsRelease',
        'hostKernelVersion',
        'hostArchitecture',
        'launcherVersion',
        'launcherDigest',
        'parserVersion',
        'parserDigest',
      ],
      properties: {
        executableCode: { const: 'omp' },
        resolvedExecutablePath: { type: 'string', pattern: ABSOLUTE_POSIX_PATH_PATTERN },
        observedCliVersion: { type: 'string', minLength: 1, maxLength: 64 },
        cliBinarySha256: { type: 'string', pattern: DIGEST_PATTERN },
        cliBuildSha256: { type: 'string', pattern: DIGEST_PATTERN },
        cliDependencyLockBytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
        adapterCode: { type: 'string', pattern: NAMESPACE_PATTERN },
        adapterVersion: { type: 'string', minLength: 1, maxLength: 64 },
        adapterSourceSha256: { type: 'string', pattern: DIGEST_PATTERN },
        adapterBuildSha256: { type: 'string', pattern: DIGEST_PATTERN },
        harnessId: { type: 'string', pattern: NAMESPACE_PATTERN },
        harnessVersion: { type: 'string', minLength: 1, maxLength: 64 },
        hostImageDigest: { type: 'string', pattern: OCI_DIGEST_PATTERN },
        hostOsRelease: { type: 'string', minLength: 1, maxLength: 128 },
        hostKernelVersion: { type: 'string', minLength: 1, maxLength: 128 },
        hostArchitecture: { enum: ['x64', 'arm64'] },
        launcherVersion: { type: 'string', minLength: 1, maxLength: 64 },
        launcherDigest: { type: 'string', pattern: DIGEST_PATTERN },
        parserVersion: { type: 'string', minLength: 1, maxLength: 64 },
        parserDigest: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
    model: {
      type: 'object',
      additionalProperties: false,
      required: [
        'provider',
        'modelId',
        'approvedModelVersion',
        'modelConfigHash',
        'fixedVersionBinding',
        'perInvocationVerificationRule',
        'identityBindingPolicy',
        'apiTransport',
        'apiEndpoint',
        'networkPolicy',
        'dataPolicy',
      ],
      properties: {
        provider: { const: 'deepseek' },
        modelId: { const: 'deepseek-flash' },
        approvedModelVersion: { const: 'DeepSeek-V4.1-Flash' },
        modelConfigHash: { $ref: '#/$defs/contentHash' },
        fixedVersionBinding: { $ref: '#/$defs/pinnedObject' },
        perInvocationVerificationRule: { $ref: '#/$defs/pinnedObject' },
        identityBindingPolicy: { $ref: '#/$defs/pinnedObject' },
        apiTransport: { $ref: '#/$defs/pinnedObject' },
        apiEndpoint: { $ref: '#/$defs/pinnedObject' },
        networkPolicy: { $ref: '#/$defs/pinnedObject' },
        dataPolicy: { $ref: '#/$defs/pinnedObject' },
      },
    },
    promptTools: {
      type: 'object',
      additionalProperties: false,
      required: [
        'systemPrompt',
        'taskPrompt',
        'effectiveSettingsHash',
        'toolPermissionRules',
        'toolAllowlist',
        'skillAllowlist',
        'mcpAllowlist',
        'disabledCapabilities',
      ],
      properties: {
        systemPrompt: { $ref: '#/$defs/pinnedObject' },
        taskPrompt: { $ref: '#/$defs/pinnedObject' },
        effectiveSettingsHash: { $ref: '#/$defs/contentHash' },
        toolPermissionRules: { $ref: '#/$defs/pinnedObject' },
        toolAllowlist: allowedToolsSchema,
        skillAllowlist: allowlistSchema,
        mcpAllowlist: allowlistSchema,
        disabledCapabilities: disabledCapabilitiesSchema,
      },
    },
    templates: {
      type: 'object',
      additionalProperties: false,
      required: ['templateRefs', 'ruleBundle', 'startupRules', 'vocabulary'],
      properties: {
        templateRefs: { type: 'array', minItems: 1, items: { $ref: '#/$defs/publishedObject' } },
        ruleBundle: { $ref: '#/$defs/publishedObject' },
        startupRules: { $ref: '#/$defs/pinnedObject' },
        vocabulary: { $ref: '#/$defs/pinnedObject' },
      },
    },
    outputTools: {
      type: 'object',
      additionalProperties: false,
      required: [
        'inputAliasManifest',
        'preparationSource',
        'preparationContext',
        'outputProfile',
        'outputSchema',
        'reader',
        'validator',
        'renderer',
      ],
      properties: {
        inputAliasManifest: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaRef', 'schemaVersion', 'bytesSha256'],
          properties: {
            schemaRef: { $ref: '#/$defs/canonicalRef' },
            schemaVersion: { type: 'string', minLength: 1, maxLength: 64 },
            bytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
          },
        },
        preparationSource: { $ref: '#/$defs/pinnedObject' },
        preparationContext: { $ref: '#/$defs/pinnedObject' },
        outputProfile: { $ref: '#/$defs/pinnedObject' },
        outputSchema: { $ref: '#/$defs/pinnedObject' },
        reader: { $ref: '#/$defs/toolPin' },
        validator: { $ref: '#/$defs/toolPin' },
        renderer: { $ref: '#/$defs/toolPin' },
      },
    },
    boundary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'policies',
        'scope',
        'analysisRequestKey',
        'inputManifestBytesSha256',
        'leaseId',
        'fencingToken',
        'issuedAt',
        'validUntil',
        'phase',
        'outputRoot',
      ],
      properties: {
        policies: {
          type: 'object',
          additionalProperties: false,
          required: [
            'filesystem',
            'network',
            'tool',
            'data',
            'resource',
            'control',
            'retention',
            'cleanup',
          ],
          properties: Object.fromEntries(
            [
              'filesystem',
              'network',
              'tool',
              'data',
              'resource',
              'control',
              'retention',
              'cleanup',
            ].map((key) => [key, { $ref: '#/$defs/pinnedObject' }]),
          ),
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          required: [
            'enterprise',
            'project',
            'task',
            'workOrder',
            'workOrderContract',
            'run',
            'attempt',
            'package',
          ],
          properties: Object.fromEntries(
            [
              'enterprise',
              'project',
              'task',
              'workOrder',
              'workOrderContract',
              'run',
              'attempt',
              'package',
            ].map((key) => [key, { $ref: '#/$defs/pinnedObject' }]),
          ),
        },
        analysisRequestKey: { type: 'string', pattern: SAFE_TOKEN_PATTERN },
        inputManifestBytesSha256: { type: 'string', pattern: DIGEST_PATTERN },
        leaseId: { type: 'string', pattern: UUID_V7_PATTERN },
        fencingToken: { type: 'string', pattern: SAFE_TOKEN_PATTERN },
        issuedAt: { type: 'string', pattern: UTC_INSTANT_PATTERN },
        validUntil: { type: 'string', pattern: UTC_INSTANT_PATTERN },
        phase: { enum: ['PREPARING', 'INITIAL_SCOPE_RECOVERY'] },
        frozenStartRef: { $ref: '#/$defs/canonicalRef' },
        outputRoot: { $ref: '#/$defs/pinnedObject' },
      },
    },
  },
};

const lockPayloadSchema = {
  $id: 'https://schemas.zhiju.local/internal/d14/1.0/lockPayload',
  ...lockPayloadBase,
};

/** The lock schema is the payload schema plus the required own `lockHash`. */
const materializedLockSchema = {
  $id: 'https://schemas.zhiju.local/internal/d14/1.0/materializedLock',
  ...lockPayloadBase,
  required: [...lockPayloadBase.required, 'lockHash'],
  properties: {
    ...lockPayloadBase.properties,
    lockHash: { $ref: '#/$defs/contentHash' },
  },
};

interface AjvRuntime {
  addSchema(schema: AnySchemaObject): AjvRuntime;
  getSchema(key: string): ValidateFunction | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: Options) => AjvRuntime;

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of [
  approvedConfigurationSchema,
  installationObservationSchema,
  lockPayloadSchema,
  materializedLockSchema,
]) {
  ajv.addSchema(schema);
}

const approvedConfigurationValidator = ajv.getSchema(
  'https://schemas.zhiju.local/internal/d14/1.0/approvedConfiguration',
);
const installationObservationValidator = ajv.getSchema(
  'https://schemas.zhiju.local/internal/d14/1.0/installationObservation',
);
const lockPayloadValidator = ajv.getSchema(
  'https://schemas.zhiju.local/internal/d14/1.0/lockPayload',
);
const materializedLockValidator = ajv.getSchema(
  'https://schemas.zhiju.local/internal/d14/1.0/materializedLock',
);

/** The closed, machine-readable schemas of the three separated evidence layers. */
export const d14RunnerExecutionLockSchemas = Object.freeze({
  approvedConfiguration: approvedConfigurationSchema,
  installationObservation: installationObservationSchema,
  lockPayload: lockPayloadSchema,
  materializedLock: materializedLockSchema,
});

function schemaErrors(
  validator: ValidateFunction | undefined,
  input: unknown,
  label: string,
): D14LockValidationError[] {
  if (validator === undefined) throw new Error(`missing ${label} validator`);
  if (validator(input)) return [];
  return (validator.errors ?? []).map((error: ErrorObject) => ({
    path: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema violation',
  }));
}

function semanticError(path: string, keyword: string, message: string): D14LockValidationError {
  return { path, keyword, message };
}

/** Depth-first walk of any decoded JSON value; never throws on scalars. */
function walkJson(node: unknown, path: string, visit: (node: unknown, path: string) => void): void {
  if (node === null || typeof node !== 'object') {
    visit(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      walkJson(item, `${path}/${index}`, visit);
    });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    visit(child, `${path}/${key}`);
    walkJson(child, `${path}/${key}`, visit);
  }
}

/**
 * Customer/personal configuration markers and secret material can never become
 * execution configuration, and arbitrary spawn overrides are not lock inputs.
 */
function customerAndSecretErrors(value: unknown): D14LockValidationError[] {
  const errors: D14LockValidationError[] = [];
  walkJson(value, '', (node, path) => {
    if (typeof node !== 'string') return;
    if (SECRET_VALUE_REGEXES.some((pattern) => pattern.test(node))) {
      errors.push(
        semanticError(path, 'd14Secret', 'secret-shaped value cannot enter the execution lock'),
      );
      return;
    }
    for (const marker of CUSTOMER_CONFIGURATION_MARKERS) {
      if (node.includes(marker)) {
        errors.push(
          semanticError(
            path,
            'd14CustomerConfiguration',
            `customer/personal configuration marker \`${marker}\` cannot become execution configuration`,
          ),
        );
      }
    }
  });
  return errors;
}

interface FoundReference {
  readonly path: string;
  readonly value: Record<string, unknown>;
}

function collectCanonicalReferences(value: unknown): FoundReference[] {
  const found: FoundReference[] = [];
  walkJson(value, '', (node, path) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (!('kind' in node)) return;
    // Decoded JSON object; only the declared canonical-reference fields are read.
    const reference = node as Record<string, unknown>;
    if (typeof reference.kind === 'string' && REFERENCE_KINDS[reference.kind] === true) {
      found.push({ path, value: reference });
    }
  });
  return found;
}

/**
 * Reject a canonical reference that is not an exact, scoped pin: a non-namespace
 * `objectType`, a floating `latest` alias, a non-UUIDv7 identifier, or a scope
 * that crosses the locked enterprise/project.
 */
function referenceErrors(
  references: readonly FoundReference[],
  expected: Common.ScopeRef,
): D14LockValidationError[] {
  const errors: D14LockValidationError[] = [];
  for (const { path, value } of references) {
    const objectType = value.objectType;
    if (typeof objectType !== 'string' || !NAMESPACE_REGEX.test(objectType)) {
      errors.push(semanticError(path, 'd14Reference', 'objectType is not a registered namespace'));
    } else if (objectType.split(/[._]/u).includes('latest')) {
      errors.push(semanticError(path, 'd14Reference', 'floating `latest` alias is not a pin'));
    }
    for (const id of ['objectId', 'versionId', 'snapshotId', 'immutableVersionId'] as const) {
      const candidate = value[id];
      if (candidate === undefined) continue;
      if (typeof candidate !== 'string' || !UUID_V7_REGEX.test(candidate)) {
        errors.push(semanticError(`${path}/${id}`, 'd14Reference', 'identifier is not UUIDv7'));
      }
    }
    const scope = value.scope;
    if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
      errors.push(semanticError(`${path}/scope`, 'd14Reference', 'scope must be an object'));
      continue;
    }
    // Decoded JSON object; only the two declared scope members are read.
    const scopeRecord = scope as Record<string, unknown>;
    const projectId = scopeRecord.projectId;
    const enterpriseId = scopeRecord.enterpriseId;
    if (projectId !== undefined && projectId !== expected.projectId) {
      errors.push(
        semanticError(`${path}/scope`, 'd14Scope', 'reference crosses the locked project'),
      );
    }
    if (
      enterpriseId !== undefined &&
      expected.enterpriseId !== undefined &&
      enterpriseId !== expected.enterpriseId
    ) {
      errors.push(
        semanticError(`${path}/scope`, 'd14Scope', 'reference crosses the locked enterprise'),
      );
    }
  }
  return errors;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && right.every((item) => left.includes(item));
}

function missingBytesPinErrors(pin: D14PinnedRef, path: string): D14LockValidationError[] {
  return pin.bytesSha256 === undefined || !DIGEST_REGEX.test(pin.bytesSha256)
    ? [semanticError(path, 'd14Pin', 'missing the actual SHA-256 of the bytes this pin locks')]
    : [];
}

/**
 * Model/tool/control policy validator of the approved OMP + DeepSeek profile.
 * An unchanged API name without the fixed-version binding is not enough, empty
 * allowlists are required *and* distinct from missing ones, and the closed tool
 * surface plus the bounded control policy must match the approved selection.
 */
export function d14ConfigurationPolicyErrors(
  configuration: D14ApprovedConfiguration,
): D14LockValidationError[] {
  const errors: D14LockValidationError[] = [];
  const model = configuration.model;
  if (
    model.provider !== D14_RUNNER_APPROVED_MODEL.provider ||
    model.modelId !== D14_RUNNER_APPROVED_MODEL.modelId ||
    model.approvedModelVersion !== D14_RUNNER_APPROVED_MODEL.approvedModelVersion
  ) {
    errors.push(
      semanticError('/model', 'd14ModelVersion', 'model identity is not the approved selection'),
    );
  }
  if (!sameStringSet(configuration.toolSurface.allowedTools, [...D14_RUNNER_ALLOWED_TOOLS])) {
    errors.push(
      semanticError(
        '/toolSurface/allowedTools',
        'd14ToolSurface',
        'tool surface is not the closed read/grep/glob/write set',
      ),
    );
  }
  if (configuration.skillAllowlist.length > 0) {
    errors.push(
      semanticError('/skillAllowlist', 'd14ToolSurface', 'Skill allowlist must be empty'),
    );
  }
  if (configuration.mcpAllowlist.length > 0) {
    errors.push(semanticError('/mcpAllowlist', 'd14ToolSurface', 'MCP allowlist must be empty'));
  }
  for (const key of D14_RUNNER_DISABLED_CAPABILITIES) {
    if (configuration.disabledCapabilities[key] !== 'DISABLED') {
      errors.push(
        semanticError(
          `/disabledCapabilities/${key}`,
          'd14ToolSurface',
          `capability \`${key}\` must be DISABLED`,
        ),
      );
    }
  }
  if (
    !sameStringSet(configuration.controlPolicy.supportedControls, [
      ...D14_RUNNER_SUPPORTED_CONTROLS,
    ])
  ) {
    errors.push(
      semanticError(
        '/controlPolicy/supportedControls',
        'd14ControlPolicy',
        'supported control set is not the approved bounded set',
      ),
    );
  }
  if (
    !sameStringSet(configuration.controlPolicy.unsupportedControls, [
      ...D14_RUNNER_UNSUPPORTED_CONTROLS,
    ])
  ) {
    errors.push(
      semanticError(
        '/controlPolicy/unsupportedControls',
        'd14ControlPolicy',
        'rejected control set is not the approved bounded set',
      ),
    );
  }
  return errors;
}

function lockSemanticErrors(lock: D14MaterializedLockPayload): D14LockValidationError[] {
  const errors: D14LockValidationError[] = customerAndSecretErrors(lock);
  const expectedScope = lock.boundary.scope.project.ref.scope;
  errors.push(...referenceErrors(collectCanonicalReferences(lock), expectedScope));

  if (
    expectedScope.enterpriseId === undefined ||
    expectedScope.projectId === undefined ||
    lock.boundary.scope.enterprise.ref.scope.enterpriseId !== expectedScope.enterpriseId ||
    lock.boundary.scope.enterprise.ref.scope.projectId !== undefined
  ) {
    errors.push(
      semanticError(
        '/boundary/scope',
        'd14Scope',
        'the lock must carry one exact enterprise/project scope',
      ),
    );
  }

  errors.push(...missingBytesPinErrors(lock.promptTools.systemPrompt, '/promptTools/systemPrompt'));
  errors.push(...missingBytesPinErrors(lock.promptTools.taskPrompt, '/promptTools/taskPrompt'));
  errors.push(...missingBytesPinErrors(lock.templates.vocabulary, '/templates/vocabulary'));
  lock.templates.templateRefs.forEach((pin, index) => {
    errors.push(...missingBytesPinErrors(pin, `/templates/templateRefs/${index}`));
    if (pin.publicationReceiptRef === undefined) {
      errors.push(
        semanticError(
          `/templates/templateRefs/${index}`,
          'd14Pin',
          'a template must carry its PUBLISHED publication receipt',
        ),
      );
    }
  });
  if (lock.templates.ruleBundle.publicationReceiptRef === undefined) {
    errors.push(
      semanticError(
        '/templates/ruleBundle',
        'd14Pin',
        'the rule bundle must carry its PUBLISHED publication receipt',
      ),
    );
  }

  if (lock.promptTools.skillAllowlist.length > 0) {
    errors.push(
      semanticError(
        '/promptTools/skillAllowlist',
        'd14ToolSurface',
        'Skill allowlist must be empty',
      ),
    );
  }
  if (lock.promptTools.mcpAllowlist.length > 0) {
    errors.push(
      semanticError('/promptTools/mcpAllowlist', 'd14ToolSurface', 'MCP allowlist must be empty'),
    );
  }
  if (!sameStringSet(lock.promptTools.toolAllowlist, [...D14_RUNNER_ALLOWED_TOOLS])) {
    errors.push(
      semanticError(
        '/promptTools/toolAllowlist',
        'd14ToolSurface',
        'tool surface is not the closed read/grep/glob/write set',
      ),
    );
  }
  for (const key of D14_RUNNER_DISABLED_CAPABILITIES) {
    if (lock.promptTools.disabledCapabilities[key] !== 'DISABLED') {
      errors.push(
        semanticError(
          `/promptTools/disabledCapabilities/${key}`,
          'd14ToolSurface',
          `capability \`${key}\` must be DISABLED`,
        ),
      );
    }
  }

  if (
    lock.boundary.phase === 'INITIAL_SCOPE_RECOVERY' &&
    lock.boundary.frozenStartRef === undefined
  ) {
    errors.push(
      semanticError(
        '/boundary/frozenStartRef',
        'd14Binding',
        'INITIAL_SCOPE_RECOVERY requires the frozen PROJECT_START binding',
      ),
    );
  }
  if (lock.boundary.phase === 'PREPARING' && lock.boundary.frozenStartRef !== undefined) {
    errors.push(
      semanticError(
        '/boundary/frozenStartRef',
        'd14Binding',
        'PREPARING must not carry a frozen start binding',
      ),
    );
  }
  const issuedOrder = compareUtcInstants(lock.boundary.issuedAt, lock.boundary.validUntil);
  if (issuedOrder === undefined || issuedOrder >= 0) {
    errors.push(
      semanticError('/boundary/validUntil', 'd14Binding', 'validity interval is empty or inverted'),
    );
  }
  return errors;
}

function rejectionCodeFor(errors: readonly D14LockValidationError[]): D14LockRejectionCode {
  const keyword = errors[0]?.keyword;
  if (keyword === undefined) return 'D14_LOCK_SCHEMA_INVALID';
  return REJECTION_CODE_BY_KEYWORD[keyword] ?? 'D14_LOCK_SCHEMA_INVALID';
}

/** Validate one approved-configuration layer, including its policy set. */
export function validateApprovedConfiguration(input: unknown): D14LockValidationResult {
  const structural = schemaErrors(approvedConfigurationValidator, input, 'approved configuration');
  if (structural.length > 0) return { valid: false, errors: structural };
  const errors = [
    ...d14ConfigurationPolicyErrors(input as D14ApprovedConfiguration),
    ...customerAndSecretErrors(input),
  ];
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Validate one installation-observation layer. */
export function validateInstallationObservation(input: unknown): D14LockValidationResult {
  const structural = schemaErrors(
    installationObservationValidator,
    input,
    'installation observation',
  );
  return structural.length === 0 ? { valid: true } : { valid: false, errors: structural };
}

/** Structural, reference, pin, scope and identity validation of a complete lock. */
export function validateMaterializedLock(input: unknown): D14LockValidationResult {
  const structural = schemaErrors(materializedLockValidator, input, 'materialized lock');
  if (structural.length > 0) return { valid: false, errors: structural };
  const lock = input as D14MaterializedLock;
  const errors = lockSemanticErrors(lock);
  if (!verifyD14MaterializedLockHash(lock)) {
    errors.push(
      semanticError(
        '/lockHash',
        'd14LockHash',
        'the declared lockHash does not sign the current payload',
      ),
    );
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function contentHashOf(value: unknown): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: sha256CanonicalJson(value as CanonicalJsonValue),
  };
}

function hashExcluding(value: object, excluded: string): Common.ContentHash {
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded));
  return contentHashOf(payload);
}

/**
 * `SHA-256(cv1(payload))` of the lock, excluding the lock's own `lockHash`. The
 * configuration/observation/review/approval bindings stay inside the signed
 * domain; an approval record never enters its own signed hash.
 */
export function d14MaterializedLockHash(payload: D14MaterializedLockPayload): Common.ContentHash {
  return hashExcluding(payload, 'lockHash');
}

/** Approved-configuration identity, excluding its own `configurationHash`. */
export function d14ApprovedConfigurationHash(
  configuration: D14ApprovedConfiguration,
): Common.ContentHash {
  return hashExcluding(configuration, 'configurationHash');
}

/** Installation-observation identity, excluding its own `observationHash`. */
export function d14InstallationObservationHash(
  observation: D14InstallationObservation,
): Common.ContentHash {
  return hashExcluding(observation, 'observationHash');
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Recompute the lock identity: a tampered or stale `lockHash` fails closed. */
export function verifyD14MaterializedLockHash(lock: D14MaterializedLock): boolean {
  const { lockHash, ...payload } = lock;
  return lockHash.digest === d14MaterializedLockHash(payload).digest;
}

/**
 * Deterministic producer of one complete, admissible `d14.runner_execution_lock`
 * from the three separated layers and one trusted instant. Every rejection is a
 * `D14LockRejection`; no partial lock is returned, no missing deployment fact is
 * invented, and a configuration choice or Darwin observation can never stand in
 * for deployment evidence.
 */
export function produceD14RunnerExecutionLock(input: D14LockProductionInput): D14MaterializedLock {
  const configurationResult = validateApprovedConfiguration(input.approvedConfiguration);
  if (!configurationResult.valid) {
    throw new D14LockRejection(
      rejectionCodeFor(configurationResult.errors),
      configurationResult.errors.map((error) => `configuration${error.path}: ${error.message}`),
    );
  }
  const configuration = input.approvedConfiguration as D14ApprovedConfiguration;

  const observationResult = validateInstallationObservation(input.installationObservation);
  if (!observationResult.valid) {
    throw new D14LockRejection(
      'D14_LOCK_SCHEMA_INVALID',
      observationResult.errors.map((error) => `observation${error.path}: ${error.message}`),
    );
  }
  const observation = input.installationObservation as D14InstallationObservation;

  if (
    configuration.configurationHash.digest !== d14ApprovedConfigurationHash(configuration).digest
  ) {
    throw new D14LockRejection('D14_LOCK_LAYER_HASH_MISMATCH', ['approved configuration hash']);
  }
  if (observation.observationHash.digest !== d14InstallationObservationHash(observation).digest) {
    throw new D14LockRejection('D14_LOCK_LAYER_HASH_MISMATCH', ['installation observation hash']);
  }

  const candidatePayload = input.lockPayload;
  if (
    candidatePayload !== null &&
    typeof candidatePayload === 'object' &&
    'lockVersion' in candidatePayload &&
    candidatePayload.lockVersion !== D14_RUNNER_EXECUTION_LOCK_VERSION
  ) {
    throw new D14LockRejection('D14_LOCK_VERSION_UNSUPPORTED', [
      `expected lock version ${D14_RUNNER_EXECUTION_LOCK_VERSION}`,
    ]);
  }

  const payloadErrors = schemaErrors(lockPayloadValidator, input.lockPayload, 'lock payload');
  if (payloadErrors.length > 0) {
    throw new D14LockRejection(
      'D14_LOCK_SCHEMA_INVALID',
      payloadErrors.map((error) => `lock${error.path}: ${error.message}`),
    );
  }
  const payload = input.lockPayload as D14MaterializedLockPayload;
  const semanticErrors = lockSemanticErrors(payload);
  if (semanticErrors.length > 0) {
    throw new D14LockRejection(
      rejectionCodeFor(semanticErrors),
      semanticErrors.map((error) => `lock${error.path}: ${error.message}`),
    );
  }

  const reasons: string[] = [];
  if (
    payload.identity.approvedConfigurationHash.digest !== configuration.configurationHash.digest
  ) {
    reasons.push('identity.approvedConfigurationHash does not bind the approved configuration');
  }
  if (payload.identity.approvedConfigurationVersion !== configuration.configurationVersion) {
    reasons.push('identity.approvedConfigurationVersion does not match the configuration');
  }
  if (payload.identity.installationObservationHash.digest !== observation.observationHash.digest) {
    reasons.push('identity.installationObservationHash does not bind the observation');
  }
  if (payload.identity.installationObservationId !== observation.observationId) {
    reasons.push('identity.installationObservationId does not match the observation');
  }
  if (payload.identity.reviewedRevision !== configuration.reviewedRevision) {
    reasons.push('identity.reviewedRevision does not match the approved configuration');
  }
  for (const [field, expected] of [
    ['selectionEvidence', configuration.selectionEvidence],
    ['designReview', configuration.designReview],
    ['technicalApproval', configuration.technicalApproval],
  ] as const) {
    if (payload.identity[field].contentHash.digest !== expected.contentHash.digest) {
      reasons.push(`identity.${field} does not bind the approved ${field} evidence`);
    }
  }
  if (
    payload.runtime.executableCode !== observation.cli.executableCode ||
    payload.runtime.resolvedExecutablePath !== observation.cli.resolvedExecutablePath ||
    payload.runtime.observedCliVersion !== observation.cli.observedCliVersion ||
    payload.runtime.cliBinarySha256 !== observation.cli.cliBinarySha256
  ) {
    reasons.push('runtime CLI pins do not match the installation observation');
  }
  if (
    payload.runtime.adapterCode !== observation.adapter.adapterCode ||
    payload.runtime.adapterVersion !== observation.adapter.adapterVersion ||
    payload.runtime.adapterSourceSha256 !== observation.adapter.sourceSha256 ||
    payload.runtime.adapterBuildSha256 !== observation.adapter.buildSha256 ||
    payload.runtime.harnessId !== observation.harness.harnessId ||
    payload.runtime.harnessVersion !== observation.harness.harnessVersion
  ) {
    reasons.push('adapter/harness pins do not match the installation observation');
  }
  if (
    payload.runtime.hostOsRelease !== observation.platform.osRelease ||
    payload.runtime.hostKernelVersion !== observation.platform.kernelVersion ||
    payload.runtime.hostArchitecture !== observation.platform.architecture
  ) {
    reasons.push('Host pins do not match the installation observation');
  }
  if (reasons.length > 0) throw new D14LockRejection('D14_LOCK_BINDING_MISMATCH', reasons);

  if (observation.platform.osFamily !== 'linux') {
    throw new D14LockRejection('D14_LOCK_OBSERVATION_NOT_DEPLOYMENT', [
      'a non-deployment observation cannot materialize the Ubuntu runnable lock',
    ]);
  }

  if (parseUtcInstant(input.trustedNow) === undefined) {
    throw new D14LockRejection('D14_LOCK_ELIGIBILITY_FAILED', ['trusted instant is not parseable']);
  }
  const issuedOrder = compareUtcInstants(payload.boundary.issuedAt, input.trustedNow);
  const expiryOrder = compareUtcInstants(input.trustedNow, payload.boundary.validUntil);
  if (
    issuedOrder === undefined ||
    expiryOrder === undefined ||
    issuedOrder > 0 ||
    expiryOrder >= 0
  ) {
    throw new D14LockRejection('D14_LOCK_ELIGIBILITY_FAILED', [
      'trusted instant is outside [issuedAt, validUntil)',
    ]);
  }

  const lock: D14MaterializedLock = { ...payload, lockHash: d14MaterializedLockHash(payload) };
  if (!verifyD14MaterializedLockHash(lock)) {
    throw new D14LockRejection('D14_LOCK_LAYER_HASH_MISMATCH', ['produced lock hash']);
  }
  return freezeDeep(lock);
}

/**
 * Keep the descriptor internal: it must never appear as a public operation or a
 * registered selector that a synthetic-only Query could resolve.
 */
export function assertD14RunnerLockIsInternalDescriptor(
  operations: readonly { readonly type: string; readonly version: string }[],
): void {
  if (operations.some((operation) => operation.type === D14_RUNNER_EXECUTION_LOCK_TYPE)) {
    throw new Error('d14.runner_execution_lock must not be registered as a public operation');
  }
}

/** Stable, non-registered descriptor identity of the internal lock. */
export function d14RunnerExecutionLockDescriptor(): {
  readonly type: string;
  readonly version: string;
  readonly profileCode: string;
  readonly publicOperation: false;
  readonly registeredTypedReference: false;
} {
  return {
    type: D14_RUNNER_EXECUTION_LOCK_TYPE,
    version: D14_RUNNER_EXECUTION_LOCK_VERSION,
    profileCode: D14_RUNNER_PROFILE_CODE,
    publicOperation: false,
    registeredTypedReference: false,
  };
}
