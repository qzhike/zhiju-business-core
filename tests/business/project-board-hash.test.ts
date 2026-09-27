import { describe, expect, it } from 'vitest';
import {
  calculateProjectBoardSnapshotHash,
  type ProjectBoardProjectionItemInput,
  type ProjectBoardSnapshotExport,
} from '@zhiju/enterprise-project';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
function projectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  };
}

function contentHash(digest: string): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest,
    canonicalizationVersion: '1',
  };
}

function watermark(
  projectId: string,
  sequence: number,
  observedAt: string,
): Common.SourceWatermark {
  return {
    sourceModule: 'enterprise_project',
    partition: projectId,
    sequence,
    observedAt,
  };
}

function item(
  deliveryItemId: string,
  itemKey: string,
  title: string,
  executionStatus: EnterpriseProject.DeliveryExecutionStatus = 'READY',
): ProjectBoardProjectionItemInput {
  return {
    deliveryItemId,
    itemKey,
    itemType: 'delivery.output',
    title,
    commitmentStatus: 'APPROVED',
    executionStatus,
    blockerRefs: [],
  };
}

function snapshot(
  enterpriseId: string,
  projectId: string,
  sequence: number,
  sourceEventId: string,
  items: readonly ProjectBoardProjectionItemInput[],
): ProjectBoardSnapshotExport {
  const snapshotAt = `2026-08-27T00:0${Math.min(sequence, 9)}:00.000Z`;
  const sourceWatermark = watermark(projectId, sequence, snapshotAt);
  const base = {
    projectRef: projectRef(enterpriseId, projectId),
    snapshotAt,
    sourceWatermark,
    items,
    sourceSnapshotHash: contentHash('0'.repeat(64)),
  } satisfies ProjectBoardSnapshotExport;
  return {
    ...base,
    sourceEventId,
    sourceSnapshotHash: contentHash(calculateProjectBoardSnapshotHash(base)),
  };
}

describe('EnterpriseProject WI-11 pure contract helpers', () => {
  it('calculates a deterministic Snapshot Export hash', () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const sourceEventId = newUuidV7();
    const exported = snapshot(enterpriseId, projectId, 1, sourceEventId, [
      item(newUuidV7(), 'item-a', 'First item'),
    ]);
    expect(calculateProjectBoardSnapshotHash(exported)).toBe(exported.sourceSnapshotHash.digest);
    expect(calculateProjectBoardSnapshotHash(exported)).toBe(
      calculateProjectBoardSnapshotHash({ ...exported }),
    );
  });
});
