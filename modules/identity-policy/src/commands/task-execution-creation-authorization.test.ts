import { describe, expect, it } from 'vitest';
import type { Common } from '@zhiju/contracts';

import {
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  type IdentityCommandDeps,
} from './actor-snapshot.js';
import type { IdentityTransactionContext } from '../persistence/identity-db.js';
import {
  createTaskExecutionCreationAuthorizationPort,
  IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CREATION_TARGET_INVALID,
  TASK_EXECUTION_CREATION_BINDINGS,
  type TaskExecutionCreationAuthorizationConfig,
  type TaskExecutionCreationAuthorizationInput,
  type TaskExecutionCreationBinding,
  type TaskExecutionCreationRevalidationInput,
} from './task-execution-creation-authorization.js';

// Every refusal below happens before the trusted transaction is opened: an
// unknown creation version, an unusable trusted configuration, a malformed or
// substituted CREATE target, a foreign actor snapshot and an invalid request
// hash all fail closed in front of the database. The `deps` stub therefore
// carries only the trusted transaction context — a request that slipped past
// those gates would fail loudly on the missing `db`/`repo` instead of silently
// authorizing. The accepted continuation of each approved version is asserted
// through the exact gate it reaches, which is what these tests can observe.

/** The approved Spec 001 §15.1 rows, transcribed here instead of imported. */
const approved = [
  {
    commandType: 'execution.create_task',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.create_task',
    requiredGrantAction: 'execution.task.create.v1',
    targetObjectType: 'execution.task',
    capabilityConfigKey: 'taskV1',
  },
  {
    commandType: 'execution.create_task',
    commandVersion: '2.0',
    authorizationPurpose: 'execution.task.create',
    requiredGrantAction: 'execution.task.create.v2',
    targetObjectType: 'zhiju.execution.task',
    capabilityConfigKey: 'taskV2',
  },
  {
    commandType: 'execution.create_work_order',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.create_work_order',
    requiredGrantAction: 'execution.work_order.create.v1',
    targetObjectType: 'execution.work_order',
    capabilityConfigKey: 'workOrderV1',
  },
  {
    commandType: 'execution.create_work_order',
    commandVersion: '1.1',
    authorizationPurpose: 'task.execution.create_work_order',
    requiredGrantAction: 'execution.work_order.create.v1_1',
    targetObjectType: 'zhiju.execution.work_order',
    capabilityConfigKey: 'workOrderV11',
  },
] as const;

type CapabilityKey = TaskExecutionCreationBinding['capabilityConfigKey'];

const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d001';
const foreignEnterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d002';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d011';
const foreignProjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d012';
const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d003';
const actorSnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d004';
const authorizationDecisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d005';
const correlationId = '018f22e2-7c15-7b2e-8d86-2de956a9d006';
const targetObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d021';

/** The exact Project Scope one creation request runs in. */
const projectScope: Common.ScopeRef = { enterpriseId, projectId };

const context: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId,
  actorSnapshotId,
  authorizationDecisionId,
  authorizationDecisionHash: Buffer.alloc(32, 1),
  authorizationDecisionExpiresAt: new Date('2026-09-15T00:00:00.000Z'),
  enterpriseId,
  allowedProjectIds: [projectId],
  correlationId,
};

const deps = { context } as unknown as IdentityCommandDeps;

/** One capability code per approved version, all distinct and all valid. */
const capabilityCodes: Readonly<Record<CapabilityKey, string>> = {
  taskV1: 'execution.task.create',
  taskV2: 'execution.task.create.v2',
  workOrderV1: 'execution.work_order.create',
  workOrderV11: 'execution.work_order.create.v1_1',
};

/** The union shape is unrepresentable for the malformed configurations below. */
function port(codes: unknown = capabilityCodes) {
  return createTaskExecutionCreationAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as TaskExecutionCreationAuthorizationConfig);
}

/** A trusted configuration in which only one approved version is usable. */
function portWithOnlyUsable(key: CapabilityKey) {
  const codes: Record<string, unknown> = {};
  for (const candidate of Object.keys(capabilityCodes)) codes[candidate] = '';
  codes[key] = capabilityCodes[key];
  return port(codes);
}

function contentHash(seed: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, seed).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function approvedRow(commandType: string, commandVersion: string): (typeof approved)[number] {
  const found = approved.find(
    (candidate) =>
      candidate.commandType === commandType && candidate.commandVersion === commandVersion,
  );
  if (found === undefined) {
    throw new Error(`unapproved creation version ${commandType}@${commandVersion}`);
  }
  return found;
}

function targetRef(
  objectType: string,
  objectId: string = targetObjectId,
  scope: Common.ScopeRef = projectScope,
): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

function actorSnapshotRef(scope: Common.ScopeRef = projectScope): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: actorSnapshotId,
    snapshotId: actorSnapshotId,
    scope,
    contentHash: contentHash(2),
  };
}

/** A structurally complete creation request of one approved version. */
function validInput(
  commandType: string,
  commandVersion: string,
): TaskExecutionCreationAuthorizationInput {
  const row = approvedRow(commandType, commandVersion);
  return {
    actorSnapshotRef: actorSnapshotRef(),
    commandType: row.commandType,
    commandVersion: row.commandVersion,
    targetRef: targetRef(row.targetObjectType),
    commandPayloadHash: Buffer.alloc(32, 3),
    authenticationContextHash: Buffer.alloc(32, 4),
  };
}

/** The same request with one substituted member, which the type cannot express. */
function creationInput(
  commandType: string,
  commandVersion: string,
  overrides: Readonly<Record<string, unknown>> = {},
): TaskExecutionCreationAuthorizationInput {
  return {
    ...validInput(commandType, commandVersion),
    ...overrides,
  };
}

/** A structurally complete revalidation request of one approved version. */
function validRevalidationInput(
  commandType: string,
  commandVersion: string,
): TaskExecutionCreationRevalidationInput {
  const input = validInput(commandType, commandVersion);
  return {
    decisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: authorizationDecisionId,
      scope: projectScope,
      contentHash: contentHash(5),
    },
    expectedCommandType: input.commandType,
    expectedCommandVersion: input.commandVersion,
    expectedCommandPayloadHash: input.commandPayloadHash,
    expectedAuthenticationContextHash: input.authenticationContextHash,
    expectedTargetRef: input.targetRef,
  };
}

function projection(rows: readonly TaskExecutionCreationBinding[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetObjectType}|${row.capabilityConfigKey}`,
    )
    .sort();
}

describe('approved creation authorization bindings', () => {
  it('publishes exactly the four approved rows and nothing else', () => {
    expect(TASK_EXECUTION_CREATION_BINDINGS).toHaveLength(approved.length);
    expect(projection(TASK_EXECUTION_CREATION_BINDINGS)).toEqual(projection(approved));
  });
});

describe('creation authorization: exact creation version', () => {
  it('refuses an unknown operation, the historical alias and a case variant', async () => {
    for (const commandType of [
      'execution.work_order.create',
      'execution.create_work_orders',
      'execution.create_task_v2',
      'execution.create_work_order_v11',
      'execution.freeze_task',
      'execution',
      'executions.create_task',
      'Execution.create_task',
      'execution.Create_Task',
      'EXECUTION.CREATE_TASK',
      ' execution.create_task',
      'execution.create_task ',
      '\texecution.create_task',
      'execution.create_task@2.0',
      'execution.create_task?version=1.0',
      '',
      '*',
      'execution.*',
      'latest',
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses a non-string operation', async () => {
    for (const commandType of [undefined, null, 1, true, {}, ['execution.create_task']]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses an unknown, missing or non-exact version without a fallback', async () => {
    for (const commandVersion of [
      '1',
      '2',
      '3.0',
      '1.0.0',
      '01.0',
      '1.00',
      'v1.0',
      'V1.0',
      '1.0 ',
      ' 1.0',
      '1.0\n',
      '',
      '*',
      '1.x',
      '^1.0',
      'latest',
      'LATEST',
      'stable',
      undefined,
      null,
      2,
      true,
      { toString: (): string => '2.0' },
      ['2.0'],
    ]) {
      for (const commandType of ['execution.create_task', 'execution.create_work_order']) {
        await expect(
          port().authorizeCreation(deps, creationInput(commandType, '1.0', { commandVersion })),
        ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
      }
    }
  });

  it('never lets one WorkOrder version fall back to the other', async () => {
    // Each version accepts only its own CREATE target type. A fallback to the
    // other binding would accept this exact object type and stop later, at the
    // request-hash gate, instead of refusing the target here.
    await expect(
      port().authorizeCreation(
        deps,
        creationInput('execution.create_work_order', '1.0', {
          targetRef: targetRef('zhiju.execution.work_order'),
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    await expect(
      port().authorizeCreation(
        deps,
        creationInput('execution.create_work_order', '1.1', {
          targetRef: targetRef('execution.work_order'),
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
  });

  it('never lets one Task major fall back to the other', async () => {
    await expect(
      port().authorizeCreation(
        deps,
        creationInput('execution.create_task', '1.0', {
          targetRef: targetRef('zhiju.execution.task'),
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    await expect(
      port().authorizeCreation(
        deps,
        creationInput('execution.create_task', '2.0', {
          targetRef: targetRef('execution.task'),
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
  });
});

describe('creation authorization: trusted capability configuration', () => {
  it('refuses a missing, blank or non-NamespaceCode capability code of any version', async () => {
    const unusable: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Task.V1',
      'task v1',
      'task\tv1',
      '1task',
      'task..v1',
      'task-v1',
      '.task',
      'task.',
      '_task',
      'task.v1.',
      'TASK.V1',
      'task/v1',
      'task.v1@2',
      42,
      ['task.v1'],
      { code: 'task.v1' },
    ];
    for (const row of approved) {
      for (const value of unusable) {
        const codes: Record<string, unknown> = { ...capabilityCodes };
        codes[row.capabilityConfigKey] = value;
        await expect(
          port(codes).authorizeCreation(deps, validInput(row.commandType, row.commandVersion)),
        ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
      }
      // The same trusted configuration without that key at all.
      const withoutKey: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(capabilityCodes)) {
        if (key !== row.capabilityConfigKey) withoutKey[key] = value;
      }
      await expect(
        port(withoutKey).authorizeCreation(deps, validInput(row.commandType, row.commandVersion)),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses an empty trusted configuration of every version', async () => {
    for (const row of approved) {
      await expect(
        port({}).authorizeCreation(deps, validInput(row.commandType, row.commandVersion)),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses a configuration object that carries no capability codes instead of crashing', async () => {
    for (const codes of [
      {},
      { capabilityCodes: undefined },
      { capabilityCodes: null },
      { capabilityCodes: 'execution.task.create' },
      { capabilityCodes: [] },
      { now: (): Date => new Date('2026-09-15T00:00:00.000Z') },
    ]) {
      await expect(
        port(codes).authorizeCreation(deps, validInput('execution.create_task', '1.0')),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('binds each approved version to its own trusted configuration key', async () => {
    for (const row of approved) {
      // Its own trusted key carries the request past the configuration gate to
      // the request-hash gate, which is the gate directly behind it.
      await expect(
        portWithOnlyUsable(row.capabilityConfigKey).authorizeCreation(
          deps,
          creationInput(row.commandType, row.commandVersion, {
            commandPayloadHash: Buffer.alloc(31, 9),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });

      // A configuration that holds a code only for another version authorizes
      // nothing here: the resolved version never reads a neighbouring key.
      for (const other of approved) {
        if (other.capabilityConfigKey === row.capabilityConfigKey) continue;
        await expect(
          portWithOnlyUsable(other.capabilityConfigKey).authorizeCreation(
            deps,
            validInput(row.commandType, row.commandVersion),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
      }
    }
  });
});

describe('creation authorization: CREATE target reference', () => {
  it('refuses the approved object type of another version', async () => {
    for (const row of approved) {
      for (const other of approved) {
        if (other.targetObjectType === row.targetObjectType) continue;
        await expect(
          port().authorizeCreation(
            deps,
            creationInput(row.commandType, row.commandVersion, {
              targetRef: targetRef(other.targetObjectType),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
      }
    }
  });

  it('refuses an object type that no approved version authorizes', async () => {
    for (const objectType of [
      'execution.work_order_draft',
      'execution.task.v1',
      'Execution.task',
      'zhiju.execution.tasks',
      'execution',
      '*',
      '',
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { targetRef: targetRef(objectType) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    }
  });

  it('refuses a target id that is not a UuidV7', async () => {
    for (const objectId of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d021',
      '018f22e2-7c15-7b2e-cd86-2de956a9d021',
      '018f22e2-7c15-7b2e-8d86-2de956a9d02',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D021',
      '018f22e2-7c15-7b2e-8d86-2de956a9d021 ',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0210',
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', {
            targetRef: targetRef('execution.task', objectId),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    }
  });

  it('refuses a reference that is not an exact OBJECT reference', async () => {
    for (const kind of ['CONTENT_ADDRESSED', 'VERSIONED', 'SNAPSHOT', 'object', '', undefined]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', {
            targetRef: { ...targetRef('execution.task'), kind },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    }
    for (const target of [undefined, null, 'execution.task', 42]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { targetRef: target }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    }
  });

  it('refuses a scope that is not the exact Project Scope of the version', async () => {
    for (const scope of [
      undefined,
      null,
      {},
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId, scopeKind: 'PROJECT' },
      { enterpriseId, projectId, extra: undefined },
      { enterpriseId: foreignEnterpriseId, projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId: foreignProjectId },
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', {
            targetRef: { ...targetRef('execution.task'), scope },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    }
  });
});

describe('creation authorization: actor snapshot and request facts', () => {
  it('refuses an actor snapshot outside the exact creation Project', async () => {
    for (const scope of [
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      {},
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', {
            actorSnapshotRef: { ...actorSnapshotRef(), scope },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses an actor snapshot that is not an exact snapshot reference', async () => {
    for (const actorSnapshot of [
      undefined,
      null,
      { ...actorSnapshotRef(), kind: 'OBJECT' },
      { ...actorSnapshotRef(), objectType: 'identity.authorization_decision' },
      { ...actorSnapshotRef(), objectId: 'abc' },
      { ...actorSnapshotRef(), snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d022' },
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { actorSnapshotRef: actorSnapshot }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses a request hash that is not a SHA-256 digest', async () => {
    for (const hash of [
      Buffer.alloc(31, 3),
      Buffer.alloc(33, 3),
      Buffer.alloc(0),
      Buffer.alloc(64, 3),
      Buffer.from('03'.repeat(32), 'hex').toString('hex'),
      'a'.repeat(64),
      undefined,
      null,
    ]) {
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { commandPayloadHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      await expect(
        port().authorizeCreation(
          deps,
          creationInput('execution.create_task', '1.0', { authenticationContextHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });
});

describe('creation revalidation', () => {
  it('refuses an unsupported expected creation version before reading any decision', async () => {
    const unsupportedVersionKeys: readonly (readonly [unknown, unknown])[] = [
      ['execution.work_order.create', '1.0'],
      ['execution.create_task', '3.0'],
      ['execution.create_task', '1'],
      ['execution.create_work_order', '2.0'],
      ['Execution.create_task', '1.0'],
      [' execution.create_task', '1.0'],
      ['execution.create_task', '*'],
      ['execution.create_task', 'latest'],
      [undefined, '1.0'],
      ['execution.create_task', undefined],
      [2, 1],
    ];
    for (const [expectedCommandType, expectedCommandVersion] of unsupportedVersionKeys) {
      const input = {
        ...validRevalidationInput('execution.create_task', '1.0'),
        expectedCommandType,
        expectedCommandVersion,
      } as unknown as TaskExecutionCreationRevalidationInput;
      await expect(port().revalidateCreation(deps, input)).rejects.toMatchObject({
        code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
      });
    }
  });

  it('refuses an unusable trusted configuration before reading any decision', async () => {
    for (const codes of [
      {},
      { capabilityCodes: { taskV1: 'Task.V1' } },
      { capabilityCodes: undefined },
    ]) {
      for (const row of approved) {
        await expect(
          port(codes).revalidateCreation(
            deps,
            validRevalidationInput(row.commandType, row.commandVersion),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('refuses a revalidation target outside the exact approved reference', async () => {
    await expect(
      port().revalidateCreation(deps, {
        ...validRevalidationInput('execution.create_task', '1.0'),
        expectedTargetRef: targetRef('zhiju.execution.task'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
    await expect(
      port().revalidateCreation(deps, {
        ...validRevalidationInput('execution.create_task', '1.0'),
        expectedTargetRef: targetRef('execution.task', 'abc'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_TARGET_INVALID });
  });
});
