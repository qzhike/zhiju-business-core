import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
import { getContractRegistry } from './registry.js';
import {
  D14LockRejection,
  D14_RUNNER_EXECUTION_LOCK_TYPE,
  D14_RUNNER_EXECUTION_LOCK_VERSION,
  assertD14RunnerLockIsInternalDescriptor,
  d14ApprovedConfigurationHash,
  d14ConfigurationPolicyErrors,
  d14InstallationObservationHash,
  d14MaterializedLockHash,
  d14RunnerExecutionLockDescriptor,
  produceD14RunnerExecutionLock,
  validateApprovedConfiguration,
  validateInstallationObservation,
  validateMaterializedLock,
  verifyD14MaterializedLockHash,
  type D14ApprovedConfiguration,
  type D14InstallationObservation,
  type D14LockProductionInput,
  type D14MaterializedLock,
  type D14MaterializedLockPayload,
} from './d14-runner-execution-lock.js';

const directory = new URL(
  '../../tests/fixtures/contracts/d14-runner-execution-lock/',
  import.meta.url,
);
const invalidDirectory = new URL('invalid/', directory);

function readJson(base: URL, name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, base), 'utf8'));
}

const approvedConfiguration = readJson(
  directory,
  'approved-configuration-valid.json',
) as D14ApprovedConfiguration;
const installationObservation = readJson(
  directory,
  'installation-observation-valid.json',
) as D14InstallationObservation;
const producerInput = readJson(directory, 'producer-input-valid.json') as D14LockProductionInput;
const materializedLockFixture = readJson(
  directory,
  'materialized-lock-valid.json',
) as D14MaterializedLock;

const produced = produceD14RunnerExecutionLock(producerInput);
const payload = producerInput.lockPayload as D14MaterializedLockPayload;

/**
 * Every invalid standalone fixture is a complete producer input, so the expected
 * rejection code is asserted against the real boundary rather than a paraphrase.
 */
const INVALID_FIXTURES: Readonly<Record<string, string>> = {
  'approved-configuration-extra-tool.json': 'D14_LOCK_TOOL_SURFACE_VIOLATION',
  'approved-configuration-nonempty-mcp.json': 'D14_LOCK_TOOL_SURFACE_VIOLATION',
  'approved-configuration-missing-allowlist.json': 'D14_LOCK_SCHEMA_INVALID',
  'approved-configuration-fallback-enabled.json': 'D14_LOCK_SCHEMA_INVALID',
  'approved-configuration-unsupported-control.json': 'D14_LOCK_CONTROL_UNSUPPORTED',
  'approved-configuration-tampered-hash.json': 'D14_LOCK_LAYER_HASH_MISMATCH',
  'installation-observation-darwin.json': 'D14_LOCK_OBSERVATION_NOT_DEPLOYMENT',
  'materialized-lock-unknown-field.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-unknown-version.json': 'D14_LOCK_VERSION_UNSUPPORTED',
  'materialized-lock-executable-override.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-missing-model-version-proof.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-prompt-bytes-missing.json': 'D14_LOCK_PIN_MISSING',
  'materialized-lock-wrong-scope.json': 'D14_LOCK_SCOPE_CONFLICT',
  'materialized-lock-empty-fencing.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-contenthash-slot-substitution.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-bytes-slot-substitution.json': 'D14_LOCK_SCHEMA_INVALID',
  'materialized-lock-floating-alias.json': 'D14_LOCK_REFERENCE_INVALID',
  'materialized-lock-wrong-approval-binding.json': 'D14_LOCK_BINDING_MISMATCH',
  'materialized-lock-customer-configuration-path.json': 'D14_LOCK_CUSTOMER_CONFIGURATION_REJECTED',
  'materialized-lock-secret-material.json': 'D14_LOCK_SECRET_MATERIAL_REJECTED',
  'materialized-lock-expired-validity.json': 'D14_LOCK_ELIGIBILITY_FAILED',
  'materialized-lock-inverted-validity.json': 'D14_LOCK_BINDING_MISMATCH',
};

describe('D14 Runner execution lock is an internal descriptor', () => {
  it('is never a public operation or a registered TypedReference', () => {
    expect(() => {
      assertD14RunnerLockIsInternalDescriptor(publicApiOperations);
    }).not.toThrow();
    const registeredTypes: readonly string[] = publicApiOperations.map(
      (operation) => operation.type,
    );
    expect(registeredTypes).not.toContain(D14_RUNNER_EXECUTION_LOCK_TYPE);
    expect(
      getContractRegistry().getOperation(D14_RUNNER_EXECUTION_LOCK_TYPE, '1.0'),
    ).toBeUndefined();
    expect(d14RunnerExecutionLockDescriptor()).toEqual({
      type: D14_RUNNER_EXECUTION_LOCK_TYPE,
      version: D14_RUNNER_EXECUTION_LOCK_VERSION,
      profileCode: 'd14.analysis@1',
      publicOperation: false,
      registeredTypedReference: false,
    });
  });
});

describe('D14 Runner execution lock producer', () => {
  it('reproduces the standalone complete lock and its pinned hash', () => {
    expect(produced).toEqual(materializedLockFixture);
    expect(produced.lockHash.digest).toBe(d14MaterializedLockHash(payload).digest);
    expect(verifyD14MaterializedLockHash(produced)).toBe(true);
    expect(validateMaterializedLock(produced)).toEqual({ valid: true });
  });

  it('validates the three layers separately', () => {
    expect(validateApprovedConfiguration(approvedConfiguration)).toEqual({ valid: true });
    expect(validateInstallationObservation(installationObservation)).toEqual({ valid: true });
    expect(d14ConfigurationPolicyErrors(approvedConfiguration)).toEqual([]);
    expect(approvedConfiguration.configurationHash.digest).toBe(
      d14ApprovedConfigurationHash(approvedConfiguration).digest,
    );
    expect(installationObservation.observationHash.digest).toBe(
      d14InstallationObservationHash(installationObservation).digest,
    );
  });

  it('is deterministic and deeply frozen, so an old lock cannot be rewritten in place', () => {
    expect(produceD14RunnerExecutionLock(producerInput)).toEqual(produced);
    for (const node of [produced, produced.boundary, produced.boundary.scope.run]) {
      expect(Object.isFrozen(node)).toBe(true);
    }
    expect(() => {
      Object.assign(produced.runtime, { parserVersion: '2.0' });
    }).toThrow();
    expect(produced.runtime.parserVersion).toBe('1.0');
  });

  it('gives a changed pin, configuration or validity a new identity instead of overwriting', () => {
    const changedPin: D14MaterializedLockPayload = {
      ...payload,
      runtime: { ...payload.runtime, parserVersion: '1.1' },
    };
    expect(d14MaterializedLockHash(changedPin).digest).not.toBe(
      d14MaterializedLockHash(payload).digest,
    );

    const changedConfiguration: D14ApprovedConfiguration = {
      ...approvedConfiguration,
      model: { ...approvedConfiguration.model, maxTurns: 25 },
    };
    const changedConfigurationHash = d14ApprovedConfigurationHash(changedConfiguration);
    expect(changedConfigurationHash.digest).not.toBe(
      approvedConfiguration.configurationHash.digest,
    );

    // The old lock payload still binds the old configuration hash, so it cannot
    // silently adopt a revised configuration: a new lock identity is required.
    const rebased = {
      ...producerInput,
      approvedConfiguration: {
        ...changedConfiguration,
        configurationHash: changedConfigurationHash,
      },
    };
    expect(() => produceD14RunnerExecutionLock(rebased)).toThrow(D14LockRejection);
  });

  it('signed hash domains stay separate: an own hash never enters its own payload', () => {
    const withOwnHash = {
      ...payload,
      lockHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'f'.repeat(64) },
    };
    expect(d14MaterializedLockHash(withOwnHash).digest).toBe(
      d14MaterializedLockHash(payload).digest,
    );
    const withOtherApproval = {
      ...payload,
      identity: {
        ...payload.identity,
        technicalApproval: {
          ...payload.identity.technicalApproval,
          contentHash: {
            ...payload.identity.technicalApproval.contentHash,
            digest: 'a'.repeat(64),
          },
        },
      },
    };
    expect(d14MaterializedLockHash(withOtherApproval).digest).not.toBe(
      d14MaterializedLockHash(payload).digest,
    );
    expect(
      d14ApprovedConfigurationHash({
        ...approvedConfiguration,
        configurationHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: '1'.repeat(64),
        },
      }).digest,
    ).toBe(approvedConfiguration.configurationHash.digest);
  });

  it('rejects a pin-tampered lock whose declared hash no longer signs the payload', () => {
    const tampered = {
      ...materializedLockFixture,
      runtime: { ...materializedLockFixture.runtime, parserVersion: '9.9' },
    };
    expect(verifyD14MaterializedLockHash(tampered)).toBe(false);
    const result = validateMaterializedLock(tampered);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors[0]?.keyword).toBe('d14LockHash');
  });
});

describe('D14 Runner execution lock negative fixtures', () => {
  const present = readdirSync(invalidDirectory).sort();
  it('covers every declared invalid fixture exactly once', () => {
    expect(present).toEqual(Object.keys(INVALID_FIXTURES).sort());
  });
  for (const name of present) {
    it(`${name} is rejected with ${INVALID_FIXTURES[name] ?? 'a declared code'}`, () => {
      const candidate = readJson(invalidDirectory, name) as D14LockProductionInput;
      let code: string | undefined;
      try {
        produceD14RunnerExecutionLock(candidate);
      } catch (error) {
        code = error instanceof D14LockRejection ? error.code : `unexpected:${String(error)}`;
      }
      expect(code).toBe(INVALID_FIXTURES[name]);
    });
  }
});

describe('D14 model/tool/control policy validator', () => {
  /** Test-only mutable clone of the approved configuration fixture. */
  function mutableConfiguration(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(new URL('approved-configuration-valid.json', directory), 'utf8'),
    ) as Record<string, unknown>;
  }

  it('distinguishes a missing allowlist from an empty one', () => {
    const missing = mutableConfiguration();
    delete missing.mcpAllowlist;
    const missingResult = validateApprovedConfiguration(missing);
    expect(missingResult.valid).toBe(false);
    if (missingResult.valid) throw new Error('unreachable');
    expect(missingResult.errors.some((error) => error.keyword === 'required')).toBe(true);

    const empty = validateApprovedConfiguration({ ...approvedConfiguration, mcpAllowlist: [] });
    expect(empty).toEqual({ valid: true });

    const nonEmpty = validateApprovedConfiguration({
      ...approvedConfiguration,
      mcpAllowlist: ['customer-mcp'],
    });
    expect(nonEmpty.valid).toBe(false);
    if (nonEmpty.valid) throw new Error('unreachable');
    expect(nonEmpty.errors.some((error) => error.keyword === 'd14ToolSurface')).toBe(true);
  });

  it('enforces the approved model identity, tool surface, disabled capabilities and controls', () => {
    const modelIdentity = mutableConfiguration();
    const model = modelIdentity.model as Record<string, unknown>;
    model.approvedModelVersion = 'DeepSeek-V4.1-Flash-preview';

    const extraTool = mutableConfiguration();
    const toolSurface = extraTool.toolSurface as Record<string, unknown>;
    toolSurface.allowedTools = ['read', 'grep', 'glob', 'write', 'bash'];

    const fallbackEnabled = mutableConfiguration();
    const capabilities = fallbackEnabled.disabledCapabilities as Record<string, unknown>;
    capabilities.fallback = 'ENABLED';

    const unsupportedControl = mutableConfiguration();
    const controlPolicy = unsupportedControl.controlPolicy as Record<string, unknown>;
    controlPolicy.supportedControls = [
      'HOST_HEARTBEAT',
      'CLI_PROGRESS',
      'PROVIDER_USAGE',
      'record_run_suspension',
    ];

    const cases: readonly [string, Record<string, unknown>, string][] = [
      ['model identity', modelIdentity, 'const'],
      ['extra tool', extraTool, 'd14ToolSurface'],
      ['fallback enabled', fallbackEnabled, 'const'],
      ['unsupported control', unsupportedControl, 'd14ControlPolicy'],
    ];
    for (const [label, variant, keyword] of cases) {
      const result = validateApprovedConfiguration(variant);
      expect(result.valid, label).toBe(false);
      if (result.valid) throw new Error('unreachable');
      expect(
        result.errors.some((error) => error.keyword === keyword),
        `${label}: ${JSON.stringify(result.errors)}`,
      ).toBe(true);
    }
    // The identity constants are also enforced by the policy validator itself,
    // which is the layer a caller sees when it validates an already-decoded value.
    const identityErrors = d14ConfigurationPolicyErrors(
      modelIdentity as unknown as D14ApprovedConfiguration,
    );
    expect(identityErrors.map((error) => error.keyword)).toContain('d14ModelVersion');
    expect(d14ConfigurationPolicyErrors(approvedConfiguration)).toEqual([]);
  });
});
