import { describe, expect, it } from 'vitest';
import { taskBoardAuthorizationSourceHash } from './task-board-source-hash.js';
import type { SelectedAuthorizationGrant } from './work-order-validation-authorization.js';

const grant: SelectedAuthorizationGrant = {
  grantId: '0199b600-0000-7000-8000-000000000901',
  capabilityCode: 'wi248.cap',
  scopeKind: 'PROJECT',
  enterpriseId: '0199b600-0000-7000-8000-000000000902',
  projectId: '0199b600-0000-7000-8000-000000000903',
  actions: ['execution.task_board.read.v1'],
  resourceSelectors: [{ selectorType: 'TARGET_TYPE', objectType: 'project.project' }],
  grantPolicySnapshotId: '0199b600-0000-7000-8000-000000000904',
  grantPolicySnapshotHash: 'a'.repeat(64),
  aggregateVersion: '1',
};

function entry(
  overrides: Partial<
    Parameters<typeof taskBoardAuthorizationSourceHash>[0]['entries'][number]
  > = {},
) {
  return {
    capabilityConfigKey: 'taskBoardReadHumanV1',
    capabilityCode: 'wi248.cap',
    commandType: 'execution.get_task_board_slice',
    commandVersion: '1.0',
    purpose: 'task.execution.get_task_board_slice',
    principalId: '0199b600-0000-7000-8000-000000000905',
    principalKind: 'HUMAN',
    actorSnapshotId: '0199b600-0000-7000-8000-000000000906',
    actorSnapshotPayloadHash: 'b'.repeat(64),
    enterpriseId: grant.enterpriseId,
    projectId: grant.projectId,
    policySnapshotId: grant.grantPolicySnapshotId,
    policySnapshotPayloadHash: grant.grantPolicySnapshotHash,
    grant,
    ...overrides,
  };
}

const source = (entries: ReturnType<typeof entry>[]) => ({
  entries,
  boardPolicyRef: { kind: 'VERSIONED', objectType: 'zhiju.identity.policy', objectId: 'x' },
  boardPolicyContentHash: 'c'.repeat(64),
});

describe('Task Board authorization source fingerprint', () => {
  it('stays stable for the same Grant under a new short-lived Decision', () => {
    expect(taskBoardAuthorizationSourceHash(source([entry()]))).toBe(
      taskBoardAuthorizationSourceHash(source([entry()])),
    );
  });

  it('changes when the selected Grant is replaced under the same configuration', () => {
    const before = taskBoardAuthorizationSourceHash(source([entry()]));
    const after = taskBoardAuthorizationSourceHash(
      source([entry({ grant: { ...grant, grantId: '0199b600-0000-7000-8000-000000000999' } })]),
    );
    expect(after).not.toBe(before);
  });

  it('changes when the Grant Policy Snapshot binding or selector changes', () => {
    const before = taskBoardAuthorizationSourceHash(source([entry()]));
    expect(
      taskBoardAuthorizationSourceHash(
        source([entry({ grant: { ...grant, grantPolicySnapshotHash: 'd'.repeat(64) } })]),
      ),
    ).not.toBe(before);
    expect(
      taskBoardAuthorizationSourceHash(
        source([
          entry({
            grant: {
              ...grant,
              resourceSelectors: [
                { selectorType: 'TARGET_TYPE', objectType: 'zhiju.project.project' },
              ],
            },
          }),
        ]),
      ),
    ).not.toBe(before);
  });
});
