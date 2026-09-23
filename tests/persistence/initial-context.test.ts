// IM-06 (#216, #217 corrections): real PostgreSQL acceptance for the initial
// Context Snapshot build (`execution.build_initial_context_snapshot@1.1`) and
// the authoritative snapshot read (`execution.get_context_snapshot@1.0`) — the
// executable evidence for the TE-214-D-001…018 matrix (Module-Test-003 §"首次
// Context 构建与精确快照读取设计矩阵", Spec 003 §19, Spec 001 §15.8, approved
// #214 design, PostgreSQL §33 V3004) and for the TE-217-D-001…004 correction
// matrix (Spec 003 §20, Spec 001 §15.9, PostgreSQL §35; the PR #217 review
// findings: the import-only legacy compatibility store, the separately
// authorized DRAFT dependency read, the strict `ContextSnapshotBuilt@1.1`
// event, and the §20.4 Source Slice total order).
//
// Every positive and negative path enters through the composition entry in
// `@zhiju/api/composition` (`createInitialContextEntry`) — the same boundary a
// transport uses: the complete registered Envelope is validated for its exact
// version (`...@1.0` has no approved authorization binding and is refused before
// any Decision read), the presented AuthorizationDecision is revalidated
// through the owning IdentityPolicy Context Snapshot Port *before* the
// TaskExecution idempotency claim and before any read fact is returned, and the
// owning TaskExecution handler runs in one owning transaction whose Policy
// resolution and Source Slice reads re-enter through their own owning entries
// under fresh Decisions. The WorkOrder DRAFT facts come from the owning
// `execution.create_work_order` entry, the Tasks from `execution.create_task`,
// the Source Slices from the owning `project.capture_context_source_slice`
// entry, the EnterpriseFacts from the owning EnterpriseProject commands, and
// the Policy versions from `identity.record_policy_version@1.0`; nothing under
// test is stubbed.
//
// Row → test map, with the layer where each rejection is actually observed:
//
//   TE-214-D-001  'pairs the build version with the DRAFT major'   (entry binding;
//                                                             owning handler)
//   TE-214-D-002  'closes the exact draft snapshot reference'      (registered Envelope;
//                                                             owning handler; V3003 owner-SQL
//                                                             closures for the draft pointer and
//                                                             the non-DRAFT Root)
//   TE-214-D-003  'assembles the deterministic golden payload'     (owning handler + V3004;
//                                                             unit re-run of the owning
//                                                             assembly on the real committed
//                                                             facts)
//   TE-214-D-004  'fails closed on every source/policy counter-example' (owning reads;
//                                                             owning handler; owning assembly)
//   TE-214-D-005  'fails closed on unavailable dependencies'       (composition entry;
//                                                             no PENDING residue)
//   TE-214-D-006  'executes the §11.2.5.4 expiry matrix'           (registered Envelope;
//                                                             owning handler; expiry binding)
//   TE-214-D-007  'refuses principal and Decision substitution'    (decision boundary;
//                                                             IdentityPolicy Port)
//   TE-214-D-008  'revalidates before claim and historical replay' (IdentityPolicy Port)
//   TE-214-D-009  'scopes idempotency to one build'                (command runner)
//   TE-214-D-010  'resolves concurrent builds'                     (owning handler + V3004
//                                                             scope-unique identity)
//   TE-214-D-011  'rolls back injected faults'                     (command runner)
//   TE-214-D-012  'rejects direct forgery at the database'         (V3004 guards, ACL, RLS)
//   TE-214-D-013  'records the migration facts'                    (V3004 applied objects)
//   TE-214-D-014  'returns the exact committed snapshot'           (owning query handler)
//   TE-214-D-015  'authorizes the snapshot read separately'        (IdentityPolicy read Port)
//   TE-214-D-016  'keeps the published surface unchanged'          (Registry/Catalog; Outbox)
//   TE-214-D-017  'executes the DRAFT inputRefs matrix'            (owning assembly through
//                                                             the entry; unit for the
//                                                             schema-closed branches)
//   TE-214-D-018  'closes targetScope.targetObjectRefs to ∅'       (owning WorkOrder
//                                                             creation scope closure;
//                                                             owning assembly)
//   TE-217-D-001  'reads the imported legacy snapshot by its original identity'
//                                                             (controlled owner-role import;
//                                                             owning query handler §20.1
//                                                             route 2; V3004 legacy ACL/RLS)
//   TE-217-D-002  'authorizes the DRAFT dependency read on its own grant'
//                                                             (IdentityPolicy §15.9 DRAFT
//                                                             dependency-read Port, before
//                                                             any DRAFT fact read/lock)
//   TE-217-D-003  'validates the complete ContextSnapshotBuilt@1.1 envelope'
//                                                             (ContractRegistry strict
//                                                             validation; Outbox row mirrors)
//   TE-217-D-004  'determinizes the Source Slice total order'      (owning assembly
//                                                             §20.4, unit layer on the
//                                                             real committed facts)
//
// NOT RUN inventory and observed-layer notes (no PASS is inferred from other
// green tests; every disagreement with the design-matrix expectation is
// reported, not hidden):
//
//   * TE-214-D-002 "expired DRAFT" — the commit-point WorkOrder expiry
//     re-check (safeSummary 'the owning WorkOrder creation expiry has passed')
//     is UNREACHABLE by legal facts: `work_order.expires_at` always equals the
//     bound draft snapshot's own `expiresAt` member, so the expiry binding
//     (CONTEXT_EXPIRED → AGGREGATE_STATE_NOT_ALLOWED, safeSummary 'the initial
//     Context expiry binding does not close') fires one step earlier on the
//     same bound, and V3003's root-update guard makes `expires_at` immutable
//     (23514). This row asserts the binding-layer rejection plus the column
//     immutability closure instead (the wi212 TE-P210-006 convention) and never
//     claims the unreachable handler branch.
//   * TE-214-D-002 "指针已前进" — a second DRAFT pointer generation is
//     UNREACHABLE by legal facts: V3003's snapshot creation-identity guard
//     requires the Root pointer to already name the inserted snapshot (22023),
//     and the Root update guard rejects a pointer move without an aggregate
//     version advance (23514) and a move to a snapshot that does not resolve
//     (23514) — the two guards close each other, so no committed WorkOrder can
//     ever point anywhere but at its creation snapshot (the wi212 TE-P210-017b
//     evidence). This row asserts both closures and executes the reachable
//     staleness branch (non-DRAFT Root) through owner SQL instead of claiming
//     the unreachable pointer mismatch.
//   * TE-214-D-003 wrong-hash slice ref — OBSERVED DISAGREEMENT: the owning EP
//     read reports a hash mismatch as PROJECT_QUERY_REF_INVALID (not
//     PROJECT_QUERY_NOT_FOUND), the composition entry rethrows it instead of
//     mapping it to a missing Slice, and the owning handler maps the port throw
//     onto a thrown DEPENDENCY_UNAVAILABLE — not the matrix's rejected
//     EXECUTION_CONTEXT_SOURCE_INVALID. The test asserts the observed behavior
//     and this disagreement is reported in the Issue evidence. Wrong id,
//     wrong Scope and wrong kind keep the matrix's codes.
//   * TE-214-D-005: a dead TaskExecution pool surfaces the raw pg driver error
//     from the composition boundary (no stable module code); asserted as thrown
//     plus Receipt ABSENT. The IdentityPolicy-pool and EnterpriseProject-pool
//     branches keep DEPENDENCY_UNAVAILABLE.
//   * TE-214-D-008/015 "过期 Decision": the matrix's AUTHORIZATION_EXPIRED is
//     executed with the entry's trusted clock moved past the Port's 300-second
//     TTL; a Decision already expired under the real wall clock is refused one
//     layer earlier by `platform_security.establish_transaction_context`
//     (22023) and surfaces as a thrown DEPENDENCY_UNAVAILABLE — fail-closed
//     either way, but not the matrix's code.
//   * TE-214-D-008 "Policy 取代" of the grant Policy Snapshot: no delivered
//     writer for `policy_snapshot.superseded_at` exists in this slice, so the
//     POLICY_NOT_CURRENT/GRANT-policy revalidation branch stays NOT RUN here
//     (the owning Port's unit tests cover it); the Builder Policy *version*
//     succession branch is executed in TE-214-D-004 (POLICY_EXPIRED).
//   * TE-214-D-010 "Builder 与 Freeze/WorkOrder transition 竞争": neither a
//     Freeze nor a WorkOrder status-transition operation is delivered in this
//     slice (V3003 leaves the status column movable but no owning transition
//     handler exists), so the two-order race stays NOT RUN; the draft-pointer
//     half of the race is the unreachable-by-construction branch whose database
//     closures TE-214-D-002 asserts.
//   * TE-214-D-010 same-Envelope race — transient-escape convention (PR #217
//     round-5 CI failure, round-6/7 reviews): the §19.8(3) claim protocol
//     admits exactly one COMMITTED plus one DUPLICATE/COMMAND_IN_PROGRESS,
//     and the concurrent pair itself must produce it — no serial recovery
//     replay is accepted as race evidence. A thrown error outside that
//     protocol invalidates the attempt only when it is *positively
//     identified* as infrastructure (`isInfrastructureFailure`: a Node errno,
//     a pg driver connection-lifecycle message, or a connection /
//     operator-intervention SQLSTATE); the pair is then re-driven under a
//     fresh Envelope identity (at most three attempts). A fulfilled result
//     outside the protocol, a thrown stable module/authorization code, an
//     unclassified throw, a double COMMITTED, or a third consecutive escape
//     fails closed with every attempt's exteriors attached; the
//     never-more-than-one Snapshot row invariant is asserted for every
//     attempt, valid or invalidated.
//   * TE-214-D-013: the empty-database apply, the historical forward upgrade,
//     the no-op second migrate and the V6002 seed are the persistence gate's
//     own evidence (tools/persistence); this row asserts the on-database facts
//     (triggers, policies, RLS flags, flyway history) only.
//   * TE-214-D-017: the fully-identical duplicate inputRef pair (uniqueItems)
//     and the off-table `epistemicExpectation` are closed by the registered
//     WorkOrder creation Schema before any draft exists, so those two branches
//     run against the owning assembly directly with the real committed slice
//     payloads (unit layer); every other branch enters through the composition
//     entry.
//   * TE-214-D-018 "foreign-Scope targetObjectRef": a foreign-Scope ref never
//     reaches the build through legal facts — the owning WorkOrder creation's
//     own scope closure rejects the draft one layer earlier (rejected
//     EXECUTION_WORK_ORDER_SCOPE_INVALID, not the matrix's
//     EXECUTION_CONTEXT_TARGET_INVALID). The row asserts that observed layer
//     and runs the assembly's EXECUTION_CONTEXT_TARGET_INVALID branch at the
//     unit layer on the real committed facts (the TE-214-D-017 convention).
//   * TE-214-D-004 "Builder Policy hash 不符": no legal fact can produce it —
//     the content hash is recomputed by the owning `identity.resolve_policy@1.0`
//     read from the immutable version row, and a direct rewrite is the 42501
//     closure asserted in TE-214-D-012. The constructible binding failures
//     (POLICY_REF_MISMATCH, POLICY_EXPIRED, POLICY_NOT_EFFECTIVE,
//     INVALID_POLICY_BINDING) are all executed.
//
// #217 corrections — the TE-214-D rows whose facts the corrections changed
// (re-executed green in this suite; the matrix keeps the historical texts):
//
//   * TE-214-D-002 "wrong-scope": the foreign-Scope `draftSnapshotRef` is now
//     refused one layer earlier — the §15.9 DRAFT dependency-read Port binds
//     the *complete* ref and its Scope check fails before any TaskExecution
//     DRAFT row is read or locked, so the case surfaces as a thrown
//     IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID with the Receipt ABSENT (the
//     pre-#217 surface was the handler's rejected REFERENCE_INVALID). Fail
//     closed either way; the new layer is the designed one (Spec 001 §15.9(3)).
//   * TE-214-D-003/016: the single registered Outbox row is now
//     `execution.ContextSnapshotBuilt@1.1` (the @1.0 event stays registered
//     and frozen but is no longer emitted), and the stored payload is exactly
//     six keys — the closed four public members plus the runner's
//     `enterpriseId`/`projectId` Scope mirrors (§20.3). The §20.4 seven-member
//     total order supersedes the §19.4 item 1 tuple in the sort assertion.
//   * TE-214-D-014: the legacy `zhiju.project.context_snapshot` spelling no
//     longer fails by spelling — §20.1 route 2 serves it from the import-only
//     `context_snapshot_legacy` store, so the row now executes the controlled
//     import plus the verbatim read-back the matrix's expectation column
//     always described, and keeps the store-miss REFERENCE_INVALID for an
//     identity the legacy store does not hold.
//   * TE-217-D-002 layering note: the DRAFT dependency-read Port binds the
//     complete `draftSnapshotRef` into its Decision, but only the owning
//     TaskExecution store can answer *existence* — a substituted object id or
//     content hash therefore passes the Port and fails one step later as the
//     handler's by-identity REFERENCE_INVALID (with its own fresh DRAFT-read
//     Decision, never the build Decision). The matrix's "DRAFT repository
//     call count 0" is asserted for the grant/scope/shape cases at the
//     composition layer (zero new TaskExecution facts and zero new
//     DRAFT-purpose Decisions); the content-substitution pair is reported at
//     its observed layer instead of being claimed at the Port.
//   * TE-217-D-001 contract closure (round 4): the legacy mirror guard now
//     also closes the historical contract columns — `project_context_contract`
//     must not differ from the hashed canonical payload, and `contract_ref`
//     must name exactly the recomputed cv1 address of that body (kind
//     CONTENT_ADDRESSED, objectType `zhiju.contract.project_context`, objectId
//     equal to the Snapshot identity, the row's Project Scope, the
//     SHA-256/'1'/lowercase-hex digest triple). Every violation is the same
//     guard 22023, so a closure-violating row is unwritable and the read
//     boundary's own recomputation can never observe one (the "no legal fact
//     producer" convention); the row runs the one-member tampers at the
//     guard — the round-4 nine (body/digest/object identity/scope/kind/
//     algorithm/cv), extended in round 5 by the four member-set tampers of
//     the registered `contentAddressedRef` shape the guard now enforces:
//     `contract_ref` root exactly {contentHash, kind, objectId, objectType,
//     scope}, `scope` exactly {enterpriseId, projectId}, `contentHash`
//     exactly {algorithm, canonicalizationVersion, digest} — so an unknown
//     member at any level, and even a schema-legal `immutableVersionId`, are
//     the same guard 22023 (the read boundary revalidates the stored ref
//     against the registered schema and forbids `immutableVersionId` too, but
//     no violating row is writable). The
//     wrongHash/wrongScope/rlsDenied/wrongObjectType/emptyProvenance
//     fixtures close their `contract_ref` against their own case identity, so
//     the closure each case targets still fires its own code.
//   * Round-4 gate finding (timeout cascade): a timed-out test is abandoned,
//     not cancelled — its in-flight commands kept writing to the shared
//     database and the next test observed the late rows (017→002). The suite
//     now registers every test through `itIntegration` (60s timeout, ~15x the
//     slowest local test) and routes every command driver through the
//     quiescence harness (tracked promise set + afterEach drain), so an
//     abandoned test's late writes always settle before the next test starts.
//     (Vitest's aroundEach region includes the afterEach hooks, so the drain
//     cannot await the test body itself; it tracks the drivers instead.)

import { verifyWorkOrderValidationGuards } from './work-order-validation-guards.js';
import { verifyWorkOrderValidationUpgrade } from './work-order-validation-upgrade.js';
import {
  createWorkOrderValidationEntry,
  createTaskReadinessEntry,
  createControlledFirstRunEntry,
} from '@zhiju/api/composition';
import {
  CONTROLLED_FIRST_RUN_BINDINGS,
  createControlledFirstRunAuthorizationPort,
  WORK_ORDER_VALIDATION_BINDINGS,
  createWorkOrderValidationAuthorizationPort,
  createTaskExecutionReadinessAuthorizationPort,
  type WorkOrderValidationCapabilityCodes,
  type ControlledFirstRunCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import {
  workOrderReadyProfileRegistry,
  registeredEvaluatorProfileReference,
} from '@zhiju/contracts';
import { withTaskExecutionTransaction } from '@zhiju/task-execution';
import { hashContractPayload, sha256CanonicalJson } from '@zhiju/shared-kernel';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql, type Kysely } from 'kysely';
import {
  createContextSourceSliceEntry,
  createCreateTaskEntry,
  createInitialContextEntry,
  createWorkOrderDraftEntry,
  type ContextSourceSliceEntry,
  type ContextSourceSliceSession,
  type CreateTaskEntry,
  type InitialContextCapabilityCodes,
  type InitialContextEntry,
  type InitialContextSession,
  type WorkOrderDraftEntry,
} from '@zhiju/api/composition';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  createTaskExecutionContextSnapshotAuthorizationPort,
  createTaskExecutionCreationAuthorizationPort,
  grantCapability,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  recordPolicyVersion,
  revokeCapability,
  withIdentityTransaction,
  type ActorSnapshotRef,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
  type TaskExecutionContextSnapshotCapabilityCodes,
  type TaskExecutionCreationCapabilityCodes,
  type WorkOrderDraftReadCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  handleConfirmEnterpriseFact,
  handleCreateEnterprise,
  handleCreateProject,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseQmsCreateRevision,
  handleProposeEnterpriseFact,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  AGGREGATE_STATE_NOT_ALLOWED,
  API_VALUE_INVALID,
  COMMAND_IN_PROGRESS,
  CONCURRENCY_CONFLICT,
  createTaskExecutionDatabase,
  DEPENDENCY_UNAVAILABLE,
  digestCanonicalPayload,
  EXECUTION_CONTEXT_INPUT_REQUIRED,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  EXECUTION_CONTEXT_TARGET_INVALID,
  EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
  EXECUTION_DRAFT_SNAPSHOT_STALE,
  EXECUTION_WORK_ORDER_SCOPE_INVALID,
  executeTaskExecutionCommand,
  assembleInitialContext,
  buildInitialContextIdempotencyScope,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  POLICY_EXPIRED,
  POLICY_NOT_EFFECTIVE,
  REFERENCE_INVALID,
  TASK_DRAFT_CREATION_BINDINGS,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import {
  ContractRegistry,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
  type EnterpriseProject,
  type IntegrationGateway,
} from '@zhiju/contracts';
import { canonicalize, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi216_probe';
const PROBE_PASSWORD = 'im06-wi216-probe';

const OPERATOR = 'cc01cc01-cc01-7c01-8c01-cc01cc01cc01';
const OPERATOR_ACTOR = 'cc02cc02-cc02-7c02-8c02-cc02cc02cc02';
const OTHER_PRINCIPAL = 'cc03cc03-cc03-7c03-8c03-cc03cc03cc03';
const OTHER_ACTOR = 'cc04cc04-cc04-7c04-8c04-cc04cc04cc04';
const REQUEST_DECISION = 'cc05cc05-cc05-7c05-8c05-cc05cc05cc05';
const CORRELATION = 'cc06cc06-cc06-7c06-8c06-cc06cc06cc06';
const AUTH_CONTEXT_ID = 'cc07cc07-cc07-7c07-8c07-cc07cc07cc07';

const AUTH_HASH = Buffer.alloc(32, 0x75);
const OTHER_AUTH_HASH = Buffer.alloc(32, 0x76);
const DECISION_HASH = Buffer.alloc(32, 0x77);

/**
 * Trusted composition capability codes of the two Context Snapshot entries
 * plus the §15.9 DRAFT dependency-read entry of the build.
 */
const contextSnapshotCapabilityCodes: InitialContextCapabilityCodes = {
  contextSnapshotBuildV11: 'wi216.cap.ctxbuild.v1_1',
  contextSnapshotRead: 'wi216.cap.ctxread',
  contextSnapshotDraftReadV11: 'wi216.cap.ctxdraftread',
};

/** Capability codes of the two owning reads the build re-enters through. */
const dependencyCapabilities = {
  resolvePolicy: 'wi216.cap.resolve',
  readContextSourceSlice: 'wi216.cap.sliceread',
} as const;

const CAPTURE_CAPABILITY = 'wi216.cap.capture';
const RECORD_CAPABILITY = 'wi216.cap.record';

const creationCapabilityCodes: TaskExecutionCreationCapabilityCodes = {
  taskV1: 'wi216.cap.task.v1',
  taskV2: 'wi216.cap.task.v2',
  workOrderV1: 'wi216.cap.workorder.v1',
  workOrderV11: 'wi216.cap.workorder.v1_1',
};

const draftReadCapabilityCodes: WorkOrderDraftReadCapabilityCodes = {
  workOrderDraftReadV11: 'wi216.cap.draftread.v1_1',
  workOrderDraftReadV2: 'wi216.cap.draftread.v2',
};

const ACTIONS = {
  taskV1: 'execution.task.create.v1',
  taskV2: 'execution.task.create.v2',
  workOrderV1: 'execution.work_order.create.v1',
  workOrderV11: 'execution.work_order.create.v1_1',
  ctxBuild: 'execution.context.build.initial.v1_1',
  ctxRead: 'execution.context.snapshot.read',
  ctxDraftRead: 'execution.work_order.draft_snapshot.read.for_context_build.v1_1',
} as const;

const TASK_V1 = 'execution.task';
const TASK_V2 = 'zhiju.execution.task';
const WORK_ORDER_V1 = 'execution.work_order';
const WORK_ORDER_V11 = 'zhiju.execution.work_order';
const CONTEXT_SNAPSHOT_OBJECT = 'zhiju.execution.context_snapshot';
const CONTEXT_SNAPSHOT_LEGACY_OBJECT = 'zhiju.project.context_snapshot';
const DRAFT_SNAPSHOT_OBJECT = 'zhiju.execution.work_order_draft_snapshot';
const SLICE_OBJECT = 'zhiju.project.context_source_slice';
const POLICY_OBJECT = 'zhiju.identity.policy';
const ACTOR_SNAPSHOT_OBJECT = 'identity.actor_snapshot';
const PRINCIPAL_OBJECT = 'zhiju.identity.principal';
const AUTH_CONTEXT_OBJECT = 'zhiju.identity.authentication_context';

const BUILD_COMMAND = 'execution.build_initial_context_snapshot';
const BUILD_VERSION = '1.1';
const READ_QUERY = 'execution.get_context_snapshot';
const READ_VERSION = '1.0';

const BUILDER_PROFILE = 'execution.context_builder.policy@1.0';
const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';
const PAST = new Date('2026-01-01T00:00:00.000Z');

const PURPOSE_DOCUMENT = 'document.write';
const PURPOSE_FORM = 'record.form.read';
const PURPOSE_REVIEW = 'review.read';
// The registered capture Schema takes the canonical lowercase kind spellings
// (the entry translates them onto the owning uppercase identifiers);
// active_baselines stays unrequested so every slice carries the
// KIND_NOT_REQUESTED omission this suite's coverage assertions rely on.
const SLICE_KINDS = [
  'project',
  'enterprise_profile',
  'qms_configuration',
  'product_scope',
  'enterprise_facts',
];

/** Builder Policy identities (Policy object id / key version id). */
const BUILDER_POLICY = {
  main: ['cc10cc10-cc10-7c10-8c10-cc10cc10cc10', 'cc20cc20-cc20-7c20-8c20-cc20cc20cc20'],
  noProjection: ['cc11cc11-cc11-7c11-8c11-cc11cc11cc11', 'cc21cc21-cc21-7c21-8c21-cc21cc21cc21'],
  wrongProfile: ['cc12cc12-cc12-7c12-8c12-cc12cc12cc12', 'cc22cc22-cc22-7c22-8c22-cc22cc22cc22'],
  future: ['cc13cc13-cc13-7c13-8c13-cc13cc13cc13', 'cc23cc23-cc23-7c23-8c23-cc23cc23cc23'],
  supersededFirst: ['cc14cc14-cc14-7c14-8c14-cc14cc14cc14', 'cc24cc24-cc24-7c24-8c24-cc24cc24cc24'],
  successor: ['cc14cc14-cc14-7c14-8c14-cc14cc14cc14', 'cc25cc25-cc25-7c25-8c25-cc25cc25cc25'],
  alt: ['cc16cc16-cc16-7c16-8c16-cc16cc16cc16', 'cc26cc26-cc26-7c26-8c26-cc26cc26cc26'],
} as const;

/** Capture Policy identities of the Source Slice fixtures. */
const CAPTURE_POLICY = {
  main: ['cc30cc30-cc30-7c30-8c30-cc30cc30cc30', 'cc40cc40-cc40-7c40-8c40-cc40cc40cc40'],
  ttl: ['cc31cc31-cc31-7c31-8c31-cc31cc31cc31', 'cc41cc41-cc41-7c41-8c41-cc41cc41cc41'],
  revokedFirst: ['cc32cc32-cc32-7c32-8c32-cc32cc32cc32', 'cc42cc42-cc42-7c42-8c42-cc42cc42cc42'],
  successor: ['cc32cc32-cc32-7c32-8c32-cc32cc32cc32', 'cc43cc43-cc43-7c43-8c43-cc43cc43cc43'],
} as const;

const POLICY_SNAPSHOT_ID = 'cc50cc50-cc50-7c50-8c50-cc50cc50cc50';

const V1_TASK_FIXTURE = new URL(
  '../fixtures/contracts/execution-create-task-command-valid.json',
  import.meta.url,
);
const V2_TASK_FIXTURE = new URL(
  '../fixtures/contracts/task-v2/create-task-v2-command-valid.json',
  import.meta.url,
);
const WORK_ORDER_CONTRACT_FIXTURE = new URL(
  '../fixtures/contracts/core/work-order-valid.json',
  import.meta.url,
);
const PUBLIC_API_CATALOG = new URL('../../contracts/registry/public-api.v1.json', import.meta.url);
const COMPATIBILITY_BASELINE = new URL(
  '../../contracts/baselines/v1.0/operations.index.json',
  import.meta.url,
);

interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7c)).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed');
      },
      decryptField() {
        throw new Error('not needed');
      },
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectRef(objectType: string, objectId: string, scope: Record<string, string>) {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

function payloadOf(url: URL): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { payload: Record<string, unknown> };
  return structuredClone(fixture.payload);
}

/** Rewrites every `scope` inside a published fixture onto this suite's Project. */
function rewriteFixtureScopes(value: unknown, fixture: Fixture): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteFixtureScopes(item, fixture);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'scope' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      node[key] =
        'projectId' in (child as Record<string, unknown>)
          ? { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId }
          : { enterpriseId: fixture.enterpriseId };
      continue;
    }
    rewriteFixtureScopes(child, fixture);
  }
}

function failureOf(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : String(error),
  };
}

/**
 * Positive identification of an infrastructure-layer failure (the PR #217
 * round-7 review): only a failure the layer can *prove* is infrastructure —
 * a Node errno of the OS/network layer, a pg client-side connection lifecycle
 * error (the driver emits no `code` for those, so the driver's own message
 * prefix identifies them), or a SQLSTATE of the connection-exception class
 * 08, the operator-intervention 57P0x, or the resource-capacity 53300/53400 —
 * may invalidate a concurrent attempt. Every stable module, boundary or
 * authorization code (words, never errno/SQLSTATE shapes, so a typed error
 * can never pass this identification) and every unclassified throw is a
 * defect and fails the test closed instead.
 */
const INFRASTRUCTURE_ERRNO = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);
const INFRASTRUCTURE_SQLSTATE = /^(?:08[0-9A-Z]{3}|57P0[1-3]|53300|53400)$/u;
const INFRASTRUCTURE_DRIVER_MESSAGE =
  /^(?:Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error)/u;

function isInfrastructureFailure(error: unknown): boolean {
  const { code, message } = failureOf(error);
  if (INFRASTRUCTURE_ERRNO.has(code) || INFRASTRUCTURE_SQLSTATE.test(code)) return true;
  return code === '' && INFRASTRUCTURE_DRIVER_MESSAGE.test(message);
}

function resultCode(result: CommandResult): string {
  if (result.status === 'REJECTED') return result.errorCode;
  if (result.status === 'DUPLICATE') return result.errorCode ?? 'DUPLICATE';
  return 'COMMITTED';
}

function profileReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

/** The exact VERSIONED key of one Project-scoped registered Policy version. */
function policyKey(pair: readonly [string, string], fixture: Fixture): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: POLICY_OBJECT,
    objectId: pair[0],
    versionId: pair[1],
    scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
  } as unknown as Common.VersionedRef;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describe.skipIf(!gateEnabled)('initial Context Snapshot build and read (real PostgreSQL)', () => {
  const crypto = testCrypto();
  const registry = new ContractRegistry();
  let admin: pg.Client;
  let probeUrl: string;
  let tePool: pg.Pool;
  let ipPool: pg.Pool;
  let epPool: pg.Pool;
  let teDb: Kysely<TaskExecutionDb>;
  let identityDb: Kysely<IdentityPolicyDb>;
  let enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  let identityRepo: IdentityPolicyRepository;
  let fixture: Fixture;
  let clock: number;
  let grantPolicyHash: Buffer;
  let operatorActorRef: ActorSnapshotRef;
  let otherActorRef: ActorSnapshotRef;
  let initialContextEntry: InitialContextEntry;
  let workOrderEntry: WorkOrderDraftEntry;
  let taskEntry: CreateTaskEntry;
  let sliceEntry: ContextSourceSliceEntry;
  let sliceSession: ContextSourceSliceSession;
  let grantCtxBuild: string;
  let grantCtxRead: string;
  let grantCtxDraftRead: string;
  let grantResolve: string;
  let grantSliceRead: string;
  let sliceARef: Common.ContentAddressedRef;
  let sliceBRef: Common.ContentAddressedRef;
  let sliceCRef: Common.ContentAddressedRef;
  let sliceTTLRef: Common.ContentAddressedRef;
  let sliceRevokedRef: Common.ContentAddressedRef;
  let sliceMixRef: Common.ContentAddressedRef;
  let factA1: { objectId: string; versionId: string };
  let factA2: { objectId: string; versionId: string };
  let goldenWorkOrderId: string;
  let goldenDraftRef: Common.ContentAddressedRef;

  /**
   * One integration-test timeout with clear CI headroom (PR #217 round-4
   * finding: the Vitest default of 5s timed the DRAFT matrix out on the
   * shared runner; the slowest test here is ~4s locally). Applies to every
   * test of the suite through the registration wrapper below.
   */
  const INTEGRATION_TEST_TIMEOUT = 60_000;
  function itIntegration(name: string, run: () => Promise<void>): void {
    it(name, { timeout: INTEGRATION_TEST_TIMEOUT }, run);
  }

  /**
   * Cross-test quiescence harness (PR #217 round-4 finding): a test that
   * fails or times out is abandoned, not cancelled — its in-flight commands
   * keep running against the shared database and the next test observes
   * their late writes (the 017→002 receipt/audit cascade). Every command
   * driver below registers its promise here, and the afterEach drain waits
   * until nothing is in flight, so an abandoned test's late writes always
   * settle before the next test starts. (The drain cannot await the test
   * body itself: Vitest's aroundEach region includes the afterEach hooks,
   * so a body-level registration would deadlock the drain against itself.)
   */
  const pendingOperations = new Set<Promise<unknown>>();
  function track<T>(operation: Promise<T>): Promise<T> {
    pendingOperations.add(operation);
    void operation.then(
      () => pendingOperations.delete(operation),
      () => pendingOperations.delete(operation),
    );
    return operation;
  }
  /** Tracked aliases of the imported command drivers (the harness above). */
  const grantCapabilityTracked: typeof grantCapability = (...args) =>
    track(grantCapability(...args));
  const revokeCapabilityTracked: typeof revokeCapability = (...args) =>
    track(revokeCapability(...args));
  const recordPolicySnapshotTracked: typeof recordPolicySnapshot = (...args) =>
    track(recordPolicySnapshot(...args));
  const recordPolicyVersionTracked: typeof recordPolicyVersion = (...args) =>
    track(recordPolicyVersion(...args));
  const authorizeCommandTracked: typeof authorizeCommand = (...args) =>
    track(authorizeCommand(...args));
  afterEach(async () => {
    // Drain until two consecutive quiescent passes: an abandoned helper can
    // sit between two tracked drivers with its continuation not yet queued.
    let quiescentPasses = 0;
    while (quiescentPasses < 2) {
      await Promise.allSettled([...pendingOperations]);
      await new Promise((resolve) => setImmediate(resolve));
      quiescentPasses = pendingOperations.size === 0 ? quiescentPasses + 1 : 0;
    }
  }, 120_000);

  /** Uniform principal description used by every helper of this suite. */
  interface Principal {
    readonly principalId: string;
    readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE';
    readonly actorSnapshotId: string;
    readonly actorRef: ActorSnapshotRef;
    readonly authHash: Buffer;
  }

  function operator(): Principal {
    return {
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      actorRef: operatorActorRef,
      authHash: AUTH_HASH,
    };
  }

  function other(): Principal {
    return {
      principalId: OTHER_PRINCIPAL,
      principalKind: 'HUMAN',
      actorSnapshotId: OTHER_ACTOR,
      actorRef: otherActorRef,
      authHash: OTHER_AUTH_HASH,
    };
  }

  const scope = (): Record<string, string> => ({
    enterpriseId: fixture.enterpriseId,
    projectId: fixture.projectId,
  });

  function identityContext(
    allowedProjectIds: readonly string[],
    principal: Principal = operator(),
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      actorSnapshotId: principal.actorSnapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
      ...overrides,
    };
  }

  function identityDeps(
    allowedProjectIds: readonly string[],
    principal: Principal = operator(),
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityCommandDeps {
    return {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: identityContext(allowedProjectIds, principal, overrides),
    };
  }

  function runnerContext(principal: Principal = operator()): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      principalKind: principal.principalKind,
      actorSnapshotId: principal.actorRef.snapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
  }

  /**
   * The composition entry under the suite's trusted clock. `clock` is frozen in
   * `beforeAll`; cases that need a moved trusted instant pass their own `now`
   * (and mint their Decision with a Port sharing it, because the Decision TTL
   * of the internal reads is anchored to the real clock).
   */
  function entryFor(
    overrides: {
      now?: () => Date;
      capabilityCodes?: InitialContextCapabilityCodes;
      capabilities?: { resolvePolicy: string; readContextSourceSlice: string };
      taskExecutionDb?: Kysely<TaskExecutionDb>;
      enterpriseProjectDb?: Kysely<EnterpriseProjectDb>;
      identityDb?: Kysely<IdentityPolicyDb>;
    } = {},
  ): InitialContextEntry {
    return createInitialContextEntry({
      taskExecutionDb: overrides.taskExecutionDb ?? teDb,
      enterpriseProjectDb: overrides.enterpriseProjectDb ?? enterpriseProjectDb,
      identity: {
        db: overrides.identityDb ?? identityDb,
        repo: identityRepo,
        crypto,
      },
      capabilityCodes: overrides.capabilityCodes ?? contextSnapshotCapabilityCodes,
      capabilities: overrides.capabilities ?? dependencyCapabilities,
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  function sessionFor(principal: Principal = operator()): InitialContextSession {
    return {
      authenticationContextHash: principal.authHash,
      resolutionActorSnapshotRef: principal.actorRef,
    };
  }

  /** One real capability grant through the owning IdentityPolicy command. */
  async function grant(input: {
    principal?: Principal;
    capabilityCode: string;
    selectorType: 'CREATE_TARGET_TYPE' | 'TARGET_TYPE';
    targetObjectType: string;
    action: string;
    validTo?: Date;
    grantPolicySnapshot?: { id: string; hash: Buffer };
  }): Promise<string> {
    const principal = input.principal ?? operator();
    const grantId = newUuidV7();
    const result = await grantCapabilityTracked(identityDeps([fixture.projectId], principal), {
      grantId,
      principalId: principal.principalId,
      capabilityCode: input.capabilityCode,
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      resourceSelectors: [{ selectorType: input.selectorType, objectType: input.targetObjectType }],
      actions: [input.action],
      validFrom: PAST,
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      grantPolicySnapshotId: input.grantPolicySnapshot?.id ?? POLICY_SNAPSHOT_ID,
      grantPolicySnapshotHash: input.grantPolicySnapshot?.hash ?? grantPolicyHash,
      justification: 'IM-06 #216 initial Context fixture',
      idempotencyKey: `wi216:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  /** One generic capability grant (no selectors/actions closure) for the owning reads. */
  async function grantGeneric(
    capabilityCode: string,
    principal: Principal = operator(),
  ): Promise<string> {
    const grantId = newUuidV7();
    const result = await grantCapabilityTracked(identityDeps([fixture.projectId], principal), {
      grantId,
      principalId: principal.principalId,
      capabilityCode,
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      resourceSelectors: [],
      actions: [capabilityCode],
      validFrom: PAST,
      grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
      grantPolicySnapshotHash: grantPolicyHash,
      justification: 'IM-06 #216 dependency read fixture',
      idempotencyKey: `wi216:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  function grantPolicySnapshotReference(): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: POLICY_SNAPSHOT_ID,
      snapshotId: POLICY_SNAPSHOT_ID,
      scope: {},
      contentHash: contentHash(grantPolicyHash.toString('hex')),
    };
  }

  /**
   * Registers one Project-scoped Policy version fact through the owning
   * `identity.record_policy_version@1.0` entry under its own generic Decision:
   * the boundary never writes IdentityPolicy tables directly. The scope kind is
   * derived from the key, so the same helper registers the Project-scoped
   * Builder/Capture Policies of this suite.
   */
  async function registerPolicyVersionAs(input: {
    key: Common.VersionedRef;
    factId: string;
    idempotencyKey: string;
    effectiveFrom: Date;
    policySchemaRefs: readonly Common.TypedReference[];
    policyDocument: CanonicalJsonObject;
    supersedesRef?: Common.VersionedRef;
  }): Promise<void> {
    const keyScope = input.key.scope as unknown as { enterpriseId: string; projectId?: string };
    const projectScoped = keyScope.projectId !== undefined;
    const scopeValue = input.key.scope as unknown as CanonicalJsonObject;
    const payload: CanonicalJsonObject = {
      policyRef: input.key as unknown as CanonicalJsonObject,
      policySetVersion: `wi216-set-${input.idempotencyKey}`,
      policySchemaRefs: input.policySchemaRefs as unknown as CanonicalJsonObject,
      policyDocument: input.policyDocument,
      effectiveFrom: input.effectiveFrom.toISOString(),
      ...(input.supersedesRef === undefined
        ? {}
        : { supersedesRef: input.supersedesRef as unknown as CanonicalJsonObject }),
    };
    const decision = await authorizeCommandTracked(identityDeps([fixture.projectId]), {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: 'identity.record_policy_version',
        commandVersion: '1.0',
        scopeKind: projectScoped ? 'PROJECT' : 'ENTERPRISE',
        enterpriseId: fixture.enterpriseId,
        ...(projectScoped ? { projectId: fixture.projectId } : {}),
        purpose: 'identity.policy.record_policy_version',
        requestedCapability: RECORD_CAPABILITY,
        commandPayloadHash: digestCanonicalPayload(payload).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 1800,
    });
    expect(decision.outcome, JSON.stringify(decision)).toBe('ALLOW');
    const result = await recordPolicyVersionTracked(
      identityDeps(projectScoped ? [fixture.projectId] : [], operator(), {
        authorizationDecisionId: decision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          decision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(decision.expiresAt),
      }),
      {
        envelope: {
          commandId: newUuidV7(),
          commandType: 'identity.record_policy_version',
          commandVersion: '1.0',
          scopeRef: scopeValue,
          targetRef: {
            kind: 'OBJECT',
            objectType: 'zhiju.identity.policy_version',
            objectId: input.factId,
            scope: scopeValue,
          },
          actor: {
            kind: 'OBJECT',
            objectType: PRINCIPAL_OBJECT,
            objectId: OPERATOR,
            scope: scopeValue,
          },
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: decision.authorizationDecisionRef.objectId,
            scope: scopeValue,
            contentHash: decision.authorizationDecisionRef
              .contentHash as unknown as CanonicalJsonObject,
          },
          idempotencyKey: input.idempotencyKey,
          correlationId: CORRELATION,
          requestedAt: new Date().toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: {
              algorithm: 'SHA-256',
              digest: digestCanonicalPayload(payload).hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
        },
      },
    );
    expect(result).toMatchObject({ status: 'COMMITTED' });
  }

  // -----------------------------------------------------------------------
  // EnterpriseProject seed through the owning handlers (wi188 convention)
  // -----------------------------------------------------------------------

  function seedContext(
    enterpriseId: string,
    allowedProjectIds: readonly string[],
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
    };
  }

  function seedEnvelope<TPayload>(
    context: EnterpriseProjectTransactionContext,
    commandType: string,
    idempotencyKey: string,
    payload: TPayload,
    overrides: Partial<CommandEnvelope> = {},
  ): CommandEnvelope & { payload: TPayload } {
    return {
      commandId: newUuidV7(),
      commandType,
      commandVersion: '1.0',
      idempotencyScope: 'enterprise_project:wi216-seed',
      idempotencyKey,
      requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
      enterpriseId: context.enterpriseId,
      targetType: 'Unknown',
      targetId: newUuidV7(),
      correlationId: context.correlationId,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
      ...overrides,
      payload,
    };
  }

  function committedPayload(result: CommandResult): CanonicalJsonObject {
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
    }
    return result.resultPayload;
  }

  function epObjectRef<TObjectType extends string>(
    objectType: TObjectType,
    objectId: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'OBJECT',
      objectType,
      objectId,
      scope: { enterpriseId },
    } as Common.ObjectRef & { objectType: TObjectType };
  }

  function epVersionedRef<TObjectType extends string>(
    objectType: TObjectType,
    objectId: string,
    versionId: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'VERSIONED',
      objectType,
      objectId,
      versionId,
      scope: { enterpriseId },
    } as Common.VersionedRef & { objectType: TObjectType };
  }

  function epSnapshotRef<TObjectType extends string>(
    objectType: TObjectType,
    snapshotId: string,
    digest: string,
    enterpriseId: string,
  ) {
    return {
      kind: 'SNAPSHOT',
      objectType,
      objectId: snapshotId,
      snapshotId,
      scope: { enterpriseId },
      contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
    } as Common.SnapshotRef & { objectType: TObjectType };
  }

  async function seedEnterpriseProject(): Promise<Fixture> {
    const enterpriseId = newUuidV7();
    const context = seedContext(enterpriseId, []);
    const enterprise = await handleCreateEnterprise(enterpriseProjectDb, context, {
      ...seedEnvelope(context, 'project.create_enterprise', 'wi216-enterprise', {
        displayCode: 'WI216',
        displayName: 'WI-216 initial Context fixture',
        initialStatus: 'ACTIVE' as const,
      }),
      enterpriseId,
      targetType: 'Enterprise',
      targetId: enterpriseId,
    });
    expect(enterprise.status).toBe('COMMITTED');

    const product = committedPayload(
      await handleEnterpriseProductCreate(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_product.create', 'wi216-product', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI216-PRODUCT',
          initialVersion: {
            productType: 'manufactured.widget',
            displayName: 'WI216 Widget',
            intendedUse: 'initial Context fixture',
            productScope: { family: 'widget', markets: ['CN'] },
            sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), enterpriseId)],
          },
        }),
      ),
    ) as unknown as {
      productRef: { objectId: string };
      productVersionRef: { versionId: string };
    };
    const productScope = committedPayload(
      await handleEnterpriseProductCreateScopeSnapshot(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_product.create_scope_snapshot', 'wi216-scope', {
          productRef: { objectType: 'Product' as const, objectId: product.productRef.objectId },
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          purpose: 'WI216 product scope fixture',
        }),
      ),
    ) as unknown as { productScopeSnapshotRef: { objectId: string }; payloadHash: string };

    const qms = committedPayload(
      await handleEnterpriseQmsCreateRevision(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_qms.create_revision', 'wi216-qms', {
          qmsConfigurationRef: epObjectRef('QMSConfiguration', newUuidV7(), enterpriseId),
          applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
          managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
          professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
          sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), enterpriseId)],
        }),
      ),
    ) as unknown as { qmsConfigurationRevisionRef: { objectId: string; versionId: string } };
    await handleEnterpriseQmsActivateRevision(
      enterpriseProjectDb,
      context,
      seedEnvelope(
        context,
        'enterprise_qms.activate_revision',
        'wi216-qms-activate',
        {
          qmsConfigurationRef: epObjectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: epVersionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          activationMode: 'ACTIVATE' as const,
          expectedAggregateVersion: '1',
          humanDecisionRef: epObjectRef('BusinessDecision', newUuidV7(), enterpriseId),
        },
        { expectedAggregateVersion: '1' },
      ),
    );

    const profile = committedPayload(
      await handleEnterpriseProfileCreateSnapshot(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'enterprise_profile.create_snapshot', 'wi216-profile', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          enterpriseFactVersionRefs: [],
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          qmsConfigurationRef: epObjectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: epVersionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          purpose: 'WI216 profile fixture',
        }),
      ),
    ) as unknown as { enterpriseProfileSnapshotRef: { objectId: string }; payloadHash: string };

    const project = committedPayload(
      await handleCreateProject(
        enterpriseProjectDb,
        context,
        seedEnvelope(context, 'project.create_project', 'wi216-project', {
          enterpriseRef: epObjectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI216-PROJECT',
          title: 'WI216 project',
          objective: 'initial Context persistence acceptance fixture',
          startSnapshot: {
            enterpriseProfileSnapshotRef: epSnapshotRef(
              'EnterpriseProfileSnapshot',
              profile.enterpriseProfileSnapshotRef.objectId,
              profile.payloadHash,
              enterpriseId,
            ),
            qmsConfigurationRef: epVersionedRef(
              'QMSConfiguration',
              qms.qmsConfigurationRevisionRef.objectId,
              qms.qmsConfigurationRevisionRef.versionId,
              enterpriseId,
            ),
            productScopeSnapshotRef: epSnapshotRef(
              'ProductScopeSnapshot',
              productScope.productScopeSnapshotRef.objectId,
              productScope.payloadHash,
              enterpriseId,
            ),
          },
          memberPolicyRef: epVersionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
        }),
      ),
    ) as unknown as { projectRef: { objectId: string } };
    return { enterpriseId, projectId: project.projectRef.objectId };
  }

  /** One EnterpriseFact through the owning propose + confirm commands. */
  async function proposeAndConfirmFact(
    tag: string,
    riskLevel: 'LOW' | 'MEDIUM',
  ): Promise<{ objectId: string; versionId: string }> {
    const factContext: EnterpriseProjectTransactionContext = {
      ...seedContext(fixture.enterpriseId, []),
      authorizationPurposes: ['project.context_source.capture', 'project.context_source.read'],
    };
    const proposed = await track(
      handleProposeEnterpriseFact(
        enterpriseProjectDb,
        factContext,
        seedEnvelope(factContext, 'project.propose_enterprise_fact', `wi216:fact:${tag}:propose`, {
          enterpriseRef: epObjectRef('Enterprise', fixture.enterpriseId, fixture.enterpriseId),
          proposal: {
            factType: `wi216.fact.${tag}`,
            value: { presence: 'PRESENT', value: { tag }, evidenceRefs: [] },
            sourceRefs: [epObjectRef('SourceMaterial', newUuidV7(), fixture.enterpriseId)],
            riskLevel,
            proposalReason: {
              reasonCode: 'WI216_FIXTURE',
              summary: `WI-216 ${tag} fixture`,
              evidenceRefs: [],
            },
          },
        }),
      ),
    );
    expect(proposed.status).toBe('COMMITTED');
    const proposedRef = record(committedPayload(proposed).enterpriseFactRef) as unknown as {
      objectId: string;
      versionId: string;
    };
    const confirmed = await track(
      handleConfirmEnterpriseFact(
        enterpriseProjectDb,
        factContext,
        seedEnvelope(factContext, 'project.confirm_enterprise_fact', `wi216:fact:${tag}:confirm`, {
          proposalVersionRef: epVersionedRef(
            'EnterpriseFact',
            proposedRef.objectId,
            proposedRef.versionId,
            fixture.enterpriseId,
          ),
          evidenceRefs: [
            {
              evidence: {
                kind: 'CONTENT_ADDRESSED' as const,
                objectType: 'SourceMaterial',
                objectId: newUuidV7(),
                scope: { enterpriseId: fixture.enterpriseId },
                contentHash: contentHash('a'.repeat(64)),
              },
              relation: 'SUPPORTS' as const,
            },
          ],
          confirmedValue: { presence: 'PRESENT', value: { tag }, evidenceRefs: [] },
          justification: {
            reasonCode: 'WI216_FIXTURE',
            summary: `WI-216 ${tag} confirmation`,
            evidenceRefs: [],
          },
        }),
      ),
    );
    expect(confirmed.status).toBe('COMMITTED');
    const confirmedRef = record(committedPayload(confirmed).enterpriseFactRef) as unknown as {
      objectId: string;
      versionId: string;
    };
    return { objectId: confirmedRef.objectId, versionId: confirmedRef.versionId };
  }

  /**
   * Captures one Source Slice through the owning composition entry, under its
   * own capture Decision (wi188 convention, Project-scoped actor).
   */
  async function captureSlice(input: {
    principal?: Principal;
    purpose: string;
    capturePolicyRef: Common.VersionedRef;
    idempotencyKey: string;
    requestedKinds?: readonly string[];
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const payload = {
      projectRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: fixture.projectId,
        scope: scope(),
      },
      purpose: input.purpose,
      audience: { principalKind: principal.principalKind, principalId: principal.principalId },
      requestedKinds: [...(input.requestedKinds ?? SLICE_KINDS)],
      capturePolicyRef: input.capturePolicyRef,
    } as unknown as EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    const decision = await authorizeCommandTracked(identityDeps([fixture.projectId], principal), {
      actorSnapshotRef: principal.actorRef,
      intent: {
        commandType: 'project.capture_context_source_slice',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'project.context_source.capture',
        requestedCapability: CAPTURE_CAPABILITY,
        commandPayloadHash: digestCanonicalPayload(payload as unknown as CanonicalJsonObject).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: principal.authHash,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(decision.outcome, JSON.stringify(decision)).toBe('ALLOW');
    const envelope = {
      commandId: newUuidV7(),
      commandType: 'project.capture_context_source_slice',
      commandVersion: '1.0',
      scopeRef: scope(),
      targetRef: {
        kind: 'OBJECT',
        objectType: SLICE_OBJECT,
        objectId: newUuidV7(),
        scope: scope(),
      },
      actor: principal.actorRef,
      authorizationDecisionRef: decision.authorizationDecisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: CORRELATION,
      requestedAt: new Date().toISOString(),
      payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHash(
          digestCanonicalPayload(payload as unknown as CanonicalJsonObject).hash.toString('hex'),
        ),
      },
    } as unknown as CanonicalJsonObject;
    const result = await track(
      sliceEntry.capture(
        envelope,
        input.principal === undefined
          ? sliceSession
          : {
              authenticationContextHash: principal.authHash,
              policyResolutionActorSnapshotRef: principal.actorRef,
            },
      ),
    );
    const resultPayload =
      result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    if (resultPayload === null) throw new Error('expected a stored slice result payload');
    return record(resultPayload).sourceSliceRef as Common.ContentAddressedRef;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
           CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
             NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, task_execution_app, enterprise_project_app, identity_policy_app, integration_gateway_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    const probeConnectionUrl = url.toString();
    probeUrl = probeConnectionUrl;
    tePool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    ipPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    epPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    teDb = createTaskExecutionDatabase(tePool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    enterpriseProjectDb = createEnterpriseProjectDatabase(epPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    clock = Date.now();
    fixture = await seedEnterpriseProject();

    // Identity facts: principals, the grant Policy Snapshot and the actor
    // snapshots precede every grant and Decision.
    for (const [id, principalKind, displayName] of [
      [OPERATOR, 'HUMAN', 'WI-216 operator'],
      [OTHER_PRINCIPAL, 'HUMAN', 'WI-216 second human'],
    ] as const) {
      await withIdentityTransaction(identityDb, identityContext([]), (trx) =>
        identityRepo.insertPrincipal(trx, {
          id,
          principalKind,
          displayName,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
    }
    const policySnapshot = await recordPolicySnapshotTracked(identityDeps([]), {
      policySnapshotId: POLICY_SNAPSHOT_ID,
      policySetVersion: `wi216-grant-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: PAST,
      policyDocument: { rules: ['initial-context-authorization'], version: 1 },
      idempotencyKey: `wi216:policy:${newUuidV7()}`,
    });
    expect(policySnapshot.status).toBe('COMMITTED');
    const policyRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [POLICY_SNAPSHOT_ID],
      )
    ).rows.at(0);
    if (policyRow === undefined) throw new Error('grant Policy Snapshot row missing');
    grantPolicyHash = policyRow.payload_hash;

    operatorActorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
      actorSnapshotId: OPERATOR_ACTOR,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    otherActorRef = await createActorSnapshot(identityDeps([fixture.projectId], other()), {
      actorSnapshotId: OTHER_ACTOR,
      principalId: OTHER_PRINCIPAL,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: OTHER_AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });

    // Creation grants for the Task/WorkOrder fixtures and the two Context
    // Snapshot entries; generic grants for the owning reads the build re-enters.
    await grant({
      capabilityCode: creationCapabilityCodes.taskV1,
      action: ACTIONS.taskV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V1,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.taskV2,
      action: ACTIONS.taskV2,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V2,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    await grant({
      capabilityCode: creationCapabilityCodes.workOrderV11,
      action: ACTIONS.workOrderV11,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V11,
    });
    grantCtxBuild = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    grantCtxRead = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    // The §15.9 DRAFT dependency read of the build, under its own capability.
    grantCtxDraftRead = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
    });
    grantResolve = await grantGeneric(dependencyCapabilities.resolvePolicy);
    grantSliceRead = await grantGeneric(dependencyCapabilities.readContextSourceSlice);
    await grantGeneric(CAPTURE_CAPABILITY);
    await grantGeneric(RECORD_CAPABILITY);

    // Builder Policies (Project scope, builder profile declared unless noted).
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.main, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:main',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.noProjection, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:no-projection',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
    });
    // Declares the *capture* profile, so the builder profile binding fails.
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.wrongProfile, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:wrong-profile',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.future, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:future',
      effectiveFrom: new Date(clock + 15 * 60 * 1000),
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.supersededFirst, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:superseded-first',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.successor, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:successor',
      effectiveFrom: new Date(clock - 30 * 60 * 1000),
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
      supersedesRef: policyKey(BUILDER_POLICY.supersededFirst, fixture),
    });
    await registerPolicyVersionAs({
      key: policyKey(BUILDER_POLICY.alt, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:builder:alt',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
      policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
    });

    // Capture Policies of the slice fixtures.
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.main, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:main',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [PURPOSE_DOCUMENT, PURPOSE_FORM, PURPOSE_REVIEW],
      },
    });
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.ttl, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:ttl',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 120, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:revoked-first',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
    });

    sliceEntry = createContextSourceSliceEntry({
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: dependencyCapabilities.readContextSourceSlice,
        resolve: dependencyCapabilities.resolvePolicy,
      },
    });
    sliceSession = {
      authenticationContextHash: AUTH_HASH,
      policyResolutionActorSnapshotRef: operatorActorRef,
    };

    // Slice B is captured before any Fact exists; the two Facts are then
    // proposed and confirmed, and Slice A observes both as CONFIRMED.
    sliceBRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:b',
    });
    factA1 = await proposeAndConfirmFact('a1', 'LOW');
    factA2 = await proposeAndConfirmFact('a2', 'MEDIUM');
    sliceARef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:a',
    });
    // record.form.read carries no Fact metadata: the ENTERPRISE_FACTS omission
    // is PURPOSE_FORBIDDEN, which drives coverage to PARTIAL.
    sliceCRef = await captureSlice({
      purpose: PURPOSE_FORM,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:c',
    });
    sliceTTLRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.ttl, fixture),
      idempotencyKey: 'wi216:slice:ttl',
    });
    sliceRevokedRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
      idempotencyKey: 'wi216:slice:revoked',
    });
    // Superseding the capture Policy revokes every Slice captured under it.
    // The successor must already be effective at the suite's frozen trusted
    // instant: with a real-clock `effectiveFrom` the predecessor still
    // resolves as current at the entry's asOf and the Slice stays USABLE.
    await registerPolicyVersionAs({
      key: policyKey(CAPTURE_POLICY.successor, fixture),
      factId: newUuidV7(),
      idempotencyKey: 'wi216:capture:successor',
      effectiveFrom: new Date(clock - 60_000),
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
      supersedesRef: policyKey(CAPTURE_POLICY.revokedFirst, fixture),
    });
    // The mixed-state slice: fact A2 disputed by owner SQL (the same convention
    // task-readiness/work-order-draft use for owner-movable columns; the
    // enterprise_fact root has no status transition delivered in this slice and
    // the version immutable guard does not cover `status`).
    await admin.query(
      `UPDATE enterprise_project.enterprise_fact SET current_status = 'DISPUTED'
        WHERE enterprise_fact_id = $1`,
      [factA2.objectId],
    );
    await admin.query(
      `UPDATE enterprise_project.enterprise_fact_version SET status = 'DISPUTED'
        WHERE version_id = $1`,
      [factA2.versionId],
    );
    sliceMixRef = await captureSlice({
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: policyKey(CAPTURE_POLICY.main, fixture),
      idempotencyKey: 'wi216:slice:mix',
    });

    initialContextEntry = entryFor();
    workOrderEntry = createWorkOrderDraftEntry({
      taskExecutionDb: teDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: creationCapabilityCodes,
      readCapabilityCodes: draftReadCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    taskEntry = createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });

    // The golden WorkOrder: one @1.1 DRAFT every unit assembly input reuses.
    const goldenTaskId = await createExecutableTask('2.0');
    goldenWorkOrderId = await createWorkOrder({ taskId: goldenTaskId, taskMajor: '2.0' });
    goldenDraftRef = await draftSnapshotRefOf(goldenWorkOrderId);
  }, 300_000);

  afterAll(async () => {
    await tePool.end();
    await ipPool.end();
    await epPool.end();
    await admin.end();
  });

  // -----------------------------------------------------------------------
  // Task / WorkOrder fixtures through the owning entries
  // -----------------------------------------------------------------------

  /** Owning Human-only codes (Spec 001 §15.7); declared, never trusted here. */
  const NON_HUMAN_ONLY_CODES: readonly [string, string, string] = [
    'artifact.revision.create',
    'artifact.revision.delete',
    'execution.run.start',
  ];

  /** One `CapabilityGrant` declaration of the WorkOrder draft shape. */
  function capabilityGrant(
    capabilityType: string,
    actions: readonly string[],
    resourceSelectors: readonly string[],
    grantScope: Record<string, string>,
  ): Record<string, unknown> {
    return {
      capabilityType,
      actions: [...actions],
      resourceSelectors: [...resourceSelectors],
      constraints: [],
      expiresAt: new Date(clock + 365 * 24 * 60 * 60 * 1000).toISOString(),
      grantPolicyRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy_snapshot',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
        scope: grantScope,
      },
    };
  }

  /** The Core `WorkOrderDraft` baseline (creation major @1.0 shape). */
  function workOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
  }): Record<string, unknown> {
    const contract = JSON.parse(readFileSync(WORK_ORDER_CONTRACT_FIXTURE, 'utf8')) as Record<
      string,
      unknown
    >;
    const omitted = [
      'header',
      'workOrderRef',
      'taskRef',
      'projectRef',
      'contextSnapshotRef',
      'issuedAt',
      'expiresAt',
      'specificationHash',
    ];
    const draft = Object.fromEntries(
      Object.entries(structuredClone(contract)).filter(([key]) => !omitted.includes(key)),
    );
    rewriteFixtureScopes(draft, fixture);
    draft.taskRef = objectRef(input.taskMajor === '2.0' ? TASK_V2 : TASK_V1, input.taskId, scope());
    draft.requestedBy = { principalId: OPERATOR, principalKind: 'HUMAN' };
    draft.allowedCapabilities = [
      capabilityGrant(
        NON_HUMAN_ONLY_CODES[0],
        ['read', 'create'],
        ['zhiju.artifact.artifact_revision'],
        scope(),
      ),
    ];
    draft.deniedCapabilities = [
      capabilityGrant(NON_HUMAN_ONLY_CODES[1], ['delete'], ['zhiju.artifact.*'], scope()),
    ];
    return draft;
  }

  /**
   * The v1.1 `InitialWorkOrderDraft`: no Context Contract pin, the real
   * Project-scoped Builder Policy pin, an empty `targetScope.targetObjectRefs`
   * (the #216 support set is ∅) and the case's own `inputRefs`.
   */
  function initialWorkOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
    inputRefs?: Record<string, unknown>[];
    builderPolicyPair?: readonly [string, string];
    targetObjectRefs?: Record<string, unknown>[];
  }): Record<string, unknown> {
    const draft = workOrderDraft(input);
    const versionPins = { ...record(draft.versionPins) };
    delete versionPins.projectContextContractRef;
    versionPins.contextBuilderPolicyRef = policyKey(
      input.builderPolicyPair ?? BUILDER_POLICY.main,
      fixture,
    );
    draft.versionPins = versionPins;
    const targetScope = { ...record(draft.targetScope) };
    targetScope.targetObjectRefs = input.targetObjectRefs ?? [];
    draft.targetScope = targetScope;
    draft.inputRefs = input.inputRefs ?? [];
    return draft;
  }

  /**
   * The owning `execution.create_task` entry produces every Task under test
   * (wi212 convention: the optional `deliveryItemRef` is dropped; the committed
   * DRAFT is moved into the executable set through owner SQL because the only
   * delivered transition belongs to the #208 slice).
   */
  async function createExecutableTask(
    commandVersion: '1.0' | '2.0',
    owningReady = false,
  ): Promise<string> {
    const payload = payloadOf(commandVersion === '1.0' ? V1_TASK_FIXTURE : V2_TASK_FIXTURE);
    rewriteFixtureScopes(payload, fixture);
    (payload.projectRef as Record<string, unknown>).objectId = fixture.projectId;
    delete record(payload.definition).deliveryItemRef;
    if (owningReady) {
      delete record(payload.definition).parentTaskRef;
      record(payload.definition).dependencyTaskRefs = [];
      record(payload.definition).inputRefs = [];
    }
    const binding = TASK_DRAFT_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === commandVersion,
    );
    if (binding === undefined) throw new Error('unsupported Task creation version');
    const targetId = newUuidV7();
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await track(
      port.authorizeCreation(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion,
        targetRef: objectRef(
          binding.taskObjectType,
          targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: digest.hash,
        authenticationContextHash: AUTH_HASH,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the Task creation Decision was not issued');
    }
    const result = await track(
      taskEntry.create(
        {
          commandId: newUuidV7(),
          commandType: 'execution.create_task',
          commandVersion,
          scopeRef: scope(),
          targetRef: objectRef(binding.taskObjectType, targetId, scope()),
          actor: {
            kind: 'SNAPSHOT',
            objectType: ACTOR_SNAPSHOT_OBJECT,
            objectId: operatorActorRef.snapshotId,
            snapshotId: operatorActorRef.snapshotId,
            scope: scope(),
            contentHash: operatorActorRef.contentHash,
          },
          authorizationDecisionRef: view.authorizationDecisionRef,
          idempotencyKey: `wi216-task-${commandVersion}-${targetId}`,
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(digest.hash.toString('hex')),
          },
        },
        { authenticationContextHash: AUTH_HASH },
      ),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (owningReady) {
      await readyTaskForValidation(targetId);
      return targetId;
    }
    await track(
      admin.query('UPDATE task_execution.task SET status = $2 WHERE task_id = $1', [
        targetId,
        'READY',
      ]),
    );
    return targetId;
  }

  /** One WorkOrder creation attempt through the owning `execution.create_work_order` entry. */
  async function createWorkOrderResult(input: {
    customDraft?: Record<string, unknown>;
    taskId: string;
    taskMajor: '1.0' | '2.0';
    commandVersion?: '1.0' | '1.1';
    inputRefs?: Record<string, unknown>[];
    builderPolicyPair?: readonly [string, string];
    targetObjectRefs?: Record<string, unknown>[];
    expiresAt?: string;
  }): Promise<{ result: CommandResult; targetId: string }> {
    const commandVersion = input.commandVersion ?? '1.1';
    const draft =
      input.customDraft ??
      (commandVersion === '1.1'
        ? initialWorkOrderDraft(input)
        : workOrderDraft({ taskId: input.taskId, taskMajor: input.taskMajor }));
    const payload = {
      draft,
      expiresAt: input.expiresAt ?? new Date(clock + 24 * 60 * 60 * 1000).toISOString(),
    };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const targetId = newUuidV7();
    const targetType = commandVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1;
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes: creationCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await track(
      port.authorizeCreation(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_work_order',
        commandVersion,
        targetRef: objectRef(targetType, targetId, scope()) as unknown as Common.ObjectRef,
        commandPayloadHash: digest.hash,
        authenticationContextHash: AUTH_HASH,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the WorkOrder creation Decision was not issued');
    }
    const result = await track(
      workOrderEntry.create(
        {
          commandId: newUuidV7(),
          commandType: 'execution.create_work_order',
          commandVersion,
          scopeRef: scope(),
          targetRef: objectRef(targetType, targetId, scope()),
          actor: {
            kind: 'SNAPSHOT',
            objectType: ACTOR_SNAPSHOT_OBJECT,
            objectId: operatorActorRef.snapshotId,
            snapshotId: operatorActorRef.snapshotId,
            scope: scope(),
            contentHash: operatorActorRef.contentHash,
          },
          authorizationDecisionRef: view.authorizationDecisionRef,
          idempotencyKey: `wi216-workorder-${commandVersion}-${targetId}`,
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(digest.hash.toString('hex')),
          },
        },
        { authenticationContextHash: AUTH_HASH },
      ),
    );
    return { result, targetId };
  }

  /** One committed WorkOrder DRAFT through the owning `execution.create_work_order` entry. */
  async function createWorkOrder(
    input: Parameters<typeof createWorkOrderResult>[0],
  ): Promise<string> {
    const { result, targetId } = await createWorkOrderResult(input);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    return targetId;
  }

  /** The exact content address of a WorkOrder's current DRAFT snapshot. */
  async function draftSnapshotRefOf(workOrderId: string): Promise<Common.ContentAddressedRef> {
    const row = (
      await admin.query<{
        current_draft_snapshot_id: string;
        current_draft_snapshot_hash: Buffer;
      }>(
        `SELECT current_draft_snapshot_id::text, current_draft_snapshot_hash
           FROM task_execution.work_order WHERE work_order_id = $1`,
        [workOrderId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`WorkOrder ${workOrderId} missing`);
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: DRAFT_SNAPSHOT_OBJECT,
      objectId: row.current_draft_snapshot_id,
      scope: scope(),
      contentHash: contentHash(row.current_draft_snapshot_hash.toString('hex')),
    } as unknown as Common.ContentAddressedRef;
  }

  // -----------------------------------------------------------------------
  // Build/read drivers through the composition entry
  // -----------------------------------------------------------------------

  /** Issues one real build Decision through the owning IdentityPolicy Port. */
  async function issueBuildDecision(input: {
    targetId: string;
    payloadHash: Buffer;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    commandType?: string;
    commandVersion?: string;
    targetObjectType?: string;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const port = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? contextSnapshotCapabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await track(
      port.authorizeContextSnapshot(identityDeps([fixture.projectId], principal), {
        actorSnapshotRef: principal.actorRef,
        commandType: input.commandType ?? BUILD_COMMAND,
        commandVersion: input.commandVersion ?? BUILD_VERSION,
        targetRef: objectRef(
          input.targetObjectType ?? CONTEXT_SNAPSHOT_OBJECT,
          input.targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: principal.authHash,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the build Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  /** Issues one real snapshot-read Decision through the owning read Port. */
  async function issueReadDecision(input: {
    targetId: string;
    payloadHash: Buffer;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    targetObjectType?: string;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const port = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? contextSnapshotCapabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await track(
      port.authorizeContextSnapshot(identityDeps([fixture.projectId], principal), {
        actorSnapshotRef: principal.actorRef,
        commandType: READ_QUERY,
        commandVersion: READ_VERSION,
        targetRef: objectRef(
          input.targetObjectType ?? CONTEXT_SNAPSHOT_OBJECT,
          input.targetId,
          scope(),
        ) as unknown as Common.ObjectRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: principal.authHash,
      }),
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the read Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  interface BuildInput {
    readonly idempotencyKey: string;
    readonly workOrderId?: string;
    readonly draftRef?: unknown;
    readonly targetId?: string;
    readonly sourceSlices?: unknown[];
    readonly purpose?: string;
    readonly projectionType?: string;
    readonly audience?: { principalId: string; principalKind: string };
    readonly builderPolicyRef?: unknown;
    /** `present: false` omits the member; `present: true` carries `value` verbatim. */
    readonly expiry?: { readonly present: boolean; readonly value?: unknown };
    readonly principal?: Principal;
    readonly decisionNow?: Date;
    readonly commandVersion?: string;
    readonly commandId?: string;
    readonly requestMutate?: (request: Record<string, unknown>) => void;
  }

  /** The single legitimate build baseline every negative case starts from. */
  async function preparedBuild(input: BuildInput): Promise<Record<string, unknown>> {
    const principal = input.principal ?? operator();
    const targetId = input.targetId ?? newUuidV7();
    const request: Record<string, unknown> = {
      draftSnapshotRef:
        input.draftRef ?? (await draftSnapshotRefOf(input.workOrderId ?? goldenWorkOrderId)),
      projectionType: input.projectionType ?? 'COORDINATOR',
      purpose: input.purpose ?? PURPOSE_DOCUMENT,
      audience: input.audience ?? {
        principalId: principal.principalId,
        principalKind: principal.principalKind,
      },
      sourceSlices: input.sourceSlices ?? [sliceARef],
      builderPolicyRef: input.builderPolicyRef ?? policyKey(BUILDER_POLICY.main, fixture),
    };
    if (input.expiry?.present === true) request.expiresAt = input.expiry.value;
    input.requestMutate?.(request);
    const payload = { request };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const decisionRef = await issueBuildDecision({
      targetId,
      payloadHash: digest.hash,
      principal,
      ...(input.decisionNow === undefined ? {} : { now: input.decisionNow }),
      ...(input.commandVersion === undefined ? {} : { commandVersion: input.commandVersion }),
    });
    return {
      commandId: input.commandId ?? newUuidV7(),
      commandType: BUILD_COMMAND,
      commandVersion: input.commandVersion ?? BUILD_VERSION,
      scopeRef: scope(),
      targetRef: objectRef(CONTEXT_SNAPSHOT_OBJECT, targetId, scope()),
      actor: {
        kind: 'SNAPSHOT',
        objectType: ACTOR_SNAPSHOT_OBJECT,
        objectId: principal.actorRef.snapshotId,
        snapshotId: principal.actorRef.snapshotId,
        scope: scope(),
        contentHash: principal.actorRef.contentHash,
      },
      authorizationDecisionRef: decisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHash(digest.hash.toString('hex')),
      },
    };
  }

  /** One build attempt reduced to its stable exterior. */
  async function attemptBuild(
    envelope: unknown,
    target: InitialContextEntry = initialContextEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await track(target.build(envelope, sessionFor(principal)));
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  function contextSnapshotRefOf(result: CommandResult): Common.SnapshotRef {
    const payload = result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    return record(record(payload).data).contextSnapshotRef as Common.SnapshotRef;
  }

  function readEnvelope(input: {
    snapshotRef: unknown;
    decisionRef: Common.ContentAddressedRef;
    principal?: Principal;
    consistencyRequirement?: string;
  }): Record<string, unknown> {
    const principal = input.principal ?? operator();
    return {
      queryId: newUuidV7(),
      queryType: READ_QUERY,
      queryVersion: READ_VERSION,
      scopeRef: scope(),
      requester: {
        kind: 'OBJECT',
        objectType: PRINCIPAL_OBJECT,
        objectId: principal.principalId,
        scope: scope(),
      },
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: AUTH_CONTEXT_OBJECT,
        objectId: AUTH_CONTEXT_ID,
        scope: scope(),
        contentHash: contentHash(principal.authHash.toString('hex')),
      },
      authorizationDecisionRef: input.decisionRef,
      consistencyRequirement: input.consistencyRequirement ?? 'AUTHORITATIVE',
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload: { contextSnapshotRef: input.snapshotRef },
    };
  }

  /** The single legitimate read baseline for one committed Snapshot. */
  async function preparedRead(input: {
    snapshotRef: Common.SnapshotRef;
    principal?: Principal;
    now?: Date;
    capabilityCodes?: TaskExecutionContextSnapshotCapabilityCodes;
    targetObjectType?: string;
    refOverride?: unknown;
  }): Promise<Record<string, unknown>> {
    const principal = input.principal ?? operator();
    const presentedRef = input.refOverride ?? input.snapshotRef;
    const digest = digestCanonicalPayload({
      contextSnapshotRef: presentedRef,
    } as unknown as CanonicalJsonObject);
    const targetId = record(presentedRef).objectId as string;
    const decisionRef = await issueReadDecision({
      targetId,
      payloadHash: digest.hash,
      principal,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.capabilityCodes === undefined ? {} : { capabilityCodes: input.capabilityCodes }),
      ...(input.targetObjectType === undefined ? {} : { targetObjectType: input.targetObjectType }),
    });
    return readEnvelope({ snapshotRef: presentedRef, decisionRef, principal });
  }

  /** One read attempt reduced to the same kind of stable exterior. */
  async function attemptRead(
    envelope: unknown,
    target: InitialContextEntry = initialContextEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await track(target.read(envelope, sessionFor(principal)));
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  // -----------------------------------------------------------------------
  // Committed-fact readers (the owning role has no business reader for these)
  // -----------------------------------------------------------------------

  async function contextSnapshotRow(objectId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        object_id: string;
        purpose: string;
        audience: string;
        enterprise_id: string;
        project_id: string;
        builder_version: string;
        policy_snapshot_id: string;
        source_manifest_count: number;
        context_item_count: number;
        omission_count: number;
        redaction_count: number;
        coverage_state: string;
        payload_hash: Buffer;
        canonicalization_version: string;
        payload_hash_algorithm: string;
        expires_at: Date | null;
        effective_expires_at: Date | null;
        request_payload_hash: Buffer;
        source_command_id: string;
        created_by_principal_id: string;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT snapshot_id::text, object_id::text, purpose, audience,
                enterprise_id::text, project_id::text, builder_version,
                policy_snapshot_id::text, source_manifest_count, context_item_count,
                omission_count, redaction_count, coverage_state, payload_hash,
                canonicalization_version, payload_hash_algorithm, expires_at,
                effective_expires_at, request_payload_hash, source_command_id::text,
                created_by_principal_id::text, canonical_payload
           FROM task_execution.context_snapshot WHERE object_id = $1`,
        [objectId],
      )
    ).rows.at(0);
  }

  async function contextSnapshotBuildRow(snapshotId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        build_kind: string;
        draft_snapshot_ref: Record<string, unknown>;
        frozen_contract_ref: Record<string, unknown> | null;
        slice_refs: Record<string, unknown>[];
        purpose: string;
        audience: Record<string, unknown>;
        builder_policy_ref: Record<string, unknown>;
        policy_content_hash: Buffer;
        policy_effective_from: Date;
        policy_superseded_at: Date | null;
        request_expires_at: Date | null;
        effective_expires_at: Date | null;
        canonical_payload: Record<string, unknown>;
        payload_hash: Buffer;
        request_payload_hash: Buffer;
        source_command_id: string;
        enterprise_id: string;
        project_id: string;
        created_by_principal_id: string;
      }>(
        `SELECT snapshot_id::text, build_kind, draft_snapshot_ref, frozen_contract_ref,
                slice_refs, purpose, audience, builder_policy_ref, policy_content_hash,
                policy_effective_from, policy_superseded_at, request_expires_at,
                effective_expires_at, canonical_payload, payload_hash, request_payload_hash,
                source_command_id::text, enterprise_id::text, project_id::text,
                created_by_principal_id::text
           FROM task_execution.context_snapshot_build WHERE snapshot_id = $1`,
        [snapshotId],
      )
    ).rows.at(0);
  }

  async function receiptRows(idempotencyKey: string) {
    return (
      await admin.query<{
        command_id: string;
        command_type: string;
        command_version: string;
        outcome: string;
        target_type: string | null;
        target_id: string | null;
        result_payload: Record<string, unknown> | null;
      }>(
        `SELECT command_id::text, command_type, command_version, outcome, target_type,
                target_id::text, result_payload
           FROM task_execution.command_receipt WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
    ).rows;
  }

  async function auditRows(commandId: string) {
    return (
      await admin.query<{
        outcome: string;
        error_code: string | null;
        safe_summary: string | null;
      }>(
        `SELECT outcome, error_code, safe_summary FROM task_execution.audit_record
          WHERE command_id = $1 ORDER BY recorded_at`,
        [commandId],
      )
    ).rows;
  }

  async function countRows(table: string): Promise<number> {
    const row = (
      await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    ).rows.at(0);
    return row?.n ?? -1;
  }

  async function edgeRows(ownerId: string) {
    return (
      await admin.query<{
        reference_path: string;
        target_object_type: string;
        target_module: string;
        owner_version_id: string;
        target_object_id: string;
      }>(
        `SELECT reference_path, target_object_type, target_module,
                owner_version_id::text, target_object_id::text
           FROM task_execution.reference_edge
          WHERE owner_object_id = $1 ORDER BY reference_path`,
        [ownerId],
      )
    ).rows;
  }

  async function outboxRows(aggregateId: string) {
    return (
      await admin.query<{
        event_id: string;
        event_type: string;
        event_version: string;
        aggregate_version: string;
        correlation_id: string;
        causation_id: string | null;
        source_command_id: string;
        payload: Record<string, unknown>;
        payload_hash: Buffer;
        canonicalization_version: string;
        occurred_at: Date;
        created_by_principal_id: string;
      }>(
        `SELECT event_id::text, event_type, event_version, aggregate_version::text,
                correlation_id::text, causation_id::text, source_command_id::text,
                payload, payload_hash, canonicalization_version, occurred_at,
                created_by_principal_id::text
           FROM task_execution.outbox_event WHERE aggregate_id = $1 ORDER BY recorded_at`,
        [aggregateId],
      )
    ).rows;
  }

  /**
   * The masked DENIED audits the IdentityPolicy side recorded for the §15.9
   * DRAFT dependency read of one build attempt (`command_type` is the
   * consuming build, the target the DRAFT snapshot the request named).
   */
  async function ipDraftReadDeniedAudits(principalId: string, targetObjectId: string) {
    return (
      await admin.query<{
        outcome: string;
        error_code: string | null;
        command_type: string;
        target_type: string | null;
        target_id: string | null;
        principal_id: string;
        safe_summary: string | null;
      }>(
        `SELECT outcome, error_code, command_type, target_type, target_id::text,
                principal_id::text, safe_summary
           FROM identity_policy.audit_record
          WHERE command_type = $1 AND principal_id = $2 AND target_id = $3
          ORDER BY recorded_at`,
        [BUILD_COMMAND, principalId, targetObjectId],
      )
    ).rows;
  }

  /** Every Decision this suite minted for the §15.9 DRAFT dependency read. */
  async function draftReadDecisionRows() {
    return (
      await admin.query<{
        authorization_decision_id: string;
        command_type: string;
        command_version: string;
        purpose: string;
        requested_capability: string;
        target_object_type: string | null;
        target_object_id: string | null;
        command_payload_hash: Buffer;
        policy_snapshot_id: string;
        principal_id: string;
        actor_snapshot_id: string;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT authorization_decision_id::text, command_type, command_version, purpose,
                requested_capability, target_object_type, target_object_id::text,
                command_payload_hash, policy_snapshot_id::text, principal_id::text,
                actor_snapshot_id::text, canonical_payload
           FROM identity_policy.authorization_decision
          WHERE requested_capability = $1
          ORDER BY created_at`,
        [contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11],
      )
    ).rows;
  }

  /** The five TaskExecution fact counts a refused build must never move. */
  async function teFactCounts(): Promise<{
    snapshots: number;
    builds: number;
    receipts: number;
    audits: number;
    outbox: number;
  }> {
    return {
      snapshots: await countRows('task_execution.context_snapshot'),
      builds: await countRows('task_execution.context_snapshot_build'),
      receipts: await countRows('task_execution.command_receipt'),
      audits: await countRows('task_execution.audit_record'),
      outbox: await countRows('task_execution.outbox_event'),
    };
  }

  async function slicePayloadOf(sliceId: string): Promise<Record<string, unknown>> {
    const row = (
      await admin.query<{ slice_payload: Record<string, unknown> }>(
        'SELECT slice_payload FROM enterprise_project.context_source_slice WHERE slice_id = $1',
        [sliceId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`slice ${sliceId} missing`);
    return row.slice_payload;
  }

  async function draftPayloadOf(workOrderId: string): Promise<Record<string, unknown>> {
    const row = (
      await admin.query<{ canonical_payload: Record<string, unknown> }>(
        `SELECT canonical_payload FROM task_execution.work_order_draft_snapshot
          WHERE work_order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [workOrderId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`draft snapshot of ${workOrderId} missing`);
    return row.canonical_payload;
  }

  async function policyVersionRow(pair: readonly [string, string]) {
    const row = (
      await admin.query<{
        payload_hash: Buffer;
        effective_from: Date;
        canonical_payload: Record<string, unknown>;
      }>(
        `SELECT payload_hash, effective_from, canonical_payload
           FROM identity_policy.policy_version
          WHERE policy_object_id = $1 AND policy_key_version_id = $2`,
        [pair[0], pair[1]],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error(`policy version ${pair[1]} missing`);
    return row;
  }

  /**
   * No Snapshot and no build metadata, and no *successful* command fact: a
   * Receipt may exist only as the runner's own `REJECTED` record of the
   * refusal, never as a `COMMITTED` result or a `PENDING` claim. Cases whose
   * failure happens before the idempotency claim pass `'ABSENT'`.
   */
  async function expectNoContextSnapshot(
    targetId: string,
    idempotencyKey?: string,
    receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
  ): Promise<void> {
    expect(await contextSnapshotRow(targetId)).toBeUndefined();
    if (idempotencyKey === undefined) return;
    const receipts = await receiptRows(idempotencyKey);
    if (receipt === 'ABSENT') {
      expect(receipts).toEqual([]);
      return;
    }
    expect(receipts.every((row) => row.outcome === 'REJECTED')).toBe(true);
  }

  // -----------------------------------------------------------------------
  // Direct-SQL probes: the app role under a trusted 11-argument context.
  // -----------------------------------------------------------------------

  interface AppRoleContext {
    readonly principalId?: string;
    readonly principalKind?: string;
    readonly actorSnapshotId?: string;
    readonly allowedProjectIds: readonly string[];
    readonly enterpriseId?: string;
  }

  async function establish(client: pg.PoolClient, context: AppRoleContext): Promise<void> {
    await client.query(
      `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
      [
        context.principalId ?? OPERATOR,
        context.principalKind ?? 'HUMAN',
        context.actorSnapshotId ?? OPERATOR_ACTOR,
        REQUEST_DECISION,
        DECISION_HASH,
        new Date(clock + 60 * 60 * 1000),
        context.enterpriseId ?? fixture.enterpriseId,
        [...context.allowedProjectIds],
        CORRELATION,
      ],
    );
  }

  async function asAppRole<T>(
    pool: pg.Pool,
    role: string,
    context: AppRoleContext,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await establish(client, context);
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** One bare probe statement under the trusted 11-argument context. */
  function appStatement(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext> = {},
  ): Promise<{ code: string; message: string } | null> {
    return track(appStatementCore(statement, parameters, context));
  }

  async function appStatementCore(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext>,
  ): Promise<{ code: string; message: string } | null> {
    try {
      await asAppRole(
        tePool,
        'task_execution_app',
        {
          allowedProjectIds: [fixture.projectId],
          ...context,
        },
        (client) => client.query(statement, [...parameters]),
      );
      return null;
    } catch (error) {
      return failureOf(error);
    }
  }

  // -----------------------------------------------------------------------
  // The §35 controlled import of the legacy compatibility store: schema-owner
  // role under an established Project-scoped context (V3004 INSERT policy).
  // -----------------------------------------------------------------------

  /** The stored row of one imported legacy Snapshot, read as the superuser. */
  async function legacySnapshotRow(objectId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        object_type: string;
        object_id: string;
        enterprise_id: string;
        project_id: string;
        payload_hash: Buffer;
        payload_hash_algorithm: string;
        canonicalization_version: string;
        canonical_payload: Record<string, unknown>;
        project_context_contract: Record<string, unknown>;
        contract_ref: Record<string, unknown>;
        import_manifest_id: string;
        import_batch_id: string;
        source_system: string;
        imported_at: Date;
        import_tool_version: string;
      }>(
        `SELECT snapshot_id::text, object_type, object_id::text, enterprise_id::text,
                project_id::text, payload_hash, payload_hash_algorithm,
                canonicalization_version, canonical_payload, project_context_contract,
                contract_ref, import_manifest_id, import_batch_id, source_system,
                imported_at, import_tool_version
           FROM task_execution.context_snapshot_legacy WHERE object_id = $1`,
        [objectId],
      )
    ).rows.at(0);
  }

  interface LegacyImportRow {
    readonly snapshotId: string;
    readonly objectId: string;
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly payloadHash: Buffer;
    readonly canonicalPayload: Record<string, unknown>;
    readonly projectContextContract: Record<string, unknown>;
    readonly contractRef: Record<string, unknown>;
    readonly objectType?: string;
    readonly provenance?: {
      readonly manifestId?: string;
      readonly batchId?: string;
      readonly sourceSystem?: string;
      readonly toolVersion?: string;
    };
  }

  /**
   * One controlled-import attempt exactly as a migration/import session runs
   * it: the schema-owner role under an established transaction context (the
   * V3004 legacy INSERT policy is `TO task_execution_owner`, so the app role
   * can never take this path). Returns the failure instead of throwing.
   */
  function importLegacySnapshot(
    row: LegacyImportRow,
    context: Partial<AppRoleContext> = {},
  ): Promise<{ code: string; message: string } | null> {
    return track(importLegacySnapshotCore(row, context));
  }

  async function importLegacySnapshotCore(
    row: LegacyImportRow,
    context: Partial<AppRoleContext>,
  ): Promise<{ code: string; message: string } | null> {
    try {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE platform_context_establisher');
      await admin.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          context.principalId ?? OPERATOR,
          context.principalKind ?? 'HUMAN',
          context.actorSnapshotId ?? OPERATOR_ACTOR,
          REQUEST_DECISION,
          DECISION_HASH,
          new Date(clock + 60 * 60 * 1000),
          context.enterpriseId ?? fixture.enterpriseId,
          [...(context.allowedProjectIds ?? [fixture.projectId])],
          CORRELATION,
        ],
      );
      await admin.query('SET LOCAL ROLE task_execution_owner');
      await admin.query(
        `INSERT INTO task_execution.context_snapshot_legacy (
           snapshot_id, object_type, object_id, enterprise_id, project_id,
           payload_hash, payload_hash_algorithm, canonicalization_version,
           canonical_payload, project_context_contract, contract_ref,
           import_manifest_id, import_batch_id, source_system, imported_at,
           import_tool_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'SHA-256', '1', $7::jsonb, $8::jsonb,
                 $9::jsonb, $10, $11, $12, $13, $14)`,
        [
          row.snapshotId,
          row.objectType ?? CONTEXT_SNAPSHOT_LEGACY_OBJECT,
          row.objectId,
          row.enterpriseId,
          row.projectId,
          row.payloadHash,
          JSON.stringify(row.canonicalPayload),
          JSON.stringify(row.projectContextContract),
          JSON.stringify(row.contractRef),
          row.provenance?.manifestId ?? 'wi216-legacy-import-manifest',
          row.provenance?.batchId ?? 'wi216-legacy-import-batch',
          row.provenance?.sourceSystem ?? 'wi216-legacy-source-system',
          new Date(clock).toISOString(),
          row.provenance?.toolVersion ?? 'wi216-import-tool-1.0.0',
        ],
      );
      await admin.query('COMMIT');
      return null;
    } catch (error) {
      return failureOf(error);
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
      await admin.query('RESET ROLE').catch(() => undefined);
    }
  }

  /**
   * One probe statement under the same owner-role transaction the controlled
   * import runs in, for the owner-side closures (immutable guard, RLS) that
   * reject after the INSERT path. Returns the failure instead of throwing.
   */
  function ownerStatement(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext> = {},
  ): Promise<{ failure: { code: string; message: string } | null; rowCount: number | null }> {
    return track(ownerStatementCore(statement, parameters, context));
  }

  async function ownerStatementCore(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext>,
  ): Promise<{ failure: { code: string; message: string } | null; rowCount: number | null }> {
    let rowCount: number | null = null;
    try {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE platform_context_establisher');
      await admin.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          context.principalId ?? OPERATOR,
          context.principalKind ?? 'HUMAN',
          context.actorSnapshotId ?? OPERATOR_ACTOR,
          REQUEST_DECISION,
          DECISION_HASH,
          new Date(clock + 60 * 60 * 1000),
          context.enterpriseId ?? fixture.enterpriseId,
          [...(context.allowedProjectIds ?? [fixture.projectId])],
          CORRELATION,
        ],
      );
      await admin.query('SET LOCAL ROLE task_execution_owner');
      rowCount = (await admin.query(statement, [...parameters])).rowCount;
      await admin.query('COMMIT');
      return { failure: null, rowCount };
    } catch (error) {
      return { failure: failureOf(error), rowCount };
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
      await admin.query('RESET ROLE').catch(() => undefined);
    }
  }

  /**
   * The legacy fixture of one committed Snapshot payload: the historical body
   * with the Snapshot identity members re-pinned to the legacy identity (the
   * V3004 legacy mirror guard re-derives `snapshot_id` and the content address
   * from these bytes, exactly as the canonical table does). The historical
   * contract body is the same ProjectContext v1.0 document and `contractRef`
   * its content address under `zhiju.contract.project_context`.
   */
  function legacyFixtureOf(
    storedPayload: Record<string, unknown>,
    legacySnapshotId: string,
  ): { payload: Record<string, unknown>; digest: string } {
    const payload = structuredClone(storedPayload);
    payload.contextSnapshotId = legacySnapshotId;
    const header = record(payload.header);
    header.contractId = legacySnapshotId;
    const schemaRef = record(header.schemaRef);
    schemaRef.objectId = legacySnapshotId;
    schemaRef.versionId = legacySnapshotId;
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject).hash.toString('hex');
    return { payload, digest };
  }

  /** The exact six-field legacy SnapshotRef one imported row answers to. */
  function legacySnapshotRefOf(
    legacyObjectId: string,
    legacySnapshotId: string,
    digest: string,
  ): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      objectId: legacyObjectId,
      snapshotId: legacySnapshotId,
      scope: scope(),
      contentHash: contentHash(digest),
    } as unknown as Common.SnapshotRef;
  }

  /**
   * The one `contract_ref` spelling the extended legacy mirror guard (V3004,
   * PR #217 round 4) accepts for a row: kind CONTENT_ADDRESSED, objectType
   * `zhiju.contract.project_context`, objectId equal to the Snapshot identity,
   * the row's Project Scope, and the SHA-256/'1'/lowercase-digest triple of
   * the stored contract body.
   */
  function closedContractRef(snapshotId: string, digest: string): Record<string, unknown> {
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.contract.project_context',
      objectId: snapshotId,
      scope: scope(),
      contentHash: contentHash(digest),
    };
  }

  // -----------------------------------------------------------------------
  // Owning-assembly re-run inputs (unit layer of rows 003/004/017)
  // -----------------------------------------------------------------------

  type AssemblyInput = Parameters<typeof assembleInitialContext>[0];

  /**
   * The assembly input built exclusively from committed facts: the golden
   * WorkOrder's stored draft snapshot, the stored Slice payloads and the stored
   * Builder Policy version row. `slices` defaults to the golden [B, A] pair.
   */
  async function unitAssemblyInput(
    overrides: {
      slices?: { ref: Common.ContentAddressedRef; slice: Record<string, unknown> }[];
      draftMutate?: (draft: Record<string, unknown>) => void;
      requestMutate?: (request: Record<string, unknown>) => void;
      policyMutate?: (policy: Record<string, unknown>) => void;
      workOrderId?: string;
      asOf?: string;
    } = {},
  ): Promise<AssemblyInput> {
    const storedDraftPayload = await draftPayloadOf(overrides.workOrderId ?? goldenWorkOrderId);
    const draft = structuredClone(record(storedDraftPayload.draft));
    overrides.draftMutate?.(draft);
    const slices = (
      overrides.slices ?? [
        { ref: sliceBRef, slice: await slicePayloadOf(sliceBRef.objectId) },
        { ref: sliceARef, slice: await slicePayloadOf(sliceARef.objectId) },
      ]
    ).map((entry) => ({
      ref: entry.ref as unknown as CanonicalJsonObject,
      slice: entry.slice as CanonicalJsonObject,
    }));
    const policyRow = await policyVersionRow(BUILDER_POLICY.main);
    const policyPayload = record(policyRow.canonical_payload);
    const policy: Record<string, unknown> = {
      resolvedRef: policyKey(BUILDER_POLICY.main, fixture),
      contentHashDigest: policyRow.payload_hash.toString('hex'),
      effectiveFrom: policyRow.effective_from.toISOString(),
      policySchemaRefs: policyPayload.policySchemaRefs,
      policyDocument: policyPayload.policyDocument,
    };
    overrides.policyMutate?.(policy);
    const request: Record<string, unknown> = {
      draftSnapshotRef: goldenDraftRef,
      projectionType: 'COORDINATOR',
      purpose: PURPOSE_DOCUMENT,
      audience: { principalId: OPERATOR, principalKind: 'HUMAN' },
      builderPolicyRef: policyKey(BUILDER_POLICY.main, fixture),
    };
    overrides.requestMutate?.(request);
    return {
      request: request as unknown as AssemblyInput['request'],
      draft: {
        workOrderRef: storedDraftPayload.workOrderRef as CanonicalJsonObject,
        taskRef: storedDraftPayload.taskRef as CanonicalJsonObject,
        scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        draft,
        ...(Object.hasOwn(storedDraftPayload, 'expiresAt')
          ? { expiresAt: storedDraftPayload.expiresAt as string }
          : {}),
      },
      slices,
      policy: policy as unknown as AssemblyInput['policy'],
      snapshotId: newUuidV7(),
      asOf: overrides.asOf ?? new Date(clock).toISOString(),
      correlationId: newUuidV7(),
      issuedBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
  }

  /**
   * The §19.4 item 7 deterministic RFC 9562 UUIDv7 of one mapped fact,
   * recomputed from the stored slice payload alone.
   */
  function recomputeContextItemId(
    asOfMilliseconds: number,
    factItem: unknown,
    sliceObjectId: string,
    inSliceIndex: number,
  ): string {
    const factItemCanonical = canonicalize(factItem as Parameters<typeof canonicalize>[0]);
    const digest = createHash('sha256')
      .update(factItemCanonical, 'utf8')
      .update(sliceObjectId, 'utf8')
      .update(String(inSliceIndex), 'utf8')
      .digest();
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(Math.floor(asOfMilliseconds / 0x10000), 0);
    bytes.writeUInt16BE(asOfMilliseconds % 0x10000, 4);
    bytes[6] = 0x70 | ((digest[0] ?? 0) & 0x0f);
    bytes[7] = digest[1] ?? 0;
    bytes[8] = 0x80 | ((digest[2] ?? 0) & 0x3f);
    digest.copy(bytes, 9, 3, 10);
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * The §20.4 total-order key of one CONTENT_ADDRESSED Slice ref:
   * `(objectType, objectId, immutableVersionId-or-empty, hashAlgorithm,
   * hashCanonicalizationVersion, hashDigest, canonical_cv1(scope))` — the
   * object identity decides before any hash member, so a build can never
   * fall back to comparing hashes first.
   */
  function sliceOrderTuple(ref: Common.ContentAddressedRef): string[] {
    const hash = record(ref.contentHash);
    const source = ref as unknown as Record<string, unknown>;
    return [
      ref.objectType,
      ref.objectId,
      (source.immutableVersionId as string | undefined) ?? '',
      hash.algorithm as string,
      hash.canonicalizationVersion as string,
      hash.digest as string,
      canonicalize(ref.scope as Parameters<typeof canonicalize>[0]),
    ];
  }

  /** Member-by-member UTF-8 byte-order comparison of two §20.4 order keys. */
  function compareOrderTuples(left: readonly string[], right: readonly string[]): number {
    const width = Math.min(left.length, right.length);
    for (let index = 0; index < width; index += 1) {
      const a = left[index] ?? '';
      const b = right[index] ?? '';
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return left.length - right.length;
  }

  itIntegration('TE-214-D-001 pairs the build version with the DRAFT major', async () => {
    // @1.1 build × @1.1 DRAFT of a v2 Task: the one initial build pair.
    const taskV2 = await createExecutableTask('2.0');
    const workOrderV2 = await createWorkOrder({ taskId: taskV2, taskMajor: '2.0' });
    const committedV2 = await attemptBuild(
      await preparedBuild({ idempotencyKey: 'wi216-001-v2', workOrderId: workOrderV2 }),
    );
    expect(committedV2, JSON.stringify(committedV2)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // @1.1 build × @1.1 DRAFT of a v1 Task: the Task major stays free (§19.1).
    const taskV1 = await createExecutableTask('1.0');
    const workOrderV1 = await createWorkOrder({ taskId: taskV1, taskMajor: '1.0' });
    const committedV1 = await attemptBuild(
      await preparedBuild({ idempotencyKey: 'wi216-001-v1', workOrderId: workOrderV1 }),
    );
    expect(committedV1, JSON.stringify(committedV1)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // The registered @1.0 build has no approved authorization binding: it is
    // refused before any Decision read, Registry payload validation or Receipt
    // claim, against either DRAFT major. The presented Decision stays the
    // minted @1.1 one on purpose — it must never be read.
    const legacyDraftWorkOrder = await createWorkOrder({
      taskId: taskV1,
      taskMajor: '1.0',
      commandVersion: '1.0',
    });
    for (const [tag, workOrderId] of [
      ['draft-1-0', legacyDraftWorkOrder],
      ['draft-1-1', workOrderV1],
    ] as const) {
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-001-${tag}`,
        workOrderId,
      });
      envelope.commandVersion = '1.0';
      const attempt = await attemptBuild(envelope);
      expect(attempt).toMatchObject({ code: API_CONTRACT_TYPE_UNKNOWN, thrown: true });
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-001-${tag}`,
        'ABSENT',
      );
    }

    // @1.1 build × @1.0 DRAFT: the other creation major's pin set is never an
    // alias of the @1.1 shape (owning handler).
    const mismatchEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-001-mismatch',
      workOrderId: legacyDraftWorkOrder,
    });
    const mismatch = await attemptBuild(mismatchEnvelope);
    expect(mismatch).toMatchObject({
      code: EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
      thrown: false,
    });
    await expectNoContextSnapshot(
      record(mismatchEnvelope.targetRef).objectId as string,
      'wi216-001-mismatch',
    );
  });

  itIntegration('TE-214-D-002 closes the exact draft snapshot reference', async () => {
    const task = await createExecutableTask('2.0');
    const workOrderId = await createWorkOrder({ taskId: task, taskMajor: '2.0' });
    const draftRef = await draftSnapshotRefOf(workOrderId);
    const rejectCase = async (
      tag: string,
      draftSnapshotRef: unknown,
      code: string,
      thrown: boolean,
      receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
    ): Promise<void> => {
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-002-${tag}`,
        draftRef: draftSnapshotRef,
      });
      const attempt = await attemptBuild(envelope);
      expect(attempt, tag).toMatchObject({ code, thrown });
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-002-${tag}`,
        receipt,
      );
    };

    // A wrong object id and a wrong content hash both miss the by-identity
    // read; a foreign Scope is refused one layer earlier, by the §15.9 DRAFT
    // dependency-read Port's Scope check, before any DRAFT fact is read or
    // locked — thrown, with the Receipt ABSENT (header note).
    await rejectCase('wrong-id', { ...draftRef, objectId: newUuidV7() }, REFERENCE_INVALID, false);
    await rejectCase(
      'wrong-hash',
      { ...draftRef, contentHash: contentHash('0'.repeat(64)) },
      REFERENCE_INVALID,
      false,
    );
    await rejectCase(
      'wrong-scope',
      { ...draftRef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } },
      IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
      true,
      'ABSENT',
    );
    // The legacy spelling is pinned out by the registered Envelope Schema.
    await rejectCase(
      'legacy-spelling',
      { ...draftRef, objectType: 'execution.work_order_draft_snapshot' },
      API_VALUE_INVALID,
      true,
      'ABSENT',
    );

    // "指针已前进" is unreachable by legal facts: V3003 closes a pointer move in
    // both directions (no version advance; a target that does not resolve to a
    // snapshot of this WorkOrder), and the snapshot creation guard requires the
    // pointer to already name the inserted row — the two guards close each
    // other, so the pointer can never leave the creation snapshot.
    const noAdvance = await appStatement(
      'UPDATE task_execution.work_order SET current_draft_snapshot_id = $2 WHERE work_order_id = $1',
      [workOrderId, newUuidV7()],
    );
    expect(noAdvance?.code).toBe('23514');
    expect(noAdvance?.message).toContain('must advance the aggregate version');
    const toUnknown = await appStatement(
      `UPDATE task_execution.work_order
          SET current_draft_snapshot_id = $2, aggregate_version = aggregate_version + 1
        WHERE work_order_id = $1`,
      [workOrderId, newUuidV7()],
    );
    expect(toUnknown?.code).toBe('23514');
    expect(toUnknown?.message).toContain('must reference a snapshot of this work order');

    // V3005 rejects the old SQL shortcut that fabricated READY without a
    // Contract. The non-DRAFT build rejection now follows a real owning
    // Freeze in TE-VAL-S-008 below.
    await expect(
      track(
        admin.query('UPDATE task_execution.work_order SET status = $2 WHERE work_order_id = $1', [
          workOrderId,
          'READY',
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'work_order_frozen_pointer_state' });

    // "Expired DRAFT": the binding-layer rejection fires one step before the
    // unreachable commit-point WorkOrder re-check (header note), and the
    // `expires_at` column itself is immutable.
    const expiringWorkOrder = await createWorkOrder({
      taskId: task,
      taskMajor: '2.0',
      expiresAt: new Date(clock + 1_000).toISOString(),
    });
    const moved = new Date(clock + 2_000);
    const expiredEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-002-expired',
      workOrderId: expiringWorkOrder,
      decisionNow: moved,
    });
    const expired = await attemptBuild(expiredEnvelope, entryFor({ now: () => moved }));
    expect(expired).toMatchObject({ code: AGGREGATE_STATE_NOT_ALLOWED, thrown: false });
    expect(expired.result?.status === 'REJECTED' ? expired.result.safeSummary : '').toContain(
      'the initial Context expiry binding does not close',
    );
    await expectNoContextSnapshot(
      record(expiredEnvelope.targetRef).objectId as string,
      'wi216-002-expired',
    );
    const expiryRewrite = await appStatement(
      'UPDATE task_execution.work_order SET expires_at = $2 WHERE work_order_id = $1',
      [expiringWorkOrder, new Date(clock + 7_200_000)],
    );
    expect(expiryRewrite?.code).toBe('23514');
  });

  itIntegration('TE-214-D-003 assembles the deterministic golden payload', async () => {
    const commandId = newUuidV7();
    const key = 'wi216-003-golden';
    // Deliberately unsorted: §19.4 item 1 owns the deterministic slice order.
    const envelope = await preparedBuild({
      idempotencyKey: key,
      commandId,
      sourceSlices: [sliceBRef, sliceARef],
    });
    const targetId = record(envelope.targetRef).objectId as string;
    const attempt = await attemptBuild(envelope);
    expect(attempt, JSON.stringify(attempt)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (attempt.result === undefined) throw new Error('golden build did not commit');
    const snapshotRef = contextSnapshotRefOf(attempt.result);
    const snapshotId = snapshotRef.snapshotId;
    const row = await contextSnapshotRow(targetId);
    if (row === undefined) throw new Error('golden Context Snapshot row missing');
    const payload = row.canonical_payload;
    const header = record(payload.header);
    const projection = record(payload.projection);
    const coverage = record(payload.coverage);
    const manifest = record(payload.sourceManifest);

    // The promoted mirrors, field by field (V3004 re-derives every one).
    expect(row.snapshot_id).toBe(snapshotId);
    expect(row.builder_version).toBe('1.1');
    expect(row.purpose).toBe(PURPOSE_DOCUMENT);
    expect(row.audience).toBe(OPERATOR);
    expect(row.enterprise_id).toBe(fixture.enterpriseId);
    expect(row.project_id).toBe(fixture.projectId);
    expect(row.policy_snapshot_id).toBe(BUILDER_POLICY.main[1]);
    expect(row.canonicalization_version).toBe('1');
    expect(row.payload_hash_algorithm).toBe('SHA-256');
    expect(row.source_command_id).toBe(commandId);
    expect(row.created_by_principal_id).toBe(OPERATOR);
    expect(
      row.payload_hash.equals(digestCanonicalPayload(payload as CanonicalJsonObject).hash),
    ).toBe(true);
    expect(
      row.request_payload_hash.equals(
        digestCanonicalPayload(envelope.payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);
    expect(snapshotRef.contentHash.digest).toBe(row.payload_hash.toString('hex'));
    const manifestCount =
      [
        'enterpriseProfileSnapshotRef',
        'qmsConfigurationRef',
        'customerBaselineRef',
        'templateBaselineRef',
        'regulatoryProfileRef',
        'gapAnalysisRef',
        'deliveryPlanRef',
      ].filter((member) => manifest[member] !== undefined).length +
      (manifest.policyRefs as unknown[]).length +
      (manifest.schemaRefs as unknown[]).length +
      (manifest.externalAuthoritySnapshotRefs as unknown[]).length;
    expect(row.source_manifest_count).toBe(manifestCount);
    // Two confirmed Facts from slice A; one ACTIVE_BASELINES omission per
    // slice; the redaction mirror is derived from the committed Slices below.
    expect(row.context_item_count).toBe(2);
    expect(row.context_item_count).toBe((payload.contextItems as unknown[]).length);
    expect(row.omission_count).toBe(2);
    expect(row.omission_count).toBe((payload.omissions as unknown[]).length);
    expect(row.redaction_count).toBe((payload.redactions as unknown[]).length);
    expect(row.coverage_state).toBe('COMPLETE_FOR_PURPOSE');

    // The golden payload itself.
    expect(header.contractId).toBe(snapshotId);
    expect(header.contractType).toBe('zhiju.contract.project_context');
    expect(header.contractVersion).toBe('1.0');
    expect(header.dataClassification).toBe('INTERNAL');
    expect(header.payloadHash).toEqual({
      algorithm: 'SHA-256',
      digest: '0'.repeat(64),
      canonicalizationVersion: '1',
    });
    expect(payload.contextSnapshotId).toBe(snapshotId);
    expect(record(payload.enterpriseRef).objectId).toBe(fixture.enterpriseId);
    expect(record(payload.projectRef).objectId).toBe(fixture.projectId);
    expect(projection).toMatchObject({
      projectionType: 'COORDINATOR',
      purpose: PURPOSE_DOCUMENT,
      audience: OPERATOR,
    });
    expect(record(projection.builderPolicyRef).versionId).toBe(BUILDER_POLICY.main[1]);
    expect(coverage).toEqual({
      requestedScopes: [PURPOSE_DOCUMENT],
      includedScopes: [PURPOSE_DOCUMENT],
      excludedScopes: ['ACTIVE_BASELINES'],
      completeness: 'COMPLETE_FOR_PURPOSE',
    });
    // The effective expiry is the earliest slice validity bound (the DRAFT
    // creation expiry sits 24h out, the Policy has no successor).
    const sliceA = await slicePayloadOf(sliceARef.objectId);
    const sliceB = await slicePayloadOf(sliceBRef.objectId);
    // Every redaction the two Slices carry is promoted verbatim (#188): B has
    // the 2 unconditional ones, A adds 2 per confirmed Fact (verified: 2+6=8).
    const sliceRedactions = (slice: Record<string, unknown>): unknown[] =>
      (record(slice.source).redactions ?? []) as unknown[];
    expect(row.redaction_count).toBe(
      sliceRedactions(sliceA).length + sliceRedactions(sliceB).length,
    );
    const expectedExpiry = [sliceA.validUntil, sliceB.validUntil].sort()[0] as string;
    expect(payload.expiresAt).toBe(expectedExpiry);
    expect(row.expires_at?.toISOString()).toBe(expectedExpiry);
    expect(row.effective_expires_at?.toISOString()).toBe(expectedExpiry);

    // The INITIAL build metadata row.
    const buildRow = await contextSnapshotBuildRow(snapshotId);
    if (buildRow === undefined) throw new Error('golden build metadata row missing');
    const metadata = buildRow.canonical_payload;
    const mainPolicy = await policyVersionRow(BUILDER_POLICY.main);
    expect(buildRow.build_kind).toBe('INITIAL');
    expect(buildRow.frozen_contract_ref).toBeNull();
    expect(buildRow.draft_snapshot_ref).toEqual(goldenDraftRef);
    expect(buildRow.slice_refs).toEqual(metadata.sliceRefs);
    const sliceRefs = buildRow.slice_refs;
    expect(sliceRefs).toHaveLength(2);
    // §20.4: the stored order is the seven-member total order (object identity
    // before any hash member), superseding the §19.4 item 1 tuple.
    expect(
      compareOrderTuples(
        sliceOrderTuple(sliceRefs[0] as unknown as Common.ContentAddressedRef),
        sliceOrderTuple(sliceRefs[1] as unknown as Common.ContentAddressedRef),
      ),
    ).toBeLessThan(0);
    expect(new Set(sliceRefs.map((ref) => ref.objectId))).toEqual(
      new Set([sliceARef.objectId, sliceBRef.objectId]),
    );
    expect(buildRow.purpose).toBe(PURPOSE_DOCUMENT);
    expect(buildRow.audience).toEqual({ principalId: OPERATOR, principalKind: 'HUMAN' });
    expect(buildRow.builder_policy_ref).toEqual(policyKey(BUILDER_POLICY.main, fixture));
    expect(buildRow.policy_content_hash.equals(mainPolicy.payload_hash)).toBe(true);
    expect(buildRow.policy_effective_from.toISOString()).toBe(
      mainPolicy.effective_from.toISOString(),
    );
    expect(buildRow.policy_superseded_at).toBeNull();
    expect(buildRow.request_expires_at).toBeNull();
    expect(buildRow.effective_expires_at?.toISOString()).toBe(expectedExpiry);
    expect(buildRow.source_command_id).toBe(commandId);
    expect(
      buildRow.payload_hash.equals(digestCanonicalPayload(metadata as CanonicalJsonObject).hash),
    ).toBe(true);
    expect(buildRow.request_payload_hash.equals(row.request_payload_hash)).toBe(true);
    // The manifest carries the deduplicated Capture Policy, the Builder Policy,
    // the builder profile Schema and the WorkOrder Schema.
    expect(manifest.policyRefs).toHaveLength(2);
    expect(manifest.schemaRefs).toHaveLength(2);
    expect(manifest.externalAuthoritySnapshotRefs).toEqual([]);

    // Receipt COMMITTED with the exact identity; the audit trail records the
    // one COMMITTED command and no rejection.
    const receipts = await receiptRows(key);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      command_id: commandId,
      command_type: BUILD_COMMAND,
      command_version: '1.1',
      outcome: 'COMMITTED',
      target_type: CONTEXT_SNAPSHOT_OBJECT,
      target_id: targetId,
    });
    expect(await auditRows(commandId)).toEqual([
      { outcome: 'COMMITTED', error_code: null, safe_summary: null },
    ]);

    // Exactly the proved references become Edges: DRAFT, Policy, sorted Slices.
    const edges = await edgeRows(targetId);
    expect(
      edges.map((edge) => ({
        path: edge.reference_path,
        module: edge.target_module,
        type: edge.target_object_type,
      })),
    ).toEqual([
      {
        path: '/draftSnapshotRef',
        module: 'TaskExecution',
        type: 'zhiju.execution.work_order_draft_snapshot',
      },
      {
        path: '/projection/builderPolicyRef',
        module: 'IdentityPolicy',
        type: 'zhiju.identity.policy',
      },
      {
        path: '/sourceSlices/0',
        module: 'EnterpriseProject',
        type: 'zhiju.project.context_source_slice',
      },
      {
        path: '/sourceSlices/1',
        module: 'EnterpriseProject',
        type: 'zhiju.project.context_source_slice',
      },
    ]);
    for (const edge of edges) expect(edge.owner_version_id).toBe(snapshotId);
    expect(edges[2]?.target_object_id).toBe(record(sliceRefs[0]).objectId);
    expect(edges[3]?.target_object_id).toBe(record(sliceRefs[1]).objectId);

    // The single registered Outbox row (§19.7/§20.3): the event is now
    // `ContextSnapshotBuilt@1.1`, and the stored payload is exactly the closed
    // four public members plus the runner's two Scope mirrors.
    const outbox = await outboxRows(targetId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: 'execution.ContextSnapshotBuilt',
      event_version: '1.1',
      aggregate_version: '1',
    });
    expect(Object.keys(record(outbox[0]?.payload)).sort()).toEqual([
      'contextSnapshotRef',
      'coverageStatus',
      'enterpriseId',
      'projectId',
      'projectionType',
      'workOrderRef',
    ]);
    expect(outbox[0]?.payload).toMatchObject({
      projectionType: 'COORDINATOR',
      coverageStatus: 'COMPLETE_FOR_PURPOSE',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    expect(record(outbox[0]?.payload).contextSnapshotRef).toEqual(snapshotRef);
    expect(record(outbox[0]?.payload).workOrderRef).toEqual(
      (await draftPayloadOf(goldenWorkOrderId)).workOrderRef,
    );

    // The source watermarks are the deduplicated union in sorted slice order.
    const payloadBySliceId = new Map([
      [sliceARef.objectId, sliceA],
      [sliceBRef.objectId, sliceB],
    ]);
    const expectedWatermarks: unknown[] = [];
    const seenWatermarks = new Set<string>();
    for (const ref of sliceRefs) {
      const storedSlice = payloadBySliceId.get(record(ref).objectId as string);
      const watermark = record(record(storedSlice).source).sourceWatermark;
      const canonical = canonicalize(watermark as Parameters<typeof canonicalize>[0]);
      if (seenWatermarks.has(canonical)) continue;
      seenWatermarks.add(canonical);
      expectedWatermarks.push(watermark);
    }
    expect(payload.sourceWatermarks).toEqual(expectedWatermarks);

    // The owning assembly re-run on the committed facts reproduces payload and
    // metadata byte-for-byte (unit layer of the golden row).
    const unitInput = await unitAssemblyInput({ asOf: payload.asOf as string });
    const rerun = assembleInitialContext({
      ...unitInput,
      snapshotId,
      correlationId: header.correlationId as string,
    });
    if (rerun.outcome !== 'ASSEMBLED') {
      throw new Error(`golden re-run rejected: ${rerun.errorCode} ${rerun.safeSummary}`);
    }
    expect(rerun.payload).toEqual(payload);
    expect(rerun.metadata).toEqual(metadata);

    // ① The deterministic contextItemId recomputes from the stored slice
    // payload alone and its first 48 bits are the trusted assembly instant.
    const items = payload.contextItems as Record<string, unknown>[];
    const factItems = record(sliceA.source).factItems as unknown[];
    const asOfMilliseconds = new Date(payload.asOf as string).getTime();
    for (const item of items) {
      const subjectRef = record(item.subjectRef);
      const inSliceIndex = factItems.findIndex(
        (fact) => record(record(fact).factRef).objectId === subjectRef.objectId,
      );
      expect(inSliceIndex).toBeGreaterThanOrEqual(0);
      expect(item.contextItemId).toBe(
        recomputeContextItemId(
          asOfMilliseconds,
          factItems[inSliceIndex],
          sliceARef.objectId,
          inSliceIndex,
        ),
      );
      const hex = (item.contextItemId as string).replaceAll('-', '');
      expect(BigInt(`0x${hex.slice(0, 12)}`)).toBe(BigInt(asOfMilliseconds));
    }
    // ② Two Facts stay two distinguishable items.
    expect(new Set(items.map((item) => record(item.subjectRef).objectId))).toEqual(
      new Set([factA1.objectId, factA2.objectId]),
    );
    expect(new Set(items.map((item) => item.contextItemId)).size).toBe(2);
    const itemByFact = new Map(
      items.map((item) => [record(item.subjectRef).objectId as string, item]),
    );
    // The fixed status→epistemicState and riskLevel→sensitivity maps.
    expect(itemByFact.get(factA1.objectId)).toMatchObject({
      kind: 'FACT',
      epistemicState: 'CONFIRMED',
      sensitivity: 'INTERNAL',
      permittedUses: [PURPOSE_DOCUMENT],
      recordedTime: sliceA.capturedAt,
    });
    expect(itemByFact.get(factA2.objectId)).toMatchObject({
      kind: 'FACT',
      epistemicState: 'CONFIRMED',
      sensitivity: 'CUSTOMER_CONFIDENTIAL',
      permittedUses: [PURPOSE_DOCUMENT],
    });
    expect(itemByFact.get(factA1.objectId)?.provenanceRefs).toEqual([sliceARef, goldenDraftRef]);

    // ③ The same facts in another input order produce the identical payload
    // and metadata (slice order and DRAFT inputRef order are both owned sorts).
    const externalInput = (role: string, externalId: string): Record<string, unknown> => ({
      inputRole: role,
      ref: {
        system: 'wi216.external',
        resourceType: 'document',
        externalId,
        observedAt: new Date(clock).toISOString(),
      },
      required: false,
      permittedUse: PURPOSE_DOCUMENT,
      contentAccessMode: 'REFERENCE_ONLY',
      integrityRequired: false,
    });
    const baseInput = await unitAssemblyInput({
      draftMutate: (draft) => {
        draft.inputRefs = [
          externalInput('wi216.alpha', 'doc-1'),
          externalInput('wi216.beta', 'doc-2'),
        ];
      },
    });
    const permutedInput = await unitAssemblyInput({
      draftMutate: (draft) => {
        draft.inputRefs = [
          externalInput('wi216.beta', 'doc-2'),
          externalInput('wi216.alpha', 'doc-1'),
        ];
      },
      slices: [
        { ref: sliceARef, slice: sliceA },
        { ref: sliceBRef, slice: sliceB },
      ],
    });
    const identityFields = {
      snapshotId: baseInput.snapshotId,
      asOf: baseInput.asOf,
      correlationId: baseInput.correlationId,
    };
    const base = assembleInitialContext(baseInput);
    const permuted = assembleInitialContext({ ...permutedInput, ...identityFields });
    if (base.outcome !== 'ASSEMBLED' || permuted.outcome !== 'ASSEMBLED') {
      throw new Error('permutation fixture did not assemble');
    }
    expect(permuted.payload).toEqual(base.payload);
    expect(permuted.metadata).toEqual(base.metadata);

    // PARTIAL coverage: a record.form.read slice forbids the Fact metadata.
    const partialEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-003-partial',
      purpose: PURPOSE_FORM,
      sourceSlices: [sliceCRef],
    });
    const partial = await attemptBuild(partialEnvelope);
    expect(partial, JSON.stringify(partial)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const partialRow = await contextSnapshotRow(
      record(partialEnvelope.targetRef).objectId as string,
    );
    const partialCoverage = record(partialRow?.canonical_payload.coverage);
    expect(partialCoverage.completeness).toBe('PARTIAL');
    expect(partialCoverage.excludedScopes).toEqual(expect.arrayContaining(['ENTERPRISE_FACTS']));
    expect(partialRow?.coverage_state).toBe('PARTIAL');

    // The watermark union is a set union: one shared watermark stays one entry.
    const cloneId = newUuidV7();
    const cloneRef = {
      ...sliceBRef,
      objectId: cloneId,
      contentHash: contentHash(createHash('sha256').update('wi216-003-clone').digest('hex')),
    };
    const cloneSlice = structuredClone(sliceB);
    cloneSlice.sliceId = cloneId;
    const dedup = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: sliceBRef, slice: sliceB },
          { ref: cloneRef, slice: cloneSlice },
        ],
      }),
    );
    if (dedup.outcome !== 'ASSEMBLED') throw new Error('watermark dedup fixture did not assemble');
    expect((dedup.payload.sourceWatermarks as unknown[]).length).toBe(1);

    // The ref-closure negatives of §19.3 item 2.
    const negativeCase = async (
      tag: string,
      sourceSlices: unknown[],
      code: string,
      thrown: boolean,
      receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
    ): Promise<void> => {
      const negativeEnvelope = await preparedBuild({
        idempotencyKey: `wi216-003-${tag}`,
        sourceSlices,
      });
      const negative = await attemptBuild(negativeEnvelope);
      expect(negative, tag).toMatchObject({ code, thrown });
      await expectNoContextSnapshot(
        record(negativeEnvelope.targetRef).objectId as string,
        `wi216-003-${tag}`,
        receipt,
      );
    };
    // A duplicate entry and an empty set are closed by the registered Schema.
    await negativeCase('duplicate', [sliceARef, sliceARef], API_VALUE_INVALID, true, 'ABSENT');
    await negativeCase('empty', [], API_VALUE_INVALID, true, 'ABSENT');
    // A well-formed ref that names no committed Slice rejects in the handler.
    await negativeCase(
      'unknown-id',
      [{ ...sliceARef, objectId: newUuidV7() }],
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    // OBSERVED DISAGREEMENT (header note): the owning EP read reports a hash
    // mismatch as PROJECT_QUERY_REF_INVALID, which the entry rethrows and the
    // handler maps onto a thrown DEPENDENCY_UNAVAILABLE — not the matrix's
    // rejected EXECUTION_CONTEXT_SOURCE_INVALID.
    await negativeCase(
      'wrong-hash',
      [{ ...sliceARef, contentHash: contentHash('0'.repeat(64)) }],
      DEPENDENCY_UNAVAILABLE,
      true,
      'ABSENT',
    );
    await negativeCase(
      'wrong-scope',
      [{ ...sliceARef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } }],
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    await negativeCase(
      'wrong-kind',
      [{ ...sliceARef, kind: 'OBJECT' }],
      API_VALUE_INVALID,
      true,
      'ABSENT',
    );
    // The unit-layer half of the duplicate closure.
    const duplicateUnit = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: sliceARef, slice: sliceA },
          { ref: sliceARef, slice: sliceA },
        ],
      }),
    );
    expect(duplicateUnit).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
  });

  itIntegration('TE-214-D-004 fails closed on every source/policy counter-example', async () => {
    const rejectBuild = async (
      tag: string,
      input: Partial<BuildInput>,
      code: string,
      thrown: boolean,
      entry: InitialContextEntry = initialContextEntry,
      receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
    ): Promise<void> => {
      const envelope = await preparedBuild({ idempotencyKey: `wi216-004-${tag}`, ...input });
      const attempt = await attemptBuild(envelope, entry);
      expect(attempt, tag).toMatchObject({ code, thrown });
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-004-${tag}`,
        receipt,
      );
    };

    // The audience must be the Slice audience exactly: another principal id and
    // another principal kind both fail the assembly closure.
    await rejectBuild(
      'audience-other',
      { audience: { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' } },
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    await rejectBuild(
      'audience-kind',
      { audience: { principalId: OPERATOR, principalKind: 'AGENT' } },
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    // EXPIRED and REVOKED slices are owning-read lifecycle states.
    const moved = new Date(clock + 300_000);
    await rejectBuild(
      'slice-expired',
      { sourceSlices: [sliceTTLRef], decisionNow: moved },
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
      entryFor({ now: () => moved }),
    );
    await rejectBuild(
      'slice-revoked',
      { sourceSlices: [sliceRevokedRef] },
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    // A Slice captured for another purpose never closes against the request.
    await rejectBuild(
      'slice-purpose',
      { sourceSlices: [sliceCRef] },
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );

    // Builder Policy lifecycle and binding counter-examples (§11.2.5.1-2).
    const supersededCommandId = newUuidV7();
    await rejectBuild(
      'policy-superseded',
      {
        builderPolicyRef: policyKey(BUILDER_POLICY.supersededFirst, fixture),
        commandId: supersededCommandId,
      },
      POLICY_EXPIRED,
      false,
    );
    // The rejected command leaves its safe Audit record (§19.6 item 3).
    expect(await auditRows(supersededCommandId)).toEqual([
      { outcome: 'REJECTED', error_code: POLICY_EXPIRED, safe_summary: expect.any(String) },
    ]);
    await rejectBuild(
      'policy-future',
      { builderPolicyRef: policyKey(BUILDER_POLICY.future, fixture) },
      POLICY_NOT_EFFECTIVE,
      false,
    );
    await rejectBuild(
      'policy-no-projection',
      { builderPolicyRef: policyKey(BUILDER_POLICY.noProjection, fixture) },
      'INVALID_POLICY_BINDING',
      false,
    );
    await rejectBuild(
      'policy-wrong-profile',
      { builderPolicyRef: policyKey(BUILDER_POLICY.wrongProfile, fixture) },
      'INVALID_POLICY_BINDING',
      false,
    );
    // The DRAFT pins another Builder Policy version: the four-point binding
    // refuses the request's ref (§11.2.5.1 row 2).
    const altTask = await createExecutableTask('2.0');
    const altWorkOrder = await createWorkOrder({
      taskId: altTask,
      taskMajor: '2.0',
      builderPolicyPair: BUILDER_POLICY.alt,
    });
    await rejectBuild(
      'policy-pin-mismatch',
      { workOrderId: altWorkOrder },
      'POLICY_REF_MISMATCH',
      false,
    );
    // A non-Policy ref spelling is pinned out by the registered Schema.
    await rejectBuild(
      'policy-wrong-type',
      {
        builderPolicyRef: {
          kind: 'VERSIONED',
          objectType: WORK_ORDER_V11,
          objectId: newUuidV7(),
          versionId: newUuidV7(),
          scope: scope(),
        },
      },
      API_VALUE_INVALID,
      true,
      initialContextEntry,
      'ABSENT',
    );
    // An ENTERPRISE-scoped Policy ref passes the handler gate, but the owning
    // resolution cannot authorize it under the Project-scoped actor: the
    // boundary fails closed as unavailable (header note; no Policy exists
    // there either way).
    await rejectBuild(
      'policy-enterprise-scope',
      {
        builderPolicyRef: {
          kind: 'VERSIONED',
          objectType: POLICY_OBJECT,
          objectId: BUILDER_POLICY.main[0],
          versionId: BUILDER_POLICY.main[1],
          scope: { enterpriseId: fixture.enterpriseId },
        },
      },
      DEPENDENCY_UNAVAILABLE,
      true,
      initialContextEntry,
      'ABSENT',
    );

    // The unit-layer counter-examples the registered Schemas close before a
    // DRAFT exists (header note): each runs the owning assembly on the real
    // committed slice payloads with exactly one dimension broken.
    const sliceA = await slicePayloadOf(sliceARef.objectId);
    const unitReject = async (
      tag: string,
      mutate: (slice: Record<string, unknown>) => void,
      code: string = EXECUTION_CONTEXT_SOURCE_INVALID,
    ): Promise<void> => {
      const mutated = structuredClone(sliceA);
      mutate(mutated);
      const outcome = assembleInitialContext(
        await unitAssemblyInput({ slices: [{ ref: sliceARef, slice: mutated }] }),
      );
      expect(outcome, tag).toMatchObject({ outcome: 'REJECTED', errorCode: code });
    };
    // A fact item missing a member / with an off-table status / riskLevel.
    await unitReject('fact-missing-member', (slice) => {
      delete record((record(slice.source).factItems as unknown[])[0]).riskLevel;
    });
    await unitReject('fact-off-table-status', (slice) => {
      record((record(slice.source).factItems as unknown[])[0]).status = 'ARCHIVED';
    });
    await unitReject('fact-off-table-risk', (slice) => {
      record((record(slice.source).factItems as unknown[])[0]).riskLevel = 'SEVERE';
    });
    // The slices must agree on the manifest singletons and the Project.
    const sliceB = await slicePayloadOf(sliceBRef.objectId);
    const manifestConflict = structuredClone(sliceB);
    record(manifestConflict.source).enterpriseProfileSnapshotRef = {
      ...record(record(sliceB.source).enterpriseProfileSnapshotRef),
      objectId: newUuidV7(),
    };
    const conflict = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: sliceARef, slice: sliceA },
          { ref: sliceBRef, slice: manifestConflict },
        ],
      }),
    );
    expect(conflict).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
    await unitReject('project-ref', (slice) => {
      record(record(slice.source).projectRef).objectId = newUuidV7();
    });
    // An omission with an off-table reasonCode fails closed.
    await unitReject('omission-reason', (slice) => {
      ((record(slice.source).omissions as unknown[])[0] as Record<string, unknown>).reasonCode =
        'MADE_UP';
    });
    // A null validUntil is not a string member.
    await unitReject('valid-until-null', (slice) => {
      slice.validUntil = null;
    });
    // Two slices may not carry the same Fact subject identity.
    const twinId = newUuidV7();
    const twin = structuredClone(sliceA);
    twin.sliceId = twinId;
    const twinRef = {
      ...sliceARef,
      objectId: twinId,
      contentHash: contentHash(createHash('sha256').update('wi216-004-twin').digest('hex')),
    };
    const duplicateSubject = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: sliceARef, slice: sliceA },
          { ref: twinRef, slice: twin },
        ],
      }),
    );
    expect(duplicateSubject).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
  });

  itIntegration('TE-214-D-005 fails closed on unavailable dependencies', async () => {
    // A dead EnterpriseProject pool: the owning Slice read never answers; the
    // claim rolls back and the same key succeeds once the boundary is back.
    const deadEpPool = new pg.Pool({ connectionString: probeUrl, max: 1 });
    await deadEpPool.end();
    const sliceDownEnvelope = await preparedBuild({ idempotencyKey: 'wi216-005-ep' });
    const sliceDown = await attemptBuild(
      sliceDownEnvelope,
      entryFor({ enterpriseProjectDb: createEnterpriseProjectDatabase(deadEpPool) }),
    );
    expect(sliceDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await expectNoContextSnapshot(
      record(sliceDownEnvelope.targetRef).objectId as string,
      'wi216-005-ep',
      'ABSENT',
    );
    const sliceBack = await attemptBuild(sliceDownEnvelope);
    expect(sliceBack, JSON.stringify(sliceBack)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // A dead IdentityPolicy pool: the Decision read itself is unavailable.
    const deadIpPool = new pg.Pool({ connectionString: probeUrl, max: 1 });
    await deadIpPool.end();
    const policyDownEnvelope = await preparedBuild({ idempotencyKey: 'wi216-005-ip' });
    const policyDown = await attemptBuild(
      policyDownEnvelope,
      entryFor({ identityDb: createIdentityPolicyDatabase(deadIpPool) }),
    );
    expect(policyDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await expectNoContextSnapshot(
      record(policyDownEnvelope.targetRef).objectId as string,
      'wi216-005-ip',
      'ABSENT',
    );

    // A dead TaskExecution pool surfaces the raw pg driver error from the
    // composition boundary — no stable module code exists at that layer
    // (header note); the closure is "thrown, no claim, no row".
    const deadTePool = new pg.Pool({ connectionString: probeUrl, max: 1 });
    await deadTePool.end();
    const storeDownEnvelope = await preparedBuild({ idempotencyKey: 'wi216-005-te' });
    const storeDown = await attemptBuild(
      storeDownEnvelope,
      entryFor({ taskExecutionDb: createTaskExecutionDatabase(deadTePool) }),
    );
    expect(storeDown.thrown).toBe(true);
    await expectNoContextSnapshot(
      record(storeDownEnvelope.targetRef).objectId as string,
      'wi216-005-te',
      'ABSENT',
    );

    // A revoked dependency Grant fails the internal reads fail-closed; the
    // re-grant restores the path (wi212 convention).
    const revokedSliceRead = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantSliceRead,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_SLICE_READ_REVOKE',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantSliceRead}`,
    });
    expect(revokedSliceRead.status).toBe('COMMITTED');
    const grantDownEnvelope = await preparedBuild({ idempotencyKey: 'wi216-005-grant' });
    const grantDown = await attemptBuild(grantDownEnvelope);
    expect(grantDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await expectNoContextSnapshot(
      record(grantDownEnvelope.targetRef).objectId as string,
      'wi216-005-grant',
      'ABSENT',
    );
    grantSliceRead = await grantGeneric(dependencyCapabilities.readContextSourceSlice);
    const grantBack = await attemptBuild(grantDownEnvelope);
    expect(grantBack, JSON.stringify(grantBack)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // The Policy resolution read is its own dependency with its own Grant.
    const revokedResolve = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantResolve,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_RESOLVE_REVOKE',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantResolve}`,
    });
    expect(revokedResolve.status).toBe('COMMITTED');
    const resolveDownEnvelope = await preparedBuild({ idempotencyKey: 'wi216-005-resolve' });
    const resolveDown = await attemptBuild(resolveDownEnvelope);
    expect(resolveDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await expectNoContextSnapshot(
      record(resolveDownEnvelope.targetRef).objectId as string,
      'wi216-005-resolve',
      'ABSENT',
    );
    grantResolve = await grantGeneric(dependencyCapabilities.resolvePolicy);
    expect(await attemptBuild(resolveDownEnvelope)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
  });

  itIntegration('TE-214-D-006 executes the §11.2.5.4 expiry matrix', async () => {
    // The default build's effective expiry bound: the earliest slice
    // `validUntil` (the DRAFT creation expiry sits 24h out, the Builder Policy
    // has no successor).
    const sliceBound = (await slicePayloadOf(sliceARef.objectId)).validUntil as string;

    // ① No `expiresAt` member: the bound becomes the declared payload expiry.
    const omittedEnvelope = await preparedBuild({ idempotencyKey: 'wi216-006-omitted' });
    const omitted = await attemptBuild(omittedEnvelope);
    expect(omitted, JSON.stringify(omitted)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (omitted.result === undefined) throw new Error('omitted-expiry build did not commit');
    const omittedTarget = record(omittedEnvelope.targetRef).objectId as string;
    const omittedRow = await contextSnapshotRow(omittedTarget);
    expect(omittedRow?.canonical_payload.expiresAt).toBe(sliceBound);
    expect(omittedRow?.expires_at?.toISOString()).toBe(sliceBound);
    expect(omittedRow?.effective_expires_at?.toISOString()).toBe(sliceBound);
    const omittedBuild = await contextSnapshotBuildRow(
      contextSnapshotRefOf(omitted.result).snapshotId,
    );
    expect(omittedBuild?.request_expires_at).toBeNull();
    expect(Object.hasOwn(omittedBuild?.canonical_payload ?? {}, 'requestExpiresAt')).toBe(false);
    expect(omittedBuild?.effective_expires_at?.toISOString()).toBe(sliceBound);

    // ② A request expiry exactly at the bound closes, and the declared member
    // is recorded as `requestExpiresAt` (a different content address from ①).
    const equalEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-006-equal',
      expiry: { present: true, value: sliceBound },
    });
    const equal = await attemptBuild(equalEnvelope);
    expect(equal, JSON.stringify(equal)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (equal.result === undefined) throw new Error('equal-expiry build did not commit');
    const equalTarget = record(equalEnvelope.targetRef).objectId as string;
    const equalRow = await contextSnapshotRow(equalTarget);
    expect(equalRow?.canonical_payload.expiresAt).toBe(sliceBound);
    const equalBuild = await contextSnapshotBuildRow(contextSnapshotRefOf(equal.result).snapshotId);
    expect(equalBuild?.request_expires_at?.toISOString()).toBe(sliceBound);
    expect(record(equalBuild?.canonical_payload).requestExpiresAt).toBe(sliceBound);
    if (omittedRow === undefined || equalRow === undefined) throw new Error('expiry rows missing');
    expect(equalRow.payload_hash.equals(omittedRow.payload_hash)).toBe(false);

    // ③ One second past the bound: the closed binding rejection.
    const overBound = new Date(new Date(sliceBound).getTime() + 1_000).toISOString();
    const overEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-006-over',
      expiry: { present: true, value: overBound },
    });
    const over = await attemptBuild(overEnvelope);
    expect(over).toMatchObject({ code: 'EXPIRY_UPPER_BOUND_EXCEEDED', thrown: false });
    await expectNoContextSnapshot(
      record(overEnvelope.targetRef).objectId as string,
      'wi216-006-over',
    );

    // ④ Sub-second precision survives end to end: the declared text lands in
    // the payload verbatim and the column keeps microseconds.
    const precise = new Date(Math.floor((clock + 10_000) / 1_000) * 1_000)
      .toISOString()
      .replace('.000Z', '.123456Z');
    const preciseEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-006-precise',
      expiry: { present: true, value: precise },
    });
    const preciseAttempt = await attemptBuild(preciseEnvelope);
    expect(preciseAttempt, JSON.stringify(preciseAttempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const preciseTarget = record(preciseEnvelope.targetRef).objectId as string;
    const preciseRow = await contextSnapshotRow(preciseTarget);
    expect(preciseRow?.canonical_payload.expiresAt).toBe(precise);
    const rendered = (
      await admin.query<{ rendered: string }>(
        `SELECT expires_at::text AS rendered
           FROM task_execution.context_snapshot WHERE object_id = $1`,
        [preciseTarget],
      )
    ).rows.at(0);
    expect(rendered?.rendered).toContain('.123456');

    // ⑤ A calendar-invalid instant passes the registered spelling pattern and
    // is refused by the owning expiry binding (parseUtcInstant).
    const malformedEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-006-malformed',
      expiry: { present: true, value: '2026-02-30T00:00:00.000Z' },
    });
    const malformed = await attemptBuild(malformedEnvelope);
    expect(malformed).toMatchObject({ code: 'INVALID_EXPIRY_INPUT', thrown: false });
    await expectNoContextSnapshot(
      record(malformedEnvelope.targetRef).objectId as string,
      'wi216-006-malformed',
    );

    // ⑥ A JSON-null member is no instant spelling: the registered Schema.
    const nullEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-006-null',
      expiry: { present: true, value: null },
    });
    const nullAttempt = await attemptBuild(nullEnvelope);
    expect(nullAttempt).toMatchObject({ code: API_VALUE_INVALID, thrown: true });
    await expectNoContextSnapshot(
      record(nullEnvelope.targetRef).objectId as string,
      'wi216-006-null',
      'ABSENT',
    );

    // ⑦ The DRAFT-crossing branch is TE-214-D-002's expired case: the binding
    // rejects one step before the unreachable commit-point re-check (header).
  });

  itIntegration('TE-214-D-007 refuses principal and Decision substitution', async () => {
    // A Decision minted for another principal never covers this actor: the
    // second Human holds the same build capability and mints its own Decision
    // for the same payload digest, presented under the operator actor.
    await grant({
      principal: other(),
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const substituted = await preparedBuild({ idempotencyKey: 'wi216-007-other-decision' });
    substituted.authorizationDecisionRef = await issueBuildDecision({
      principal: other(),
      targetId: record(substituted.targetRef).objectId as string,
      payloadHash: digestCanonicalPayload(substituted.payload as CanonicalJsonObject).hash,
    });
    const substitutedAttempt = await attemptBuild(substituted);
    expect(substitutedAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await expectNoContextSnapshot(
      record(substituted.targetRef).objectId as string,
      'wi216-007-other-decision',
      'ABSENT',
    );

    // The Envelope actor member naming another principal under the operator's
    // own Decision fails the actor binding.
    const actorSwap = await preparedBuild({ idempotencyKey: 'wi216-007-actor' });
    actorSwap.actor = {
      kind: 'OBJECT',
      objectType: PRINCIPAL_OBJECT,
      objectId: OTHER_PRINCIPAL,
      scope: scope(),
    };
    const actorSwapAttempt = await attemptBuild(actorSwap);
    expect(actorSwapAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await expectNoContextSnapshot(
      record(actorSwap.targetRef).objectId as string,
      'wi216-007-actor',
      'ABSENT',
    );

    // A read Decision never covers the build (COMMAND_MISMATCH).
    const readDecisionEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-007-read-decision',
    });
    readDecisionEnvelope.authorizationDecisionRef = await issueReadDecision({
      targetId: record(readDecisionEnvelope.targetRef).objectId as string,
      payloadHash: digestCanonicalPayload(readDecisionEnvelope.payload as CanonicalJsonObject).hash,
    });
    const readDecisionAttempt = await attemptBuild(readDecisionEnvelope);
    expect(readDecisionAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await expectNoContextSnapshot(
      record(readDecisionEnvelope.targetRef).objectId as string,
      'wi216-007-read-decision',
      'ABSENT',
    );

    // A build Decision never covers the read — the Snapshot need not exist,
    // the revalidation fires first.
    const readPayload = {
      contextSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: CONTEXT_SNAPSHOT_OBJECT,
        objectId: newUuidV7(),
        snapshotId: newUuidV7(),
        scope: scope(),
        contentHash: contentHash('0'.repeat(64)),
      },
    };
    const buildDecisionForRead = await issueBuildDecision({
      targetId: record(readPayload.contextSnapshotRef).objectId as string,
      payloadHash: digestCanonicalPayload(readPayload as unknown as CanonicalJsonObject).hash,
    });
    const mismatchedRead = await attemptRead(
      readEnvelope({
        snapshotRef: readPayload.contextSnapshotRef,
        decisionRef: buildDecisionForRead,
      }),
    );
    expect(mismatchedRead).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });

    // `actingFor` is not a member of the registered request shape.
    const actingFor = await preparedBuild({
      idempotencyKey: 'wi216-007-acting-for',
      requestMutate: (request) => {
        request.actingFor = { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' };
      },
    });
    const actingForAttempt = await attemptBuild(actingFor);
    expect(actingForAttempt).toMatchObject({ code: API_VALUE_INVALID, thrown: true });
    await expectNoContextSnapshot(
      record(actingFor.targetRef).objectId as string,
      'wi216-007-acting-for',
      'ABSENT',
    );

    // A Decision minted for another target never covers this target.
    const transferred = await preparedBuild({ idempotencyKey: 'wi216-007-target' });
    transferred.authorizationDecisionRef = await issueBuildDecision({
      targetId: newUuidV7(),
      payloadHash: digestCanonicalPayload(transferred.payload as CanonicalJsonObject).hash,
    });
    const transferredAttempt = await attemptBuild(transferred);
    expect(transferredAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await expectNoContextSnapshot(
      record(transferred.targetRef).objectId as string,
      'wi216-007-target',
      'ABSENT',
    );
  });

  itIntegration('TE-214-D-008 revalidates before claim and historical replay', async () => {
    const key = 'wi216-008-build';
    const envelope = await preparedBuild({ idempotencyKey: key });
    const committed = await attemptBuild(envelope);
    expect(committed, JSON.stringify(committed)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (committed.result === undefined) throw new Error('the 008 build did not commit');
    // The fresh-key envelope's Decision is minted before the revocation: the
    // mint itself legitimately requires the covering Grant.
    const freshEnvelope = await preparedBuild({ idempotencyKey: 'wi216-008-fresh' });

    // Revoke the one covering Grant: the revalidation runs before the claim,
    // so even the byte-identical historical replay is refused, and the
    // committed Receipt stays the only row of the key.
    const revoked = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantCtxBuild,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_REVOKE_BUILD',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantCtxBuild}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    const replay = await attemptBuild(envelope);
    expect(replay).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    expect(await receiptRows(key)).toHaveLength(1);
    const fresh = await attemptBuild(freshEnvelope);
    expect(fresh).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    await expectNoContextSnapshot(
      record(freshEnvelope.targetRef).objectId as string,
      'wi216-008-fresh',
      'ABSENT',
    );

    // Re-grant: the historical replay returns the original COMMITTED result.
    grantCtxBuild = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const duplicate = await attemptBuild(envelope);
    expect(duplicate).toMatchObject({ code: 'DUPLICATE', thrown: false });
    if (duplicate.result?.status !== 'DUPLICATE') throw new Error('expected a DUPLICATE replay');
    expect(duplicate.result.originalOutcome).toBe('COMMITTED');
    expect(duplicate.result.resultPayload).toEqual(committedPayload(committed.result));

    // An expired Decision: minted under the real clock with the Port's
    // 300-second TTL, so the platform context gate (which compares the
    // Decision expiry against the real wall clock) still accepts it; the
    // entry's trusted instant sits past that window, so the Port's own
    // EXPIRED check answers. A Decision already expired under the real clock
    // never reaches that check — the gate refuses it and the entry folds the
    // refusal into a thrown DEPENDENCY_UNAVAILABLE (header note).
    const expiredEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-008-expired',
      decisionNow: new Date(),
    });
    const expired = await attemptBuild(
      expiredEnvelope,
      entryFor({ now: () => new Date(Date.now() + 600_000) }),
    );
    expect(expired).toMatchObject({ code: AUTHORIZATION_EXPIRED, thrown: true });
    await expectNoContextSnapshot(
      record(expiredEnvelope.targetRef).objectId as string,
      'wi216-008-expired',
      'ABSENT',
    );

    // A drifted trusted capability configuration: the code the composition
    // pins no longer equals the code the covering Grant was issued under.
    const driftedEnvelope = await preparedBuild({ idempotencyKey: 'wi216-008-drifted' });
    const drifted = await attemptBuild(
      driftedEnvelope,
      entryFor({
        capabilityCodes: {
          ...contextSnapshotCapabilityCodes,
          contextSnapshotBuildV11: 'wi216.cap.drifted',
        },
      }),
    );
    expect(drifted).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    await expectNoContextSnapshot(
      record(driftedEnvelope.targetRef).objectId as string,
      'wi216-008-drifted',
      'ABSENT',
    );
  });

  itIntegration('TE-214-D-009 scopes idempotency to one build', async () => {
    const key = 'wi216-009-seed';
    const workOrder = await createWorkOrder({
      taskId: await createExecutableTask('2.0'),
      taskMajor: '2.0',
    });
    const envelope = await preparedBuild({ idempotencyKey: key, workOrderId: workOrder });
    const targetId = record(envelope.targetRef).objectId as string;
    const committed = await attemptBuild(envelope);
    expect(committed, JSON.stringify(committed)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (committed.result === undefined) throw new Error('the 009 seed build did not commit');

    // The exact replay is the stored COMMITTED fact; nothing new is written.
    const snapshotCount = await countRows('task_execution.context_snapshot');
    const replay = await attemptBuild(envelope);
    expect(replay).toMatchObject({ code: 'DUPLICATE', thrown: false });
    if (replay.result?.status !== 'DUPLICATE') throw new Error('expected a DUPLICATE replay');
    expect(replay.result.originalOutcome).toBe('COMMITTED');
    expect(replay.result.resultPayload).toEqual(committedPayload(committed.result));
    expect(await receiptRows(key)).toHaveLength(1);
    expect(await countRows('task_execution.context_snapshot')).toBe(snapshotCount);
    expect(await outboxRows(targetId)).toHaveLength(1);

    // The same key over another payload is a conflict: audited as DENIED and
    // thrown; the committed Receipt is untouched.
    const otherWorkOrder = await createWorkOrder({
      taskId: await createExecutableTask('2.0'),
      taskMajor: '2.0',
    });
    const conflictCommandId = newUuidV7();
    const conflictEnvelope = await preparedBuild({
      idempotencyKey: key,
      workOrderId: otherWorkOrder,
      targetId,
      commandId: conflictCommandId,
    });
    const conflict = await attemptBuild(conflictEnvelope);
    expect(conflict).toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT, thrown: true });
    expect(await auditRows(conflictCommandId)).toEqual([
      {
        outcome: 'DENIED',
        error_code: IDEMPOTENCY_PAYLOAD_CONFLICT,
        safe_summary: 'same idempotency key replayed with a different request hash',
      },
    ]);
    expect(await receiptRows(key)).toHaveLength(1);

    // A second build of the same target under another key: the Scope-unique
    // CREATE identity is taken — the stable business rejection, not an error.
    const secondEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-009-second',
      workOrderId: otherWorkOrder,
      targetId,
    });
    const second = await attemptBuild(secondEnvelope);
    expect(second).toMatchObject({ code: CONCURRENCY_CONFLICT, thrown: false });
    expect(await countRows('task_execution.context_snapshot')).toBe(snapshotCount);

    // The claim Scope string carries commandType@commandVersion: the two
    // registered build versions never share a claim.
    expect(
      buildInitialContextIdempotencyScope(
        BUILD_COMMAND,
        '1.0',
        fixture.enterpriseId,
        fixture.projectId,
      ),
    ).not.toBe(
      buildInitialContextIdempotencyScope(
        BUILD_COMMAND,
        BUILD_VERSION,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
  });

  itIntegration('TE-214-D-010 resolves concurrent builds', async () => {
    // Two different-key builds of one target: exactly one wins the Scope-unique
    // CREATE identity; the loser records the stable business rejection.
    const targetId = newUuidV7();
    const [left, right] = await Promise.all([
      attemptBuild(await preparedBuild({ idempotencyKey: 'wi216-010-left', targetId })),
      attemptBuild(await preparedBuild({ idempotencyKey: 'wi216-010-right', targetId })),
    ]);
    const pair = [left, right];
    expect(
      pair.filter((outcome) => outcome.code === 'COMMITTED' && !outcome.thrown),
      JSON.stringify(pair),
    ).toHaveLength(1);
    expect(
      pair.filter((outcome) => outcome.code === CONCURRENCY_CONFLICT && !outcome.thrown),
    ).toHaveLength(1);
    const winnerRows = (
      await admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
        [targetId],
      )
    ).rows.at(0);
    expect(winnerRows?.n).toBe(1);

    // The same Envelope claimed twice concurrently: exactly one COMMITTED, and
    // the loser either observes the committed Receipt (DUPLICATE) or the
    // in-flight claim (COMMAND_IN_PROGRESS) — the §19.8(3) claim protocol is
    // the only accepted resolution, and the concurrent pair itself must
    // produce it. A thrown error outside that protocol invalidates the attempt
    // only when it is positively identified as an infrastructure failure
    // (`isInfrastructureFailure`: a Node errno, a pg driver connection
    // lifecycle message, or a connection/operator-intervention SQLSTATE; the
    // PR #217 round-5 CI failure carried no exteriors, so its code is
    // unknowable and the identification stays strict); the pair is then
    // re-driven under a fresh Envelope identity. A fulfilled result outside
    // the protocol, a thrown stable module/authorization code or an
    // unclassified throw (both fail closed below), a double COMMITTED, or a
    // third consecutive escape is a defect, never a retry.
    const raceLog: { attempt: number; exteriors: { code: string; message?: string }[] }[] = [];
    let validTarget: string | undefined;
    for (let attempt = 1; attempt <= 3 && validTarget === undefined; attempt += 1) {
      const sameEnvelope = await preparedBuild({ idempotencyKey: `wi216-010-same-${attempt}` });
      const sameTarget = record(sameEnvelope.targetRef).objectId as string;
      const settled = await Promise.allSettled([
        initialContextEntry.build(sameEnvelope, sessionFor()),
        initialContextEntry.build(sameEnvelope, sessionFor()),
      ]);
      const exteriors = settled.map((outcome): { code: string; message?: string } =>
        outcome.status === 'fulfilled'
          ? { code: resultCode(outcome.value) }
          : { code: failureOf(outcome.reason).code, message: failureOf(outcome.reason).message },
      );
      raceLog.push({ attempt, exteriors });
      const codes = exteriors.map((exterior) => exterior.code);
      const inProtocol = (index: number): boolean => {
        const code = codes[index];
        return code === 'COMMITTED' || code === 'DUPLICATE' || code === COMMAND_IN_PROGRESS;
      };
      // A fulfilled result outside the claim protocol is a business defect,
      // never a transient escape: fail instead of invalidating the attempt.
      expect(
        settled.filter((outcome, index) => outcome.status === 'fulfilled' && !inProtocol(index)),
        JSON.stringify(raceLog),
      ).toHaveLength(0);
      // A thrown escape invalidates the attempt only on positive
      // infrastructure identification; a thrown stable module or
      // authorization code (a thrown COMMAND_IN_PROGRESS is a protocol
      // result, not an escape) and every unclassified throw fail closed with
      // both exteriors attached.
      expect(
        settled.filter((outcome, index) => {
          if (outcome.status !== 'rejected') return false;
          if (codes[index] === COMMAND_IN_PROGRESS) return false;
          return !isInfrastructureFailure(outcome.reason);
        }),
        JSON.stringify(raceLog),
      ).toHaveLength(0);
      // Exactly-once effect holds even for an invalidated attempt: never more
      // than one Snapshot row for the attempted target.
      const attemptRows = (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
          [sameTarget],
        )
      ).rows.at(0);
      expect(attemptRows?.n, JSON.stringify(raceLog)).toBeLessThanOrEqual(1);
      if (
        codes.filter((code) => code === 'COMMITTED').length === 1 &&
        codes.filter((code) => code === 'DUPLICATE' || code === COMMAND_IN_PROGRESS).length === 1
      ) {
        validTarget = sameTarget;
      }
    }
    // The race evidence is a concurrent pair resolved inside the claim
    // protocol; three consecutive escapes are a systematic defect, not a flake.
    if (validTarget === undefined) {
      throw new Error(
        `the same-Envelope race never resolved inside the claim protocol: ${JSON.stringify(raceLog)}`,
      );
    }
    const sameRows = (
      await admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
        [validTarget],
      )
    ).rows.at(0);
    expect(sameRows?.n).toBe(1);

    // NOT RUN: the Builder × Freeze/WorkOrder-transition race — neither a
    // Freeze nor a WorkOrder status transition is delivered in this slice
    // (header note).
  });

  itIntegration('TE-214-D-011 rolls back injected faults', async () => {
    // Harvest one committed build's exact stored facts.
    const seedCommandId = newUuidV7();
    const seedEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-011-seed',
      commandId: seedCommandId,
    });
    const seed = await attemptBuild(seedEnvelope);
    expect(seed, JSON.stringify(seed)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const seedTarget = record(seedEnvelope.targetRef).objectId as string;
    const seedRow = await contextSnapshotRow(seedTarget);
    if (seedRow === undefined) throw new Error('the 011 seed snapshot is missing');
    const seedBuild = await contextSnapshotBuildRow(seedRow.snapshot_id);
    if (seedBuild === undefined) throw new Error('the 011 seed build row is missing');

    // The same writes with a fresh Snapshot identity and target, then the
    // injected fault after the Outbox write (the runner's controlled fault).
    const faultKey = 'wi216-011-fault';
    const faultTarget = newUuidV7();
    const faultSnapshotId = newUuidV7();
    const faultCommandId = newUuidV7();
    const clonedPayload = structuredClone(seedRow.canonical_payload);
    clonedPayload.contextSnapshotId = faultSnapshotId;
    const clonedHeader = record(clonedPayload.header);
    clonedHeader.contractId = faultSnapshotId;
    const clonedSchemaRef = record(clonedHeader.schemaRef);
    clonedSchemaRef.objectId = faultSnapshotId;
    clonedSchemaRef.versionId = faultSnapshotId;
    const clonedDigest = digestCanonicalPayload(clonedPayload as CanonicalJsonObject);
    const requestPayloadHash = digestCanonicalPayload(
      seedEnvelope.payload as CanonicalJsonObject,
    ).hash;
    const clonedExpiry =
      typeof clonedPayload.expiresAt === 'string' ? clonedPayload.expiresAt : undefined;
    const metadataDigest = digestCanonicalPayload(
      seedBuild.canonical_payload as CanonicalJsonObject,
    );
    const faultDrive = track(
      executeTaskExecutionCommand(
        teDb,
        runnerContext(),
        {
          commandId: faultCommandId,
          commandType: BUILD_COMMAND,
          commandVersion: BUILD_VERSION,
          // The same claim Scope the composition entry derives: the retry below
          // enters through the entry and must find nothing claimed.
          idempotencyScope: buildInitialContextIdempotencyScope(
            BUILD_COMMAND,
            BUILD_VERSION,
            fixture.enterpriseId,
            fixture.projectId,
          ),
          idempotencyKey: faultKey,
          requestPayload: seedEnvelope.payload as CanonicalJsonObject,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType: CONTEXT_SNAPSHOT_OBJECT,
          targetId: faultTarget,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId: POLICY_SNAPSHOT_ID,
        },
        async (execution) => {
          const inserted = await execution.insertContextSnapshot({
            snapshotId: faultSnapshotId,
            objectId: faultTarget,
            purpose: seedRow.purpose,
            audience: seedRow.audience,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            builderVersion: BUILD_VERSION,
            policySnapshotId: seedRow.policy_snapshot_id,
            sourceManifestCount: seedRow.source_manifest_count,
            contextItemCount: seedRow.context_item_count,
            omissionCount: seedRow.omission_count,
            redactionCount: seedRow.redaction_count,
            coverageState: seedRow.coverage_state,
            payloadHash: clonedDigest.hash,
            expiresAt: clonedExpiry,
            effectiveExpiresAt: clonedExpiry,
            requestPayloadHash,
            sourceCommandId: faultCommandId,
            createdByPrincipalId: OPERATOR,
            canonicalPayload: clonedPayload as CanonicalJsonObject,
          });
          if (!inserted) throw new Error('the fault-drive target already exists');
          await execution.insertContextSnapshotBuild({
            snapshotId: faultSnapshotId,
            buildKind: 'INITIAL',
            draftSnapshotRef: seedBuild.draft_snapshot_ref as unknown as CanonicalJsonObject,
            sliceRefs: seedBuild.slice_refs as unknown as CanonicalJsonObject[],
            purpose: seedBuild.purpose,
            audience: seedBuild.audience as unknown as CanonicalJsonObject,
            builderPolicyRef: seedBuild.builder_policy_ref as unknown as CanonicalJsonObject,
            policyContentHash: seedBuild.policy_content_hash,
            policyEffectiveFrom: seedBuild.policy_effective_from.toISOString(),
            ...(seedBuild.effective_expires_at === null
              ? {}
              : { effectiveExpiresAt: seedBuild.effective_expires_at.toISOString() }),
            canonicalPayload: seedBuild.canonical_payload as CanonicalJsonObject,
            payloadHash: metadataDigest.hash,
            requestPayloadHash,
            sourceCommandId: faultCommandId,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            createdByPrincipalId: OPERATOR,
          });
          const edgeBase = {
            ownerObjectType: CONTEXT_SNAPSHOT_OBJECT,
            ownerObjectId: faultTarget,
            ownerVersionId: faultSnapshotId,
            ownerPayloadHash: clonedDigest.hash,
          };
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/draftSnapshotRef',
            targetModule: 'TaskExecution',
            targetObjectType: DRAFT_SNAPSHOT_OBJECT,
            targetObjectId: goldenDraftRef.objectId,
            targetPayloadHash: Buffer.from(goldenDraftRef.contentHash.digest, 'hex'),
            referencePurpose: 'CONTEXT_SNAPSHOT_DRAFT',
          });
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/projection/builderPolicyRef',
            targetModule: 'IdentityPolicy',
            targetObjectType: POLICY_OBJECT,
            targetObjectId: BUILDER_POLICY.main[0],
            targetVersionId: BUILDER_POLICY.main[1],
            referencePurpose: 'CONTEXT_SNAPSHOT_POLICY',
          });
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/sourceSlices/0',
            targetModule: 'EnterpriseProject',
            targetObjectType: SLICE_OBJECT,
            targetObjectId: sliceARef.objectId,
            targetPayloadHash: Buffer.from(sliceARef.contentHash.digest, 'hex'),
            referencePurpose: 'CONTEXT_SNAPSHOT_SOURCE_SLICE',
          });
          await execution.appendOutbox({
            eventId: newUuidV7(),
            eventType: 'execution.ContextSnapshotBuilt',
            // The runner drive skips the registry validation the real handler
            // performs; the stored six-member payload keeps the historical
            // no-`scopeMirror` posture (the runner's own mirror check).
            eventVersion: '1.1',
            aggregateType: CONTEXT_SNAPSHOT_OBJECT,
            aggregateId: faultTarget,
            aggregateVersion: '1',
            payload: {
              contextSnapshotRef: {
                kind: 'SNAPSHOT',
                objectType: CONTEXT_SNAPSHOT_OBJECT,
                objectId: faultTarget,
                snapshotId: faultSnapshotId,
                scope: scope(),
                contentHash: contentHash(clonedDigest.hash.toString('hex')),
              },
              workOrderRef: (await draftPayloadOf(goldenWorkOrderId)).workOrderRef,
              projectionType: 'COORDINATOR',
              coverageStatus: seedRow.coverage_state,
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            } as unknown as CanonicalJsonObject,
            occurredAt: new Date(clock),
          });
          return execution.failAfterOutbox();
        },
      ),
    );
    await expect(faultDrive).rejects.toMatchObject({ code: 'INJECTED_FAULT' });

    // The whole owning transaction rolled back: no Snapshot, no metadata, no
    // Edge, no Outbox row, no Receipt — under the same claim Scope the entry
    // itself derives.
    expect(await contextSnapshotRow(faultTarget)).toBeUndefined();
    expect(await contextSnapshotBuildRow(faultSnapshotId)).toBeUndefined();
    expect(await edgeRows(faultTarget)).toEqual([]);
    expect(await outboxRows(faultTarget)).toEqual([]);
    expect(await receiptRows(faultKey)).toEqual([]);

    // The same idempotency key through the entry commits cleanly afterwards.
    const retryEnvelope = await preparedBuild({
      idempotencyKey: faultKey,
      targetId: faultTarget,
    });
    const retry = await attemptBuild(retryEnvelope);
    expect(retry, JSON.stringify(retry)).toMatchObject({ code: 'COMMITTED', thrown: false });
    expect(await edgeRows(faultTarget)).toHaveLength(3);
    expect(await outboxRows(faultTarget)).toHaveLength(1);
  });

  itIntegration('TE-214-D-012 rejects direct forgery at the database', async () => {
    // One real build supplies the faithful baseline every forgery starts from.
    const seedCommandId = newUuidV7();
    const seedEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-012-seed',
      commandId: seedCommandId,
    });
    const seed = await attemptBuild(seedEnvelope);
    expect(seed, JSON.stringify(seed)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const seedTarget = record(seedEnvelope.targetRef).objectId as string;
    const seedRowRead = await contextSnapshotRow(seedTarget);
    if (seedRowRead === undefined) throw new Error('the 012 seed snapshot is missing');
    const seedRow = seedRowRead;
    const seedBuildRead = await contextSnapshotBuildRow(seedRow.snapshot_id);
    if (seedBuildRead === undefined) throw new Error('the 012 seed build row is missing');
    const seedBuild = seedBuildRead;
    const seedRequestHash = digestCanonicalPayload(
      seedEnvelope.payload as CanonicalJsonObject,
    ).hash;

    interface SnapshotForgery {
      readonly targetId?: string;
      readonly snapshotId?: string;
      readonly payloadMutate?: (payload: Record<string, unknown>) => void;
      readonly columns?: {
        readonly payloadHash?: Buffer;
        readonly coverageState?: string;
        readonly omitExpiry?: boolean;
        readonly requestPayloadHash?: Buffer;
        readonly sourceCommandId?: string;
        readonly createdByPrincipalId?: string;
      };
      readonly buildDraftRef?: unknown;
      readonly skipSnapshot?: boolean;
      readonly rawSql?: boolean;
      readonly envelopeTargetId?: string;
    }

    /**
     * Drives one forged write inside a real claimed command (same envelope
     * shape as TE-214-D-011): the Receipt is PENDING, the trusted context is
     * the operator's, and the only false dimension is the one the case names.
     * Returns the failure the database or the repository reported.
     */
    async function forgeSnapshot(
      input: SnapshotForgery = {},
    ): Promise<{ code: string; message: string } | null> {
      const targetId = input.targetId ?? newUuidV7();
      const snapshotId = input.snapshotId ?? newUuidV7();
      const commandId = newUuidV7();
      const payload = structuredClone(seedRow.canonical_payload);
      payload.contextSnapshotId = snapshotId;
      const header = record(payload.header);
      header.contractId = snapshotId;
      const schemaRef = record(header.schemaRef);
      schemaRef.objectId = snapshotId;
      schemaRef.versionId = snapshotId;
      input.payloadMutate?.(payload);
      // The NFC-collision case cannot recompute a digest client-side either
      // (the shared-kernel canonicalizer throws on the same bytes), so it pins
      // a fixed hash; every other case derives the faithful digest.
      const payloadHash =
        input.columns?.payloadHash ?? digestCanonicalPayload(payload as CanonicalJsonObject).hash;
      const requestPayloadHash = input.columns?.requestPayloadHash ?? seedRequestHash;
      const expiryText =
        input.columns?.omitExpiry === true
          ? undefined
          : typeof payload.expiresAt === 'string'
            ? payload.expiresAt
            : undefined;
      try {
        await track(
          executeTaskExecutionCommand(
            teDb,
            runnerContext(),
            {
              commandId,
              commandType: BUILD_COMMAND,
              commandVersion: BUILD_VERSION,
              idempotencyScope: 'wi216:forgery',
              idempotencyKey: `wi216-forgery-${commandId}`,
              requestPayload: seedEnvelope.payload as CanonicalJsonObject,
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
              targetType: CONTEXT_SNAPSHOT_OBJECT,
              targetId: input.envelopeTargetId ?? targetId,
              correlationId: CORRELATION,
              principalId: OPERATOR,
              principalKind: 'HUMAN',
              actorSnapshotId: OPERATOR_ACTOR,
              authorizationDecisionId: REQUEST_DECISION,
              policySnapshotId: POLICY_SNAPSHOT_ID,
            } satisfies CommandEnvelope,
            async (execution) => {
              if (input.rawSql === true) {
                // The repository preempts a forged creator with its module
                // error (TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH), so this
                // dimension is exercised through SQL on the runner's own
                // transaction instead; V3004's BEFORE triggers fire before the
                // RLS WITH CHECK, so the identity guard is what answers.
                await sql`
                INSERT INTO task_execution.context_snapshot
                  (snapshot_id, object_id, purpose, audience, enterprise_id,
                   project_id, builder_version, policy_snapshot_id,
                   source_manifest_count, context_item_count, omission_count,
                   redaction_count, coverage_state, payload_hash,
                   payload_hash_algorithm, expires_at, effective_expires_at,
                   request_payload_hash, source_command_id,
                   created_by_principal_id, canonical_payload)
                VALUES (
                  ${snapshotId}, ${targetId}, ${seedRow.purpose},
                  ${seedRow.audience}, ${fixture.enterpriseId},
                  ${fixture.projectId}, ${BUILD_VERSION},
                  ${seedRow.policy_snapshot_id}, ${seedRow.source_manifest_count},
                  ${seedRow.context_item_count}, ${seedRow.omission_count},
                  ${seedRow.redaction_count}, ${seedRow.coverage_state},
                  ${payloadHash}, 'SHA-256', ${expiryText ?? null},
                  ${expiryText ?? null}, ${requestPayloadHash}, ${commandId},
                  ${input.columns?.createdByPrincipalId ?? OPERATOR},
                  ${JSON.stringify(payload)}::jsonb
                )`.execute(execution.trx);
                return { kind: 'COMMITTED', resultPayload: { forged: true } };
              }
              if (input.skipSnapshot !== true) {
                const inserted = await execution.insertContextSnapshot({
                  snapshotId,
                  objectId: targetId,
                  purpose: seedRow.purpose,
                  audience: seedRow.audience,
                  enterpriseId: fixture.enterpriseId,
                  projectId: fixture.projectId,
                  builderVersion: BUILD_VERSION,
                  policySnapshotId: seedRow.policy_snapshot_id,
                  sourceManifestCount: seedRow.source_manifest_count,
                  contextItemCount: seedRow.context_item_count,
                  omissionCount: seedRow.omission_count,
                  redactionCount: seedRow.redaction_count,
                  coverageState: input.columns?.coverageState ?? seedRow.coverage_state,
                  payloadHash,
                  expiresAt: expiryText,
                  effectiveExpiresAt: expiryText,
                  requestPayloadHash,
                  sourceCommandId: input.columns?.sourceCommandId ?? commandId,
                  createdByPrincipalId: OPERATOR,
                  canonicalPayload: payload as CanonicalJsonObject,
                });
                if (!inserted) throw new Error('the forged target already exists');
              }
              await execution.insertContextSnapshotBuild({
                snapshotId,
                buildKind: 'INITIAL',
                draftSnapshotRef: (input.buildDraftRef ??
                  seedBuild.draft_snapshot_ref) as CanonicalJsonObject,
                sliceRefs: seedBuild.slice_refs as unknown as CanonicalJsonObject[],
                purpose: seedBuild.purpose,
                audience: seedBuild.audience as unknown as CanonicalJsonObject,
                builderPolicyRef: seedBuild.builder_policy_ref as unknown as CanonicalJsonObject,
                policyContentHash: seedBuild.policy_content_hash,
                policyEffectiveFrom: seedBuild.policy_effective_from.toISOString(),
                ...(seedBuild.effective_expires_at === null
                  ? {}
                  : { effectiveExpiresAt: seedBuild.effective_expires_at.toISOString() }),
                canonicalPayload: seedBuild.canonical_payload as CanonicalJsonObject,
                payloadHash: digestCanonicalPayload(
                  seedBuild.canonical_payload as CanonicalJsonObject,
                ).hash,
                requestPayloadHash,
                sourceCommandId: input.columns?.sourceCommandId ?? commandId,
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
                createdByPrincipalId: OPERATOR,
              });
              return { kind: 'COMMITTED', resultPayload: { forged: true } };
            },
          ),
        );
        return null;
      } catch (error) {
        return failureOf(error);
      }
    }

    const mirrorMismatch = 'context snapshot promoted mirror mismatch';
    const identityMismatch = 'context snapshot creation identity mismatch';
    const buildIdentityMismatch = 'context snapshot build creation identity mismatch';
    const expectForgery = async (
      label: string,
      input: SnapshotForgery,
      code: string,
      message: string,
    ): Promise<void> => {
      const targetId = input.targetId ?? newUuidV7();
      const failure = await forgeSnapshot({ ...input, targetId });
      expect(failure?.code, label).toBe(code);
      expect(failure?.message, label).toContain(message);
      expect(await contextSnapshotRow(targetId), label).toBeUndefined();
    };

    // Mirror dimensions the payload itself disproves.
    await expectForgery(
      'payload-hash',
      { columns: { payloadHash: Buffer.alloc(32, 0) } },
      '22023',
      mirrorMismatch,
    );
    await expectForgery(
      'coverage-state',
      { columns: { coverageState: 'PARTIAL' } },
      '22023',
      mirrorMismatch,
    );
    await expectForgery(
      'expiry-column',
      { columns: { omitExpiry: true } },
      '22023',
      mirrorMismatch,
    );

    // Identity dimensions: the request hash, the source command and the
    // creator must all name this in-flight command and this trusted principal.
    await expectForgery(
      'request-hash',
      { columns: { requestPayloadHash: Buffer.alloc(32, 0) } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'creator',
      { rawSql: true, columns: { createdByPrincipalId: OTHER_PRINCIPAL } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'unknown-command',
      { columns: { sourceCommandId: newUuidV7() } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'finalized-command',
      { columns: { sourceCommandId: seedCommandId } },
      '22023',
      identityMismatch,
    );

    // The Envelope target and the row identity cannot disagree: the runner-bound
    // repository preempts this dimension with the module error, no SQLSTATE.
    const scopeForgeryTarget = newUuidV7();
    const scopeForgery = await forgeSnapshot({
      targetId: scopeForgeryTarget,
      envelopeTargetId: newUuidV7(),
    });
    expect(scopeForgery?.code).toBe(TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH);
    expect(await contextSnapshotRow(scopeForgeryTarget)).toBeUndefined();

    // The build metadata closure: a foreign DRAFT ref never resolves, and a
    // build row without its Snapshot fails the identity guard before the FK.
    await expectForgery(
      'foreign-draft',
      { buildDraftRef: { ...seedBuild.draft_snapshot_ref, objectId: newUuidV7() } },
      '22023',
      buildIdentityMismatch,
    );
    const orphanTarget = newUuidV7();
    const orphan = await forgeSnapshot({ targetId: orphanTarget, skipSnapshot: true });
    expect(orphan?.code).toBe('22023');
    expect(orphan?.message).toContain(buildIdentityMismatch);
    expect(await contextSnapshotRow(orphanTarget)).toBeUndefined();

    // A payload whose member names collide after NFC normalization cannot
    // define a content address: the guard's canonicalizer raises, folded into
    // the mirror mismatch (the shared-kernel canonicalizer throws on the same
    // bytes client-side, so the hash is pinned).
    await expectForgery(
      'nfc-collision',
      {
        payloadMutate: (payload) => {
          record(payload.workContext)['café'] = 'nfc';
          record(payload.workContext)['café'] = 'nfd';
        },
        columns: { payloadHash: Buffer.alloc(32, 0x5a) },
      },
      '22023',
      mirrorMismatch,
    );

    // ACL: the app role has no UPDATE/DELETE on either fact table.
    const seedSnapshotId = seedRow.snapshot_id;
    for (const [label, statement, parameters] of [
      [
        'snapshot-update',
        'UPDATE task_execution.context_snapshot SET payload_hash = $2 WHERE object_id = $1',
        [seedTarget, Buffer.alloc(32, 0x47)],
      ],
      [
        'snapshot-delete',
        'DELETE FROM task_execution.context_snapshot WHERE object_id = $1',
        [seedTarget],
      ],
      [
        'build-update',
        'UPDATE task_execution.context_snapshot_build SET payload_hash = $2 WHERE snapshot_id = $1',
        [seedSnapshotId, Buffer.alloc(32, 0x47)],
      ],
      [
        'build-delete',
        'DELETE FROM task_execution.context_snapshot_build WHERE snapshot_id = $1',
        [seedSnapshotId],
      ],
    ] as const) {
      const failure = await appStatement(statement, parameters);
      expect(failure?.code, label).toBe('42501');
    }

    // The owner role itself cannot rewrite history (immutability triggers).
    for (const [label, statement, parameters, message] of [
      [
        'owner-update',
        'UPDATE task_execution.context_snapshot SET canonical_payload = canonical_payload WHERE object_id = $1',
        [seedTarget],
        'context_snapshot history is immutable',
      ],
      [
        'owner-delete',
        'DELETE FROM task_execution.context_snapshot WHERE object_id = $1',
        [seedTarget],
        'context_snapshot history is immutable',
      ],
      [
        'owner-build-update',
        'UPDATE task_execution.context_snapshot_build SET canonical_payload = canonical_payload WHERE snapshot_id = $1',
        [seedSnapshotId],
        'context_snapshot_build history is immutable',
      ],
      [
        'owner-build-delete',
        'DELETE FROM task_execution.context_snapshot_build WHERE snapshot_id = $1',
        [seedSnapshotId],
        'context_snapshot_build history is immutable',
      ],
    ] as const) {
      let failure: { code: string; message: string } | null = null;
      try {
        await admin.query(statement, [...parameters]);
      } catch (error) {
        failure = failureOf(error);
      }
      expect(failure?.code, label).toBe('23514');
      expect(failure?.message, label).toContain(message);
    }

    // The owner-only canonicalizer is not callable by the app role.
    const canonicalizerCall = await appStatement(
      'SELECT task_execution.canonical_jsonb_text($1::jsonb)',
      ['{"a":1}'],
    );
    expect(canonicalizerCall?.code).toBe('42501');

    // RLS: a context that does not allow this Project sees nothing.
    const foreignCount = await asAppRole(
      tePool,
      'task_execution_app',
      { allowedProjectIds: [newUuidV7()] },
      async (client) =>
        (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
            [seedTarget],
          )
        ).rows.at(0)?.n,
    );
    expect(foreignCount).toBe(0);

    // A direct INSERT by the app role outside any claimed command: no PENDING
    // Receipt exists, so the creation-identity guard answers.
    const directInsert = await appStatement(
      `INSERT INTO task_execution.context_snapshot
         (snapshot_id, object_id, purpose, audience, enterprise_id, project_id,
          builder_version, policy_snapshot_id, source_manifest_count,
          context_item_count, omission_count, redaction_count, coverage_state,
          payload_hash, payload_hash_algorithm, expires_at, effective_expires_at,
          request_payload_hash, source_command_id, created_by_principal_id,
          canonical_payload)
       VALUES ($1, $2, $3, $4, $5, $6, '1.1', $7, $8, $9, $10, $11, $12, $13,
               'SHA-256', $14, $14, $15, $16, $17, $18::jsonb)`,
      [
        newUuidV7(),
        newUuidV7(),
        seedRow.purpose,
        seedRow.audience,
        fixture.enterpriseId,
        fixture.projectId,
        seedRow.policy_snapshot_id,
        seedRow.source_manifest_count,
        seedRow.context_item_count,
        seedRow.omission_count,
        seedRow.redaction_count,
        seedRow.coverage_state,
        seedRow.payload_hash,
        seedRow.expires_at?.toISOString() ?? null,
        seedRow.request_payload_hash,
        newUuidV7(),
        OPERATOR,
        JSON.stringify(seedRow.canonical_payload),
      ],
    );
    expect(directInsert?.code).toBe('22023');
    expect(directInsert?.message).toContain(identityMismatch);

    // The forgery battery changed nothing about the committed seed fact.
    const seedAfter = await contextSnapshotRow(seedTarget);
    expect(seedAfter?.payload_hash.equals(seedRow.payload_hash)).toBe(true);
  });

  itIntegration('TE-214-D-013 records the migration facts', async () => {
    const triggers = await admin.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid IN ('task_execution.context_snapshot'::regclass,
                          'task_execution.context_snapshot_build'::regclass,
                          'task_execution.context_snapshot_legacy'::regclass)
          AND NOT tgisinternal
        ORDER BY tgname`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'context_snapshot_build_creation_identity_guard',
      'context_snapshot_build_immutable_guard',
      'context_snapshot_build_mirror_guard',
      'context_snapshot_creation_identity_guard',
      'context_snapshot_immutable_guard',
      'context_snapshot_legacy_immutable_guard',
      'context_snapshot_legacy_mirror_guard',
      'context_snapshot_mirror_guard',
    ]);
    const policies = await admin.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid IN ('task_execution.context_snapshot'::regclass,
                           'task_execution.context_snapshot_build'::regclass,
                           'task_execution.context_snapshot_legacy'::regclass)
        ORDER BY polname`,
    );
    expect(policies.rows.map((row) => row.polname)).toEqual([
      'context_snapshot_build_insert',
      'context_snapshot_build_select',
      'context_snapshot_insert',
      'context_snapshot_legacy_insert',
      'context_snapshot_legacy_select',
      'context_snapshot_select',
    ]);
    const rls = await admin.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class
        WHERE relnamespace = 'task_execution'::regnamespace
          AND relname IN ('context_snapshot', 'context_snapshot_build',
                          'context_snapshot_legacy')
        ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: 'context_snapshot', enabled: true, forced: true },
      { relname: 'context_snapshot_build', enabled: true, forced: true },
      { relname: 'context_snapshot_legacy', enabled: true, forced: true },
    ]);

    // Every on-disk migration was applied exactly once and none failed (the
    // empty-database apply and the V6002 seed are the gate's own evidence).
    const history = await admin.query<{ version: string; success: boolean }>(
      'SELECT version, success FROM public.flyway_schema_history ORDER BY installed_rank',
    );
    expect(history.rows.length).toBeGreaterThan(0);
    expect(history.rows.every((row) => row.success)).toBe(true);
    const onDisk = readdirSync(new URL('../../migrations', import.meta.url).pathname, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(new URL(`../../migrations/${entry.name}`, import.meta.url).pathname)
          .filter((file) => /^V\d+__.*\.sql$/u.test(file))
          .map((file) => file.slice(1, file.indexOf('__'))),
      );
    expect([...history.rows.map((row) => row.version)].sort()).toEqual([...new Set(onDisk)].sort());
    for (const version of ['3000', '3001', '3002', '3003', '3004']) {
      expect(
        history.rows.find((row) => row.version === version),
        version,
      ).toMatchObject({ success: true });
    }
  });

  itIntegration('TE-214-D-014 returns the exact committed snapshot', async () => {
    const buildEnvelope = await preparedBuild({ idempotencyKey: 'wi216-014-build' });
    const built = await attemptBuild(buildEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 014 build did not commit');
    const targetId = record(buildEnvelope.targetRef).objectId as string;
    const snapshotRef = contextSnapshotRefOf(built.result);
    const row = await contextSnapshotRow(targetId);
    if (row === undefined) throw new Error('the 014 snapshot row is missing');

    // The read writes nothing: every fact table keeps its row counts.
    const countsBefore = {
      receipts: await countRows('task_execution.command_receipt'),
      audits: await countRows('task_execution.audit_record'),
      outbox: await countRows('task_execution.outbox_event'),
      snapshots: await countRows('task_execution.context_snapshot'),
    };
    const read = await attemptRead(await preparedRead({ snapshotRef }));
    expect(read, JSON.stringify(read)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (read.result?.status !== 'COMMITTED') throw new Error('the 014 read did not close');
    const resultPayload = record(read.result.resultPayload);
    // The requested ref is echoed verbatim; the stored payload byte-equal.
    expect(resultPayload.contextSnapshotRef).toEqual(snapshotRef);
    expect(resultPayload.projectContextContract).toEqual(row.canonical_payload);
    expect(resultPayload.contractRef).toEqual({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.contract.project_context',
      objectId: row.snapshot_id,
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      contentHash: {
        algorithm: 'SHA-256',
        digest: row.payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    });
    expect(await countRows('task_execution.command_receipt')).toBe(countsBefore.receipts);
    expect(await countRows('task_execution.audit_record')).toBe(countsBefore.audits);
    expect(await countRows('task_execution.outbox_event')).toBe(countsBefore.outbox);
    expect(await countRows('task_execution.context_snapshot')).toBe(countsBefore.snapshots);

    // §20.1 route 2: the legacy spelling passes the registered Envelope (a
    // generic SnapshotRef) and gets its own Grant and Decision under the
    // second principal, then reads the import-only `context_snapshot_legacy`
    // store. TE-214-D-015 relies on this Grant staying active for its legacy
    // selector probe. (The operator already holds the canonical read Grant: a
    // second ACTIVE Grant for the same principal, capability and Scope is
    // refused as IDENTITY_CAPABILITY_ALREADY_ACTIVE regardless of the
    // selector, so the legacy Grant belongs to other().)
    await grant({
      principal: other(),
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
    });
    // The controlled import of one historical Snapshot under its original
    // legacy identity (the full negative import matrix is TE-217-D-001).
    const legacyObjectId = newUuidV7();
    const legacySnapshotId = newUuidV7();
    const legacy = legacyFixtureOf(row.canonical_payload, legacySnapshotId);
    const importFailure = await importLegacySnapshot({
      snapshotId: legacySnapshotId,
      objectId: legacyObjectId,
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
      payloadHash: Buffer.from(legacy.digest, 'hex'),
      canonicalPayload: legacy.payload,
      projectContextContract: legacy.payload,
      contractRef: closedContractRef(legacySnapshotId, legacy.digest),
    });
    expect(importFailure).toBeNull();
    const legacyRef = legacySnapshotRefOf(legacyObjectId, legacySnapshotId, legacy.digest);
    const legacyRow = await legacySnapshotRow(legacyObjectId);
    if (legacyRow === undefined) throw new Error('the imported legacy row is missing');
    // The exact read-back: the requested ref is echoed verbatim and the
    // historical contract body and its reference come from their own stored
    // columns — never rebuilt, extended or re-spelled.
    const legacyRead = await attemptRead(
      await preparedRead({
        snapshotRef: legacyRef,
        principal: other(),
        targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      }),
      initialContextEntry,
      other(),
    );
    expect(legacyRead, JSON.stringify(legacyRead)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (legacyRead.result?.status !== 'COMMITTED') {
      throw new Error('the 014 legacy read did not close');
    }
    const legacyResult = record(legacyRead.result.resultPayload);
    expect(legacyResult.contextSnapshotRef).toEqual(legacyRef);
    expect(legacyResult.projectContextContract).toEqual(legacyRow.project_context_contract);
    expect(legacyResult.contractRef).toEqual(legacyRow.contract_ref);

    // A miss in the legacy store — here the *canonical* Snapshot's identity
    // under the legacy spelling — is the same REFERENCE_INVALID, and never
    // falls through to the canonical table.
    const legacyMiss = await attemptRead(
      await preparedRead({
        snapshotRef,
        principal: other(),
        refOverride: { ...snapshotRef, objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT },
        targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      }),
      initialContextEntry,
      other(),
    );
    expect(legacyMiss).toMatchObject({ code: REFERENCE_INVALID, thrown: false });

    // An uncommitted identity and a foreign hash are the same refusal.
    const ghostRef = {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_OBJECT,
      objectId: newUuidV7(),
      snapshotId: newUuidV7(),
      scope: scope(),
      contentHash: contentHash('0'.repeat(64)),
    };
    const ghost = await attemptRead(
      await preparedRead({ snapshotRef: ghostRef as unknown as Common.SnapshotRef }),
    );
    expect(ghost).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
    const foreignHash = await attemptRead(
      await preparedRead({
        snapshotRef,
        refOverride: { ...snapshotRef, contentHash: contentHash('0'.repeat(64)) },
      }),
    );
    expect(foreignHash).toMatchObject({ code: REFERENCE_INVALID, thrown: false });

    // A ref outside the requested Project Scope fails at the entry, before any
    // Decision read (the composition's exact-scope gate).
    const crossScope = await attemptRead(
      await preparedRead({
        snapshotRef,
        refOverride: {
          ...snapshotRef,
          scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
        },
      }),
    );
    expect(crossScope).toMatchObject({ code: REFERENCE_INVALID, thrown: true });
  });

  itIntegration('TE-214-D-015 authorizes the snapshot read separately', async () => {
    const buildEnvelope = await preparedBuild({ idempotencyKey: 'wi216-015-build' });
    const built = await attemptBuild(buildEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 015 build did not commit');
    const targetId = record(buildEnvelope.targetRef).objectId as string;
    const snapshotRef = contextSnapshotRefOf(built.result);
    const readDigest = digestCanonicalPayload({
      contextSnapshotRef: snapshotRef,
    } as unknown as CanonicalJsonObject).hash;

    // A build Decision never covers the read (COMMAND_MISMATCH).
    const mismatched = await attemptRead(
      readEnvelope({
        snapshotRef,
        decisionRef: await issueBuildDecision({ targetId, payloadHash: readDigest }),
      }),
    );
    expect(mismatched).toMatchObject({ code: AUTHORIZATION_DECISION_INVALID, thrown: true });

    // A generic-purpose Decision carries no target binding: minted through the
    // generic authorization command, it fails the read revalidation as
    // TARGET_UNBOUND, surfaced as the stable invalid-Decision code.
    await grantGeneric('wi216.cap.readgeneric');
    const genericDecision = await authorizeCommandTracked(identityDeps([fixture.projectId]), {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: READ_QUERY,
        commandVersion: READ_VERSION,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'execution.context.snapshot.read',
        requestedCapability: 'wi216.cap.readgeneric',
        commandPayloadHash: readDigest,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(genericDecision.outcome).toBe('ALLOW');
    const genericRead = await attemptRead(
      readEnvelope({
        snapshotRef,
        decisionRef: genericDecision.authorizationDecisionRef,
      }),
    );
    expect(genericRead).toMatchObject({ code: AUTHORIZATION_DECISION_INVALID, thrown: true });

    // Selector separation at the owning Port itself: with the operator's
    // canonical Grant revoked, the canonical spelling has no covering Grant
    // while the legacy spelling stays covered by the second principal's own
    // Grant (granted in TE-214-D-014). The read Decision below was minted
    // while covered, so the revocation refuses the historical read Decision
    // and the re-grant lets it close again.
    const preRevokeRead = await preparedRead({ snapshotRef });
    const readPort = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: contextSnapshotCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const revoked = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantCtxRead,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_REVOKE_READ',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantCtxRead}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    const portInput = (targetObjectType: string, principal: Principal = operator()) => ({
      actorSnapshotRef: principal.actorRef,
      commandType: READ_QUERY,
      commandVersion: READ_VERSION,
      targetRef: objectRef(targetObjectType, targetId, scope()) as unknown as Common.ObjectRef,
      commandPayloadHash: readDigest,
      authenticationContextHash: principal.authHash,
    });
    const denied = await readPort.authorizeContextSnapshot(
      identityDeps([fixture.projectId]),
      portInput(CONTEXT_SNAPSHOT_OBJECT),
    );
    expect(denied.outcome).toBe('DENY');
    expect(denied.reasons).toContain('NO_ACTIVE_GRANT');
    const legacyCovered = await readPort.authorizeContextSnapshot(
      identityDeps([fixture.projectId], other()),
      portInput(CONTEXT_SNAPSHOT_LEGACY_OBJECT, other()),
    );
    expect(legacyCovered.outcome).toBe('ALLOW');
    const revokedRead = await attemptRead(preRevokeRead);
    expect(revokedRead).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    grantCtxRead = await grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const reGranted = await attemptRead(preRevokeRead);
    expect(reGranted, JSON.stringify(reGranted)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // An expired read Decision: minted under the real clock with the Port's
    // 300-second TTL; the entry's trusted instant sits past that window (the
    // TE-214-D-008 expired case above explains the layering).
    const expiredRead = await attemptRead(
      await preparedRead({ snapshotRef, now: new Date() }),
      entryFor({ now: () => new Date(Date.now() + 600_000) }),
    );
    expect(expiredRead).toMatchObject({ code: AUTHORIZATION_EXPIRED, thrown: true });

    // A drifted trusted read capability code fails closed as revoked (a
    // well-formed NamespaceCode the covering Grant was never issued under).
    const driftedRead = await attemptRead(
      await preparedRead({ snapshotRef }),
      entryFor({
        capabilityCodes: {
          ...contextSnapshotCapabilityCodes,
          contextSnapshotRead: 'wi216.cap.readdrifted',
        },
      }),
    );
    expect(driftedRead).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
  });

  itIntegration('TE-214-D-016 keeps the published surface unchanged', async () => {
    const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
      operations: { type: string; version: string; kind: string; owner: string }[];
    };
    expect(catalog.operations).toHaveLength(221);
    expect(
      catalog.operations.filter((operation) => operation.owner === 'task-execution'),
    ).toHaveLength(49);
    expect(
      catalog.operations.filter(
        (operation) => operation.kind === 'EVENT' && operation.type.startsWith('execution.'),
      ),
    ).toHaveLength(12);

    // The two registered build versions keep their published metadata; the
    // @1.0 entry stays registered (and unbuildable, TE-214-D-001).
    for (const version of ['1.0', '1.1'] as const) {
      expect(registry.getOperation(BUILD_COMMAND, version)).toMatchObject({
        targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
        concurrencyMode: 'CREATE',
        authorizationPurpose: 'execution.context.build.initial',
        dataClassification: 'INTERNAL',
      });
    }
    const buildV1 = registry.getOperation(BUILD_COMMAND, '1.0') as {
      resultSchemaRef?: string;
    };
    const buildV11 = registry.getOperation(BUILD_COMMAND, '1.1') as {
      resultSchemaRef?: string;
    };
    expect(
      buildV1.resultSchemaRef?.endsWith('execution_build_initial_context_snapshot_result'),
    ).toBe(true);
    expect(
      buildV11.resultSchemaRef?.endsWith('execution_build_initial_context_snapshot_v1_1_result'),
    ).toBe(true);
    // The read entry carries no authorizationPurpose in the Catalog: the
    // purpose lives only in the IdentityPolicy binding (Spec 001 §15.8).
    const readOperation = registry.getOperation(READ_QUERY, READ_VERSION) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(readOperation).sort()).toEqual([
      'kind',
      'owner',
      'schemaStatus',
      'type',
      'version',
    ]);
    expect(readOperation).toMatchObject({ kind: 'QUERY', owner: 'task-execution' });
    // The build event is registered in both versions — @1.0 frozen (never
    // emitted by the corrected build, TE-217-D-003) and @1.1 the strict
    // correction; a @2.0 build is not registered.
    for (const eventVersion of ['1.0', '1.1']) {
      expect(
        catalog.operations.some(
          (operation) =>
            operation.type === 'execution.ContextSnapshotBuilt' &&
            operation.version === eventVersion,
        ),
      ).toBe(true);
    }
    const unregistered = registry.validateOperation(BUILD_COMMAND, '2.0', {});
    expect(unregistered.valid).toBe(false);
    expect(unregistered.errors.some((error) => error.keyword === 'operationRegistry')).toBe(true);
    expect(registry.getOperation(BUILD_COMMAND, '2.0')).toBeUndefined();

    // The historical 200-entry Baseline is untouched: the snapshot read (and
    // the legacy build spelling) were already published at v1.0; only the
    // initial build operation is new.
    const baseline = JSON.parse(readFileSync(COMPATIBILITY_BASELINE, 'utf8')) as
      { type: string }[] | { operations: { type: string }[] };
    const baselineOperations = Array.isArray(baseline) ? baseline : baseline.operations;
    expect(baselineOperations).toHaveLength(200);
    expect(
      baselineOperations.some((operation) => operation.type === 'execution.create_work_order'),
    ).toBe(true);
    expect(baselineOperations.some((operation) => operation.type === BUILD_COMMAND)).toBe(false);
    expect(baselineOperations.some((operation) => operation.type === READ_QUERY)).toBe(true);

    // One committed build emits exactly one registered Outbox event — the
    // strict @1.1 with the six-key stored payload; a rejected build and a
    // replay emit none.
    const outboxEnvelope = await preparedBuild({ idempotencyKey: 'wi216-016-outbox' });
    const built = await attemptBuild(outboxEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 016 build did not commit');
    const outboxTarget = record(outboxEnvelope.targetRef).objectId as string;
    const snapshotRef = contextSnapshotRefOf(built.result);
    const outbox = await outboxRows(outboxTarget);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: 'execution.ContextSnapshotBuilt',
      event_version: '1.1',
      aggregate_version: '1',
    });
    expect(Object.keys(record(outbox[0]?.payload)).sort()).toEqual([
      'contextSnapshotRef',
      'coverageStatus',
      'enterpriseId',
      'projectId',
      'projectionType',
      'workOrderRef',
    ]);
    expect(outbox[0]?.payload).toMatchObject({
      projectionType: 'COORDINATOR',
      coverageStatus: 'COMPLETE_FOR_PURPOSE',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    expect(record(outbox[0]?.payload).contextSnapshotRef).toEqual(snapshotRef);
    expect(record(outbox[0]?.payload).workOrderRef).toEqual(
      (await draftPayloadOf(goldenWorkOrderId)).workOrderRef,
    );

    const rejectedEnvelope = await preparedBuild({
      idempotencyKey: 'wi216-016-rejected',
      sourceSlices: [{ ...sliceARef, objectId: newUuidV7() }],
    });
    const rejectedBuild = await attemptBuild(rejectedEnvelope);
    expect(rejectedBuild).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });
    expect(await outboxRows(record(rejectedEnvelope.targetRef).objectId as string)).toEqual([]);
    const replay = await attemptBuild(outboxEnvelope);
    expect(replay).toMatchObject({ code: 'DUPLICATE', thrown: false });
    expect(await outboxRows(outboxTarget)).toHaveLength(1);
  });

  itIntegration('TE-214-D-017 executes the DRAFT inputRefs matrix', async () => {
    const inputRefEntry = (overrides: {
      inputRole?: string;
      ref?: unknown;
      required?: boolean;
      permittedUse?: string;
      contentAccessMode?: string;
      integrityRequired?: boolean;
      epistemicExpectation?: string;
    }): Record<string, unknown> => ({
      inputRole: overrides.inputRole ?? 'wi216.source',
      ref: overrides.ref ?? sliceARef,
      required: overrides.required ?? false,
      permittedUse: overrides.permittedUse ?? PURPOSE_DOCUMENT,
      contentAccessMode: overrides.contentAccessMode ?? 'REFERENCE_ONLY',
      integrityRequired: overrides.integrityRequired ?? true,
      ...(overrides.epistemicExpectation === undefined
        ? {}
        : { epistemicExpectation: overrides.epistemicExpectation }),
    });
    const externalRef = (externalId: string): Record<string, unknown> => ({
      system: 'wi216.external',
      resourceType: 'document',
      externalId,
      observedAt: new Date(clock).toISOString(),
    });

    /** One WorkOrder carrying `inputRefs`, then its initial build. */
    const buildWithInputRefs = async (
      tag: string,
      inputRefs: Record<string, unknown>[],
      sourceSlices: unknown[] = [sliceARef],
    ): Promise<{
      envelope: Record<string, unknown>;
      attempt: { code: string; thrown: boolean; result?: CommandResult };
    }> => {
      const workOrderId = await createWorkOrder({
        taskId: await createExecutableTask('2.0'),
        taskMajor: '2.0',
        inputRefs,
      });
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-017-${tag}`,
        workOrderId,
        sourceSlices,
      });
      return { envelope, attempt: await attemptBuild(envelope) };
    };
    const buildRowOf = async (
      attempt: { result?: CommandResult },
      envelope: Record<string, unknown>,
    ) => {
      if (attempt.result === undefined) throw new Error('the build did not commit');
      const snapshotId = contextSnapshotRefOf(attempt.result).snapshotId;
      const buildRow = await contextSnapshotBuildRow(snapshotId);
      if (buildRow === undefined) throw new Error('the build metadata row is missing');
      const row = await contextSnapshotRow(record(envelope.targetRef).objectId as string);
      if (row === undefined) throw new Error('the snapshot row is missing');
      return { buildRow, row };
    };
    const observationsOf = (buildRow: { canonical_payload: Record<string, unknown> }) =>
      buildRow.canonical_payload.inputRefObservations as Record<string, unknown>[];
    const draftInputOmissionsOf = (row: { canonical_payload: Record<string, unknown> }) =>
      (row.canonical_payload.omissions as Record<string, unknown>[]).filter(
        (omission) => omission.category === 'DRAFT_INPUT_REF',
      );

    // ① Adoption: the slice ref named by the DRAFT and consumed by the build.
    const adopted = await buildWithInputRefs('adopted', [inputRefEntry({})]);
    expect(adopted.attempt, JSON.stringify(adopted.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const adoptedRows = await buildRowOf(adopted.attempt, adopted.envelope);
    expect(observationsOf(adoptedRows.buildRow)).toHaveLength(1);
    expect(observationsOf(adoptedRows.buildRow)[0]).toMatchObject({
      inputRole: 'wi216.source',
      required: false,
      permittedUse: PURPOSE_DOCUMENT,
      contentAccessMode: 'REFERENCE_ONLY',
      integrityRequired: true,
      resolution: 'ADOPTED',
    });
    expect(observationsOf(adoptedRows.buildRow)[0]?.ref).toEqual(sliceARef);
    expect(draftInputOmissionsOf(adoptedRows.row)).toEqual([]);

    // ① variants closing against the request purpose / access mode / state.
    for (const [tag, overrides] of [
      ['use-review', { permittedUse: PURPOSE_REVIEW }],
      ['mode-inline', { contentAccessMode: 'INLINE_FRAGMENT' }],
      ['expectation-disputed', { epistemicExpectation: 'DISPUTED' }],
    ] as const) {
      const variant = await buildWithInputRefs(tag, [inputRefEntry(overrides)]);
      expect(variant.attempt, tag).toMatchObject({
        code: EXECUTION_CONTEXT_SOURCE_INVALID,
        thrown: false,
      });
      await expectNoContextSnapshot(
        record(variant.envelope.targetRef).objectId as string,
        `wi216-017-${tag}`,
      );
    }
    const confirmed = await buildWithInputRefs('expectation-confirmed', [
      inputRefEntry({ epistemicExpectation: 'CONFIRMED' }),
    ]);
    expect(confirmed.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });

    // ② A required inputRef nothing captured rejects INPUT_REQUIRED, whether
    // the ref is slice-typed or another kind.
    const unknownSliceRef = {
      ...sliceARef,
      objectId: newUuidV7(),
      contentHash: contentHash(createHash('sha256').update('wi216-017-unknown').digest('hex')),
    };
    const requiredMissing = await buildWithInputRefs('required-missing', [
      inputRefEntry({ ref: unknownSliceRef, required: true }),
    ]);
    expect(requiredMissing.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_INPUT_REQUIRED,
      thrown: false,
    });
    await expectNoContextSnapshot(
      record(requiredMissing.envelope.targetRef).objectId as string,
      'wi216-017-required-missing',
    );
    const requiredOtherKind = await buildWithInputRefs('required-other-kind', [
      inputRefEntry({ ref: policyKey(BUILDER_POLICY.main, fixture), required: true }),
    ]);
    expect(requiredOtherKind.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_INPUT_REQUIRED,
      thrown: false,
    });

    // ③ An optional unmatched inputRef is an Omission: NOT_CAPTURED for a
    // slice-typed ref, KIND_NOT_SUPPORTED for any other kind.
    const notCaptured = await buildWithInputRefs('not-captured', [
      inputRefEntry({ ref: sliceBRef }),
    ]);
    expect(notCaptured.attempt, JSON.stringify(notCaptured.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const notCapturedRows = await buildRowOf(notCaptured.attempt, notCaptured.envelope);
    expect(observationsOf(notCapturedRows.buildRow)).toHaveLength(1);
    expect(observationsOf(notCapturedRows.buildRow)[0]).toMatchObject({
      inputRole: 'wi216.source',
      resolution: 'OMITTED',
    });
    expect(draftInputOmissionsOf(notCapturedRows.row)).toHaveLength(1);
    expect(draftInputOmissionsOf(notCapturedRows.row)[0]).toMatchObject({
      category: 'DRAFT_INPUT_REF',
      reasonCode: 'NOT_CAPTURED_IN_SOURCE_SLICES',
    });
    const otherKind = await buildWithInputRefs('other-kind', [
      inputRefEntry({ ref: policyKey(BUILDER_POLICY.main, fixture) }),
    ]);
    expect(otherKind.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const otherKindRows = await buildRowOf(otherKind.attempt, otherKind.envelope);
    expect(draftInputOmissionsOf(otherKindRows.row)).toHaveLength(1);
    expect(draftInputOmissionsOf(otherKindRows.row)[0]).toMatchObject({
      category: 'DRAFT_INPUT_REF',
      reasonCode: 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD',
    });

    // ④ No inputRefs: no observations, no DRAFT_INPUT_REF omissions.
    const empty = await buildWithInputRefs('empty', []);
    expect(empty.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const emptyRows = await buildRowOf(empty.attempt, empty.envelope);
    expect(observationsOf(emptyRows.buildRow)).toEqual([]);
    expect(draftInputOmissionsOf(emptyRows.row)).toEqual([]);

    // ⑤ The observation order is the §19.4 item 9 canonical sort, not the
    // DRAFT's member order.
    const sortedCase = await buildWithInputRefs('sorted', [
      inputRefEntry({ inputRole: 'wi216.zeta', ref: sliceBRef }),
      inputRefEntry({
        inputRole: 'wi216.alpha',
        ref: externalRef('doc-1'),
        integrityRequired: false,
      }),
    ]);
    expect(sortedCase.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const sortedRows = await buildRowOf(sortedCase.attempt, sortedCase.envelope);
    expect(observationsOf(sortedRows.buildRow)).toHaveLength(2);
    expect(observationsOf(sortedRows.buildRow)[0]?.inputRole).toBe('wi216.alpha');
    // The fully-identical duplicate pair is closed by the registered WorkOrder
    // creation Schema (uniqueItems); the owning assembly collapses it (unit
    // layer, header note).
    const duplicateEntry = inputRefEntry({ inputRole: 'wi216.dup' });
    await expect(
      createWorkOrder({
        taskId: await createExecutableTask('2.0'),
        taskMajor: '2.0',
        inputRefs: [duplicateEntry, duplicateEntry],
      }),
    ).rejects.toMatchObject({ code: API_VALUE_INVALID });
    const collapsed = assembleInitialContext(
      await unitAssemblyInput({
        draftMutate: (draft) => {
          draft.inputRefs = [duplicateEntry, duplicateEntry];
        },
      }),
    );
    if (collapsed.outcome !== 'ASSEMBLED') {
      throw new Error(`identical inputRefs did not collapse: ${collapsed.errorCode}`);
    }
    expect(collapsed.metadata.inputRefObservations as unknown[]).toHaveLength(1);

    // ⑥ Same (inputRole, ref) but different metadata: never one input.
    const inconsistent = await buildWithInputRefs('inconsistent', [
      inputRefEntry({ inputRole: 'wi216.same', integrityRequired: true }),
      inputRefEntry({ inputRole: 'wi216.same', integrityRequired: false }),
    ]);
    expect(inconsistent.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });
    await expectNoContextSnapshot(
      record(inconsistent.envelope.targetRef).objectId as string,
      'wi216-017-inconsistent',
    );

    // ⑦ A fact-free slice cannot prove an epistemic expectation.
    const factFree = await buildWithInputRefs(
      'fact-free',
      [inputRefEntry({ ref: sliceBRef })],
      [sliceBRef],
    );
    expect(factFree.attempt, JSON.stringify(factFree.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const factFreeRows = await buildRowOf(factFree.attempt, factFree.envelope);
    expect(observationsOf(factFreeRows.buildRow)[0]).toMatchObject({ resolution: 'ADOPTED' });
    const factFreeExpectation = await buildWithInputRefs(
      'fact-free-expectation',
      [inputRefEntry({ ref: sliceBRef, epistemicExpectation: 'CONFIRMED' })],
      [sliceBRef],
    );
    expect(factFreeExpectation.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });

    // ⑧ The least-trusted fact state of the slice is what the expectation
    // closes against (sliceMix carries one DISPUTED Fact).
    const disputed = await buildWithInputRefs(
      'disputed',
      [inputRefEntry({ ref: sliceMixRef, epistemicExpectation: 'DISPUTED' })],
      [sliceMixRef],
    );
    expect(disputed.attempt, JSON.stringify(disputed.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const disputedMismatch = await buildWithInputRefs(
      'disputed-mismatch',
      [inputRefEntry({ ref: sliceMixRef, epistemicExpectation: 'CONFIRMED' })],
      [sliceMixRef],
    );
    expect(disputedMismatch.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });

    // ⑨ External refs are never adopted by the initial build: one Omission
    // per entry, all KIND_NOT_SUPPORTED.
    const externals = await buildWithInputRefs('externals', [
      inputRefEntry({
        inputRole: 'wi216.ext.a',
        ref: externalRef('doc-1'),
        integrityRequired: false,
      }),
      inputRefEntry({
        inputRole: 'wi216.ext.b',
        ref: externalRef('doc-2'),
        integrityRequired: false,
      }),
    ]);
    expect(externals.attempt, JSON.stringify(externals.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const externalRows = await buildRowOf(externals.attempt, externals.envelope);
    expect(observationsOf(externalRows.buildRow)).toHaveLength(2);
    expect(
      observationsOf(externalRows.buildRow).every(
        (observation) => observation.resolution === 'OMITTED',
      ),
    ).toBe(true);
    expect(draftInputOmissionsOf(externalRows.row)).toHaveLength(2);
    for (const omission of draftInputOmissionsOf(externalRows.row)) {
      expect(omission).toMatchObject({
        category: 'DRAFT_INPUT_REF',
        reasonCode: 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD',
      });
    }
  });

  itIntegration('TE-214-D-018 closes targetScope.targetObjectRefs to ∅', async () => {
    // The golden default build carries the empty support set.
    const goldenEnvelope = await preparedBuild({ idempotencyKey: 'wi216-018-empty' });
    const golden = await attemptBuild(goldenEnvelope);
    expect(golden, JSON.stringify(golden)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const goldenRow = await contextSnapshotRow(record(goldenEnvelope.targetRef).objectId as string);
    expect(record(goldenRow?.canonical_payload.workContext).deliveryItemRefs).toEqual([]);

    // The assembly checks the member's length only (§19.4 item 9): one ref,
    // two refs, a non-delivery-item spelling and a foreign scope all land on
    // the same closed rejection.
    const targetRefCase = async (
      tag: string,
      targetObjectRefs: Record<string, unknown>[],
    ): Promise<void> => {
      const workOrderId = await createWorkOrder({
        taskId: await createExecutableTask('2.0'),
        taskMajor: '2.0',
        targetObjectRefs,
      });
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-018-${tag}`,
        workOrderId,
      });
      const attempt = await attemptBuild(envelope);
      expect(attempt, tag).toMatchObject({
        code: EXECUTION_CONTEXT_TARGET_INVALID,
        thrown: false,
      });
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-018-${tag}`,
      );
    };
    const deliveryItemRef = (id: string, refScope: Record<string, string> = scope()) =>
      objectRef('zhiju.project.delivery_item', id, refScope);
    await targetRefCase('one', [deliveryItemRef(newUuidV7())]);
    await targetRefCase('two', [deliveryItemRef(newUuidV7()), deliveryItemRef(newUuidV7())]);
    await targetRefCase('other-type', [objectRef(TASK_V2, newUuidV7(), scope())]);
    // A foreign-Scope ref never reaches the build through legal facts: the
    // owning WorkOrder creation's own scope closure rejects the draft one
    // layer earlier (the same convention as the schema-closed branches of
    // TE-214-D-017; header note). The assembly's branch is asserted at the
    // unit layer below.
    const crossScope = await createWorkOrderResult({
      taskId: await createExecutableTask('2.0'),
      taskMajor: '2.0',
      targetObjectRefs: [
        deliveryItemRef(newUuidV7(), {
          enterpriseId: fixture.enterpriseId,
          projectId: newUuidV7(),
        }),
      ],
    });
    expect(crossScope.result).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_WORK_ORDER_SCOPE_INVALID,
    });
    const unitForeign = assembleInitialContext(
      await unitAssemblyInput({
        draftMutate: (draft) => {
          record(draft.targetScope).targetObjectRefs = [
            deliveryItemRef(newUuidV7(), {
              enterpriseId: fixture.enterpriseId,
              projectId: newUuidV7(),
            }),
          ];
        },
      }),
    );
    expect(unitForeign).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_TARGET_INVALID,
    });
  });

  itIntegration(
    'TE-217-D-001 reads the imported legacy snapshot by its original identity',
    async () => {
      // One committed canonical build supplies the historical body the
      // controlled import carries into the legacy store.
      const buildEnvelope = await preparedBuild({ idempotencyKey: 'wi216-217001-build' });
      const built = await attemptBuild(buildEnvelope);
      expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
      if (built.result === undefined) throw new Error('the 217-001 build did not commit');
      const sourceRow = await contextSnapshotRow(
        record(buildEnvelope.targetRef).objectId as string,
      );
      if (sourceRow === undefined) throw new Error('the 217-001 source snapshot row is missing');
      const sourceSnapshotRef = contextSnapshotRefOf(built.result);

      // The controlled import: the schema-owner role under an established
      // Project-scoped context, the provenance manifest recorded on the row.
      const legacyCountBefore = await countRows('task_execution.context_snapshot_legacy');
      const legacyObjectId = newUuidV7();
      const legacySnapshotId = newUuidV7();
      const legacy = legacyFixtureOf(sourceRow.canonical_payload, legacySnapshotId);
      const baseImport: LegacyImportRow = {
        snapshotId: legacySnapshotId,
        objectId: legacyObjectId,
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        payloadHash: Buffer.from(legacy.digest, 'hex'),
        canonicalPayload: legacy.payload,
        projectContextContract: legacy.payload,
        contractRef: closedContractRef(legacySnapshotId, legacy.digest),
      };
      expect(await importLegacySnapshot(baseImport)).toBeNull();
      expect(await countRows('task_execution.context_snapshot_legacy')).toBe(legacyCountBefore + 1);
      const legacyRef = legacySnapshotRefOf(legacyObjectId, legacySnapshotId, legacy.digest);
      const legacyRow = await legacySnapshotRow(legacyObjectId);
      if (legacyRow === undefined) throw new Error('the imported legacy row is missing');
      expect(legacyRow).toMatchObject({
        snapshot_id: legacySnapshotId,
        object_type: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        enterprise_id: fixture.enterpriseId,
        project_id: fixture.projectId,
        payload_hash_algorithm: 'SHA-256',
        canonicalization_version: '1',
        import_manifest_id: 'wi216-legacy-import-manifest',
        import_batch_id: 'wi216-legacy-import-batch',
        source_system: 'wi216-legacy-source-system',
        import_tool_version: 'wi216-import-tool-1.0.0',
      });
      expect(legacyRow.payload_hash.equals(Buffer.from(legacy.digest, 'hex'))).toBe(true);

      // The exact read-back by the original identity (the legacy read Grant of
      // other() from TE-214-D-014 serves every legacy read of this row): the
      // requested ref is echoed verbatim, the historical contract body and its
      // reference come from their own stored columns, and the read writes
      // nothing in either store.
      const factsBefore = await teFactCounts();
      const legacyRead = await attemptRead(
        await preparedRead({
          snapshotRef: legacyRef,
          principal: other(),
          targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        }),
        initialContextEntry,
        other(),
      );
      expect(legacyRead, JSON.stringify(legacyRead)).toMatchObject({
        code: 'COMMITTED',
        thrown: false,
      });
      if (legacyRead.result?.status !== 'COMMITTED') {
        throw new Error('the 217-001 legacy read did not close');
      }
      const legacyResult = record(legacyRead.result.resultPayload);
      expect(legacyResult.contextSnapshotRef).toEqual(legacyRef);
      expect(legacyResult.projectContextContract).toEqual(legacyRow.project_context_contract);
      expect(legacyResult.contractRef).toEqual(legacyRow.contract_ref);
      expect(await teFactCounts()).toEqual(factsBefore);
      expect(await countRows('task_execution.context_snapshot_legacy')).toBe(legacyCountBefore + 1);

      // The legacy identity never pollutes the canonical namespace: no
      // canonical row exists under it, and the two one-member substitutions of
      // the spelling fail closed in their own store — never a fall-through.
      expect(await contextSnapshotRow(legacyObjectId)).toBeUndefined();
      const readAs = async (
        ref: unknown,
        principal: Principal,
        targetObjectType: string,
      ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> =>
        attemptRead(
          await preparedRead({
            snapshotRef: legacyRef,
            principal,
            refOverride: ref,
            targetObjectType,
          }),
          initialContextEntry,
          principal,
        );
      expect(
        await readAs(
          { ...legacyRef, objectType: CONTEXT_SNAPSHOT_OBJECT },
          operator(),
          CONTEXT_SNAPSHOT_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...sourceSnapshotRef, objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT },
          other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      // A substituted snapshot id, a foreign hash and a foreign Scope fail
      // closed the same way (the Scope one at the entry's exact-scope gate).
      expect(
        await readAs(
          { ...legacyRef, snapshotId: newUuidV7() },
          other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...legacyRef, contentHash: contentHash('0'.repeat(64)) },
          other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...legacyRef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } },
          other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: true });

      // The runtime role is read-only on the store (V3004 §35 ACL row).
      const appInsert = await appStatement(
        `INSERT INTO task_execution.context_snapshot_legacy (
         snapshot_id, object_type, object_id, enterprise_id, project_id,
         payload_hash, payload_hash_algorithm, canonicalization_version,
         canonical_payload, project_context_contract, contract_ref,
         import_manifest_id, import_batch_id, source_system, imported_at,
         import_tool_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'SHA-256', '1', $7::jsonb, $8::jsonb, $9::jsonb,
               'm', 'b', 's', now(), 't')`,
        [
          newUuidV7(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
          newUuidV7(),
          fixture.enterpriseId,
          fixture.projectId,
          Buffer.from(legacy.digest, 'hex'),
          JSON.stringify(legacy.payload),
          JSON.stringify(legacy.payload),
          JSON.stringify(baseImport.contractRef),
        ],
      );
      expect(appInsert?.code).toBe('42501');
      const appUpdate = await appStatement(
        'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
        [legacyObjectId, 'tampered'],
      );
      expect(appUpdate?.code).toBe('42501');
      const appDelete = await appStatement(
        'DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1',
        [legacyObjectId],
      );
      expect(appDelete?.code).toBe('42501');

      // The owner-role closures: a content address or Scope that disagrees
      // with the stored bytes is the mirror guard's 22023; UPDATE and DELETE
      // close in two layers — under FORCE RLS the owner role sees no rows (no
      // UPDATE/DELETE policy exists), so its rewrite affects zero rows, and a
      // role that bypasses RLS meets the immutable guard's 23514; an import
      // outside the established context's coverage is RLS; the legacy spelling
      // and the provenance manifest are CHECK-closed. Every case below closes
      // its `contract_ref` against its own case identity first, so the extended
      // guard (PR #217 round 4) never preempts the closure the case targets.
      const tamperedHashId = newUuidV7();
      const tamperedHashFixture = legacyFixtureOf(sourceRow.canonical_payload, tamperedHashId);
      const wrongHash = await importLegacySnapshot({
        ...baseImport,
        snapshotId: tamperedHashId,
        objectId: newUuidV7(),
        payloadHash: Buffer.alloc(32, 0),
        canonicalPayload: tamperedHashFixture.payload,
        projectContextContract: tamperedHashFixture.payload,
        contractRef: closedContractRef(tamperedHashId, tamperedHashFixture.digest),
      });
      expect(wrongHash?.code).toBe('22023');
      expect(wrongHash?.message).toContain('context snapshot legacy promoted mirror mismatch');

      const tamperedScopeId = newUuidV7();
      const tamperedScopeFixture = legacyFixtureOf(sourceRow.canonical_payload, tamperedScopeId);
      record(tamperedScopeFixture.payload.projectRef).objectId = newUuidV7();
      const tamperedScopeDigest = digestCanonicalPayload(
        tamperedScopeFixture.payload as CanonicalJsonObject,
      ).hash.toString('hex');
      const wrongScope = await importLegacySnapshot({
        ...baseImport,
        snapshotId: tamperedScopeId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(tamperedScopeDigest, 'hex'),
        canonicalPayload: tamperedScopeFixture.payload,
        projectContextContract: tamperedScopeFixture.payload,
        contractRef: closedContractRef(tamperedScopeId, tamperedScopeDigest),
      });
      expect(wrongScope?.code).toBe('22023');
      expect(wrongScope?.message).toContain('context snapshot legacy promoted mirror mismatch');

      // The §35 contract closure (PR #217 round 4): the stored contract body
      // must not differ from the hashed canonical payload, and `contract_ref`
      // must name exactly the recomputed cv1 address of that body — the Snapshot
      // identity as objectId, the row's Project Scope, the SHA-256/'1'/lowercase
      // digest triple. Every violation is the same guard 22023, so no
      // closure-violating row can ever exist for the read boundary to return
      // (the read-side recomputation can never observe one — the same "no legal
      // fact producer" convention as the direct-forgery rows).
      const closedImportOf = (
        caseSnapshotId: string,
        caseFixture: { payload: Record<string, unknown>; digest: string },
      ): LegacyImportRow => ({
        ...baseImport,
        snapshotId: caseSnapshotId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(caseFixture.digest, 'hex'),
        canonicalPayload: caseFixture.payload,
        projectContextContract: caseFixture.payload,
        contractRef: closedContractRef(caseSnapshotId, caseFixture.digest),
      });
      const closureCase = async (
        tag: string,
        mutate: (row: LegacyImportRow) => LegacyImportRow,
      ): Promise<void> => {
        const caseSnapshotId = newUuidV7();
        const caseFixture = legacyFixtureOf(sourceRow.canonical_payload, caseSnapshotId);
        const failure = await importLegacySnapshot(
          mutate(closedImportOf(caseSnapshotId, caseFixture)),
        );
        expect(failure?.code, tag).toBe('22023');
        expect(failure?.message, tag).toContain('context snapshot legacy promoted mirror mismatch');
      };
      const tamperedContractRef = (
        row: LegacyImportRow,
        mutate: (ref: Record<string, unknown>) => void,
      ): LegacyImportRow => {
        const ref = structuredClone(row.contractRef);
        mutate(ref);
        return { ...row, contractRef: ref };
      };
      // A second contract body the payload hash does not cover (the contractRef
      // stays closed against the tampered body, so exactly the contract≡payload
      // clause fires).
      await closureCase('contract-differs', (row) => {
        const contract = { ...row.projectContextContract, wi216TamperedMember: 'contract' };
        return {
          ...row,
          projectContextContract: contract,
          contractRef: closedContractRef(
            row.snapshotId,
            digestCanonicalPayload(contract).hash.toString('hex'),
          ),
        };
      });
      await closureCase('contract-ref-digest', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).digest = '0'.repeat(64);
        }),
      );
      // The digest comparison is textual: the same bytes in uppercase hex are
      // not the stored spelling.
      await closureCase('contract-ref-digest-uppercase', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).digest = (record(ref.contentHash).digest as string).toUpperCase();
        }),
      );
      await closureCase('contract-ref-object-type', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.objectType = 'zhiju.contract.context_snapshot';
        }),
      );
      await closureCase('contract-ref-object-id', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.objectId = newUuidV7();
        }),
      );
      await closureCase('contract-ref-scope', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.scope).projectId = newUuidV7();
        }),
      );
      await closureCase('contract-ref-kind', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.kind = 'OBJECT';
        }),
      );
      await closureCase('contract-ref-algorithm', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).algorithm = 'SHA-512';
        }),
      );
      await closureCase('contract-ref-canonicalization-version', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).canonicalizationVersion = '2';
        }),
      );
      // Round 5: the guard additionally closes `contract_ref` against the
      // registered `contentAddressedRef` member sets — the root exactly the
      // five keys (which also forbids the schema-optional
      // `immutableVersionId`), `scope` exactly the Project pair,
      // `contentHash` exactly the triple. Each row is otherwise fully closed,
      // so exactly the key-set clause fires.
      await closureCase('contract-ref-root-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.wi216UnknownMember = 'member';
        }),
      );
      await closureCase('contract-ref-scope-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.scope).wi216UnknownMember = 'member';
        }),
      );
      await closureCase('contract-ref-content-hash-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).wi216UnknownMember = 'member';
        }),
      );
      // A schema-legal uuidV7, still rejected: the canonical derivation never
      // emits `immutableVersionId` and no authority binds a version id here.
      await closureCase('contract-ref-immutable-version-id', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.immutableVersionId = newUuidV7();
        }),
      );

      const ownerUpdate = await ownerStatement(
        'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
        [legacyObjectId, 'tampered'],
      );
      expect(ownerUpdate.failure).toBeNull();
      expect(ownerUpdate.rowCount).toBe(0);
      const ownerDelete = await ownerStatement(
        'DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1',
        [legacyObjectId],
      );
      expect(ownerDelete.failure).toBeNull();
      expect(ownerDelete.rowCount).toBe(0);
      const superuserUpdate = await track(
        admin
          .query(
            'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
            [legacyObjectId, 'tampered'],
          )
          .then(
            () => null,
            (error: unknown) => failureOf(error),
          ),
      );
      expect(superuserUpdate?.code).toBe('23514');
      const superuserDelete = await track(
        admin
          .query('DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1', [
            legacyObjectId,
          ])
          .then(
            () => null,
            (error: unknown) => failureOf(error),
          ),
      );
      expect(superuserDelete?.code).toBe('23514');

      const uncoveredId = newUuidV7();
      const uncoveredFixture = legacyFixtureOf(sourceRow.canonical_payload, uncoveredId);
      const rlsDenied = await importLegacySnapshot(
        {
          ...baseImport,
          snapshotId: uncoveredId,
          objectId: newUuidV7(),
          payloadHash: Buffer.from(uncoveredFixture.digest, 'hex'),
          canonicalPayload: uncoveredFixture.payload,
          projectContextContract: uncoveredFixture.payload,
          contractRef: closedContractRef(uncoveredId, uncoveredFixture.digest),
        },
        { allowedProjectIds: [newUuidV7()] },
      );
      expect(rlsDenied?.code).toBe('42501');

      const mislabeledId = newUuidV7();
      const mislabeledFixture = legacyFixtureOf(sourceRow.canonical_payload, mislabeledId);
      const wrongObjectType = await importLegacySnapshot({
        ...baseImport,
        snapshotId: mislabeledId,
        objectId: newUuidV7(),
        objectType: CONTEXT_SNAPSHOT_OBJECT,
        payloadHash: Buffer.from(mislabeledFixture.digest, 'hex'),
        canonicalPayload: mislabeledFixture.payload,
        projectContextContract: mislabeledFixture.payload,
        contractRef: closedContractRef(mislabeledId, mislabeledFixture.digest),
      });
      expect(wrongObjectType?.code).toBe('23514');

      const unprovenancedId = newUuidV7();
      const unprovenancedFixture = legacyFixtureOf(sourceRow.canonical_payload, unprovenancedId);
      const emptyProvenance = await importLegacySnapshot({
        ...baseImport,
        snapshotId: unprovenancedId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(unprovenancedFixture.digest, 'hex'),
        canonicalPayload: unprovenancedFixture.payload,
        projectContextContract: unprovenancedFixture.payload,
        contractRef: closedContractRef(unprovenancedId, unprovenancedFixture.digest),
        provenance: { manifestId: '' },
      });
      expect(emptyProvenance?.code).toBe('23514');

      // None of the failed imports left a row, and the imported row kept its
      // stored values through every tamper attempt.
      expect(await countRows('task_execution.context_snapshot_legacy')).toBe(legacyCountBefore + 1);
      expect((await legacySnapshotRow(legacyObjectId))?.source_system).toBe(
        'wi216-legacy-source-system',
      );
    },
  );

  itIntegration('TE-217-D-002 authorizes the DRAFT dependency read on its own grant', async () => {
    // The published Purpose this entry reuses verbatim (Spec 001 §15.9:
    // `WORK_ORDER_DRAFT_READ_PURPOSE` of the owning IdentityPolicy module).
    const DRAFT_READ_PURPOSE = 'execution.work_order.draft.read';
    const draftCapability = contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11;

    // The positive build: one COMMITTED build carries two Decisions — the
    // caller-presented build Decision and the fresh §15.9 DRAFT
    // dependency-read Decision, minted for the *complete* draftSnapshotRef
    // under this entry's own capability, never the build Decision reused.
    const decisionsBefore = await draftReadDecisionRows();
    const positiveEnvelope = await preparedBuild({ idempotencyKey: 'wi216-217002-ok' });
    const buildDecisionId = record(positiveEnvelope.authorizationDecisionRef).objectId as string;
    const payloadDigest = digestCanonicalPayload(
      positiveEnvelope.payload as CanonicalJsonObject,
    ).hash;
    const positive = await attemptBuild(positiveEnvelope);
    expect(positive, JSON.stringify(positive)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const decisionsAfter = await draftReadDecisionRows();
    expect(decisionsAfter).toHaveLength(decisionsBefore.length + 1);
    const draftDecision = decisionsAfter.find(
      (row) =>
        !decisionsBefore.some(
          (prior) => prior.authorization_decision_id === row.authorization_decision_id,
        ),
    );
    if (draftDecision === undefined)
      throw new Error('the DRAFT dependency-read Decision is missing');
    expect(draftDecision.authorization_decision_id).not.toBe(buildDecisionId);
    expect(draftDecision).toMatchObject({
      command_type: BUILD_COMMAND,
      command_version: BUILD_VERSION,
      purpose: DRAFT_READ_PURPOSE,
      requested_capability: draftCapability,
      target_object_type: DRAFT_SNAPSHOT_OBJECT,
      target_object_id: goldenDraftRef.objectId,
      policy_snapshot_id: POLICY_SNAPSHOT_ID,
      principal_id: OPERATOR,
      actor_snapshot_id: OPERATOR_ACTOR,
    });
    expect(draftDecision.command_payload_hash.equals(payloadDigest)).toBe(true);
    // The canonical payload binds the complete draftSnapshotRef field by
    // field (Spec 001 §15.9 rule 2; an absent immutableVersionId stays absent).
    expect(record(draftDecision.canonical_payload).draftSnapshotRef).toEqual({
      kind: 'CONTENT_ADDRESSED',
      objectType: DRAFT_SNAPSHOT_OBJECT,
      objectId: goldenDraftRef.objectId,
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      contentHash: {
        algorithm: 'SHA-256',
        digest: goldenDraftRef.contentHash.digest,
        canonicalizationVersion: '1',
      },
    });
    // Exactly one Receipt — the build's own; the dependency read leaves no
    // Receipt of its own and never replays a historical one.
    expect(await receiptRows('wi216-217002-ok')).toHaveLength(1);

    // Every refusal before the handler leaves zero TaskExecution facts, zero
    // new DRAFT-purpose Decisions and no Receipt; a Grant-driven denial adds
    // exactly one masked IdentityPolicy DENIED audit.
    const denyCase = async (input: {
      tag: string;
      principal?: Principal;
      entry?: InitialContextEntry;
      draftRef?: unknown;
      decisionNow?: Date;
      code: string;
      auditError?: string;
    }): Promise<void> => {
      const principal = input.principal ?? operator();
      const factsBefore = await teFactCounts();
      const priorDecisions = await draftReadDecisionRows();
      const priorAudits = await ipDraftReadDeniedAudits(
        principal.principalId,
        goldenDraftRef.objectId,
      );
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-217002-${input.tag}`,
        principal,
        ...(input.draftRef !== undefined ? { draftRef: input.draftRef } : {}),
        ...(input.decisionNow !== undefined ? { decisionNow: input.decisionNow } : {}),
      });
      const attempt = await attemptBuild(envelope, input.entry ?? initialContextEntry, principal);
      expect(attempt, input.tag).toMatchObject({ code: input.code, thrown: true });
      expect(await teFactCounts(), `${input.tag} moved TaskExecution facts`).toEqual(factsBefore);
      expect(await draftReadDecisionRows(), `${input.tag} minted a DRAFT Decision`).toEqual(
        priorDecisions,
      );
      const audits = await ipDraftReadDeniedAudits(principal.principalId, goldenDraftRef.objectId);
      if (input.auditError === undefined) {
        expect(audits, `${input.tag} wrote an IdentityPolicy audit`).toEqual(priorAudits);
      } else {
        expect(audits).toHaveLength(priorAudits.length + 1);
        expect(audits.at(-1)).toMatchObject({
          outcome: 'DENIED',
          error_code: input.auditError,
          command_type: BUILD_COMMAND,
          target_type: DRAFT_SNAPSHOT_OBJECT,
          target_id: goldenDraftRef.objectId,
          principal_id: principal.principalId,
        });
      }
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-217002-${input.tag}`,
        'ABSENT',
      );
    };

    // Grant missing: the second principal holds the build Grant (TE-214-D-007
    // granted it and nothing revoked it — a second ACTIVE Grant of the same
    // capability and Scope would be IDENTITY_CAPABILITY_ALREADY_ACTIVE) but no
    // DRAFT dependency-read Grant at all. This case runs before the expired
    // one, which leaves the second principal an expired DRAFT Grant row.
    await denyCase({
      tag: 'missing',
      principal: other(),
      code: AUTHORIZATION_REVOKED,
      auditError: 'NO_ACTIVE_GRANT',
    });

    // Grant expired: a DRAFT Grant whose validity window has ended by the
    // entry's trusted instant (the row exists — the denial is the expired
    // window, not the missing Grant of the case above).
    const expiringGrantId = await grant({
      principal: other(),
      capabilityCode: draftCapability,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
      validTo: new Date(Date.now() + 60_000),
    });
    const moved = new Date(Date.now() + 120_000);
    await denyCase({
      tag: 'expired',
      principal: other(),
      entry: entryFor({ now: () => moved }),
      decisionNow: new Date(),
      code: AUTHORIZATION_REVOKED,
      auditError: 'NO_ACTIVE_GRANT',
    });
    const expiringGrant = (
      await admin.query<{ valid_to: Date | null }>(
        `SELECT valid_to FROM identity_policy.capability_grant
          WHERE id = $1`,
        [expiringGrantId],
      )
    ).rows.at(0);
    if (expiringGrant?.valid_to == null) {
      throw new Error('the expiring grant kept no valid_to');
    }
    expect(expiringGrant.valid_to.getTime()).toBeLessThan(moved.getTime());

    // Grant revoked between the Decision and the build.
    const revoked = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantCtxDraftRead,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_REVOKE_DRAFT_READ',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantCtxDraftRead}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    await denyCase({
      tag: 'revoked',
      code: AUTHORIZATION_REVOKED,
      auditError: 'NO_ACTIVE_GRANT',
    });
    grantCtxDraftRead = await grant({
      capabilityCode: draftCapability,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
    });

    // Grant Policy Snapshot drift: the covering Grant is bound to a Policy
    // Snapshot that is not current (not yet effective at the trusted
    // instant), so no *current* Grant covers the read.
    const driftSnapshotId = newUuidV7();
    const driftSnapshot = await recordPolicySnapshotTracked(identityDeps([]), {
      policySnapshotId: driftSnapshotId,
      policySetVersion: `wi216-drift-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: new Date(clock + 24 * 60 * 60 * 1000),
      policyDocument: { rules: ['initial-context-authorization'], version: 2 },
      idempotencyKey: `wi216:policy:${newUuidV7()}`,
    });
    expect(driftSnapshot.status).toBe('COMMITTED');
    const driftSnapshotRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [driftSnapshotId],
      )
    ).rows.at(0);
    if (driftSnapshotRow === undefined) throw new Error('the drift Policy Snapshot row is missing');
    const revokeForDrift = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: grantCtxDraftRead,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_DRIFT_DRAFT_READ',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${grantCtxDraftRead}`,
    });
    expect(revokeForDrift.status).toBe('COMMITTED');
    const driftGrantId = await grant({
      capabilityCode: draftCapability,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
      grantPolicySnapshot: { id: driftSnapshotId, hash: driftSnapshotRow.payload_hash },
    });
    await denyCase({
      tag: 'policy-drift',
      code: AUTHORIZATION_REVOKED,
      auditError: 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT',
    });
    const revokeDrift = await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
      targetId: driftGrantId,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI216_DRIFT_CLEANUP',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi216:revoke:${driftGrantId}`,
    });
    expect(revokeDrift.status).toBe('COMMITTED');
    grantCtxDraftRead = await grant({
      capabilityCode: draftCapability,
      action: ACTIONS.ctxDraftRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: DRAFT_SNAPSHOT_OBJECT,
    });

    // Target substitution, shape layer: the registered Envelope pins the
    // object type spelling (the TE-214-D-002 legacy-spelling evidence), and
    // a foreign Scope fails the Port's Scope check (the TE-214-D-002
    // wrong-scope evidence) — both before any DRAFT fact read or Decision.
    await denyCase({
      tag: 'target-type',
      draftRef: { ...goldenDraftRef, objectType: 'execution.work_order_draft_snapshot' },
      code: API_VALUE_INVALID,
    });
    await denyCase({
      tag: 'target-scope',
      draftRef: {
        ...goldenDraftRef,
        scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() },
      },
      code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
    });

    // Target substitution, content layer (observed layer, header note): the
    // Port binds the substituted address into a fresh Decision of its own
    // and the owning store's by-identity read misses — never the build
    // Decision, never a silent pass.
    const handlerCase = async (tag: string, draftRef: unknown): Promise<void> => {
      const priorDecisions = await draftReadDecisionRows();
      const envelope = await preparedBuild({
        idempotencyKey: `wi216-217002-${tag}`,
        draftRef,
      });
      const attempt = await attemptBuild(envelope);
      expect(attempt, tag).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect((await draftReadDecisionRows()).length).toBe(priorDecisions.length + 1);
      await expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-217002-${tag}`,
      );
    };
    await handlerCase('target-id', { ...goldenDraftRef, objectId: newUuidV7() });
    await handlerCase('target-hash', {
      ...goldenDraftRef,
      contentHash: contentHash('0'.repeat(64)),
    });
  });

  itIntegration(
    'TE-217-D-003 validates the complete ContextSnapshotBuilt@1.1 envelope',
    async () => {
      const buildEnvelope = await preparedBuild({ idempotencyKey: 'wi216-217003-build' });
      const built = await attemptBuild(buildEnvelope);
      expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
      if (built.result === undefined) throw new Error('the 217-003 build did not commit');
      const targetId = record(buildEnvelope.targetRef).objectId as string;
      const snapshotRow = await contextSnapshotRow(targetId);
      if (snapshotRow === undefined) throw new Error('the 217-003 snapshot row is missing');
      const outbox = await outboxRows(targetId);
      expect(outbox).toHaveLength(1);
      const event = outbox[0];
      if (event === undefined) throw new Error('the 217-003 outbox row is missing');
      expect(event).toMatchObject({
        event_type: 'execution.ContextSnapshotBuilt',
        event_version: '1.1',
        aggregate_version: '1',
        canonicalization_version: '1',
        correlation_id: record(buildEnvelope).correlationId,
        causation_id: record(buildEnvelope).commandId,
        source_command_id: record(buildEnvelope).commandId,
        created_by_principal_id: OPERATOR,
      });

      // The stored payload is exactly the closed four public members plus the
      // runner's two Scope mirrors, and the stored hash recomputes over those
      // six keys (§20.3).
      const storedPayload = record(event.payload);
      expect(Object.keys(storedPayload).sort()).toEqual([
        'contextSnapshotRef',
        'coverageStatus',
        'enterpriseId',
        'projectId',
        'projectionType',
        'workOrderRef',
      ]);
      expect(
        event.payload_hash.equals(
          digestCanonicalPayload(event.payload as CanonicalJsonObject).hash,
        ),
      ).toBe(true);
      const publicPayload = {
        contextSnapshotRef: storedPayload.contextSnapshotRef,
        workOrderRef: storedPayload.workOrderRef,
        projectionType: storedPayload.projectionType,
        coverageStatus: storedPayload.coverageStatus,
      } as unknown as CanonicalJsonObject;
      const integrityOf = (payload: CanonicalJsonObject): CanonicalJsonObject => ({
        canonicalizationVersion: '1',
        payloadHash: {
          algorithm: 'SHA-256',
          digest: digestCanonicalPayload(payload).hash.toString('hex'),
          canonicalizationVersion: '1',
        },
      });

      // The complete public Event envelope, rebuilt member-by-member from the
      // committed facts — the stored event id, causation, correlation, command
      // and creator columns, the stored instant (the Snapshot payload's own
      // `asOf`) and the four public payload members — validates strictly
      // against the real ContractRegistry.
      const occurredAt = event.occurred_at.toISOString();
      expect(record(snapshotRow.canonical_payload).asOf).toBe(occurredAt);
      const publicEnvelope = {
        eventId: event.event_id,
        eventType: 'execution.ContextSnapshotBuilt',
        eventVersion: '1.1',
        producerModule: 'task-execution',
        aggregateType: CONTEXT_SNAPSHOT_OBJECT,
        aggregateId: targetId,
        aggregateVersion: 1,
        scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        correlationId: event.correlation_id,
        causationId: event.causation_id,
        commandId: event.source_command_id,
        actorRef: {
          kind: 'OBJECT',
          objectType: PRINCIPAL_OBJECT,
          objectId: event.created_by_principal_id,
          scope: { enterpriseId: fixture.enterpriseId },
        },
        occurredAt,
        dataClassification: 'INTERNAL',
        payload: publicPayload,
        integrity: integrityOf(publicPayload),
      } as unknown as CanonicalJsonObject;
      const validation = registry.validateOperation(
        'execution.ContextSnapshotBuilt',
        '1.1',
        publicEnvelope,
      );
      expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);

      // A Scope member or any extra member inside the payload fails the closed
      // four-member Schema; an off-table enum value fails even when it is a
      // well-formed NamespaceCode.
      const withPayload = (mutate: (payload: Record<string, unknown>) => void) => {
        const mutated = structuredClone(publicPayload) as Record<string, unknown>;
        mutate(mutated);
        return registry.validateOperation('execution.ContextSnapshotBuilt', '1.1', {
          ...publicEnvelope,
          payload: mutated,
          integrity: integrityOf(mutated as CanonicalJsonObject),
        });
      };
      expect(
        withPayload((mutated) => {
          mutated.enterpriseId = fixture.enterpriseId;
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.projectId = fixture.projectId;
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.unexpectedMember = 'wi216';
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.projectionType = 'coordinator';
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.coverageStatus = 'complete_for_purpose';
        }).valid,
      ).toBe(false);

      // @1.0 stays registered and frozen — its historical NamespaceCode fields
      // still validate against the unchanged @1.0 Schema — but the corrected
      // build never emits it: no @1.0 row of this event exists in the table.
      const frozenPayload = {
        contextSnapshotRef: storedPayload.contextSnapshotRef,
        workOrderRef: storedPayload.workOrderRef,
        projectionType: 'coordinator',
        coverageStatus: 'complete_for_purpose',
      } as unknown as CanonicalJsonObject;
      const frozen = registry.validateOperation('execution.ContextSnapshotBuilt', '1.0', {
        ...publicEnvelope,
        eventVersion: '1.0',
        payload: frozenPayload,
        integrity: integrityOf(frozenPayload),
      });
      expect(frozen.valid, JSON.stringify(frozen.errors)).toBe(true);
      const legacyEvents = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_execution.outbox_event
        WHERE event_type = 'execution.ContextSnapshotBuilt' AND event_version = '1.0'`,
      );
      expect(legacyEvents.rows.at(0)?.n).toBe(0);

      // The Catalog counts the matrix pins (also asserted in TE-214-D-016):
      // 221 operations total, 49 owned by TaskExecution, the historical
      // 200-entry v1.0 Baseline untouched.
      const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
        operations: { type: string; version: string; kind: string; owner: string }[];
      };
      expect(catalog.operations).toHaveLength(221);
      expect(
        catalog.operations.filter((operation) => operation.owner === 'task-execution'),
      ).toHaveLength(49);
      const baseline = JSON.parse(readFileSync(COMPATIBILITY_BASELINE, 'utf8')) as
        { type: string }[] | { operations: { type: string }[] };
      expect(Array.isArray(baseline) ? baseline : baseline.operations).toHaveLength(200);
    },
  );

  itIntegration('TE-217-D-004 determinizes the Source Slice total order', async () => {
    // Unit layer on the real committed slice payloads (the TE-214-D-017
    // convention): the total order belongs to the owning assembly; the
    // entry-level permutation stability of a real build is TE-214-D-003③.
    const sliceA = await slicePayloadOf(sliceARef.objectId);
    const sliceB = await slicePayloadOf(sliceBRef.objectId);
    const refFor = (objectId: string, digest: string): Common.ContentAddressedRef =>
      ({
        kind: 'CONTENT_ADDRESSED',
        objectType: SLICE_OBJECT,
        objectId,
        scope: scope(),
        contentHash: contentHash(digest),
      }) as unknown as Common.ContentAddressedRef;
    const payloadFor = (
      slice: Record<string, unknown>,
      objectId: string,
    ): Record<string, unknown> => {
      const cloned = structuredClone(slice);
      cloned.sliceId = objectId;
      return cloned;
    };

    // A'' carries the smaller objectId with the LARGER hash digest, B'' the
    // reverse: an implementation that compared any hash member before the
    // object identity would order them backwards.
    const aId = '00000000-0000-7000-8000-000000000001';
    const bId = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
    const aRef = refFor(aId, 'f'.repeat(64));
    const bRef = refFor(bId, '0'.repeat(64));
    expect(compareOrderTuples(sliceOrderTuple(aRef), sliceOrderTuple(bRef))).toBeLessThan(0);

    const pairForward = await unitAssemblyInput({
      slices: [
        { ref: aRef, slice: payloadFor(sliceA, aId) },
        { ref: bRef, slice: payloadFor(sliceB, bId) },
      ],
    });
    const pairReverse = await unitAssemblyInput({
      slices: [
        { ref: bRef, slice: payloadFor(sliceB, bId) },
        { ref: aRef, slice: payloadFor(sliceA, aId) },
      ],
    });
    const pairIdentity = {
      snapshotId: pairForward.snapshotId,
      asOf: pairForward.asOf,
      correlationId: pairForward.correlationId,
    };
    const forward = assembleInitialContext(pairForward);
    const reverse = assembleInitialContext({ ...pairReverse, ...pairIdentity });
    if (forward.outcome !== 'ASSEMBLED' || reverse.outcome !== 'ASSEMBLED') {
      throw new Error('the reverse-ordered fixture did not assemble');
    }
    // Every permutation produces the identical payload, metadata and hashes.
    expect(reverse.payload).toEqual(forward.payload);
    expect(reverse.metadata).toEqual(forward.metadata);
    expect(
      digestCanonicalPayload(reverse.payload).hash.equals(
        digestCanonicalPayload(forward.payload).hash,
      ),
    ).toBe(true);
    expect(
      digestCanonicalPayload(reverse.metadata).hash.equals(
        digestCanonicalPayload(forward.metadata).hash,
      ),
    ).toBe(true);
    // sourceSlices[] opens with A'' — the object identity decides, not the
    // reversed hash members.
    const pairSliceRefs = forward.metadata.sliceRefs as Record<string, unknown>[];
    expect(pairSliceRefs.map((ref) => ref.objectId)).toEqual([aId, bId]);
    // The fact order is the slice's own array order and the deterministic
    // contextItemIds recompute from A''.objectId at the in-slice indices —
    // the UUIDv7 inputs never see the request's permutation.
    const factItems = record(sliceA.source).factItems as unknown[];
    const items = forward.payload.contextItems as Record<string, unknown>[];
    expect(items).toHaveLength(factItems.length);
    const asOfMilliseconds = new Date(forward.payload.asOf as string).getTime();
    for (const [index, factItem] of factItems.entries()) {
      expect(items[index]?.contextItemId).toBe(
        recomputeContextItemId(asOfMilliseconds, factItem, aId, index),
      );
    }

    // Three slices (C'' a second slice-B body under a middle identity) in
    // all six permutations: one outcome.
    const cId = '77777777-7777-7777-8777-777777777777';
    const cRef = refFor(cId, '7'.repeat(64));
    interface SliceEntry {
      ref: Common.ContentAddressedRef;
      slice: Record<string, unknown>;
    }
    const trio: [SliceEntry, SliceEntry, SliceEntry] = [
      { ref: aRef, slice: payloadFor(sliceA, aId) },
      { ref: cRef, slice: payloadFor(sliceB, cId) },
      { ref: bRef, slice: payloadFor(sliceB, bId) },
    ];
    const trioInput = await unitAssemblyInput({ slices: trio });
    const trioIdentity = {
      snapshotId: trioInput.snapshotId,
      asOf: trioInput.asOf,
      correlationId: trioInput.correlationId,
    };
    const first = assembleInitialContext(trioInput);
    if (first.outcome !== 'ASSEMBLED') throw new Error('the trio fixture did not assemble');
    expect(
      (first.metadata.sliceRefs as Record<string, unknown>[]).map((ref) => ref.objectId),
    ).toEqual([aId, cId, bId]);
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ] as const) {
      const permuted = assembleInitialContext({
        ...(await unitAssemblyInput({ slices: order.map((index) => trio[index]) })),
        ...trioIdentity,
      });
      expect(permuted.outcome).toBe('ASSEMBLED');
      if (permuted.outcome === 'ASSEMBLED') {
        expect(permuted.payload).toEqual(first.payload);
        expect(permuted.metadata).toEqual(first.metadata);
      }
    }

    // Fail closed: the exact duplicate pair, the tuple collision whose
    // canonical refs differ (`immutableVersionId` absent vs present-as-empty
    // bind to the same order key — no unranked-member tiebreak is invented),
    // and the duplicated fact inside one slice (two items, one subject
    // identity) all reject EXECUTION_CONTEXT_SOURCE_INVALID.
    const duplicate = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: aRef, slice: payloadFor(sliceA, aId) },
          { ref: aRef, slice: payloadFor(sliceA, aId) },
        ],
      }),
    );
    expect(duplicate).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
    const collision = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: aRef, slice: payloadFor(sliceA, aId) },
          { ref: { ...aRef, immutableVersionId: '' }, slice: payloadFor(sliceA, aId) },
        ],
      }),
    );
    expect(collision).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
    const duplicatedFacts = payloadFor(sliceA, aId);
    record(duplicatedFacts.source).factItems = [
      structuredClone(factItems[0]),
      ...factItems,
    ] as unknown[];
    const inSliceDuplicate = assembleInitialContext(
      await unitAssemblyInput({
        slices: [
          { ref: aRef, slice: duplicatedFacts },
          { ref: bRef, slice: payloadFor(sliceB, bId) },
        ],
      }),
    );
    expect(inSliceDuplicate).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
  });
  async function readyTaskForValidation(taskId: string) {
    const capabilityCodes = {
      taskReadinessBuildV1: 'wi219.task.readiness',
      taskReadyV1: 'wi219.task.ready',
    };
    await grant({
      capabilityCode: capabilityCodes.taskReadinessBuildV1,
      action: 'execution.task.readiness.build',
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: 'zhiju.execution.task_readiness',
    });
    await grant({
      capabilityCode: capabilityCodes.taskReadyV1,
      action: 'execution.task.mark_ready',
      selectorType: 'TARGET_TYPE',
      targetObjectType: TASK_V2,
    });
    const policyRef = policyKey([newUuidV7(), newUuidV7()], fixture);
    await registerPolicyVersionAs({
      key: policyRef,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference('execution.task_readiness.policy@1.0')],
      policyDocument: { maxReadinessValiditySeconds: 600 },
    });
    const entry = createTaskReadinessEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes,
      capabilities: dependencyCapabilities,
      now: () => new Date(clock),
    });
    const auth = createTaskExecutionReadinessAuthorizationPort({
      capabilityCodes,
      now: () => new Date(clock),
    });
    const root = (
      await admin.query(
        'SELECT current_definition_snapshot_id, current_definition_hash FROM task_execution.task WHERE task_id=$1',
        [taskId],
      )
    ).rows[0] as { current_definition_snapshot_id: string; current_definition_hash: Buffer };
    const taskRef = objectRef(TASK_V2, taskId, scope());
    async function envelope(
      commandType: string,
      targetRef: Record<string, unknown>,
      payload: CanonicalJsonObject,
      expectedAggregateVersion?: number,
    ) {
      const payloadHash = digestCanonicalPayload(payload).hash;
      const issued = await auth.authorizeReadiness(identityDeps([fixture.projectId]), {
        actorSnapshotRef: operatorActorRef,
        commandType,
        commandVersion: '1.0',
        targetRef: targetRef as unknown as Common.ObjectRef,
        commandPayloadHash: payloadHash,
        authenticationContextHash: AUTH_HASH,
      });
      expect(issued.outcome).toBe('ALLOW');
      return {
        commandId: newUuidV7(),
        commandType,
        commandVersion: '1.0',
        scopeRef: scope(),
        targetRef,
        actor: operatorActorRef,
        authorizationDecisionRef: issued.authorizationDecisionRef,
        idempotencyKey: newUuidV7(),
        correlationId: newUuidV7(),
        requestedAt: new Date(clock).toISOString(),
        ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(payloadHash.toString('hex')),
        },
      };
    }
    const build = await entry.build(
      await envelope(
        'execution.build_task_readiness',
        objectRef('zhiju.execution.task_readiness', newUuidV7(), scope()),
        {
          taskRef,
          taskDefinitionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.execution.task_definition_snapshot',
            objectId: root.current_definition_snapshot_id,
            scope: scope(),
            contentHash: contentHash(root.current_definition_hash.toString('hex')),
          },
          policyRef,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.task_readiness.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
      ),
      sessionFor(),
    );
    expect(build, JSON.stringify(build)).toMatchObject({ status: 'COMMITTED' });
    const readinessSnapshotRef = record(record(committedPayload(build)).data).readinessSnapshotRef;
    const ready = await entry.markReady(
      await envelope(
        'execution.mark_task_ready',
        taskRef,
        { readinessSnapshotRef, requestedAt: new Date(clock).toISOString() } as CanonicalJsonObject,
        1,
      ),
      sessionFor(),
    );
    expect(ready, JSON.stringify(ready)).toMatchObject({ status: 'COMMITTED' });
  }

  itIntegration(
    'TE-VAL-S-008 completes the owning Validation, Freeze and authoritative Contract path',
    async () => {
      // This independent chain must not inherit the time spent running the
      // preceding 22 cases: the Decision lookup's bootstrap lease is 60s
      // from the trusted instant, and PostgreSQL checks it against wall time.
      clock = Date.now();
      const serviceId = newUuidV7(),
        actorId = newUuidV7();
      await withIdentityTransaction(identityDb, identityContext([]), (trx) =>
        identityRepo.insertPrincipal(trx, {
          id: serviceId,
          principalKind: 'SERVICE',
          displayName: 'WI-219 controlled validator',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
      const actorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
        actorSnapshotId: actorId,
        principalId: serviceId,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      });
      const service: Principal = {
        principalId: serviceId,
        principalKind: 'SERVICE',
        actorSnapshotId: actorId,
        actorRef,
        authHash: AUTH_HASH,
      };
      for (const capability of [
        dependencyCapabilities.resolvePolicy,
        dependencyCapabilities.readContextSourceSlice,
        CAPTURE_CAPABILITY,
      ])
        await grantGeneric(capability, service);
      for (const [capabilityCode, action, targetObjectType, selectorType] of [
        [
          contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
          ACTIONS.ctxBuild,
          CONTEXT_SNAPSHOT_OBJECT,
          'CREATE_TARGET_TYPE',
        ],
        [
          contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11,
          ACTIONS.ctxDraftRead,
          DRAFT_SNAPSHOT_OBJECT,
          'TARGET_TYPE',
        ],
      ] as const)
        await grant({ principal: service, capabilityCode, action, targetObjectType, selectorType });
      const codes = Object.fromEntries(
        WORK_ORDER_VALIDATION_BINDINGS.map((b, i) => [b.capabilityConfigKey, `wi219.auth.c${i}`]),
      ) as WorkOrderValidationCapabilityCodes;
      const validationGrants = new Map<string, string>();
      for (const binding of WORK_ORDER_VALIDATION_BINDINGS) {
        const targetObjectType = binding.targetObjectTypes[0];
        if (targetObjectType === undefined) throw new Error('missing target');
        validationGrants.set(
          binding.capabilityConfigKey,
          await grant({
            principal: service,
            capabilityCode: codes[binding.capabilityConfigKey],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType,
          }),
        );
      }
      const captureRef = policyKey([newUuidV7(), newUuidV7()], fixture);
      await registerPolicyVersionAs({
        key: captureRef,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
        policyDocument: { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [PURPOSE_DOCUMENT] },
      });
      const slice = await captureSlice({
        principal: service,
        purpose: PURPOSE_DOCUMENT,
        capturePolicyRef: captureRef,
        idempotencyKey: newUuidV7(),
      });
      const taskId = await createExecutableTask('2.0', true);
      const candidate = JSON.parse(
        readFileSync(
          new URL(
            '../fixtures/contracts/work-order-validation/ready-candidate-valid.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ) as Record<string, unknown>;
      rewriteFixtureScopes(candidate, fixture);
      const controlsRef = policyKey([newUuidV7(), newUuidV7()], fixture),
        validationRef = policyKey([newUuidV7(), newUuidV7()], fixture);
      const originalControls = record(record(candidate.versionPins).capabilityPolicyRef);
      function replaceControls(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(replaceControls);
        if (value !== null && typeof value === 'object') {
          if (
            record(value).objectId === originalControls.objectId &&
            record(value).versionId === originalControls.versionId
          )
            return controlsRef;
          return Object.fromEntries(
            Object.entries(value).map(([key, v]) => [key, replaceControls(v)]),
          );
        }
        return value;
      }
      const revised = replaceControls(candidate) as Record<string, unknown>;
      // The first Run subset requires a finite wall clock limit. The older
      // READY fixture only carried tokenLimit, which remains legal for Freeze.
      record(revised.budget).wallClockLimit = 'PT600S';
      // Static selectors are Platform-scoped; recursive fixture scope rewriting
      // is restricted to business refs and must not turn them into Project refs.
      for (const profile of workOrderReadyProfileRegistry.profiles) {
        if (profile.registryKey === 'core.work_order@1.0') {
          record(revised.header).schemaRef = profile.reference;
          record(revised.versionPins).workOrderSchemaRef = profile.reference;
        }
        if (profile.registryKey === 'te.human_operated.synthetic@1.0')
          record(revised.versionPins).runtimeAdapterContractRef = profile.reference;
        if (profile.registryKey === 'te.work_order.human_review@1.0')
          record(revised.riskAndQuality).riskProfileRef = profile.reference;
      }
      const evaluator = registeredEvaluatorProfileReference(
        'im06-evaluator-static-v1',
        'te.work_order_validation.evaluator@1.0',
      );
      for (const criterion of revised.completionCriteria as Record<string, unknown>[])
        criterion.evaluatorRef = evaluator;
      revised.taskRef = objectRef(TASK_V2, taskId, scope());
      revised.projectRef = objectRef('zhiju.project.project', fixture.projectId, scope());
      revised.requestedBy = { principalId: OPERATOR, principalKind: 'HUMAN' };
      revised.inputRefs = [
        {
          inputRole: 'context',
          ref: slice,
          required: true,
          permittedUse: PURPOSE_DOCUMENT,
          contentAccessMode: 'REFERENCE_ONLY',
          integrityRequired: true,
        },
      ];
      record(revised.versionPins).contextBuilderPolicyRef = policyKey(BUILDER_POLICY.main, fixture);
      for (const group of ['allowedCapabilities', 'deniedCapabilities'])
        for (const cap of revised[group] as Record<string, unknown>[])
          cap.expiresAt = new Date(clock + 3600_000).toISOString();
      const controlFields = [
        'targetScope',
        'allowedCapabilities',
        'deniedCapabilities',
        'expectedOutputs',
        'riskAndQuality',
        'executionPolicy',
        'budget',
        'harnessPolicy',
        'modelPolicy',
      ];
      await registerPolicyVersionAs({
        key: controlsRef,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference('execution.work_order_controls.policy@1.0')],
        policyDocument: {
          controls: Object.fromEntries(controlFields.map((k) => [k, revised[k]])),
        } as CanonicalJsonObject,
      });
      await registerPolicyVersionAs({
        key: validationRef,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference('execution.work_order_validation.policy@1.0')],
        policyDocument: { maxValidationValiditySeconds: 600 },
      });
      const draft = Object.fromEntries(
        Object.entries(revised).filter(
          ([key]) =>
            ![
              'header',
              'workOrderRef',
              'projectRef',
              'contextSnapshotRef',
              'issuedAt',
              'expiresAt',
              'specificationHash',
            ].includes(key),
        ),
      );
      const { projectContextContractRef: _, ...draftPins } = record(draft.versionPins);
      void _;
      draft.versionPins = draftPins;
      const expiresAt = new Date(clock + 3600_000).toISOString();
      const woId = await createWorkOrder({
        taskId,
        taskMajor: '2.0',
        customDraft: draft,
        expiresAt,
      });
      const draftRef = await draftSnapshotRefOf(woId);
      const contextBuild = await initialContextEntry.build(
        await preparedBuild({
          workOrderId: woId,
          draftRef,
          principal: service,
          sourceSlices: [slice],
          idempotencyKey: newUuidV7(),
        }),
        sessionFor(service),
      );
      expect(contextBuild, JSON.stringify(contextBuild)).toMatchObject({ status: 'COMMITTED' });
      const contextRef = contextSnapshotRefOf(contextBuild);
      await verifyWorkOrderValidationUpgrade(admin, fixture.enterpriseId);
      revised.workOrderRef = objectRef(WORK_ORDER_V11, woId, scope());
      revised.contextSnapshotRef = contextRef;
      record(revised.versionPins).projectContextContractRef = contextRef;
      revised.expiresAt = expiresAt;
      revised.issuedAt = new Date(clock).toISOString();
      revised.header = {
        ...record(revised.header),
        contractId: newUuidV7(),
        issuedAt: revised.issuedAt,
        issuedBy: { principalId: serviceId, principalKind: 'SERVICE' },
      };
      const specFields = [
        'objective',
        'targetScope',
        'inputRefs',
        'contextSnapshotRef',
        'constraints',
        'allowedCapabilities',
        'deniedCapabilities',
        'expectedOutputs',
        'completionCriteria',
        'riskAndQuality',
        'executionPolicy',
        'budget',
        'harnessPolicy',
        'modelPolicy',
        'versionPins',
      ];
      revised.specificationHash = contentHash(
        sha256CanonicalJson(
          Object.fromEntries(specFields.map((k) => [k, revised[k]])) as CanonicalJsonObject,
        ),
      );
      record(revised.header).payloadHash = contentHash(
        hashContractPayload(revised as CanonicalJsonObject),
      );
      const entry = createWorkOrderValidationEntry({
        taskExecutionDb: teDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        capabilityCodes: codes,
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      });
      const auth = createWorkOrderValidationAuthorizationPort({
        capabilityCodes: codes,
        now: () => new Date(clock),
      });
      async function envelope(
        commandType: string,
        payload: CanonicalJsonObject,
        targetRef: Common.ObjectRef,
        freeze = false,
      ) {
        const payloadHash = digestCanonicalPayload(payload).hash;
        const signed = await (
          freeze
            ? auth.authorizeWorkOrderFreeze.bind(auth)
            : auth.authorizeWorkOrderValidation.bind(auth)
        )(identityDeps([fixture.projectId], service), {
          actorSnapshotRef: actorRef,
          commandType,
          commandVersion: '1.0',
          commandPayloadHash: payloadHash,
          authenticationContextHash: AUTH_HASH,
          targetRef,
        });
        expect(signed.outcome).toBe('ALLOW');
        return {
          commandId: newUuidV7(),
          commandType,
          commandVersion: '1.0',
          scopeRef: scope(),
          targetRef,
          actor: actorRef,
          authorizationDecisionRef: signed.authorizationDecisionRef,
          idempotencyKey: newUuidV7(),
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          ...(freeze ? { expectedAggregateVersion: 1 } : {}),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(payloadHash.toString('hex')),
          },
        };
      }
      const validationEnvelope = await envelope(
        'execution.validate_work_order_draft',
        {
          draftSnapshotRef: draftRef,
          candidateContract: revised,
          policyRef: validationRef,
          evaluatorRef: evaluator,
        } as unknown as CanonicalJsonObject,
        objectRef(
          'zhiju.execution.work_order_validation',
          newUuidV7(),
          scope(),
        ) as unknown as Common.ObjectRef,
      );
      // Own and dependency authorization failures precede the command claim.
      for (const key of [
        'workOrderValidationDraftReadV1',
        'workOrderValidationContextReadV1',
      ] as const) {
        const deniedEntry = createWorkOrderValidationEntry({
          taskExecutionDb: teDb,
          enterpriseProjectDb,
          identity: { db: identityDb, repo: identityRepo, crypto },
          capabilityCodes: { ...codes, [key]: 'wi219.ungranted' },
          capabilities: dependencyCapabilities,
          now: () => new Date(clock),
        });
        await expect(
          deniedEntry.validate(validationEnvelope, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(await receiptRows(validationEnvelope.idempotencyKey)).toEqual([]);
      }
      await expect(
        entry.validate(
          {
            ...validationEnvelope,
            targetRef: objectRef('zhiju.execution.work_order_validation', newUuidV7(), scope()),
          },
          sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(await receiptRows(validationEnvelope.idempotencyKey)).toEqual([]);
      const forged = structuredClone(revised);
      record(forged.header).payloadHash = contentHash('f'.repeat(64));
      const forgedEnvelope = await envelope(
        'execution.validate_work_order_draft',
        { ...validationEnvelope.payload, candidateContract: forged } as CanonicalJsonObject,
        objectRef(
          'zhiju.execution.work_order_validation',
          newUuidV7(),
          scope(),
        ) as unknown as Common.ObjectRef,
      );
      await expect(entry.validate(forgedEnvelope, sessionFor(service))).rejects.toMatchObject({
        code: 'PAYLOAD_HASH_MISMATCH',
      });
      expect(await receiptRows(forgedEnvelope.idempotencyKey)).toEqual([]);
      const validated = await entry.validate(validationEnvelope, sessionFor(service));
      expect(validated, JSON.stringify(validated)).toMatchObject({ status: 'COMMITTED' });
      const judgmentRef = record(record(committedPayload(validated)).data).validationSnapshotRef;
      const judgmentId = record(judgmentRef).objectId as string;
      const judgmentPayload = (
        await admin.query(
          'SELECT canonical_payload FROM task_execution.execution_judgment WHERE judgment_id=$1',
          [judgmentId],
        )
      ).rows[0].canonical_payload as Record<string, unknown>;
      expect(record(judgmentPayload.validation).executable).toBe(true);
      await verifyWorkOrderValidationGuards(admin, teDb, runnerContext(service), judgmentId);
      expect((judgmentPayload.dependencyObservations as unknown[]).length).toBe(7);
      expect(contextRef.objectId).not.toBe(contextRef.snapshotId);
      expect(
        (
          await admin.query(
            'SELECT task_execution.work_order_validation_payload_valid($1::jsonb) AS valid',
            [JSON.stringify(judgmentPayload)],
          )
        ).rows,
      ).toEqual([{ valid: true }]);
      for (const mutate of [
        (p: Record<string, unknown>) => {
          p.extra = true;
        },
        (p: Record<string, unknown>) => {
          (p.dependencyObservations as unknown[]).reverse();
        },
        (p: Record<string, unknown>) => {
          record((p.dependencyObservations as unknown[])[0]).extra = true;
        },
        (p: Record<string, unknown>) => {
          record(p.validation).executable = false;
        },
        (p: Record<string, unknown>) => {
          p.inputHash = 'f'.repeat(64);
        },
      ]) {
        const value = structuredClone(judgmentPayload);
        mutate(value);
        expect(
          (
            await admin.query(
              'SELECT task_execution.work_order_validation_payload_valid($1::jsonb) AS valid',
              [JSON.stringify(value)],
            )
          ).rows,
        ).toEqual([{ valid: false }]);
      }
      await expect(
        admin.query(
          'UPDATE task_execution.execution_judgment SET valid_until=valid_until WHERE judgment_id=$1',
          [judgmentId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const badJudgment = await envelope(
        'execution.freeze_work_order',
        {
          workOrderContract: revised,
          validationSnapshotRef: {
            ...record(judgmentRef),
            contentHash: contentHash('f'.repeat(64)),
          },
          specificationHash: revised.specificationHash,
        } as unknown as CanonicalJsonObject,
        revised.workOrderRef as Common.ObjectRef,
        true,
      );
      await expect(entry.freeze(badJudgment, sessionFor(service))).rejects.toMatchObject({
        code: 'REFERENCE_INVALID',
      });
      expect(await receiptRows(badJudgment.idempotencyKey)).toEqual([]);
      // A lawful, smaller budget still differs from the exact Controls Policy.
      // Produce a separate owning Draft/Context so the mismatch is a business
      // judgment, rather than a forged change to the original immutable Draft.
      const businessCandidate = structuredClone(revised);
      record(businessCandidate.budget).tokenLimit = 100;
      const businessDraft = Object.fromEntries(
        Object.entries(businessCandidate).filter(
          ([key]) =>
            ![
              'header',
              'workOrderRef',
              'projectRef',
              'contextSnapshotRef',
              'issuedAt',
              'expiresAt',
              'specificationHash',
            ].includes(key),
        ),
      );
      const { projectContextContractRef: oldContext, ...businessPins } = record(
        businessDraft.versionPins,
      );
      void oldContext;
      businessDraft.versionPins = businessPins;
      const businessWo = await createWorkOrder({
        taskId,
        taskMajor: '2.0',
        customDraft: businessDraft,
        expiresAt,
      });
      const businessDraftRef = await draftSnapshotRefOf(businessWo);
      const businessBuild = await initialContextEntry.build(
        await preparedBuild({
          workOrderId: businessWo,
          draftRef: businessDraftRef,
          principal: service,
          sourceSlices: [slice],
          idempotencyKey: newUuidV7(),
        }),
        sessionFor(service),
      );
      const businessContext = contextSnapshotRefOf(businessBuild);
      businessCandidate.workOrderRef = objectRef(WORK_ORDER_V11, businessWo, scope());
      businessCandidate.contextSnapshotRef = businessContext;
      record(businessCandidate.versionPins).projectContextContractRef = businessContext;
      record(businessCandidate.header).contractId = newUuidV7();
      businessCandidate.specificationHash = contentHash(
        sha256CanonicalJson(
          Object.fromEntries(
            specFields.map((k) => [k, businessCandidate[k]]),
          ) as CanonicalJsonObject,
        ),
      );
      record(businessCandidate.header).payloadHash = contentHash(
        hashContractPayload(businessCandidate as CanonicalJsonObject),
      );
      const businessEnvelope = await envelope(
        'execution.validate_work_order_draft',
        {
          draftSnapshotRef: businessDraftRef,
          candidateContract: businessCandidate,
          policyRef: validationRef,
          evaluatorRef: evaluator,
        } as unknown as CanonicalJsonObject,
        objectRef(
          'zhiju.execution.work_order_validation',
          newUuidV7(),
          scope(),
        ) as unknown as Common.ObjectRef,
      );
      const businessResult = await entry.validate(businessEnvelope, sessionFor(service));
      expect(businessResult).toMatchObject({ status: 'COMMITTED' });
      const businessJudgmentRef = record(
        record(committedPayload(businessResult)).data,
      ).validationSnapshotRef;
      const businessRow = (
        await admin.query(
          'SELECT canonical_payload FROM task_execution.execution_judgment WHERE judgment_id=$1',
          [record(businessJudgmentRef).objectId],
        )
      ).rows[0].canonical_payload;
      expect(record(businessRow).validation).toMatchObject({
        budgetValid: false,
        executable: false,
        violations: ['BUDGET_CONTROL_MISMATCH'],
      });
      const businessFreeze = await envelope(
        'execution.freeze_work_order',
        {
          workOrderContract: businessCandidate,
          validationSnapshotRef: businessJudgmentRef,
          specificationHash: businessCandidate.specificationHash,
        } as CanonicalJsonObject,
        businessCandidate.workOrderRef as Common.ObjectRef,
        true,
      );
      await expect(entry.freeze(businessFreeze, sessionFor(service))).rejects.toMatchObject({
        code: 'EXECUTION_JUDGMENT_INVALID',
      });
      expect(await receiptRows(businessFreeze.idempotencyKey)).toEqual([]);
      const shortPolicy = policyKey([newUuidV7(), newUuidV7()], fixture);
      await registerPolicyVersionAs({
        key: shortPolicy,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference('execution.work_order_validation.policy@1.0')],
        policyDocument: { maxValidationValiditySeconds: 2 },
      });
      const shortEnvelope = await envelope(
        'execution.validate_work_order_draft',
        { ...validationEnvelope.payload, policyRef: shortPolicy } as unknown as CanonicalJsonObject,
        objectRef(
          'zhiju.execution.work_order_validation',
          newUuidV7(),
          scope(),
        ) as unknown as Common.ObjectRef,
      );
      const shortResult = await entry.validate(shortEnvelope, sessionFor(service));
      const shortRef = record(record(committedPayload(shortResult)).data).validationSnapshotRef;
      const expiredFreeze = await envelope(
        'execution.freeze_work_order',
        {
          workOrderContract: revised,
          validationSnapshotRef: shortRef,
          specificationHash: revised.specificationHash,
        } as CanonicalJsonObject,
        revised.workOrderRef as Common.ObjectRef,
        true,
      );
      const laterEntry = createWorkOrderValidationEntry({
        taskExecutionDb: teDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        capabilityCodes: codes,
        capabilities: dependencyCapabilities,
        now: () => new Date(clock + 10000),
      });
      await expect(laterEntry.freeze(expiredFreeze, sessionFor(service))).rejects.toMatchObject({
        code: 'EXECUTION_JUDGMENT_STALE',
      });
      expect(await receiptRows(expiredFreeze.idempotencyKey)).toEqual([]);
      // Hold the real WorkOrder row lock after authorization, then cross the
      // judgment deadline before releasing it. No partial Freeze can commit.
      let lockClock = clock;
      const lockEntry = createWorkOrderValidationEntry({
        taskExecutionDb: teDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        capabilityCodes: codes,
        capabilities: dependencyCapabilities,
        now: () => new Date(lockClock),
      });
      const blocker = new pg.Client({ connectionString: databaseUrl });
      await blocker.connect();
      let pendingFreeze: Promise<unknown> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT work_order_id FROM task_execution.work_order WHERE work_order_id=$1 FOR UPDATE',
          [woId],
        );
        pendingFreeze = lockEntry
          .freeze(expiredFreeze, sessionFor(service))
          .catch((error: unknown) => error);
        await expect
          .poll(
            async () =>
              (
                await admin.query<{ n: number }>(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%work_order%'",
                )
              ).rows[0]?.n ?? 0,
            { timeout: 10000 },
          )
          .toBeGreaterThan(0);
        lockClock += 10000;
        await blocker.query('ROLLBACK');
        expect(await pendingFreeze).toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
        await pendingFreeze;
      }
      expect(await receiptRows(expiredFreeze.idempotencyKey)).toEqual([]);
      const conflictEnvelope = await envelope(
        'execution.validate_work_order_draft',
        { ...validationEnvelope.payload, policyRef: shortPolicy } as unknown as CanonicalJsonObject,
        validationEnvelope.targetRef,
      );
      await expect(
        entry.validate(
          { ...conflictEnvelope, idempotencyKey: validationEnvelope.idempotencyKey },
          sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
      let freezeEnvelope = await envelope(
        'execution.freeze_work_order',
        {
          workOrderContract: revised,
          validationSnapshotRef: judgmentRef,
          specificationHash: revised.specificationHash,
        } as CanonicalJsonObject,
        revised.workOrderRef as Common.ObjectRef,
        true,
      );
      // A real owning call fails after the Outbox insert. All TE writes,
      // including the claim, pointer, Contract and edges, must roll back.
      await admin.query(
        `CREATE FUNCTION public.wi219_freeze_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.aggregate_id='${woId}'::uuid AND NEW.event_type='execution.WorkOrderBecameReady' THEN RAISE EXCEPTION 'WI219_FREEZE_FAULT'; END IF; RETURN NEW; END $f$`,
      );
      await admin.query(
        'CREATE TRIGGER wi219_freeze_fault AFTER INSERT ON task_execution.outbox_event FOR EACH ROW EXECUTE FUNCTION public.wi219_freeze_fault()',
      );
      try {
        await expect(entry.freeze(freezeEnvelope, sessionFor(service))).rejects.toThrow(
          'WI219_FREEZE_FAULT',
        );
      } finally {
        await admin.query('DROP TRIGGER wi219_freeze_fault ON task_execution.outbox_event');
        await admin.query('DROP FUNCTION public.wi219_freeze_fault()');
      }
      expect(await receiptRows(freezeEnvelope.idempotencyKey)).toEqual([]);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM task_execution.work_order_contract WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(
        (
          await admin.query(
            'SELECT status,frozen_contract_id FROM task_execution.work_order WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ status: 'DRAFT', frozen_contract_id: null }]);
      expect(await outboxRows(woId)).toEqual([]);
      const competingEnvelope = await envelope(
        'execution.freeze_work_order',
        freezeEnvelope.payload,
        revised.workOrderRef as Common.ObjectRef,
        true,
      );
      const candidates = [freezeEnvelope, competingEnvelope];
      const outcomes = await Promise.allSettled(
        candidates.map((candidate) => entry.freeze(candidate, sessionFor(service))),
      );
      const winner = outcomes.findIndex(
        (result) => result.status === 'fulfilled' && result.value.status === 'COMMITTED',
      );
      expect(winner, JSON.stringify(outcomes)).toBeGreaterThanOrEqual(0);
      expect(
        outcomes.filter(
          (result) => result.status === 'fulfilled' && result.value.status === 'COMMITTED',
        ),
      ).toHaveLength(1);
      const loser = outcomes[1 - winner];
      expect(loser).toMatchObject({
        status: 'rejected',
        reason: { code: 'AGGREGATE_STATE_NOT_ALLOWED' },
      });
      const winningEnvelope = candidates[winner];
      if (winningEnvelope === undefined) throw new Error('missing winning Envelope');
      freezeEnvelope = winningEnvelope;
      await expect(
        entry.freeze(
          competingEnvelope === winningEnvelope ? candidates[0] : competingEnvelope,
          sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'AGGREGATE_STATE_NOT_ALLOWED' });

      expect(await entry.freeze(freezeEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      expect(await entry.validate(validationEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      const staleBuild = await initialContextEntry.build(
        await preparedBuild({
          workOrderId: woId,
          draftRef,
          principal: service,
          sourceSlices: [slice],
          idempotencyKey: newUuidV7(),
        }),
        sessionFor(service),
      );
      expect(staleBuild).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_DRAFT_SNAPSHOT_STALE,
      });
      const queryPayload = { workOrderRef: revised.workOrderRef };
      const readDecision = await auth.authorizeWorkOrderContractRead(
        identityDeps([fixture.projectId], service),
        {
          actorSnapshotRef: actorRef,
          commandType: 'execution.get_work_order_contract',
          commandVersion: '1.0',
          targetRef: revised.workOrderRef as Common.ObjectRef,
          commandPayloadHash: digestCanonicalPayload(queryPayload as CanonicalJsonObject).hash,
          authenticationContextHash: AUTH_HASH,
        },
      );
      const read = await entry.read(
        {
          queryId: newUuidV7(),
          queryType: 'execution.get_work_order_contract',
          queryVersion: '1.0',
          scopeRef: scope(),
          requester: objectRef(PRINCIPAL_OBJECT, serviceId, scope()),
          authenticationContextRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.identity.authentication_context',
            objectId: actorId,
            scope: scope(),
            contentHash: contentHash(AUTH_HASH.toString('hex')),
          },
          authorizationDecisionRef: readDecision.authorizationDecisionRef,
          consistencyRequirement: 'AUTHORITATIVE',
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload: queryPayload,
        },
        sessionFor(service),
      );
      expect(read.workOrderContract).toEqual(revised);
      // Historical success does not preserve a revoked dependency Grant.
      const revokedGrant = validationGrants.get('workOrderFreezeDraftReadV1');
      if (revokedGrant === undefined) throw new Error('missing Freeze Draft Grant');
      expect(
        await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
          targetId: revokedGrant,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          },
          reasonCode: 'WI219_REVOKE_FREEZE_DRAFT_READ',
          effectiveAt: new Date(clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
      await expect(entry.freeze(freezeEnvelope, sessionFor(service))).rejects.toMatchObject({
        code: 'AUTHORIZATION_REVOKED',
      });

      await expect(
        withTaskExecutionTransaction(teDb, runnerContext(service), (trx) =>
          sql`UPDATE task_execution.work_order_contract SET canonical_payload=canonical_payload WHERE work_order_id=${woId}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        admin.query(
          'UPDATE task_execution.work_order_contract SET canonical_payload=canonical_payload WHERE work_order_id=$1',
          [woId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        admin.query(
          'UPDATE task_execution.work_order SET frozen_contract_hash=$2 WHERE work_order_id=$1',
          [woId, Buffer.alloc(32, 7)],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const hidden = await withTaskExecutionTransaction(
        teDb,
        { ...runnerContext(service), allowedProjectIds: [newUuidV7()] },
        (trx) =>
          sql`SELECT contract_id FROM task_execution.work_order_contract WHERE work_order_id=${woId}::uuid`.execute(
            trx,
          ),
      );
      expect(hidden.rows).toEqual([]);

      expect(
        (
          await admin.query(
            'SELECT status,aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ status: 'READY', aggregate_version: '2' }]);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.WorkOrderBecameReady'",
            [woId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);

      // #221 starts from this committed READY fact. Each boundary receives
      // its own current Grant and target-bound Decision.
      clock = Date.now();
      const firstRunCodes = Object.fromEntries(
        CONTROLLED_FIRST_RUN_BINDINGS.map((binding, index) => [
          binding.boundary,
          `wi221.auth.c${index}`,
        ]),
      ) as ControlledFirstRunCapabilityCodes;
      const firstRunGrants = new Map<string, string>();
      for (const binding of CONTROLLED_FIRST_RUN_BINDINGS) {
        const targetObjectType = binding.targetObjectTypes[0];
        if (targetObjectType === undefined) throw new Error('missing first Run target');
        firstRunGrants.set(
          binding.boundary,
          await grant({
            principal: binding.expectedPrincipalKind === 'HUMAN' ? operator() : service,
            capabilityCode: firstRunCodes[binding.boundary],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType,
          }),
        );
      }
      await grant({
        principal: service,
        capabilityCode: 'artifact.revision.create',
        action: 'create',
        selectorType: 'CREATE_TARGET_TYPE',
        targetObjectType: 'zhiju.artifact.artifact_revision',
      });
      const firstRunAuth = createControlledFirstRunAuthorizationPort({
        capabilityCodes: firstRunCodes,
        now: () => new Date(clock),
      });
      const runtimeDriver = new LocalSyntheticRuntimeDriver();
      const firstRunEntry = createControlledFirstRunEntry({
        taskExecutionDb: teDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(tePool),
        runtimeDriver,
        receiptStorage: new InMemoryRenderObjectStorage(),
        capabilityCodes: firstRunCodes,
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      });
      async function firstRunEnvelope(
        commandType: string,
        targetRef: Common.ObjectRef,
        payload: CanonicalJsonObject,
        principal: Principal,
        expectedAggregateVersion?: number,
      ) {
        const payloadHash = digestCanonicalPayload(payload).hash;
        const decision = await firstRunAuth.authorize(
          identityDeps([fixture.projectId], principal),
          CONTROLLED_FIRST_RUN_BINDINGS.find(
            (binding) =>
              binding.commandType === commandType &&
              binding.targetObjectTypes.includes(targetRef.objectType) &&
              [
                'workOrderQueueV1',
                'executionBundleIssueV1',
                'runCreateV1',
                'runtimeDispatchV1',
                'runStartV1',
                'workOrderReconcileV1',
              ].includes(binding.boundary),
          )?.boundary ?? '',
          {
            actorSnapshotRef: principal.actorRef,
            commandType,
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: principal.authHash,
            targetRef,
          },
        );
        expect(decision.outcome).toBe('ALLOW');
        if (decision.outcome !== 'ALLOW') throw new Error('first Run Decision denied');
        return {
          commandId: newUuidV7(),
          commandType,
          commandVersion: '1.0',
          scopeRef: scope(),
          targetRef,
          actor: principal.actorRef,
          authorizationDecisionRef: decision.authorizationDecisionRef,
          idempotencyKey: newUuidV7(),
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHash(payloadHash.toString('hex')),
          },
        };
      }
      const workOrderRef = revised.workOrderRef as Common.ObjectRef;
      const queueEnvelope = await firstRunEnvelope(
        'execution.queue_work_order',
        workOrderRef,
        { queuePolicyRef: controlsRef as unknown as CanonicalJsonObject },
        operator(),
        2,
      );
      const deniedQueueEntry = createControlledFirstRunEntry({
        taskExecutionDb: teDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(tePool),
        runtimeDriver,
        receiptStorage: new InMemoryRenderObjectStorage(),
        capabilityCodes: { ...firstRunCodes, queueContextReadV1: 'wi221.ungranted' },
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      });
      await expect(deniedQueueEntry.queue(queueEnvelope, sessionFor())).rejects.toMatchObject({
        code: 'AUTHORIZATION_REVOKED',
      });
      expect(await receiptRows(queueEnvelope.idempotencyKey)).toEqual([]);
      const queued = await firstRunEntry.queue(queueEnvelope, sessionFor());
      expect(queued, JSON.stringify(queued)).toMatchObject({ status: 'COMMITTED' });
      expect(await firstRunEntry.queue(queueEnvelope, sessionFor())).toMatchObject({
        status: 'DUPLICATE',
      });
      const runRef = objectRef('execution.run', newUuidV7(), scope()) as Common.ObjectRef;
      const bundleEnvelope = await firstRunEnvelope(
        'identity.issue_execution_capability_bundle',
        objectRef(
          'zhiju.identity.execution_capability_bundle',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef,
        {
          runRef,
          workOrderRef,
          workOrderContractRef: read.contractRef,
          contextSnapshotRef: contextRef,
          servicePrincipalRef: { principalId: serviceId, principalKind: 'SERVICE' },
          requestedCapabilities: revised.allowedCapabilities,
        } as unknown as CanonicalJsonObject,
        service,
      );
      const bundle = await firstRunEntry.issueBundle(bundleEnvelope, sessionFor(service));
      expect(bundle, JSON.stringify(bundle)).toMatchObject({ status: 'COMMITTED' });
      const bundleRef = record(committedPayload(bundle as unknown as CommandResult)).bundleRef;
      const bundleValidUntil = (
        await admin.query<{ valid_until: Date }>(
          'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
          [record(bundleRef).objectId],
        )
      ).rows[0]?.valid_until;
      if (bundleValidUntil === undefined) throw new Error('missing Bundle');
      const runtimeBinding = {
        adapterCode: 'te.human_operated.synthetic',
        adapterVersion: '1.0',
        harnessId: 'zhiju.runtime.synthetic',
        harnessVersion: '1.0',
        provider: 'synthetic',
        modelId: 'synthetic',
        modelConfigHash: contentHash(sha256CanonicalJson({})),
      };
      const createEnvelope = await firstRunEnvelope(
        'execution.create_run',
        runRef,
        {
          creation: {
            workOrderRef,
            workOrderContractRef: read.contractRef,
            contextSnapshotRef: contextRef,
            capabilityGrantRef: bundleRef,
            leasePolicyRef: controlsRef,
            attemptNumber: 1,
            runtimeBinding,
            executionDeadline: bundleValidUntil.toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      const created = await firstRunEntry.createRun(createEnvelope, sessionFor(service));
      expect(created, JSON.stringify(created)).toMatchObject({ status: 'COMMITTED' });
      expect(await firstRunEntry.createRun(createEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      const createdData = record(committedPayload(created as unknown as CommandResult));
      async function firstRunQuery(
        queryType: string,
        targetRef: Common.ObjectRef,
        payload: CanonicalJsonObject,
        key: 'runtimeAttemptBindingReadV1',
      ) {
        const decision = await firstRunAuth.authorize(
          identityDeps([fixture.projectId], service),
          key,
          {
            actorSnapshotRef: service.actorRef,
            commandType: queryType,
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(payload).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef,
          },
        );
        if (decision.outcome !== 'ALLOW') throw new Error('first Run query Decision denied');
        return {
          queryId: newUuidV7(),
          queryType,
          queryVersion: '1.0',
          scopeRef: scope(),
          requester: objectRef(PRINCIPAL_OBJECT, serviceId, scope()),
          authenticationContextRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.identity.authentication_context',
            objectId: actorId,
            scope: scope(),
            contentHash: contentHash(AUTH_HASH.toString('hex')),
          },
          authorizationDecisionRef: decision.authorizationDecisionRef,
          consistencyRequirement: 'AUTHORITATIVE',
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
        };
      }
      const attemptRef = objectRef(
        'integration.runtime_attempt',
        newUuidV7(),
        scope(),
      ) as Common.ObjectRef;
      const dispatchEnvelope = await firstRunEnvelope(
        'integration.request_runtime_dispatch',
        attemptRef,
        {
          request: {
            workOrderRef,
            runRef,
            workOrderContractRef: read.contractRef,
            contextSnapshotRef: contextRef,
            capabilityGrantRef: bundleRef,
            runtimeBinding,
            stableIdempotencyKey: newUuidV7(),
            requestedAt: new Date(clock).toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      const dispatched = (await firstRunEntry.dispatch(
        dispatchEnvelope,
        sessionFor(service),
      )) as IntegrationGateway.IntegrationGetRuntimeAttemptBindingResult;
      expect(dispatched.status).toBe('SUCCEEDED');
      expect(dispatched.acknowledgement?.source).toBe('SYNTHETIC_DRIVER');
      expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
      const attemptBinding = await firstRunEntry.getRuntimeAttemptBinding(
        await firstRunQuery(
          'integration.get_runtime_attempt_binding',
          attemptRef,
          { attemptRef } as unknown as CanonicalJsonObject,
          'runtimeAttemptBindingReadV1',
        ),
        sessionFor(service),
      );
      expect(attemptBinding).toEqual(dispatched);
      const replayedDispatch = await firstRunEntry.dispatch(dispatchEnvelope, sessionFor(service));
      expect(replayedDispatch).toEqual(dispatched);
      expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
      const startEnvelope = await firstRunEnvelope(
        'execution.start_run',
        runRef,
        {
          leaseId: createdData.leaseId,
          fencingToken: 1,
          runtimeAttemptRef: attemptRef,
          startedAt: new Date(clock).toISOString(),
        } as unknown as CanonicalJsonObject,
        service,
        1,
      );
      const startSession = { ...sessionFor(service), serviceEntryAt: new Date(clock) };
      const started = await firstRunEntry.startRun(startEnvelope, startSession);
      expect(started, JSON.stringify(started)).toMatchObject({ status: 'COMMITTED' });
      expect(await firstRunEntry.startRun(startEnvelope, startSession)).toMatchObject({
        status: 'DUPLICATE',
      });
      const reconcileEnvelope = await firstRunEnvelope(
        'execution.reconcile_work_order_execution',
        workOrderRef,
        { triggerRef: runRef } as unknown as CanonicalJsonObject,
        service,
        3,
      );
      const reconciled = await firstRunEntry.reconcile(reconcileEnvelope, sessionFor(service));
      expect(reconciled, JSON.stringify(reconciled)).toMatchObject({ status: 'COMMITTED' });
      expect(
        (
          await admin.query<{ status: string; aggregate_version: string }>(
            'SELECT status,aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ status: 'RUNNING', aggregate_version: '4' }]);
      expect(
        (
          await admin.query<{ status: string; aggregate_version: string }>(
            'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'RUNNING', aggregate_version: '2' }]);
      expect(
        (
          await admin.query<{ count: string }>(
            "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunStarted'",
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      const queueGrantId = firstRunGrants.get('workOrderQueueV1');
      if (queueGrantId === undefined) throw new Error('missing Queue Grant');
      expect(
        await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
          targetId: queueGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          },
          reasonCode: 'WI221_REVOKE_QUEUE',
          effectiveAt: new Date(clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
      await expect(firstRunEntry.queue(queueEnvelope, sessionFor())).rejects.toMatchObject({
        code: 'AUTHORIZATION_REVOKED',
      });
    },
  );
});
