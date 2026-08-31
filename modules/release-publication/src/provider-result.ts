// IM-05 WI-07 (issue #127 / #23): provider-result minimization boundary.
// Provider payloads are untrusted external data. Only a registered Adapter
// mapping can create retained provider facts; all other values are normalized
// at the Formal Receipt, Event, Error, and logging boundary.

import type { CanonicalJson } from '@zhiju/contracts';
import type { CanonicalJsonObject, CanonicalJsonValue } from '@zhiju/shared-kernel';

const REDACTED_VALUE = Object.freeze({
  redacted: true,
  reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED',
} satisfies CanonicalJson);

const REGISTERED_PROVIDER_RESULT_MAPPINGS = {
  'feishu.channel': {
    status: {
      ACCEPTED: 'ACCEPTED',
      DELIVERED: 'DELIVERED',
      FAILED: 'FAILED',
      PENDING: 'PENDING',
      QUEUED: 'QUEUED',
      REJECTED: 'REJECTED',
      UNKNOWN: 'UNKNOWN',
      accepted: 'ACCEPTED',
      delivered: 'DELIVERED',
      failed: 'FAILED',
      pending: 'PENDING',
      queued: 'QUEUED',
      rejected: 'REJECTED',
      unknown: 'UNKNOWN',
    },
    providerStatus: {
      ACCEPTED: 'ACCEPTED',
      DELIVERED: 'DELIVERED',
      FAILED: 'FAILED',
      PENDING: 'PENDING',
      QUEUED: 'QUEUED',
      REJECTED: 'REJECTED',
      UNKNOWN: 'UNKNOWN',
      accepted: 'ACCEPTED',
      delivered: 'DELIVERED',
      failed: 'FAILED',
      pending: 'PENDING',
      queued: 'QUEUED',
      rejected: 'REJECTED',
      unknown: 'UNKNOWN',
    },
    outcome: {
      FAILED: 'FAILED',
      SUCCEEDED: 'SUCCEEDED',
      UNKNOWN: 'UNKNOWN',
      failed: 'FAILED',
      success: 'SUCCEEDED',
      succeeded: 'SUCCEEDED',
      timeout: 'UNKNOWN',
      unknown: 'UNKNOWN',
    },
    errorCode: {
      ADAPTER_ERROR: 'ADAPTER_ERROR',
      INVALID_REQUEST: 'INVALID_REQUEST',
      PERMANENT_FAILURE: 'PERMANENT_FAILURE',
      RATE_LIMITED: 'RATE_LIMITED',
      TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',
      UNKNOWN: 'UNKNOWN',
      adapter_error: 'ADAPTER_ERROR',
      invalid_request: 'INVALID_REQUEST',
      permanent_failure: 'PERMANENT_FAILURE',
      rate_limited: 'RATE_LIMITED',
      temporary_failure: 'TEMPORARY_FAILURE',
      unknown: 'UNKNOWN',
    },
    reasonCode: {
      DELIVERY_REJECTED: 'DELIVERY_REJECTED',
      PROVIDER_ERROR: 'PROVIDER_ERROR',
      TIMEOUT: 'TIMEOUT',
      UNKNOWN: 'UNKNOWN',
      delivery_rejected: 'DELIVERY_REJECTED',
      provider_error: 'PROVIDER_ERROR',
      timeout: 'TIMEOUT',
      unknown: 'UNKNOWN',
    },
  },
} as const;

type RegisteredProviderResultAdapterCode = keyof typeof REGISTERED_PROVIDER_RESULT_MAPPINGS;
type ProviderResultMapping =
  (typeof REGISTERED_PROVIDER_RESULT_MAPPINGS)[RegisteredProviderResultAdapterCode];

const REGISTERED_ADAPTER_CODES = new Set<string>(Object.keys(REGISTERED_PROVIDER_RESULT_MAPPINGS));
const STATUS_VALUES = new Set(
  Object.values(REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].status),
);
const PROVIDER_STATUS_VALUES = new Set(
  Object.values(REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].providerStatus),
);
const OUTCOME_VALUES = new Set(
  Object.values(REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].outcome),
);
const ERROR_CODE_VALUES = new Set(
  Object.values(REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].errorCode),
);
const REASON_CODE_VALUES = new Set(
  Object.values(REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].reasonCode),
);

const SAFE_PROVIDER_RESULT_KEYS = new Set([
  'attemptNumber',
  'errorCode',
  'outcome',
  'providerCode',
  'providerStatus',
  'reasonCode',
  'retryable',
  'status',
]);

const PROVIDER_RESULT_IDENTIFIER_KEYS = new Set([
  'deliveryId',
  'messageId',
  'providerAttemptId',
  'providerMessageId',
  'providerRequestId',
  'requestId',
  'traceId',
]);

const ADAPTER_RESULT_KEYS = new Set([
  'adapterCode',
  'attemptNumber',
  'deliveryId',
  'errorCode',
  'messageId',
  'outcome',
  'providerAttemptId',
  'providerMessageId',
  'providerRequestId',
  'providerStatus',
  'reasonCode',
  'requestId',
  'retryable',
  'status',
  'traceId',
]);

/** Result created by a registered Adapter mapping, not by a public Command. */
export type AdapterProviderResult = Readonly<Record<string, CanonicalJsonValue>>;

export interface ProviderResultAdapterExtraction {
  readonly adapterCode: string;
  readonly attemptNumber?: number;
  readonly deliveryId?: string;
  readonly errorCode?: string;
  readonly messageId?: string;
  readonly outcome?: string;
  readonly providerAttemptId?: string;
  readonly providerMessageId?: string;
  readonly providerRequestId?: string;
  readonly providerStatus?: string;
  readonly reasonCode?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly status?: string;
  readonly traceId?: string;
}

export type ProviderResultMappingErrorCode =
  | 'PROVIDER_RESULT_ADAPTER_UNREGISTERED'
  | 'PROVIDER_RESULT_FIELD_UNMAPPED'
  | 'PROVIDER_RESULT_IDENTIFIER_INVALID'
  | 'PROVIDER_RESULT_EXTRA_FIELD';

export interface ProviderResultMappingError {
  readonly code: ProviderResultMappingErrorCode;
  readonly fieldPath: string;
}

export type ProviderResultMappingResult =
  | { readonly ok: true; readonly value: AdapterProviderResult }
  | { readonly ok: false; readonly error: ProviderResultMappingError };

export interface SanitizedProviderResult {
  readonly value: CanonicalJson;
  readonly redactedPaths: readonly string[];
}

function failure(
  code: ProviderResultMappingErrorCode,
  fieldPath: string,
): ProviderResultMappingResult {
  return { ok: false, error: { code, fieldPath } };
}

function mapClosedValue(
  value: string,
  mapping: Readonly<Record<string, string>>,
  allowedValues: ReadonlySet<string>,
): string | undefined {
  if (allowedValues.has(value)) return value;
  return mapping[value];
}

function hasValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function mappedField(
  input: ProviderResultAdapterExtraction,
  key: keyof ProviderResultAdapterExtraction,
  mapping: Readonly<Record<string, string>>,
  allowedValues: ReadonlySet<string>,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  return mapClosedValue(value, mapping, allowedValues);
}

/**
 * Maps an Adapter-owned extraction into a closed, persistence-safe result.
 * Raw identifiers are validated at the Adapter boundary and then omitted.
 */
export function createProviderResultFromAdapter(input: unknown): ProviderResultMappingResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return failure('PROVIDER_RESULT_EXTRA_FIELD', '/providerResult');
  }
  for (const key of Object.keys(input)) {
    if (!ADAPTER_RESULT_KEYS.has(key)) {
      return failure('PROVIDER_RESULT_EXTRA_FIELD', '/providerResult');
    }
  }

  const extraction = input as ProviderResultAdapterExtraction;
  const mapping = REGISTERED_PROVIDER_RESULT_MAPPINGS[
    extraction.adapterCode as RegisteredProviderResultAdapterCode
  ] as ProviderResultMapping | undefined;
  if (mapping === undefined) {
    return failure('PROVIDER_RESULT_ADAPTER_UNREGISTERED', '/adapterCode');
  }

  const result: Record<string, CanonicalJsonValue> = {
    providerCode: extraction.adapterCode,
  };
  const mappedFields: readonly [
    keyof ProviderResultAdapterExtraction,
    Readonly<Record<string, string>>,
    ReadonlySet<string>,
  ][] = [
    ['status', mapping.status, STATUS_VALUES],
    ['providerStatus', mapping.providerStatus, PROVIDER_STATUS_VALUES],
    ['outcome', mapping.outcome, OUTCOME_VALUES],
    ['errorCode', mapping.errorCode, ERROR_CODE_VALUES],
    ['reasonCode', mapping.reasonCode, REASON_CODE_VALUES],
  ];
  for (const [key, valueMapping, allowedValues] of mappedFields) {
    const rawValue = extraction[key];
    if (rawValue === undefined) continue;
    const value = mappedField(extraction, key, valueMapping, allowedValues);
    if (value === undefined) {
      return failure('PROVIDER_RESULT_FIELD_UNMAPPED', `/${key}`);
    }
    result[key] = value;
  }

  if (extraction.attemptNumber !== undefined) {
    if (!Number.isInteger(extraction.attemptNumber) || extraction.attemptNumber <= 0) {
      return failure('PROVIDER_RESULT_FIELD_UNMAPPED', '/attemptNumber');
    }
    result.attemptNumber = extraction.attemptNumber;
  }
  if (extraction.retryable !== undefined) {
    if (typeof extraction.retryable !== 'boolean') {
      return failure('PROVIDER_RESULT_FIELD_UNMAPPED', '/retryable');
    }
    result.retryable = extraction.retryable;
  }

  for (const key of PROVIDER_RESULT_IDENTIFIER_KEYS) {
    const value = extraction[key as keyof ProviderResultAdapterExtraction];
    if (value === undefined) continue;
    if (!hasValidIdentifier(value)) {
      return failure('PROVIDER_RESULT_IDENTIFIER_INVALID', `/${key}`);
    }
  }

  return { ok: true, value: Object.freeze(result) };
}

const UNKNOWN_REDACTION_PATH = '/providerResult/unknown';

function redacted(path: string, redactedPaths: string[]): CanonicalJson {
  if (!redactedPaths.includes(path)) redactedPaths.push(path);
  return REDACTED_VALUE;
}

function isRedactedValue(value: CanonicalJsonValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const objectValue = value as CanonicalJsonObject;
  return (
    Object.keys(objectValue).length === 2 &&
    objectValue.redacted === true &&
    objectValue.reasonCode === 'PROVIDER_RESULT_FIELD_REDACTED'
  );
}

function normalizedSafeString(key: string, value: string): string | undefined {
  if (key === 'providerCode') {
    return REGISTERED_ADAPTER_CODES.has(value) ? value : undefined;
  }
  if (key === 'status') {
    return mapClosedValue(
      value,
      REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].status,
      STATUS_VALUES,
    );
  }
  if (key === 'providerStatus') {
    return mapClosedValue(
      value,
      REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].providerStatus,
      PROVIDER_STATUS_VALUES,
    );
  }
  if (key === 'outcome') {
    return mapClosedValue(
      value,
      REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].outcome,
      OUTCOME_VALUES,
    );
  }
  if (key === 'errorCode') {
    return mapClosedValue(
      value,
      REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].errorCode,
      ERROR_CODE_VALUES,
    );
  }
  if (key === 'reasonCode') {
    return mapClosedValue(
      value,
      REGISTERED_PROVIDER_RESULT_MAPPINGS['feishu.channel'].reasonCode,
      REASON_CODE_VALUES,
    );
  }
  return undefined;
}

function isSafeProviderScalar(key: string, value: CanonicalJsonValue): boolean {
  if (key === 'attemptNumber') {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }
  if (key === 'retryable') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  return normalizedSafeString(key, value) !== undefined;
}

function sanitize(
  value: CanonicalJsonValue,
  path: string,
  redactedPaths: string[],
  key?: string,
): CanonicalJson {
  if (isRedactedValue(value)) return REDACTED_VALUE;
  if (key !== undefined && value !== null && typeof value === 'object') {
    return redacted(path, redactedPaths);
  }
  if (typeof value === 'string') {
    if (key === undefined || !isSafeProviderScalar(key, value)) {
      return redacted(path, redactedPaths);
    }
    return normalizedSafeString(key, value) ?? redacted(path, redactedPaths);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (key === undefined || !isSafeProviderScalar(key, value)) {
      return redacted(path, redactedPaths);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Array.from(value, (item: CanonicalJsonValue, index) =>
      sanitize(item, `${path}/${String(index)}`, redactedPaths),
    );
  }
  const result: Record<string, CanonicalJson> = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (!SAFE_PROVIDER_RESULT_KEYS.has(childKey)) {
      if (!redactedPaths.includes(UNKNOWN_REDACTION_PATH)) {
        redactedPaths.push(UNKNOWN_REDACTION_PATH);
      }
      continue;
    }
    const childPath = `${path}/${childKey}`;
    result[childKey] = sanitize(child, childPath, redactedPaths, childKey);
  }
  return result;
}

/**
 * Recursively removes PII and secret-like values without retaining the input
 * value in an error or diagnostic object. Only closed scalars can survive an
 * untrusted public Command input; raw identifiers and caller-declared hashes
 * are omitted, including after JSON serialization.
 */
export function sanitizeProviderResult(value: CanonicalJson): SanitizedProviderResult {
  const redactedPaths: string[] = [];
  const rootPath = '/providerResult';
  if (isRedactedValue(value)) {
    return { value: REDACTED_VALUE, redactedPaths };
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return {
      value: sanitize(value, rootPath, redactedPaths),
      redactedPaths,
    };
  }
  return { value: redacted(rootPath, redactedPaths), redactedPaths };
}

export function providerResultContainsSensitiveData(value: CanonicalJson): boolean {
  return sanitizeProviderResult(value).redactedPaths.length > 0;
}
