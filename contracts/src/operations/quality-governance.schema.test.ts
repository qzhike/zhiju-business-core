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

  // ===========================================================================
  // Code-review P1 / P2 remediation tests
  // ===========================================================================

  it('accepts a REPRESENTATION GateTarget carrying the full Common representationRef', () => {
    const command = fixture('quality-record-gate-result-representation-target-valid.json');
    expect(registry.validateOperation('quality.record_gate_result', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects a REPRESENTATION GateTarget missing checksum and renderer metadata', () => {
    const command = fixture(
      'quality-record-gate-result-representation-target-missing-checksum.json',
    );
    const result = registry.validateOperation('quality.record_gate_result', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'required' && error.instancePath.includes('representationRef'),
      ),
    ).toBe(true);
  });

  it('accepts a PrincipalRef in verify_evidence.verifier', () => {
    const command = fixture('quality-verify-evidence-principal-ref-valid.json');
    expect(registry.validateOperation('quality.verify_evidence', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects an ObjectRef substitute in verify_evidence.verifier', () => {
    const command = fixture('quality-verify-evidence-object-ref-rejected.json');
    const result = registry.validateOperation('quality.verify_evidence', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'required' && error.instancePath.includes('verifier'),
      ),
    ).toBe(true);
  });

  it('accepts revoke_evidence with top-level revocationReason / impactAssessmentRef / revokedAt', () => {
    const command = fixture('quality-revoke-evidence-command-valid.json');
    expect(registry.validateOperation('quality.revoke_evidence', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('accepts invalidate_gate_result with top-level invalidationReason / impactAssessmentRef / invalidatedAt', () => {
    const command = fixture('quality-invalidate-gate-result-command-valid.json');
    expect(registry.validateOperation('quality.invalidate_gate_result', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('accepts revoke_approval with top-level revocationReason / impactAssessmentRef / revokedAt', () => {
    const command = fixture('quality-revoke-approval-command-valid.json');
    expect(registry.validateOperation('quality.revoke_approval', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects create_quality_profile_draft without the required releaseRequirements', () => {
    const command = fixture(
      'quality-create-quality-profile-draft-missing-release-requirements.json',
    );
    const result = registry.validateOperation(
      'quality.create_quality_profile_draft',
      '1.0',
      command,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          (error.params as { missingProperty?: string }).missingProperty === 'releaseRequirements',
      ),
    ).toBe(true);
  });

  it('accepts get_gate_results with an opaque cursor that matches the shared PageRequest', () => {
    const query = fixture('quality-get-gate-results-query-valid.json');
    expect(registry.validateOperation('quality.get_gate_results', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects get_gate_results whose cursor is shorter than the shared opaqueCursor minimum', () => {
    const query = fixture('quality-get-gate-results-query-short-cursor-rejected.json');
    const result = registry.validateOperation('quality.get_gate_results', '1.0', query);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'pattern' && error.instancePath.includes('cursor'),
      ),
    ).toBe(true);
  });

  it('returns full RevisionAcceptanceSnapshot Core Contract for get_revision_acceptance_snapshot', () => {
    const query = fixture('quality-get-revision-acceptance-snapshot-query-valid.json');
    const resultData = fixture('core/revision-acceptance-valid.json');

    expect(
      registry.validateOperation('quality.get_revision_acceptance_snapshot', '1.0', query),
    ).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult(
        'quality.get_revision_acceptance_snapshot',
        '1.0',
        resultData,
      ),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('returns full ApprovalBundleSnapshot Core Contract for get_approval_bundle_snapshot', () => {
    const query = fixture('quality-get-approval-bundle-snapshot-query-valid.json');
    const resultData = fixture('core/approval-bundle-valid.json');

    expect(
      registry.validateOperation('quality.get_approval_bundle_snapshot', '1.0', query),
    ).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('quality.get_approval_bundle_snapshot', '1.0', resultData),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('returns full ReleaseReadinessSnapshot Core Contract for get_release_readiness_snapshot', () => {
    const query = fixture('quality-get-release-readiness-snapshot-query-valid.json');
    const resultData = fixture('core/release-readiness-valid.json');

    expect(
      registry.validateOperation('quality.get_release_readiness_snapshot', '1.0', query),
    ).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('quality.get_release_readiness_snapshot', '1.0', resultData),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects a truncated Snapshot View that omits Core Contract fields', () => {
    const query = fixture('quality-get-revision-acceptance-snapshot-query-valid.json');
    const truncated = {
      revisionAcceptanceSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'quality.revision_acceptance_snapshot',
        objectId: '018f22e2-7c15-7b72-8d86-2de956a9d20d',
        snapshotId: '018f22e2-7c15-7b72-8d86-2de956a9d20d',
        scope: {
          enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
          projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
        },
        contentHash: {
          algorithm: 'SHA-256',
          digest: '0000000000000000000000000000000000000000000000000000000000000000',
          canonicalizationVersion: '1',
        },
      },
      revisionRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'artifact.artifact_revision',
        objectId: '018f22e2-7c15-7b42-8d86-2de956a9d20a',
        scope: {
          enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
          projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
        },
        contentHash: {
          algorithm: 'SHA-256',
          digest: '0000000000000000000000000000000000000000000000000000000000000000',
          canonicalizationVersion: '1',
        },
      },
    };

    expect(
      registry.validateOperation('quality.get_revision_acceptance_snapshot', '1.0', query).valid,
    ).toBe(true);
    const result = registry.validateOperationResult(
      'quality.get_revision_acceptance_snapshot',
      '1.0',
      truncated,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'required')).toBe(true);
  });

  // ===========================================================================
  // Second-round P1 / P2 remediation tests
  // ===========================================================================

  it('rejects record_gate_result carrying an unauthorized executionMode field', () => {
    const command = fixture('quality-record-gate-result-execution-mode-rejected.json');
    const result = registry.validateOperation('quality.record_gate_result', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'additionalProperties' && error.instancePath.includes('submission'),
      ),
    ).toBe(true);
  });

  it('accepts a record_reused_gate_result command carrying source Result and ChangeImpact', () => {
    const command = fixture('quality-record-reused-gate-result-command-valid.json');
    expect(registry.validateOperation('quality.record_reused_gate_result', '1.0', command)).toEqual(
      {
        valid: true,
        errors: [],
      },
    );
  });

  it('rejects record_reused_gate_result missing the source GateResult reference', () => {
    const command = fixture('quality-record-reused-gate-result-missing-source-ref.json');
    const result = registry.validateOperation('quality.record_reused_gate_result', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/reuse' &&
          (error.params as { missingProperty?: string }).missingProperty === 'sourceGateResultRef',
      ),
    ).toBe(true);
  });

  it('rejects record_reused_gate_result missing the ChangeImpact reference', () => {
    const command = fixture('quality-record-reused-gate-result-missing-change-impact.json');
    const result = registry.validateOperation('quality.record_reused_gate_result', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/reuse' &&
          (error.params as { missingProperty?: string }).missingProperty === 'changeImpactRef',
      ),
    ).toBe(true);
  });

  it('accepts get_gate_results with empty Set filter collections to return the full target history', () => {
    const query = fixture('quality-get-gate-results-query-empty-filters-valid.json');
    expect(registry.validateOperation('quality.get_gate_results', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('accepts propose_issue_resolution whose changedClaimRefs is an empty plain array', () => {
    const command = fixture('quality-propose-issue-resolution-no-content-changes-valid.json');
    expect(registry.validateOperation('quality.propose_issue_resolution', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
