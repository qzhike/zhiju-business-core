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
//   2    4     keyId                           (uint32)
//   6    32    requestBindingHash: sha256/cv1 over the complete request binding
//   38   32    sourceFingerprint               (complete canonical source fingerprint)
//   70   16    generationId                    (uuid bytes, zero for authority)
//   86   32    manifestHash                    (complete, zero for authority)
//   118  8     sourceWatermarks[0].sequence    (uint64, safe integer)
//   126  8     snapshotAt                      (int64 ms)
//   134  16    lastTaskId                      (uuid bytes)
//   150  8     issuedAt                        (int64 ms)
//   158  8     expiresAt                       (int64 ms)
//   166  32    HMAC-SHA256(secret) over bytes 0..165
//
// pageSize, consistencyRequirement, asOf and minimumWatermark are bound (and
// compared) through the requestBindingHash, so they do not consume payload
// bytes of their own.

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
/** Field offsets inside the 166-byte payload (the approved cv1 layout). */
const OFF = {
  keyId: 2,
  requestBindingHash: 6,
  sourceFingerprint: 38,
  generationId: 70,
  manifestHash: 86,
  watermarkSequence: 118,
  snapshotAt: 126,
  lastTaskId: 134,
  issuedAt: 150,
  expiresAt: 158,
} as const;
const ZERO_UUID = Buffer.alloc(16);

function bindingHash(value: CanonicalJsonValue): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest();
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
  // Spec 003 §12.6 keeps the publication sequence a uint64 safe integer; the
  // PostgreSQL column allows up to 9007199254740991.
  if (!Number.isSafeInteger(value) || value < 0) fail('API_VALUE_INVALID');
  buffer.writeBigUInt64BE(BigInt(value), offset);
}

function readCount(buffer: Buffer, offset: number): number {
  const value = Number(buffer.readBigUInt64BE(offset));
  if (!Number.isSafeInteger(value) || value < 0) fail('QUERY_CURSOR_INVALID');
  return value;
}

function hexBytes(value: string, code: string): Buffer {
  const bytes = Buffer.from(value, 'hex');
  if (bytes.length !== 32) fail(code);
  return bytes;
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

/** The decoded cursor: raw session state plus the opaque binding hashes. */
export interface TaskBoardDecodedCursor {
  readonly mode: 'GENERATION' | 'AUTHORITY';
  readonly generationId?: string;
  readonly snapshotAt: string;
  readonly watermarkSequence: number;
  readonly lastTaskId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly requestBindingHash: Buffer;
  readonly sourceFingerprint: Buffer;
  readonly manifestHash: Buffer;
}

function payloadFor(claims: TaskBoardCursorClaims, keyId: number): Buffer {
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload[0] = FORMAT_VERSION;
  payload[1] = claims.generationId === undefined ? 1 : 0;
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
  uuidBytes(claims.lastTaskId).copy(payload, OFF.lastTaskId);
  if (claims.sourceFingerprint === undefined) fail('API_VALUE_INVALID');
  hexBytes(claims.sourceFingerprint, 'API_VALUE_INVALID').copy(payload, OFF.sourceFingerprint);
  if (claims.generationId === undefined) {
    ZERO_UUID.copy(payload, OFF.generationId);
    Buffer.alloc(32).copy(payload, OFF.manifestHash);
  } else {
    if (claims.manifestHash === undefined) fail('API_VALUE_INVALID');
    uuidBytes(claims.generationId).copy(payload, OFF.generationId);
    hexBytes(claims.manifestHash, 'API_VALUE_INVALID').copy(payload, OFF.manifestHash);
  }
  // One complete-canonicalization hash binds the whole request binding; the
  // generation/fingerprint evidence is carried in full beside it.
  bindingHash({
    queryType: claims.queryType,
    queryVersion: claims.queryVersion,
    projectRef: claims.projectRef,
    requesterPurposeHash: claims.requesterPurposeHash,
    authorizationSourceHash: claims.authorizationSourceHash,
    normalizedFilterHash: claims.normalizedFilterHash,
    pageSize: claims.pageSize,
    consistency: claims.consistency,
    policyRef: claims.policyRef,
    policyContentHash: claims.policyContentHash,
    policyVersionRef: claims.policyVersionRef,
    asOf: claims.asOf ?? null,
    minimumWatermark: claims.minimumWatermark ?? null,
  }).copy(payload, OFF.requestBindingHash);
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
  const generationIdBytes = payload.subarray(OFF.generationId, OFF.generationId + 16);
  const manifestHashBytes = Buffer.from(payload.subarray(OFF.manifestHash, OFF.manifestHash + 32));
  // An authority cursor must not carry generation evidence, and vice versa.
  if (
    (mode === 'AUTHORITY' && !generationIdBytes.equals(ZERO_UUID)) ||
    (mode === 'AUTHORITY' && !manifestHashBytes.equals(Buffer.alloc(32)))
  )
    fail('QUERY_CURSOR_INVALID');
  const issuedAt = readMilliseconds(payload, OFF.issuedAt);
  const expiresAt = readMilliseconds(payload, OFF.expiresAt);
  if (expiresAt <= issuedAt) fail('QUERY_CURSOR_INVALID');
  if (now.getTime() >= expiresAt) fail('QUERY_CURSOR_EXPIRED');
  const requestBindingHash = Buffer.from(
    payload.subarray(OFF.requestBindingHash, OFF.requestBindingHash + 32),
  );
  const sourceFingerprint = Buffer.from(
    payload.subarray(OFF.sourceFingerprint, OFF.sourceFingerprint + 32),
  );
  return {
    mode,
    ...(mode === 'GENERATION' ? { generationId: uuidText(generationIdBytes) } : {}),
    snapshotAt: new Date(readMilliseconds(payload, OFF.snapshotAt)).toISOString(),
    watermarkSequence: readCount(payload, OFF.watermarkSequence),
    lastTaskId: uuidText(payload.subarray(OFF.lastTaskId, OFF.lastTaskId + 16)),
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    requestBindingHash,
    sourceFingerprint,
    manifestHash: manifestHashBytes,
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
  // pageSize/consistency/asOf/minimumWatermark are compared through the
  // requestBindingHash below.
  const expected = payloadFor(claims, key.keyId);
  if (
    !timingSafeEqual(
      decoded.requestBindingHash,
      expected.subarray(OFF.requestBindingHash, OFF.requestBindingHash + 32),
    ) ||
    !timingSafeEqual(
      decoded.sourceFingerprint,
      expected.subarray(OFF.sourceFingerprint, OFF.sourceFingerprint + 32),
    ) ||
    !timingSafeEqual(
      decoded.manifestHash,
      expected.subarray(OFF.manifestHash, OFF.manifestHash + 32),
    )
  )
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
}
