import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import { buildPackageHashMaterial, sameContentHash } from './package-hash.js';
import {
  archiveDescriptorHash,
  archiveValidationHash,
  batchManifestHash,
  normalizeProjectDeliveryManifest,
  PROJECT_DELIVERY_ARCHIVE_INVALID,
  PROJECT_DELIVERY_MANIFEST_INVALID,
  projectDeliveryBytesChecksum,
} from './project-delivery-hash.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(
    `../../../tests/fixtures/contracts/project-delivery/${name}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

const manifestValid = fixture('manifest-valid.json');
const manifestPermuted = fixture('manifest-permuted.json');
const archiveValid = fixture('archive-materials-valid.json');
const legacyGolden = fixture('legacy-package-golden.json');

const MANIFEST = manifestValid.manifest as ReleasePublication.ProjectDeliveryManifest;
const BATCH_REF = manifestValid.batchRef as ReleasePublication.ProjectDeliveryBatchRef;
const DESCRIPTOR = archiveValid.descriptor as ReleasePublication.ProjectDeliveryArchiveDescriptor;
const VALIDATION = archiveValid.validation as ReleasePublication.ProjectDeliveryArchiveValidation;
const LEGACY_PACKAGE =
  legacyGolden.packageDefinition as ReleasePublication.ReleasePackageDefinition;
const EXPECTED_MANIFEST_HASH = manifestValid.expectedBatchManifestHash as Common.ContentHash;
const EXPECTED_DESCRIPTOR_HASH = archiveValid.expectedArchiveDescriptorHash as Common.ContentHash;
const EXPECTED_VALIDATION_HASH = archiveValid.expectedArchiveValidationHash as Common.ContentHash;
const EXPECTED_LEGACY_PACKAGE_HASH = legacyGolden.expectedPackageHash as Common.ContentHash;
const EXPECTED_LEGACY_PAYLOAD_HASH = legacyGolden.expectedPackagePayloadHash as Common.ContentHash;

/** Deep-mutable view of a frozen contract value, used only for fixture mutation. */
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

function clone<T>(value: T): Mutable<T> {
  return JSON.parse(JSON.stringify(value)) as Mutable<T>;
}

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest.repeat(32) };
}

/** Fixture accessor that makes a missing index explicit instead of asserting. */
function itemAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture index ${index} is missing`);
  return value;
}

describe('D12 project-delivery hash domains (#272)', () => {
  it('reproduces the checked-in batchManifestHash vector', () => {
    const hash = batchManifestHash(MANIFEST);
    expect(sameContentHash(hash, EXPECTED_MANIFEST_HASH)).toBe(true);
    expect(hash).toEqual({
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: EXPECTED_MANIFEST_HASH.digest,
    });
    expect(sameContentHash(batchManifestHash(MANIFEST), hash)).toBe(true);
  });

  it('preserves the semantic batchManifestHash under set permutations', () => {
    const permuted = manifestPermuted.manifest as ReleasePublication.ProjectDeliveryManifest;
    expect(sameContentHash(batchManifestHash(permuted), EXPECTED_MANIFEST_HASH)).toBe(true);
    expect(normalizeProjectDeliveryManifest(permuted)).toEqual(
      normalizeProjectDeliveryManifest(MANIFEST),
    );
  });

  it('reproduces the checked-in archive descriptor and validation vectors', () => {
    expect(sameContentHash(archiveDescriptorHash(DESCRIPTOR), EXPECTED_DESCRIPTOR_HASH)).toBe(true);
    expect(sameContentHash(archiveValidationHash(VALIDATION), EXPECTED_VALIDATION_HASH)).toBe(true);
  });

  it('derives the manifest Markdown and ZIP byte checksums from the supplied bytes', () => {
    expect(
      sameContentHash(
        projectDeliveryBytesChecksum(archiveValid.manifestMarkdownBytes as string),
        DESCRIPTOR.manifestMarkdownChecksum,
      ),
    ).toBe(true);
    expect(
      sameContentHash(
        projectDeliveryBytesChecksum(archiveValid.zipBytes as string),
        DESCRIPTOR.zipChecksum,
      ),
    ).toBe(true);
  });

  it('changes the batchManifestHash when any hash-domain field changes', () => {
    const mutations: readonly ((
      manifest: Mutable<ReleasePublication.ProjectDeliveryManifest>,
    ) => void)[] = [
      (manifest) => {
        itemAt(manifest.entries, 0).archivePath =
          'files/018f22e2-7c15-7b2e-8d86-2de956a9d210/018f22e2-7c15-7b2e-8d86-2de956a9d229.md';
      },
      (manifest) => {
        itemAt(manifest.entries, 0).associationProofHash = contentHash('9d');
      },
      (manifest) => {
        itemAt(manifest.entries, 1).revisionRef.contentHash = contentHash('9a');
      },
      (manifest) => {
        itemAt(manifest.entries, 2).deliveryItemIds = [
          ...itemAt(manifest.entries, 2).deliveryItemIds,
          '018f22e2-7c15-7b2e-8d86-2de956a9d244',
        ];
      },
      (manifest) => {
        itemAt(manifest.entries, 0).chapterBindings = [
          ...itemAt(manifest.entries, 0).chapterBindings,
          { chapterCode: 'sec.4', ordinal: 9 },
        ];
      },
      (manifest) => {
        itemAt(manifest.entries, 1).provenance.sourceReportRefs = [
          {
            kind: 'SNAPSHOT',
            objectType: 'zhiju.project.preparation_report',
            objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d901',
            snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d902',
            scope: MANIFEST.projectRef.scope,
            contentHash: contentHash('9b'),
          },
        ];
      },
      (manifest) => {
        manifest.dependencyProof.requirementSetHash = contentHash('9c');
      },
      (manifest) => {
        itemAt(manifest.destinations, 0).required = false;
      },
      (manifest) => {
        manifest.exportPolicyRef.versionId = '018f22e2-7c15-7b2e-8d86-2de956a9d999';
      },
    ];

    for (const mutate of mutations) {
      const mutated = clone(MANIFEST);
      mutate(mutated);
      expect(batchManifestHash(mutated).digest).not.toBe(EXPECTED_MANIFEST_HASH.digest);
    }
  });

  it('rejects duplicate declared identities instead of collapsing them by sorting', () => {
    const duplicateEntries = clone(MANIFEST);
    itemAt(duplicateEntries.entries, 1).archivePath = itemAt(
      duplicateEntries.entries,
      0,
    ).archivePath;
    expect(() => batchManifestHash(duplicateEntries)).toThrow(PROJECT_DELIVERY_MANIFEST_INVALID);

    const duplicateRules = clone(MANIFEST);
    duplicateRules.dependencyProof.ruleRefs = [
      itemAt(duplicateRules.dependencyProof.ruleRefs, 0),
      clone(itemAt(duplicateRules.dependencyProof.ruleRefs, 0)),
    ];
    expect(() => batchManifestHash(duplicateRules)).toThrow(PROJECT_DELIVERY_MANIFEST_INVALID);

    const duplicateChecksums = clone(DESCRIPTOR);
    duplicateChecksums.entryChecksums = [
      itemAt(duplicateChecksums.entryChecksums, 0),
      clone(itemAt(duplicateChecksums.entryChecksums, 0)),
    ];
    expect(() => archiveDescriptorHash(duplicateChecksums)).toThrow(
      PROJECT_DELIVERY_ARCHIVE_INVALID,
    );
  });

  it('keeps the manifest, Markdown, representation, ZIP and archive domains distinct', () => {
    const digests = new Set([
      EXPECTED_MANIFEST_HASH.digest,
      DESCRIPTOR.manifestMarkdownChecksum.digest,
      DESCRIPTOR.zipChecksum.digest,
      ...DESCRIPTOR.entryChecksums.map((item) => item.checksum.digest),
      EXPECTED_DESCRIPTOR_HASH.digest,
      EXPECTED_VALIDATION_HASH.digest,
    ]);
    // Three manifest entries: manifest + Markdown + ZIP + 3 representation + 2 archive.
    expect(digests.size).toBe(8);
    expect(BATCH_REF.contentHash.digest).toBe(EXPECTED_MANIFEST_HASH.digest);
  });

  it('keeps the legacy single-Revision package hash domain unchanged', () => {
    const material = buildPackageHashMaterial(LEGACY_PACKAGE);
    expect(sameContentHash(material.expectedPackageHash, EXPECTED_LEGACY_PACKAGE_HASH)).toBe(true);
    expect(sameContentHash(material.packagePayloadHash, EXPECTED_LEGACY_PAYLOAD_HASH)).toBe(true);
    expect(material.canonicalManifest).toBe(legacyGolden.expectedCanonicalManifest);
    expect(material.expectedPackageHash.digest).not.toBe(EXPECTED_MANIFEST_HASH.digest);
  });
});
