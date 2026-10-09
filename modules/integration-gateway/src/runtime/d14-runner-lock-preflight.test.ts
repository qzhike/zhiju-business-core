import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { D14MaterializedLock, D14PinnedRef, D14ToolPin } from '@zhiju/contracts';
import {
  preflightD14RunnerMaterialization,
  type D14InputOutputSlot,
  type D14MaterializationSources,
  type D14PreflightInput,
  type D14PreflightResult,
  type D14TrustedDeploymentEvidence,
  type D14TrustedFact,
  type D14TrustedOwningObject,
  type D14TrustedPolicyEvidence,
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

const TRUSTED_NOW = '2026-10-09T00:00:00Z';

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label} fixture value`);
  return value;
}

function trustedFact(pin: D14PinnedRef, registryKey: string): D14TrustedFact {
  return {
    registryKey,
    version: '1.0.0',
    contentDigest: pin.contentHash.digest,
    bytesSha256: pin.bytesSha256 ?? '',
    receiptRefId: pin.publicationReceiptRef?.objectId ?? '',
    provenance: 'PUBLISHED',
  };
}

function trustedToolPin(pin: D14ToolPin): D14TrustedToolPin {
  return {
    toolCode: pin.toolCode,
    version: pin.toolVersion,
    bytesSha256: pin.codeBytesSha256,
    buildSha256: pin.buildSha256,
    provenance: 'V0_2',
  };
}

function trustedPolicies(): Record<string, D14TrustedPolicyEvidence> {
  const policies: Record<string, D14TrustedPolicyEvidence> = {};
  for (const [key, pin] of Object.entries(lock.boundary.policies)) {
    policies[key] = {
      registryKey: pin.ref.objectType,
      version: '1.0.0',
      contentDigest: pin.contentHash.digest,
      provenance: 'PUBLISHED',
    };
  }
  return policies;
}

function trustedOwning(pin: D14PinnedRef): D14TrustedOwningObject {
  return {
    registryKey: pin.ref.objectType,
    version: '1.0.0',
    contentDigest: pin.contentHash.digest,
    bytesSha256: pin.bytesSha256 ?? pin.contentHash.digest,
    provenance: 'OWNING',
  };
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
      registryKey: schemaRef.objectType,
      version: manifest.schemaVersion,
      contentDigest:
        'contentHash' in schemaRef ? schemaRef.contentHash.digest : manifest.bytesSha256,
      bytesSha256: manifest.bytesSha256,
      provenance: 'OWNING',
    },
  };
}

function trustedSources(): D14MaterializationSources {
  const deployment: D14TrustedDeploymentEvidence = {
    hostImageDigest: lock.runtime.hostImageDigest,
    osRelease: lock.runtime.hostOsRelease,
    kernelVersion: lock.runtime.hostKernelVersion,
    architecture: lock.runtime.hostArchitecture,
    cliBinarySha256: lock.runtime.cliBinarySha256,
    adapterSourceSha256: lock.runtime.adapterSourceSha256,
    adapterBuildSha256: lock.runtime.adapterBuildSha256,
    provenance: 'DEPLOYMENT',
  };
  return {
    policies: trustedPolicies(),
    inputOutputPins: trustedInputOutputPins(),
    templates: [
      trustedFact(
        required(lock.templates.templateRefs[0], 'templates.templateRefs[0]'),
        'zhiju.platform.d14_template_a',
      ),
      trustedFact(
        required(lock.templates.templateRefs[1], 'templates.templateRefs[1]'),
        'zhiju.platform.d14_template_b',
      ),
    ],
    ruleBundle: trustedFact(lock.templates.ruleBundle, 'zhiju.platform.d14_rule_bundle'),
    vocabulary: trustedFact(lock.templates.vocabulary, 'zhiju.platform.d14_vocabulary'),
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

function preflight(overrides: Partial<D14MaterializationSources> = {}): D14PreflightResult {
  const input: D14PreflightInput = {
    lock,
    sources: { ...trustedSources(), ...overrides },
    trustedNow: TRUSTED_NOW,
  };
  return preflightD14RunnerMaterialization(input);
}

/** A valid 64-hex digest that is neither uniform nor zero. */
function distinctDigest(seed: string): string {
  const last = seed.endsWith('0') ? '1' : '0';
  return `${seed.slice(0, -1)}${last}`;
}

describe('preflightD14RunnerMaterialization', () => {
  it('admits the valid lock against a complete trusted source set', () => {
    const result = preflight();
    expect(result).toEqual({ admissible: true, lock });
  });

  it('rejects a tampered lock as structurally invalid', () => {
    const result = preflightD14RunnerMaterialization({
      lock: { ...lock, lockId: '018f22e2-7c15-7b2e-8d86-2de956a9d2ff' },
      sources: trustedSources(),
      trustedNow: TRUSTED_NOW,
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_LOCK_INVALID');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('rejects an absent policy evidence map', () => {
    const result = preflight({ policies: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects an empty policy evidence map', () => {
    const result = preflight({ policies: {} });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects a missing linked boundary-policy key', () => {
    const policies = Object.fromEntries(
      Object.entries(trustedPolicies()).filter(([key]) => key !== 'network'),
    );
    const result = preflight({ policies });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_POLICY_EVIDENCE_MISSING');
  });

  it('rejects a wrong boundary-policy digest', () => {
    const policies = trustedPolicies();
    const filesystem = required(policies.filesystem, 'policies.filesystem');
    const result = preflight({
      policies: {
        ...policies,
        filesystem: { ...filesystem, contentDigest: distinctDigest(filesystem.contentDigest) },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects an extra policy evidence key', () => {
    const policies = trustedPolicies();
    const filesystem = required(policies.filesystem, 'policies.filesystem');
    const result = preflight({
      policies: {
        ...policies,
        extra: {
          registryKey: 'zhiju.platform.d14_extra_policy',
          version: '1.0.0',
          contentDigest: distinctDigest(filesystem.contentDigest),
          provenance: 'PUBLISHED',
        },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a placeholder boundary-policy digest', () => {
    const policies = trustedPolicies();
    const result = preflight({
      policies: {
        ...policies,
        network: {
          ...required(policies.network, 'policies.network'),
          contentDigest: '0'.repeat(64),
        },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED');
  });

  it('rejects an absent input/output pin map', () => {
    const result = preflight({ inputOutputPins: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_IO_PINS_MISSING');
  });

  it('rejects a missing input/output pin slot', () => {
    // Negative fixture: the map is deliberately incomplete, so its shape is asserted.
    const inputOutputPins = Object.fromEntries(
      Object.entries(trustedInputOutputPins()).filter(([key]) => key !== 'outputProfile'),
    ) as Readonly<Record<D14InputOutputSlot, D14TrustedOwningObject>>;
    const result = preflight({ inputOutputPins });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_IO_PINS_MISSING');
  });

  it('rejects a wrong output-profile digest', () => {
    const inputOutputPins = trustedInputOutputPins();
    const profile = required(inputOutputPins.outputProfile, 'inputOutputPins.outputProfile');
    const result = preflight({
      inputOutputPins: {
        ...inputOutputPins,
        outputProfile: { ...profile, contentDigest: distinctDigest(profile.contentDigest) },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a wrong input-alias-manifest bytes digest', () => {
    const inputOutputPins = trustedInputOutputPins();
    const manifest = required(
      inputOutputPins.inputAliasManifest,
      'inputOutputPins.inputAliasManifest',
    );
    const result = preflight({
      inputOutputPins: {
        ...inputOutputPins,
        inputAliasManifest: { ...manifest, bytesSha256: distinctDigest(manifest.bytesSha256) },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a copied non-OWNING input/output pin provenance', () => {
    const inputOutputPins = trustedInputOutputPins();
    const profile = required(inputOutputPins.outputProfile, 'inputOutputPins.outputProfile');
    const result = preflight({
      inputOutputPins: {
        ...inputOutputPins,
        outputProfile: { ...profile, provenance: 'HISTORIC' as 'OWNING' },
      },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_NOT_CURRENT');
  });

  it('rejects an absent template readback', () => {
    const result = preflight({ templates: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an empty template readback', () => {
    const result = preflight({ templates: [] });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an absent rule bundle', () => {
    const result = preflight({ ruleBundle: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects an absent vocabulary', () => {
    const result = preflight({ vocabulary: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PUBLICATION_MISSING');
  });

  it('rejects absent evidence tool pins', () => {
    const result = preflight({ evidenceTools: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_TOOL_PINS_MISSING');
  });

  it('rejects an absent deployment observation', () => {
    const result = preflight({ deployment: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_DEPLOYMENT_EVIDENCE_MISSING');
  });

  it('rejects an absent provider version binding', () => {
    const result = preflight({ providerVersionBinding: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PROVIDER_VERSION_BINDING_MISSING');
  });

  it('rejects an absent customer data authorization', () => {
    const result = preflight({ customerDataAuthorization: undefined });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_DATA_AUTHORIZATION_MISSING');
  });

  it('rejects an all-zero placeholder digest', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const result = preflight({
      templates: [
        {
          ...required(templates[0], 'templates[0]'),
          contentDigest: '0'.repeat(64),
        },
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_PLACEHOLDER_EVIDENCE_REJECTED');
  });

  it('rejects a floating latest version alias', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const result = preflight({
      templates: [{ ...required(templates[0], 'templates[0]'), version: 'latest' }],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_FLOATING_ALIAS_REJECTED');
  });

  it('rejects a copied historic provenance record', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const result = preflight({
      templates: [
        { ...required(templates[0], 'templates[0]'), provenance: 'HISTORIC' as 'PUBLISHED' },
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_NOT_CURRENT');
  });

  it('rejects a wrong template digest', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const current = required(templates[0], 'templates[0]');
    const result = preflight({
      templates: [
        { ...current, contentDigest: distinctDigest(current.contentDigest) },
        required(templates[1], 'templates[1]'),
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects an unconsumed extra template fact', () => {
    const templates = required(trustedSources().templates, 'sources.templates');
    const first = required(templates[0], 'templates[0]');
    const result = preflight({
      templates: [
        ...templates,
        {
          ...first,
          registryKey: 'zhiju.platform.d14_template_c',
          contentDigest: distinctDigest(first.contentDigest),
        },
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a wrong tool build digest', () => {
    const tools = required(trustedSources().evidenceTools, 'sources.evidenceTools');
    const current = required(tools[0], 'tools[0]');
    const result = preflight({
      evidenceTools: [
        { ...current, buildSha256: distinctDigest(current.buildSha256) },
        required(tools[1], 'tools[1]'),
        required(tools[2], 'tools[2]'),
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a v0.1 tool pin against a v0.2 slot', () => {
    const tools = required(trustedSources().evidenceTools, 'sources.evidenceTools');
    const current = required(tools[0], 'tools[0]');
    const result = preflight({
      evidenceTools: [
        { ...current, version: '0.1.0' },
        required(tools[1], 'tools[1]'),
        required(tools[2], 'tools[2]'),
      ],
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects a deployment observation mismatch', () => {
    const deployment = required(trustedSources().deployment, 'sources.deployment');
    const result = preflight({
      deployment: { ...deployment, osRelease: 'Debian 12' },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_EVIDENCE_MISMATCH');
  });

  it('rejects an expired data authorization window', () => {
    const authorization = required(
      trustedSources().customerDataAuthorization,
      'sources.customerDataAuthorization',
    );
    const result = preflight({
      customerDataAuthorization: { ...authorization, validUntil: '2026-01-01T00:00:00Z' },
    });
    expect(result.admissible).toBe(false);
    if (result.admissible) return;
    expect(result.code).toBe('D14_PREFLIGHT_DATA_AUTHORIZATION_EXPIRED');
  });
});
