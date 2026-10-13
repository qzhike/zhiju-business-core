import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Kysely } from 'kysely';
import {
  getContractRegistry,
  markdownDocumentLimits,
  type Artifact,
  type Common,
} from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import type { ArtifactDb, ArtifactTransactionContext } from '../persistence/artifact-db.js';
import type { ObjectStoragePort } from '../storage/object-storage.js';
import { handleGetRevisionSnapshot } from './revision-service.js';
import { readFrozenStructuredRevision } from './structured-document-service.js';
import {
  parseMarkdownDocument,
  buildMarkdownIdentityMap,
  verifyMarkdownRoundTrip,
} from './markdown-document-service.js';
import { ArtifactBusinessError, ARTIFACT_QUERY_NOT_FOUND } from './artifact-business-errors.js';

const registry = getContractRegistry();
const algorithmRef = { algorithmId: 'artifact.file_diff', version: '1.0' } as const;
type Unit = Artifact.MarkdownDocumentUnit;
type Location = Artifact.FileReviewLocation;
type Entry = Artifact.FileChangeEntry;

export function markdownHash(value: unknown): Common.ContentHash {
  return markdownBytesHash(Buffer.from(canonicalize(value as CanonicalJsonValue), 'utf8'));
}
export function markdownBytesHash(bytes: Uint8Array): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}
export function markdownNotFound(): never {
  throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'The requested content is unavailable');
}
export function exactMarkdownRevision(ref: Common.ContentAddressedRef): Location['revisionRef'] {
  if (
    ref.objectType !== 'artifact.artifact_revision' ||
    !ref.scope.enterpriseId ||
    !ref.scope.projectId
  )
    return markdownNotFound();
  return {
    ...ref,
    objectType: 'artifact.artifact_revision',
    scope: { enterpriseId: ref.scope.enterpriseId, projectId: ref.scope.projectId },
  };
}

/** Scope and current authorization are resolved by the owning IP composition. */
export interface MarkdownReadAuthority {
  authorize(
    operation: string,
    revisionRef: Common.ContentAddressedRef,
  ): Promise<{
    context: ArtifactTransactionContext;
    /** Stable current grant/policy/session fingerprint; never a fresh Decision id. */
    watermark: string;
  }>;
}
export interface MarkdownReviewConfig {
  db: Kysely<ArtifactDb>;
  storage: ObjectStoragePort;
  render(content: Artifact.MarkdownDocumentContent): Buffer;
  tokenKey: Buffer;
  now?: () => number;
}

/** Authenticated purpose-specific tokens. Payloads contain bindings, never credentials. */
export class MarkdownBoundTokens {
  constructor(
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    if (key.length < 32) throw new Error('Markdown token key must contain at least 256 bits');
  }
  issue(purpose: string, binding: unknown, value: unknown, lifetime: number): string {
    const payload = Buffer.from(
      JSON.stringify({
        p: purpose,
        b: markdownHash(binding).digest,
        v: value,
        e: this.now() + lifetime,
      }),
    );
    return Buffer.concat([
      createHmac('sha256', this.key).update(payload).digest(),
      payload,
    ]).toString('base64url');
  }
  read(purpose: string, binding: unknown, token: string): unknown {
    const decoded = this.open(purpose, token);
    if (!isDeepStrictEqual(decoded.binding, markdownHash(binding))) return markdownNotFound();
    return decoded.value;
  }
  open(
    purpose: string,
    token: string,
  ): { binding: Common.ContentHash; value: unknown; expires: number } {
    if (token.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(token)) return markdownNotFound();
    const raw = Buffer.from(token, 'base64url');
    if (raw.length <= 32 || raw.toString('base64url') !== token) return markdownNotFound();
    const payload = raw.subarray(32);
    const actual = raw.subarray(0, 32);
    const expected = createHmac('sha256', this.key).update(payload).digest();
    if (!timingSafeEqual(actual, expected)) return markdownNotFound();
    try {
      const decoded = JSON.parse(payload.toString('utf8')) as {
        p: string;
        b: string;
        v: unknown;
        e: number;
      };
      if (
        decoded.p !== purpose ||
        !Number.isFinite(decoded.e) ||
        decoded.e <= this.now() ||
        !/^[0-9a-f]{64}$/.test(decoded.b)
      )
        return markdownNotFound();
      return {
        binding: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: decoded.b },
        value: decoded.v,
        expires: decoded.e,
      };
    } catch {
      return markdownNotFound();
    }
  }
}

/** Rebuild identity paths from the sealed graph and prove the entire round-trip. */
export function revisionMarkdownIdentityMap(
  content: Artifact.MarkdownDocumentContent,
  bytes: Buffer,
  artifactRef: Common.ObjectRef,
  revisionRef: Common.ContentAddressedRef,
): Artifact.MarkdownIdentityMap {
  if (bytes.length > markdownDocumentLimits.maxFileBytes) return markdownNotFound();
  const derivation = {
    originalIntentRef: `revision:${revisionRef.objectId}`,
    candidateOutputId: revisionRef.objectId,
  };
  const parsed = parseMarkdownDocument({
    bytes,
    enterpriseId: requiredValue(artifactRef.scope.enterpriseId),
    documentId: content.body.documentId,
    title: content.body.title,
    documentMetadata: content.body.metadata,
    identityDerivation: derivation,
  });
  if (parsed.content.body.units.length !== content.body.units.length) return markdownNotFound();
  const ids = new Map(
    parsed.content.body.units.map((unit, index) => [
      unit.unitId,
      requiredValue(content.body.units[index]),
    ]),
  );
  const map = buildMarkdownIdentityMap({
    parse: parsed,
    artifactRef,
    profileRef: content.schemaRef,
    baseRevisionRef: revisionRef,
  });
  const mapped: Artifact.MarkdownIdentityMap = {
    ...map,
    nodes: map.nodes.map((node) => {
      const original = requiredValue(ids.get(node.unitId));
      if (original.unitType !== node.type) return markdownNotFound();
      return {
        sourceNodePath: node.sourceNodePath,
        unitId: original.unitId,
        type: original.unitType,
        ordinal: original.ordinal,
        ...(original.parentUnitId === undefined ? {} : { parentUnitId: original.parentUnitId }),
      };
    }),
    columns: map.columns.map((column) => {
      const table = ids.get(column.tableUnitId);
      if (table?.unitType !== 'TABLE') return markdownNotFound();
      const original = table.semanticMetadata.markdown.columns[column.ordinal];
      if (!original) return markdownNotFound();
      return { tableUnitId: table.unitId, columnId: original.columnId, ordinal: column.ordinal };
    }),
  };
  verifyMarkdownRoundTrip({
    content,
    renderedBytes: bytes,
    enterpriseId: requiredValue(artifactRef.scope.enterpriseId),
    identityDerivation: derivation,
    identityMap: mapped,
    identityBinding: { artifactRef, baseRevisionRef: revisionRef },
  });
  return mapped;
}

function unitIndex(document: Artifact.MarkdownDocument) {
  return new Map(document.units.map((unit) => [unit.unitId, unit]));
}
function pathFor(unit: Unit, units: ReadonlyMap<string, Unit>): string[] {
  const path = [unit.unitId];
  let parent = unit.parentUnitId;
  while (parent !== undefined) {
    const ancestor = units.get(parent);
    if (!ancestor || path.includes(parent)) return markdownNotFound();
    path.unshift(parent);
    parent = ancestor.parentUnitId;
  }
  return path;
}
export function fileReviewLocation(
  revisionRef: Common.ContentAddressedRef,
  document: Artifact.MarkdownDocument,
  unitId: string,
): Location {
  return indexedLocation(revisionRef, unitIndex(document), unitId);
}
function indexedLocation(
  revisionRef: Common.ContentAddressedRef,
  units: ReadonlyMap<string, Unit>,
  unitId: string,
): Location {
  if (revisionRef.objectType !== 'artifact.artifact_revision') return markdownNotFound();
  const unit = units.get(unitId);
  if (!unit) return markdownNotFound();
  const subtree: Unit[] = [];
  const visit = (current: Unit) => {
    subtree.push(current);
    for (const id of current.childUnitIds) {
      const child = units.get(id);
      if (!child) return markdownNotFound();
      visit(child);
    }
  };
  visit(unit);
  const base = {
    revisionRef: exactMarkdownRevision(revisionRef),
    unitId,
    unitType: unit.unitType,
    path: pathFor(unit, units),
    claimHash: markdownHash({ unit, subtree: subtree.slice(1) }),
  };
  if (unit.unitType !== 'TABLE_CELL') return base;
  const row = units.get(requiredValue(unit.parentUnitId));
  if (row?.unitType !== 'TABLE_ROW' || !row.parentUnitId) return markdownNotFound();
  return {
    ...base,
    tableUnitId: row.parentUnitId,
    rowUnitId: row.unitId,
    columnId: unit.semanticMetadata.markdown.columnId,
  };
}
function assertLocation(
  revision: Common.ContentAddressedRef,
  document: Artifact.MarkdownDocument,
  location: Location,
): void {
  if (!isDeepStrictEqual(location, fileReviewLocation(revision, document, location.unitId)))
    markdownNotFound();
}
function semantic(unit: Unit) {
  return {
    unitType: unit.unitType,
    ...('text' in unit ? { text: unit.text } : {}),
    semanticMetadata: unit.semanticMetadata,
    ...('evidenceRefs' in unit ? { evidenceRefs: unit.evidenceRefs } : {}),
  };
}

export function buildFileChanges(
  exactInputs: Artifact.FileChangeDirectory['exactInputs'],
  to: Artifact.MarkdownDocument,
  from?: Artifact.MarkdownDocument,
): Entry[] {
  const before = from ? unitIndex(from) : new Map<string, Unit>();
  const after = unitIndex(to);
  const entries: Entry[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id);
    const next = after.get(id);
    const kinds: Entry['kind'][] = !old
      ? ['ADDED']
      : !next
        ? ['REMOVED']
        : [
            ...(!isDeepStrictEqual(semantic(old), semantic(next)) ? ['CHANGED' as const] : []),
            ...(old.parentUnitId !== next.parentUnitId || old.ordinal !== next.ordinal
              ? ['MOVED' as const]
              : []),
          ];
    if (kinds.length === 0) continue;
    const beforeLocation =
      old && from && exactInputs.fromRevisionRef
        ? indexedLocation(exactInputs.fromRevisionRef, before, id)
        : undefined;
    const afterLocation = next ? indexedLocation(exactInputs.toRevisionRef, after, id) : undefined;
    const contextUnitIds = [
      ...new Set([...(beforeLocation?.path ?? []), ...(afterLocation?.path ?? [])]),
    ];
    const chapterUnitIds = contextUnitIds.filter(
      (key) => before.get(key)?.unitType === 'SECTION' || after.get(key)?.unitType === 'SECTION',
    );
    for (const kind of kinds)
      entries.push({
        changeId: markdownHash({ exactInputs, algorithmRef, unitId: id, kind }),
        unitId: id,
        kind,
        ...(beforeLocation ? { beforeLocation, beforeValue: requiredValue(old) } : {}),
        ...(afterLocation ? { afterLocation, afterValue: requiredValue(next) } : {}),
        contextUnitIds,
        chapterUnitIds,
      });
  }
  const order = new Map(to.units.map((unit, index) => [unit.unitId, index]));
  const oldOrder = new Map(from?.units.map((unit, index) => [unit.unitId, index]));
  const kinds = { ADDED: 0, REMOVED: 1, CHANGED: 2, MOVED: 3 };
  return entries.sort(
    (a, b) =>
      (order.get(a.unitId) ?? oldOrder.get(a.unitId) ?? 0) -
        (order.get(b.unitId) ?? oldOrder.get(b.unitId) ?? 0) ||
      Buffer.compare(Buffer.from(a.unitId), Buffer.from(b.unitId)) ||
      kinds[a.kind] - kinds[b.kind],
  );
}

export class MarkdownReviewService {
  private readonly now: () => number;
  private readonly tokens: MarkdownBoundTokens;
  constructor(private readonly config: MarkdownReviewConfig) {
    this.now = config.now ?? Date.now;
    this.tokens = new MarkdownBoundTokens(config.tokenKey, this.now);
  }
  async read(
    authority: MarkdownReadAuthority,
    operation: string,
    revisionRef: Common.ContentAddressedRef,
  ) {
    const authorized = await authority.authorize(operation, revisionRef);
    const { facts, content } = await readFrozenStructuredRevision(
      this.config.db,
      authorized.context,
      this.config.storage,
      revisionRef,
    );
    const payload = JSON.parse(
      content.canonicalBytes.toString('utf8'),
    ) as Artifact.MarkdownDocumentContent;
    if (!registry.validateMarkdownDocumentContent(payload).valid) return markdownNotFound();
    const snapshot = await handleGetRevisionSnapshot(this.config.db, authorized.context, {
      revisionRef,
    });
    const artifactRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: 'artifact.artifact',
      objectId: facts.root.artifact_id,
      scope: revisionRef.scope,
    };
    const renderedBytes = this.config.render(payload);
    const identityMap = revisionMarkdownIdentityMap(
      payload,
      renderedBytes,
      artifactRef,
      revisionRef,
    );
    const current = await authority.authorize(operation, revisionRef);
    if (current.watermark !== authorized.watermark) return markdownNotFound();
    return {
      payload,
      snapshot,
      artifactRef,
      identityMap,
      renderedBytes,
      facts,
      authority: current,
      sourceWatermarks: [
        {
          sourceModule: 'artifact',
          partition: revisionRef.objectId,
          sequence: Number(facts.revision.aggregate_version),
          observedAt: new Date(this.now()).toISOString(),
        },
      ],
    };
  }
  async getContent(
    authority: MarkdownReadAuthority,
    input: Artifact.ArtifactGetFileReviewContentPayload,
  ): Promise<Artifact.FileReviewContent> {
    const read = await this.read(authority, 'artifact.get_file_review_content', input.revisionRef);
    if (input.location) assertLocation(input.revisionRef, read.payload.body, input.location);
    return {
      revisionRef: input.revisionRef,
      canonicalContentHash: input.revisionRef.contentHash,
      profileRef: read.payload.schemaRef,
      document: read.payload.body,
      authoritativeIdentityMap: read.identityMap,
      currentUsability:
        read.facts.disposition === 'ACTIVE' && read.facts.root.lifecycle_status === 'ACTIVE'
          ? 'USABLE'
          : 'REVOKED',
      sourceWatermarks: read.sourceWatermarks,
    };
  }
  async getChanges(
    authority: MarkdownReadAuthority,
    input: Artifact.ArtifactGetFileChangeDirectoryPayload,
  ): Promise<Artifact.FileChangeDirectory> {
    const to = await this.read(
      authority,
      'artifact.get_file_change_directory',
      input.toRevisionRef,
    );
    const from = input.fromRevisionRef
      ? await this.read(authority, 'artifact.get_file_change_directory', input.fromRevisionRef)
      : undefined;
    if (
      input.baselineKind === 'EMPTY_INITIAL'
        ? from !== undefined || to.snapshot.parentRevisionRefs.length !== 0
        : !from ||
          !isDeepStrictEqual(from.artifactRef, to.artifactRef) ||
          from.payload.body.documentId !== to.payload.body.documentId
    )
      return markdownNotFound();
    const exactInputs = {
      toRevisionRef: input.toRevisionRef,
      baselineKind: input.baselineKind,
      ...(input.fromRevisionRef ? { fromRevisionRef: input.fromRevisionRef } : {}),
    };
    const entries = buildFileChanges(exactInputs, to.payload.body, from?.payload.body);
    const diffHash = markdownHash({ exactInputs, algorithmRef, entries });
    const filter = input.filter;
    const search = filter.text?.toLocaleLowerCase('en-US') ?? '';
    const filtered = entries.filter(
      (entry) =>
        (!filter.chapterUnitId || entry.chapterUnitIds.includes(filter.chapterUnitId)) &&
        (!search ||
          JSON.stringify([entry.beforeValue, entry.afterValue])
            .toLocaleLowerCase('en-US')
            .includes(search)),
    );
    const binding = {
      exactInputs,
      algorithmRef,
      diffHash,
      filter,
      sort: 'tree-unit-kind',
      principal: to.authority.context.principalId,
      scope: input.toRevisionRef.scope,
      authority: [to.authority.watermark, from?.authority.watermark ?? null],
    };
    let start = 0;
    if (input.page.cursor) {
      const last = this.tokens.read('file-diff', binding, input.page.cursor);
      const index = filtered.findIndex((entry) => entry.changeId.digest === last);
      if (index < 0) return markdownNotFound();
      start = index + 1;
    }
    const page = filtered.slice(start, start + input.page.limit);
    const allUnits = new Map(
      [...(from?.payload.body.units ?? []), ...to.payload.body.units].map((unit) => [
        unit.unitId,
        unit,
      ]),
    );
    const chapterCounts = new Map<string, number>();
    for (const entry of entries)
      for (const chapter of entry.chapterUnitIds)
        chapterCounts.set(chapter, (chapterCounts.get(chapter) ?? 0) + 1);
    const chapterGroups = [...allUnits.values()]
      .filter((unit) => unit.unitType === 'SECTION')
      .map((unit) => ({
        unitId: unit.unitId,
        title: unit.text,
        changeCount: chapterCounts.get(unit.unitId) ?? 0,
      }));
    if (
      (await authority.authorize('artifact.get_file_change_directory', input.toRevisionRef))
        .watermark !== to.authority.watermark
    )
      return markdownNotFound();
    if (
      input.fromRevisionRef &&
      (await authority.authorize('artifact.get_file_change_directory', input.fromRevisionRef))
        .watermark !== from?.authority.watermark
    )
      return markdownNotFound();
    return {
      exactInputs,
      algorithmRef,
      diffHash,
      totalChanges: entries.length,
      changedUnitCount: new Set(entries.map((entry) => entry.unitId)).size,
      filteredChanges: filtered.length,
      chapterGroups,
      entries: page,
      ...(start + page.length < filtered.length && page.length
        ? {
            nextCursor: this.tokens.issue(
              'file-diff',
              binding,
              requiredValue(page.at(-1)).changeId.digest,
              300_000,
            ),
          }
        : {}),
      sourceWatermarks: to.sourceWatermarks,
    };
  }
  async resolveLocations(
    authority: MarkdownReadAuthority,
    input: Artifact.ArtifactResolveFileReviewLocationsPayload,
  ): Promise<Artifact.ArtifactResolveFileReviewLocationsResult> {
    const from = await this.read(
      authority,
      'artifact.resolve_file_review_locations',
      input.fromRevisionRef,
    );
    const to = await this.read(
      authority,
      'artifact.resolve_file_review_locations',
      input.toRevisionRef,
    );
    if (!isDeepStrictEqual(from.artifactRef, to.artifactRef)) return markdownNotFound();
    const units = unitIndex(to.payload.body);
    const oldUnits = unitIndex(from.payload.body);
    const items = input.locations.map((originalLocation) => {
      assertLocation(input.fromRevisionRef, from.payload.body, originalLocation);
      const unit = units.get(originalLocation.unitId);
      const old = requiredValue(oldUnits.get(originalLocation.unitId));
      if (!unit)
        return { originalLocation, resolution: 'REMOVED' as const, reasonCodes: ['UNIT_REMOVED'] };
      if (unit.unitType !== old.unitType)
        return {
          originalLocation,
          resolution: 'AMBIGUOUS' as const,
          reasonCodes: ['UNIT_TYPE_CHANGED'],
        };
      const suggestedLocation = fileReviewLocation(
        input.toRevisionRef,
        to.payload.body,
        unit.unitId,
      );
      const moved =
        !isDeepStrictEqual(originalLocation.path, suggestedLocation.path) ||
        unit.ordinal !== old.ordinal;
      const changed = !isDeepStrictEqual(originalLocation.claimHash, suggestedLocation.claimHash);
      return {
        originalLocation,
        resolution: moved
          ? ('MOVED' as const)
          : changed
            ? ('CHANGED' as const)
            : ('UNCHANGED' as const),
        suggestedLocation,
        reasonCodes: moved && changed ? ['CONTENT_AND_LOCATION_CHANGED'] : [],
      };
    });
    if (
      (await authority.authorize('artifact.resolve_file_review_locations', input.fromRevisionRef))
        .watermark !== from.authority.watermark ||
      (await authority.authorize('artifact.resolve_file_review_locations', input.toRevisionRef))
        .watermark !== to.authority.watermark
    )
      return markdownNotFound();
    return { items, sourceWatermarks: to.sourceWatermarks };
  }
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
