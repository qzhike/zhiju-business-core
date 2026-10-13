import { asRecord, type JsonRecord } from './values.js';

export interface Hash {
  algorithm: 'SHA-256';
  digest: string;
  canonicalizationVersion: '1';
}
export interface Revision {
  kind: 'CONTENT_ADDRESSED';
  objectType: 'artifact.artifact_revision';
  objectId: string;
  scope: { enterpriseId: string; projectId: string };
  contentHash: Hash;
}
export interface Representation {
  representationId: string;
  revision: Revision;
  format: string;
  mediaType: string;
  objectStorageRef: string;
  checksum: Hash;
  renderer: { rendererId: string; rendererVersion: string };
  createdAt: string;
}
export interface ReviewLink {
  artifactRef: {
    kind: 'OBJECT';
    objectType: 'artifact.artifact';
    objectId: string;
    scope: Revision['scope'];
  };
  revisionRef: Revision;
  baselineKind: 'REVISION' | 'EMPTY_INITIAL';
  fromRevisionRef?: Revision;
  representationRef?: Representation;
}
export interface InlineSpan {
  start: number;
  end: number;
  kind: 'STRONG' | 'EMPHASIS' | 'CODE' | 'HARD_BREAK';
}
export interface Unit {
  unitId: string;
  unitType: 'SECTION' | 'PARAGRAPH' | 'TABLE' | 'TABLE_ROW' | 'TABLE_CELL';
  parentUnitId?: string;
  ordinal: number;
  childUnitIds: string[];
  text?: string;
  semanticMetadata: {
    markdown: {
      inlineSpans?: InlineSpan[];
      headingLevel?: number;
      blockKind?: string;
      listDepth?: number;
      listKind?: string;
      orderedMarker?: string;
      columns?: { columnId: string; alignment: string }[];
    };
  };
}
export interface Document {
  documentId: string;
  title: string;
  units: Unit[];
}
export interface ReviewContent {
  revisionRef: Revision;
  canonicalContentHash: Hash;
  document: Document;
  authoritativeIdentityMap: { artifactRef: ReviewLink['artifactRef'] };
  currentUsability: string;
}
export interface Change {
  changeId: Hash;
  unitId: string;
  kind: 'ADDED' | 'REMOVED' | 'CHANGED' | 'MOVED';
  beforeValue?: Unit;
  afterValue?: Unit;
  beforeLocation?: JsonRecord;
  afterLocation?: JsonRecord;
  chapterUnitIds: string[];
  contextUnitIds: string[];
}
export interface Changes {
  exactInputs: {
    toRevisionRef: Revision;
    fromRevisionRef?: Revision;
    baselineKind: ReviewLink['baselineKind'];
  };
  diffHash: Hash;
  totalChanges: number;
  changedUnitCount: number;
  filteredChanges: number;
  chapterGroups: { unitId: string; title: string; changeCount: number }[];
  entries: Change[];
  nextCursor?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function revision(value: unknown): value is Revision {
  const ref = asRecord(value);
  const scope = asRecord(ref?.scope);
  const hash = asRecord(ref?.contentHash);
  return (
    ref?.kind === 'CONTENT_ADDRESSED' &&
    ref.objectType === 'artifact.artifact_revision' &&
    typeof ref.objectId === 'string' &&
    uuid.test(ref.objectId) &&
    typeof scope?.enterpriseId === 'string' &&
    uuid.test(scope.enterpriseId) &&
    typeof scope.projectId === 'string' &&
    uuid.test(scope.projectId) &&
    hash?.algorithm === 'SHA-256' &&
    hash.canonicalizationVersion === '1' &&
    typeof hash.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(hash.digest)
  );
}
export function sameRevision(left: unknown, right: unknown): boolean {
  return (
    revision(left) &&
    revision(right) &&
    left.objectId === right.objectId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.scope.projectId === right.scope.projectId &&
    left.contentHash.digest === right.contentHash.digest
  );
}
export function parseReviewLink(
  search: string,
  artifactId: string,
  revisionId: string,
  projectId: string,
): ReviewLink {
  const params = new URLSearchParams(search);
  const raw = params.get('binding');
  if (
    !raw ||
    raw.length > 12000 ||
    params.getAll('binding').length !== 1 ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  )
    throw new Error('Invalid review link');
  const value = asRecord(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    ),
  );
  const target = value?.revisionRef;
  const artifact = asRecord(value?.artifactRef);
  const scope = asRecord(artifact?.scope);
  const representation = asRecord(value?.representationRef);
  if (
    !value ||
    !revision(target) ||
    target.objectId !== revisionId ||
    target.scope.projectId !== projectId ||
    artifact?.kind !== 'OBJECT' ||
    artifact.objectType !== 'artifact.artifact' ||
    artifact.objectId !== artifactId ||
    !uuid.test(artifactId) ||
    scope?.enterpriseId !== target.scope.enterpriseId ||
    scope.projectId !== projectId ||
    (value.baselineKind === 'REVISION'
      ? !revision(value.fromRevisionRef)
      : value.baselineKind !== 'EMPTY_INITIAL' || value.fromRevisionRef !== undefined) ||
    (value.representationRef !== undefined &&
      (!representation || !sameRevision(representation.revision, target)))
  )
    throw new Error('Invalid exact review binding');
  return value as unknown as ReviewLink;
}
export function parseReviewContent(
  value: unknown,
  link: ReviewLink,
  revisionRef = link.revisionRef,
): ReviewContent {
  const read = asRecord(value);
  const hash = asRecord(read?.canonicalContentHash);
  const map = asRecord(read?.authoritativeIdentityMap);
  const artifact = asRecord(map?.artifactRef);
  const scope = asRecord(artifact?.scope);
  const document = asRecord(read?.document);
  if (
    !read ||
    !sameRevision(read.revisionRef, revisionRef) ||
    hash?.digest !== revisionRef.contentHash.digest ||
    artifact?.objectId !== link.artifactRef.objectId ||
    scope?.enterpriseId !== revisionRef.scope.enterpriseId ||
    scope.projectId !== revisionRef.scope.projectId ||
    !Array.isArray(document?.units) ||
    typeof document.title !== 'string'
  )
    throw new Error('Invalid owning content');
  return read as unknown as ReviewContent;
}
export function parseChanges(value: unknown, link: ReviewLink): Changes {
  const page = asRecord(value);
  const inputs = asRecord(page?.exactInputs);
  const hash = asRecord(page?.diffHash);
  if (
    !page ||
    !sameRevision(inputs?.toRevisionRef, link.revisionRef) ||
    inputs?.baselineKind !== link.baselineKind ||
    (link.fromRevisionRef && !sameRevision(inputs.fromRevisionRef, link.fromRevisionRef)) ||
    !Array.isArray(page.entries) ||
    !Array.isArray(page.chapterGroups) ||
    typeof page.totalChanges !== 'number' ||
    !Number.isSafeInteger(page.totalChanges) ||
    page.totalChanges < page.entries.length ||
    typeof hash?.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash.digest)
  )
    throw new Error('Invalid change directory');
  return page as unknown as Changes;
}
