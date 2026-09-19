// IM-06 (#216): deterministic assembly of the initial ProjectContext v1.0
// payload and its INITIAL build metadata (Spec 003 §19.4, R-214-4).
//
// This module is pure: no I/O, no clock, no randomness. Every input is an
// already-authenticated fact the owning handler read (the exact
// WorkOrderDraftSnapshot, the exact Source Slices through the
// EnterpriseProject-owned read Port, the exact Builder Policy observation
// through the IdentityPolicy-owned resolve Port), plus the pre-allocated
// Snapshot identity and the trusted assembly instant. The same inputs always
// produce byte-identical `payload`/`metadata`, which is what makes the
// Snapshot content address and the V3004 mirror columns reproducible.
//
// Everything §19.4 marks fail-closed is rejected here with the closed code
// set: `EXECUTION_CONTEXT_SOURCE_INVALID` (slice/fact/manifest/inputRef
// defects), `EXECUTION_CONTEXT_TARGET_INVALID` (unsupported targetScope),
// `EXECUTION_CONTEXT_INPUT_REQUIRED` (required input not adopted), the Policy
// binding codes of §11.2.5.2 and the shared `REFERENCE_INVALID` /
// `API_VALUE_INVALID` exterior. The expiry composition mirrors #168 exactly so
// the handler's `validateInitialContextExpiryBinding` re-check observes the
// same values the payload and metadata carry.

import { createHash } from 'node:crypto';
import {
  canonicalize,
  isUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { validateContextBuilderPolicyBinding } from '@zhiju/contracts';
import { validateContextBuilderPolicy } from './policy-profiles.js';
import { API_VALUE_INVALID } from './work-order-draft-creation.js';
import { REFERENCE_INVALID } from './work-order-draft-read.js';

/** §19.4 closed assembly codes (the only new codes the #214 design allows). */
export const EXECUTION_CONTEXT_SOURCE_INVALID = 'EXECUTION_CONTEXT_SOURCE_INVALID';
export const EXECUTION_CONTEXT_TARGET_INVALID = 'EXECUTION_CONTEXT_TARGET_INVALID';
export const EXECUTION_CONTEXT_INPUT_REQUIRED = 'EXECUTION_CONTEXT_INPUT_REQUIRED';

/** §19.4 item 8: the pinned omission/redaction mapping constants. */
export const SLICE_OMISSION_EFFECT_ON_TASK = 'see source slice for task effect';
/** §19.4 item 9: the pinned category of a draft-input omission. */
export const DRAFT_INPUT_OMISSION_CATEGORY = 'DRAFT_INPUT_REF';
export const DRAFT_INPUT_OMISSION_EFFECT_ON_TASK = 'see draft inputRefs for task effect';
export const DRAFT_INPUT_NOT_CAPTURED = 'NOT_CAPTURED_IN_SOURCE_SLICES';
export const DRAFT_INPUT_KIND_NOT_SUPPORTED = 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD';

/** The canonical object spellings this assembly writes (§19.4 items 5/7). */
export const ENTERPRISE_FACT_OBJECT_TYPE = 'zhiju.project.enterprise_fact';
const PROJECT_CONTEXT_CONTRACT_TYPE = 'zhiju.contract.project_context';
const CONTRACT_SCHEMA_OBJECT_TYPE = 'zhiju.contract.schema';
const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';

/**
 * The published #188 SourceKind closed set (the owning EP assembly emits
 * exactly these omission kinds, in this order).
 */
const SOURCE_KINDS: Readonly<Record<string, true>> = Object.freeze({
  PROJECT: true,
  ENTERPRISE_PROFILE: true,
  QMS_CONFIGURATION: true,
  PRODUCT_SCOPE: true,
  ACTIVE_BASELINES: true,
  ENTERPRISE_FACTS: true,
});

/** §19.4 item 8: the closed omission reasonCode set of a Source Slice. */
const SLICE_OMISSION_REASON_CODES: Readonly<Record<string, true>> = Object.freeze({
  KIND_NOT_REQUESTED: true,
  PURPOSE_FORBIDDEN: true,
});

/** §19.4 item 7: fixed status → epistemicState and riskLevel → sensitivity maps. */
const EPISTEMIC_STATE_BY_STATUS: Readonly<Record<string, string>> = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  DISPUTED: 'DISPUTED',
  SUPERSEDED: 'SUPERSEDED',
  PROPOSED: 'INFERRED',
});
const SENSITIVITY_BY_RISK_LEVEL: Readonly<Record<string, string>> = Object.freeze({
  LOW: 'INTERNAL',
  MEDIUM: 'CUSTOMER_CONFIDENTIAL',
  HIGH: 'RESTRICTED_PERSONAL',
  CRITICAL: 'REGULATED',
});

/** §19.4 item 9: the fixed least-trusted partial order of epistemic states. */
const EPISTEMIC_TRUST_RANK: Readonly<Record<string, number>> = Object.freeze({
  SUPERSEDED: 0,
  UNKNOWN: 1,
  INFERRED: 2,
  DISPUTED: 3,
  CONFIRMED: 4,
});
const EPISTEMIC_STATES: Readonly<Record<string, true>> = Object.freeze({
  CONFIRMED: true,
  INFERRED: true,
  UNKNOWN: true,
  DISPUTED: true,
  SUPERSEDED: true,
});

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

/** One exact Source Slice input: the request's exact ref and the owning read's payload. */
export interface InitialContextAssemblySlice {
  readonly ref: CanonicalJsonObject;
  readonly slice: CanonicalJsonObject;
}

/**
 * The Builder Policy observation of this build, exactly as the owning
 * `identity.resolve_policy@1.0` returned it (§19.4 item 3). `resolvedRef` is
 * the resolution's own ref; the four-point binding check proves it equals the
 * request/projection/metadata/versionPins ref.
 */
export interface InitialContextAssemblyPolicy {
  readonly resolvedRef: CanonicalJsonObject;
  /** The resolution's Policy content hash digest (64 lowercase hex). */
  readonly contentHashDigest: string;
  readonly effectiveFrom: string;
  readonly supersededAt?: string | undefined;
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}

/** The exact DRAFT facts the build consumes, from the immutable snapshot row. */
export interface InitialContextAssemblyDraft {
  /** The snapshot payload's top-level canonical `workOrderRef`. */
  readonly workOrderRef: CanonicalJsonObject;
  /** The snapshot payload's top-level `taskRef`. */
  readonly taskRef: CanonicalJsonObject;
  readonly scopeRef: { readonly enterpriseId: string; readonly projectId: string };
  /** The `InitialWorkOrderDraft` member of the snapshot payload. */
  readonly draft: Record<string, unknown>;
  /** The declared expiry text, absent exactly when the snapshot has no member. */
  readonly expiresAt?: string | undefined;
}

export interface InitialContextAssemblyRequest {
  readonly draftSnapshotRef: CanonicalJsonObject;
  readonly projectionType: string;
  readonly purpose: string;
  readonly audience: {
    readonly principalId: string;
    readonly principalKind: string;
  };
  readonly builderPolicyRef: CanonicalJsonObject;
  /**
   * The raw optional member: a declared expiry string, `undefined` when
   * absent, or any malformed/JSON-null value (the expiry binding validation
   * rejects those fail-closed; assembly treats them as "no bound" so the
   * candidate mirrors stay consistent for that rejection).
   */
  readonly expiresAt?: unknown;
}

export interface InitialContextAssemblyInput {
  readonly request: InitialContextAssemblyRequest;
  readonly draft: InitialContextAssemblyDraft;
  /** One entry per request `sourceSlices` ref; assembly owns the §19.4 sort. */
  readonly slices: readonly InitialContextAssemblySlice[];
  readonly policy: InitialContextAssemblyPolicy;
  /** Application-generated Snapshot identity (§19.2 item 2). */
  readonly snapshotId: string;
  /** The trusted assembly/commit instant (ISO text of the trusted clock). */
  readonly asOf: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  /** The trusted session principal (header `issuedBy`). */
  readonly issuedBy: {
    readonly principalId: string;
    readonly principalKind: string;
  };
}

export type InitialContextAssemblyOutcome =
  | {
      readonly outcome: 'ASSEMBLED';
      readonly payload: CanonicalJsonObject;
      readonly metadata: CanonicalJsonObject;
    }
  | {
      readonly outcome: 'REJECTED';
      readonly errorCode: string;
      readonly safeSummary: string;
    };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rejected(errorCode: string, safeSummary: string): InitialContextAssemblyOutcome {
  return { outcome: 'REJECTED', errorCode, safeSummary };
}

/**
 * Canonical v1 string of one value, or undefined when the value cannot be
 * canonically represented (non-integer numbers, NFC key collisions). Slice and
 * draft content is committed canonical data, so a failure here means the input
 * is not the fact it claims to be.
 */
function canonicalString(value: unknown): string | undefined {
  try {
    return canonicalize(value as CanonicalJsonValue);
  } catch {
    return undefined;
  }
}

/** UTF-8 byte order, the same ordering canonicalization v1 sorts keys with. */
function compareCanonical(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

// ---------------------------------------------------------------------------
// Exact `UtcInstant` parsing/ordering. The contracts package keeps these
// helpers internal, so the same rules are replicated here verbatim: calendar
// validation without runtime date normalization, whole-second milliseconds
// plus a fraction-string tiebreak. A malformed instant never compares equal.
// ---------------------------------------------------------------------------

const utcInstantPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return monthLengths[month - 1] ?? 0;
}

interface ParsedInstant {
  readonly wholeSecondMilliseconds: number;
  readonly fraction: string;
}

function parseInstant(value: string): ParsedInstant | undefined {
  const match = utcInstantPattern.exec(value);
  const timestamp = match?.[1];
  if (timestamp === undefined) return undefined;
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = Number(timestamp.slice(8, 10));
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const second = Number(timestamp.slice(17, 19));
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  return { wholeSecondMilliseconds: instant.getTime(), fraction: match?.[2] ?? '' };
}

function compareInstants(left: string, right: string): -1 | 0 | 1 | undefined {
  const leftParsed = parseInstant(left);
  const rightParsed = parseInstant(right);
  if (leftParsed === undefined || rightParsed === undefined) return undefined;
  if (leftParsed.wholeSecondMilliseconds < rightParsed.wholeSecondMilliseconds) return -1;
  if (leftParsed.wholeSecondMilliseconds > rightParsed.wholeSecondMilliseconds) return 1;
  const fractionLength = Math.max(leftParsed.fraction.length, rightParsed.fraction.length);
  const leftFraction = leftParsed.fraction.padEnd(fractionLength, '0');
  const rightFraction = rightParsed.fraction.padEnd(fractionLength, '0');
  if (leftFraction < rightFraction) return -1;
  if (leftFraction > rightFraction) return 1;
  return 0;
}

/** The Unix milliseconds one `UtcInstant` stamps into a UUIDv7 time field. */
function instantMilliseconds(value: string): number | undefined {
  const parsed = parseInstant(value);
  if (parsed === undefined) return undefined;
  // The trusted clock produces millisecond text; shorter fractions are padded
  // and any sub-millisecond digits are beyond what a Date-derived instant carries.
  const milliseconds = Number(parsed.fraction.padEnd(3, '0').slice(0, 3));
  return parsed.wholeSecondMilliseconds + milliseconds;
}

/**
 * §19.4 item 7: the deterministic RFC 9562 UUIDv7 of one mapped fact. Bits
 * 0-47 are the real Unix milliseconds of this build's `asOf`; the version
 * nibble is fixed to 7, the variant to [89ab], and `rand_a`/`rand_b` are the
 * leading digest bits of
 * `SHA-256(canonical_cv1(factItem) ‖ slice snapshotId ‖ in-slice index)`
 * (UTF-8 byte concatenation without separators - the design fixes the
 * concatenation order, and this slice is the only producer).
 */
function deriveContextItemId(
  asOfMilliseconds: number,
  factItemCanonical: string,
  sliceSnapshotId: string,
  inSliceIndex: number,
): string {
  const digest = createHash('sha256')
    .update(factItemCanonical, 'utf8')
    .update(sliceSnapshotId, 'utf8')
    .update(String(inSliceIndex), 'utf8')
    .digest();
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(Math.floor(asOfMilliseconds / 0x10000), 0);
  bytes.writeUInt16BE(asOfMilliseconds % 0x10000, 4);
  bytes[6] = 0x70 | ((digest[0] ?? 0) & 0x0f);
  bytes[7] = digest[1] ?? 0;
  bytes[8] = 0x80 | ((digest[2] ?? 0) & 0x3f);
  digest.copy(bytes, 9, 3, 10);
  const hex = bytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!isUuidV7(id)) {
    // Unreachable by construction (version/variant are fixed bits); the assert
    // keeps a future edit from silently breaking the RFC 9562 shape.
    throw new Error('derived contextItemId is not a UUIDv7');
  }
  return id;
}

interface SortedSlice {
  readonly ref: CanonicalJsonObject;
  readonly refCanonical: string;
  readonly refObjectId: string;
  readonly slice: Record<string, unknown>;
}

/**
 * §19.4 item 1: sort by `(objectType, objectId, snapshotId)` with the full
 * canonical string as the final tiebreak (a CONTENT_ADDRESSED ref carries no
 * `snapshotId`, so the content address itself orders same-object refs), and
 * reject exact duplicates. Request-array permutations cannot change the result.
 */
function sortSlices(
  entries: readonly InitialContextAssemblySlice[],
): readonly SortedSlice[] | undefined {
  const sorted: SortedSlice[] = [];
  for (const entry of entries) {
    const ref = record(entry.ref);
    const refCanonical = canonicalString(entry.ref);
    const objectType = ref.objectType;
    const objectId = ref.objectId;
    if (
      ref.kind !== 'CONTENT_ADDRESSED' ||
      objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
      typeof objectId !== 'string' ||
      !isUuidV7(objectId) ||
      refCanonical === undefined
    ) {
      return undefined;
    }
    sorted.push({
      ref: entry.ref,
      refCanonical,
      refObjectId: objectId,
      slice: record(entry.slice),
    });
  }
  if (sorted.length === 0) return undefined;
  sorted.sort((left, right) => {
    const byRef = compareCanonical(left.refCanonical, right.refCanonical);
    if (byRef !== 0) return byRef;
    return 0;
  });
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]?.refCanonical === sorted[index - 1]?.refCanonical) return undefined;
  }
  return sorted;
}

interface MappedSlice {
  readonly sorted: SortedSlice;
  readonly capturedAt: string;
  readonly validUntil: string | undefined;
  readonly capturePolicyRef: CanonicalJsonValue;
  readonly source: Record<string, unknown>;
  readonly mappedItems: readonly Record<string, unknown>[];
  readonly mappedOmissions: readonly Record<string, unknown>[];
  readonly mappedRedactions: readonly Record<string, unknown>[];
  readonly aggregateEpistemicState: string | undefined;
  readonly watermarkCanonical: string;
  readonly watermark: CanonicalJsonValue;
}

interface ParsedInputRef {
  readonly inputRole: string;
  readonly ref: CanonicalJsonValue;
  readonly refCanonical: string;
  readonly required: boolean;
  readonly permittedUse: string;
  readonly contentAccessMode: string;
  readonly integrityRequired: boolean;
  readonly epistemicExpectation: string | undefined;
}

/** §19.4 item 9: the total canonical comparator key covering every field. */
function inputRefSortKey(entry: ParsedInputRef): string {
  return canonicalize([
    entry.inputRole,
    entry.refCanonical,
    entry.required,
    entry.permittedUse,
    entry.contentAccessMode,
    entry.integrityRequired,
    entry.epistemicExpectation ?? null,
  ]);
}

function parseInputRefs(value: unknown): readonly ParsedInputRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: ParsedInputRef[] = [];
  for (const element of value) {
    const entry = record(element);
    const inputRole = entry.inputRole;
    const ref = entry.ref;
    const required = entry.required;
    const permittedUse = entry.permittedUse;
    const contentAccessMode = entry.contentAccessMode;
    const integrityRequired = entry.integrityRequired;
    const epistemicExpectation = entry.epistemicExpectation;
    if (
      typeof inputRole !== 'string' ||
      inputRole.length === 0 ||
      ref === null ||
      typeof ref !== 'object' ||
      Array.isArray(ref) ||
      typeof required !== 'boolean' ||
      typeof permittedUse !== 'string' ||
      typeof contentAccessMode !== 'string' ||
      typeof integrityRequired !== 'boolean' ||
      (epistemicExpectation !== undefined &&
        (typeof epistemicExpectation !== 'string' ||
          EPISTEMIC_STATES[epistemicExpectation] !== true))
    ) {
      return undefined;
    }
    const refCanonical = canonicalString(ref);
    if (refCanonical === undefined) return undefined;
    parsed.push({
      inputRole,
      ref: ref as CanonicalJsonValue,
      refCanonical,
      required,
      permittedUse,
      contentAccessMode,
      integrityRequired,
      epistemicExpectation,
    });
  }
  parsed.sort((left, right) => compareCanonical(inputRefSortKey(left), inputRefSortKey(right)));
  return parsed;
}

export function assembleInitialContext(
  input: InitialContextAssemblyInput,
): InitialContextAssemblyOutcome {
  const { request, policy } = input;
  const scopeRef = input.draft.scopeRef;

  // §19.4 item 4: the audience encoding is the PrincipalRef's principalId; its
  // non-emptiness is what the Core `NonEmptyString` requires of the encoding.
  if (
    typeof request.audience.principalId !== 'string' ||
    request.audience.principalId.length === 0 ||
    typeof request.audience.principalKind !== 'string' ||
    request.audience.principalKind.length === 0
  ) {
    return rejected(API_VALUE_INVALID, 'audience must be a non-empty PrincipalRef');
  }
  const asOfMilliseconds = instantMilliseconds(input.asOf);
  if (asOfMilliseconds === undefined) {
    return rejected(API_VALUE_INVALID, 'the assembly instant must be an exact UtcInstant');
  }

  // §19.4 item 1: closed sort + duplicate rejection of the exact slice refs.
  const sorted = sortSlices(input.slices);
  if (sorted === undefined) {
    return rejected(
      EXECUTION_CONTEXT_SOURCE_INVALID,
      'the Source Slice set must be non-empty, exact and duplicate-free',
    );
  }

  // §19.4 item 2: per-slice closure against the request. The owning EP read
  // already proved existence, content hash and current usability; assembly
  // re-proves everything that enters the payload.
  const mappedSlices: MappedSlice[] = [];
  const subjectRefCanonicals = new Set<string>();
  let projectRefCanonical: string | undefined;
  let projectRef: CanonicalJsonValue | undefined;
  let enterpriseProfileSnapshotRef: CanonicalJsonValue | undefined;
  let qmsConfigurationRef: CanonicalJsonValue | undefined;
  const policyRefCanonicals = new Set<string>();
  const watermarkCanonicals = new Set<string>();
  const watermarkValues: CanonicalJsonValue[] = [];
  const sliceValidUntils: (string | undefined)[] = [];

  for (const entry of sorted) {
    const slice = entry.slice;
    const sliceScope = record(slice.scopeRef);
    const sliceAudience = record(slice.audience);
    const source = record(slice.source);
    if (
      slice.sliceId !== entry.refObjectId ||
      sliceScope.enterpriseId !== scopeRef.enterpriseId ||
      sliceScope.projectId !== scopeRef.projectId ||
      Object.keys(sliceScope).length !== 2 ||
      slice.purpose !== request.purpose ||
      sliceAudience.principalId !== request.audience.principalId ||
      sliceAudience.principalKind !== request.audience.principalKind ||
      typeof slice.capturedAt !== 'string' ||
      (slice.validUntil !== undefined && typeof slice.validUntil !== 'string')
    ) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice does not close against the request purpose, audience or scope',
      );
    }
    const capturedAt = slice.capturedAt;
    const validUntil = slice.validUntil;
    sliceValidUntils.push(validUntil);

    // §19.4 item 5: the payload `projectRef` is the EP-published identity of
    // the Project (the slice's `source.projectRef`, spelling included), and
    // every slice must close to that same identity.
    const sliceProjectRef = record(source.projectRef);
    const sliceProjectScope = record(sliceProjectRef.scope);
    if (
      sliceProjectRef.kind !== 'OBJECT' ||
      typeof sliceProjectRef.objectType !== 'string' ||
      sliceProjectRef.objectId !== scopeRef.projectId ||
      sliceProjectScope.enterpriseId !== scopeRef.enterpriseId ||
      sliceProjectScope.projectId !== scopeRef.projectId ||
      Object.keys(sliceProjectScope).length !== 2
    ) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice projectRef does not close to the build Project identity',
      );
    }
    const sliceProjectRefCanonical = canonicalString(source.projectRef);
    if (sliceProjectRefCanonical === undefined) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice projectRef is not canonical',
      );
    }
    if (projectRefCanonical === undefined) {
      projectRefCanonical = sliceProjectRefCanonical;
      projectRef = source.projectRef as CanonicalJsonValue;
    } else if (projectRefCanonical !== sliceProjectRefCanonical) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'the Source Slices do not agree on the Project identity',
      );
    }

    // §19.4 item 5: manifest singletons are common values across all slices.
    const profileRefCanonical = canonicalString(source.enterpriseProfileSnapshotRef);
    const qmsRefCanonical = canonicalString(source.qmsConfigurationRef);
    if (profileRefCanonical === undefined || qmsRefCanonical === undefined) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice manifest reference is missing or not canonical',
      );
    }
    if (enterpriseProfileSnapshotRef === undefined) {
      enterpriseProfileSnapshotRef = source.enterpriseProfileSnapshotRef as CanonicalJsonValue;
    } else if (canonicalString(enterpriseProfileSnapshotRef) !== profileRefCanonical) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'the Source Slices do not agree on the enterprise profile snapshot',
      );
    }
    if (qmsConfigurationRef === undefined) {
      qmsConfigurationRef = source.qmsConfigurationRef as CanonicalJsonValue;
    } else if (canonicalString(qmsConfigurationRef) !== qmsRefCanonical) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'the Source Slices do not agree on the QMS configuration',
      );
    }

    const capturePolicyRef = slice.capturePolicyRef as CanonicalJsonValue;
    const capturePolicyRefCanonical = canonicalString(capturePolicyRef);
    if (capturePolicyRefCanonical === undefined) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice capturePolicyRef is not canonical',
      );
    }
    policyRefCanonicals.add(capturePolicyRefCanonical);

    // §19.4 item 7: fact → ContextItem with the fixed mapping tables.
    const factItems = source.factItems;
    if (!Array.isArray(factItems)) {
      return rejected(EXECUTION_CONTEXT_SOURCE_INVALID, 'a Source Slice factItems is not an array');
    }
    const mappedItems: Record<string, unknown>[] = [];
    const mappedStates: string[] = [];
    for (const [inSliceIndex, factValue] of factItems.entries()) {
      const factItem = record(factValue);
      const factRef = record(factItem.factRef);
      const status = factItem.status;
      const riskLevel = factItem.riskLevel;
      const epistemicState =
        typeof status === 'string' ? EPISTEMIC_STATE_BY_STATUS[status] : undefined;
      const sensitivity =
        typeof riskLevel === 'string' ? SENSITIVITY_BY_RISK_LEVEL[riskLevel] : undefined;
      if (
        factRef.kind !== 'VERSIONED' ||
        factRef.objectType !== 'EnterpriseFact' ||
        typeof factRef.objectId !== 'string' ||
        typeof factRef.versionId !== 'string' ||
        record(factRef.scope).enterpriseId !== scopeRef.enterpriseId ||
        typeof factItem.factType !== 'string' ||
        epistemicState === undefined ||
        sensitivity === undefined ||
        factItem.value === null ||
        typeof factItem.value !== 'object' ||
        Array.isArray(factItem.value)
      ) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'a fact item is missing a member or carries an off-table value',
        );
      }
      const subjectRef = {
        kind: 'VERSIONED',
        objectType: ENTERPRISE_FACT_OBJECT_TYPE,
        objectId: factRef.objectId,
        versionId: factRef.versionId,
        scope: factRef.scope as CanonicalJsonValue,
      };
      const subjectRefCanonical = canonicalString(subjectRef);
      const factItemCanonical = canonicalString(factValue);
      if (subjectRefCanonical === undefined || factItemCanonical === undefined) {
        return rejected(EXECUTION_CONTEXT_SOURCE_INVALID, 'a fact item is not canonical');
      }
      // Two different slices may carry the same Fact only once: a duplicate
      // subject identity would make the payload ambiguous about which item is
      // the Fact, so it fails closed instead of deduplicating silently.
      if (subjectRefCanonicals.has(subjectRefCanonical)) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'two fact items share one subject identity',
        );
      }
      subjectRefCanonicals.add(subjectRefCanonical);
      mappedItems.push({
        contextItemId: deriveContextItemId(
          asOfMilliseconds,
          factItemCanonical,
          entry.refObjectId,
          inSliceIndex,
        ),
        kind: 'FACT',
        subjectRef,
        epistemicState,
        value: factItem.value,
        evidenceRefs: [],
        provenanceRefs: [
          entry.ref as CanonicalJsonValue,
          request.draftSnapshotRef as CanonicalJsonValue,
        ],
        recordedTime: capturedAt,
        permittedUses: [request.purpose],
        sensitivity,
      });
      mappedStates.push(epistemicState);
    }

    // §19.4 item 8: omission/redaction mapping with the closed reasonCode set.
    const omissions = source.omissions;
    const redactions = source.redactions;
    if (!Array.isArray(omissions) || !Array.isArray(redactions)) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice omissions/redactions member is not an array',
      );
    }
    const mappedOmissions: Record<string, unknown>[] = [];
    for (const omissionValue of omissions) {
      const omission = record(omissionValue);
      const kind = omission.kind;
      const reasonCode = omission.reasonCode;
      if (
        typeof kind !== 'string' ||
        SOURCE_KINDS[kind] !== true ||
        typeof reasonCode !== 'string' ||
        SLICE_OMISSION_REASON_CODES[reasonCode] !== true
      ) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'a Source Slice omission carries an off-table kind or reasonCode',
        );
      }
      mappedOmissions.push({
        category: kind,
        reasonCode,
        effectOnTask: SLICE_OMISSION_EFFECT_ON_TASK,
        sourceRef: entry.ref,
      });
    }
    const mappedRedactions: Record<string, unknown>[] = [];
    for (const redactionValue of redactions) {
      const redaction = record(redactionValue);
      const path = redaction.path;
      const reasonCode = redaction.reasonCode;
      if (
        typeof path !== 'string' ||
        path.length === 0 ||
        typeof reasonCode !== 'string' ||
        !REASON_CODE_PATTERN.test(reasonCode)
      ) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'a Source Slice redaction is missing a member or carries an off-table reasonCode',
        );
      }
      mappedRedactions.push({
        fieldPath: path,
        policyRef: capturePolicyRef,
        reasonCode,
      });
    }

    const watermark = source.sourceWatermark as CanonicalJsonValue;
    const watermarkCanonical = canonicalString(watermark);
    if (watermarkCanonical === undefined) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Source Slice watermark is not canonical',
      );
    }
    if (!watermarkCanonicals.has(watermarkCanonical)) {
      watermarkCanonicals.add(watermarkCanonical);
      watermarkValues.push(watermark);
    }

    const aggregateEpistemicState =
      mappedStates.length === 0
        ? undefined
        : mappedStates.reduce((leastTrusted, state) =>
            (EPISTEMIC_TRUST_RANK[state] ?? 0) < (EPISTEMIC_TRUST_RANK[leastTrusted] ?? 0)
              ? state
              : leastTrusted,
          );
    mappedSlices.push({
      sorted: entry,
      capturedAt,
      validUntil,
      capturePolicyRef,
      source,
      mappedItems,
      mappedOmissions,
      mappedRedactions,
      aggregateEpistemicState,
      watermarkCanonical,
      watermark,
    });
  }

  // §19.4 item 3: the #179 profile must be declared and must allow the
  // requested projection type. Both failures are Policy binding failures.
  const profile = validateContextBuilderPolicy({
    policySchemaRefs: policy.policySchemaRefs,
    policyDocument: policy.policyDocument,
  });
  if (
    !profile.valid ||
    !(profile.rules.allowedProjectionTypes as readonly string[]).includes(request.projectionType)
  ) {
    return rejected(
      'INVALID_POLICY_BINDING',
      'the resolved Builder Policy is not the registered context builder profile or does not allow the projection type',
    );
  }

  // §19.4 item 9: the DRAFT inputRefs/targetScope support set.
  const draft = input.draft.draft;
  const targetScope = record(draft.targetScope);
  const targetObjectRefs = targetScope.targetObjectRefs;
  if (!Array.isArray(targetObjectRefs)) {
    return rejected(
      EXECUTION_CONTEXT_SOURCE_INVALID,
      'the DRAFT targetScope is missing its targetObjectRefs',
    );
  }
  if (targetObjectRefs.length > 0) {
    return rejected(
      EXECUTION_CONTEXT_TARGET_INVALID,
      'the initial build does not support targetScope.targetObjectRefs',
    );
  }
  const versionPins = record(draft.versionPins);
  const draftPolicyRef = versionPins.contextBuilderPolicyRef;
  const workOrderSchemaRef = versionPins.workOrderSchemaRef;
  if (
    draftPolicyRef === null ||
    typeof draftPolicyRef !== 'object' ||
    Array.isArray(draftPolicyRef) ||
    workOrderSchemaRef === null ||
    typeof workOrderSchemaRef !== 'object' ||
    Array.isArray(workOrderSchemaRef)
  ) {
    return rejected(
      EXECUTION_CONTEXT_SOURCE_INVALID,
      'the DRAFT version pins do not carry the required references',
    );
  }
  const inputRefs = parseInputRefs(draft.inputRefs);
  if (inputRefs === undefined) {
    return rejected(
      EXECUTION_CONTEXT_SOURCE_INVALID,
      'a DRAFT inputRef is missing a member or carries an illegal value',
    );
  }

  const sliceByRefCanonical = new Map<string, MappedSlice>(
    mappedSlices.map((mapped) => [mapped.sorted.refCanonical, mapped]),
  );
  const draftInputOmissions: Record<string, unknown>[] = [];
  const inputRefObservations: Record<string, unknown>[] = [];
  for (let index = 0; index < inputRefs.length; index += 1) {
    const entry = inputRefs[index];
    const previous = index > 0 ? inputRefs[index - 1] : undefined;
    if (entry === undefined) break;
    if (previous?.inputRole === entry.inputRole && previous.refCanonical === entry.refCanonical) {
      if (inputRefSortKey(previous) !== inputRefSortKey(entry)) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'two DRAFT inputRefs share inputRole and ref but differ in metadata',
        );
      }
      // Fully identical entries collapse to one observation.
      continue;
    }
    const matchedSlice = sliceByRefCanonical.get(entry.refCanonical);
    if (matchedSlice !== undefined) {
      if (entry.permittedUse !== request.purpose) {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'an adopted inputRef permits a use other than the request purpose',
        );
      }
      if (entry.contentAccessMode !== 'REFERENCE_ONLY') {
        return rejected(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'an adopted inputRef requires a content access mode the initial build cannot serve',
        );
      }
      if (entry.epistemicExpectation !== undefined) {
        if (matchedSlice.aggregateEpistemicState === undefined) {
          return rejected(
            EXECUTION_CONTEXT_SOURCE_INVALID,
            'an inputRef expects an epistemic state a fact-free slice cannot prove',
          );
        }
        if (matchedSlice.aggregateEpistemicState !== entry.epistemicExpectation) {
          return rejected(
            EXECUTION_CONTEXT_SOURCE_INVALID,
            'an inputRef epistemic expectation does not match the least-trusted state of its slice',
          );
        }
      }
      inputRefObservations.push({
        inputRole: entry.inputRole,
        ref: entry.ref,
        required: entry.required,
        permittedUse: entry.permittedUse,
        contentAccessMode: entry.contentAccessMode,
        integrityRequired: entry.integrityRequired,
        ...(entry.epistemicExpectation === undefined
          ? {}
          : { epistemicExpectation: entry.epistemicExpectation }),
        resolution: 'ADOPTED',
      });
      continue;
    }
    if (entry.required) {
      return rejected(
        EXECUTION_CONTEXT_INPUT_REQUIRED,
        'a required DRAFT inputRef was not captured in the Source Slices',
      );
    }
    const refRecord = record(entry.ref);
    draftInputOmissions.push({
      category: DRAFT_INPUT_OMISSION_CATEGORY,
      reasonCode:
        refRecord.kind === 'CONTENT_ADDRESSED' &&
        refRecord.objectType === CONTEXT_SOURCE_SLICE_OBJECT_TYPE
          ? DRAFT_INPUT_NOT_CAPTURED
          : DRAFT_INPUT_KIND_NOT_SUPPORTED,
      effectOnTask: DRAFT_INPUT_OMISSION_EFFECT_ON_TASK,
      sourceRef: request.draftSnapshotRef,
    });
    inputRefObservations.push({
      inputRole: entry.inputRole,
      ref: entry.ref,
      required: entry.required,
      permittedUse: entry.permittedUse,
      contentAccessMode: entry.contentAccessMode,
      integrityRequired: entry.integrityRequired,
      ...(entry.epistemicExpectation === undefined
        ? {}
        : { epistemicExpectation: entry.epistemicExpectation }),
      resolution: 'OMITTED',
    });
  }

  // #168 / §11.2.5.4: the effective expiry is the declared request bound when
  // one exists, otherwise the earliest finite bound of the DRAFT creation
  // expiry, the Policy supersession instant and every slice `validUntil`. The
  // handler's binding validation re-proves this composition; a malformed
  // request member is treated as "no bound" here so that validation observes
  // consistent mirrors while it rejects the input.
  const requestExpiresAt =
    typeof request.expiresAt === 'string' && parseInstant(request.expiresAt) !== undefined
      ? request.expiresAt
      : undefined;
  let effectiveExpiresAt: string | undefined;
  if (requestExpiresAt !== undefined) {
    effectiveExpiresAt = requestExpiresAt;
  } else {
    const bounds: string[] = [];
    if (input.draft.expiresAt !== undefined && parseInstant(input.draft.expiresAt) !== undefined) {
      bounds.push(input.draft.expiresAt);
    }
    if (policy.supersededAt !== undefined && parseInstant(policy.supersededAt) !== undefined) {
      bounds.push(policy.supersededAt);
    }
    for (const validUntil of sliceValidUntils) {
      if (validUntil !== undefined && parseInstant(validUntil) !== undefined)
        bounds.push(validUntil);
    }
    for (const bound of bounds) {
      if (effectiveExpiresAt === undefined || compareInstants(bound, effectiveExpiresAt) === -1) {
        effectiveExpiresAt = bound;
      }
    }
  }

  // §19.4 item 5: the deterministic payload field matrix.
  const policyRefValues = new Map<string, CanonicalJsonValue>();
  for (const mapped of mappedSlices) {
    policyRefValues.set(canonicalString(mapped.capturePolicyRef) ?? '', mapped.capturePolicyRef);
  }
  const builderPolicyRefCanonical = canonicalString(request.builderPolicyRef);
  if (builderPolicyRefCanonical === undefined || projectRef === undefined) {
    return rejected(EXECUTION_CONTEXT_SOURCE_INVALID, 'the builderPolicyRef is not canonical');
  }
  policyRefValues.set(builderPolicyRefCanonical, request.builderPolicyRef);
  const policyRefs = [...policyRefValues.entries()]
    .sort(([left], [right]) => compareCanonical(left, right))
    .map(([, value]) => value);

  const schemaRefValues = new Map<string, CanonicalJsonValue>();
  for (const policySchemaRef of policy.policySchemaRefs) {
    const canonical = canonicalString(policySchemaRef);
    if (canonical === undefined) {
      return rejected(
        EXECUTION_CONTEXT_SOURCE_INVALID,
        'a Policy schema reference is not canonical',
      );
    }
    schemaRefValues.set(canonical, policySchemaRef as CanonicalJsonValue);
  }
  const workOrderSchemaRefCanonical = canonicalString(workOrderSchemaRef);
  if (workOrderSchemaRefCanonical === undefined) {
    return rejected(
      EXECUTION_CONTEXT_SOURCE_INVALID,
      'the DRAFT workOrderSchemaRef is not canonical',
    );
  }
  schemaRefValues.set(workOrderSchemaRefCanonical, workOrderSchemaRef as CanonicalJsonValue);
  const schemaRefs = [...schemaRefValues.entries()]
    .sort(([left], [right]) => compareCanonical(left, right))
    .map(([, value]) => value);

  const contextItems = mappedSlices.flatMap((mapped) => mapped.mappedItems);
  const omissions = [
    ...mappedSlices.flatMap((mapped) => mapped.mappedOmissions),
    ...draftInputOmissions,
  ];
  const redactions = mappedSlices.flatMap((mapped) => mapped.mappedRedactions);

  const includedScopes = new Set<string>();
  let anyPurposeForbidden = false;
  const excludedScopes = new Set<string>();
  for (const mapped of mappedSlices) {
    const slicePurpose = mapped.sorted.slice.purpose;
    let forbidden = false;
    for (const omission of mapped.mappedOmissions) {
      excludedScopes.add(omission.category as string);
      if (omission.reasonCode === 'PURPOSE_FORBIDDEN') forbidden = true;
    }
    if (forbidden) {
      anyPurposeForbidden = true;
    } else if (typeof slicePurpose === 'string') {
      includedScopes.add(slicePurpose);
    }
  }
  const sortedStrings = (values: ReadonlySet<string>): string[] =>
    [...values].sort(compareCanonical);

  if (
    enterpriseProfileSnapshotRef === undefined ||
    qmsConfigurationRef === undefined ||
    watermarkValues.length === 0
  ) {
    return rejected(EXECUTION_CONTEXT_SOURCE_INVALID, 'the Source Slice set is not assemblable');
  }

  const payload: CanonicalJsonObject = {
    header: {
      contractId: input.snapshotId,
      contractType: PROJECT_CONTEXT_CONTRACT_TYPE,
      contractVersion: '1.0',
      schemaRef: {
        kind: 'VERSIONED',
        objectType: CONTRACT_SCHEMA_OBJECT_TYPE,
        objectId: input.snapshotId,
        versionId: input.snapshotId,
        scope: { enterpriseId: scopeRef.enterpriseId, projectId: scopeRef.projectId },
      },
      scopeRef: { enterpriseId: scopeRef.enterpriseId, projectId: scopeRef.projectId },
      issuedAt: input.asOf,
      issuedBy: {
        principalKind: input.issuedBy.principalKind,
        principalId: input.issuedBy.principalId,
      },
      correlationId: input.correlationId,
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      dataClassification: 'INTERNAL',
      canonicalizationVersion: '1',
      // The Snapshot content address covers the full stored payload including
      // this member (V3004), so a self-referential digest cannot be written:
      // the zero ContentHash is the module's registered placeholder (the
      // quality-governance producers write the same value).
      payloadHash: {
        algorithm: 'SHA-256',
        digest: '0'.repeat(64),
        canonicalizationVersion: '1',
      },
    },
    contextSnapshotId: input.snapshotId,
    projectRef,
    enterpriseRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.project.enterprise',
      objectId: scopeRef.enterpriseId,
      scope: { enterpriseId: scopeRef.enterpriseId },
    },
    projection: {
      projectionType: request.projectionType,
      purpose: request.purpose,
      audience: request.audience.principalId,
      requestedByWorkOrderRef: input.draft.workOrderRef as CanonicalJsonValue,
      builderPolicyRef: request.builderPolicyRef as CanonicalJsonValue,
    },
    asOf: input.asOf,
    sourceManifest: {
      enterpriseProfileSnapshotRef,
      qmsConfigurationRef,
      policyRefs: policyRefs,
      schemaRefs,
      externalAuthoritySnapshotRefs: [],
    },
    contextItems,
    artifactContext: [],
    workContext: {
      deliveryItemRefs: [],
      taskRef: input.draft.taskRef as CanonicalJsonValue,
      workOrderRef: input.draft.workOrderRef as CanonicalJsonValue,
      informationRequestRefs: [],
      blockers: [],
      relatedCompletionCriteriaRefs: [],
    },
    unresolvedItems: [],
    omissions,
    redactions,
    coverage: {
      requestedScopes: sortedStrings(new Set([request.purpose])),
      includedScopes: sortedStrings(includedScopes),
      excludedScopes: sortedStrings(excludedScopes),
      completeness: anyPurposeForbidden ? 'PARTIAL' : 'COMPLETE_FOR_PURPOSE',
    },
    sourceWatermarks: watermarkValues,
    ...(effectiveExpiresAt === undefined ? {} : { expiresAt: effectiveExpiresAt }),
  } as unknown as CanonicalJsonObject;

  const metadata: CanonicalJsonObject = {
    buildKind: 'INITIAL',
    draftSnapshotRef: request.draftSnapshotRef as CanonicalJsonValue,
    sliceRefs: sorted.map((entry) => entry.ref as CanonicalJsonValue),
    purpose: request.purpose,
    audience: {
      principalId: request.audience.principalId,
      principalKind: request.audience.principalKind,
    },
    builderPolicyRef: request.builderPolicyRef as CanonicalJsonValue,
    policyContentHash: policy.contentHashDigest,
    policyEffectiveFrom: policy.effectiveFrom,
    ...(policy.supersededAt === undefined ? {} : { policySupersededAt: policy.supersededAt }),
    ...(requestExpiresAt === undefined ? {} : { requestExpiresAt }),
    ...(effectiveExpiresAt === undefined ? {} : { effectiveExpiresAt }),
    inputRefObservations,
    scopeRef: { enterpriseId: scopeRef.enterpriseId, projectId: scopeRef.projectId },
  } as unknown as CanonicalJsonObject;

  // §19.4 item 3 / §11.2.5.1-2: the four-point Policy binding. The resolved
  // observation is the only source of the content hash and the validity window;
  // request, projection, metadata and DRAFT pins must all name that same ref.
  const policyBinding = {
    builderPolicyRef: request.builderPolicyRef,
    contentHash: {
      algorithm: 'SHA-256',
      digest: policy.contentHashDigest,
      canonicalizationVersion: '1',
    },
    effectiveFrom: policy.effectiveFrom,
    ...(policy.supersededAt === undefined ? {} : { supersededAt: policy.supersededAt }),
  };
  const binding = validateContextBuilderPolicyBinding({
    initialRequest: { builderPolicyRef: request.builderPolicyRef },
    projectContext: {
      projection: { builderPolicyRef: request.builderPolicyRef },
    },
    contextBuildMetadata: policyBinding,
    workOrder: {
      versionPins: { contextBuilderPolicyRef: draftPolicyRef },
    },
    resolvedPolicy: {
      builderPolicyRef: policy.resolvedRef,
      contentHash: policyBinding.contentHash,
      effectiveFrom: policy.effectiveFrom,
      ...(policy.supersededAt === undefined ? {} : { supersededAt: policy.supersededAt }),
    },
    now: input.asOf,
  } as unknown as Parameters<typeof validateContextBuilderPolicyBinding>[0]);
  if (!binding.valid) {
    const first = binding.errors[0];
    const code = first?.code ?? 'INVALID_POLICY_BINDING';
    return rejected(
      code === 'MISSING_POLICY_REF' || code === 'INVALID_POLICY_REF' ? REFERENCE_INVALID : code,
      'the Context Builder Policy binding does not close',
    );
  }

  return { outcome: 'ASSEMBLED', payload, metadata };
}
