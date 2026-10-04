import { describe, expect, it } from 'vitest';

import type { IdentityCommandDeps } from './actor-snapshot.js';
import {
  createTaskBoardAuthorizationPort,
  IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
  TASK_BOARD_BINDINGS,
  TASK_BOARD_PURPOSES,
  type ControlledFirstRunAuthorizationInput,
  type ControlledFirstRunRevalidationInput,
  type TaskBoardAuthorizationConfig,
  type TaskBoardCapabilityKey,
} from './work-order-validation-authorization.js';

// Every assertion here stays in front of the trusted transaction: the Port's
// key/operation/version resolution fails closed before it touches `deps`, so a
// structurally empty dependency object is enough. Any request that slipped
// past those gates would fail loudly on the missing transaction context rather
// than silently authorize. Nothing in this file needs a database.

/** The seven approved Spec 001 §15.19 rows, transcribed instead of imported. */
interface ApprovedRow {
  readonly capabilityConfigKey: TaskBoardCapabilityKey;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'OBJECT' | 'VERSIONED';
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: string;
  readonly expectedPrincipalKind: 'HUMAN' | 'SERVICE';
  readonly forbidActingFor: boolean;
}

const projectTargets = ['project.project', 'zhiju.project.project'] as const;

const approved: readonly ApprovedRow[] = [
  {
    capabilityConfigKey: 'taskBoardReadHumanV1',
    commandType: 'execution.get_task_board_slice',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_task_board_slice',
    requiredGrantAction: 'execution.task_board.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
  },
  {
    capabilityConfigKey: 'taskBoardSourceReadV1',
    commandType: 'execution.task_board.source.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task_board.source.read.v1',
    requiredGrantAction: 'execution.task_board.source.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'taskBoardHealthReadV1',
    commandType: 'execution.task_board.health.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task_board.health.read.v1',
    requiredGrantAction: 'execution.task_board.health.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'taskBoardDispatchManageV1',
    commandType: 'execution.task_board.dispatch.manage.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task_board.dispatch.manage.v1',
    requiredGrantAction: 'execution.task_board.dispatch.manage.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'taskBoardProjectionPublishV1',
    commandType: 'execution.task_board.projection.publish.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task_board.projection.publish.v1',
    requiredGrantAction: 'execution.task_board.projection.publish.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'taskBoardProjectionMaintainV1',
    commandType: 'execution.task_board.projection.maintain.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task_board.projection.maintain.v1',
    requiredGrantAction: 'execution.task_board.projection.maintain.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: projectTargets,
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
  {
    capabilityConfigKey: 'taskBoardPolicyReadV1',
    commandType: 'identity.resolve_policy',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'execution.task_board.policy.read.v1',
    targetKind: 'VERSIONED',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
    forbidActingFor: false,
  },
];

const capabilityCodes: Readonly<Record<TaskBoardCapabilityKey, string>> = {
  taskBoardReadHumanV1: 'execution.task_board.read.v1',
  taskBoardSourceReadV1: 'execution.task_board.source.read.v1',
  taskBoardHealthReadV1: 'execution.task_board.health.read.v1',
  taskBoardDispatchManageV1: 'execution.task_board.dispatch.manage.v1',
  taskBoardProjectionPublishV1: 'execution.task_board.projection.publish.v1',
  taskBoardProjectionMaintainV1: 'execution.task_board.projection.maintain.v1',
  taskBoardPolicyReadV1: 'execution.task_board.policy.read.v1',
};

/** The Port under test; the resolution gates run before `deps` is read. */
function port(codes: unknown = capabilityCodes) {
  return createTaskBoardAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as TaskBoardAuthorizationConfig);
}

const pureDeps = {} as unknown as IdentityCommandDeps;

function approvedRow(capabilityConfigKey: TaskBoardCapabilityKey): ApprovedRow {
  const found = approved.find((row) => row.capabilityConfigKey === capabilityConfigKey);
  if (found === undefined) throw new Error(`unapproved task-board key ${capabilityConfigKey}`);
  return found;
}

const humanRow = approvedRow('taskBoardReadHumanV1');

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

function projection(rows: readonly (typeof TASK_BOARD_BINDINGS)[number][]): string[] {
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
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.expectedPrincipalKind}|${row.forbidActingFor ? 'forbidActingFor' : ''}`,
    )
    .sort();
}

describe('approved task-board authorization bindings', () => {
  it('publishes exactly the seven Spec 001 §15.19 rows and nothing else', () => {
    expect(TASK_BOARD_BINDINGS).toHaveLength(approved.length);
    expect(projection(TASK_BOARD_BINDINGS)).toEqual(specProjection(approved));
  });

  it('freezes the table, every row and every target set', () => {
    expect(Object.isFrozen(TASK_BOARD_BINDINGS)).toBe(true);
    expect(Object.isFrozen(TASK_BOARD_PURPOSES)).toBe(true);
    for (const row of TASK_BOARD_BINDINGS) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.targetObjectTypes)).toBe(true);
    }
  });

  it('binds each config key exactly once', () => {
    const keys = TASK_BOARD_BINDINGS.map((row) => row.capabilityConfigKey);
    expect(new Set(keys).size).toBe(approved.length);
    expect([...keys].sort()).toEqual(approved.map((row) => row.capabilityConfigKey).sort());
  });

  it('keeps every required Grant action unique', () => {
    const actions = TASK_BOARD_BINDINGS.map((row) => row.requiredGrantAction);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('agrees with the published Purpose map for every config key', () => {
    for (const row of TASK_BOARD_BINDINGS) {
      expect(TASK_BOARD_PURPOSES[row.capabilityConfigKey]).toBe(row.authorizationPurpose);
    }
    for (const row of approved) {
      expect(TASK_BOARD_PURPOSES[row.capabilityConfigKey]).toBe(row.authorizationPurpose);
    }
  });

  it('uses version 1.0 and selector TARGET_TYPE for every row', () => {
    for (const row of TASK_BOARD_BINDINGS) {
      expect(row.commandVersion).toBe('1.0');
      expect(row.selectorType).toBe('TARGET_TYPE');
    }
  });
});

describe('task-board authorization: exact key resolution', () => {
  it('refuses an unknown or non-exact key', async () => {
    for (const key of [
      'taskBoardReadHuman',
      'taskBoardReadHumanV2',
      'taskBoardReadHumanV1 ',
      'TASKBOARDREADHUMANV1',
      'taskBoardPolicyRead',
      '',
      '*',
      'latest',
    ]) {
      await expect(
        port().authorize(pureDeps, key as TaskBoardCapabilityKey, authorizeInput(humanRow)),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      await expect(
        port().revalidate(pureDeps, key as TaskBoardCapabilityKey, revalidationInput(humanRow)),
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
