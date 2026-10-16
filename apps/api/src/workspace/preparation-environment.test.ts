import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { preparationHash } from '@zhiju/contracts';
import { PREPARATION_CREATOR_BINDINGS, PREPARATION_SERVICE_BINDINGS } from '@zhiju/identity-policy';
import { ZIP_LIMITS } from '@zhiju/integration-gateway';
import {
  createPreparationEnvironment,
  type PreparationEnvironmentDependencies,
} from './preparation-environment.js';
const versioned = (objectType: string) => ({
  kind: 'VERSIONED',
  objectType,
  objectId: newUuidV7(),
  versionId: newUuidV7(),
  scope: {},
});
function deployment() {
  const policy = {
    profile: 'zip-intake-limits@1',
    limits: ZIP_LIMITS,
    allowedFormats: ['DOCX', 'UTF8_MARKDOWN'],
    rejectRules: [
      'MULTI_DISK',
      'ENCRYPTED',
      'UNSAFE_PATH',
      'LINK_OR_DEVICE',
      'PATH_COLLISION',
      'CRC_MISMATCH',
      'ZIP_BOMB',
    ],
    retainOriginalBytes: true,
    noteIsUntrustedMaterial: true,
    extractorProfileRef: versioned('zhiju.integration.customer_zip_extractor'),
  };
  return {
    grantAdministrators: [newUuidV7()],
    companyRuleGrantAdministrators: [newUuidV7()],
    administratorPolicySnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: newUuidV7(),
      snapshotId: newUuidV7(),
      scope: {},
      contentHash: preparationHash({ explicit: 'authority-policy' }),
    },
    servicePrincipalId: newUuidV7(),
    enterpriseCapabilities: {
      select: 'zhiju.capability.enterprise.select',
      create: 'zhiju.capability.enterprise.create',
    },
    capabilityCodes: Object.fromEntries(
      [...PREPARATION_CREATOR_BINDINGS, ...PREPARATION_SERVICE_BINDINGS].map((row, index) => [
        row[0],
        `zhiju.capability.preparation_${index}`,
      ]),
    ),
    selection: {
      preparationPresetRef: versioned('zhiju.project.preparation_preset'),
      preparationPresetHash: preparationHash({ explicit: 'preset' }),
      publicationRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.preparation_preset_publication',
        objectId: newUuidV7(),
        scope: {},
        contentHash: preparationHash({ explicit: 'publication' }),
      },
    },
    policies: [
      {
        policyRef: versioned('zhiju.integration.customer_zip_policy'),
        payloadHash: preparationHash(policy),
        payload: policy,
      },
    ],
    s3: {
      endpoint: 'https://objects.example.test',
      bucket: 'controlled-test-bucket',
      region: 'test-1',
    },
    ticket: { activeKeyId: 'controlled-test-key' },
    companySources: [
      {
        sha256: 'ab'.repeat(32),
        objectKey: 'approved-company/template',
        locators: [{ locator: 'approved-slice', offset: 0, byteLength: 1 }],
      },
    ],
  };
}
function environment(config = deployment()): Record<string, string | undefined> {
  return {
    ZHIJU_PREPARATION_CONFIG: JSON.stringify(config),
    ZHIJU_PREPARATION_TICKET_KEYS: JSON.stringify({
      'controlled-test-key': Buffer.alloc(32, 1).toString('base64'),
    }),
    ZHIJU_PREPARATION_CURSOR_KEY: Buffer.alloc(32, 2).toString('base64'),
    ZHIJU_PREPARATION_S3_ACCESS_KEY_ID: 'controlled-test-access',
    ZHIJU_PREPARATION_S3_SECRET_ACCESS_KEY: 'controlled-test-secret',
  };
}
const dependencies = (env: Record<string, string | undefined>) =>
  ({
    env,
    identityPool: {},
    enterprisePool: {},
    integrationPool: {},
    crypto: {},
    identityResolutionDeps: () => {
      throw new Error('not called during startup');
    },
  }) as unknown as PreparationEnvironmentDependencies;
describe('Preparation deployment assembly', () => {
  it('does not touch owning dependencies when the feature document is absent', () => {
    expect(
      createPreparationEnvironment({ env: {} } as PreparationEnvironmentDependencies),
    ).toBeUndefined();
  });
  it('assembles actual owning services from the complete explicit deployment document without creating business facts', () => {
    const result = createPreparationEnvironment(dependencies(environment()));
    expect(result?.project.request).toBeTypeOf('function');
    expect(result?.integration.upload).toBeTypeOf('function');
    expect(result?.project.queryHandoff).toBeTypeOf('function');
  });
  it.each([
    'ZHIJU_PREPARATION_TICKET_KEYS',
    'ZHIJU_PREPARATION_CURSOR_KEY',
    'ZHIJU_PREPARATION_S3_ACCESS_KEY_ID',
    'ZHIJU_PREPARATION_S3_SECRET_ACCESS_KEY',
  ])('rejects missing %s at startup', (key) => {
    const env = environment();
    env[key] = undefined;
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
  });
  it.each(['{"password":"DO_NOT_EXPOSE"}', '{', 'null', ''])(
    'reports only a fixed code for an invalid deployment document',
    (raw) => {
      let observed: unknown;
      try {
        createPreparationEnvironment(
          dependencies({ ...environment(), ZHIJU_PREPARATION_CONFIG: raw }),
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect((observed as Error).message).toBe('PREPARATION_CONFIGURATION_INVALID');
      if (raw) expect(String(observed)).not.toContain(raw);
    },
  );
  it('rejects a secret embedded in the closed nonsecret deployment document', () => {
    const config = { ...deployment(), ticketSecret: 'DO_NOT_EXPOSE' };
    expect(() =>
      createPreparationEnvironment(
        dependencies({ ...environment(), ZHIJU_PREPARATION_CONFIG: JSON.stringify(config) }),
      ),
    ).toThrow('PREPARATION_CONFIGURATION_INVALID');
  });
  it('does not accept a short cursor secret or malformed historical ticket key', () => {
    const env = environment();
    env.ZHIJU_PREPARATION_CURSOR_KEY = Buffer.alloc(16).toString('base64');
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
    const second = environment();
    second.ZHIJU_PREPARATION_TICKET_KEYS = JSON.stringify({ 'controlled-test-key': 'bad' });
    expect(() => createPreparationEnvironment(dependencies(second))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
  });
  it('requires all operation capability mappings to be explicit', () => {
    const config = deployment();
    delete config.capabilityCodes['project.preparation.handoff.read'];
    expect(() => createPreparationEnvironment(dependencies(environment(config)))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
  });
});
