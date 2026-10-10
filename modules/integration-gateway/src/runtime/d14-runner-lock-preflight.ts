import { validateMaterializedLock } from '@zhiju/contracts';
import type {
  Common,
  D14CanonicalRef,
  D14MaterializedLock,
  D14PinnedRef,
  D14PolicyKey,
  D14ToolPin,
} from '@zhiju/contracts';

// =============================================================================
// D14 Runner lock materialization preflight (Issue #264, Draft slice)
// =============================================================================
//
// The boundary between "a lock descriptor exists" and "a lock may be
// materialized for execution". It is a pure function over caller-supplied
// trusted readbacks: it never reads the filesystem, the database or the
// environment, never synthesizes a missing fact and never rewrites a pin. The
// caller owns every readback; this module owns only the admission decision.
//
// Every readback carries the *complete* canonical reference it claims, so a
// same-digest value under a different identity can never satisfy a pin. The
// rejection surface is deliberately split so an operator can tell *why* a
// materialization is refused: a missing owning readback, placeholder/floating
// evidence, a copied historic record, an expired lock window, or a real
// identity/value mismatch against the pins the lock already committed to.
// =============================================================================

/** Rejection codes of the materialization preflight boundary. */
export type D14PreflightRejectionCode =
  | 'D14_PREFLIGHT_LOCK_INVALID'
  | 'D14_PREFLIGHT_LOCK_NOT_ELIGIBLE'
  | 'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING'
  | 'D14_PREFLIGHT_IO_PINS_MISSING'
  | 'D14_PREFLIGHT_PUBLICATION_MISSING'
  | 'D14_PREFLIGHT_TOOL_PINS_MISSING'
  | 'D14_PREFLIGHT_DEPLOYMENT_EVIDENCE_MISSING'
  | 'D14_PREFLIGHT_PROVIDER_VERSION_BINDING_MISSING'
  | 'D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING'
  | 'D14_PREFLIGHT_EVIDENCE_MISMATCH'
  | 'D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED'
  | 'D14_PREFLIGHT_FLOATING_ALIAS_REJECTED'
  | 'D14_PREFLIGHT_EVIDENCE_NOT_CURRENT'
  | 'D14_PREFLIGHT_DATA_AUTHORIZATION_EXPIRED';

/** Scope anchor of a trusted readback: both members absent or both present. */
export interface D14TrustedScope {
  readonly enterpriseId?: string;
  readonly projectId?: string;
}

/** The complete canonical reference a readback claims, mirroring the lock's ref. */
export interface D14TrustedRef {
  readonly kind: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly versionId?: string;
  readonly snapshotId?: string;
  readonly immutableVersionId?: string;
  readonly scope: D14TrustedScope;
  /** Present exactly when the trusted kind is content-addressed or a snapshot. */
  readonly contentDigest?: string;
}

/** One published fact read back from its owning registry. */
export interface D14TrustedFact {
  readonly ref: D14TrustedRef;
  readonly contentDigest: string;
  readonly bytesSha256?: string;
  readonly publicationReceiptRef?: D14TrustedRef;
  readonly provenance: 'PUBLISHED';
}

/** One trusted v0.2 evidence-tool pin read back from its build record. */
export interface D14TrustedToolPin {
  readonly toolCode: string;
  readonly version: string;
  readonly bytesSha256: string;
  readonly buildSha256: string;
  readonly codeRef: D14TrustedRef;
  readonly runtime: { readonly runtimeCode: string; readonly runtimeVersion: string };
  readonly dependencyLockBytesSha256: string;
  readonly commandTemplate: string;
  readonly provenance: 'V0_2';
}

/** Trusted observation of the deployment environment the lock targets. */
export interface D14TrustedDeploymentEvidence {
  readonly hostImageDigest: string;
  readonly osRelease: string;
  readonly kernelVersion: string;
  readonly architecture: string;
  readonly executableCode: string;
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
  readonly launcherVersion: string;
  readonly launcherDigest: string;
  readonly parserVersion: string;
  readonly parserDigest: string;
  readonly provenance: 'DEPLOYMENT';
}

/** One shared readback of a pinned object: complete ref plus its content. */
export interface D14TrustedPinnedRef {
  readonly ref: D14TrustedRef;
  readonly contentDigest: string;
  readonly bytesSha256?: string;
  readonly publicationReceiptRef?: D14TrustedRef;
}

/** Trusted provider/model version binding observation. */
export interface D14TrustedProviderBinding {
  readonly provider: string;
  readonly modelId: string;
  readonly approvedModelVersion: string;
  readonly modelConfigDigest: string;
  readonly fixedVersionBinding: D14TrustedPinnedRef;
  readonly perInvocationVerificationRule: D14TrustedPinnedRef;
  readonly identityBindingPolicy: D14TrustedPinnedRef;
  readonly apiTransport: D14TrustedPinnedRef;
  readonly apiEndpoint: D14TrustedPinnedRef;
  readonly networkPolicy: D14TrustedPinnedRef;
  readonly provenance: 'PROVIDER';
}

/** Trusted customer data-authorization observation. */
export interface D14TrustedDataAuthorization {
  readonly approvalRefId: string;
  readonly dataPolicy: D14TrustedPinnedRef;
  readonly validUntil: string;
  readonly provenance: 'CUSTOMER';
}

/** One trusted published boundary-policy fact (isolation/network/data policy). */
export interface D14TrustedPolicyEvidence {
  readonly ref: D14TrustedRef;
  readonly contentDigest: string;
  readonly version: string;
  readonly provenance: 'PUBLISHED';
}

/** The five owning input/output objects a lock pins in `outputTools`. */
export type D14InputOutputSlot =
  | 'preparationSource'
  | 'preparationContext'
  | 'outputProfile'
  | 'outputSchema'
  | 'inputAliasManifest';

/** One trusted readback of an owning input/output object. */
export interface D14TrustedOwningObject {
  readonly ref: D14TrustedRef;
  readonly contentDigest: string;
  readonly version: string;
  readonly bytesSha256?: string;
  readonly provenance: 'OWNING';
}

/** One trusted readback of an owning prompt/tool-permission object. */
export interface D14TrustedPromptReadback {
  readonly ref: D14TrustedRef;
  readonly contentDigest: string;
  readonly version: string;
  readonly bytesSha256?: string;
  readonly provenance: 'OWNING';
}

/** Trusted readbacks of the locked prompt/tool-permission surface. */
export interface D14TrustedPromptTools {
  readonly systemPrompt: D14TrustedPromptReadback;
  readonly taskPrompt: D14TrustedPromptReadback;
  readonly effectiveSettingsDigest: string;
  readonly toolPermissionRules: D14TrustedPromptReadback;
}

/** Every member is `undefined` when the owning readback does not exist yet. */
export interface D14MaterializationSources {
  readonly policies: Readonly<Record<string, D14TrustedPolicyEvidence>> | undefined;
  readonly inputOutputPins:
    Readonly<Record<D14InputOutputSlot, D14TrustedOwningObject>> | undefined;
  readonly promptTools: D14TrustedPromptTools | undefined;
  readonly templates: readonly D14TrustedFact[] | undefined;
  readonly ruleBundle: D14TrustedFact | undefined;
  readonly startupRules: D14TrustedFact | undefined;
  readonly vocabulary: D14TrustedFact | undefined;
  readonly evidenceTools: readonly D14TrustedToolPin[] | undefined;
  readonly deployment: D14TrustedDeploymentEvidence | undefined;
  readonly providerVersionBinding: D14TrustedProviderBinding | undefined;
  readonly customerDataAuthorization: D14TrustedDataAuthorization | undefined;
}

export interface D14PreflightInput {
  readonly lock: unknown;
  readonly sources: D14MaterializationSources;
  readonly trustedNow: string;
}

export type D14PreflightResult =
  | { readonly admissible: true; readonly lock: D14MaterializedLock }
  | {
      readonly admissible: false;
      readonly code: D14PreflightRejectionCode;
      readonly reasons: readonly string[];
    };

const DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNIFORM_TEXT_PATTERN = /^(.)\1*$/u;
const SHA256_PREFIX = 'sha256:';
const ZERO_DIGEST = '0'.repeat(64);
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const LATEST_SEGMENT_PATTERN = /(?:^|[._])latest(?:[._]|$)/u;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** Versions that name a moving target rather than one published revision. */
const FLOATING_VERSION_ALIASES: readonly string[] = ['', 'latest', 'main', 'head', '*'];

// Declared `string` on purpose: the runtime provenance check must stay
// reachable even though the interfaces narrow each field to its own literal.
const PUBLISHED_PROVENANCE = 'PUBLISHED' as string;
const TOOL_PIN_PROVENANCE = 'V0_2' as string;
const DEPLOYMENT_PROVENANCE = 'DEPLOYMENT' as string;
const PROVIDER_PROVENANCE = 'PROVIDER' as string;
const CUSTOMER_PROVENANCE = 'CUSTOMER' as string;
const OWNING_PROVENANCE = 'OWNING' as string;

interface EvidenceDiagnostics {
  readonly placeholder: readonly string[];
  readonly floating: readonly string[];
  readonly stale: readonly string[];
}

/** Scan every provided fact for placeholder, floating-alias and stale evidence. */
function collectEvidenceDiagnostics(sources: D14MaterializationSources): EvidenceDiagnostics {
  const placeholder: string[] = [];
  const floating: string[] = [];
  const stale: string[] = [];

  const inspectDigest = (path: string, value: string | undefined): void => {
    if (value === undefined) return;
    const hex = value.startsWith(SHA256_PREFIX) ? value.slice(SHA256_PREFIX.length) : value;
    if (!DIGEST_HEX_PATTERN.test(hex) || UNIFORM_TEXT_PATTERN.test(hex) || hex === ZERO_DIGEST) {
      placeholder.push(`${path} is not a distinct 64-character lowercase-hex digest.`);
    }
  };
  const inspectIdentifier = (path: string, value: string): void => {
    if (!UUID_V7_PATTERN.test(value)) {
      placeholder.push(`${path} is not a UUIDv7 identifier.`);
    }
  };
  const inspectVersion = (path: string, value: string | undefined): void => {
    if (value === undefined) return;
    if (FLOATING_VERSION_ALIASES.includes(value) || value.includes('latest')) {
      floating.push(`${path} is a floating version alias, not an exact published version.`);
    }
  };
  const inspectNamespace = (path: string, value: string | undefined): void => {
    if (value === undefined) return;
    if (!NAMESPACE_PATTERN.test(value)) {
      placeholder.push(`${path} is not a registered-shape namespace code.`);
    }
  };
  const inspectKey = (path: string, value: string): void => {
    if (LATEST_SEGMENT_PATTERN.test(value)) {
      floating.push(`${path} resolves by a floating alias rather than an exact key.`);
    }
  };
  const inspectProvenance = (path: string, value: string, expected: string): void => {
    if (value !== expected) {
      stale.push(`${path} carries provenance '${value}', not current '${expected}' evidence.`);
    }
  };
  const inspectRef = (path: string, ref: D14TrustedRef): void => {
    inspectKey(`${path}.objectType`, ref.objectType);
    inspectIdentifier(`${path}.objectId`, ref.objectId);
    inspectDigest(`${path}.contentDigest`, ref.contentDigest);
    if (ref.versionId !== undefined) inspectVersion(`${path}.versionId`, ref.versionId);
    if (ref.snapshotId !== undefined) inspectIdentifier(`${path}.snapshotId`, ref.snapshotId);
    if (ref.immutableVersionId !== undefined) {
      inspectIdentifier(`${path}.immutableVersionId`, ref.immutableVersionId);
    }
  };
  const inspectPinnedRef = (path: string, readback: D14TrustedPinnedRef): void => {
    inspectRef(`${path}.ref`, readback.ref);
    inspectDigest(`${path}.contentDigest`, readback.contentDigest);
    inspectDigest(`${path}.bytesSha256`, readback.bytesSha256);
    if (readback.publicationReceiptRef) {
      inspectRef(`${path}.publicationReceiptRef`, readback.publicationReceiptRef);
    }
  };
  const inspectFact = (path: string, fact: D14TrustedFact): void => {
    inspectPinnedRef(path, fact);
    inspectProvenance(`${path}.provenance`, fact.provenance, PUBLISHED_PROVENANCE);
  };
  const inspectReadback = (
    path: string,
    readback: D14TrustedOwningObject | D14TrustedPromptReadback,
  ): void => {
    inspectPinnedRef(path, readback);
    inspectVersion(`${path}.version`, readback.version);
    inspectProvenance(`${path}.provenance`, readback.provenance, OWNING_PROVENANCE);
  };

  Object.entries(sources.policies ?? {}).forEach(([key, evidence]) => {
    const path = `sources.policies.${key}`;
    inspectRef(`${path}.ref`, evidence.ref);
    inspectDigest(`${path}.contentDigest`, evidence.contentDigest);
    inspectVersion(`${path}.version`, evidence.version);
    inspectProvenance(`${path}.provenance`, evidence.provenance, PUBLISHED_PROVENANCE);
  });

  Object.entries(sources.inputOutputPins ?? {}).forEach(([key, owning]) => {
    inspectReadback(`sources.inputOutputPins.${key}`, owning);
  });

  if (sources.promptTools !== undefined) {
    inspectReadback('sources.promptTools.systemPrompt', sources.promptTools.systemPrompt);
    inspectReadback('sources.promptTools.taskPrompt', sources.promptTools.taskPrompt);
    inspectReadback(
      'sources.promptTools.toolPermissionRules',
      sources.promptTools.toolPermissionRules,
    );
    inspectDigest(
      'sources.promptTools.effectiveSettingsDigest',
      sources.promptTools.effectiveSettingsDigest,
    );
  }

  sources.templates?.forEach((fact, index) => {
    inspectFact(`sources.templates[${index}]`, fact);
  });
  if (sources.ruleBundle !== undefined) inspectFact('sources.ruleBundle', sources.ruleBundle);
  if (sources.startupRules !== undefined) inspectFact('sources.startupRules', sources.startupRules);
  if (sources.vocabulary !== undefined) inspectFact('sources.vocabulary', sources.vocabulary);

  sources.evidenceTools?.forEach((pin, index) => {
    const path = `sources.evidenceTools[${index}]`;
    inspectRef(`${path}.codeRef`, pin.codeRef);
    inspectDigest(`${path}.bytesSha256`, pin.bytesSha256);
    inspectDigest(`${path}.buildSha256`, pin.buildSha256);
    inspectDigest(`${path}.dependencyLockBytesSha256`, pin.dependencyLockBytesSha256);
    inspectKey(`${path}.toolCode`, pin.toolCode);
    inspectVersion(`${path}.version`, pin.version);
    inspectProvenance(`${path}.provenance`, pin.provenance, TOOL_PIN_PROVENANCE);
  });

  if (sources.deployment !== undefined) {
    const deployment = sources.deployment;
    inspectDigest('sources.deployment.hostImageDigest', deployment.hostImageDigest);
    inspectDigest('sources.deployment.cliBinarySha256', deployment.cliBinarySha256);
    inspectDigest('sources.deployment.cliBuildSha256', deployment.cliBuildSha256);
    inspectDigest(
      'sources.deployment.cliDependencyLockBytesSha256',
      deployment.cliDependencyLockBytesSha256,
    );
    inspectDigest('sources.deployment.adapterSourceSha256', deployment.adapterSourceSha256);
    inspectDigest('sources.deployment.adapterBuildSha256', deployment.adapterBuildSha256);
    inspectNamespace('sources.deployment.adapterCode', deployment.adapterCode);
    inspectVersion('sources.deployment.adapterVersion', deployment.adapterVersion);
    inspectNamespace('sources.deployment.harnessId', deployment.harnessId);
    inspectVersion('sources.deployment.harnessVersion', deployment.harnessVersion);
    inspectDigest('sources.deployment.launcherDigest', deployment.launcherDigest);
    inspectDigest('sources.deployment.parserDigest', deployment.parserDigest);
    inspectProvenance(
      'sources.deployment.provenance',
      deployment.provenance,
      DEPLOYMENT_PROVENANCE,
    );
  }

  if (sources.providerVersionBinding !== undefined) {
    const binding = sources.providerVersionBinding;
    inspectDigest('sources.providerVersionBinding.modelConfigDigest', binding.modelConfigDigest);
    inspectPinnedRef(
      'sources.providerVersionBinding.fixedVersionBinding',
      binding.fixedVersionBinding,
    );
    inspectPinnedRef(
      'sources.providerVersionBinding.perInvocationVerificationRule',
      binding.perInvocationVerificationRule,
    );
    inspectPinnedRef(
      'sources.providerVersionBinding.identityBindingPolicy',
      binding.identityBindingPolicy,
    );
    inspectPinnedRef('sources.providerVersionBinding.apiTransport', binding.apiTransport);
    inspectPinnedRef('sources.providerVersionBinding.apiEndpoint', binding.apiEndpoint);
    inspectPinnedRef('sources.providerVersionBinding.networkPolicy', binding.networkPolicy);
    inspectProvenance(
      'sources.providerVersionBinding.provenance',
      binding.provenance,
      PROVIDER_PROVENANCE,
    );
  }

  if (sources.customerDataAuthorization !== undefined) {
    inspectPinnedRef(
      'sources.customerDataAuthorization.dataPolicy',
      sources.customerDataAuthorization.dataPolicy,
    );
    inspectProvenance(
      'sources.customerDataAuthorization.provenance',
      sources.customerDataAuthorization.provenance,
      CUSTOMER_PROVENANCE,
    );
  }

  return { placeholder, floating, stale };
}

function scopeMatches(trusted: D14TrustedScope, locked: Common.ScopeRef): boolean {
  return trusted.enterpriseId === locked.enterpriseId && trusted.projectId === locked.projectId;
}

/** The complete identity of a trusted reference must equal the locked one. */
function refMatches(trusted: D14TrustedRef, locked: D14CanonicalRef): boolean {
  const lockedVersionId = 'versionId' in locked ? locked.versionId : undefined;
  const lockedSnapshotId = 'snapshotId' in locked ? locked.snapshotId : undefined;
  const lockedImmutableVersionId =
    'immutableVersionId' in locked ? locked.immutableVersionId : undefined;
  const lockedContentDigest = 'contentHash' in locked ? locked.contentHash.digest : undefined;
  return (
    trusted.kind === locked.kind &&
    trusted.objectType === locked.objectType &&
    trusted.objectId === locked.objectId &&
    trusted.versionId === lockedVersionId &&
    trusted.snapshotId === lockedSnapshotId &&
    trusted.immutableVersionId === lockedImmutableVersionId &&
    trusted.contentDigest === lockedContentDigest &&
    scopeMatches(trusted.scope, locked.scope)
  );
}

/**
 * The single comparison path for a readback claiming a pinned object: complete
 * ref identity, content digest, declared bytes and the declared receipt.
 */
function pinnedReadbackMatches(pin: D14PinnedRef, readback: D14TrustedPinnedRef): boolean {
  const receipt = readback.publicationReceiptRef;
  const receiptMatches =
    pin.publicationReceiptRef === undefined ||
    (receipt ? refMatches(receipt, pin.publicationReceiptRef) : false);
  const bytesMatch = pin.bytesSha256 === undefined || readback.bytesSha256 === pin.bytesSha256;
  return (
    receiptMatches &&
    bytesMatch &&
    refMatches(readback.ref, pin.ref) &&
    readback.contentDigest === pin.contentHash.digest
  );
}

function templateRefMatchesFact(pin: D14PinnedRef, fact: D14TrustedFact): boolean {
  return pinnedReadbackMatches(pin, fact);
}

/** Consume each template pin exactly once; reject both gaps and extras. */
function matchTemplateFacts(
  pins: readonly D14PinnedRef[],
  facts: readonly D14TrustedFact[],
  path: string,
  reasons: string[],
): void {
  const consumed: boolean[] = facts.map(() => false);
  pins.forEach((pin, pinIndex) => {
    const factIndex = facts.findIndex(
      (fact, index) => consumed[index] !== true && templateRefMatchesFact(pin, fact),
    );
    if (factIndex === -1) {
      reasons.push(`${path}[${pinIndex}] has no matching published fact.`);
      return;
    }
    consumed[factIndex] = true;
  });
  consumed.forEach((wasConsumed, factIndex) => {
    if (!wasConsumed) reasons.push(`${path} leaves published fact ${factIndex} unconsumed.`);
  });
}

function matchSingleFact(
  pin: D14PinnedRef,
  fact: D14TrustedFact,
  path: string,
  reasons: string[],
): void {
  if (!templateRefMatchesFact(pin, fact)) {
    reasons.push(`${path} does not match the published fact it pins.`);
  }
}

/** Compare one owning object readback against the pin the lock committed to. */
function matchOwningObject(
  pin: D14PinnedRef,
  readback: D14TrustedOwningObject | D14TrustedPromptReadback,
  path: string,
  reasons: string[],
): void {
  if (!pinnedReadbackMatches(pin, readback)) {
    reasons.push(`${path} does not match the pin it claims.`);
  }
}

function matchPolicyEvidence(
  pin: D14PinnedRef,
  evidence: D14TrustedPolicyEvidence,
  path: string,
  reasons: string[],
): void {
  if (!refMatches(evidence.ref, pin.ref) || evidence.contentDigest !== pin.contentHash.digest) {
    reasons.push(`${path} does not match the locked boundary policy.`);
  }
}

function matchToolPin(
  pin: D14ToolPin,
  slot: string,
  pins: readonly D14TrustedToolPin[],
  reasons: string[],
): void {
  const candidate = pins.find((trusted) => trusted.toolCode === pin.toolCode);
  if (candidate === undefined) {
    reasons.push(`${slot}: ${pin.toolCode} has no trusted evidence pin.`);
    return;
  }
  if (!candidate.version.startsWith('0.2.')) {
    reasons.push(`${slot}: trusted pin ${pin.toolCode}@${candidate.version} is not a v0.2 pin.`);
    return;
  }
  if (
    !refMatches(candidate.codeRef, pin.codeRef) ||
    candidate.version !== pin.toolVersion ||
    candidate.bytesSha256 !== pin.codeBytesSha256 ||
    candidate.buildSha256 !== pin.buildSha256 ||
    candidate.runtime.runtimeCode !== pin.runtime.runtimeCode ||
    candidate.runtime.runtimeVersion !== pin.runtime.runtimeVersion ||
    candidate.dependencyLockBytesSha256 !== pin.dependencyLockBytesSha256 ||
    candidate.commandTemplate !== pin.commandTemplate
  ) {
    reasons.push(`${slot}: ${pin.toolCode}@${pin.toolVersion} does not match its trusted pin.`);
  }
}

/** Source paths of readbacks a decoded source object did not carry, by `ref`. */
function absentRefPaths(
  entries: readonly (readonly [string, { readonly ref?: D14TrustedRef } | undefined])[],
): readonly string[] {
  const absent: string[] = [];
  for (const [path, readback] of entries) {
    if (!readback) {
      absent.push(path);
    } else if (!readback.ref) {
      absent.push(`${path}.ref`);
    }
  }
  return absent;
}

/** Source paths of tool pins whose `codeRef` a decoded source object did not carry. */
function absentCodeRefPaths(
  entries: readonly (readonly [string, Partial<D14TrustedToolPin> | undefined])[],
): readonly string[] {
  const absent: string[] = [];
  for (const [path, pin] of entries) {
    if (!pin) {
      absent.push(path);
    } else if (!pin.codeRef) {
      absent.push(`${path}.codeRef`);
    }
  }
  return absent;
}

function reject(code: D14PreflightRejectionCode, reasons: readonly string[]): D14PreflightResult {
  return { admissible: false, code, reasons };
}

/**
 * Decide whether one lock descriptor may be materialized from the caller's
 * trusted readbacks at one trusted instant. Pure and deterministic.
 */
export function preflightD14RunnerMaterialization(input: D14PreflightInput): D14PreflightResult {
  const validation = validateMaterializedLock(input.lock);
  if (!validation.valid) {
    return reject(
      'D14_PREFLIGHT_LOCK_INVALID',
      validation.errors.map((error) => `${error.path}: ${error.message}`),
    );
  }
  // The closed schema has accepted the value, so it is a lock without further checks.
  const lock = input.lock as D14MaterializedLock;

  const {
    policies,
    inputOutputPins,
    promptTools,
    templates,
    ruleBundle,
    startupRules,
    vocabulary,
    evidenceTools,
    deployment,
    providerVersionBinding,
    customerDataAuthorization,
  } = input.sources;

  if (policies === undefined || Object.keys(policies).length === 0) {
    return reject('D14_PREFLIGHT_POLICY_EVIDENCE_MISSING', [
      'sources.policies: no published boundary-policy evidence is available.',
    ]);
  }

  const ioSlots: readonly D14InputOutputSlot[] = [
    'preparationSource',
    'preparationContext',
    'outputProfile',
    'outputSchema',
    'inputAliasManifest',
  ];
  if (
    inputOutputPins === undefined ||
    Object.keys(inputOutputPins).length === 0 ||
    promptTools === undefined
  ) {
    const ioReasons: string[] = [];
    if (inputOutputPins === undefined || Object.keys(inputOutputPins).length === 0) {
      ioReasons.push(
        'sources.inputOutputPins: no trusted owning input/output readbacks are available.',
      );
    }
    if (promptTools === undefined) {
      ioReasons.push('sources.promptTools: no trusted prompt/tool-permission readbacks exist.');
    }
    return reject('D14_PREFLIGHT_IO_PINS_MISSING', ioReasons);
  }
  // Widen to an indexed map so an absent slot stays observable at runtime.
  const ioPins: Readonly<Record<string, D14TrustedOwningObject>> = inputOutputPins;
  const missingIoSlots = ioSlots.filter((slot) => ioPins[slot] === undefined);
  if (missingIoSlots.length > 0) {
    return reject(
      'D14_PREFLIGHT_IO_PINS_MISSING',
      missingIoSlots.map((slot) => `sources.inputOutputPins.${slot} is missing.`),
    );
  }

  if (
    templates === undefined ||
    templates.length === 0 ||
    ruleBundle === undefined ||
    startupRules === undefined ||
    vocabulary === undefined
  ) {
    const publicationReasons: string[] = [];
    if (templates === undefined || templates.length === 0) {
      publicationReasons.push('sources.templates: no published template facts are available.');
    }
    if (ruleBundle === undefined) {
      publicationReasons.push('sources.ruleBundle: the published rule bundle is unavailable.');
    }
    if (startupRules === undefined) {
      publicationReasons.push('sources.startupRules: the published startup rules are unavailable.');
    }
    if (vocabulary === undefined) {
      publicationReasons.push('sources.vocabulary: the published vocabulary is unavailable.');
    }
    return reject('D14_PREFLIGHT_PUBLICATION_MISSING', publicationReasons);
  }
  if (evidenceTools === undefined || evidenceTools.length === 0) {
    return reject('D14_PREFLIGHT_TOOL_PINS_MISSING', [
      'sources.evidenceTools: no trusted v0.2 evidence-tool pins are available.',
    ]);
  }
  if (deployment === undefined) {
    return reject('D14_PREFLIGHT_DEPLOYMENT_EVIDENCE_MISSING', [
      'sources.deployment: no deployment observation is available.',
    ]);
  }
  if (providerVersionBinding === undefined) {
    return reject('D14_PREFLIGHT_PROVIDER_VERSION_BINDING_MISSING', [
      'sources.providerVersionBinding: no provider version binding is available.',
    ]);
  }
  if (customerDataAuthorization === undefined) {
    return reject('D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING', [
      'sources.customerDataAuthorization: no customer data authorization is available.',
    ]);
  }

  // Presence of every nested readback and its claimed reference, checked before
  // any diagnostic or comparison dereferences a decoded source object.
  const providerPinEntries: readonly (readonly [string, D14TrustedPinnedRef | undefined])[] = [
    [
      'sources.providerVersionBinding.fixedVersionBinding',
      providerVersionBinding.fixedVersionBinding,
    ],
    [
      'sources.providerVersionBinding.perInvocationVerificationRule',
      providerVersionBinding.perInvocationVerificationRule,
    ],
    [
      'sources.providerVersionBinding.identityBindingPolicy',
      providerVersionBinding.identityBindingPolicy,
    ],
    ['sources.providerVersionBinding.apiTransport', providerVersionBinding.apiTransport],
    ['sources.providerVersionBinding.apiEndpoint', providerVersionBinding.apiEndpoint],
    ['sources.providerVersionBinding.networkPolicy', providerVersionBinding.networkPolicy],
  ];
  const absentProviderPins = absentRefPaths(providerPinEntries);
  if (absentProviderPins.length > 0) {
    return reject(
      'D14_PREFLIGHT_PROVIDER_VERSION_BINDING_MISSING',
      absentProviderPins.map((path) => `${path} is missing.`),
    );
  }

  const absentDataPolicy = absentRefPaths([
    ['sources.customerDataAuthorization.dataPolicy', customerDataAuthorization.dataPolicy],
  ]);
  if (absentDataPolicy.length > 0) {
    return reject(
      'D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING',
      absentDataPolicy.map((path) => `${path} is missing.`),
    );
  }

  const lockedPolicyKeys = Object.keys(lock.boundary.policies) as readonly D14PolicyKey[];
  const absentPolicies = absentRefPaths(
    lockedPolicyKeys.map((key) => [`sources.policies.${key}`, policies[key]] as const),
  );
  if (absentPolicies.length > 0) {
    return reject(
      'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING',
      absentPolicies.map((path) => `${path} is missing.`),
    );
  }

  const absentIoReadbacks = absentRefPaths([
    ...ioSlots.map((slot) => [`sources.inputOutputPins.${slot}`, ioPins[slot]] as const),
    ['sources.promptTools.systemPrompt', promptTools.systemPrompt],
    ['sources.promptTools.taskPrompt', promptTools.taskPrompt],
    ['sources.promptTools.toolPermissionRules', promptTools.toolPermissionRules],
  ]);
  if (absentIoReadbacks.length > 0) {
    return reject(
      'D14_PREFLIGHT_IO_PINS_MISSING',
      absentIoReadbacks.map((path) => `${path} is missing.`),
    );
  }

  const absentFacts = absentRefPaths([
    ...templates.map((fact, index) => [`sources.templates[${index}]`, fact] as const),
    ['sources.ruleBundle', ruleBundle],
    ['sources.startupRules', startupRules],
    ['sources.vocabulary', vocabulary],
  ]);
  if (absentFacts.length > 0) {
    return reject(
      'D14_PREFLIGHT_PUBLICATION_MISSING',
      absentFacts.map((path) => `${path} is missing.`),
    );
  }

  const absentToolPins = absentCodeRefPaths(
    evidenceTools.map((pin, index) => [`sources.evidenceTools[${index}]`, pin] as const),
  );
  if (absentToolPins.length > 0) {
    return reject(
      'D14_PREFLIGHT_TOOL_PINS_MISSING',
      absentToolPins.map((path) => `${path} is missing.`),
    );
  }

  const diagnostics = collectEvidenceDiagnostics(input.sources);
  if (diagnostics.placeholder.length > 0) {
    return reject('D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED', diagnostics.placeholder);
  }
  if (diagnostics.floating.length > 0) {
    return reject('D14_PREFLIGHT_FLOATING_ALIAS_REJECTED', diagnostics.floating);
  }
  if (diagnostics.stale.length > 0) {
    return reject('D14_PREFLIGHT_EVIDENCE_NOT_CURRENT', diagnostics.stale);
  }

  const reasons: string[] = [];

  for (const key of lockedPolicyKeys) {
    const evidence = policies[key];
    if (evidence === undefined) continue;
    matchPolicyEvidence(lock.boundary.policies[key], evidence, `sources.policies.${key}`, reasons);
  }
  for (const key of Object.keys(policies)) {
    if (!(lockedPolicyKeys as readonly string[]).includes(key)) {
      reasons.push(`sources.policies.${key} has no locked boundary policy slot.`);
    }
  }

  for (const slot of ioSlots) {
    const owning = ioPins[slot];
    if (owning === undefined) continue;
    if (slot === 'inputAliasManifest') {
      const manifest = lock.outputTools.inputAliasManifest;
      if (
        !refMatches(owning.ref, manifest.schemaRef) ||
        owning.version !== manifest.schemaVersion ||
        owning.bytesSha256 !== manifest.bytesSha256
      ) {
        reasons.push('sources.inputOutputPins.inputAliasManifest does not match its lock pin.');
      }
      continue;
    }
    matchOwningObject(lock.outputTools[slot], owning, `sources.inputOutputPins.${slot}`, reasons);
  }
  for (const key of Object.keys(inputOutputPins)) {
    if (!(ioSlots as readonly string[]).includes(key)) {
      reasons.push(`sources.inputOutputPins.${key} has no locked output-tools slot.`);
    }
  }

  matchOwningObject(
    lock.promptTools.systemPrompt,
    promptTools.systemPrompt,
    'sources.promptTools.systemPrompt',
    reasons,
  );
  matchOwningObject(
    lock.promptTools.taskPrompt,
    promptTools.taskPrompt,
    'sources.promptTools.taskPrompt',
    reasons,
  );
  if (promptTools.effectiveSettingsDigest !== lock.promptTools.effectiveSettingsHash.digest) {
    reasons.push('sources.promptTools.effectiveSettingsDigest does not match the locked settings.');
  }
  matchOwningObject(
    lock.promptTools.toolPermissionRules,
    promptTools.toolPermissionRules,
    'sources.promptTools.toolPermissionRules',
    reasons,
  );

  matchTemplateFacts(lock.templates.templateRefs, templates, 'templates.templateRefs', reasons);
  matchSingleFact(lock.templates.ruleBundle, ruleBundle, 'templates.ruleBundle', reasons);
  matchSingleFact(lock.templates.startupRules, startupRules, 'templates.startupRules', reasons);
  matchSingleFact(lock.templates.vocabulary, vocabulary, 'templates.vocabulary', reasons);

  matchToolPin(lock.outputTools.reader, 'outputTools.reader', evidenceTools, reasons);
  matchToolPin(lock.outputTools.validator, 'outputTools.validator', evidenceTools, reasons);
  matchToolPin(lock.outputTools.renderer, 'outputTools.renderer', evidenceTools, reasons);

  const runtimePairs: readonly (readonly [string, string, string])[] = [
    ['runtime.executableCode', lock.runtime.executableCode, deployment.executableCode],
    [
      'runtime.resolvedExecutablePath',
      lock.runtime.resolvedExecutablePath,
      deployment.resolvedExecutablePath,
    ],
    ['runtime.observedCliVersion', lock.runtime.observedCliVersion, deployment.observedCliVersion],
    ['runtime.cliBinarySha256', lock.runtime.cliBinarySha256, deployment.cliBinarySha256],
    ['runtime.cliBuildSha256', lock.runtime.cliBuildSha256, deployment.cliBuildSha256],
    [
      'runtime.cliDependencyLockBytesSha256',
      lock.runtime.cliDependencyLockBytesSha256,
      deployment.cliDependencyLockBytesSha256,
    ],
    [
      'runtime.adapterSourceSha256',
      lock.runtime.adapterSourceSha256,
      deployment.adapterSourceSha256,
    ],
    ['runtime.adapterBuildSha256', lock.runtime.adapterBuildSha256, deployment.adapterBuildSha256],
    ['runtime.adapterCode', lock.runtime.adapterCode, deployment.adapterCode],
    ['runtime.adapterVersion', lock.runtime.adapterVersion, deployment.adapterVersion],
    ['runtime.harnessId', lock.runtime.harnessId, deployment.harnessId],
    ['runtime.harnessVersion', lock.runtime.harnessVersion, deployment.harnessVersion],
    ['runtime.hostImageDigest', lock.runtime.hostImageDigest, deployment.hostImageDigest],
    ['runtime.hostOsRelease', lock.runtime.hostOsRelease, deployment.osRelease],
    ['runtime.hostKernelVersion', lock.runtime.hostKernelVersion, deployment.kernelVersion],
    ['runtime.hostArchitecture', lock.runtime.hostArchitecture, deployment.architecture],
    ['runtime.launcherVersion', lock.runtime.launcherVersion, deployment.launcherVersion],
    ['runtime.launcherDigest', lock.runtime.launcherDigest, deployment.launcherDigest],
    ['runtime.parserVersion', lock.runtime.parserVersion, deployment.parserVersion],
    ['runtime.parserDigest', lock.runtime.parserDigest, deployment.parserDigest],
  ];
  for (const [path, locked, trusted] of runtimePairs) {
    if (locked !== trusted) reasons.push(`${path} does not match the deployment observation.`);
  }

  const modelReadbackPairs: readonly (readonly [string, D14PinnedRef, D14TrustedPinnedRef])[] = [
    [
      'sources.providerVersionBinding.fixedVersionBinding',
      lock.model.fixedVersionBinding,
      providerVersionBinding.fixedVersionBinding,
    ],
    [
      'sources.providerVersionBinding.perInvocationVerificationRule',
      lock.model.perInvocationVerificationRule,
      providerVersionBinding.perInvocationVerificationRule,
    ],
    [
      'sources.providerVersionBinding.identityBindingPolicy',
      lock.model.identityBindingPolicy,
      providerVersionBinding.identityBindingPolicy,
    ],
    [
      'sources.providerVersionBinding.apiTransport',
      lock.model.apiTransport,
      providerVersionBinding.apiTransport,
    ],
    [
      'sources.providerVersionBinding.apiEndpoint',
      lock.model.apiEndpoint,
      providerVersionBinding.apiEndpoint,
    ],
    [
      'sources.providerVersionBinding.networkPolicy',
      lock.model.networkPolicy,
      providerVersionBinding.networkPolicy,
    ],
  ];
  for (const [path, pin, readback] of modelReadbackPairs) {
    if (!pinnedReadbackMatches(pin, readback)) {
      reasons.push(`${path} does not match the locked model pin.`);
    }
  }

  if (
    providerVersionBinding.provider !== lock.model.provider ||
    providerVersionBinding.modelId !== lock.model.modelId ||
    providerVersionBinding.approvedModelVersion !== lock.model.approvedModelVersion ||
    providerVersionBinding.modelConfigDigest !== lock.model.modelConfigHash.digest
  ) {
    reasons.push('sources.providerVersionBinding does not match the locked model identity.');
  }

  if (!pinnedReadbackMatches(lock.model.dataPolicy, customerDataAuthorization.dataPolicy)) {
    reasons.push('sources.customerDataAuthorization.dataPolicy does not match the locked policy.');
  }

  if (reasons.length > 0) return reject('D14_PREFLIGHT_EVIDENCE_MISMATCH', reasons);

  const issuedAtMs = Date.parse(lock.boundary.issuedAt);
  const validUntilMs = Date.parse(lock.boundary.validUntil);
  const trustedNowMs = Date.parse(input.trustedNow);
  if (
    !UTC_INSTANT_PATTERN.test(lock.boundary.issuedAt) ||
    !UTC_INSTANT_PATTERN.test(lock.boundary.validUntil) ||
    !UTC_INSTANT_PATTERN.test(input.trustedNow) ||
    Number.isNaN(issuedAtMs) ||
    Number.isNaN(validUntilMs) ||
    Number.isNaN(trustedNowMs)
  ) {
    return reject('D14_PREFLIGHT_LOCK_INVALID', [
      'lock.boundary.issuedAt, lock.boundary.validUntil or trustedNow is not a parseable UTC instant.',
    ]);
  }
  if (trustedNowMs < issuedAtMs || trustedNowMs >= validUntilMs) {
    return reject('D14_PREFLIGHT_LOCK_NOT_ELIGIBLE', [
      'trustedNow is outside the lock boundary window [issuedAt, validUntil).',
    ]);
  }

  const validUntilAuthorizationMs = Date.parse(customerDataAuthorization.validUntil);
  if (
    !UTC_INSTANT_PATTERN.test(customerDataAuthorization.validUntil) ||
    Number.isNaN(validUntilAuthorizationMs)
  ) {
    return reject('D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING', [
      'sources.customerDataAuthorization.validUntil is not a parseable UTC instant.',
    ]);
  }
  if (trustedNowMs >= validUntilAuthorizationMs) {
    return reject('D14_PREFLIGHT_DATA_AUTHORIZATION_EXPIRED', [
      'sources.customerDataAuthorization.validUntil is not after trustedNow.',
    ]);
  }

  return { admissible: true, lock };
}
