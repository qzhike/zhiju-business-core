import { createHmac, timingSafeEqual } from 'node:crypto';

import { fail } from './errors.js';

/**
 * Opaque, server-authenticated pagination cursor. It binds the owner and
 * authorization epoch, the endpoint and the project/manifest scope; a cursor
 * cannot be reused across users, scopes or a changed binding. The signed
 * payload also carries the immutable high-water mark of the first page, so new
 * rows never appear inside an existing snapshot.
 */
export interface CursorScope {
  readonly endpoint: string;
  readonly ownerId: string;
  readonly authEpoch: number;
  readonly projectId?: string;
  readonly manifestId?: string;
}

export interface CursorState extends CursorScope {
  readonly upper: number;
  readonly last: number;
}

export interface CursorPosition {
  readonly upper: number;
  readonly last: number;
}

interface WireCursor extends CursorScope {
  readonly v: 1;
  readonly upper: number;
  readonly last: number;
}

function encode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(secret: Buffer, payload: string): string {
  return encode(createHmac('sha256', secret).update(payload, 'utf8').digest());
}

export interface CursorCodec {
  encode(state: CursorState): string;
  decode(cursor: string, scope: CursorScope): CursorPosition;
}

export function createCursorCodec(secret: Buffer): CursorCodec {
  if (secret.length < 32) throw new TypeError('cursor key must be at least 32 bytes');
  return {
    encode(state) {
      const wire: WireCursor = {
        v: 1,
        endpoint: state.endpoint,
        ownerId: state.ownerId,
        authEpoch: state.authEpoch,
        upper: state.upper,
        last: state.last,
        ...(state.projectId === undefined ? {} : { projectId: state.projectId }),
        ...(state.manifestId === undefined ? {} : { manifestId: state.manifestId }),
      };
      const payload = encode(JSON.stringify(wire));
      return `${payload}.${sign(secret, payload)}`;
    },
    decode(cursor, scope) {
      const parts = cursor.split('.');
      if (parts.length !== 2) fail('CURSOR_INVALID');
      const [payload, signature] = parts as [string, string];
      const expected = Buffer.from(sign(secret, payload));
      const provided = Buffer.from(signature);
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided))
        fail('CURSOR_INVALID');
      let wire: unknown;
      try {
        wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        fail('CURSOR_INVALID');
      }
      if (typeof wire !== 'object' || wire === null || Array.isArray(wire)) fail('CURSOR_INVALID');
      const value = wire as Record<string, unknown>;
      if (
        value.v !== 1 ||
        value.endpoint !== scope.endpoint ||
        value.ownerId !== scope.ownerId ||
        value.authEpoch !== scope.authEpoch ||
        value.projectId !== scope.projectId ||
        value.manifestId !== scope.manifestId
      )
        fail('CURSOR_INVALID');
      if (
        typeof value.last !== 'number' ||
        !Number.isSafeInteger(value.last) ||
        value.last < 0 ||
        typeof value.upper !== 'number' ||
        !Number.isSafeInteger(value.upper) ||
        value.upper < value.last
      )
        fail('CURSOR_INVALID');
      return { upper: value.upper, last: value.last };
    },
  };
}
