import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertPreparationAnalysisBasis,
  assertPreparationAnalysisBasisSelection,
  assertTemplatePreparationPreset,
} from './preparation-analysis-basis.js';
import { ContractRegistry } from './registry.js';
import { operationPayloadSchemaRef } from './schema-types.js';
const directory = new URL('../../tests/fixtures/contracts/template-preparation/', import.meta.url);
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as Record<string, unknown>;
const basis = () => load('basis.payload.json');
const source = () => load('source-v2.payload.json');
const registry = new ContractRegistry();
const valid = (version: '1.0' | '2.0', payload: unknown) => {
  const op = registry.getOperation('project.capture_preparation_source', version);
  if (!op) throw new Error('missing source registration');
  const ref = operationPayloadSchemaRef(op);
  if (!ref) throw new Error('missing source schema');
  return registry.validateCoreContract(ref, payload).valid;
};
describe('template preparation explicit contracts', () => {
  it('accepts an independently named synthetic template basis without normative references', () => {
    expect(() => {
      assertPreparationAnalysisBasis(basis());
    }).not.toThrow();
  });
  it('rejects ambiguous instruction identity and conflicting template locations', () => {
    const a = basis();
    a.instructionBindings = [
      ...(a.instructionBindings as unknown[]),
      ...(a.instructionBindings as unknown[]),
    ];
    expect(() => {
      assertPreparationAnalysisBasis(a);
    }).toThrow();
    const b = basis();
    b.requirementBindings = [
      ...(b.requirementBindings as object[]),
      { ...(b.requirementBindings as object[])[0], requirementCode: 'zhiju.requirement.other' },
    ];
    expect(() => {
      assertPreparationAnalysisBasis(b);
    }).toThrow();
  });
  it('allows one requirement to have several exact, non-overlapping template evidence locations', () => {
    const b = basis();
    (b.requirementBindings as object[]).push({
      requirementCode: 'zhiju.requirement.scope',
      templateCode: 'T1',
      locator: 'L5-L7',
    });
    expect(() => {
      assertPreparationAnalysisBasis(b);
    }).not.toThrow();
  });
  it('rejects fake instruction paths, missing immutable template identity and unknown vocabulary fields', () => {
    const a = basis();
    const instruction = (a.instructionBindings as Record<string, unknown>[])[0];
    if (!instruction) throw new Error('Missing fixture instruction');
    instruction.path = '/home/private/AGENTS.md';
    expect(() => {
      assertPreparationAnalysisBasis(a);
    }).toThrow();
    const b = basis();
    const template = (b.templateBindings as Record<string, unknown>[])[0];
    if (!template) throw new Error('Missing fixture template');
    delete (template.templateRef as Record<string, unknown>).immutableVersionId;
    expect(() => {
      assertPreparationAnalysisBasis(b);
    }).toThrow();
    const c = basis();
    (c.vocabulary as Record<string, unknown>).regulatoryVerified = true;
    expect(() => {
      assertPreparationAnalysisBasis(c);
    }).toThrow();
  });
  it('requires exact basis publication and refuses legacy publication identities', () => {
    const s = source();
    const selection = {
      basisRef: s.analysisBasisRef,
      basisHash: s.analysisBasisHash,
      publicationRef: s.analysisBasisPublicationRef,
    };
    expect(() => {
      assertPreparationAnalysisBasisSelection(selection);
    }).not.toThrow();
    expect(() => {
      assertPreparationAnalysisBasisSelection({
        ...selection,
        publicationRef: {
          ...(selection.publicationRef as object),
          objectType: 'zhiju.identity.company_rule_publication',
        },
      });
    }).toThrow();
  });
  it('keeps v1 and v2 source payloads mutually exclusive and rejects first-round prior reports', () => {
    const p = source();
    expect(valid('2.0', p)).toBe(true);
    expect(valid('1.0', p)).toBe(false);
    const legacy = {
      ...p,
      ruleBundleRef: { kind: 'SNAPSHOT' },
      companyRulePublicationRef: { kind: 'CONTENT_ADDRESSED' },
    };
    expect(valid('2.0', legacy)).toBe(false);
    expect(valid('2.0', { ...p, previousReportRef: p.intakeManifestRef })).toBe(false);
    expect(valid('2.0', { ...p, trustedDecisionRefs: [p.projectRef] })).toBe(false);
  });
  it('cannot turn an old preset into template mode just by removing companyRules', () => {
    expect(() => {
      assertTemplatePreparationPreset({ profile: 'ep.preparation_entry@1.0', analysisBasis: {} });
    }).toThrow();
  });
});
