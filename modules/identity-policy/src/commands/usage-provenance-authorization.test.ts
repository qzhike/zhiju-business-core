import { describe, expect, it } from 'vitest';

import type { IdentityCommandDeps } from './actor-snapshot.js';
import {
  createUsageProvenanceAuthorizationPort,
  IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
  USAGE_PROVENANCE_BINDINGS,
  type ControlledFirstRunAuthorizationInput,
  type ControlledFirstRunRevalidationInput,
  type UsageProvenanceAuthorizationConfig,
  type UsageProvenanceCapabilityKey,
} from './work-order-validation-authorization.js';

// Every assertion here stays in front of the trusted transaction: the Port's
// key/operation/version resolution fails closed before it touches `deps`, so a
// structurally empty dependency object is enough. Any request that slipped
// past those gates would fail loudly on the missing transaction context rather
// than silently authorize.

/** The six approved Spec 001 §15.18 rows, transcribed here instead of imported. */
interface ApprovedRow {
  readonly capabilityConfigKey: UsageProvenanceCapabilityKey;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: string;
  readonly expectedPrincipalKind: 'HUMAN' | 'SERVICE';
  readonly forbidActingFor: boolean;
}

const approved: readonly ApprovedRow[] = [
  {
    capabilityConfigKey: 'runUsageProvenanceReadHumanV1',
    commandType: 'execution.get_usage_and_provenance',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_usage_and_provenance',
    requiredGrantAction: 'execution.run.usage_provenance.read.v1',
    targetObjectTypes: ['execution.run'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
  },
  {
    capabilityConfigKey: 'runUsageProvenanceSourceReadV1',
    commandType: 'execution.run.usage_provenance.source.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.run.usage_provenance.source.read.v1',
    requiredGrantAction: 'execution.run.usage_provenance.source.read.v1',
    targetObjectTypes: ['execution.run'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'usageProvenanceContractReadV1',
    commandType: 'execution.get_work_order_contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_usage_provenance.v1',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'usageProvenanceBindingReadV1',
    commandType: 'integration.get_runtime_attempt_binding',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.binding.read',
    requiredGrantAction: 'integration.runtime.binding.read.for_usage_provenance.v1',
    targetObjectTypes: ['integration.runtime_attempt'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'usageProvenanceAdapterIdentityReadV1',
    commandType: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    requiredGrantAction: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    targetObjectTypes: ['integration.runtime_attempt'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'usageProvenanceFinalReadV1',
    commandType: 'integration.get_runtime_final_observation',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.final_observation.read',
    requiredGrantAction: 'integration.runtime.final.read.for_usage_provenance.v1',
    targetObjectTypes: ['integration.runtime_attempt'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
];

const capabilityCodes: Readonly<Record<UsageProvenanceCapabilityKey, string>> = {
  runUsageProvenanceReadHumanV1: 'execution.run.usage_provenance.read.v1',
  runUsageProvenanceSourceReadV1: 'execution.run.usage_provenance.source.read.v1',
  usageProvenanceContractReadV1: 'execution.work_order.contract.read.for_usage_provenance.v1',
  usageProvenanceBindingReadV1: 'integration.runtime.binding.read.for_usage_provenance.v1',
  usageProvenanceAdapterIdentityReadV1:
    'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
  usageProvenanceFinalReadV1: 'integration.runtime.final.read.for_usage_provenance.v1',
};

/** The Port under test; the resolution gates run before `deps` is read. */
function port(codes: unknown = capabilityCodes) {
  return createUsageProvenanceAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as UsageProvenanceAuthorizationConfig);
}

const pureDeps = {} as unknown as IdentityCommandDeps;

function approvedRow(capabilityConfigKey: UsageProvenanceCapabilityKey): ApprovedRow {
  const found = approved.find((row) => row.capabilityConfigKey === capabilityConfigKey);
  if (found === undefined)
    throw new Error(`unapproved usage-provenance key ${capabilityConfigKey}`);
  return found;
}

const humanRow = approvedRow('runUsageProvenanceReadHumanV1');

function authorizeInput(row: ApprovedRow): ControlledFirstRunAuthorizationInput {
  return {
    commandType: row.commandType,
    commandVersion: row.commandVersion,
  } as unknown as ControlledFirstRunAuthorizationInput;
}

function revalidationInput(row: ApprovedRow): ControlledFirstRunRevalidationInput {
  return {
    expectedCommandType: row.commandType,
    expectedCommandVersion: row.commandVersion,
  } as unknown as ControlledFirstRunRevalidationInput;
}

function projection(rows: readonly (typeof USAGE_PROVENANCE_BINDINGS)[number][]): string[] {
  return rows
    .map(
      (row) =>
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.expectedPrincipalKind ?? ''}|${row.forbidActingFor === true ? 'forbidActingFor' : ''}`,
    )
    .sort();
}

function specProjection(rows: readonly ApprovedRow[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|OBJECT|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.expectedPrincipalKind}|${row.forbidActingFor ? 'forbidActingFor' : ''}`,
    )
    .sort();
}

describe('approved usage-provenance authorization bindings', () => {
  it('publishes exactly the six Spec 001 §15.18 rows and nothing else', () => {
    expect(USAGE_PROVENANCE_BINDINGS).toHaveLength(approved.length);
    expect(projection(USAGE_PROVENANCE_BINDINGS)).toEqual(specProjection(approved));
  });

  it('binds each config key exactly once and never shares a target kind freely', () => {
    const keys = USAGE_PROVENANCE_BINDINGS.map((row) => row.capabilityConfigKey);
    expect(new Set(keys).size).toBe(approved.length);
    expect([...keys].sort()).toEqual(approved.map((row) => row.capabilityConfigKey).sort());
  });

  it('keeps the two same-Purpose WorkOrder-contract-consumers distinct in action', () => {
    // The Human read consumes a different Purpose than the frozen Contract
    // read; the Contract read reuses the registered `task.execution.…` Purpose
    // but owns its own action, and no entry may inherit another's action.
    const actions = USAGE_PROVENANCE_BINDINGS.map((row) => row.requiredGrantAction);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe('usage-provenance authorization: exact key resolution', () => {
  it('refuses an unknown or non-exact key', async () => {
    for (const key of [
      'runUsageProvenanceRead',
      'runUsageProvenanceReadHuman',
      'runUsageProvenanceReadHumanV2',
      'runUsageProvenanceReadHumanV1 ',
      'RUNUSAGEPROVENANCEREADHUMANV1',
      'usageProvenanceContractRead',
      '',
      '*',
      'latest',
    ]) {
      await expect(
        port().authorize(pureDeps, key as UsageProvenanceCapabilityKey, authorizeInput(humanRow)),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      await expect(
        port().revalidate(
          pureDeps,
          key as UsageProvenanceCapabilityKey,
          revalidationInput(humanRow),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses a wrong operation or version for every approved key', async () => {
    for (const row of approved) {
      await expect(
        port().authorize(pureDeps, row.capabilityConfigKey, {
          ...authorizeInput(row),
          commandType: `${row.commandType}.alias`,
        }),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      for (const commandVersion of ['1', '2.0', '1.0.0', 'v1.0', '']) {
        await expect(
          port().authorize(pureDeps, row.capabilityConfigKey, {
            ...authorizeInput(row),
            commandVersion,
          }),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      }
      await expect(
        port().revalidate(pureDeps, row.capabilityConfigKey, {
          ...revalidationInput(row),
          expectedCommandVersion: '2.0',
        }),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('never substitutes one key for another approved entry', async () => {
    for (const outer of approved) {
      for (const inner of approved) {
        if (outer.capabilityConfigKey === inner.capabilityConfigKey) continue;
        await expect(
          port().authorize(pureDeps, outer.capabilityConfigKey, authorizeInput(inner)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
        await expect(
          port().revalidate(pureDeps, outer.capabilityConfigKey, revalidationInput(inner)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      }
    }
  });
});
