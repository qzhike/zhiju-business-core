import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { d14MaterializedLockHash, validateMaterializedLock } from '@zhiju/contracts';
import type {
  Common,
  D14CanonicalRef,
  D14MaterializedLock,
  D14MaterializedLockPayload,
  D14PinnedRef,
  D14ToolPin,
} from '@zhiju/contracts';
import {
  preflightD14RunnerMaterialization,
  type D14InputOutputSlot,
  type D14MaterializationSources,
  type D14PreflightInput,
  type D14PreflightRejectionCode,
  type D14PreflightResult,
  type D14TrustedDeploymentEvidence,
  type D14TrustedFact,
  type D14TrustedOwningObject,
  type D14TrustedPolicyEvidence,
  type D14TrustedPromptTools,
  type D14TrustedRef,
  type D14TrustedScope,
  type D14TrustedToolPin,
} from './d14-runner-lock-preflight.js';

const lock = JSON.parse(
  readFileSync(
    new URL(
      '../../../../tests/fixtures/contracts/d14-runner-execution-lock/materialized-lock-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as D14MaterializedLock;

/** Inside `lock.boundary`'s [issuedAt, validUntil) window. */
const TRUSTED_NOW = '2026-10-09T12:00:00Z';
/** Another well-formed UUIDv7, used only to substitute an identity. */
const OTHER_UUID = '018f22e2-7c15-7b2e-8d86-2de956a9d2f1';
/** Two well-formed immutable version UUIDv7s used by the identity negatives. */
const VERSION_A = '018f22e2-7c15-7b2e-8d86-2de956a9d2a1';
const VERSION_B = '018f22e2-7c15-7b2e-8d86-2de956a9d2b2';

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label} fixture value`);
  return value;
}

function trustedScope(scope: Common.ScopeRef): D14TrustedScope {
  const copy: { enterpriseId?: string; projectId?: string } = {};
  if (scope.enterpriseId !== undefined) copy.enterpriseId = scope.enterpriseId;
  if (scope.projectId !== undefined) copy.projectId = scope.projectId;
  return copy;
}

/** Mirror the complete identity of the lock reference this readback claims. */
function trustedRef(ref: D14CanonicalRef): D14TrustedRef {
  const trusted: {
    kind: string;
    objectType: string;
    objectId: string;
    versionId?: string;
    snapshotId?: string;
    immutableVersionId?: string;
    scope: D14TrustedScope;
    contentDigest?: string;
  } = {
    kind: ref.kind,
    objectType: ref.objectType,
    objectId: ref.objectId,
    scope: trustedScope(ref.scope),
  };
  if ('versionId' in ref) trusted.versionId = ref.versionId;
  if ('snapshotId' in ref) trusted.snapshotId = ref.snapshotId;
  if ('immutableVersionId' in ref) trusted.immutableVersionId = ref.immutableVersionId;
  if ('contentHash' in ref) trusted.contentDigest = ref.contentHash.digest;
  return trusted;
}

function trustedFact(pin: D14PinnedRef): D14TrustedFact {
  const fact: {
    ref: D14TrustedRef;
    contentDigest: string;
    bytesSha256?: string;
    publicationReceiptRef?: D14TrustedRef;
    provenance: 'PUBLISHED';
  } = {
    ref: trustedRef(pin.ref),
    contentDigest: pin.contentHash.digest,
    provenance: 'PUBLISHED',
  };
  if (pin.bytesSha256 !== undefined) fact.bytesSha256 = pin.bytesSha256;
  if (pin.publicationReceiptRef !== undefined) {
    fact.publicationReceiptRef = trustedRef(pin.publicationReceiptRef);
  }
  return fact;
}

function trustedOwning(pin: D14PinnedRef): D14TrustedOwningObject {
  const readback: {
    ref: D14TrustedRef;
    contentDigest: string;
    version: string;
    bytesSha256?: string;
    provenance: 'OWNING';
  } = {
    ref: trustedRef(pin.ref),
    contentDigest: pin.contentHash.digest,
    version: '1.0.0',
    provenance: 'OWNING',
  };
  if (pin.bytesSha256 !== undefined) readback.bytesSha256 = pin.bytesSha256;
  return readback;
}

function trustedToolPin(pin: D14ToolPin): D14TrustedToolPin {
  return {
    toolCode: pin.toolCode,
    version: pin.toolVersion,
    bytesSha256: pin.codeBytesSha256,
    buildSha256: pin.buildSha256,
    codeRef: trustedRef(pin.codeRef),
    runtime: { runtimeCode: pin.runtime.runtimeCode, runtimeVersion: pin.runtime.runtimeVersion },
    dependencyLockBytesSha256: pin.dependencyLockBytesSha256,
    commandTemplate: pin.commandTemplate,
    provenance: 'V0_2',
  };
}

function trustedPolicies(): Record<string, D14TrustedPolicyEvidence> {
  const policies: Record<string, D14TrustedPolicyEvidence> = {};
  for (const [key, pin] of Object.entries(lock.boundary.policies)) {
    policies[key] = {
      ref: trustedRef(pin.ref),
      contentDigest: pin.contentHash.digest,
      version: '1.0.0',
      provenance: 'PUBLISHED',
    };
  }
  return policies;
}

function trustedInputOutputPins(): Record<D14InputOutputSlot, D14TrustedOwningObject> {
  const manifest = lock.outputTools.inputAliasManifest;
  const schemaRef = manifest.schemaRef;
  return {
    preparationSource: trustedOwning(lock.outputTools.preparationSource),
    preparationContext: trustedOwning(lock.outputTools.preparationContext),
    outputProfile: trustedOwning(lock.outputTools.outputProfile),
    outputSchema: trustedOwning(lock.outputTools.outputSchema),
    inputAliasManifest: {
      ref: trustedRef(schemaRef),
      contentDigest:
        'contentHash' in schemaRef ? schemaRef.contentHash.digest : manifest.bytesSha256,
      version: manifest.schemaVersion,
      bytesSha256: manifest.bytesSha256,
      provenance: 'OWNING',
    },
  };
}

function trustedPromptTools(): D14TrustedPromptTools {
  return {
    systemPrompt: trustedOwning(lock.promptTools.systemPrompt),
    taskPrompt: trustedOwning(lock.promptTools.taskPrompt),
    effectiveSettingsDigest: lock.promptTools.effectiveSettingsHash.digest,
    toolPermissionRules: trustedOwning(lock.promptTools.toolPermissionRules),
  };
}

function trustedSources(): D14MaterializationSources {
  const deployment: D14TrustedDeploymentEvidence = {
    hostImageDigest: lock.runtime.hostImageDigest,
    osRelease: lock.runtime.hostOsRelease,
    kernelVersion: lock.runtime.hostKernelVersion,
    architecture: lock.runtime.hostArchitecture,
    executableCode: lock.runtime.executableCode,
    resolvedExecutablePath: lock.runtime.resolvedExecutablePath,
    observedCliVersion: lock.runtime.observedCliVersion,
    cliBinarySha256: lock.runtime.cliBinarySha256,
    cliBuildSha256: lock.runtime.cliBuildSha256,
    cliDependencyLockBytesSha256: lock.runtime.cliDependencyLockBytesSha256,
    adapterSourceSha256: lock.runtime.adapterSourceSha256,
    adapterBuildSha256: lock.runtime.adapterBuildSha256,
    adapterCode: lock.runtime.adapterCode,
    adapterVersion: lock.runtime.adapterVersion,
    harnessId: lock.runtime.harnessId,
    harnessVersion: lock.runtime.harnessVersion,
    launcherVersion: lock.runtime.launcherVersion,
    launcherDigest: lock.runtime.launcherDigest,
    parserVersion: lock.runtime.parserVersion,
    parserDigest: lock.runtime.parserDigest,
    provenance: 'DEPLOYMENT',
  };
  return {
    policies: trustedPolicies(),
    inputOutputPins: trustedInputOutputPins(),
    promptTools: trustedPromptTools(),
    templates: [
      trustedFact(required(lock.templates.templateRefs[0], 'templates.templateRefs[0]')),
      trustedFact(required(lock.templates.templateRefs[1], 'templates.templateRefs[1]')),
    ],
    ruleBundle: trustedFact(lock.templates.ruleBundle),
    startupRules: trustedFact(lock.templates.startupRules),
    vocabulary: trustedFact(lock.templates.vocabulary),
    evidenceTools: [
      trustedToolPin(lock.outputTools.reader),
      trustedToolPin(lock.outputTools.validator),
      trustedToolPin(lock.outputTools.renderer),
    ],
    deployment,
    providerVersionBinding: {
      provider: lock.model.provider,
      modelId: lock.model.modelId,
      approvedModelVersion: lock.model.approvedModelVersion,
      fixedVersionDigest: lock.model.fixedVersionBinding.contentHash.digest,
      invocationVerificationDigest: lock.model.perInvocationVerificationRule.contentHash.digest,
      modelConfigDigest: lock.model.modelConfigHash.digest,
      identityBindingPolicyDigest: lock.model.identityBindingPolicy.contentHash.digest,
      apiTransportDigest: lock.model.apiTransport.contentHash.digest,
      apiEndpointDigest: lock.model.apiEndpoint.contentHash.digest,
      networkPolicyDigest: lock.model.networkPolicy.contentHash.digest,
      provenance: 'PROVIDER',
    },
    customerDataAuthorization: {
      approvalRefId: '018f22e2-7c15-7b2e-8d86-2de956a9d2ff',
      contentDigest: lock.model.dataPolicy.contentHash.digest,
      validUntil: '2027-01-01T00:00:00Z',
      provenance: 'CUSTOMER',
    },
  };
}

function preflight(
  overrides: Partial<D14MaterializationSources> = {},
  trustedNow = TRUSTED_NOW,
): D14PreflightResult {
  const input: D14PreflightInput = {
    lock,
    sources: { ...trustedSources(), ...overrides },
    trustedNow,
  };
  return preflightD14RunnerMaterialization(input);
}

/** Run the preflight against a mutated lock but the untouched trusted sources. */
function preflightAgainst(lockValue: D14MaterializedLock): D14PreflightResult {
  return preflightD14RunnerMaterialization({
    lock: lockValue,
    sources: trustedSources(),
    trustedNow: TRUSTED_NOW,
  });
}

/** Recompute the lock identity so a mutated lock stays structurally valid. */
function relocked(mutated: D14MaterializedLock): D14MaterializedLock {
  const payload: D14MaterializedLockPayload = { ...mutated };
  return { ...payload, lockHash: d14MaterializedLockHash(payload) };
}

/** Replace a content-addressed reference's digest, keeping the identity. */
function withRefDigest(ref: D14CanonicalRef, digest: string): D14CanonicalRef {
  if (!('contentHash' in ref)) throw new Error('fixture reference is not content-addressed');
  return { ...ref, contentHash: { ...ref.contentHash, digest } };
}

/** A valid 64-hex digest that is neither uniform nor zero. */
function distinctDigest(seed: string): string {
  const last = seed.endsWith('0') ? '1' : '0';
  return `${seed.slice(0, -1)}${last}`;
}

/** Set the optional immutable version on a content-addressed reference. */
function withImmutableVersion(ref: D14CanonicalRef, immutableVersionId: string): D14CanonicalRef {
  if (ref.kind !== 'CONTENT_ADDRESSED') {
    throw new Error('fixture reference is not content-addressed');
  }
  return { ...ref, immutableVersionId };
}

/** The valid lock with a template reference carrying one immutable version. */
function lockWithTemplateImmutableVersion(immutableVersionId: string): D14MaterializedLock {
  const templateRefs = lock.templates.templateRefs;
  const first = required(templateRefs[0], 'templateRefs[0]');
  return relocked({
    ...lock,
    templates: {
      ...lock.templates,
      templateRefs: [
        { ...first, ref: withImmutableVersion(first.ref, immutableVersionId) },
        required(templateRefs[1], 'templateRefs[1]'),
      ],
    },
  });
}

/** The valid lock with a publication receipt carrying one immutable version. */
function lockWithReceiptImmutableVersion(immutableVersionId: string): D14MaterializedLock {
  const templateRefs = lock.templates.templateRefs;
  const first = required(templateRefs[0], 'templateRefs[0]');
  const receipt = required(first.publicationReceiptRef, 'publicationReceiptRef');
  return relocked({
    ...lock,
    templates: {
      ...lock.templates,
      templateRefs: [
        { ...first, publicationReceiptRef: withImmutableVersion(receipt, immutableVersionId) },
        required(templateRefs[1], 'templateRefs[1]'),
      ],
    },
  });
}

/** The valid lock with the preparation source carrying one immutable version. */
function lockWithSourceImmutableVersion(immutableVersionId: string): D14MaterializedLock {
  const source = lock.outputTools.preparationSource;
  return relocked({
    ...lock,
    outputTools: {
      ...lock.outputTools,
      preparationSource: { ...source, ref: withImmutableVersion(source.ref, immutableVersionId) },
    },
  });
}

/** Trusted templates with the first ref's immutable version set or omitted. */
function trustedTemplatesWithVersion(
  immutableVersionId: string | undefined,
): readonly D14TrustedFact[] {
  const templates = required(trustedSources().templates, 'sources.templates');
  const first = required(templates[0], 'templates[0]');
  const ref: D14TrustedRef =
    immutableVersionId === undefined ? first.ref : { ...first.ref, immutableVersionId };
  return [{ ...first, ref }, required(templates[1], 'templates[1]')];
}

/** Trusted templates with the first receipt's immutable version set or omitted. */
function trustedTemplatesWithReceiptVersion(
  immutableVersionId: string | undefined,
): readonly D14TrustedFact[] {
  const templates = required(trustedSources().templates, 'sources.templates');
  const first = required(templates[0], 'templates[0]');
  const receipt = required(first.publicationReceiptRef, 'publicationReceiptRef');
  const updated = immutableVersionId === undefined ? receipt : { ...receipt, immutableVersionId };
  return [{ ...first, publicationReceiptRef: updated }, required(templates[1], 'templates[1]')];
}

/** Trusted owning pins with the preparation source's version set or omitted. */
function trustedInputOutputPinsWithSourceVersion(
  immutableVersionId: string | undefined,
): Record<D14InputOutputSlot, D14TrustedOwningObject> {
  const pins = trustedInputOutputPins();
  const source = required(pins.preparationSource, 'inputOutputPins.preparationSource');
  const ref: D14TrustedRef =
    immutableVersionId === undefined ? source.ref : { ...source.ref, immutableVersionId };
  return { ...pins, preparationSource: { ...source, ref } };
}

/** Drop one required deployment field to model a readback that never carried it. */
function deploymentMissing(
  deployment: D14TrustedDeploymentEvidence,
  field: 'adapterCode' | 'adapterVersion' | 'harnessId' | 'harnessVersion',
): D14TrustedDeploymentEvidence {
  const entries = Object.entries(deployment).filter(([key]) => key !== field);
  // Negative fixture: the readback is deliberately incomplete, so its shape is asserted.
  return Object.fromEntries(entries) as D14TrustedDeploymentEvidence;
}

/** Run the preflight against an explicit lock plus trusted-source overrides. */
function preflightWith(
  lockValue: D14MaterializedLock,
  overrides: Partial<D14MaterializationSources>,
): D14PreflightResult {
  return preflightD14RunnerMaterialization({
    lock: lockValue,
    sources: { ...trustedSources(), ...overrides },
    trustedNow: TRUSTED_NOW,
  });
}

function expectRejection(result: D14PreflightResult, code: D14PreflightRejectionCode): void {
  expect(result.admissible).toBe(false);
  if (result.admissible) return;
  expect(result.code).toBe(code);
}

describe('preflightD14RunnerMaterialization', () => {
  it('admits the valid lock against a complete trusted source set', () => {
    const result = preflight();
    expect(result).toEqual({ admissible: true, lock });
  });

  it('rejects a tampered lock as structurally invalid', () => {
    expectRejection(
      preflightAgainst({ ...lock, lockId: '018f22e2-7c15-7b2e-8d86-2de956a9d2ff' }),
      'D14_PREFLIGHT_LOCK_INVALID',
    );
  });

  it('rejects an unparseable trusted instant', () => {
    expectRejection(preflight({}, 'not-a-utc-instant'), 'D14_PREFLIGHT_LOCK_INVALID');
  });

  it('rejects a trusted instant before issuedAt', () => {
    expectRejection(preflight({}, '2026-10-09T09:59:59Z'), 'D14_PREFLIGHT_LOCK_NOT_ELIGIBLE');
  });

  it('admits a trusted instant exactly at issuedAt', () => {
    expect(preflight({}, '2026-10-09T10:00:00Z').admissible).toBe(true);
  });

  it('admits a trusted instant just before validUntil', () => {
    expect(preflight({}, '2026-10-09T23:59:59Z').admissible).toBe(true);
  });

  it('rejects a trusted instant exactly at validUntil', () => {
    expectRejection(preflight({}, '2026-10-10T00:00:00Z'), 'D14_PREFLIGHT_LOCK_NOT_ELIGIBLE');
  });

  it('rejects a trusted instant after validUntil', () => {
    expectRejection(preflight({}, '2026-10-10T00:00:01Z'), 'D14_PREFLIGHT_LOCK_NOT_ELIGIBLE');
  });

  it('rejects an absent policy evidence map', () => {
    expectRejection(preflight({ policies: undefined }), 'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects an empty policy evidence map', () => {
    expectRejection(preflight({ policies: {} }), 'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects a missing linked boundary-policy key', () => {
    const policies = Object.fromEntries(
      Object.entries(trustedPolicies()).filter(([key]) => key !== 'network'),
    );
    expectRejection(preflight({ policies }), 'D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects a wrong boundary-policy digest', () => {
    const policies = trustedPolicies();
    const filesystem = required(policies.filesystem, 'policies.filesystem');
    expectRejection(
      preflight({
        policies: {
          ...policies,
          filesystem: { ...filesystem, contentDigest: distinctDigest(filesystem.contentDigest) },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a wrong boundary-policy registry key', () => {
    const policies = trustedPolicies();
    const network = required(policies.network, 'policies.network');
    expectRejection(
      preflight({
        policies: {
          ...policies,
          network: {
            ...network,
            ref: { ...network.ref, objectType: 'zhiju.platform.other_policy' },
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a substituted boundary-policy object identity', () => {
    const policies = trustedPolicies();
    const network = required(policies.network, 'policies.network');
    expectRejection(
      preflight({
        policies: {
          ...policies,
          network: { ...network, ref: { ...network.ref, objectId: OTHER_UUID } },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a differing boundary-policy scope', () => {
    const policies = trustedPolicies();
    const network = required(policies.network, 'policies.network');
    expectRejection(
      preflight({
        policies: {
          ...policies,
          network: {
            ...network,
            ref: {
              ...network.ref,
              scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' },
            },
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects an extra policy evidence key', () => {
    const policies = trustedPolicies();
    const filesystem = required(policies.filesystem, 'policies.filesystem');
    expectRejection(
      preflight({
        policies: {
          ...policies,
          extra: {
            ref: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.platform.d14_extra_policy',
              objectId: OTHER_UUID,
              scope: {},
              contentDigest: distinctDigest(filesystem.contentDigest),
            },
            contentDigest: distinctDigest(filesystem.contentDigest),
            version: '1.0.0',
            provenance: 'PUBLISHED',
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a placeholder boundary-policy digest', () => {
    const policies = trustedPolicies();
    expectRejection(
      preflight({
        policies: {
          ...policies,
          network: {
            ...required(policies.network, 'policies.network'),
            contentDigest: '0'.repeat(64),
          },
        },
      }),
      'D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED',
    );
  });

  it('rejects an absent input/output pin map', () => {
    expectRejection(preflight({ inputOutputPins: undefined }), 'D14_PREFLIGHT_IO_PINS_MISSING');
  });

  it('rejects a missing input/output pin slot', () => {
    // Negative fixture: the map is deliberately incomplete, so its shape is asserted.
    const inputOutputPins = Object.fromEntries(
      Object.entries(trustedInputOutputPins()).filter(([key]) => key !== 'outputProfile'),
    ) as Readonly<Record<D14InputOutputSlot, D14TrustedOwningObject>>;
    expectRejection(preflight({ inputOutputPins }), 'D14_PREFLIGHT_IO_PINS_MISSING');
  });

  it('rejects an absent prompt/tool-permission readback', () => {
    expectRejection(preflight({ promptTools: undefined }), 'D14_PREFLIGHT_IO_PINS_MISSING');
  });

  it('rejects a wrong output-profile digest', () => {
    const inputOutputPins = trustedInputOutputPins();
    const profile = required(inputOutputPins.outputProfile, 'inputOutputPins.outputProfile');
    expectRejection(
      preflight({
        inputOutputPins: {
          ...inputOutputPins,
          outputProfile: { ...profile, contentDigest: distinctDigest(profile.contentDigest) },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a wrong input-alias-manifest bytes digest', () => {
    const inputOutputPins = trustedInputOutputPins();
    const manifest = required(
      inputOutputPins.inputAliasManifest,
      'inputOutputPins.inputAliasManifest',
    );
    expectRejection(
      preflight({
        inputOutputPins: {
          ...inputOutputPins,
          inputAliasManifest: {
            ...manifest,
            bytesSha256: distinctDigest(required(manifest.bytesSha256, 'manifest bytes')),
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a wrong input/output registry key', () => {
    const inputOutputPins = trustedInputOutputPins();
    const profile = required(inputOutputPins.outputProfile, 'inputOutputPins.outputProfile');
    expectRejection(
      preflight({
        inputOutputPins: {
          ...inputOutputPins,
          outputProfile: {
            ...profile,
            ref: { ...profile.ref, objectType: 'zhiju.platform.other_profile' },
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a differing input/output scope', () => {
    const inputOutputPins = trustedInputOutputPins();
    const source = required(inputOutputPins.preparationSource, 'inputOutputPins.preparationSource');
    expectRejection(
      preflight({
        inputOutputPins: {
          ...inputOutputPins,
          preparationSource: { ...source, ref: { ...source.ref, scope: {} } },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a copied non-OWNING input/output pin provenance', () => {
    const inputOutputPins = trustedInputOutputPins();
    const profile = required(inputOutputPins.outputProfile, 'inputOutputPins.outputProfile');
    expectRejection(
      preflight({
        inputOutputPins: {
          ...inputOutputPins,
          outputProfile: { ...profile, provenance: 'HISTORIC' as 'OWNING' },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_NOT_CURRENT',
    );
  });

  it('rejects a wrong prompt effective-settings digest', () => {
    const promptTools = trustedPromptTools();
    expectRejection(
      preflight({
        promptTools: {
          ...promptTools,
          effectiveSettingsDigest: distinctDigest(promptTools.effectiveSettingsDigest),
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a wrong tool-permission-rules digest', () => {
    const promptTools = trustedPromptTools();
    expectRejection(
      preflight({
        promptTools: {
          ...promptTools,
          toolPermissionRules: {
            ...promptTools.toolPermissionRules,
            contentDigest: distinctDigest(promptTools.toolPermissionRules.contentDigest),
          },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects an absent template readback', () => {
    expectRejection(preflight({ templates: undefined }), 'D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an empty template readback', () => {
    expectRejection(preflight({ templates: [] }), 'D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an absent rule bundle', () => {
    expectRejection(preflight({ ruleBundle: undefined }), 'D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects absent startup rules', () => {
    expectRejection(preflight({ startupRules: undefined }), 'D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an absent vocabulary', () => {
    expectRejection(preflight({ vocabulary: undefined }), 'D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects absent evidence tool pins', () => {
    expectRejection(preflight({ evidenceTools: undefined }), 'D14_PREFLIGHT_TOOL_PINS_MISSING');
  });

  it('rejects an absent deployment observation', () => {
    expectRejection(
      preflight({ deployment: undefined }),
      'D14_PREFLIGHT_DEPLOYMENT_EVIDENCE_MISSING',
    );
  });

  it('rejects an absent provider version binding', () => {
    expectRejection(
      preflight({ providerVersionBinding: undefined }),
      'D14_PREFLIGHT_PROVIDER_VERSION_BINDING_MISSING',
    );
  });

  it('rejects an absent customer data authorization', () => {
    expectRejection(
      preflight({ customerDataAuthorization: undefined }),
      'D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING',
    );
  });

  it('rejects an all-zero placeholder digest', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    expectRejection(
      preflight({
        templates: [
          {
            ...required(templates[0], 'templates[0]'),
            contentDigest: '0'.repeat(64),
          },
        ],
      }),
      'D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED',
    );
  });

  it('rejects a floating latest version alias', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    expectRejection(
      preflight({ templates: [{ ...first, ref: { ...first.ref, versionId: 'latest' } }] }),
      'D14_PREFLIGHT_FLOATING_ALIAS_REJECTED',
    );
  });

  it('rejects a copied historic provenance record', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    expectRejection(
      preflight({
        templates: [
          { ...required(templates[0], 'templates[0]'), provenance: 'HISTORIC' as 'PUBLISHED' },
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_NOT_CURRENT',
    );
  });

  it('rejects a wrong template digest', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const current = required(templates[0], 'templates[0]');
    expectRejection(
      preflight({
        templates: [
          { ...current, contentDigest: distinctDigest(current.contentDigest) },
          required(templates[1], 'templates[1]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a trusted fact with a substituted object identity', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    expectRejection(
      preflight({
        templates: [
          { ...first, ref: { ...first.ref, objectId: OTHER_UUID } },
          required(templates[1], 'templates[1]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a trusted fact with an unregistered same-namespace type', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    expectRejection(
      preflight({
        templates: [
          { ...first, ref: { ...first.ref, objectType: 'zhiju.execution.unregistered_contract' } },
          required(templates[1], 'templates[1]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a trusted publication receipt with a different identity', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    const receipt = required(first.publicationReceiptRef, 'publicationReceiptRef');
    expectRejection(
      preflight({
        templates: [
          { ...first, publicationReceiptRef: { ...receipt, objectId: OTHER_UUID } },
          required(templates[1], 'templates[1]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a startup-rules readback under an unregistered key', () => {
    const startupRules = required(trustedSources().startupRules, 'sources.startupRules');
    expectRejection(
      preflight({
        startupRules: {
          ...startupRules,
          ref: { ...startupRules.ref, objectType: 'unregistered.foreign' },
        },
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects an unconsumed extra template fact', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    expectRejection(
      preflight({
        templates: [
          ...templates,
          { ...first, ref: { ...first.ref, objectType: 'zhiju.platform.d14_template_c' } },
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a wrong tool build digest', () => {
    const tools = required(trustedSources().evidenceTools, 'sources.evidenceTools');
    const current = required(tools[0], 'tools[0]');
    expectRejection(
      preflight({
        evidenceTools: [
          { ...current, buildSha256: distinctDigest(current.buildSha256) },
          required(tools[1], 'tools[1]'),
          required(tools[2], 'tools[2]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a tool pin with a substituted code reference', () => {
    const tools = required(trustedSources().evidenceTools, 'sources.evidenceTools');
    const current = required(tools[0], 'tools[0]');
    expectRejection(
      preflight({
        evidenceTools: [
          { ...current, codeRef: { ...current.codeRef, objectId: OTHER_UUID } },
          required(tools[1], 'tools[1]'),
          required(tools[2], 'tools[2]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a v0.1 tool pin against a v0.2 slot', () => {
    const tools = required(trustedSources().evidenceTools, 'sources.evidenceTools');
    const current = required(tools[0], 'tools[0]');
    expectRejection(
      preflight({
        evidenceTools: [
          { ...current, version: '0.1.0' },
          required(tools[1], 'tools[1]'),
          required(tools[2], 'tools[2]'),
        ],
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a deployment observation mismatch', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: { ...deployment, osRelease: 'Debian 12' } }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects an expired data authorization window', () => {
    const authorization = required(
      trustedSources().customerDataAuthorization,
      'sources.customerDataAuthorization',
    );
    expectRejection(
      preflight({
        customerDataAuthorization: { ...authorization, validUntil: '2026-01-01T00:00:00Z' },
      }),
      'D14_PREFLIGHT_DATA_AUTHORIZATION_EXPIRED',
    );
  });

  it('rejects a mutated startup-rules hash', () => {
    const startupRules = lock.templates.startupRules;
    const changed = distinctDigest(startupRules.contentHash.digest);
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          templates: {
            ...lock.templates,
            startupRules: {
              ...startupRules,
              ref: withRefDigest(startupRules.ref, changed),
              contentHash: { ...startupRules.contentHash, digest: changed },
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated template reference object identity', () => {
    const templateRefs = lock.templates.templateRefs;
    const first = required(templateRefs[0], 'templateRefs[0]');
    const mutated = relocked({
      ...lock,
      templates: {
        ...lock.templates,
        templateRefs: [
          { ...first, ref: { ...first.ref, objectId: OTHER_UUID } },
          required(templateRefs[1], 'templateRefs[1]'),
        ],
      },
    });
    expect(validateMaterializedLock(mutated).valid).toBe(true);
    expectRejection(preflightAgainst(mutated), 'D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a mutated publication-receipt digest', () => {
    const templateRefs = lock.templates.templateRefs;
    const first = required(templateRefs[0], 'templateRefs[0]');
    const receipt = required(first.publicationReceiptRef, 'publicationReceiptRef');
    if (!('contentHash' in receipt)) throw new Error('fixture receipt is not content-addressed');
    const mutated = relocked({
      ...lock,
      templates: {
        ...lock.templates,
        templateRefs: [
          {
            ...first,
            publicationReceiptRef: withRefDigest(
              receipt,
              distinctDigest(receipt.contentHash.digest),
            ),
          },
          required(templateRefs[1], 'templateRefs[1]'),
        ],
      },
    });
    expect(validateMaterializedLock(mutated).valid).toBe(true);
    expectRejection(preflightAgainst(mutated), 'D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a mutated preparation-source object identity', () => {
    const source = lock.outputTools.preparationSource;
    const mutated = relocked({
      ...lock,
      outputTools: {
        ...lock.outputTools,
        preparationSource: { ...source, ref: { ...source.ref, objectId: OTHER_UUID } },
      },
    });
    expect(validateMaterializedLock(mutated).valid).toBe(true);
    expectRejection(preflightAgainst(mutated), 'D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a mutated reader dependency-lock digest', () => {
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          outputTools: {
            ...lock.outputTools,
            reader: {
              ...lock.outputTools.reader,
              dependencyLockBytesSha256: distinctDigest(
                lock.outputTools.reader.dependencyLockBytesSha256,
              ),
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated validator command template', () => {
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          outputTools: {
            ...lock.outputTools,
            validator: {
              ...lock.outputTools.validator,
              commandTemplate: 'zhiju.d14.validator --input <manifest> --output <elsewhere>',
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated renderer code reference', () => {
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          outputTools: {
            ...lock.outputTools,
            renderer: {
              ...lock.outputTools.renderer,
              codeRef: {
                ...lock.outputTools.renderer.codeRef,
                objectType: 'zhiju.platform.zhiju_d14_renderer_v2',
              },
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated host OS release', () => {
    expectRejection(
      preflightAgainst(
        relocked({ ...lock, runtime: { ...lock.runtime, hostOsRelease: 'Debian 12' } }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated model configuration hash', () => {
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          model: {
            ...lock.model,
            modelConfigHash: {
              ...lock.model.modelConfigHash,
              digest: distinctDigest(lock.model.modelConfigHash.digest),
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a mutated system-prompt bytes digest', () => {
    const systemPrompt = lock.promptTools.systemPrompt;
    expectRejection(
      preflightAgainst(
        relocked({
          ...lock,
          promptTools: {
            ...lock.promptTools,
            systemPrompt: {
              ...systemPrompt,
              bytesSha256: distinctDigest(
                required(systemPrompt.bytesSha256, 'system prompt bytes'),
              ),
            },
          },
        }),
      ),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('admits a template reference whose immutable version matches on both sides', () => {
    const versionedLock = lockWithTemplateImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expect(
      preflightWith(versionedLock, { templates: trustedTemplatesWithVersion(VERSION_A) })
        .admissible,
    ).toBe(true);
  });

  it('rejects a template reference whose immutable version differs', () => {
    const versionedLock = lockWithTemplateImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, { templates: trustedTemplatesWithVersion(VERSION_B) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a template reference whose immutable version is only on the lock side', () => {
    const versionedLock = lockWithTemplateImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, { templates: trustedTemplatesWithVersion(undefined) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a template reference whose immutable version is only on the trusted side', () => {
    expectRejection(
      preflightWith(lock, { templates: trustedTemplatesWithVersion(VERSION_A) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('admits a publication receipt whose immutable version matches on both sides', () => {
    const versionedLock = lockWithReceiptImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expect(
      preflightWith(versionedLock, {
        templates: trustedTemplatesWithReceiptVersion(VERSION_A),
      }).admissible,
    ).toBe(true);
  });

  it('rejects a publication receipt whose immutable version differs', () => {
    const versionedLock = lockWithReceiptImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, { templates: trustedTemplatesWithReceiptVersion(VERSION_B) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a publication receipt whose immutable version is only on the lock side', () => {
    const versionedLock = lockWithReceiptImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, { templates: trustedTemplatesWithReceiptVersion(undefined) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a publication receipt whose immutable version is only on the trusted side', () => {
    expectRejection(
      preflightWith(lock, { templates: trustedTemplatesWithReceiptVersion(VERSION_A) }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('admits a preparation source whose immutable version matches on both sides', () => {
    const versionedLock = lockWithSourceImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expect(
      preflightWith(versionedLock, {
        inputOutputPins: trustedInputOutputPinsWithSourceVersion(VERSION_A),
      }).admissible,
    ).toBe(true);
  });

  it('rejects a preparation source whose immutable version differs', () => {
    const versionedLock = lockWithSourceImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, {
        inputOutputPins: trustedInputOutputPinsWithSourceVersion(VERSION_B),
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a preparation source whose immutable version is only on the lock side', () => {
    const versionedLock = lockWithSourceImmutableVersion(VERSION_A);
    expect(validateMaterializedLock(versionedLock).valid).toBe(true);
    expectRejection(
      preflightWith(versionedLock, {
        inputOutputPins: trustedInputOutputPinsWithSourceVersion(undefined),
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a preparation source whose immutable version is only on the trusted side', () => {
    expectRejection(
      preflightWith(lock, {
        inputOutputPins: trustedInputOutputPinsWithSourceVersion(VERSION_A),
      }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('admits a complete deployment readback carrying the adapter and harness identities', () => {
    expect(preflight().admissible).toBe(true);
  });

  it('rejects a drifted adapter code', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: { ...deployment, adapterCode: 'zhiju.runtime.other_adapter' } }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a drifted adapter version', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: { ...deployment, adapterVersion: '9.9.9' } }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a drifted harness identity', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: { ...deployment, harnessId: 'zhiju.runtime.other_harness' } }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a drifted harness version', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: { ...deployment, harnessVersion: '9.9.9' } }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a deployment readback missing the adapter code', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: deploymentMissing(deployment, 'adapterCode') }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a deployment readback missing the adapter version', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: deploymentMissing(deployment, 'adapterVersion') }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a deployment readback missing the harness identity', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: deploymentMissing(deployment, 'harnessId') }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });

  it('rejects a deployment readback missing the harness version', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    expectRejection(
      preflight({ deployment: deploymentMissing(deployment, 'harnessVersion') }),
      'D14_PREFLIGHT_EVIDENCE_MISMATCH',
    );
  });
});
