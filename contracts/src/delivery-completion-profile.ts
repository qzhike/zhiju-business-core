import { registeredEvaluatorProfileReference } from './evaluator-profiles.js';
import { canonicalize, isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common } from './generated/types/common.js';
export const EXACT_TASK_COMPLETION_PROFILE = 'ep.delivery_item.exact_task_completion@1.0';
const evaluator = registeredEvaluatorProfileReference(
  'im06-evaluator-static-v1',
  'ep.delivery_item_completion.evaluator@2.0',
);
if (!evaluator) throw new Error('Missing delivery completion evaluator');
export const DELIVERY_COMPLETION_EVALUATOR = evaluator;
export function exactCompletionCriteria(value: unknown, scope: Common.ScopeRef) {
  const v = value as { profile?: unknown; allOf?: unknown } | null;
  if (
    !v ||
    typeof v !== 'object' ||
    Object.keys(v).sort().join() !== 'allOf,profile' ||
    v.profile !== EXACT_TASK_COMPLETION_PROFILE ||
    !Array.isArray(v.allOf) ||
    v.allOf.length < 1 ||
    v.allOf.length > 2
  )
    throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
  let taskRef: CanonicalJsonObject | undefined, releaseRef: CanonicalJsonObject | undefined;
  for (const criterion of v.allOf) {
    if (criterion === null || typeof criterion !== 'object' || Array.isArray(criterion))
      throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
    const c = criterion as Record<string, unknown>;
    const task = c.eventType === 'execution.TaskCompleted';
    if (!task && c.eventType !== 'release.ReleaseCompleted')
      throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
    if (Object.keys(c).sort().join() !== (task ? 'eventType,taskRef' : 'eventType,factRef'))
      throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
    const r = c[task ? 'taskRef' : 'factRef'] as CanonicalJsonObject | undefined;
    if (
      !r ||
      Object.keys(r).sort().join() !== 'kind,objectId,objectType,scope' ||
      r.kind !== 'OBJECT' ||
      r.objectType !== (task ? 'zhiju.execution.task' : 'release.release') ||
      typeof r.objectId !== 'string' ||
      !isUuidV7(r.objectId) ||
      canonicalize(r.scope ?? null) !== canonicalize(scope as unknown as CanonicalJsonObject)
    )
      throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
    if (task) {
      if (taskRef) throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
      taskRef = r;
    } else {
      if (releaseRef) throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
      releaseRef = r;
    }
  }
  if (!taskRef) throw new Error('PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED');
  return { taskRef, releaseRef };
}
