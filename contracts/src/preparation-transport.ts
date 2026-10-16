import { parseUtcInstant } from './utc-instant.js';
import { isDeepStrictEqual } from 'node:util';
import { isUuidV7, sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import type { Common } from './generated/types/common.js';

/** Established by the trusted transport; a value alone never proves identity. */
export interface PreparationSession {
  readonly principalId: string;
  readonly authenticationContextHash: Common.ContentHash;
  readonly expiresAt: string;
}

export interface PreparationProjectScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

/** The approved public projection, persisted intact by the owning module. */
export interface WorkspaceCommandInput<P = Record<string, unknown>> {
  readonly commandId: string;
  readonly type: string;
  readonly version: '1.0';
  readonly scopeRef: PreparationProjectScope;
  readonly targetRef: Common.ObjectRef;
  readonly expectedAggregateVersion?: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly requestedAt: string;
  readonly deadline?: string;
  readonly payload: P;
  readonly integrity: {
    readonly canonicalizationVersion: '1';
    readonly payloadHash: Common.ContentHash;
  };
}

/** Safe owning error codes; never put customer content in the message. */
export class PreparationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PreparationError';
  }
}

export function preparationHash(value: unknown): Common.ContentHash {
  try {
    return {
      algorithm: 'SHA-256',
      digest: sha256CanonicalJson(value as CanonicalJsonValue),
      canonicalizationVersion: '1',
    };
  } catch {
    throw new PreparationError('API_VALUE_INVALID');
  }
}

export const samePreparationValue = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(left, right);

export function assertPreparationClosed(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw new PreparationError('API_VALUE_INVALID');
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key) || record[key] === undefined) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key)) ||
    Object.values(record).some((field) => field === undefined)
  )
    throw new PreparationError('API_VALUE_INVALID');
}

export function assertPreparationHash(value: unknown): asserts value is Common.ContentHash {
  assertPreparationClosed(value, ['algorithm', 'digest', 'canonicalizationVersion']);
  if (
    value.algorithm !== 'SHA-256' ||
    value.canonicalizationVersion !== '1' ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.digest)
  )
    throw new PreparationError('API_PAYLOAD_HASH_MISMATCH');
}

export function assertPreparationInstant(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    parseUtcInstant(value) === undefined
  )
    throw new PreparationError('API_VALUE_INVALID');
}

export function assertPreparationProjectScope(
  value: unknown,
): asserts value is PreparationProjectScope {
  assertPreparationClosed(value, ['enterpriseId', 'projectId']);
  if (
    typeof value.enterpriseId !== 'string' ||
    !isUuidV7(value.enterpriseId) ||
    typeof value.projectId !== 'string' ||
    !isUuidV7(value.projectId)
  )
    throw new PreparationError('SCOPE_MISMATCH');
}

/** Checks the transport binding before any admission or protected owner read. */
export function assertPreparationCommand(
  value: unknown,
  operation: string,
  targetObjectType: string,
  mode: 'CREATE' | 'MUTATE',
): asserts value is WorkspaceCommandInput {
  assertPreparationClosed(
    value,
    [
      'commandId',
      'type',
      'version',
      'scopeRef',
      'targetRef',
      'idempotencyKey',
      'correlationId',
      'requestedAt',
      'payload',
      'integrity',
    ],
    ['expectedAggregateVersion', 'causationId', 'deadline'],
  );
  assertPreparationProjectScope(value.scopeRef);
  assertPreparationClosed(value.targetRef, ['kind', 'objectType', 'objectId', 'scope']);
  const target = value.targetRef;
  if (
    value.type !== operation ||
    value.version !== '1.0' ||
    typeof value.commandId !== 'string' ||
    !isUuidV7(value.commandId) ||
    typeof value.correlationId !== 'string' ||
    !isUuidV7(value.correlationId) ||
    (value.causationId !== undefined &&
      (typeof value.causationId !== 'string' || !isUuidV7(value.causationId))) ||
    target.kind !== 'OBJECT' ||
    target.objectType !== targetObjectType ||
    typeof target.objectId !== 'string' ||
    !isUuidV7(target.objectId) ||
    !samePreparationValue(target.scope, value.scopeRef) ||
    typeof value.idempotencyKey !== 'string' ||
    value.idempotencyKey !==
      `${operation}:1.0:${target.objectId}${mode === 'MUTATE' ? ':2' : ''}` ||
    (mode === 'CREATE' && value.expectedAggregateVersion !== undefined) ||
    (mode === 'MUTATE' &&
      (!Number.isSafeInteger(value.expectedAggregateVersion) ||
        (value.expectedAggregateVersion as number) < 1))
  )
    throw new PreparationError('API_VALUE_INVALID');
  assertPreparationInstant(value.requestedAt);
  if (value.deadline !== undefined) assertPreparationInstant(value.deadline);
  assertPreparationClosed(value.integrity, ['canonicalizationVersion', 'payloadHash']);
  assertPreparationHash(value.integrity.payloadHash);
  if (
    value.integrity.canonicalizationVersion !== '1' ||
    !samePreparationValue(value.integrity.payloadHash, preparationHash(value.payload))
  )
    throw new PreparationError('API_PAYLOAD_HASH_MISMATCH');
}
