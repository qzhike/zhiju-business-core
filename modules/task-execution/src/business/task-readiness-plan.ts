// IM-06 (#208): the closed Task Readiness algorithm of Module-Spec-003
// §17.3/§17.5/§17.6, shared by the producer and the consumer.
//
// Both entries must observe the *same* closed set with the *same* rules, so the
// set is computed here once: R-206-1 Task addressing, the dependency graph read
// through the frozen definition pointer, cycle detection over "this Task plus
// its transitive dependencies", the first-version input support set, the
// blocker derivation and the ordered check rows with their stable reason codes.
//
// Everything fails closed. A stored reference that is not exactly the identity
// its own frozen payload may carry is a definition-integrity failure, never a
// silently skipped edge; an input reference outside the single supported kind is
// `UNSUPPORTED`, never "no input" and never "already satisfied"; an owning read
// that cannot answer propagates instead of degenerating into a default.

import { canonicalize, isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from '../persistence/task-execution-db.js';
import { CommandExecutionError } from '../persistence/command-runner.js';
import type { TaskReadinessRepository } from '../persistence/task-readiness-repository.js';
import type { TaskGraphNodeRow } from '../persistence/task-readiness-repository.js';

/** Shared dependency code: an owning read could not answer. */
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

/** The one supported input object type of the first version (§17.5 step 5). */
export const SUPPORTED_INPUT_OBJECT_TYPE = 'zhiju.project.context_source_slice';

/** The per-major Task spelling a Task's own creation definition fixes (§17.3). */
export const TASK_READINESS_TASK_BINDINGS: readonly {
  readonly schemaVersion: string;
  readonly taskObjectType: string;
}[] = Object.freeze([
  Object.freeze({ schemaVersion: '1.0', taskObjectType: 'execution.task' }),
  Object.freeze({ schemaVersion: '2.0', taskObjectType: 'zhiju.execution.task' }),
]);

/** Bound of the traversed dependency subgraph, so a hostile graph cannot hang a command. */
const MAX_DEPENDENCY_NODES = 4096;

export interface ReadinessScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

export type DependencyCompletionUseStatus =
  'USABLE' | 'STALE' | 'NOT_COMPLETED' | 'CANCELLED' | 'MISSING';

export interface DependencyObservation {
  readonly taskRef: CanonicalJsonObject;
  readonly aggregateVersion: string | null;
  readonly completionEvaluationRef: CanonicalJsonObject | null;
  readonly completionValidUntil?: string;
  readonly completionUseStatus: DependencyCompletionUseStatus;
}

export type InputResolution = 'USABLE' | 'EXPIRED' | 'REVOKED' | 'UNSUPPORTED';

export interface InputObservation {
  /** The verbatim frozen-payload reference, never a reconstructed identity. */
  readonly inputRef: CanonicalJsonObject;
  readonly resolution: InputResolution;
  readonly validUntil: string | null;
}

export interface ReadinessCheckRow {
  readonly checkCode:
    'DEPENDENCY_SATISFIED' | 'INPUT_REF_RESOLVED' | 'NO_BLOCKING_INFORMATION_REQUEST';
  readonly outcome: 'SATISFIED' | 'UNSATISFIED' | 'UNSUPPORTED' | 'STALE';
  readonly factRefs: readonly CanonicalJsonObject[];
  readonly reasonCodes: readonly string[];
}

export interface ReadinessObservation {
  readonly dependencies: readonly DependencyObservation[];
  readonly inputs: readonly InputObservation[];
  readonly blockers: readonly CanonicalJsonObject[];
  readonly checks: readonly ReadinessCheckRow[];
  readonly ready: boolean;
}

export interface TaskReadinessInputRefResolution {
  readonly status: 'USABLE' | 'EXPIRED' | 'REVOKED';
  /** The owning read's finite bound, when it exposes one. */
  readonly validUntil?: string | null | undefined;
}

/**
 * Internal TaskExecution Port for the one supported input kind. EnterpriseProject
 * owns the authoritative `project.get_context_source_slice@1.0` read and
 * implements this Port at the composition boundary; TaskExecution never reads
 * the owning schema, and a resolution that cannot answer throws.
 */
export interface TaskReadinessInputRefPort {
  resolveInputRef(request: {
    readonly inputRef: CanonicalJsonObject;
  }): Promise<TaskReadinessInputRefResolution>;
}

export interface DependencyCompletionPort {
  readonly revalidate?: () => Promise<void>;
  read(taskRef: CanonicalJsonObject): Promise<{
    evaluationRef: CanonicalJsonObject;
    useStatus: 'USABLE' | 'STALE' | 'REVOKED';
    validUntil: string;
  }>;
}
export interface ReadinessPlanningPorts {
  readonly completion?: DependencyCompletionPort;
  readonly inputRefs: TaskReadinessInputRefPort;
}

export interface ReadinessPlanRejection {
  readonly errorCode: string;
  readonly safeSummary: string;
}

export type ReadinessPlanOutcome =
  | ({ readonly outcome: 'PLANNED' } & ReadinessObservation)
  | ({ readonly outcome: 'REJECTED' } & ReadinessPlanRejection);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Ascending canonical byte order, the one stable order §17.6 fixes. */
function compareCanonical(left: unknown, right: unknown): number {
  const a = canonicalize(left as CanonicalJsonObject);
  const b = canonicalize(right as CanonicalJsonObject);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The exact Project scope form of §17.3: `{enterpriseId, projectId}` and
 * nothing else. Platform and Enterprise-only forms are not a Task scope.
 */
export function exactProjectScope(value: unknown): ReadinessScope | undefined {
  const scope = record(value);
  const keys = Object.keys(scope);
  if (keys.length !== 2 || !keys.includes('enterpriseId') || !keys.includes('projectId')) {
    return undefined;
  }
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (typeof enterpriseId !== 'string' || typeof projectId !== 'string') return undefined;
  return { enterpriseId, projectId };
}

/**
 * R-206-1: the Task reference of one readiness request. `kind`, the exact
 * version-derived spelling, a UuidV7 identity and the exact Project scope are
 * all required; the caller's spelling is never normalized, completed, stripped
 * or case-folded, and the other published major's spelling is never accepted.
 */
export function readTaskRefClosure(
  ref: unknown,
  expectedObjectType: string,
  scope: ReadinessScope,
): { readonly taskId: string } | undefined {
  const value = record(ref);
  if (value.kind !== 'OBJECT' || value.objectType !== expectedObjectType) return undefined;
  if (typeof value.objectId !== 'string' || !isUuidV7(value.objectId)) return undefined;
  const refScope = exactProjectScope(value.scope);
  if (refScope?.enterpriseId !== scope.enterpriseId || refScope.projectId !== scope.projectId) {
    return undefined;
  }
  return { taskId: value.objectId };
}

/** The exact spelling of the major that created a Task (§17.3). */
export function taskSpellingForSchemaVersion(schemaVersion: string): string | undefined {
  return TASK_READINESS_TASK_BINDINGS.find((binding) => binding.schemaVersion === schemaVersion)
    ?.taskObjectType;
}

interface DependencyRefParse {
  readonly taskId: string;
  readonly ref: CanonicalJsonObject;
}

/**
 * §17.5 step 3: the dependency set is decided *only* by the frozen definition
 * payload. Every stored element must be the exact version-bound Task OBJECT of
 * this Scope and must not be the Task itself; anything else is a
 * definition-integrity failure rather than an ignorable edge.
 */
function readDependencyRefs(
  value: unknown,
  expectedObjectType: string,
  scope: ReadinessScope,
  subjectTaskId: string,
): readonly DependencyRefParse[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const parsed: DependencyRefParse[] = [];
  for (const element of value) {
    const closure = readTaskRefClosure(element, expectedObjectType, scope);
    if (closure === undefined || closure.taskId === subjectTaskId) return undefined;
    parsed.push({ taskId: closure.taskId, ref: element as CanonicalJsonObject });
  }
  // §17.5 step 3: dedupe and order by the dependency Ref, which for identical
  // kind/objectType/scope is exactly the objectId order.
  parsed.sort((left, right) => compareCanonical(left.ref, right.ref));
  return parsed.filter((entry, index) => index === 0 || entry.taskId !== parsed[index - 1]?.taskId);
}

function dependencyObservation(
  dependency: DependencyRefParse,
  row: TaskGraphNodeRow | undefined,
): DependencyObservation {
  if (row === undefined) {
    return {
      taskRef: dependency.ref,
      aggregateVersion: null,
      completionEvaluationRef: null,
      completionUseStatus: 'MISSING',
    };
  }
  // Historical state alone cannot authorize a dependency; the current owning Port upgrades it.
  const completionUseStatus: DependencyCompletionUseStatus =
    row.status === 'CANCELLED'
      ? 'CANCELLED'
      : row.status === 'COMPLETED'
        ? 'STALE'
        : 'NOT_COMPLETED';
  return {
    taskRef: dependency.ref,
    aggregateVersion: row.aggregateVersion,
    completionEvaluationRef: null,
    completionUseStatus,
  };
}

const DEPENDENCY_REASON_BY_STATUS: Readonly<Record<DependencyCompletionUseStatus, string>> = {
  MISSING: 'DEPENDENCY_TASK_MISSING',
  CANCELLED: 'DEPENDENCY_TASK_CANCELLED',
  NOT_COMPLETED: 'DEPENDENCY_NOT_COMPLETED',
  STALE: 'DEPENDENCY_COMPLETION_STALE',
  USABLE: '',
};

function dependencyIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const element of value) {
    const objectId = record(element).objectId;
    if (typeof objectId === 'string') ids.push(objectId);
  }
  return ids;
}

/**
 * §17.5 step 4: the traversed subgraph is "this Task plus its transitive
 * dependencies"; a cycle anywhere inside it violates the Domain §18.6 graph
 * invariant and is not a condition that waiting could satisfy. The reachable set
 * is bounded and Kahn's algorithm decides the topological order, so a cycle that
 * does not pass through the Task under judgement is still rejected.
 */
async function dependencySubgraphIsAcyclic(
  repository: TaskReadinessRepository,
  trx: TaskExecutionTransaction,
  subjectTaskId: string,
  directDependencyIds: readonly string[],
): Promise<boolean> {
  const edges = new Map<string, readonly string[]>();
  const pending = [...directDependencyIds];
  while (pending.length > 0) {
    const layer = pending.splice(0, pending.length);
    const unknown = layer.filter((id) => !edges.has(id));
    if (edges.size + unknown.length > MAX_DEPENDENCY_NODES) return false;
    if (unknown.length === 0) continue;
    const nodes = await repository.readTaskGraphNodes(trx, unknown);
    for (const id of unknown) edges.set(id, []);
    for (const node of nodes) {
      const dependencies = dependencyIdsOf(node.dependencyTaskRefs);
      edges.set(node.taskId, dependencies);
      pending.push(...dependencies);
    }
    // A Task that is not visible in this Scope owns no outgoing edge here; its
    // own graph is governed by its own Scope's judgement.
  }
  const indegree = new Map<string, number>();
  for (const [node, dependencies] of edges) {
    if (!indegree.has(node)) indegree.set(node, 0);
    for (const dependency of dependencies) {
      if (dependency === subjectTaskId) return false;
      indegree.set(dependency, (indegree.get(dependency) ?? 0) + 1);
    }
  }
  const ready: string[] = [];
  for (const [node, degree] of indegree) if (degree === 0) ready.push(node);
  let processed = 0;
  while (ready.length > 0) {
    const node = ready.pop();
    if (node === undefined) break;
    processed += 1;
    for (const dependency of edges.get(node) ?? []) {
      const next = (indegree.get(dependency) ?? 0) - 1;
      indegree.set(dependency, next);
      if (next === 0) ready.push(dependency);
    }
  }
  return processed === indegree.size;
}

/**
 * The single supported input kind resolved through its owning read. Everything
 * else — other object types, other reference strengths, unknown namespaces and
 * every `ExternalRef` form — is `UNSUPPORTED`; the only distinction kept is
 * whether an `ExternalRef` was even bound to a tenant/account, because an
 * unbound one was never an executable input fact in the first place (§16.3).
 */
async function observeInputs(
  inputRefs: readonly unknown[],
  ports: ReadinessPlanningPorts,
): Promise<readonly InputObservation[]> {
  const observations: InputObservation[] = [];
  for (const element of inputRefs) {
    const inputRef = element as CanonicalJsonObject;
    const value = record(element);
    const supported =
      value.kind === 'CONTENT_ADDRESSED' &&
      value.objectType === SUPPORTED_INPUT_OBJECT_TYPE &&
      typeof value.objectId === 'string' &&
      isUuidV7(value.objectId) &&
      value.contentHash !== undefined &&
      exactProjectScope(value.scope) !== undefined;
    if (!supported) {
      observations.push({ inputRef, resolution: 'UNSUPPORTED', validUntil: null });
      continue;
    }
    // An owning read that cannot answer is a dependency failure, never an
    // empty, stale or satisfied answer: the observation is not written and the
    // whole command fails closed.
    let resolution: TaskReadinessInputRefResolution;
    try {
      resolution = await ports.inputRefs.resolveInputRef({ inputRef });
    } catch {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'the owning input reference read is unavailable',
      );
    }
    observations.push({
      inputRef,
      resolution: resolution.status,
      validUntil: resolution.status === 'USABLE' ? (resolution.validUntil ?? null) : null,
    });
  }
  return observations;
}

/** The reason codes of §17.6; they stay upper-snake and never become error codes. */
function inputReasonCode(observation: InputObservation): string | undefined {
  if (observation.resolution === 'EXPIRED') return 'INPUT_REF_EXPIRED';
  if (observation.resolution === 'REVOKED') return 'INPUT_REF_REVOKED';
  if (observation.resolution !== 'UNSUPPORTED') return undefined;
  const value = record(observation.inputRef);
  return typeof value.system === 'string' && value.tenantOrAccountRef === undefined
    ? 'INPUT_REF_EXTERNAL_UNBOUND'
    : 'INPUT_REF_UNSUPPORTED_KIND';
}

function dependencyCheckRow(observation: DependencyObservation): ReadinessCheckRow {
  const outcome =
    observation.completionUseStatus === 'USABLE'
      ? 'SATISFIED'
      : observation.completionUseStatus === 'STALE'
        ? 'STALE'
        : 'UNSATISFIED';
  const reasonCode = DEPENDENCY_REASON_BY_STATUS[observation.completionUseStatus];
  return {
    checkCode: 'DEPENDENCY_SATISFIED',
    outcome,
    factRefs: [observation.taskRef],
    reasonCodes: reasonCode === '' ? [] : [reasonCode],
  };
}

function inputCheckRow(observation: InputObservation): ReadinessCheckRow {
  const outcome =
    observation.resolution === 'USABLE'
      ? 'SATISFIED'
      : observation.resolution === 'UNSUPPORTED'
        ? 'UNSUPPORTED'
        : 'STALE';
  const reasonCode = inputReasonCode(observation);
  return {
    checkCode: 'INPUT_REF_RESOLVED',
    outcome,
    factRefs: [observation.inputRef],
    reasonCodes: reasonCode === undefined ? [] : [reasonCode],
  };
}

/**
 * §17.5 step 6: the blocker set is derived from owning facts and is never
 * caller-controlled. The blocking `information_request` producer is not
 * delivered, so no committed fact can currently be a blocker; the branch stays
 * `NOT RUN` until that owning slice exists, and the check row below is still
 * emitted so a judgement always carries the complete required check set.
 */
function collectBlockers(): readonly CanonicalJsonObject[] {
  return [];
}

function blockerCheckRow(blockers: readonly CanonicalJsonObject[]): ReadinessCheckRow {
  return {
    checkCode: 'NO_BLOCKING_INFORMATION_REQUEST',
    outcome: blockers.length === 0 ? 'SATISFIED' : 'UNSATISFIED',
    factRefs: blockers,
    reasonCodes: blockers.length === 0 ? [] : ['BLOCKING_INFORMATION_REQUEST_UNRESOLVED'],
  };
}

export interface ReadinessObservationInput {
  readonly repository: TaskReadinessRepository;
  readonly trx: TaskExecutionTransaction;
  readonly subject: TaskGraphNodeRow;
  /** The Task spelling of the major that created the subject (R-206-1). */
  readonly expectedObjectType: string;
  readonly scope: ReadinessScope;
  readonly ports: ReadinessPlanningPorts;
}

/**
 * Runs §17.5 steps 3–6 for one Task and returns the closed observation set.
 * Both entries call this: the producer binds it into the judgment payload, the
 * consumer re-derives it at the commit point and requires field-by-field
 * equality, so no observation can be "repaired in place".
 */
export async function observeReadiness(
  input: ReadinessObservationInput,
): Promise<ReadinessPlanOutcome> {
  const dependencies = readDependencyRefs(
    input.subject.dependencyTaskRefs,
    input.expectedObjectType,
    input.scope,
    input.subject.taskId,
  );
  if (dependencies === undefined) {
    return {
      outcome: 'REJECTED',
      errorCode: 'EXECUTION_DEFINITION_REF_INVALID',
      safeSummary:
        'the stored dependency set is not the exact version-bound Task references of this Scope',
    };
  }
  const acyclic = await dependencySubgraphIsAcyclic(
    input.repository,
    input.trx,
    input.subject.taskId,
    dependencies.map((dependency) => dependency.taskId),
  );
  if (!acyclic) {
    return {
      outcome: 'REJECTED',
      errorCode: 'EXECUTION_TASK_DEPENDENCY_CYCLE',
      safeSummary: 'the Task and its transitive dependencies do not form an acyclic graph',
    };
  }
  const dependencyRows = await input.repository.readTaskGraphNodes(
    input.trx,
    dependencies.map((dependency) => dependency.taskId),
  );
  const rowByTaskId = new Map(dependencyRows.map((row) => [row.taskId, row]));
  const dependencyObservations = await Promise.all(
    dependencies.map(async (dependency) => {
      const row = rowByTaskId.get(dependency.taskId),
        observation = dependencyObservation(dependency, row);
      if (row?.status !== 'COMPLETED' || !input.ports.completion) return observation;
      const current = await input.ports.completion.read(dependency.ref);
      return {
        ...observation,
        completionEvaluationRef: current.evaluationRef,
        completionUseStatus:
          current.useStatus === 'USABLE' ? ('USABLE' as const) : ('STALE' as const),
        completionValidUntil: current.validUntil,
      };
    }),
  );

  const declaredInputs = input.subject.definitionInputRefs;
  const inputObservations = Array.isArray(declaredInputs)
    ? await observeInputs(declaredInputs, input.ports)
    : [];

  const blockers = collectBlockers();
  const checks: ReadinessCheckRow[] = [
    ...dependencyObservations.map(dependencyCheckRow),
    ...inputObservations.map(inputCheckRow),
    blockerCheckRow(blockers),
  ];
  return {
    outcome: 'PLANNED',
    dependencies: dependencyObservations,
    inputs: inputObservations,
    blockers,
    checks,
    ready: checks.every((check) => check.outcome === 'SATISFIED'),
  };
}
