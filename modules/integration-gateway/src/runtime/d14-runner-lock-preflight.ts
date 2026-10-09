import { validateMaterializedLock } from '@zhiju/contracts';
import type {
  Common,
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
// The rejection surface is deliberately split so an operator can tell *why* a
// materialization is refused: a missing owning readback, placeholder/floating
// evidence, a copied historic record, an expired lock window, or a real value
// mismatch against the pins the lock already committed to.
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

/** One published fact read back from its owning registry. */
export interface D14TrustedFact {
  readonly registryKey: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly bytesSha256: string;
  readonly receiptRefId: string;
  readonly provenance: 'PUBLISHED';
}

/** One trusted v0.2 evidence-tool pin read back from its build record. */
export interface D14TrustedToolPin {
  readonly toolCode: string;
  readonly version: string;
  readonly bytesSha256: string;
  readonly buildSha256: string;
  readonly codeRef: {
    readonly kind: string;
    readonly objectType: string;
    readonly objectId: string;
    readonly scope: D14TrustedScope;
    readonly contentDigest: string;
  };
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
  readonly adapterSourceSha256: string;
  readonly adapterBuildSha256: string;
  readonly launcherVersion: string;
  readonly launcherDigest: string;
  readonly parserVersion: string;
  readonly parserDigest: string;
  readonly provenance: 'DEPLOYMENT';
}

/** Trusted provider/model version binding observation. */
export interface D14TrustedProviderBinding {
  readonly provider: string;
  readonly modelId: string;
  readonly approvedModelVersion: string;
  readonly fixedVersionDigest: string;
  readonly invocationVerificationDigest: string;
  readonly modelConfigDigest: string;
  readonly identityBindingPolicyDigest: string;
  readonly apiTransportDigest: string;
  readonly apiEndpointDigest: string;
  readonly networkPolicyDigest: string;
  readonly provenance: 'PROVIDER';
}

/** Trusted customer data-authorization observation. */
export interface D14TrustedDataAuthorization {
  readonly approvalRefId: string;
  readonly contentDigest: string;
  readonly validUntil: string;
  readonly provenance: 'CUSTOMER';
}

/** One trusted published boundary-policy fact (isolation/network/data policy). */
export interface D14TrustedPolicyEvidence {
  readonly registryKey: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly scope: D14TrustedScope;
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
  readonly registryKey: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly bytesSha256?: string;
  readonly scope: D14TrustedScope;
  readonly provenance: 'OWNING';
}

/** One trusted readback of an owning prompt/tool-permission object. */
export interface D14TrustedPromptReadback {
  readonly registryKey: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly bytesSha256?: string;
  readonly scope: D14TrustedScope;
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
const UNIFORM_TEXT_PATTERN = /^(.)\1*$/u;
const SHA256_PREFIX = 'sha256:';
const ZERO_DIGEST = '0'.repeat(64);
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const LATEST_SEGMENT_PATTERN = /(?:^|[._])latest(?:[._]|$)/u;
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
  const inspectVersion = (path: string, value: string): void => {
    if (FLOATING_VERSION_ALIASES.includes(value) || value.includes('latest')) {
      floating.push(`${path} is a floating version alias, not an exact published version.`);
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
  const inspectFact = (path: string, fact: D14TrustedFact): void => {
    inspectDigest(`${path}.contentDigest`, fact.contentDigest);
    inspectDigest(`${path}.bytesSha256`, fact.bytesSha256);
    inspectKey(`${path}.registryKey`, fact.registryKey);
    inspectVersion(`${path}.version`, fact.version);
    inspectProvenance(`${path}.provenance`, fact.provenance, PUBLISHED_PROVENANCE);
  };
  const inspectReadback = (
    path: string,
    readback: D14TrustedOwningObject | D14TrustedPromptReadback,
  ): void => {
    inspectDigest(`${path}.contentDigest`, readback.contentDigest);
    inspectDigest(`${path}.bytesSha256`, readback.bytesSha256);
    inspectKey(`${path}.registryKey`, readback.registryKey);
    inspectVersion(`${path}.version`, readback.version);
    inspectProvenance(`${path}.provenance`, readback.provenance, OWNING_PROVENANCE);
  };

  Object.entries(sources.policies ?? {}).forEach(([key, evidence]) => {
    const path = `sources.policies.${key}`;
    inspectDigest(`${path}.contentDigest`, evidence.contentDigest);
    inspectKey(`${path}.registryKey`, evidence.registryKey);
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
    inspectDigest(`${path}.bytesSha256`, pin.bytesSha256);
    inspectDigest(`${path}.buildSha256`, pin.buildSha256);
    inspectDigest(`${path}.dependencyLockBytesSha256`, pin.dependencyLockBytesSha256);
    inspectDigest(`${path}.codeRef.contentDigest`, pin.codeRef.contentDigest);
    inspectKey(`${path}.toolCode`, pin.toolCode);
    inspectKey(`${path}.codeRef.objectType`, pin.codeRef.objectType);
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
    inspectDigest('sources.providerVersionBinding.fixedVersionDigest', binding.fixedVersionDigest);
    inspectDigest(
      'sources.providerVersionBinding.invocationVerificationDigest',
      binding.invocationVerificationDigest,
    );
    inspectDigest('sources.providerVersionBinding.modelConfigDigest', binding.modelConfigDigest);
    inspectDigest(
      'sources.providerVersionBinding.identityBindingPolicyDigest',
      binding.identityBindingPolicyDigest,
    );
    inspectDigest('sources.providerVersionBinding.apiTransportDigest', binding.apiTransportDigest);
    inspectDigest('sources.providerVersionBinding.apiEndpointDigest', binding.apiEndpointDigest);
    inspectDigest(
      'sources.providerVersionBinding.networkPolicyDigest',
      binding.networkPolicyDigest,
    );
    inspectProvenance(
      'sources.providerVersionBinding.provenance',
      binding.provenance,
      PROVIDER_PROVENANCE,
    );
  }

  if (sources.customerDataAuthorization !== undefined) {
    inspectDigest(
      'sources.customerDataAuthorization.contentDigest',
      sources.customerDataAuthorization.contentDigest,
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

function templateRefMatchesFact(pin: D14PinnedRef, fact: D14TrustedFact): boolean {
  const receiptMatches =
    pin.publicationReceiptRef === undefined ||
    fact.receiptRefId === pin.publicationReceiptRef.objectId;
  const bytesMatch = pin.bytesSha256 === undefined || fact.bytesSha256 === pin.bytesSha256;
  return receiptMatches && bytesMatch && fact.contentDigest === pin.contentHash.digest;
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
  const bytesMatch = pin.bytesSha256 === undefined || readback.bytesSha256 === pin.bytesSha256;
  if (
    readback.registryKey !== pin.ref.objectType ||
    !scopeMatches(readback.scope, pin.ref.scope) ||
    readback.contentDigest !== pin.contentHash.digest ||
    !bytesMatch
  ) {
    reasons.push(`${path} does not match the pin it claims.`);
  }
}

function matchPolicyEvidence(
  pin: D14PinnedRef,
  evidence: D14TrustedPolicyEvidence,
  path: string,
  reasons: string[],
): void {
  if (
    evidence.registryKey !== pin.ref.objectType ||
    !scopeMatches(evidence.scope, pin.ref.scope) ||
    evidence.contentDigest !== pin.contentHash.digest
  ) {
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
  const lockRef = pin.codeRef;
  const lockRefDigest = 'contentHash' in lockRef ? lockRef.contentHash.digest : undefined;
  if (
    candidate.version !== pin.toolVersion ||
    candidate.bytesSha256 !== pin.codeBytesSha256 ||
    candidate.buildSha256 !== pin.buildSha256 ||
    candidate.codeRef.kind !== lockRef.kind ||
    candidate.codeRef.objectType !== lockRef.objectType ||
    candidate.codeRef.objectId !== lockRef.objectId ||
    !scopeMatches(candidate.codeRef.scope, lockRef.scope) ||
    (lockRefDigest !== undefined && candidate.codeRef.contentDigest !== lockRefDigest) ||
    candidate.runtime.runtimeCode !== pin.runtime.runtimeCode ||
    candidate.runtime.runtimeVersion !== pin.runtime.runtimeVersion ||
    candidate.dependencyLockBytesSha256 !== pin.dependencyLockBytesSha256 ||
    candidate.commandTemplate !== pin.commandTemplate
  ) {
    reasons.push(`${slot}: ${pin.toolCode}@${pin.toolVersion} does not match its trusted pin.`);
  }
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

  const lockedPolicyKeys = Object.keys(lock.boundary.policies) as readonly D14PolicyKey[];
  const missingPolicyKeys = lockedPolicyKeys.filter((key) => policies[key] === undefined);
  if (missingPolicyKeys.length > 0) {
    return reject(
      'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING',
      missingPolicyKeys.map((key) => `sources.policies.${key} is missing.`),
    );
  }
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
        owning.registryKey !== manifest.schemaRef.objectType ||
        !scopeMatches(owning.scope, manifest.schemaRef.scope) ||
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

  if (
    providerVersionBinding.provider !== lock.model.provider ||
    providerVersionBinding.modelId !== lock.model.modelId ||
    providerVersionBinding.approvedModelVersion !== lock.model.approvedModelVersion ||
    providerVersionBinding.fixedVersionDigest !==
      lock.model.fixedVersionBinding.contentHash.digest ||
    providerVersionBinding.invocationVerificationDigest !==
      lock.model.perInvocationVerificationRule.contentHash.digest ||
    providerVersionBinding.modelConfigDigest !== lock.model.modelConfigHash.digest ||
    providerVersionBinding.identityBindingPolicyDigest !==
      lock.model.identityBindingPolicy.contentHash.digest ||
    providerVersionBinding.apiTransportDigest !== lock.model.apiTransport.contentHash.digest ||
    providerVersionBinding.apiEndpointDigest !== lock.model.apiEndpoint.contentHash.digest ||
    providerVersionBinding.networkPolicyDigest !== lock.model.networkPolicy.contentHash.digest
  ) {
    reasons.push('sources.providerVersionBinding does not match the locked model identity.');
  }

  if (customerDataAuthorization.contentDigest !== lock.model.dataPolicy.contentHash.digest) {
    reasons.push('sources.customerDataAuthorization does not match the locked data policy.');
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
