import report from './runner-analysis/runner-analysis-report-v0.2.schema.json' with { type: 'json' };
import validation from './runner-analysis/runner-analysis-validation-v0.2.schema.json' with { type: 'json' };
import type { JsonSchema } from './schema-types.js';

/** Exact upstream wire schemas. Semantic evidence verification remains independent. */
export const runnerAnalysisReportSchema = report as unknown as JsonSchema;
export const runnerAnalysisValidationSchema = validation as unknown as JsonSchema;
export const RUNNER_ANALYSIS_REPORT_SCHEMA_ID = report.$id;
export const RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256 =
  '8b930eddd7df7caa0cc7a32c0316c95238f605b53dfac9be80bbb47bf43d944e';
