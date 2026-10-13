import { describe, expect, it } from 'vitest';
import type { Artifact, Common } from '@zhiju/contracts';
import { getContractRegistry } from '@zhiju/contracts';
import {
  buildFileChanges,
  fileReviewLocation,
  markdownHash,
  MarkdownBoundTokens,
} from './markdown-review-service.js';
import { parseMarkdownDocument } from './markdown-document-service.js';

const scope = {
  enterpriseId: '019aaa00-0000-7000-8000-000000000279',
  projectId: '019aaa00-0000-7000-8000-000000000280',
};
function revision(
  id: string,
): Common.ContentAddressedRef & { objectType: 'artifact.artifact_revision'; scope: typeof scope } {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: id,
    scope,
    contentHash: markdownHash(id),
  };
}
const fromRevisionRef = revision('019aaa00-0000-7000-8000-000000000281');
const toRevisionRef = revision('019aaa00-0000-7000-8000-000000000282');
const inputs = { fromRevisionRef, toRevisionRef, baselineKind: 'REVISION' as const };
const parsed = parseMarkdownDocument({
  bytes: Buffer.from('# One\n\nFirst\n\nSecond\n\n# Two\n\nOther\n'),
  enterpriseId: scope.enterpriseId,
  documentId: scope.projectId,
  title: 'Example',
  documentMetadata: { fileKind: 'PROCEDURE', fileCode: 'P-1' },
  identityDerivation: { originalIntentRef: 'CONTROLLED_DIFF', candidateOutputId: 'candidate-1' },
});

describe('file review exact change semantics', () => {
  it('counts a changed and moved unit twice, while preserving both endpoints and full values', () => {
    const before = parsed.content.body;
    const first = requiredValue(
      before.units.find((unit) => 'text' in unit && unit.text === 'First'),
    );
    const second = requiredValue(
      before.units.find((unit) => 'text' in unit && unit.text === 'Second'),
    );
    const after: Artifact.MarkdownDocument = {
      ...before,
      units: before.units.map((unit) =>
        unit.unitId === first.unitId
          ? ({ ...unit, text: 'Changed', ordinal: 1 } as Artifact.MarkdownDocumentUnit)
          : unit.unitId === second.unitId
            ? { ...unit, ordinal: 0 }
            : unit.unitId === first.parentUnitId
              ? { ...unit, childUnitIds: [second.unitId, first.unitId] }
              : unit,
      ),
    };
    const entries = buildFileChanges(inputs, after, before);
    expect(entries.filter((e) => e.unitId === first.unitId).map((e) => e.kind)).toEqual([
      'CHANGED',
      'MOVED',
    ]);
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.unitId)).size).toBe(2);
    for (const entry of entries) {
      expect(entry.beforeLocation?.revisionRef).toEqual(fromRevisionRef);
      expect(entry.afterLocation?.revisionRef).toEqual(toRevisionRef);
      expect(
        getContractRegistry().validateCoreContract(
          'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/fileChangeEntry',
          entry,
        ).valid,
      ).toBe(true);
    }
    expect(buildFileChanges(inputs, after, before)).toEqual(entries);
    const oldSection = fileReviewLocation(
      fromRevisionRef,
      before,
      requiredValue(first.parentUnitId),
    );
    const newSection = fileReviewLocation(toRevisionRef, after, requiredValue(first.parentUnitId));
    expect(oldSection.claimHash).not.toEqual(newSection.claimHash);
  });
  it('represents removals with only the original location and additions with only the new location', () => {
    const entries = buildFileChanges(
      inputs,
      { ...parsed.content.body, units: [] },
      parsed.content.body,
    );
    expect(
      entries.every(
        (entry) => entry.kind === 'REMOVED' && entry.beforeValue && !entry.afterLocation,
      ),
    ).toBe(true);
    const added = buildFileChanges(
      { toRevisionRef, baselineKind: 'EMPTY_INITIAL' },
      parsed.content.body,
    );
    expect(
      added.every((entry) => entry.kind === 'ADDED' && entry.afterValue && !entry.beforeLocation),
    ).toBe(true);
    const malformed = { ...entries[0], afterLocation: added[0]?.afterLocation };
    expect(
      getContractRegistry().validateCoreContract(
        'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/fileChangeEntry',
        malformed,
      ).valid,
    ).toBe(false);
  });
  it('binds cursors to exact inputs, filters, watermark and principal and refuses tampering or expiry', () => {
    let now = 1;
    const tokens = new MarkdownBoundTokens(Buffer.alloc(32, 0x79), () => now);
    const binding = { inputs, filter: {}, principal: 'Human', watermark: 'grant-v1' };
    const cursor = tokens.issue('file-diff', binding, 'last-change', 10);
    expect(tokens.read('file-diff', binding, cursor)).toBe('last-change');
    for (const patch of [
      { principal: 'Other' },
      { watermark: 'grant-v2' },
      { filter: { text: 'Other' } },
    ])
      expect(() => tokens.read('file-diff', { ...binding, ...patch }, cursor)).toThrow();
    expect(() => tokens.read('markdown-bytes-read', binding, cursor)).toThrow();
    expect(() => tokens.read('file-diff', binding, `${cursor}x`)).toThrow();
    now = 11;
    expect(() => tokens.read('file-diff', binding, cursor)).toThrow();
  });
});

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
