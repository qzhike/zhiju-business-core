import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { preparationHash } from '@zhiju/contracts';
import {
  PREPARATION_CREATOR_BINDINGS,
  PREPARATION_SERVICE_BINDINGS,
  PREPARATION_SERVICE_V2_BINDINGS,
} from '@zhiju/identity-policy';
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
  it('accepts only a complete, exact v2 source capability pair while retaining the legacy mappings', () => {
    const config = deployment();
    for (const [operation] of PREPARATION_SERVICE_V2_BINDINGS)
      config.capabilityCodes[operation + '@2.0'] = 'zhiju.capability.template_source';
    expect(
      createPreparationEnvironment(dependencies(environment(config)))?.project.getSourceV2,
    ).toBeTypeOf('function');
    const one = PREPARATION_SERVICE_V2_BINDINGS[0][0] + '@2.0';
    Reflect.deleteProperty(config.capabilityCodes, one);
    expect(() => createPreparationEnvironment(dependencies(environment(config)))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
    config.capabilityCodes[one] = 'zhiju.capability.template_source';
    config.capabilityCodes['project.get_preparation_source@3.0'] = 'zhiju.capability.unknown';
    expect(() => createPreparationEnvironment(dependencies(environment(config)))).toThrow(
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

describe('explicit macOS manual-test storage assembly', () => {
  const localEnvironment = () => {
    const config = deployment();
    const local = {
      ...config,
      s3: undefined,
      localFiles: {
        mode: 'MACOS_MANUAL_TEST',
        root: '/private/tmp/environment-b-objects',
        identity: { storeId: '0199e61a-7000-7000-8000-000000000001', device: '1', inode: '1' },
      },
      companySources: config.companySources.map((source) => ({
        ...source,
        objectKey: 'company-source/' + source.sha256,
      })),
    };
    const env = environment();
    env.ZHIJU_PREPARATION_CONFIG = JSON.stringify(local);
    env.ZHIJU_WORKSPACE_DEPLOYMENT_MODE = 'MACOS_MANUAL_TEST';
    delete env.ZHIJU_PREPARATION_S3_ACCESS_KEY_ID;
    delete env.ZHIJU_PREPARATION_S3_SECRET_ACCESS_KEY;
    return env;
  };
  it('requires both the deployment opt-in and the supported host', () => {
    const env = localEnvironment();
    if (process.platform === 'darwin') {
      expect(createPreparationEnvironment(dependencies(env))?.integration.upload).toBeTypeOf(
        'function',
      );
    } else {
      expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
        'PREPARATION_CONFIGURATION_INVALID',
      );
    }
    delete env.ZHIJU_WORKSPACE_DEPLOYMENT_MODE;
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
    env.ZHIJU_WORKSPACE_DEPLOYMENT_MODE = 'PRODUCTION';
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
  });
  it('rejects ambiguous storage configuration', () => {
    const env = localEnvironment();
    const config = JSON.parse(env.ZHIJU_PREPARATION_CONFIG ?? '{}') as Record<string, unknown>;
    config.s3 = deployment().s3;
    env.ZHIJU_PREPARATION_CONFIG = JSON.stringify(config);
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
    delete config.s3;
    delete config.localFiles;
    env.ZHIJU_PREPARATION_CONFIG = JSON.stringify(config);
    expect(() => createPreparationEnvironment(dependencies(env))).toThrow(
      'PREPARATION_CONFIGURATION_INVALID',
    );
  });
});
