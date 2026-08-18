import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import { ContractRegistry } from '../registry.js';
import { qualityGovernanceOperationContracts } from './quality-governance.schema.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../tests/fixtures/contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

describe('quality-governance schema', () => {
  const registry = new ContractRegistry();

  it('registers exactly 37 full quality operations with the approved kind distribution', () => {
    const quality = publicApiOperations.filter(
      (operation) => operation.owner === 'quality-governance',
    );

    expect(quality).toHaveLength(37);
    expect(quality.filter((operation) => operation.kind === 'COMMAND')).toHaveLength(18);
    expect(quality.filter((operation) => operation.kind === 'QUERY')).toHaveLength(8);
    expect(quality.filter((operation) => operation.kind === 'EVENT')).toHaveLength(11);
    expect(Object.keys(qualityGovernanceOperationContracts).sort()).toEqual(
      quality.map((operation) => operation.type).sort(),
    );
  });

  it('exposes result schemas for every quality query', () => {
    const quality = publicApiOperations.filter(
      (operation) => operation.owner === 'quality-governance' && operation.kind === 'QUERY',
    );

    expect(quality).toHaveLength(8);
    for (const operation of quality) {
      const contract = qualityGovernanceOperationContracts[operation.type];
      expect(contract?.resultSchemaRef).toBeDefined();
    }
  });

  it('validates a field-level evidence candidate command', () => {
    const command = fixture('quality-capture-evidence-candidate-command-valid.json');
    expect(
      registry.validateOperation('quality.capture_evidence_candidate', '1.0', command),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects Agent/actingFor impersonation of a Human Approval submission', () => {
    const command = fixture('quality-submit-approval-decision-agent-forbidden.json');
    const result = registry.validateOperation('quality.submit_approval_decision', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'const' && error.instancePath.includes('principalKind'),
      ),
    ).toBe(true);
  });

  it('accepts a Human Approval submission when the principal kind is HUMAN', () => {
    const command = fixture('quality-submit-approval-decision-command-valid.json');
    expect(registry.validateOperation('quality.submit_approval_decision', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects malformed target hashes in a Gate Result submission', () => {
    const command = fixture('quality-record-gate-result-wrong-target-hash.json');
    const result = registry.validateOperation('quality.record_gate_result', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'pattern' && error.instancePath.includes('revisionRef'),
      ),
    ).toBe(true);
  });

  it('rejects nested sensitive fields leaked through a public Quality event', () => {
    const event = fixture('quality-evidence-verified-event-sensitive-field.json');
    const result = registry.validateOperation('quality.EvidenceVerified', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('enforces the EVALUATION_STAGE enum on the Gate Result recorded event', () => {
    const validEvent = fixture('quality-gate-result-recorded-event-valid.json');
    expect(registry.validateOperation('quality.GateResultRecorded', '1.0', validEvent)).toEqual({
      valid: true,
      errors: [],
    });

    const invalidEvent = fixture('quality-gate-result-recorded-event-invalid-stage.json');
    const result = registry.validateOperation('quality.GateResultRecorded', '1.0', invalidEvent);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'enum' && error.instancePath.includes('evaluationStage'),
      ),
    ).toBe(true);
  });

  it('validates a public EvidenceVerified event payload', () => {
    const event = fixture('quality-evidence-verified-event-valid.json');
    expect(registry.validateOperation('quality.EvidenceVerified', '1.0', event)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('treats Gate Result and Human Approval as distinct shapes', () => {
    const gateCommand = fixture('quality-record-gate-result-wrong-target-hash.json');
    const approvalCommand = fixture('quality-submit-approval-decision-command-valid.json');
    const gatePayload = (gateCommand.payload as Record<string, unknown>).submission;
    const approvalPayload = (approvalCommand.payload as Record<string, unknown>).submission;

    expect(Object.keys(gatePayload as Record<string, unknown>).sort()).not.toEqual(
      Object.keys(approvalPayload as Record<string, unknown>).sort(),
    );
    expect('gateTarget' in (gatePayload as Record<string, unknown>)).toBe(true);
    expect('approverHumanPrincipalRef' in (approvalPayload as Record<string, unknown>)).toBe(true);
  });

  it('validates a field-level get_evidence query and its result data', () => {
    const query = fixture('quality-get-evidence-query-valid.json');
    const resultData = fixture('quality-get-evidence-result-valid.json');

    expect(registry.validateOperation('quality.get_evidence', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateOperationResult('quality.get_evidence', '1.0', resultData)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects unknown nested fields in get_evidence result data', () => {
    const resultData = {
      ...fixture('quality-get-evidence-result-valid.json'),
      capturedEvidenceBody: 'must-not-leak',
    };
    const result = registry.validateOperationResult('quality.get_evidence', '1.0', resultData);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });
});
