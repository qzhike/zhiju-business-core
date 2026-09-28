import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createPolicyProfileDocumentValidator } from './policy-profile-documents.js';
import { POLICY_PROFILE_REGISTRY_VERSION } from './policy-profiles.js';
import { ContractRegistry } from './registry.js';

const registry = new ContractRegistry();
const documentValidator = createPolicyProfileDocumentValidator();
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../tests/fixtures/contracts/blocked-input-recovery/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
}

describe('TE-REC-D-002 additive recovery contract fixtures', () => {
  const operations = [
    ['build-context-v1-1', 'execution.build_context_snapshot', '1.1'],
    ['reconcile-task', 'execution.reconcile_task_execution', '1.0'],
    ['task-state-query', 'execution.get_task_state', '1.0'],
    ['work-order-state-query', 'execution.get_work_order_execution_state', '1.0'],
  ] as const;
  for (const [name, type, version] of operations) {
    it(`accepts the independent ${name} fixture`, () => {
      expect(registry.validateOperation(type, version, fixture(`${name}-valid`))).toEqual({
        valid: true,
        errors: [],
      });
    });
  }
  for (const name of [
    'answer-instead-of-resolution',
    'empty-resolution-set',
    'principal-ref-instead-of-typed-ref',
    'unknown-field',
    'null-builder',
    'enterprise-scope',
    'content-hash',
  ]) {
    it(`rejects ${name}`, () => {
      expect(
        registry.validateOperation(
          'execution.build_context_snapshot',
          '1.1',
          fixture(`build-context-v1-1-invalid-${name}`),
        ).valid,
      ).toBe(false);
    });
  }
  it('requires a CAS version for Task reconciliation', () => {
    expect(
      registry.validateOperation(
        'execution.reconcile_task_execution',
        '1.0',
        fixture('reconcile-task-invalid-missing-version'),
      ).valid,
    ).toBe(false);
  });
  it('returns a canonical Snapshot for the new build version', () => {
    expect(
      registry.validateOperationResult(
        'execution.build_context_snapshot',
        '1.1',
        fixture('build-context-v1-1-result-valid'),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.build_context_snapshot',
        '1.1',
        fixture('build-context-v1-1-result-invalid-strength'),
      ).valid,
    ).toBe(false);
  });
  it('keeps the Task reconciliation result closed', () => {
    expect(
      registry.validateOperationResult(
        'execution.reconcile_task_execution',
        '1.0',
        fixture('reconcile-task-result-valid'),
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.reconcile_task_execution',
        '1.0',
        fixture('reconcile-task-result-invalid-extra-field'),
      ).valid,
    ).toBe(false);
  });
  for (const [name, type] of [
    ['task', 'execution.get_task_state'],
    ['work-order', 'execution.get_work_order_execution_state'],
  ] as const) {
    it(`rejects an unrelated ${name} query target`, () => {
      expect(
        registry.validateOperation(type, '1.0', fixture(`${name}-state-query-invalid-target`))
          .valid,
      ).toBe(false);
    });
    it(`accepts the closed ${name} state result`, () => {
      expect(
        registry.validateOperationResult(type, '1.0', fixture(`${name}-state-result-valid`)),
      ).toEqual({ valid: true, errors: [] });
    });
  }
  it('does not put checkedAt inside TaskStateView', () => {
    expect(
      registry.validateOperationResult(
        'execution.get_task_state',
        '1.0',
        fixture('task-state-result-invalid-checked-at'),
      ).valid,
    ).toBe(false);
  });
  it('rejects an Answer used as a Run identity', () => {
    expect(
      registry.validateOperationResult(
        'execution.get_work_order_execution_state',
        '1.0',
        fixture('work-order-state-result-invalid-run'),
      ).valid,
    ).toBe(false);
  });
  it('registers finite recovery Controls without upgrading the old profile', () => {
    const profile = 'execution.work_order_controls.policy@1.1';
    expect(
      documentValidator.validate(
        POLICY_PROFILE_REGISTRY_VERSION,
        profile,
        fixture('controls-v1-1-valid'),
      ),
    ).toMatchObject({ valid: true });
    expect(
      documentValidator.validate(
        POLICY_PROFILE_REGISTRY_VERSION,
        profile,
        fixture('controls-v1-1-invalid-third-run'),
      ),
    ).toMatchObject({ valid: false });
    expect(
      documentValidator.validate(
        POLICY_PROFILE_REGISTRY_VERSION,
        'execution.work_order_controls.policy@1.0',
        fixture('controls-v1-1-valid'),
      ),
    ).toMatchObject({ valid: false });
  });
});
