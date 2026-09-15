import { describe, expect, it } from 'vitest';

import { resolveTaskExecutionCreationPurpose } from './task-execution-creation-purpose.js';

/** The approved Spec 003 §15.1 mapping, transcribed here instead of imported. */
const approved = [
  ['execution.create_task', '1.0', 'task.execution.create_task'],
  ['execution.create_task', '2.0', 'execution.task.create'],
  ['execution.create_work_order', '1.0', 'task.execution.create_work_order'],
  ['execution.create_work_order', '1.1', 'task.execution.create_work_order'],
] as const;

describe('exact creation Purpose resolution', () => {
  it.each(approved)('resolves %s@%s to its own Purpose', (commandType, commandVersion, purpose) => {
    expect(resolveTaskExecutionCreationPurpose(commandType, commandVersion)).toEqual({
      outcome: 'RESOLVED',
      commandType,
      commandVersion,
      authorizationPurpose: purpose,
    });
  });

  it('keeps the two WorkOrder versions apart even though they share a Purpose', () => {
    const v10 = resolveTaskExecutionCreationPurpose('execution.create_work_order', '1.0');
    const v11 = resolveTaskExecutionCreationPurpose('execution.create_work_order', '1.1');
    expect(v10).not.toEqual(v11);
    expect(v10).toMatchObject({
      commandVersion: '1.0',
      authorizationPurpose: 'task.execution.create_work_order',
    });
    expect(v11).toMatchObject({
      commandVersion: '1.1',
      authorizationPurpose: 'task.execution.create_work_order',
    });
  });

  it('keeps the two Task majors on their own Purpose', () => {
    expect(resolveTaskExecutionCreationPurpose('execution.create_task', '1.0')).toMatchObject({
      authorizationPurpose: 'task.execution.create_task',
    });
    expect(resolveTaskExecutionCreationPurpose('execution.create_task', '2.0')).toMatchObject({
      authorizationPurpose: 'execution.task.create',
    });
  });

  it('never resolves another operation or the historical alias', () => {
    for (const commandType of [
      'execution.work_order.create',
      'execution.freeze_work_order',
      'execution.create_task_v2',
      'execution.create_task2',
      'execution.create_work_orders',
      'Execution.Create_Task',
      'EXECUTION.CREATE_TASK',
      '',
      '*',
      'execution.*',
      'execution',
      'executions.create_task',
      'execution.create_task ',
      'execution.create_task@2.0',
    ]) {
      expect(resolveTaskExecutionCreationPurpose(commandType, '1.0')).toEqual({
        outcome: 'UNSUPPORTED_OPERATION',
      });
      expect(resolveTaskExecutionCreationPurpose(commandType, '2.0')).toEqual({
        outcome: 'UNSUPPORTED_OPERATION',
      });
    }
  });

  it('never resolves an unknown, missing or non-exact version, and never falls back', () => {
    for (const commandVersion of [
      undefined,
      null,
      '',
      '1',
      '1.0.0',
      'v1.0',
      '01.0',
      '1.00',
      ' 1.0',
      '1.0 ',
      '*',
      'latest',
      1,
      { toString: () => '1.0' },
    ]) {
      expect(resolveTaskExecutionCreationPurpose('execution.create_task', commandVersion)).toEqual({
        outcome: 'UNSUPPORTED_VERSION',
      });
      expect(
        resolveTaskExecutionCreationPurpose('execution.create_work_order', commandVersion),
      ).toEqual({ outcome: 'UNSUPPORTED_VERSION' });
    }
    // Each version stays bound to its own operation.
    expect(resolveTaskExecutionCreationPurpose('execution.create_task', '1.1')).toEqual({
      outcome: 'UNSUPPORTED_VERSION',
    });
    expect(resolveTaskExecutionCreationPurpose('execution.create_work_order', '2.0')).toEqual({
      outcome: 'UNSUPPORTED_VERSION',
    });
  });

  it('resolves nothing from a non-string operation', () => {
    for (const commandType of [undefined, null, 1, {}, ['execution.create_task']]) {
      expect(resolveTaskExecutionCreationPurpose(commandType, '1.0')).toEqual({
        outcome: 'UNSUPPORTED_OPERATION',
      });
    }
  });
});
