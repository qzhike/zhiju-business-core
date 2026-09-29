import type { CanonicalJsonObject, CanonicalJsonValue } from '@zhiju/shared-kernel';
import { object, requireThat, same } from './work-order-validation-plan.js';
import { canonicalSet } from './blocked-input-recovery.js';

/** Close the finite profile before reserving any final Result. */
export async function validateRecoveryFinal(
  result: CanonicalJsonObject,
  contract: CanonicalJsonObject,
  attempt: number,
  readMaterial: ((input: CanonicalJsonObject) => Promise<CanonicalJsonObject>) | undefined,
) {
  const unsupported = 'EXECUTION_CRITERION_UNSUPPORTED';
  const proposals = result.inputRequestProposals;
  requireThat(Array.isArray(proposals), unsupported);
  const recovery = object(contract.executionPolicy).maxAttempts === 2;
  if (!recovery) {
    requireThat(result.executionOutcome === 'COMPLETED' && proposals.length === 0, unsupported);
    return;
  }
  requireThat(
    same(object(contract.executionPolicy).retryableOutcomes, ['BLOCKED_INPUT']),
    unsupported,
  );
  if (attempt === 2) {
    requireThat(result.executionOutcome === 'COMPLETED' && proposals.length === 0, unsupported);
    return;
  }
  requireThat(
    attempt === 1 &&
      result.executionOutcome === 'BLOCKED_INPUT' &&
      proposals.length === 1 &&
      readMaterial !== undefined,
    unsupported,
  );
  const proposal = object(proposals[0]);
  const spec = object(proposal.expectedAnswerSpec);
  requireThat(
    proposal.requestType === 'execution.input.customer_material_confirmation' &&
      proposal.blocking === true &&
      proposal.requestedResponderRole === 'project.customer_material.confirmer' &&
      same(
        proposal.targetRefs,
        canonicalSet([definedValue(contract.workOrderRef), definedValue(contract.taskRef)]),
      ) &&
      Object.keys(spec).length === 3 &&
      spec.profile === 'execution.answer.customer_material.v1' &&
      Array.isArray(spec.requiredSourceRefs) &&
      spec.requiredSourceRefs.length > 0,
    unsupported,
  );
  const scope = object(object(contract.workOrderRef).scope);
  const candidate = object(spec.candidateMaterialRef);
  requireThat(
    candidate.kind === 'VERSIONED' &&
      candidate.objectType === 'zhiju.project.customer_material' &&
      same(candidate.scope, scope),
    unsupported,
  );
  const sources = spec.requiredSourceRefs as CanonicalJsonValue[];
  requireThat(
    same(sources, canonicalSet(sources)) &&
      sources.every((r) => {
        const source = object(r);
        return (
          source.kind === 'CONTENT_ADDRESSED' &&
          source.objectType === 'zhiju.project.source_material' &&
          same(source.scope, scope)
        );
      }),
    unsupported,
  );
  await readMaterial({ candidateMaterialRef: candidate, requiredSourceRefs: sources });
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
