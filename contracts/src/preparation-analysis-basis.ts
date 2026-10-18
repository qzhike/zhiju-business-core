import { isUuidV7 } from '@zhiju/shared-kernel';
import type { Common } from './generated/types/common.js';
import {
  PreparationError,
  assertPreparationClosed,
  assertPreparationHash,
} from './preparation-transport.js';
import type { PreparationPresetPayload } from './preparation-project.js';

export const PREPARATION_ANALYSIS_BASIS_PROFILE = 'ep.preparation_analysis_basis@1.0';
export const TEMPLATE_PREPARATION_PRESET_PROFILE = 'ep.preparation_entry@1.1';
export const TEMPLATE_PREPARATION_SOURCE_PROFILE = 'ep.preparation_source@2.0';
export interface PreparationAnalysisVocabulary {
  factType: string[];
  riskLevel: string[];
  productType: string[];
  markets: string[];
  choiceOptions: Record<string, string[]>;
  decisionOutcomes: Record<string, string[]>;
}
export interface PreparationAnalysisBasisPayload {
  profile: typeof PREPARATION_ANALYSIS_BASIS_PROFILE;
  basisCode: string;
  basisVersion: string;
  purpose: 'preparation.analysis';
  supportedRange: string;
  templateBindings: {
    templateCode: string;
    templateRef: Common.ContentAddressedRef;
    sourceBytesSha256: string;
  }[];
  instructionBindings: { sourceId: string; bytesSha256: string; byteLength: number }[];
  vocabulary: PreparationAnalysisVocabulary;
  requirementBindings: { requirementCode: string; templateCode: string; locator: string }[];
  reportProfile: 'd14.analysis@1';
  reportSchemaSha256: string;
}
export interface PreparationAnalysisBasisSelection {
  basisRef: Common.VersionedRef;
  basisHash: Common.ContentHash;
  publicationRef: Common.ContentAddressedRef;
}
export interface TemplatePreparationPresetPayload extends Omit<
  PreparationPresetPayload,
  'profile' | 'companyRules'
> {
  profile: typeof TEMPLATE_PREPARATION_PRESET_PROFILE;
  analysisBasis: PreparationAnalysisBasisSelection;
}
export type AnyPreparationPresetPayload =
  PreparationPresetPayload | TemplatePreparationPresetPayload;
function invalid(): never {
  throw new PreparationError('PREPARATION_ANALYSIS_BASIS_INVALID');
}
const code = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/.test(v) && v.length <= 256;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function record(v: unknown): asserts v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) invalid();
}
function closed(
  v: unknown,
  keys: string[],
  optional: string[] = [],
): asserts v is Record<string, unknown> {
  record(v);
  assertPreparationClosed(v, keys, optional);
}
function rows(v: unknown, max = 4096): asserts v is unknown[] {
  if (!Array.isArray(v) || !v.length || v.length > max) invalid();
}
function codes(v: unknown) {
  rows(v);
  if (v.some((x) => !code(x)) || new Set(v).size !== v.length) invalid();
}
function platform(
  v: unknown,
  type: string,
  kind: 'VERSIONED' | 'CONTENT_ADDRESSED',
  native = false,
) {
  closed(
    v,
    ['kind', 'objectType', 'objectId', 'scope', kind === 'VERSIONED' ? 'versionId' : 'contentHash'],
    native ? ['immutableVersionId'] : [],
  );
  if (
    v.kind !== kind ||
    v.objectType !== type ||
    typeof v.objectId !== 'string' ||
    !isUuidV7(v.objectId)
  )
    invalid();
  closed(v.scope, []);
  if (kind === 'VERSIONED') {
    if (typeof v.versionId !== 'string' || !isUuidV7(v.versionId)) invalid();
  } else assertPreparationHash(v.contentHash);
  if (native && (typeof v.immutableVersionId !== 'string' || !isUuidV7(v.immutableVersionId)))
    invalid();
}
/** Exact profile matching, never minor-version widening of the legacy preset. */
export function assertPreparationAnalysisBasisSelection(
  v: unknown,
): asserts v is PreparationAnalysisBasisSelection {
  closed(v, ['basisRef', 'basisHash', 'publicationRef']);
  platform(v.basisRef, 'zhiju.project.preparation_analysis_basis', 'VERSIONED');
  assertPreparationHash(v.basisHash);
  platform(
    v.publicationRef,
    'zhiju.project.preparation_analysis_basis_publication',
    'CONTENT_ADDRESSED',
  );
}
/** Structural validation only. The EP owner separately checks publication and actual bytes. */
export function assertPreparationAnalysisBasis(
  v: unknown,
): asserts v is PreparationAnalysisBasisPayload {
  closed(v, [
    'profile',
    'basisCode',
    'basisVersion',
    'purpose',
    'supportedRange',
    'templateBindings',
    'instructionBindings',
    'vocabulary',
    'requirementBindings',
    'reportProfile',
    'reportSchemaSha256',
  ]);
  if (
    v.profile !== PREPARATION_ANALYSIS_BASIS_PROFILE ||
    v.purpose !== 'preparation.analysis' ||
    v.reportProfile !== 'd14.analysis@1' ||
    !code(v.basisCode) ||
    typeof v.basisVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(v.basisVersion) ||
    typeof v.supportedRange !== 'string' ||
    !v.supportedRange.trim() ||
    Buffer.byteLength(v.supportedRange) > 4096 ||
    !sha(v.reportSchemaSha256)
  )
    invalid();
  rows(v.templateBindings);
  const templateCodes = new Set<string>(),
    templateRefs = new Set<string>();
  let previous = '';
  for (const item of v.templateBindings) {
    closed(item, ['templateCode', 'templateRef', 'sourceBytesSha256']);
    if (
      typeof item.templateCode !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.templateCode) ||
      item.templateCode <= previous ||
      templateCodes.has(item.templateCode) ||
      !sha(item.sourceBytesSha256)
    )
      invalid();
    platform(item.templateRef, 'TemplateVersion', 'CONTENT_ADDRESSED', true);
    const r = item.templateRef as Common.ContentAddressedRef;
    if (typeof r.immutableVersionId !== 'string') invalid();
    const key = r.objectId + ':' + r.immutableVersionId;
    if (templateRefs.has(key)) invalid();
    templateRefs.add(key);
    templateCodes.add(item.templateCode);
    previous = item.templateCode;
  }
  rows(v.instructionBindings);
  const instructionIds = new Set();
  for (const item of v.instructionBindings) {
    closed(item, ['sourceId', 'bytesSha256', 'byteLength']);
    if (
      typeof item.sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.sourceId) ||
      instructionIds.has(item.sourceId) ||
      !sha(item.bytesSha256) ||
      !Number.isSafeInteger(item.byteLength) ||
      (item.byteLength as number) < 1
    )
      invalid();
    instructionIds.add(item.sourceId);
  }
  closed(v.vocabulary, [
    'factType',
    'riskLevel',
    'productType',
    'markets',
    'choiceOptions',
    'decisionOutcomes',
  ]);
  for (const k of ['factType', 'riskLevel', 'productType', 'markets']) codes(v.vocabulary[k]);
  for (const k of ['choiceOptions', 'decisionOutcomes']) {
    const mapping = v.vocabulary[k];
    record(mapping);
    if (!Object.keys(mapping).length || Object.keys(mapping).length > 4096) invalid();
    for (const [key, values] of Object.entries(mapping)) {
      if (!code(key)) invalid();
      codes(values);
    }
  }
  rows(v.requirementBindings);
  const locators = new Set();
  for (const item of v.requirementBindings) {
    closed(item, ['requirementCode', 'templateCode', 'locator']);
    if (
      !code(item.requirementCode) ||
      typeof item.templateCode !== 'string' ||
      !templateCodes.has(item.templateCode) ||
      typeof item.locator !== 'string' ||
      !item.locator.trim() ||
      Buffer.byteLength(item.locator) > 1024
    )
      invalid();
    const key = item.templateCode + ':' + item.locator;
    if (locators.has(key)) invalid();
    locators.add(key);
  }
}

/** The template-only preset has its own closed validator; companyRules is never optional on v1.0. */
export function assertTemplatePreparationPreset(
  v: unknown,
): asserts v is TemplatePreparationPresetPayload {
  closed(v, [
    'profile',
    'presetCode',
    'presetVersion',
    'creation',
    'memberPolicyTemplate',
    'intakePolicy',
    'analysisBasis',
    'analysisHandoff',
  ]);
  if (
    v.profile !== TEMPLATE_PREPARATION_PRESET_PROFILE ||
    !code(v.presetCode) ||
    typeof v.presetVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(v.presetVersion)
  )
    invalid();
  closed(v.creation, [
    'mode',
    'status',
    'enterpriseInitialStatus',
    'objective',
    'enterpriseCodePrefix',
    'projectCodePrefix',
  ]);
  if (
    v.creation.mode !== 'PREPARATION' ||
    v.creation.status !== 'PREPARING' ||
    v.creation.enterpriseInitialStatus !== 'ACTIVE' ||
    typeof v.creation.objective !== 'string' ||
    !v.creation.objective.trim() ||
    Buffer.byteLength(v.creation.objective) > 512 ||
    [v.creation.enterpriseCodePrefix, v.creation.projectCodePrefix].some(
      (x) => typeof x !== 'string' || !/^[A-Z0-9]{1,16}$/.test(x),
    )
  )
    invalid();
  for (const [value, type] of [
    [v.memberPolicyTemplate, 'identity.policy'],
    [v.intakePolicy, 'zhiju.integration.customer_zip_policy'],
  ] as const) {
    closed(value, ['ref', 'payloadHash']);
    platform(value.ref, type, 'VERSIONED');
    assertPreparationHash(value.payloadHash);
  }
  assertPreparationAnalysisBasisSelection(v.analysisBasis);
  closed(v.analysisHandoff, ['intent', 'analysisProfileRef', 'expectedReportProfileRef']);
  if (v.analysisHandoff.intent !== 'ANALYZE') invalid();
  for (const value of [
    v.analysisHandoff.analysisProfileRef,
    v.analysisHandoff.expectedReportProfileRef,
  ]) {
    record(value);
    if (typeof value.objectType !== 'string' || !code(value.objectType)) invalid();
    platform(value, value.objectType, 'VERSIONED');
  }
}
