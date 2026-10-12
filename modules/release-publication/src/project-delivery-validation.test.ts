import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import {
  PROJECT_DELIVERY_ARCHIVE_INVALID,
  PROJECT_DELIVERY_HASH_MISMATCH,
  PROJECT_DELIVERY_MANIFEST_INVALID,
} from './project-delivery-hash.js';
import {
  assertProjectDeliveryArchiveIdentity,
  assertProjectDeliveryBatchIdentity,
  validateProjectDeliveryArchiveDescriptor,
  validateProjectDeliveryArchiveMaterials,
  validateProjectDeliveryArchiveValidation,
  validateProjectDeliveryManifest,
} from './project-delivery-validation.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(
    `../../../tests/fixtures/contracts/project-delivery/${name}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

interface MutationCase {
  readonly description: string;
  readonly path: string;
  readonly expectedError: string;
  readonly value?: unknown;
  readonly from?: string;
  readonly remove?: boolean;
}

const manifestValid = fixture('manifest-valid.json');
const archiveValid = fixture('archive-materials-valid.json');
const structuralCases = fixture(
  'structural-negative-cases.json',
) as unknown as readonly MutationCase[];
const archiveCases = fixture('archive-negative-cases.json') as unknown as readonly MutationCase[];

const MANIFEST = manifestValid.manifest as ReleasePublication.ProjectDeliveryManifest;
const BATCH_REF = manifestValid.batchRef as ReleasePublication.ProjectDeliveryBatchRef;
const DESCRIPTOR = archiveValid.descriptor as ReleasePublication.ProjectDeliveryArchiveDescriptor;
const VALIDATION = archiveValid.validation as ReleasePublication.ProjectDeliveryArchiveValidation;
const ARCHIVE_REF = archiveValid.archiveRef as ReleasePublication.ProjectDeliveryArchiveRef;

/** Deep-mutable view of a frozen contract value, used only for fixture mutation. */
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

function clone<T>(value: T): Mutable<T> {
  return JSON.parse(JSON.stringify(value)) as Mutable<T>;
}

/** Fixture accessor that makes a missing index explicit instead of asserting. */
function itemAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture index ${index} is missing`);
  return value;
}

function requireLastPart(parts: readonly string[]): string {
  const key = parts.at(-1);
  if (key === undefined) throw new Error('invalid fixture pointer');
  return key;
}

function atPath(root: Record<string, unknown>, pointer: string): [Record<string, unknown>, string] {
  const parts = pointer.split('/').slice(1);
  let current = root;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  return [current, requireLastPart(parts)];
}

function mutate(base: Record<string, unknown>, mutation: MutationCase): Record<string, unknown> {
  const target = clone(base) as Record<string, unknown>;
  const [parent, key] = atPath(target, mutation.path);
  if (mutation.remove === true) Reflect.deleteProperty(parent, key);
  else if (mutation.from !== undefined) {
    const [fromParent, fromKey] = atPath(target, mutation.from);
    parent[key] = clone(fromParent[fromKey]);
  } else parent[key] = clone(mutation.value);
  return target;
}

function materials(
  overrides: Partial<{
    manifest: ReleasePublication.ProjectDeliveryManifest;
    archiveRef: ReleasePublication.ProjectDeliveryArchiveRef;
    descriptor: ReleasePublication.ProjectDeliveryArchiveDescriptor;
    validation: ReleasePublication.ProjectDeliveryArchiveValidation;
  }> = {},
) {
  return {
    manifest: MANIFEST,
    archiveRef: ARCHIVE_REF,
    descriptor: DESCRIPTOR,
    validation: VALIDATION,
    manifestMarkdownBytes: archiveValid.manifestMarkdownBytes as string,
    zipBytes: archiveValid.zipBytes as string,
    ...overrides,
  };
}

describe('D12 project-delivery structural validation (#272)', () => {
  it('accepts the checked-in three-file cross-round manifest and archive materials', () => {
    expect(() => {
      validateProjectDeliveryManifest(MANIFEST);
    }).not.toThrow();
    expect(() => {
      validateProjectDeliveryArchiveDescriptor(DESCRIPTOR);
    }).not.toThrow();
    expect(() => {
      validateProjectDeliveryArchiveValidation(VALIDATION);
    }).not.toThrow();
    expect(() => {
      validateProjectDeliveryArchiveMaterials(materials());
    }).not.toThrow();
  });

  it('binds the OBJECT batch and archive targets to their CONTENT_ADDRESSED identities', () => {
    expect(() => {
      assertProjectDeliveryBatchIdentity(MANIFEST, BATCH_REF);
    }).not.toThrow();
    expect(() => {
      assertProjectDeliveryArchiveIdentity(DESCRIPTOR, ARCHIVE_REF);
    }).not.toThrow();

    const wrongId = clone(BATCH_REF);
    wrongId.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d299';
    expect(() => {
      assertProjectDeliveryBatchIdentity(MANIFEST, wrongId);
    }).toThrow(PROJECT_DELIVERY_MANIFEST_INVALID);

    const wrongHash = clone(BATCH_REF);
    wrongHash.contentHash = {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: 'ab'.repeat(32),
    };
    expect(() => {
      assertProjectDeliveryBatchIdentity(MANIFEST, wrongHash);
    }).toThrow(PROJECT_DELIVERY_HASH_MISMATCH);

    const foreignArchive = clone(ARCHIVE_REF);
    foreignArchive.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d299';
    expect(() => {
      assertProjectDeliveryArchiveIdentity(DESCRIPTOR, foreignArchive);
    }).toThrow(PROJECT_DELIVERY_ARCHIVE_INVALID);
  });

  it('does not certify current approval, policy applicability, authorization or object existence', () => {
    // The same structurally valid manifest is accepted with replacement exact
    // Quality/Release references: whether those facts exist, are current, are
    // applicable or are authorized belongs to the owning readers, not here.
    const replaced = clone(MANIFEST);
    itemAt(replaced.entries, 0).releaseAuthorizationRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'release.release_authorization',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d998',
      scope: itemAt(replaced.entries, 0).releaseAuthorizationRef.scope,
      contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'ab'.repeat(32) },
    };
    itemAt(replaced.entries, 0).approvalBundleSnapshotRef = {
      kind: 'SNAPSHOT',
      objectType: 'quality.approval_bundle_snapshot',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d997',
      snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d996',
      scope: itemAt(replaced.entries, 0).approvalBundleSnapshotRef.scope,
      contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'ac'.repeat(32) },
    };
    expect(() => {
      validateProjectDeliveryManifest(replaced);
    }).not.toThrow();
  });

  it.each(structuralCases)('rejects the manifest mutation: $description', (mutation) => {
    const mutated = mutate(MANIFEST, mutation);
    expect(() => {
      validateProjectDeliveryManifest(
        mutated as unknown as ReleasePublication.ProjectDeliveryManifest,
      );
    }).toThrow(mutation.expectedError);
  });

  it('rejects a CONTENT_ADDRESSED batch identity declared as the OBJECT manifest target', () => {
    const mutated = clone(MANIFEST) as unknown as Record<string, unknown>;
    mutated.batchRef = clone(BATCH_REF);
    expect(() => {
      validateProjectDeliveryManifest(
        mutated as unknown as ReleasePublication.ProjectDeliveryManifest,
      );
    }).toThrow(PROJECT_DELIVERY_MANIFEST_INVALID);
  });

  it('rejects a digest-only substitute where a complete reference is required', () => {
    const mutated = clone(MANIFEST) as unknown as Record<string, unknown>;
    mutated.deliveryPlanRef = (MANIFEST.deliveryPlanRef as Common.VersionedRef).versionId;
    expect(() => {
      validateProjectDeliveryManifest(
        mutated as unknown as ReleasePublication.ProjectDeliveryManifest,
      );
    }).toThrow(PROJECT_DELIVERY_MANIFEST_INVALID);
  });

  it.each(archiveCases)('rejects the archive mutation: $description', (mutation) => {
    const base = {
      manifest: clone(MANIFEST),
      archiveRef: clone(ARCHIVE_REF),
      descriptor: clone(DESCRIPTOR),
      validation: clone(VALIDATION),
      manifestMarkdownBytes: archiveValid.manifestMarkdownBytes as string,
      zipBytes: archiveValid.zipBytes as string,
    } as unknown as Record<string, unknown>;
    const mutated = mutate(base, mutation);
    expect(() => {
      validateProjectDeliveryArchiveMaterials(
        mutated as unknown as Parameters<typeof validateProjectDeliveryArchiveMaterials>[0],
      );
    }).toThrow(mutation.expectedError);
  });
});
