import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COMPANY_STARTUP_DEFINITION,
  COMPANY_REQUIREMENT_LOCATORS,
  COMPANY_STARTUP_VOCABULARY,
} from '@zhiju/enterprise-project';
import { RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256 } from '@zhiju/contracts';
import { within } from './config.mjs';

export const bytesHash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function source(root, path) {
  const filename = join(root, path);
  if (!(await lstat(filename)).isFile() || !within(await realpath(filename), root))
    throw new Error('ENV_B_COMPANY_SOURCE_INVALID');
  const bytes = await readFile(filename);
  if (!bytes.length || bytes.length > 32 * 1024 * 1024)
    throw new Error('ENV_B_COMPANY_SOURCE_INVALID');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return bytes;
}

/** Exact section locators on the pinned Markdown templates, never semantic extraction. */
export function locateTemplate(bytes, locator) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split(/(?<=\n)/);
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += Buffer.byteLength(line);
  }
  const numbered = lines
    .map((line, index) => {
      const match = /^(#{1,6}\s+)?(?:\*\*)?(\d+(?:\.\d+)*)(?:[.、．]?\s+)(\S.*)/.exec(line);
      return match ? { index, number: match[2], heading: !!match[1] } : null;
    })
    .filter(Boolean);
  function section(number) {
    let candidates = numbered.filter((item) => item.number === number);
    const headings = candidates.filter((item) => item.heading);
    if (headings.length) candidates = headings;
    if (candidates.length !== 1) throw new Error('ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS');
    const start = candidates[0];
    const next = numbered.find(
      (item) =>
        item.index > start.index &&
        (item.heading || item.number.includes('.')) &&
        !item.number.startsWith(number + '.') &&
        item.number.split('.').length <= number.split('.').length,
    );
    return { first: start.index, end: next?.index ?? lines.length };
  }
  const ranges = locator.split('/').flatMap((part) => {
    const [range, ordinal] = part.split('#');
    const numbers = range.split('-');
    const start = section(numbers[0]);
    const end = section(numbers.at(-1));
    if (start.first > end.first) throw new Error('ENV_B_TEMPLATE_LOCATOR_INVALID');
    if (ordinal !== undefined) {
      const table = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line, i }) => i > start.first && i < end.end && /^\s*\|\s*\d+\s*\|/.test(line));
      if (table.length) {
        const matching = table.filter(
          ({ line }) => Number(line.split('|')[1].trim()) === Number(ordinal),
        );
        if (matching.length !== 1) throw new Error('ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS');
        return [{ first: matching[0].i, end: matching[0].i + 1 }];
      }
      const list = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line, i }) => i > start.first && i < end.end && /^\s*\d+[.、]\s+/.test(line));
      const entry = list[Number(ordinal) - 1];
      if (!entry) throw new Error('ENV_B_TEMPLATE_LOCATOR_INVALID');
      return [{ first: entry.i, end: list[Number(ordinal)]?.i ?? end.end }];
    }
    return [{ first: start.first, end: end.end }];
  });
  // Composite locators bind the containing byte span; the original locator remains explicit.
  const first = Math.min(...ranges.map((r) => starts[r.first]));
  const end = Math.max(...ranges.map((r) => starts[r.end] ?? bytes.length));
  const selected = bytes.subarray(first, end);
  if (
    !selected.length ||
    bytes.indexOf(selected) !== first ||
    bytes.lastIndexOf(selected) !== first
  )
    throw new Error('ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS');
  return { locator, offset: first, byteLength: end - first };
}

/** Reads only the pinned company material set, excluding customer/history directories. */
export async function readCompanyMaterials(projectRoot) {
  const root = await realpath(projectRoot);
  const templates = [];
  for (const definition of COMPANY_STARTUP_DEFINITION.templates) {
    const bytes = await source(root, definition.path);
    if (bytesHash(bytes) !== definition.bytesSha256)
      throw new Error('ENV_B_TEMPLATE_VERSION_CHANGED');
    const names = [
      ...new Set(
        Object.values(COMPANY_REQUIREMENT_LOCATORS)
          .flat()
          .filter(([code]) => code === definition.code)
          .map(([, locator]) => locator),
      ),
    ];
    const locators = names.sort().map((locator) => locateTemplate(bytes, locator));
    templates.push({ ...definition, bytes, locators });
  }
  const instructions = await source(root, 'AGENTS.md');
  const schema = await source(root, 'contracts/runner-analysis-report-v0.2.schema.json');
  if (bytesHash(schema) !== RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256)
    throw new Error('ENV_B_RUNNER_SCHEMA_CHANGED');
  const values = (domain) =>
    COMPANY_STARTUP_VOCABULARY.filter((entry) => entry.domain === domain)
      .map((entry) => entry.code)
      .sort();
  return {
    templates,
    instructions,
    instructionHash: bytesHash(instructions),
    vocabulary: {
      factType: values('fact_type'),
      riskLevel: values('risk_level'),
      productType: values('product_type'),
      markets: values('market'),
      choiceOptions: {
        'zhiju.choice.qms.document_base': ['zhiju.option.customer_controlled_base'],
        'zhiju.choice.qms.protection_strategy': ['zhiju.option.preserve_customer_arrangements'],
      },
      decisionOutcomes: {
        'zhiju.decision.qms.supported_scope': [
          'zhiju.outcome.outside_supported_scope',
          'zhiju.outcome.undetermined',
          'zhiju.outcome.within_supported_scope',
        ],
        'zhiju.decision.qms.protection_evidence': [
          'zhiju.outcome.conflicting',
          'zhiju.outcome.insufficient',
          'zhiju.outcome.sufficient',
        ],
        'zhiju.decision.qms.startup_conflicts': [
          'zhiju.outcome.file_only_conflicts',
          'zhiju.outcome.no_startup_conflict',
          'zhiju.outcome.startup_conflict',
        ],
      },
    },
    requirementBindings: Object.entries(COMPANY_REQUIREMENT_LOCATORS)
      .flatMap(([requirementCode, locations]) =>
        locations.map(([templateCode, locator]) => ({ requirementCode, templateCode, locator })),
      )
      .sort((a, b) =>
        `${a.requirementCode}:${a.templateCode}:${a.locator}`.localeCompare(
          `${b.requirementCode}:${b.templateCode}:${b.locator}`,
        ),
      ),
  };
}
