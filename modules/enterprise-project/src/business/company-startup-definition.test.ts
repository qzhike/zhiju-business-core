import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPANY_STARTUP_DEFINITION,
  COMPANY_STARTUP_MANDATORY,
  COMPANY_STARTUP_VOCABULARY,
} from './company-startup-definition.js';

describe('approved first company business definition', () => {
  it('retains the exact confirmed business bytes and all twelve authoritative requirements', () => {
    const delta = readFileSync(
      new URL('../../../../.vibe/decisions/company-startup-rules-v0.1.md', import.meta.url),
      'utf8',
    );
    const section = delta.slice(delta.indexOf('\n## 1. ') + 1, delta.indexOf('\n## 3. ') + 1);
    expect(createHash('sha256').update(section).digest('hex')).toBe(
      COMPANY_STARTUP_DEFINITION.businessConfirmationBytesSha256,
    );
    const rows = delta
      .split('\n')
      .filter((l) => l.startsWith('| `zhiju.requirement.'))
      .map((l) => {
        const cells = l.split('|').map((c) => c.trim());
        return { code: cells[1]?.replaceAll('`', ''), text: cells[2], conditions: cells[3] };
      });
    expect(COMPANY_STARTUP_DEFINITION.requirements).toEqual(rows);
    expect(COMPANY_STARTUP_MANDATORY.mandatoryRequirementCodes).toEqual(
      rows.map((r) => r.code).sort(),
    );
    expect(COMPANY_STARTUP_DEFINITION.templates).toHaveLength(9);
  });
  it('keeps complete approved mandatory and vocabulary sets and excludes the unselected support expansion', () => {
    expect(COMPANY_STARTUP_MANDATORY.protectionEvidenceRequirements).toEqual([
      'operational_processes',
      'organization_responsibilities',
      'product_processes',
      'quality_objectives',
    ]);
    expect(COMPANY_STARTUP_MANDATORY.supportSet).toEqual(['PRODUCT', 'QMS', 'TEXT']);
    expect(COMPANY_STARTUP_MANDATORY.mandatoryChoiceKeys).toHaveLength(2);
    expect(COMPANY_STARTUP_MANDATORY.mandatoryDecisionTypes).toHaveLength(3);
    expect(
      COMPANY_STARTUP_VOCABULARY.filter((v) => v.domain === 'requirement').map((v) => v.code),
    ).toEqual(COMPANY_STARTUP_MANDATORY.mandatoryRequirementCodes);
    expect(new Set(COMPANY_STARTUP_VOCABULARY.map((v) => `${v.domain}:${v.code}`)).size).toBe(
      COMPANY_STARTUP_VOCABULARY.length,
    );
  });
});
