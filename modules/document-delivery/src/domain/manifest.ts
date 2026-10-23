import { createHash } from 'node:crypto';

import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';

import type { InputManifest, ManifestEntry, ManifestSummary } from './types.js';

const MANIFEST_DOMAIN = 'mvp.input_manifest@1\n';

/**
 * `manifestHash = SHA256(UTF8('mvp.input_manifest@1\n') + UTF8(cv1(payload without manifestHash)))`.
 * File SHA-256 digests use raw bytes and are a different domain.
 */
export function manifestHash(manifest: InputManifest | Record<string, unknown>): string {
  const payload: Record<string, unknown> = { ...manifest };
  delete payload.manifestHash;
  return createHash('sha256')
    .update(MANIFEST_DOMAIN, 'utf8')
    .update(canonicalize(payload as CanonicalJsonValue), 'utf8')
    .digest('hex');
}

export function manifestSummary(manifest: InputManifest): ManifestSummary {
  return {
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    batchId: manifest.batchId,
    originalZip: manifest.originalZip,
    totalEntries: manifest.entries.length,
    acceptedEntries: manifest.entries.filter((entry) => entry.status === 'ACCEPTED').length,
    limitedEntries: manifest.entries.filter((entry) => entry.status !== 'ACCEPTED').length,
    createdAt: manifest.createdAt,
  };
}

export function assertManifestEntries(
  entries: readonly ManifestEntry[],
): asserts entries is readonly ManifestEntry[] {
  let ordinal = -1;
  for (const entry of entries) {
    if (entry.ordinal <= ordinal) throw new Error('manifest ordinals must strictly increase');
    ordinal = entry.ordinal;
    if (entry.status === 'ACCEPTED' && entry.sourceRef === undefined)
      throw new Error('accepted entries require a source reference');
    if (entry.status !== 'ACCEPTED' && entry.sourceRef !== undefined)
      throw new Error('limited entries cannot carry a source reference');
  }
}
