import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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

  it('requires manual approval for fingerprint changes', () => {
    const baseline: OperationCompatibilityRecord = {
      type: 'release.authorize_release',
      version: '1.0',
      kind: 'COMMAND',
      owner: 'release-publication',
      schemaStatus: 'FULL',
      payloadSchemaRef: 'https://schemas.zhiju.local/modules/release-publication/1.0#/$defs/x',
      resultSchemaRef: null,
      manualReviewFingerprint: null,
    };
    const current = {
      ...baseline,
      manualReviewFingerprint: 'authz:purpose=release.authorize#v2',
    };
    const raw = compareOperationRecords(baseline, current);
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
    const baseline: OperationCompatibilityRecord = {
      type: 'identity.register_principal',
      version: '1.0',
      kind: 'COMMAND',
      owner: 'identity-policy',
      schemaStatus: 'FULL',
      payloadSchemaRef: 'ref-a',
      resultSchemaRef: null,
      manualReviewFingerprint: null,
    };
    const current = { ...baseline, owner: 'enterprise-project' };
    const findings = applyApprovals(compareOperationRecords(baseline, current), [
      {
        kind: 'operation-metadata-changed',
        target: 'operation=identity.register_principal@1.0',
        status: 'APPROVED',
      },
    ]);
    expect(failingFindings(findings).some((item) => item.severity === 'BREAKING')).toBe(true);
  });
});
