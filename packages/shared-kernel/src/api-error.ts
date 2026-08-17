import type { ObjectRef } from './references.js';

export const apiErrorCategories = [
  'VALIDATION',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'NOT_FOUND',
  'CONFLICT',
  'LIFECYCLE',
  'POLICY',
  'INTEGRITY',
  'DEPENDENCY',
  'EXTERNAL',
  'INTERNAL',
] as const;

export const retryDispositions = [
  'DO_NOT_RETRY',
  'RETRY_SAME_REQUEST',
  'RELOAD_AND_REEVALUATE',
  'NEW_COMMAND_REQUIRED',
  'HUMAN_INTERVENTION_REQUIRED',
] as const;

export type ApiErrorCategory = (typeof apiErrorCategories)[number];
export type RetryDisposition = (typeof retryDispositions)[number];

export interface FieldViolation {
  readonly code: string;
  readonly fieldPath?: string;
  readonly violatedRule: string;
  readonly safeDetail?: string;
  readonly targetRef?: ObjectRef;
}

export interface ApiError {
  readonly code: string;
  readonly category: ApiErrorCategory;
  readonly safeMessage: string;
  readonly fieldViolations: readonly FieldViolation[];
  readonly targetRef?: ObjectRef;
  readonly retryDisposition: RetryDisposition;
  readonly requiredAction?: string;
  readonly correlationId: string;
  readonly diagnosticRef?: string;
}

const reasonCodePattern = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

export function apiError(input: ApiError): Readonly<ApiError> {
  if (!reasonCodePattern.test(input.code)) {
    throw new TypeError('ApiError code must be registered upper snake case');
  }
  if (input.safeMessage.trim().length === 0) {
    throw new TypeError('ApiError safeMessage must not be empty');
  }
  return Object.freeze({ ...input, fieldViolations: Object.freeze([...input.fieldViolations]) });
}
