// #270: cross-module proof of the closed Markdown canonicalization pipeline.
// Artifact parses/canonicalizes/validates identities; IntegrationGateway renders
// deterministically; this suite proves parse(render(tree), map) = tree over the
// checked-in procurement snapshots and the focused standalone fixtures.
//
// All document/intent/output identifiers below are controlled test-only values:
// they do not assert a submitted intent, a prepared source mapping or any
// Human-confirmed constraint.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ArtifactBusinessError,
  buildMarkdownIdentityMap,
  parseMarkdownDocument,
  verifyMarkdownRoundTrip,
  type MarkdownParseResult,
} from '@zhiju/artifact';
import { markdownDocumentSchemaReference, type Artifact, type Common } from '@zhiju/contracts';
import { renderMarkdownDocument } from '@zhiju/integration-gateway';

const TEST_PROVENANCE = 'ISSUE_270_CONTROLLED_TEST_ONLY';
const ENTERPRISE_ID = '0199b600-0000-7000-8000-00000000e270';
const DOCUMENT_ID = '0199b600-0000-7000-8000-00000000d270';
const ARTIFACT_ID = '0199b600-0000-7000-8000-00000000a270';

function templateBytes(name: string): Uint8Array {
  return readFileSync(
    new URL(`../../.vibe/prototypes/workspace-mvp/templates/${name}`, import.meta.url),
  );
}

function fixtureBytes(name: string): Uint8Array {
  return readFileSync(new URL(`../fixtures/markdown/${name}`, import.meta.url));
}

function sha256(bytes: Uint8Array): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    canonicalizationVersion: '1',
  };
}

function profileRef(): Common.VersionedRef {
  return markdownDocumentSchemaReference(ENTERPRISE_ID);
}

function artifactRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'artifact.artifact',
    objectId: ARTIFACT_ID,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: '0199b600-0000-7000-8000-00000000c270' },
  };
}

function metadata(fileKind: Artifact.MarkdownDocumentMetadata['fileKind'], fileCode: string) {
  return { fileKind, fileCode };
}

function unitTexts(units: readonly Artifact.MarkdownDocumentUnit[]): string[] {
  return units
    .map((unit) => (unit as { text?: string }).text)
    .filter((text): text is string => text !== undefined);
}

function parse(
  bytes: Uint8Array,
  fileCode: string,
  kind: Artifact.MarkdownDocumentMetadata['fileKind'],
) {
  return parseMarkdownDocument({
    bytes,
    enterpriseId: ENTERPRISE_ID,
    documentId: DOCUMENT_ID,
    title: fileCode,
    documentMetadata: metadata(kind, fileCode),
    identityDerivation: {
      originalIntentRef: `${TEST_PROVENANCE}:intent`,
      candidateOutputId: 'cand-1',
    },
  });
}

function identityMapOf(parsed: MarkdownParseResult, raw: Uint8Array): Artifact.MarkdownIdentityMap {
  return buildMarkdownIdentityMap({
    parse: { ...parsed, rawBytesSha256: sha256(raw) },
    artifactRef: artifactRef(),
    profileRef: profileRef(),
  });
}

function roundTrip(parsed: MarkdownParseResult, raw: Uint8Array): void {
  const map = identityMapOf(parsed, raw);
  const rendered = renderMarkdownDocument(parsed.content);
  expect(rendered.bytes.byteLength).toBeGreaterThan(0);
  verifyMarkdownRoundTrip({
    content: parsed.content,
    enterpriseId: ENTERPRISE_ID,
    identityDerivation: parsed.identityDerivation,
    identityMap: map,
    identityBinding: { artifactRef: artifactRef() },
    renderedBytes: rendered.bytes,
  });
}

describe('checked-in procurement snapshots', () => {
  it('canonicalizes the application form without losing blank cells or the text "0"', () => {
    const bytes = templateBytes('application.md');
    const parsed = parse(bytes, 'QR-PD-7.4-01', 'BLANK_FORM');
    expect(parsed.rawBytesSha256.digest).toBe(
      '7aa43bee9d0de81093b3f472f6ac27a461e2952fb932846c579f96c18087e42b',
    );
    // Raw bytes stay untouched by the derived BOM/CRLF normalization.
    expect(parsed.rawBytesSha256.digest).toBe(sha256(bytes).digest);

    const cells = parsed.content.body.units.filter((unit) => unit.unitType === 'TABLE_CELL');
    const blank = cells.filter(
      (cell) => (cell.semanticMetadata.markdown as { valueState: string }).valueState === 'BLANK',
    );
    expect(blank.length).toBeGreaterThan(0);
    expect(
      cells.some(
        (cell) => (cell.semanticMetadata.markdown as { valueState: string }).valueState === 'TEXT',
      ),
    ).toBe(true);

    roundTrip(parsed, bytes);
  });

  it('canonicalizes the evaluation record and preserves its filled update rows', () => {
    const bytes = templateBytes('evaluation.md');
    const parsed = parse(bytes, 'QR-GL-7.4.01-02', 'BLANK_FORM');
    expect(parsed.rawBytesSha256.digest).toBe(
      '72c9a6a18eb841cc3fc8f41af816e372c20062e5d793d5b90e0ae510d824c21f',
    );
    const text = unitTexts(parsed.content.body.units).join('\n');
    expect(text).toContain('2026-08-30');
    roundTrip(parsed, bytes);
  });

  it('retains both H1 headings when independently exercising supported heading parsing', () => {
    // The procedure snapshot itself is rejected as a whole because of its ragged
    // first table; its two-H1 heading structure is exercised independently in
    // markdown-document-service.test.ts ('heading structure').
    const bytes = templateBytes('procedure.md');
    try {
      parse(bytes, 'PD-7.4', 'PROCEDURE');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactBusinessError);
      expect((error as ArtifactBusinessError).code).toBe('ARTIFACT_MARKDOWN_UNSUPPORTED');
    }
  });
});

describe('focused standalone fixtures', () => {
  const cases: readonly {
    file: string;
    code: string;
    kind: Artifact.MarkdownDocumentMetadata['fileKind'];
  }[] = [
    { file: 'wide-table.md', code: 'FIXTURE-WIDE', kind: 'FILLED_RECORD' },
    { file: 'repeated-labels.md', code: 'FIXTURE-REPEAT', kind: 'FILLED_RECORD' },
    { file: 'ordered-markers.md', code: 'FIXTURE-ORDER', kind: 'FILLED_RECORD' },
    { file: 'blank-versus-zero.md', code: 'FIXTURE-BLANK', kind: 'FILLED_RECORD' },
    { file: 'hard-breaks.md', code: 'FIXTURE-BREAK', kind: 'FILLED_RECORD' },
    { file: 'unicode-placeholders.md', code: 'FIXTURE-UNICODE', kind: 'FILLED_RECORD' },
    { file: 'escaped-pipes.md', code: 'FIXTURE-ESCAPE', kind: 'FILLED_RECORD' },
    { file: 'list-breaks.md', code: 'FIXTURE-LIST', kind: 'FILLED_RECORD' },
    { file: 'escaped-literals.md', code: 'FIXTURE-LITERAL', kind: 'FILLED_RECORD' },
    { file: 'code-literals.md', code: 'FIXTURE-CODE', kind: 'FILLED_RECORD' },
  ];

  for (const testCase of cases) {
    it(`round-trips ${testCase.file}`, () => {
      const bytes = fixtureBytes(testCase.file);
      const parsed = parse(bytes, testCase.code, testCase.kind);
      roundTrip(parsed, bytes);
    });
  }

  it('rejects unsupported extensions for the whole file', () => {
    for (const file of ['unsupported-extension.md', 'task-list.md']) {
      const bytes = fixtureBytes(file);
      expect(() => parse(bytes, 'FIXTURE-REJECT', 'FILLED_RECORD')).toThrow(ArtifactBusinessError);
      try {
        parse(bytes, 'FIXTURE-REJECT', 'FILLED_RECORD');
        expect.unreachable();
      } catch (error) {
        expect((error as ArtifactBusinessError).code).toBe('ARTIFACT_MARKDOWN_UNSUPPORTED');
      }
    }
  });
});
