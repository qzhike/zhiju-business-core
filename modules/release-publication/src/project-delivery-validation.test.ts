import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { ContractRegistry, type Common, type ReleasePublication } from '@zhiju/contracts';
import {
  archiveValidationHash,
  archiveDescriptorHash,
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
  readonly also?: readonly { readonly path: string; readonly value: unknown }[];
  readonly recompute?: readonly ('validation' | 'descriptor')[];
}

const manifestValid = fixture('manifest-valid.json');
const archiveValid = fixture('archive-materials-valid.json');
const structuralCases = fixture(
  'structural-negative-cases.json',
) as unknown as readonly MutationCase[];
const archiveCases = fixture('archive-negative-cases.json') as unknown as readonly MutationCase[];

interface PublishedSpellingsFixture {
  readonly owningOperation: {
    readonly type: string;
    readonly version: string;
    readonly result: unknown;
  };
  readonly owningContextQuery: {
    readonly schemaRef: string;
    readonly payload: unknown;
  };
  readonly projectOwnedSources: {
    readonly runRef: Common.ObjectRef;
    readonly agentResultRef: Common.ContentAddressedRef;
    readonly historicalContextSnapshotRef: Common.SnapshotRef;
  };
}

const spellingsFixture = fixture(
  'provenance-source-spellings.json',
) as unknown as PublishedSpellingsFixture;

const MANIFEST = manifestValid.manifest as ReleasePublication.ProjectDeliveryManifest;
const BATCH_REF = manifestValid.batchRef as ReleasePublication.ProjectDeliveryBatchRef;
const DESCRIPTOR = archiveValid.descriptor as ReleasePublication.ProjectDeliveryArchiveDescriptor;
const VALIDATION = archiveValid.validation as ReleasePublication.ProjectDeliveryArchiveValidation;
const ARCHIVE_REF = archiveValid.archiveRef as ReleasePublication.ProjectDeliveryArchiveRef;
const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';

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
  setPath(target, mutation);
  for (const extra of mutation.also ?? []) setPath(target, extra);
  return target;
}

function setPath(
  target: Record<string, unknown>,
  mutation: {
    readonly path: string;
    readonly from?: string;
    readonly remove?: boolean;
    readonly value?: unknown;
  },
): void {
  const [parent, key] = atPath(target, mutation.path);
  if (mutation.remove === true) Reflect.deleteProperty(parent, key);
  else if (mutation.from !== undefined) {
    const [fromParent, fromKey] = atPath(target, mutation.from);
    parent[key] = clone(fromParent[fromKey]);
  } else parent[key] = clone(mutation.value);
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

  it('accepts declared reference forms that stay inside the batch Scope', () => {
    // A Project-scoped accepted report snapshot is a legitimate source; an
    // Artifact-owned provenance member is not forced to carry a projectId; and a
    // Project-scoped Policy version stays legal when its Project is this batch.
    const withScopedSources = clone(MANIFEST);
    const entry = itemAt(withScopedSources.entries, 0);
    entry.provenance.sourceReportRefs = [
      {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.project.preparation_report',
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d901',
        snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d902',
        scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
        contentHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: 'ab'.repeat(32),
        },
      },
    ];
    itemAt(withScopedSources.dependencyProof.ruleRefs, 1).scope.projectId = PROJECT_ID;
    expect(() => {
      validateProjectDeliveryManifest(withScopedSources);
    }).not.toThrow();
  });

  it('accepts the published owning spellings of Project-owned execution sources', () => {
    // `execution.record_run_result@1.0` (task-execution, FULL) declares
    // `runRef` as OBJECT/execution.run and `agentResultRef` as
    // CONTENT_ADDRESSED/execution.agent_result. The D12 entry must accept those
    // exact owning refs with the full Project Scope instead of guessing a
    // selector, and the same refs are rejected without it (see the structural
    // negative set).
    const registry = new ContractRegistry();
    const owning = spellingsFixture.owningOperation;
    expect(registry.validateOperationResult(owning.type, owning.version, owning.result).valid).toBe(
      true,
    );

    const injected = clone(MANIFEST);
    const provenance = itemAt(injected.entries, 1).provenance.revisionProvenance;
    provenance.runRef = clone(spellingsFixture.projectOwnedSources.runRef);
    provenance.agentResultRef = clone(spellingsFixture.projectOwnedSources.agentResultRef);
    provenance.contextSnapshotRef = clone(
      spellingsFixture.projectOwnedSources.historicalContextSnapshotRef,
    );
    expect(() => {
      validateProjectDeliveryManifest(injected);
    }).not.toThrow();
  });

  it('accepts the historical ProjectContext identity of a Project-owned source', () => {
    // `RevisionProvenance.contextSnapshotRef` is a `SnapshotRef<ProjectContext>`.
    // The shared API keeps `zhiju.project.context_snapshot` as the Core v1.0
    // historical read-back identity of that Project-owned fact, so a Revision
    // recorded through that path must keep its full Project Scope instead of
    // being rewritten to the canonical name (and must not lose a Scope member).
    const registry = new ContractRegistry();
    expect(
      registry.validateCoreContract(
        spellingsFixture.owningContextQuery.schemaRef,
        spellingsFixture.owningContextQuery.payload,
      ).valid,
    ).toBe(true);

    const injected = clone(MANIFEST);
    itemAt(injected.entries, 1).provenance.revisionProvenance.contextSnapshotRef = clone(
      spellingsFixture.projectOwnedSources.historicalContextSnapshotRef,
    );
    expect(() => {
      validateProjectDeliveryManifest(injected);
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
    // Recompute the outer identities for the cases that must fail on the
    // intended binding rather than on a now-stale Descriptor/Archive hash.
    const descriptor =
      mutated.descriptor as Mutable<ReleasePublication.ProjectDeliveryArchiveDescriptor>;
    const validation =
      mutated.validation as Mutable<ReleasePublication.ProjectDeliveryArchiveValidation>;
    const archiveRef = mutated.archiveRef as Mutable<ReleasePublication.ProjectDeliveryArchiveRef>;
    for (const step of mutation.recompute ?? []) {
      if (step === 'validation')
        descriptor.validationFactRef.contentHash = archiveValidationHash(validation);
      if (step === 'descriptor') archiveRef.contentHash = archiveDescriptorHash(descriptor);
    }
    expect(() => {
      validateProjectDeliveryArchiveMaterials(
        mutated as unknown as Parameters<typeof validateProjectDeliveryArchiveMaterials>[0],
      );
    }).toThrow(mutation.expectedError);
  });
});
