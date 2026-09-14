import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computeManualReviewFingerprint,
  loadCurrentOperationRecords,
  loadManualReviewMetadata,
} from './load-contract-schemas.ts';
import {
  applyApprovals,
  compareOperationRecords,
  compareSchemaDocuments,
  failingFindings,
  sortKeysDeep,
  stableStringify,
  type CompatibilityFinding,
  type OperationCompatibilityRecord,
} from './schema-compatibility.ts';

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/contracts/compatibility/v1.0/breaking-schema',
);

function loadCase(name: string): { baseline: unknown; current: unknown } {
  return JSON.parse(readFileSync(join(fixturesRoot, name), 'utf8')) as {
    baseline: unknown;
    current: unknown;
  };
}

function keywords(findings: readonly CompatibilityFinding[]): string[] {
  return findings.map((finding) => finding.keyword).sort();
}

describe('schema compatibility structural diff', () => {
  it('sorts object keys stably for baseline serialization', () => {
    const sorted = sortKeysDeep({ z: 1, a: { c: 2, b: 3 } });
    expect(stableStringify(sorted)).toBe(
      '{\n  "a": {\n    "b": 3,\n    "c": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it('flags required field additions as BREAKING', () => {
    const fixture = loadCase('required-field-added.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=required-field-added'),
    );
    expect(keywords(findings)).toContain('required-added');
  });

  it('flags property removals as BREAKING', () => {
    const fixture = loadCase('field-removed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=field-removed'),
    );
    expect(keywords(findings)).toContain('property-removed');
  });

  it('flags closed enum changes as BREAKING', () => {
    const fixture = loadCase('closed-enum-changed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=closed-enum-changed'),
    );
    expect(keywords(findings)).toContain('enum-changed');
  });

  it('flags type narrowing as BREAKING', () => {
    const fixture = loadCase('type-narrowed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=type-narrowed'),
    );
    expect(keywords(findings)).toContain('type-narrowed');
  });

  it('flags additionalProperties closed flips as BREAKING', () => {
    const fixture = loadCase('additional-properties-closed.json');
    const findings = failingFindings(
      compareSchemaDocuments(
        fixture.baseline,
        fixture.current,
        'fixture=additional-properties-closed',
      ),
    );
    expect(keywords(findings)).toContain('additionalProperties-closed');
  });

  it('flags $ref changes as BREAKING', () => {
    const fixture = loadCase('ref-strength-narrowed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=ref-strength-narrowed'),
    );
    expect(keywords(findings)).toContain('ref-changed');
  });

  it('allows optional additive Minor without failing findings', () => {
    const fixture = loadCase('optional-field-added-compatible.json');
    const findings = compareSchemaDocuments(
      fixture.baseline,
      fixture.current,
      'fixture=optional-field-added-compatible',
    );
    expect(failingFindings(findings)).toEqual([]);
    expect(keywords(findings)).toContain('optional-property-added');
  });

  it('flags uniqueItems tightening as BREAKING', () => {
    const fixture = loadCase('unique-items-added.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=unique-items-added'),
    );
    expect(keywords(findings)).toContain('uniqueItems-added');
  });

  it('flags format changes as BREAKING', () => {
    const fixture = loadCase('format-changed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=format-changed'),
    );
    expect(keywords(findings)).toContain('format-changed');
  });

  it('flags propertyNames additions as BREAKING', () => {
    const fixture = loadCase('property-names-added.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=property-names-added'),
    );
    expect(keywords(findings)).toContain('propertyNames-added');
  });

  it('flags not-constraint additions as BREAKING', () => {
    const fixture = loadCase('not-constraint-added.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=not-constraint-added'),
    );
    expect(keywords(findings)).toContain('not-added');
  });

  it('fails closed on unmodeled assertion keywords', () => {
    const fixture = loadCase('unknown-keyword-changed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=unknown-keyword-changed'),
    );
    expect(keywords(findings)).toContain('unknown-keyword-changed');
  });

  it('flags multipleOf divisor changes as BREAKING even when the number decreases', () => {
    const fixture = loadCase('multiple-of-changed.json');
    const findings = failingFindings(
      compareSchemaDocuments(fixture.baseline, fixture.current, 'fixture=multiple-of-changed'),
    );
    expect(keywords(findings)).toContain('multipleOf-changed');
  });

  it('flags patternProperties removal as BREAKING when acceptance impact is context-sensitive', () => {
    const fixture = loadCase('pattern-properties-removed.json');
    const findings = failingFindings(
      compareSchemaDocuments(
        fixture.baseline,
        fixture.current,
        'fixture=pattern-properties-removed',
      ),
    );
    expect(keywords(findings)).toContain('patternProperties-changed');
  });

  it('loads non-null manualReviewFingerprint values from versioned metadata for all 213 operations', () => {
    const metadata = loadManualReviewMetadata();
    const records = loadCurrentOperationRecords();
    expect(metadata.size).toBe(213);
    expect(records).toHaveLength(213);
    expect(
      records.every(
        (record) =>
          typeof record.manualReviewFingerprint === 'string' &&
          /^[a-f0-9]{64}$/.test(record.manualReviewFingerprint),
      ),
    ).toBe(true);
  });

  it('requires manual approval when production metadata fingerprint changes', () => {
    const records = loadCurrentOperationRecords();
    const baseline = records.find((record) => record.type === 'release.authorize_release');
    expect(baseline).toBeDefined();
    if (baseline === undefined) return;

    const metadata = loadManualReviewMetadata().get('release.authorize_release@1.0');
    expect(metadata).toBeDefined();
    if (metadata === undefined) return;

    const mutatedFingerprint = computeManualReviewFingerprint({
      authorizationPurpose: `${metadata.authorizationPurpose}.mutated`,
      dataClassification: metadata.dataClassification,
      semanticDeclaration: metadata.semanticDeclaration,
    });
    expect(mutatedFingerprint).not.toBe(baseline.manualReviewFingerprint);

    const raw = compareOperationRecords(baseline, {
      ...baseline,
      manualReviewFingerprint: mutatedFingerprint,
    });
    expect(failingFindings(raw).some((item) => item.severity === 'MANUAL_REVIEW_REQUIRED')).toBe(
      true,
    );

    const stillFailing = applyApprovals(raw, []);
    expect(failingFindings(stillFailing)).toHaveLength(1);

    const approved = applyApprovals(raw, [
      {
        kind: 'AUTHORIZATION_METADATA_CHANGE',
        target: 'operation=release.authorize_release@1.0',
        status: 'APPROVED',
      },
    ]);
    expect(failingFindings(approved)).toEqual([]);
  });

  it('never lets approvals cancel structural BREAKING findings', () => {
    const records = loadCurrentOperationRecords();
    const baseline = records.find((record) => record.type === 'identity.register_principal');
    expect(baseline).toBeDefined();
    if (baseline === undefined) return;

    const findings = applyApprovals(
      compareOperationRecords(baseline, { ...baseline, owner: 'enterprise-project' }),
      [
        {
          kind: 'operation-metadata-changed',
          target: 'operation=identity.register_principal@1.0',
          status: 'APPROVED',
        },
      ],
    );
    expect(failingFindings(findings).some((item) => item.severity === 'BREAKING')).toBe(true);
  });
});
