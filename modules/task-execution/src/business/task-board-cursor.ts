// IM-06 TD-05 (#248): the compact, tamper-evident Board cursor.
//
// The shared API §6.2 requires an opaque cursor whose public spelling matches
// `^[A-Za-z0-9_-]{16,512}$`, while Spec 003 §12.6 binds the full logical claim
// set. This codec keeps the fixed 198-byte / 264-character shape the design
// review settled on: a 6-byte header, eleven 16-byte binding slots and a
// 16-byte truncated HMAC-SHA256 tag, encoded as one base64url string. The HMAC
// key is a trusted startup secret plus its `keyId`; a Decision hash is never
// used as the signing key and no secret ever enters a database or a cursor
// claim.

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
const SLOT_COUNT = 11;
const SLOT_BYTES = 16;
const TAG_BYTES = 16;
const HEADER_BYTES = 6;
const BODY_BYTES = HEADER_BYTES + SLOT_COUNT * SLOT_BYTES;
/** Fixed encoded byte length: header + slots + truncated HMAC tag (264 chars). */
export const TASK_BOARD_CURSOR_BYTES = BODY_BYTES + TAG_BYTES;
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

function digest16(value: CanonicalJsonValue): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest().subarray(0, SLOT_BYTES);
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

function uuidText(value: Buffer): string {
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function writeEpochSeconds(buffer: Buffer, offset: number, value: number): void {
  buffer.writeBigUInt64BE(BigInt(value), offset);
}

function readEpochSeconds(buffer: Buffer, offset: number): number {
  return Number(buffer.readBigUInt64BE(offset));
}

function epochSeconds(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return Math.floor(parsed / 1000);
}

function secondsToInstant(value: number): string {
  return new Date(value * 1000).toISOString();
}

function slotAt(body: Buffer, index: number): Buffer {
  return Buffer.from(
    body.subarray(HEADER_BYTES + index * SLOT_BYTES, HEADER_BYTES + (index + 1) * SLOT_BYTES),
  );
}

/** The trusted server-side cursor secret plus its non-secret selector. */
export interface TaskBoardCursorKey {
  readonly keyId: string;
  readonly secret: Buffer;
}

/** The full logical claim set bound into a Board cursor. */
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

/** The decoded cursor: raw paging state plus the opaque binding slots. */
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
  readonly slots: readonly Buffer[];
}

function slotsFor(claims: TaskBoardCursorClaims): Buffer[] {
  const { generationId, manifestHash, sourceFingerprint } = claims;
  const querySlot = digest16({ queryType: claims.queryType, queryVersion: claims.queryVersion });
  const projectSlot = digest16(claims.projectRef);
  const purposeSlot = digest16({
    requesterPurposeHash: claims.requesterPurposeHash,
    authorizationSourceHash: claims.authorizationSourceHash,
  });
  const filterSlot = digest16({ normalizedFilterHash: claims.normalizedFilterHash });
  const policySlot = digest16({
    policyRef: claims.policyRef,
    policyContentHash: claims.policyContentHash,
    policyVersionRef: claims.policyVersionRef,
  });
  let generationSlot: Buffer;
  let evidenceSlot: Buffer;
  if (generationId === undefined) {
    if (sourceFingerprint === undefined) fail('API_VALUE_INVALID');
    generationSlot = Buffer.alloc(SLOT_BYTES);
    evidenceSlot = digest16({ sourceFingerprint });
  } else {
    if (manifestHash === undefined) fail('API_VALUE_INVALID');
    generationSlot = uuidBytes(generationId);
    evidenceSlot = Buffer.from(manifestHash.slice(0, 32), 'hex');
  }
  const timeSlot = Buffer.alloc(SLOT_BYTES);
  writeEpochSeconds(timeSlot, 0, epochSeconds(claims.snapshotAt, 'API_VALUE_INVALID'));
  writeEpochSeconds(timeSlot, 8, claims.watermarkSequence);
  const lastTaskSlot = uuidBytes(claims.lastTaskId);
  const validitySlot = Buffer.alloc(SLOT_BYTES);
  writeEpochSeconds(validitySlot, 0, epochSeconds(claims.issuedAt, 'API_VALUE_INVALID'));
  writeEpochSeconds(validitySlot, 8, epochSeconds(claims.expiresAt, 'API_VALUE_INVALID'));
  const requestSlot = Buffer.alloc(SLOT_BYTES);
  if (claims.asOf !== undefined)
    writeEpochSeconds(requestSlot, 0, epochSeconds(claims.asOf, 'API_VALUE_INVALID'));
  if (claims.minimumWatermark !== undefined)
    writeEpochSeconds(requestSlot, 8, claims.minimumWatermark);
  return [
    querySlot,
    projectSlot,
    purposeSlot,
    filterSlot,
    policySlot,
    generationSlot,
    evidenceSlot,
    timeSlot,
    lastTaskSlot,
    validitySlot,
    requestSlot,
  ];
}

/** Encode one claim set into the fixed-size base64url cursor. */
export function encodeTaskBoardCursor(
  claims: TaskBoardCursorClaims,
  key: TaskBoardCursorKey,
): string {
  const body = Buffer.alloc(BODY_BYTES);
  body[0] = FORMAT_VERSION;
  body[1] = claims.generationId === undefined ? 1 : 0;
  body.writeUInt16BE(claims.pageSize, 2);
  body[4] = CONSISTENCY_CODE[claims.consistency];
  body[5] = (claims.asOf === undefined ? 0 : 1) | (claims.minimumWatermark === undefined ? 0 : 2);
  slotsFor(claims).forEach((slot, index) => slot.copy(body, HEADER_BYTES + index * SLOT_BYTES));
  const tag = createHmac('sha256', key.secret).update(body).digest().subarray(0, TAG_BYTES);
  return Buffer.concat([body, tag]).toString('base64url');
}

/** Decode and authenticate one cursor; tampering or expiry fails closed. */
export function decodeTaskBoardCursor(
  value: string,
  key: TaskBoardCursorKey,
): TaskBoardDecodedCursor {
  if (!/^[A-Za-z0-9_-]{16,512}$/u.test(value)) fail('QUERY_CURSOR_INVALID');
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== TASK_BOARD_CURSOR_BYTES) fail('QUERY_CURSOR_INVALID');
  const body = raw.subarray(0, BODY_BYTES);
  const tag = raw.subarray(BODY_BYTES);
  const expected = createHmac('sha256', key.secret).update(body).digest().subarray(0, TAG_BYTES);
  if (!timingSafeEqual(tag, expected)) fail('QUERY_CURSOR_INVALID');
  if (body[0] !== FORMAT_VERSION) fail('QUERY_CURSOR_INVALID');
  const mode = body[1] === 0 ? 'GENERATION' : body[1] === 1 ? 'AUTHORITY' : undefined;
  if (mode === undefined) fail('QUERY_CURSOR_INVALID');
  const consistency = CONSISTENCY_ORDER[body[4] ?? -1];
  if (consistency === undefined) fail('QUERY_CURSOR_INVALID');
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => slotAt(body, index));
  const flags = body[5] ?? 0;
  const timeSlot = slotAt(body, 7);
  const validitySlot = slotAt(body, 9);
  const requestSlot = slotAt(body, 10);
  const issuedAt = readEpochSeconds(validitySlot, 0);
  const expiresAt = readEpochSeconds(validitySlot, 8);
  if (expiresAt <= issuedAt) fail('QUERY_CURSOR_INVALID');
  if (Math.floor(Date.now() / 1000) >= expiresAt) fail('QUERY_CURSOR_EXPIRED');
  return {
    mode,
    pageSize: body.readUInt16BE(2),
    consistency,
    ...(flags & 1 ? { asOf: readEpochSeconds(requestSlot, 0) } : {}),
    ...(flags & 2 ? { minimumWatermark: readEpochSeconds(requestSlot, 8) } : {}),
    ...(mode === 'GENERATION' ? { generationId: uuidText(slotAt(body, 5)) } : {}),
    snapshotAt: secondsToInstant(readEpochSeconds(timeSlot, 0)),
    watermarkSequence: readEpochSeconds(timeSlot, 8),
    lastTaskId: uuidText(slotAt(body, 8)),
    issuedAt: secondsToInstant(issuedAt),
    expiresAt: secondsToInstant(expiresAt),
    slots,
  };
}

/**
 * Compare a decoded cursor against the current query binding. Every logical
 * claim the design closed over is compared, so a changed Scope, filter,
 * Purpose, authorization source, Policy, page size, consistency or
 * generation/fingerprint binding is rejected instead of silently continued.
 */
export function assertTaskBoardCursorBinding(
  decoded: TaskBoardDecodedCursor,
  claims: TaskBoardCursorClaims,
): void {
  const expectedSlots = slotsFor(claims);
  if (decoded.pageSize !== claims.pageSize || decoded.consistency !== claims.consistency)
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const actual = decoded.slots[index];
    const wanted = expectedSlots[index];
    if (actual === undefined || wanted === undefined || !timingSafeEqual(actual, wanted))
      fail('QUERY_CURSOR_SCOPE_MISMATCH');
  }
}
