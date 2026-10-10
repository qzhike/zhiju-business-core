import type { FastifyRequest } from 'fastify';
import { isPlainObject } from './support.js';

export const JSON_BODY_LIMIT = 16 * 1024;

export type BodyReadResult =
  | { status: 'ok'; value: Record<string, unknown> }
  | { status: 'too-large' }
  | { status: 'invalid' };

/**
 * Reads and parses a bounded JSON object directly from the raw request stream.
 * This runs before Fastify's own parsing, so an oversized or malformed body is
 * rejected without ever buffering it in full.
 */
export async function readJsonBody(
  request: FastifyRequest,
  limit: number = JSON_BODY_LIMIT,
): Promise<BodyReadResult> {
  const contentLength = request.headers['content-length'];
  const declared =
    typeof contentLength === 'string' ? Number.parseInt(contentLength, 10) : undefined;
  if (declared !== undefined && Number.isFinite(declared) && declared > limit) {
    return { status: 'too-large' };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.raw as AsyncIterable<Buffer>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) return { status: 'too-large' };
    chunks.push(buffer);
  }
  if (size === 0) return { status: 'invalid' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (!isPlainObject(parsed)) return { status: 'invalid' };
  return { status: 'ok', value: parsed };
}

export function httpStatusForBody(result: Exclude<BodyReadResult, { status: 'ok' }>): number {
  return result.status === 'too-large' ? 413 : 400;
}
