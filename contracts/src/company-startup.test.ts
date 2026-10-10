import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPANY_STARTUP_PROFILES,
  COMPANY_STARTUP_REGISTRY_VERSION,
  assertCompanyPayload,
  assertCompanySnapshotRead,
  assertCompanySnapshotRecord,
  assertCompanySnapshotView,
  companyHash,
  companyPolicySetVersion,
  companySnapshotReadRequest,
  companyStartupProfile,
  companyStartupRegistry,
  loadCompanyStartupRegistry,
} from './company-startup.js';

const doc = {
  rulesCode: 'zhiju.startup.cn_active_device_qms_upgrade.rules',
  rulesVersion: '1.0.0',
  mandatoryFactTypes: ['zhiju.fact.quality_policy'],
  requiredProductFields: ['displayName'],
  minimumProductVersions: 1,
  protectionEvidenceRequirements: ['quality_objectives'],
  mandatoryRequirementCodes: ['zhiju.requirement.qms.scope'],
  mandatoryChoiceKeys: ['zhiju.choice.qms.document_base'],
  mandatoryDecisionTypes: ['zhiju.decision.qms.supported_scope'],
  allowedStartupOutcomes: {
    'zhiju.decision.qms.supported_scope': ['zhiju.outcome.within_supported_scope'],
    'zhiju.decision.qms.protection_evidence': ['zhiju.outcome.sufficient'],
    'zhiju.decision.qms.startup_conflicts': ['zhiju.outcome.no_startup_conflict'],
  },
  supportSet: ['TEXT', 'PRODUCT', 'QMS'],
};
const payload = {
  registryVersion: COMPANY_STARTUP_REGISTRY_VERSION,
  profileKey: COMPANY_STARTUP_PROFILES.rules,
  policySetVersion: companyPolicySetVersion(COMPANY_STARTUP_PROFILES.rules, doc),
  policySchemaRefs: [companyStartupProfile(COMPANY_STARTUP_PROFILES.rules).reference],
  effectiveFrom: '2026-10-09T00:00:00.000Z',
  policyDocument: doc,
};
describe('closed independent company startup contract registry', () => {
  it('loads exactly the three approved canonical identities and byte-identical generated artifact', () => {
    const source = readFileSync(
      new URL('../registry/company-startup-profiles.v1.json', import.meta.url),
      'utf8',
    );
    expect(
      readFileSync(new URL('./generated/company-startup-profiles.json', import.meta.url), 'utf8'),
    ).toBe(source);
    expect(loadCompanyStartupRegistry(JSON.parse(source))).toEqual(companyStartupRegistry);
    expect(companyStartupRegistry.profiles.map((p) => p.registryKey)).toEqual(
      Object.values(COMPANY_STARTUP_PROFILES),
    );
    for (const mutate of [
      (r: typeof companyStartupRegistry) => {
        r.registryVersion = 'im06-static-v1' as typeof r.registryVersion;
      },
      (r: typeof companyStartupRegistry) => {
        r.profiles.pop();
      },
      (r: typeof companyStartupRegistry) => {
        r.profiles.push(entry(r, 0));
      },
      (r: typeof companyStartupRegistry) => {
        entry(r, 0).reference = {
          ...entry(r, 0).reference,
          versionId: entry(r, 1).reference.versionId,
        };
      },
      (r: typeof companyStartupRegistry) => {
        entry(r, 0).documentSchema = { type: 'object' };
      },
    ]) {
      const r = structuredClone(companyStartupRegistry);
      mutate(r);
      expect(() => loadCompanyStartupRegistry(r)).toThrow();
    }
  });
  it('binds registry, selector, one canonical schema, derived identity and canonical UTC', () => {
    expect(() => {
      assertCompanyPayload(payload);
    }).not.toThrow();
    for (const patch of [
      { registryVersion: 'im02-static-v1' },
      { registryVersion: undefined },
      { profileKey: COMPANY_STARTUP_PROFILES.bundle },
      { policySchemaRefs: [] },
      { policySchemaRefs: [companyStartupProfile(COMPANY_STARTUP_PROFILES.bundle).reference] },
      { policySetVersion: 'caller override' },
      { effectiveFrom: '2026-02-30T00:00:00.000Z' },
      { effectiveFrom: '2026-10-09T00:00:00Z' },
      { unknownField: true },
      { policyDocument: { ...doc, customerEvidence: [] } },
    ])
      expect(() => {
        assertCompanyPayload({ ...payload, ...patch });
      }).toThrow();
  });
  it('hashes the complete immutable payload and rejects malformed new read/record/results', () => {
    const id = '01a11df5-a400-7000-8000-000000267001';
    const ref = {
      kind: 'SNAPSHOT' as const,
      objectType: 'identity.policy_snapshot',
      objectId: id,
      snapshotId: id,
      scope: {},
      contentHash: companyHash(payload),
    };
    const request = companySnapshotReadRequest(ref, COMPANY_STARTUP_PROFILES.rules);
    expect(() => {
      assertCompanySnapshotRead(request);
    }).not.toThrow();
    expect(() => {
      assertCompanySnapshotRecord({ snapshotId: id, payload });
    }).not.toThrow();
    expect(() => {
      assertCompanySnapshotView({ policySnapshotRef: ref, payload });
    }).not.toThrow();
    expect(() => {
      assertCompanySnapshotRead({
        ...request,
        policySchemaRef: companyStartupProfile(COMPANY_STARTUP_PROFILES.bundle).reference,
      });
    }).toThrow();
    expect(() => {
      assertCompanySnapshotRecord({ snapshotId: id, payload, semanticValidation: 'fabricated' });
    }).toThrow();
    expect(() => {
      assertCompanySnapshotView({
        policySnapshotRef: ref,
        payload: { ...payload, effectiveFrom: '2026-10-10T00:00:00.000Z' },
      });
    }).toThrow();
    expect(() => {
      assertCompanySnapshotRead({
        ...request,
        policySnapshotRef: { ...ref, scope: { enterpriseId: id } },
      });
    }).toThrow();
    expect(companyHash(payload)).not.toEqual(companyHash(payload.policyDocument));
  });
});

function entry(r: typeof companyStartupRegistry, index: number) {
  const value = r.profiles[index];
  if (!value) throw new Error('missing test entry');
  return value;
}
