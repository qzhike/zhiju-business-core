/**
 * The fixed MVP01 input policy. `mvp.zip-input@1` is written onto every batch
 * at creation, so a later policy cannot retroactively change an old receipt or
 * manifest. Limits are the already-approved D14 cumulative budgets; B1 does not
 * raise them.
 */

export const MVP_INPUT_POLICY_VERSION = 'mvp.zip-input@1';
export const MVP_EXTRACTOR_VERSION = 'mvp.input-extractor@1';

export const MVP_INPUT_LIMITS = Object.freeze({
  zipBytes: 104857600,
  entries: 1000,
  totalExpandedBytes: 524288000,
  entryBytes: 52428800,
  expansionRatio: 100,
  pathBytes: 240,
  pathDepth: 16,
  wallClockMs: 120000,
  memoryBytes: 536870912,
});

export const MVP_SUPPORTED_FORMATS = Object.freeze(['DOCX', 'MARKDOWN', 'XLSX'] as const);

export const MVP_REJECT_RULES = Object.freeze([
  'MULTI_DISK',
  'ENCRYPTED',
  'UNSAFE_PATH',
  'LINK_OR_DEVICE',
  'PATH_COLLISION',
  'CRC_MISMATCH',
  'ZIP_BOMB',
] as const);

export const MEDIA_TYPES = Object.freeze({
  markdown: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
});

export interface MvpInputPolicy {
  readonly policyVersion: typeof MVP_INPUT_POLICY_VERSION;
  readonly extractorVersion: typeof MVP_EXTRACTOR_VERSION;
  readonly limits: typeof MVP_INPUT_LIMITS;
  readonly allowedFormats: typeof MVP_SUPPORTED_FORMATS;
  readonly rejectRules: typeof MVP_REJECT_RULES;
  readonly retainOriginalBytes: true;
  readonly noteIsUntrustedMaterial: true;
}

export const MVP_INPUT_POLICY: MvpInputPolicy = Object.freeze({
  policyVersion: MVP_INPUT_POLICY_VERSION,
  extractorVersion: MVP_EXTRACTOR_VERSION,
  limits: MVP_INPUT_LIMITS,
  allowedFormats: MVP_SUPPORTED_FORMATS,
  rejectRules: MVP_REJECT_RULES,
  retainOriginalBytes: true,
  noteIsUntrustedMaterial: true,
});
