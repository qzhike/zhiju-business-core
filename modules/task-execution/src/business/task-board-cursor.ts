// IM-06 TD-05 (#248): the compact, tamper-evident Board cursor.
//
// The shared API §6.2 requires an opaque cursor whose public spelling matches
// `^[A-Za-z0-9_-]{16,512}$`; Spec 003 §12.6 binds the full closed logical claim
// set, and the design review settled the encoding on a fixed 198-byte /
// 264-character structure: a 166-byte payload plus a **full 32-byte
// HMAC-SHA256 tag** (`base64url(198) === 264`).
//
// Payload layout (big-endian, milliseconds as int64):
//
//   off  size  field
//   0    1     format version
//   1    1     mode (0 = fixed generation, 1 = authority snapshot)
//   2    2     pageSize                       (uint16)
//   4    1     consistencyRequirement          (0/1/2)
//   5    1     flags (bit0 asOf, bit1 minimumWatermark)
//   6    4     keyId                           (uint32)
//   10   8     issuedAt                        (int64 ms)
//   18   8     expiresAt                       (int64 ms)
//   26   8     snapshotAt                      (int64 ms)
//   34   8     sourceWatermarks[0].sequence    (uint64)
//   42   8     asOf                            (int64 ms, 0 when absent)
//   50   8     minimumWatermark                (uint64, 0 when absent)
//   58   16    lastTaskId                      (uuid bytes)
//   74   16    generationId                    (uuid bytes, zero for authority)
//   90   16    digestA: queryType, queryVersion, complete ProjectRef
//   106  16    digestB: requesterPurposeHash, authorizationSourceHash, normalizedFilterHash
//   122  16    digestC: policyRef, policyContentHash, policyVersionRef
//   138  16    digestD: manifestHash (generation) | sourceFingerprint (authority)
//   154  12    reserved (zero) — format headroom
//   166  32    HMAC-SHA256(secret) over bytes 0..165
//
// The HMAC key is a trusted startup secret plus its numeric `keyId`; a Decision
// hash is never the signing key, and neither the secret nor the key material is
// stored in a database, a cursor or an audit row.

import { Buffer } from 'node:buffer';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  canonicalize,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { fail } from './work-order-validation-plan.js';
import type { TaskBoardConsistency } from './task-board-types.js';

const FORMAT_VERSION = 1;
const PAYLOAD_BYTES = 166;
const TAG_BYTES = 32;
/** Fixed encoded byte length: payload + full HMAC tag (264 base64url chars). */
export const TASK_BOARD_CURSOR_BYTES = PAYLOAD_BYTES + TAG_BYTES;
const MAX_UINT32 = 0xffff_ffff;
const CONSISTENCY_ORDER: readonly TaskBoardConsistency[] = [
  'AUTHORITATIVE',
  'SNAPSHOT_AT_LEAST',
  'PROJECTION_OK',
];
const CONSISTENCY_CODE: Readonly<Record<TaskBoardConsistency, number>> = {
  AUTHORITATIVE: 0,
  SNAPSHOT_AT_LEAST: 1,
  PROJECTION_OK: 2,
};
/** Field offsets inside the 166-byte payload. */
const OFF = {
  pageSize: 2,
  consistency: 4,
  flags: 5,
  keyId: 6,
  issuedAt: 10,
  expiresAt: 18,
  snapshotAt: 26,
  watermarkSequence: 34,
  asOf: 42,
  minimumWatermark: 50,
  lastTaskId: 58,
  generationId: 74,
  digestA: 90,
  digestB: 106,
  digestC: 122,
  digestD: 138,
} as const;

function bindingDigest(value: CanonicalJsonValue): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest().subarray(0, 16);
}

function uuidBytes(value: string): Buffer {
  const text = value.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(text)) fail('API_VALUE_INVALID');
  return Buffer.from(text, 'hex');
}

function uuidText(value: Buffer): string {
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function writeMilliseconds(buffer: Buffer, offset: number, value: number): void {
  if (!Number.isSafeInteger(value)) fail('API_VALUE_INVALID');
  buffer.writeBigInt64BE(BigInt(value), offset);
}

function readMilliseconds(buffer: Buffer, offset: number): number {
  const raw = buffer.readBigInt64BE(offset);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail('QUERY_CURSOR_INVALID');
  return value;
}

function writeCount(buffer: Buffer, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail('API_VALUE_INVALID');
  buffer.writeBigUInt64BE(BigInt(value), offset);
}

function readCount(buffer: Buffer, offset: number): number {
  const value = Number(buffer.readBigUInt64BE(offset));
  if (!Number.isSafeInteger(value)) fail('QUERY_CURSOR_INVALID');
  return value;
}

function instantToMilliseconds(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

/** The trusted server-side cursor secret plus its numeric selector. */
export interface TaskBoardCursorKey {
  readonly keyId: number;
  readonly secret: Buffer;
}

/** The full closed logical claim set bound into a Board cursor. */
export interface TaskBoardCursorClaims {
  readonly queryType: string;
  readonly queryVersion: string;
  readonly projectRef: CanonicalJsonObject;
  readonly requesterPurposeHash: string;
  readonly authorizationSourceHash: string;
  readonly normalizedFilterHash: string;
  readonly pageSize: number;
  readonly consistency: TaskBoardConsistency;
  readonly asOf?: string | undefined;
  readonly minimumWatermark?: number | undefined;
  readonly policyRef: CanonicalJsonObject;
  readonly policyContentHash: string;
  readonly policyVersionRef: CanonicalJsonObject;
  readonly generationId?: string | undefined;
  readonly manifestHash?: string | undefined;
  readonly sourceFingerprint?: string | undefined;
  readonly snapshotAt: string;
  readonly watermarkSequence: number;
  readonly lastTaskId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** The decoded cursor: raw paging state plus the opaque binding digests. */
export interface TaskBoardDecodedCursor {
  readonly mode: 'GENERATION' | 'AUTHORITY';
  readonly pageSize: number;
  readonly consistency: TaskBoardConsistency;
  readonly asOf?: number;
  readonly minimumWatermark?: number;
  readonly generationId?: string;
  readonly snapshotAt: string;
  readonly watermarkSequence: number;
  readonly lastTaskId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly digests: readonly Buffer[];
}

function payloadFor(claims: TaskBoardCursorClaims, keyId: number): Buffer {
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload[0] = FORMAT_VERSION;
  payload[1] = claims.generationId === undefined ? 1 : 0;
  payload.writeUInt16BE(claims.pageSize, OFF.pageSize);
  payload[OFF.consistency] = CONSISTENCY_CODE[claims.consistency];
  payload[OFF.flags] =
    (claims.asOf === undefined ? 0 : 1) | (claims.minimumWatermark === undefined ? 0 : 2);
  payload.writeUInt32BE(keyId, OFF.keyId);
  writeMilliseconds(
    payload,
    OFF.issuedAt,
    instantToMilliseconds(claims.issuedAt, 'API_VALUE_INVALID'),
  );
  writeMilliseconds(
    payload,
    OFF.expiresAt,
    instantToMilliseconds(claims.expiresAt, 'API_VALUE_INVALID'),
  );
  writeMilliseconds(
    payload,
    OFF.snapshotAt,
    instantToMilliseconds(claims.snapshotAt, 'API_VALUE_INVALID'),
  );
  writeCount(payload, OFF.watermarkSequence, claims.watermarkSequence);
  if (claims.asOf !== undefined)
    writeMilliseconds(payload, OFF.asOf, instantToMilliseconds(claims.asOf, 'API_VALUE_INVALID'));
  if (claims.minimumWatermark !== undefined)
    writeCount(payload, OFF.minimumWatermark, claims.minimumWatermark);
  uuidBytes(claims.lastTaskId).copy(payload, OFF.lastTaskId);
  let digestD: Buffer;
  if (claims.generationId === undefined) {
    if (claims.sourceFingerprint === undefined) fail('API_VALUE_INVALID');
    digestD = bindingDigest({ sourceFingerprint: claims.sourceFingerprint });
  } else {
    if (claims.manifestHash === undefined) fail('API_VALUE_INVALID');
    uuidBytes(claims.generationId).copy(payload, OFF.generationId);
    digestD = bindingDigest({ manifestHash: claims.manifestHash });
  }
  bindingDigest({
    queryType: claims.queryType,
    queryVersion: claims.queryVersion,
    projectRef: claims.projectRef,
  }).copy(payload, OFF.digestA);
  bindingDigest({
    requesterPurposeHash: claims.requesterPurposeHash,
    authorizationSourceHash: claims.authorizationSourceHash,
    normalizedFilterHash: claims.normalizedFilterHash,
  }).copy(payload, OFF.digestB);
  bindingDigest({
    policyRef: claims.policyRef,
    policyContentHash: claims.policyContentHash,
    policyVersionRef: claims.policyVersionRef,
  }).copy(payload, OFF.digestC);
  digestD.copy(payload, OFF.digestD);
  return payload;
}

function assertKey(key: TaskBoardCursorKey): void {
  if (!Number.isSafeInteger(key.keyId) || key.keyId < 1 || key.keyId > MAX_UINT32)
    fail('API_VALUE_INVALID');
  if (!Buffer.isBuffer(key.secret) || key.secret.length < 32) fail('API_VALUE_INVALID');
}

/** Encode one claim set into the fixed 198-byte base64url cursor. */
export function encodeTaskBoardCursor(
  claims: TaskBoardCursorClaims,
  key: TaskBoardCursorKey,
): string {
  assertKey(key);
  const payload = payloadFor(claims, key.keyId);
  const tag = createHmac('sha256', key.secret).update(payload).digest();
  return Buffer.concat([payload, tag]).toString('base64url');
}

/**
 * Decode and authenticate one cursor against the trusted server clock.
 * Tampering, an unknown/other key id, a non-canonical shape or an expired
 * validity window fails closed; `now` is the trusted time, never the raw
 * process clock.
 */
export function decodeTaskBoardCursor(
  value: string,
  key: TaskBoardCursorKey,
  now: Date,
): TaskBoardDecodedCursor {
  assertKey(key);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('API_VALUE_INVALID');
  if (!/^[A-Za-z0-9_-]{16,512}$/u.test(value)) fail('QUERY_CURSOR_INVALID');
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== TASK_BOARD_CURSOR_BYTES) fail('QUERY_CURSOR_INVALID');
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  const tag = raw.subarray(PAYLOAD_BYTES);
  const expected = createHmac('sha256', key.secret).update(payload).digest();
  if (!timingSafeEqual(tag, expected)) fail('QUERY_CURSOR_INVALID');
  if (payload[0] !== FORMAT_VERSION) fail('QUERY_CURSOR_INVALID');
  const mode = payload[1] === 0 ? 'GENERATION' : payload[1] === 1 ? 'AUTHORITY' : undefined;
  if (mode === undefined) fail('QUERY_CURSOR_INVALID');
  if (payload.readUInt32BE(OFF.keyId) !== key.keyId) fail('QUERY_CURSOR_INVALID');
  const consistency = CONSISTENCY_ORDER[payload[OFF.consistency] ?? -1];
  if (consistency === undefined) fail('QUERY_CURSOR_INVALID');
  const flags = payload[OFF.flags] ?? 0;
  if ((flags & ~3) !== 0) fail('QUERY_CURSOR_INVALID');
  const issuedAt = readMilliseconds(payload, OFF.issuedAt);
  const expiresAt = readMilliseconds(payload, OFF.expiresAt);
  if (expiresAt <= issuedAt) fail('QUERY_CURSOR_INVALID');
  if (now.getTime() >= expiresAt) fail('QUERY_CURSOR_EXPIRED');
  const digests = [
    Buffer.from(payload.subarray(OFF.digestA, OFF.digestA + 16)),
    Buffer.from(payload.subarray(OFF.digestB, OFF.digestB + 16)),
    Buffer.from(payload.subarray(OFF.digestC, OFF.digestC + 16)),
    Buffer.from(payload.subarray(OFF.digestD, OFF.digestD + 16)),
  ];
  return {
    mode,
    pageSize: payload.readUInt16BE(OFF.pageSize),
    consistency,
    ...(flags & 1 ? { asOf: readMilliseconds(payload, OFF.asOf) } : {}),
    ...(flags & 2 ? { minimumWatermark: readCount(payload, OFF.minimumWatermark) } : {}),
    ...(mode === 'GENERATION'
      ? { generationId: uuidText(payload.subarray(OFF.generationId, OFF.generationId + 16)) }
      : {}),
    snapshotAt: new Date(readMilliseconds(payload, OFF.snapshotAt)).toISOString(),
    watermarkSequence: readCount(payload, OFF.watermarkSequence),
    lastTaskId: uuidText(payload.subarray(OFF.lastTaskId, OFF.lastTaskId + 16)),
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    digests,
  };
}

/**
 * Compare a decoded cursor against the current query binding. Every closed
 * logical claim is compared, so a changed Scope, filter, Purpose,
 * authorization source, Policy, page size, consistency or
 * generation/fingerprint binding is rejected instead of silently continued.
 */
export function assertTaskBoardCursorBinding(
  decoded: TaskBoardDecodedCursor,
  claims: TaskBoardCursorClaims,
  key: TaskBoardCursorKey,
): void {
  if (decoded.mode !== (claims.generationId === undefined ? 'AUTHORITY' : 'GENERATION'))
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
  if (decoded.generationId !== claims.generationId) fail('QUERY_CURSOR_SCOPE_MISMATCH');
  if (decoded.pageSize !== claims.pageSize || decoded.consistency !== claims.consistency)
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
  const asOf =
    claims.asOf === undefined ? undefined : instantToMilliseconds(claims.asOf, 'API_VALUE_INVALID');
  if (decoded.asOf !== asOf || decoded.minimumWatermark !== claims.minimumWatermark)
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
  const expected = payloadFor(claims, key.keyId);
  const expectedDigests = [
    expected.subarray(OFF.digestA, OFF.digestA + 16),
    expected.subarray(OFF.digestB, OFF.digestB + 16),
    expected.subarray(OFF.digestC, OFF.digestC + 16),
    expected.subarray(OFF.digestD, OFF.digestD + 16),
  ];
  for (let index = 0; index < expectedDigests.length; index += 1) {
    const actual = decoded.digests[index];
    const wanted = expectedDigests[index];
    if (actual === undefined || wanted === undefined || !timingSafeEqual(actual, wanted))
      fail('QUERY_CURSOR_SCOPE_MISMATCH');
  }
}
