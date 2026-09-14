import { describe, expect, it } from 'vitest';
import {
  EVALUATOR_PROFILE_REGISTRY_VERSION,
  registeredEvaluatorProfileReference,
  type Common,
} from '@zhiju/contracts';

import {
  TASK_READINESS_EVALUATOR_PROFILE_KEY,
  WORK_ORDER_VALIDATION_EVALUATOR_PROFILE_KEY,
  resolveTaskReadinessEvaluatorProfile,
  resolveWorkOrderValidationEvaluatorProfile,
} from './evaluator-profiles.js';

function canonicalReference(registryKey: string): Common.VersionedRef {
  const reference = registeredEvaluatorProfileReference(
    EVALUATOR_PROFILE_REGISTRY_VERSION,
    registryKey,
  );
  if (reference === undefined) throw new Error(`missing evaluator profile ${registryKey}`);
  return reference;
}

const readinessSelector = canonicalReference(TASK_READINESS_EVALUATOR_PROFILE_KEY);
const validationSelector = canonicalReference(WORK_ORDER_VALIDATION_EVALUATOR_PROFILE_KEY);

describe('TaskReadinessBuilder evaluator support boundary', () => {
  it('resolves its own registered selector', () => {
    expect(resolveTaskReadinessEvaluatorProfile(readinessSelector)).toEqual(readinessSelector);
  });

  it('resolves nothing for the other selector, unknown identities and look-alikes', () => {
    const rejected: readonly unknown[] = [
      validationSelector,
      { ...readinessSelector, objectType: 'zhiju.execution.evaluator' },
      { ...readinessSelector, kind: 'SNAPSHOT' },
      { ...readinessSelector, objectId: validationSelector.objectId },
      { ...readinessSelector, versionId: validationSelector.versionId },
      {
        ...readinessSelector,
        scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d4a1' },
      },
      { ...readinessSelector, contentHash: { algorithm: 'SHA-256', hashValue: 'x' } },
      TASK_READINESS_EVALUATOR_PROFILE_KEY,
      undefined,
    ];
    for (const candidate of rejected) {
      expect(resolveTaskReadinessEvaluatorProfile(candidate)).toBeUndefined();
    }
  });
});

describe('WorkOrderValidator evaluator support boundary', () => {
  it('resolves its own registered selector', () => {
    expect(resolveWorkOrderValidationEvaluatorProfile(validationSelector)).toEqual(
      validationSelector,
    );
  });

  it('resolves nothing for the other selector, unknown identities and look-alikes', () => {
    const rejected: readonly unknown[] = [
      readinessSelector,
      { ...validationSelector, objectType: 'zhiju.execution.evaluator_profile@1.0' },
      { ...validationSelector, kind: 'CONTENT_ADDRESSED' },
      { ...validationSelector, objectId: readinessSelector.objectId },
      { ...validationSelector, versionId: readinessSelector.versionId },
      { ...validationSelector, scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d4a1' } },
      { ...validationSelector, versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d4b3' },
      {},
    ];
    for (const candidate of rejected) {
      expect(resolveWorkOrderValidationEvaluatorProfile(candidate)).toBeUndefined();
    }
  });
});
