import type { ManifestEntry } from '../domain/types.js';

export const READ_CHECK_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'INTERRUPTED',
  'FAILED',
  'UNKNOWN',
] as const;
export type ReadCheckStatus = (typeof READ_CHECK_STATUSES)[number];
export const READ_CHECK_OUTCOMES = [
  'AVAILABLE',
  'LIMITED',
  'UNSUPPORTED',
  'FAILED',
  'NOT_ELIGIBLE',
] as const;
export type ReadCheckOutcome = (typeof READ_CHECK_OUTCOMES)[number];
export const READ_CHECK_FILTERS = [
  'ALL',
  'AVAILABLE',
  'LIMITED',
  'UNSUPPORTED',
  'FAILED',
  'NOT_ELIGIBLE',
  'PENDING',
  'PROBLEMS',
] as const;
export type ReadCheckFilter = (typeof READ_CHECK_FILTERS)[number];
export interface ReadCheckCounts {
  available: number;
  limited: number;
  unsupported: number;
  failed: number;
  notEligible: number;
  pending: number;
}
export interface ReadCheckView {
  readonly checkId: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly profileId: string;
  readonly profileHash: string;
  readonly status: ReadCheckStatus;
  readonly resultVersion: number;
  readonly totalEntries: number;
  readonly counts: ReadCheckCounts;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly reasonCodes: readonly string[];
}
export interface ReadCheckResult {
  readonly entryId: string;
  readonly ordinal: number;
  readonly status: ReadCheckOutcome;
  readonly profileId: string;
  readonly checkedAt: string;
  readonly limitations: readonly string[];
  readonly resultHash?: string;
  readonly counts?: {
    readonly paragraphs: number;
    readonly tables: number;
    readonly comments: number;
    readonly revisions: number;
    readonly headersFooters: number;
    readonly characters: number;
  };
}
export interface ReadCheckEntry {
  readonly entry: ManifestEntry;
  readonly result?: ReadCheckResult;
}
export interface ReadCheckPage {
  readonly check: ReadCheckView;
  readonly filter: ReadCheckFilter;
  readonly total: number;
  readonly entries: readonly ReadCheckEntry[];
  readonly nextCursor?: string;
}
export interface ReadCheckIdentity {
  readonly ownerId: string;
  readonly authEpoch: number;
}
export interface ReadCheckScope {
  readonly projectId: string;
  readonly batchId: string;
  readonly checkId: string;
}
export interface ReadCheckLease extends ReadCheckScope {
  readonly ownerId: string;
  readonly authEpoch: number;
  readonly generation: number;
  readonly fencingToken: string;
  readonly manifestId: string;
  readonly profileHash: string;
  readonly startedAt: string;
}
