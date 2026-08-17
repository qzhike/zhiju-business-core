import { parseUuidV7, type UuidV7 } from './identifiers.js';

export interface ContentHash {
  readonly algorithm: 'SHA-256';
  readonly canonicalizationVersion: '1';
  readonly digest: string;
}

export interface ScopeRef {
  readonly enterpriseId?: UuidV7;
  readonly projectId?: UuidV7;
}

export interface ObjectRef<TObjectType extends string = string> {
  readonly kind: 'OBJECT';
  readonly objectType: TObjectType;
  readonly objectId: UuidV7;
  readonly scope: ScopeRef;
}

export interface VersionedRef<TObjectType extends string = string> extends ObjectRef<TObjectType> {
  readonly versionId: UuidV7;
}

export interface ContentAddressedRef<
  TObjectType extends string = string,
> extends ObjectRef<TObjectType> {
  readonly contentHash: ContentHash;
}

export interface SnapshotRef<
  TObjectType extends string = string,
> extends ContentAddressedRef<TObjectType> {
  readonly snapshotId: UuidV7;
}

const namespacePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

function assertNamespace(value: string, label: string): void {
  if (!namespacePattern.test(value)) {
    throw new TypeError(`${label} must be a registered lower-case namespace`);
  }
}

export function scopeRef(input: {
  readonly enterpriseId?: string;
  readonly projectId?: string;
}): ScopeRef {
  if (input.projectId !== undefined && input.enterpriseId === undefined) {
    throw new TypeError('project scope requires enterpriseId');
  }
  return Object.freeze({
    ...(input.enterpriseId === undefined ? {} : { enterpriseId: parseUuidV7(input.enterpriseId) }),
    ...(input.projectId === undefined ? {} : { projectId: parseUuidV7(input.projectId) }),
  });
}

export function objectRef<TObjectType extends string>(input: {
  readonly objectType: TObjectType;
  readonly objectId: string;
  readonly scope: ScopeRef;
}): ObjectRef<TObjectType> {
  assertNamespace(input.objectType, 'objectType');
  return Object.freeze({
    kind: 'OBJECT',
    objectType: input.objectType,
    objectId: parseUuidV7(input.objectId),
    scope: input.scope,
  });
}

export function contentHash(digest: string): ContentHash {
  if (!sha256Pattern.test(digest)) {
    throw new TypeError('SHA-256 digest must be 64 lowercase hexadecimal characters');
  }
  return Object.freeze({ algorithm: 'SHA-256', canonicalizationVersion: '1', digest });
}

export function sameScope(left: ScopeRef, right: ScopeRef): boolean {
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

export function assertReferenceScope(reference: ObjectRef, expected: ScopeRef): void {
  if (!sameScope(reference.scope, expected)) {
    throw new TypeError('REFERENCE_SCOPE_MISMATCH');
  }
}
