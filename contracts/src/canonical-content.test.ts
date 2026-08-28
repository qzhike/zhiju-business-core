import { readFileSync } from 'node:fs';

import {
  canonicalizeCanonicalContentPayload,
  hashCanonicalContentPayload,
  type CanonicalContentPayload,
} from '@zhiju/shared-kernel';
import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';

type Fixture = Record<string, unknown>;

function fixture(name: string): Fixture {
  const url = new URL(`../../tests/fixtures/contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Fixture;
}

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';

function objectRef(objectType: string, objectId: string): Fixture {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  };
}

function queryEnvelope(payload: Fixture): Fixture {
  return {
    queryId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    queryType: 'integration.get_render_attempt_binding',
    queryVersion: '1.0',
    scopeRef: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    requester: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    authenticationContextRef: objectRef(
      'identity.authentication_context',
      '018f22e2-7c15-7b2e-8d86-2de956a9d303',
    ),
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    requestedAt: '2026-08-28T00:00:00Z',
    payload,
  };
}

function canonicalPayload(name: string): Fixture {
  return fixture(name).payload as Fixture;
}

function documentUnits(payload: Fixture): Fixture[] {
  return ((payload.body as Fixture).units ?? []) as Fixture[];
}

function workbookSheet(payload: Fixture): Fixture {
  return (((payload.body as Fixture).sheets as unknown[])[0] ?? {}) as Fixture;
}

function itemAt(items: readonly Fixture[], index: number): Fixture {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture item ${index} is missing`);
  return item;
}

describe('IM-04 WI-01 canonical content contract', () => {
  const registry = new ContractRegistry();

  it('validates the executable Document, WorkbookSpec, and independent Manifest schemas', () => {
    for (const name of [
      'canonical-content/document-golden.json',
      'canonical-content/workbook-golden.json',
    ]) {
      const input = fixture(name);
      expect(registry.validateCanonicalContentPayload(input.payload)).toEqual({
        valid: true,
        errors: [],
      });
      expect(registry.validateCanonicalContentManifest(input.manifest)).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it('rejects unknown canonicalization major, open content type, and required extensions', () => {
    const document = canonicalPayload('canonical-content/document-golden.json');

    const unknownMajor = structuredClone(document);
    unknownMajor.canonicalizationVersion = '2';
    const unknownMajorResult = registry.validateCanonicalContentPayload(unknownMajor);
    expect(unknownMajorResult.valid).toBe(false);
    expect(unknownMajorResult.errors.some((error) => error.keyword === 'const')).toBe(true);

    const openContentType = structuredClone(document);
    openContentType.contentType = 'STRUCTURED_REPORT';
    const openContentTypeResult = registry.validateCanonicalContentPayload(openContentType);
    expect(openContentTypeResult.valid).toBe(false);
    expect(openContentTypeResult.errors.some((error) => error.keyword === 'const')).toBe(true);

    const unknownOperationMajor = registry.validateOperation(
      'integration.get_render_attempt_binding',
      '2.0',
      queryEnvelope({
        attemptRef: objectRef('integration.render_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d281'),
      }),
    );
    expect(unknownOperationMajor.valid).toBe(false);
    expect(unknownOperationMajor.errors[0]?.keyword).toBe('operationRegistry');

    const requiredExtension = structuredClone(document);
    requiredExtension.requiredExtension = { extensionType: 'artifact.future_required' };
    const requiredExtensionResult = registry.validateCanonicalContentPayload(requiredExtension);
    expect(requiredExtensionResult.valid).toBe(false);
    expect(
      requiredExtensionResult.errors.some((error) => error.keyword === 'additionalProperties'),
    ).toBe(true);
  });

  it('rejects duplicate IDs, broken hierarchy, cycles, and sibling ordinal collisions', () => {
    const document = canonicalPayload('canonical-content/document-golden.json');

    const duplicate = structuredClone(document);
    const duplicateUnits = documentUnits(duplicate);
    duplicateUnits.push(structuredClone(itemAt(duplicateUnits, 0)));
    expect(registry.validateCanonicalContentPayload(duplicate).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'canonicalContentInvariant' })]),
    );

    const brokenHierarchy = structuredClone(document);
    const brokenUnits = documentUnits(brokenHierarchy);
    (itemAt(brokenUnits, 0).childUnitIds as string[]).splice(0, 1, 'missing-unit');
    const brokenHierarchyResult = registry.validateCanonicalContentPayload(brokenHierarchy);
    expect(brokenHierarchyResult.valid).toBe(false);
    expect(
      brokenHierarchyResult.errors.some((error) => error.keyword === 'canonicalContentInvariant'),
    ).toBe(true);

    const cycle = structuredClone(document);
    const cycleUnits = documentUnits(cycle);
    itemAt(cycleUnits, 0).parentUnitId = 'introduction';
    itemAt(cycleUnits, 1).parentUnitId = 'document-root';
    const cycleResult = registry.validateCanonicalContentPayload(cycle);
    expect(cycleResult.valid).toBe(false);
    expect(cycleResult.errors.some((error) => error.message?.includes('cycle'))).toBe(true);

    const duplicateOrdinal = structuredClone(document);
    const ordinalUnits = documentUnits(duplicateOrdinal);
    itemAt(ordinalUnits, 2).ordinal = 0;
    const duplicateOrdinalResult = registry.validateCanonicalContentPayload(duplicateOrdinal);
    expect(duplicateOrdinalResult.valid).toBe(false);
    expect(duplicateOrdinalResult.errors.some((error) => error.message?.includes('ordinal'))).toBe(
      true,
    );
  });

  it('rejects Workbook references, duplicate local IDs, and malformed formulas/types', () => {
    const workbook = canonicalPayload('canonical-content/workbook-golden.json');

    const brokenReference = structuredClone(workbook);
    const sheet = workbookSheet(brokenReference);
    const rows = sheet.rows as Fixture[];
    const cells = itemAt(rows, 0).cells as Fixture[];
    itemAt(cells, 0).columnId = 'missing-column';
    const brokenReferenceResult = registry.validateCanonicalContentPayload(brokenReference);
    expect(brokenReferenceResult.valid).toBe(false);
    expect(
      brokenReferenceResult.errors.some((error) => error.message?.includes('does not reference')),
    ).toBe(true);

    const duplicateCell = structuredClone(workbook);
    const duplicateSheet = workbookSheet(duplicateCell);
    const duplicateRows = duplicateSheet.rows as Fixture[];
    const firstCells = itemAt(duplicateRows, 0).cells as Fixture[];
    firstCells.push(structuredClone(itemAt(firstCells, 0)));
    const duplicateCellResult = registry.validateCanonicalContentPayload(duplicateCell);
    expect(duplicateCellResult.valid).toBe(false);
    expect(
      duplicateCellResult.errors.some((error) => error.message?.includes('duplicate cellId')),
    ).toBe(true);

    const malformedFormula = structuredClone(workbook);
    const formulaSheet = workbookSheet(malformedFormula);
    const formulaRows = formulaSheet.rows as Fixture[];
    const formulaCells = itemAt(formulaRows, 0).cells as Fixture[];
    itemAt(formulaCells, 2).formula = '=SUM(amount';
    const malformedFormulaResult = registry.validateCanonicalContentPayload(malformedFormula);
    expect(malformedFormulaResult.valid).toBe(false);
    expect(malformedFormulaResult.errors.some((error) => error.message?.includes('formula'))).toBe(
      true,
    );

    const malformedType = structuredClone(workbook);
    const typeSheet = workbookSheet(malformedType);
    const typeRows = typeSheet.rows as Fixture[];
    const typeCells = itemAt(typeRows, 0).cells as Fixture[];
    itemAt(typeCells, 0).valueType = 'Not a namespace';
    const malformedTypeResult = registry.validateCanonicalContentPayload(malformedType);
    expect(malformedTypeResult.valid).toBe(false);
    expect(malformedTypeResult.errors.some((error) => error.keyword === 'pattern')).toBe(true);
  });

  it('hashes only the frozen four-field Canonical Content Payload domain', () => {
    for (const name of [
      'canonical-content/document-golden.json',
      'canonical-content/workbook-golden.json',
    ]) {
      const input = fixture(name);
      const payload = input.payload as CanonicalContentPayload;
      const expectedDigest = input.expectedDigest as string;
      expect(canonicalizeCanonicalContentPayload(payload)).toBe(input.expectedCanonicalBytes);
      expect(hashCanonicalContentPayload(payload)).toEqual({
        algorithm: 'SHA-256',
        canonicalizationVersion: '1',
        digest: expectedDigest,
      });

      const manifest = input.manifest as Fixture;
      const payloadWithManifestMetadata = {
        ...structuredClone(payload),
        contentHash: manifest.contentHash,
        objectRef: manifest.objectRef,
        storageState: 'STAGING',
        byteSize: 999999,
        mediaType: 'application/octet-stream',
      } as unknown as CanonicalContentPayload;
      expect(hashCanonicalContentPayload(payloadWithManifestMetadata)).toEqual(
        hashCanonicalContentPayload(payload),
      );

      const changedContentType = structuredClone(payload) as unknown as Fixture;
      changedContentType.contentType =
        payload.contentType === 'STRUCTURED_DOCUMENT' ? 'WORKBOOK_SPEC' : 'STRUCTURED_DOCUMENT';
      expect(
        hashCanonicalContentPayload(changedContentType as unknown as CanonicalContentPayload),
      ).not.toEqual(hashCanonicalContentPayload(payload));

      const changedCanonicalizationVersion = structuredClone(payload) as unknown as Fixture;
      changedCanonicalizationVersion.canonicalizationVersion = '2';
      expect(
        hashCanonicalContentPayload(
          changedCanonicalizationVersion as unknown as CanonicalContentPayload,
        ),
      ).not.toEqual(hashCanonicalContentPayload(payload));

      const changedSchemaRef = structuredClone(payload) as unknown as Fixture;
      (changedSchemaRef.schemaRef as Fixture).versionId = '018f22e2-7c15-7b2e-8d86-2de956a9d299';
      expect(
        hashCanonicalContentPayload(changedSchemaRef as unknown as CanonicalContentPayload),
      ).not.toEqual(hashCanonicalContentPayload(payload));

      const changedBody = structuredClone(payload) as unknown as Fixture;
      const body = changedBody.body as Fixture;
      if ('title' in body) body.title = 'Supplier review procedure changed';
      else body.metadata = { locale: 'zh-CN' };
      expect(
        hashCanonicalContentPayload(changedBody as unknown as CanonicalContentPayload),
      ).not.toEqual(hashCanonicalContentPayload(payload));
    }
  });

  it('keeps Manifest metadata and self-hash fields outside the hash input', () => {
    const document = fixture('canonical-content/document-golden.json');
    const payload = document.payload as CanonicalContentPayload;
    const withSelfHash = {
      ...structuredClone(payload),
      contentHash: document.manifest,
    } as unknown as CanonicalContentPayload;
    expect(hashCanonicalContentPayload(withSelfHash)).toEqual(hashCanonicalContentPayload(payload));

    const manifest = structuredClone(document.manifest) as Fixture;
    manifest.objectRef = 'artifact/canonical/document-moved';
    manifest.storageState = 'LINKED';
    manifest.byteSize = 2048;
    manifest.mediaType = 'application/vnd.example.canonical+json';
    manifest.contentHash = { digest: 'f'.repeat(64) };
    expect(hashCanonicalContentPayload(payload)).toEqual(hashCanonicalContentPayload(payload));
  });

  it('validates the additive Binding Query and rejects secret or incomplete results', () => {
    const resultData = fixture('integration-render-attempt-binding-result-valid.json');
    const query = queryEnvelope({ attemptRef: resultData.attemptRef });
    expect(
      registry.validateOperation('integration.get_render_attempt_binding', '1.0', query),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult('integration.get_render_attempt_binding', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });

    const secret = structuredClone(resultData);
    secret.credentials = 'must-not-leak';
    secret.presignedUrl = 'https://storage.example.invalid/signed';
    const secretResult = registry.validateOperationResult(
      'integration.get_render_attempt_binding',
      '1.0',
      secret,
    );
    expect(secretResult.valid).toBe(false);
    expect(secretResult.errors.some((error) => error.keyword === 'additionalProperties')).toBe(
      true,
    );

    const incomplete = structuredClone(resultData);
    delete incomplete.succeededResult;
    const incompleteResult = registry.validateOperationResult(
      'integration.get_render_attempt_binding',
      '1.0',
      incomplete,
    );
    expect(incompleteResult.valid).toBe(false);
    expect(incompleteResult.errors.some((error) => error.keyword === 'required')).toBe(true);

    const failedWithSuccess = structuredClone(resultData);
    failedWithSuccess.status = 'FAILED';
    const failedWithSuccessResult = registry.validateOperationResult(
      'integration.get_render_attempt_binding',
      '1.0',
      failedWithSuccess,
    );
    expect(failedWithSuccessResult.valid).toBe(false);
    expect(failedWithSuccessResult.errors.some((error) => error.keyword === 'false schema')).toBe(
      true,
    );
  });
});
