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
import { verifyControlledFinalUpgrade } from './controlled-final-upgrade.js';
import {
  createWorkOrderValidationEntry,
  createTaskReadinessEntry,
  createControlledFirstRunEntry,
  createControlledFinalRecoveryWorker,
} from '@zhiju/api/composition';
import {
  CONTROLLED_FIRST_RUN_BINDINGS,
  createControlledFirstRunAuthorizationPort,
  readIntegrityForExpiry,
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
  withRenderTransaction,
} from '@zhiju/integration-gateway';
import {
  workOrderReadyProfileRegistry,
  registeredEvaluatorProfileReference,
} from '@zhiju/contracts';
import {
  recoverControlledFinalRuns,
  scanControlledFinalCandidates,
  controlledFinalProcessId,
  listControlledFinalProgress,
  createControlledFinalProgress,
  advanceControlledFinalProgress,
  suspendTimedOutControlledFinalProgress,
  handleGetWorkOrderContract,
  withTaskExecutionTransaction,
  type ControlledFinalRecoveryCommand,
  type ControlledFinalProgress,
  type ControlledFinalProgressAdvance,
} from '@zhiju/task-execution';
import { hashContractPayload, sha256CanonicalJson } from '@zhiju/shared-kernel';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql, type Kysely, type KyselyPlugin } from 'kysely';
import {
  createBlockedInputRecoveryEntry,
  createBlockedInputRecoveryWorker,
  createRecoveryProcessAuthorities,
  type RecoverySession,
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
  BLOCKED_INPUT_RECOVERY_BINDINGS,
  createRecoveryAuthorizationPort,
  assignRole,
  revokeRole,
  readRecoveryHumanEligibility,
  type RecoveryHumanEligibilityInput,
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
  handleRegisterSourceMaterial,
  handleAcceptSourceMaterial,
  EnterpriseBusinessRepository,
  withEnterpriseProjectTransaction,
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
  readBlockedInputRecoveryProgress,
  blockedInputRecoveryProcessId,
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
  function progress(event: string, detail: string): void {
    process.stdout.write(`[initial-context] ${event}: ${detail}\n`);
  }
  const cleanupResources: (pg.Pool | pg.Client)[] = [];
  let currentPhase = 'idle';
  let phaseStarted = performance.now();
  function phaseEnd(): void {
    if (currentPhase === 'idle') return;
    progress(
      'phase end',
      `${currentPhase}; elapsedMs=${Math.round(performance.now() - phaseStarted)}`,
    );
    currentPhase = 'idle';
  }
  function phase(name: string): void {
    phaseEnd();
    currentPhase = name;
    phaseStarted = performance.now();
    progress('phase start', name);
  }
  async function databaseWaits(): Promise<void> {
    // No SQL text, business payloads, credentials or connection URLs.
    const result = await admin.query(
      `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers,
              extract(epoch FROM clock_timestamp()-xact_start)::int AS transaction_seconds
       FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`,
    );
    progress('database activity', JSON.stringify(result.rows));
  }
  async function waitForDeadline(milliseconds: number, label: string): Promise<void> {
    const started = performance.now();
    progress('wait start', `${label}; requestedMs=${milliseconds}`);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    } finally {
      progress('wait end', `${label}; elapsedMs=${Math.round(performance.now() - started)}`);
    }
  }
  const INTEGRATION_TEST_TIMEOUT = 60_000;
  function itIntegration(
    name: string,
    run: () => Promise<void>,
    timeout = INTEGRATION_TEST_TIMEOUT,
  ): void {
    it(name, { timeout }, async () => {
      const started = performance.now();
      progress('test start', name);
      phase('test body');
      const heartbeat = setInterval(() => {
        progress('heartbeat', `${name}; phase=${currentPhase}; pending=${pendingOperations.size}`);
        void databaseWaits().catch(() => {
          // Diagnostics are best effort; preserve the original failure.
        });
      }, 30_000);
      try {
        await run();
      } catch (error) {
        await databaseWaits().catch(() => {
          // Diagnostics are best effort; preserve the original failure.
        });
        throw error;
      } finally {
        clearInterval(heartbeat);
        phaseEnd();
        progress('test body end', `${name}; elapsedMs=${Math.round(performance.now() - started)}`);
      }
    });
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
    phase('pending operation drain');
    // Drain until two consecutive quiescent passes: an abandoned helper can
    // sit between two tracked drivers with its continuation not yet queued.
    let quiescentPasses = 0;
    while (quiescentPasses < 2) {
      await Promise.allSettled([...pendingOperations]);
      await new Promise((resolve) => setImmediate(resolve));
      quiescentPasses = pendingOperations.size === 0 ? quiescentPasses + 1 : 0;
    }
    phaseEnd();
  }, 120_000);

  function observeEntry<T extends object>(entry: T): T {
    return new Proxy(entry, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const started = performance.now();
          progress('command start', String(key));
          return track(
            Promise.resolve().then(() => Reflect.apply(value, target, args) as unknown),
          ).finally(() => {
            progress(
              'command end',
              `${String(key)}; elapsedMs=${Math.round(performance.now() - started)}`,
            );
          });
        };
      },
    });
  }

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

  function sessionFor(principal: Principal = operator()): RecoverySession {
    return {
      serviceEntryAt: new Date(clock),
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
    targetObjectTypes?: readonly string[];
    action: string;
    actions?: readonly string[];
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
      resourceSelectors: (input.targetObjectTypes ?? [input.targetObjectType]).map(
        (objectType) => ({ selectorType: input.selectorType, objectType }),
      ),
      actions: [...(input.actions ?? [input.action])],
      validFrom: PAST,
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      grantPolicySnapshotId: input.grantPolicySnapshot?.id ?? POLICY_SNAPSHOT_ID,
      grantPolicySnapshotHash: input.grantPolicySnapshot?.hash ?? grantPolicyHash,
      justification: 'IM-06 #216 initial Context fixture',
      idempotencyKey: `wi216:grant:${grantId}`,
    });
    expect(result.status, JSON.stringify(result)).toBe('COMMITTED');
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
    phase('suite business preparation');
    admin = new pg.Client({ connectionString: databaseUrl });
    cleanupResources.push(admin);
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
    cleanupResources.push(tePool);
    ipPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    cleanupResources.push(ipPool);
    epPool = new pg.Pool({ connectionString: probeConnectionUrl, max: 6 });
    cleanupResources.push(epPool);
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
    phaseEnd();
  }, 300_000);

  afterAll(async () => {
    phase('suite cleanup');
    try {
      // Setup can fail before a pool exists. Close every initialized resource
      // even if another close fails, and preserve cleanup failures for Vitest.
      const settled = await Promise.allSettled(cleanupResources.map((resource) => resource.end()));
      const failures = settled.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : [],
      );
      if (failures.length) throw new AggregateError(failures, 'initial Context cleanup failed');
    } finally {
      phaseEnd();
    }
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
    expect(catalog.operations).toHaveLength(230);
    expect(
      catalog.operations.filter((operation) => operation.owner === 'task-execution'),
    ).toHaveLength(57);
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
      expect(catalog.operations).toHaveLength(230);
      expect(
        catalog.operations.filter((operation) => operation.owner === 'task-execution'),
      ).toHaveLength(57);
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
    const taskCodeSuffix = taskId.replaceAll('-', '');
    const capabilityCodes = {
      taskReadinessBuildV1: `wi219.task.readiness.${taskCodeSuffix}`,
      taskReadyV1: `wi219.task.ready.${taskCodeSuffix}`,
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

  describe('TE-VAL-S-008 first Run terminal paths', () => {
    interface RecoveryFixture {
      runRef: Common.ObjectRef;
      attemptRef: Common.ObjectRef;
      workOrderRef: Common.ObjectRef;
      resultId: string;
      scanContext: TaskExecutionTransactionContext;
      ports: Parameters<typeof recoverControlledFinalRuns>[2];
      driver: LocalSyntheticRuntimeDriver;
    }

    const runScenario = async (
      terminalScenario:
        | 'BOUNDED_RECOVERY'
        | 'SUCCEEDED'
        | 'MIX_VALIDATIONS'
        | 'ACCEPT_RACE'
        | 'ELIGIBILITY_CHANGE'
        | 'TIMED_OUT'
        | 'TERMINAL_BEFORE_FINAL'
        | 'IG_WRONG_SESSION'
        | 'RACE'
        | 'LOCK_DEADLINE'
        | 'RECOVERY'
        | 'RECOVERY_WORKER'
        | 'RECOVERY_MULTIPLE'
        | 'LEGACY_UPGRADE'
        | 'RECOVERY_EXPIRE'
        | 'VALIDATION_EXPIRED'
        | 'UNSUPPORTED_FINAL'
        | 'TIMED_OUT_BUNDLE_EXPIRED'
        | 'NON_FINAL_CORE_REJECT',
      negativeFinalCase:
        | 'RUNTIME_USAGE'
        | 'OUTCOME'
        | 'BUSINESS_OUTPUT'
        | 'ARTIFACT_ALIAS'
        | 'WORKSPACE_OUTPUT'
        | 'FINDING'
        | 'KNOWLEDGE_PROPOSAL'
        | 'INPUT_REQUEST_PROPOSAL'
        | 'FOLLOW_UP_PROPOSAL'
        | 'CONTINUATION'
        | 'HEADER'
        | 'PROVENANCE'
        | 'TIME' = 'RUNTIME_USAGE',
      foreignValidations?: CanonicalJsonObject,
      observeValidations?: (validations: CanonicalJsonObject) => void,
      eligibilityChange?: {
        readonly step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE';
        readonly source: 'GRANT' | 'POLICY';
        readonly whileLocked?: boolean;
      },
      observeRecovery?: (value: RecoveryFixture) => Promise<void>,
      recoveryVariant:
        | 'NORMAL'
        | 'SUSPEND'
        | 'BUDGET_EXHAUSTED'
        | 'EXPIRE_SOURCE'
        | 'SECOND_WRONG_SESSION'
        | 'SECOND_EXPIRY_RACE'
        | 'OTHER_CHILD'
        | 'REQUEST_EXPIRED'
        | 'CONTROLS_SUPERSEDED'
        | 'BUILDER_SUPERSEDED'
        | 'STALE_CONTEXT'
        | 'SECOND_BLOCKED'
        | 'SECOND_PARTIAL'
        | 'SECOND_FAILED' = 'NORMAL',
    ) => {
      phase(`scenario ${terminalScenario}/${negativeFinalCase}: business preparation`);
      // This independent chain must not inherit the time spent running the
      // preceding 22 cases: the Decision lookup's bootstrap lease is 60s
      // from the trusted instant, and PostgreSQL checks it against wall time.
      // Run common precondition refusals once; every other case still produces
      // its own live Task/Draft/Context/READY/Run through the owning entries.
      const bounded = terminalScenario === 'BOUNDED_RECOVERY';
      const exercisePreparationMatrix = terminalScenario === 'SUCCEEDED';
      const positiveFinalScenario =
        terminalScenario === 'SUCCEEDED' ||
        terminalScenario === 'MIX_VALIDATIONS' ||
        terminalScenario === 'ACCEPT_RACE';
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
      const borrowedActors: Principal[] = [];
      if (exercisePreparationMatrix || bounded) {
        const otherServiceId = newUuidV7();
        await withIdentityTransaction(identityDb, identityContext([]), (trx) =>
          identityRepo.insertPrincipal(trx, {
            id: otherServiceId,
            principalKind: bounded ? 'AGENT' : 'SERVICE',
            displayName: 'WI-224 unrelated service',
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: OPERATOR_ACTOR,
          }),
        );
        for (const subject of [
          { principalId: otherServiceId, kind: bounded ? 'AGENT' : 'SERVICE' },
          { principalId: OPERATOR, kind: 'HUMAN' },
        ] as const) {
          const snapshotId = newUuidV7();
          const snapshot = await createActorSnapshot(identityDeps([fixture.projectId]), {
            actorSnapshotId: snapshotId,
            principalId: subject.principalId,
            declaredPrincipalKind: subject.kind,
            authenticationContextHash: AUTH_HASH,
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            ...(subject.kind === 'HUMAN'
              ? {
                  actingForPrincipalId: serviceId,
                  actingForKind: 'SERVICE' as const,
                }
              : {}),
          });
          borrowedActors.push({
            principalId: subject.principalId,
            principalKind: subject.kind,
            actorSnapshotId: snapshotId,
            actorRef: snapshot,
            authHash: AUTH_HASH,
          });
        }
      }
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
        await grant({
          principal: service,
          capabilityCode,
          action,
          targetObjectType,
          selectorType,
        });
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
        policyDocument: {
          maxSliceValiditySeconds: 3600,
          allowedPurposeCodes: [PURPOSE_DOCUMENT],
        },
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
      record(revised.budget).wallClockLimit =
        terminalScenario === 'LEGACY_UPGRADE'
          ? 'PT120S'
          : terminalScenario === 'ELIGIBILITY_CHANGE' ||
              terminalScenario === 'TIMED_OUT' ||
              terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
              terminalScenario === 'IG_WRONG_SESSION' ||
              terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
              terminalScenario === 'UNSUPPORTED_FINAL' ||
              terminalScenario === 'NON_FINAL_CORE_REJECT'
            ? eligibilityChange?.whileLocked === true
              ? 'PT30S'
              : 'PT10S'
            : terminalScenario === 'RECOVERY_EXPIRE'
              ? 'PT30S'
              : terminalScenario === 'VALIDATION_EXPIRED'
                ? 'PT30S'
                : terminalScenario === 'RACE' || terminalScenario === 'LOCK_DEADLINE'
                  ? 'PT30S'
                  : 'PT600S';
      if (['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant))
        record(revised.budget).wallClockLimit = 'PT30S';
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
      const recoveryBuilderRef =
        recoveryVariant === 'BUILDER_SUPERSEDED'
          ? policyKey([newUuidV7(), newUuidV7()], fixture)
          : policyKey(BUILDER_POLICY.main, fixture);
      if (recoveryVariant === 'BUILDER_SUPERSEDED')
        await registerPolicyVersionAs({
          key: recoveryBuilderRef,
          factId: newUuidV7(),
          idempotencyKey: newUuidV7(),
          effectiveFrom: PAST,
          policySchemaRefs: [profileReference(BUILDER_PROFILE)],
          policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
        });
      record(revised.versionPins).contextBuilderPolicyRef = recoveryBuilderRef;
      for (const group of ['allowedCapabilities', 'deniedCapabilities'])
        for (const cap of revised[group] as Record<string, unknown>[])
          cap.expiresAt = new Date(clock + 3600_000).toISOString();
      if (bounded) {
        record(revised.executionPolicy).maxAttempts = 2;
        record(revised.executionPolicy).retryableOutcomes = ['BLOCKED_INPUT'];
        delete record(revised.budget).tokenLimit;
        delete record(revised.budget).toolCallLimit;
        delete record(revised.budget).monetaryLimit;
      }
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
        policySchemaRefs: [
          profileReference(
            bounded
              ? 'execution.work_order_controls.policy@1.1'
              : 'execution.work_order_controls.policy@1.0',
          ),
        ],
        policyDocument: {
          ...(bounded
            ? {
                recovery: {
                  answerSpecProfile: 'execution.answer.customer_material.v1',
                  requestType: 'execution.input.customer_material_confirmation',
                  responderRole: 'project.customer_material.confirmer',
                  maxBlockingRequests: 1,
                  maxRecoveryRuns: 1,
                  retryReason: 'BLOCKED_INPUT_RESOLVED',
                  run2Outcome: 'COMPLETED',
                  materialUse: 'REFERENCE_ONLY',
                },
              }
            : {}),
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
      const otherChildId =
        recoveryVariant === 'OTHER_CHILD'
          ? await createWorkOrder({
              taskId,
              taskMajor: '2.0',
              customDraft: structuredClone(draft),
              expiresAt,
            })
          : undefined;
      const draftRef = await draftSnapshotRefOf(woId);
      const contextBuild = await initialContextEntry.build(
        await preparedBuild({
          workOrderId: woId,
          draftRef,
          principal: service,
          sourceSlices: [slice],
          builderPolicyRef: recoveryBuilderRef,
          idempotencyKey: newUuidV7(),
        }),
        sessionFor(service),
      );
      expect(contextBuild, JSON.stringify(contextBuild)).toMatchObject({ status: 'COMMITTED' });
      const contextRef = contextSnapshotRefOf(contextBuild);
      if (terminalScenario === 'LEGACY_UPGRADE') {
        phase('historical WorkOrder Validation upgrade');
        await verifyWorkOrderValidationUpgrade(admin, fixture.enterpriseId);
        phase('Validation preparation');
      }
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
      if (exercisePreparationMatrix) {
        phase('Validation refusal matrix');
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
      }
      phase('Validation and SQL guard matrix');
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
      if (exercisePreparationMatrix) {
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
          {
            ...validationEnvelope.payload,
            policyRef: shortPolicy,
          } as unknown as CanonicalJsonObject,
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
          {
            ...validationEnvelope.payload,
            policyRef: shortPolicy,
          } as unknown as CanonicalJsonObject,
          validationEnvelope.targetRef,
        );
        await expect(
          entry.validate(
            { ...conflictEnvelope, idempotencyKey: validationEnvelope.idempotencyKey },
            sessionFor(service),
          ),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
      }
      phase('Freeze fault and concurrency matrix');
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
      if (exercisePreparationMatrix) {
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
      }
      if (!exercisePreparationMatrix) {
        expect(await entry.freeze(freezeEnvelope, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
      }
      expect(await entry.freeze(freezeEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      expect(await entry.validate(validationEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      if (exercisePreparationMatrix) {
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
      }
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
      if (exercisePreparationMatrix) {
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
      }
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

      let otherChildContract: Record<string, unknown> | undefined;
      let otherChildContractRef: unknown;
      let otherChildContextRef: unknown;
      if (otherChildId) {
        const childDraftRef = await draftSnapshotRefOf(otherChildId);
        const builtChild = await initialContextEntry.build(
          await preparedBuild({
            workOrderId: otherChildId,
            draftRef: childDraftRef,
            principal: service,
            sourceSlices: [slice],
            builderPolicyRef: recoveryBuilderRef,
            idempotencyKey: newUuidV7(),
          }),
          sessionFor(service),
        );
        otherChildContextRef = contextSnapshotRefOf(builtChild);
        otherChildContract = structuredClone(revised);
        otherChildContract.workOrderRef = objectRef(WORK_ORDER_V11, otherChildId, scope());
        otherChildContract.contextSnapshotRef = otherChildContextRef;
        record(otherChildContract.versionPins).projectContextContractRef = otherChildContextRef;
        record(otherChildContract.header).contractId = newUuidV7();
        otherChildContract.specificationHash = contentHash(
          sha256CanonicalJson(
            Object.fromEntries(
              specFields.map((key) => [key, definedValue(otherChildContract)[key]]),
            ) as CanonicalJsonObject,
          ),
        );
        record(otherChildContract.header).payloadHash = contentHash(
          hashContractPayload(otherChildContract as CanonicalJsonObject),
        );
        const validation = await entry.validate(
          await envelope(
            'execution.validate_work_order_draft',
            {
              ...validationEnvelope.payload,
              draftSnapshotRef: childDraftRef,
              candidateContract: otherChildContract,
            } as unknown as CanonicalJsonObject,
            objectRef(
              'zhiju.execution.work_order_validation',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
          ),
          sessionFor(service),
        );
        const validationRef = record(
          record(committedPayload(validation)).data,
        ).validationSnapshotRef;
        const frozen = await entry.freeze(
          await envelope(
            'execution.freeze_work_order',
            {
              workOrderContract: otherChildContract,
              validationSnapshotRef: validationRef,
              specificationHash: otherChildContract.specificationHash,
            } as CanonicalJsonObject,
            otherChildContract.workOrderRef as Common.ObjectRef,
            true,
          ),
          sessionFor(service),
        );
        expect(frozen).toMatchObject({ status: 'COMMITTED' });
        otherChildContractRef = record(committedPayload(frozen)).workOrderContractRef;
      }
      phase('Run authorization and preparation');
      // #221 starts from this committed READY fact. Each boundary receives
      // its own current Grant and target-bound Decision.
      clock = Date.now();
      const firstRunCodes = Object.fromEntries(
        CONTROLLED_FIRST_RUN_BINDINGS.map((binding, index) => [
          binding.boundary,
          `wi221.auth.c${index}.${serviceId.replaceAll('-', '')}`,
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
      const executionCapabilityGrantId = await grant({
        principal: service,
        capabilityCode: 'artifact.revision.create',
        action: 'create',
        selectorType: 'CREATE_TARGET_TYPE',
        targetObjectType: 'zhiju.artifact.artifact_revision',
        ...(terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
          ? { validTo: new Date(clock + 45_000) }
          : {}),
      });
      const firstRunAuth = createControlledFirstRunAuthorizationPort({
        capabilityCodes: firstRunCodes,

        now: () => new Date(clock),
      });
      const outputExamples = JSON.parse(
        readFileSync(
          new URL('../fixtures/contracts/core/agent-result-valid.json', import.meta.url),
          'utf8',
        ),
      ) as Record<string, unknown>;
      rewriteFixtureScopes(outputExamples, fixture);
      const example = (field: string): unknown => {
        const values = outputExamples[field];
        if (!Array.isArray(values) || values.length === 0)
          throw new Error(`missing AgentResult ${field} fixture`);
        return structuredClone(values[0] as unknown);
      };
      const businessOutput = (runRef: unknown) => {
        const output = record(example('businessOutputs'));
        output.createdByRunRef = runRef;
        if (negativeFinalCase === 'ARTIFACT_ALIAS') {
          output.objectType = 'artifact.artifact_revision';
          record(output.ref).objectType = 'artifact.artifact_revision';
        }
        return output;
      };
      const queryReads: string[] = [];
      const queryWrites: string[] = [];
      const queryProbe: KyselyPlugin = {
        transformQuery(args) {
          if (args.node.kind === 'SelectQueryNode') queryReads.push(JSON.stringify(args.node));
          if (['InsertQueryNode', 'UpdateQueryNode', 'DeleteQueryNode'].includes(args.node.kind))
            queryWrites.push(JSON.stringify(args.node));
          return args.node;
        },
        transformResult: (args) => Promise.resolve(args.result),
      };
      const guardedTeDb = teDb.withPlugin(queryProbe);
      const protectedReads = () =>
        queryReads.filter((query) =>
          /"name":"(?:task_execution|integration_gateway|artifact)"/u.test(query),
        );
      const recoveryCodes = Object.fromEntries(
        BLOCKED_INPUT_RECOVERY_BINDINGS.map((b, i) => [
          b.capabilityConfigKey,
          `wi231.c${i}.${serviceId.replaceAll('-', '')}`,
        ]),
      );
      if (bounded && recoveryVariant === 'NORMAL')
        recoveryCodes.informationRequestResolveV1 = definedValue(
          recoveryCodes.informationAnswerSubmitV1,
        );
      const recoveryAuth = createRecoveryAuthorizationPort({
        capabilityCodes: recoveryCodes,
        now: () => new Date(clock),
      });
      const recoveryGrants = new Map<string, string>();
      const recoveryConfig = {
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        recoveryCapabilityCodes: recoveryCodes,
        humanCapabilityCodes: {
          answerSubmit: definedValue(recoveryCodes.informationAnswerSubmitV1),
          requestResolve: definedValue(recoveryCodes.informationRequestResolveV1),
          materialRead: definedValue(recoveryCodes['recovery.answer_submit.material.v1']),
        },
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      };
      let recoveryCreateRaceDone = false;
      const recoveryFaults = new Set<string>();
      const recoverySqlVerified = new Set<string>();
      async function recoverySqlCounterexamples(
        envelope: Record<string, unknown>,
        execute: () => Promise<unknown>,
      ) {
        const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
        if (recoverySqlVerified.has(type)) return;
        recoverySqlVerified.add(type);
        const tables: Record<string, string[]> = {
          'execution.open_information_request': ['information_request_origin'],
          'execution.submit_information_answer': ['answer_submission'],
          'execution.resolve_information_request': [
            'answer_resolution',
            'resolution_receipt_observation',
          ],
          'execution.build_context_snapshot': ['context_snapshot_build'],
          'execution.schedule_work_order_retry': ['work_order_retry_intent'],
          'execution.create_run': ['run_retry_intent_consumption', 'run_budget_reservation'],
          'execution.finalize_run_from_acceptance': ['run_budget_consumption'],
        };
        const id = String(envelope.commandId);
        for (const table of tables[type] ?? []) {
          const columns = (
            await admin.query<{ column_name: string }>(
              "SELECT column_name FROM information_schema.columns WHERE table_schema='task_execution' AND table_name=$1",
              [table],
            )
          ).rows.map((r) => r.column_name);
          const mutations = [
            ['Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
            ['source Receipt', `NEW.source_command_id:='${newUuidV7()}'::uuid;`],
            ...(columns.includes('payload_hash')
              ? [['canonical Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"]]
              : []),
            ...(columns.includes('canonical_payload')
              ? [
                  [
                    'missing full reference',
                    "NEW.canonical_payload:='{}'::jsonb; NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);",
                  ],
                  [
                    'unknown canonical member',
                    'NEW.canonical_payload:=NEW.canonical_payload||\'{"unexpected":true}\'::jsonb; NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);',
                  ],
                  [
                    'null full Ref',
                    `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{${table === 'context_snapshot_build' ? 'frozenContractRef' : table === 'work_order_retry_intent' || table === 'run_retry_intent_consumption' ? 'workOrderContractRef' : table === 'resolution_receipt_observation' ? 'targetRef' : 'informationRequestRef'}}','null'::jsonb); NEW.payload_hash:=task_execution.recovery_payload_hash(NEW.canonical_payload);`,
                  ],
                ]
              : []),
          ];
          for (const [label, statement] of mutations) {
            await admin.query(
              `CREATE FUNCTION task_execution.wi231_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`,
            );
            await admin.query(
              `CREATE TRIGGER aa_wi231_mutation BEFORE INSERT ON task_execution.${table} FOR EACH ROW WHEN (NEW.source_command_id='${id}'::uuid) EXECUTE FUNCTION task_execution.wi231_mutation()`,
            );
            try {
              await expect(
                execute().catch((error: unknown) => {
                  if (
                    error !== null &&
                    typeof error === 'object' &&
                    'code' in error &&
                    !['22023', '23514', '23503', '42501', '23502'].includes(String(error.code))
                  )
                    throw new Error(`SQL probe ${table}/${label}: ${String(error.code)}`);
                  throw error;
                }),
                `TE-REC-D-011 ${table} ${label}`,
              ).rejects.toSatisfy(
                (error: unknown) =>
                  error !== null &&
                  typeof error === 'object' &&
                  'code' in error &&
                  ['22023', '23514', '23503', '42501', '23502'].includes(String(error.code)),
              );
            } finally {
              await admin.query(`DROP TRIGGER aa_wi231_mutation ON task_execution.${table}`);
              await admin.query('DROP FUNCTION task_execution.wi231_mutation()');
            }
          }
        }
        const omitted: Record<string, string[]> = {
          'execution.open_information_request': ['information_request_origin'],
          'execution.submit_information_answer': ['answer_submission'],
          'execution.resolve_information_request': ['resolution_receipt_observation'],
          'execution.create_run': ['run_retry_intent_consumption', 'run_budget_reservation'],
          'execution.finalize_run_from_acceptance': ['run_budget_consumption'],
        };
        for (const table of omitted[type] ?? []) {
          await admin.query(
            'CREATE FUNCTION task_execution.wi231_omit() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$',
          );
          await admin.query(
            `CREATE TRIGGER aa_wi231_omit BEFORE INSERT ON task_execution.${table} FOR EACH ROW WHEN (NEW.source_command_id='${id}'::uuid) EXECUTE FUNCTION task_execution.wi231_omit()`,
          );
          try {
            await expect(execute(), `TE-REC-D-011 required ${table}`).rejects.toMatchObject({
              code: '23514',
            });
          } finally {
            await admin.query(`DROP TRIGGER aa_wi231_omit ON task_execution.${table}`);
            await admin.query('DROP FUNCTION task_execution.wi231_omit()');
          }
        }
      }
      async function recoveryReceiptRollback(
        envelope: Record<string, unknown>,
        execute: () => Promise<unknown>,
      ) {
        const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
        const schema = type.startsWith('identity.')
          ? 'identity_policy'
          : type.startsWith('integration.')
            ? 'integration_gateway'
            : type.startsWith('project.')
              ? 'enterprise_project'
              : 'task_execution';
        const commandId = String(envelope.commandId);
        if (schema === 'task_execution') await recoverySqlCounterexamples(envelope, execute);
        const tables = (
          await admin.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='enterprise_id' AND table_name NOT IN ('command_receipt','audit_record','command_audit','authorization_decision','actor_snapshot','reference_edge') AND EXISTS (SELECT 1 FROM information_schema.columns p WHERE p.table_schema=$1 AND p.table_name=columns.table_name AND p.column_name='project_id') ORDER BY table_name`,
            [schema],
          )
        ).rows
          .map((r) => r.table_name)
          .filter(
            (t) => schema !== 'identity_policy' || t.startsWith('execution_capability_bundle'),
          );
        const snapshot = async () => {
          const value: Record<string, unknown> = {};
          for (const table of tables)
            value[table] = (
              await admin.query(
                `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM ${schema}.${table} t WHERE enterprise_id=$1 AND project_id=$2`,
                [fixture.enterpriseId, fixture.projectId],
              )
            ).rows;
          return value;
        };
        const before = await snapshot();
        await admin.query(
          `CREATE FUNCTION ${schema}.wi231_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI231_RECEIPT_FAULT'; END $f$`,
        );
        await admin.query(
          `CREATE TRIGGER wi231_receipt_fault ${type === 'integration.request_runtime_dispatch' ? 'AFTER INSERT' : 'AFTER UPDATE'} ON ${schema}.command_receipt FOR EACH ROW WHEN (NEW.command_id='${commandId}'::uuid AND NEW.outcome='${type === 'integration.request_runtime_dispatch' ? 'PENDING' : 'COMMITTED'}') EXECUTE FUNCTION ${schema}.wi231_receipt_fault()`,
        );
        try {
          await expect(execute(), type).rejects.toThrow('WI231_RECEIPT_FAULT');
        } finally {
          await admin.query(`DROP TRIGGER wi231_receipt_fault ON ${schema}.command_receipt`);
          await admin.query(`DROP FUNCTION ${schema}.wi231_receipt_fault()`);
        }
        expect(
          (
            await admin.query(
              `SELECT command_id FROM ${schema}.command_receipt WHERE command_id=$1`,
              [commandId],
            )
          ).rows,
          type,
        ).toEqual([]);
        expect(await snapshot(), `${type}: complete target rollback`).toEqual(before);
        if (type === 'integration.request_runtime_dispatch') {
          const beforeInvokes = runtimeDriver.invokedAttemptIds.length;
          await admin.query(
            `CREATE FUNCTION ${schema}.wi231_ack_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI231_ACK_FAULT'; END $f$`,
          );
          await admin.query(
            `CREATE TRIGGER wi231_ack_fault AFTER UPDATE ON ${schema}.command_receipt FOR EACH ROW WHEN (NEW.command_id='${commandId}'::uuid AND NEW.outcome='COMMITTED') EXECUTE FUNCTION ${schema}.wi231_ack_fault()`,
          );
          try {
            await expect(execute()).rejects.toThrow('WI231_ACK_FAULT');
          } finally {
            await admin.query(`DROP TRIGGER wi231_ack_fault ON ${schema}.command_receipt`);
            await admin.query(`DROP FUNCTION ${schema}.wi231_ack_fault()`);
          }
          expect(runtimeDriver.invokedAttemptIds.length).toBe(beforeInvokes + 1);
          expect(
            (
              await admin.query(
                `SELECT outcome FROM ${schema}.command_receipt WHERE command_id=$1`,
                [commandId],
              )
            ).rows,
          ).toEqual([{ outcome: 'PENDING' }]);
          expect(
            (
              await admin.query(
                `SELECT status FROM ${schema}.runtime_attempt WHERE source_command_id=$1`,
                [commandId],
              )
            ).rows,
          ).toEqual([{ status: 'CREATED' }]);
          for (const table of [
            'runtime_adapter_identity',
            'runtime_attempt_observation',
            'runtime_final_observation',
          ])
            expect(
              (
                await admin.query(
                  `SELECT count(*)::int n FROM ${schema}.${table} WHERE attempt_id=$1`,
                  [record(envelope.targetRef).objectId],
                )
              ).rows,
            ).toEqual([{ n: 0 }]);
        }
        recoveryFaults.add(commandId);
      }
      let faultFirstRunCommands = false;
      let processEnabled = false;
      let processStep = 0;
      const processHandoffs = new Set<number>();
      const processTypes = [
        'execution.open_information_request',
        'execution.reconcile_work_order_execution',
        'execution.reconcile_task_execution',
        'execution.build_context_snapshot',
        'execution.get_work_order_execution_state',
        'identity.issue_execution_capability_bundle',
        'execution.create_run',
        'integration.request_runtime_dispatch',
        'execution.start_run',
        'execution.reconcile_work_order_execution',
        'execution.reconcile_task_execution',
        'execution.reconcile_work_order_execution',
        'execution.reconcile_task_execution',
      ];
      let processPending: CanonicalJsonObject | undefined;
      let processExecute: ((command: CanonicalJsonObject) => Promise<unknown>) | undefined;
      let processResult: unknown;
      let processWorkers: ReturnType<typeof createBlockedInputRecoveryWorker>[] | undefined;
      const processAuthorities: Awaited<ReturnType<typeof createRecoveryProcessAuthorities>>[] = [];
      async function throughRecoveryProcess(
        envelope: Record<string, unknown>,
        execute: (command: CanonicalJsonObject) => Promise<unknown>,
      ) {
        processPending = envelope as CanonicalJsonObject;
        processExecute = execute;
        processResult = undefined;
        if (!processWorkers) {
          processWorkers = [];
          for (let worker = 0; worker < 2; worker++) {
            const target = objectRef(
              'zhiju.project.project',
              fixture.projectId,
              scope(),
            ) as Common.ObjectRef;
            const decision = async (key: string, type: string, payload: CanonicalJsonObject) => {
              const result = await recoveryAuth.authorize(
                identityDeps([fixture.projectId], service),
                key,
                {
                  actorSnapshotRef: service.actorRef,
                  commandType: type,
                  commandVersion: '1.0',
                  commandPayloadHash: digestCanonicalPayload(payload).hash,
                  authenticationContextHash: AUTH_HASH,
                  targetRef: target,
                },
              );
              if (result.outcome !== 'ALLOW') throw new Error('Process authority denied');
              return result.authorizationDecisionRef;
            };
            const authorities = await createRecoveryProcessAuthorities(
              recoveryConfig,
              sessionFor(service),
              scope(),
              await decision('recoveryCandidateScanV1', 'execution.recovery.candidate.scan', {
                scopeRef: scope(),
              }),
              await decision('recoveryProcessProgressV1', 'execution.process.recovery_progress', {
                scopeRef: scope(),
                action: 'read_progress',
              }),
            );
            processAuthorities.push(authorities);
            processWorkers.push(
              createBlockedInputRecoveryWorker({
                taskExecutionDb: teDb,
                projects: [
                  {
                    ...authorities,
                    ports: {
                      ...authorities,
                      prepareStep: (progress, key) => {
                        if (
                          progress.step !== processStep ||
                          progress.proposalId !== proposalId ||
                          !processPending
                        )
                          return Promise.resolve(undefined);
                        if (processPending.commandType !== undefined)
                          record(processPending).idempotencyKey = key;
                        return Promise.resolve(processPending);
                      },
                      execute: async (command) => {
                        const result = await definedValue(processExecute)(command);
                        if (processResult === undefined) processResult = result;
                        return command.queryType === undefined
                          ? {
                              status:
                                record(result).status === 'SUCCEEDED'
                                  ? 'COMMITTED'
                                  : String(record(result).status),
                            }
                          : (result as CanonicalJsonObject);
                      },
                      afterTargetCommit: () => {
                        if (!processHandoffs.has(processStep)) {
                          processHandoffs.add(processStep);
                          return Promise.reject(new Error('WI231_PROGRESS_LOST'));
                        }
                        return Promise.resolve();
                      },
                    },
                  },
                ],
                intervalMs: 1000,
                maxStepsPerProject: 1,
                onError: () => undefined,
              }),
            );
          }
        }
        await expect(
          definedValue(processWorkers[0])
            .tick()
            .then(async () => {
              const rows = await admin.query(
                "SELECT state,recovery_step,blocked_reason_code FROM task_execution.process_instance WHERE process_type='blocked-input-recovery@1' AND project_id=$1",
                [fixture.projectId],
              );
              throw new Error(
                `Unexpected recovery wait at ${processStep}: ${JSON.stringify(rows.rows)}`,
              );
            }),
        ).rejects.toThrow('WI231_PROGRESS_LOST');
        await Promise.all([
          definedValue(processWorkers[0]).tick(),
          definedValue(processWorkers[1]).tick(),
        ]);
        processStep++;
        processPending = undefined;
        return processResult;
      }
      const recoveryDependencyChecks = new Set<string>();
      async function missingRecoveryDependency(
        envelope: CanonicalJsonObject,
        method: PropertyKey,
        arguments_: unknown[],
        firstRun: boolean,
      ) {
        if (!bounded || !processEnabled) return;
        const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
        const consumers: Record<string, string> = {
          'execution.open_information_request': 'request_open',
          'execution.submit_information_answer': 'answer_submit',
          'execution.resolve_information_request': 'request_resolve',
          'execution.build_context_snapshot': 'frozen_context_build',
          'execution.schedule_work_order_retry': 'retry_schedule',
          'identity.issue_execution_capability_bundle': 'bundle_issue',
          'execution.create_run': 'run_create',
          'integration.request_runtime_dispatch': 'runtime_dispatch',
          'execution.start_run': 'run_start',
          'execution.submit_agent_result': 'result_submit',
          'execution.record_run_result': 'result_record',
          'execution.validate_agent_result': 'result_validate',
          'execution.accept_agent_result': 'result_accept',
          'execution.finalize_run_from_acceptance': 'run_finalize',
          ...(processStep >= 6
            ? {
                'execution.reconcile_work_order_execution': 'work_order_reconcile',
                'execution.reconcile_task_execution': 'task_reconcile',
              }
            : {}),
        };
        const consumer = consumers[type];
        if (!consumer || recoveryDependencyChecks.has(type)) return;
        recoveryDependencyChecks.add(type);
        const dependency = ['request_open', 'answer_submit'].includes(consumer)
          ? 'contract'
          : 'answer';
        const codes = {
          ...recoveryCodes,
          [`recovery.${consumer}.${dependency}.v1`]: 'wi231.missing.consumer.dependency',
        };
        const dependencyReads: string[] = [];
        const dependencyProbe: KyselyPlugin = {
          transformQuery(args) {
            if (['SelectQueryNode', 'RawNode'].includes(args.node.kind))
              dependencyReads.push(JSON.stringify(args.node));
            return args.node;
          },
          transformResult: (args) => Promise.resolve(args.result),
        };
        const refusedEntry = firstRun
          ? createControlledFirstRunEntry({
              ...firstRunConfig,
              taskExecutionDb: teDb.withPlugin(dependencyProbe),
              recovery: {
                recoveryCapabilityCodes: codes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            })
          : createBlockedInputRecoveryEntry({
              ...recoveryConfig,
              taskExecutionDb: teDb.withPlugin(dependencyProbe),
              recoveryCapabilityCodes: codes,
            });
        const execute: unknown = Reflect.get(refusedEntry, method);
        if (typeof execute !== 'function') throw new Error('missing tested owning method');
        await expect(
          Promise.resolve(Reflect.apply(execute, refusedEntry, arguments_) as unknown),
          `TE-REC-D-005 ${consumer} missing ${dependency} Grant`,
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        const table = dependency === 'contract' ? 'work_order_contract' : 'answer_submission';
        expect(
          dependencyReads.filter((query) => query.includes(table)),
          `${consumer} protected ${table} read`,
        ).toEqual([]);
        expect(await receiptRows(definedValue(envelope.idempotencyKey) as string)).toEqual([]);
      }
      function withRecoveryReceiptFaults<T extends object>(entry: T, firstRun = false): T {
        return new Proxy(entry, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (typeof value !== 'function') return value;
            return async (...args: unknown[]) => {
              const envelope = record(args[0]);
              const invoke = () => Promise.resolve(Reflect.apply(value, target, args) as unknown);
              const targetExecute = async (command: CanonicalJsonObject) => {
                const commandInvoke = () =>
                  Promise.resolve(
                    Reflect.apply(value, target, [command, ...args.slice(1)]) as unknown,
                  );
                await missingRecoveryDependency(
                  command,
                  key,
                  [command, ...args.slice(1)],
                  firstRun,
                );
                if (
                  bounded &&
                  (!firstRun || faultFirstRunCommands) &&
                  typeof command.commandType === 'string' &&
                  typeof command.commandId === 'string' &&
                  !recoveryFaults.has(command.commandId)
                )
                  await recoveryReceiptRollback(command, commandInvoke);
                if (
                  bounded &&
                  faultFirstRunCommands &&
                  command.commandType === 'execution.create_run' &&
                  !recoveryCreateRaceDone
                ) {
                  recoveryCreateRaceDone = true;
                  const race = await Promise.all([commandInvoke(), commandInvoke()]);
                  expect(race.map((result) => record(result).status).sort()).toEqual([
                    'COMMITTED',
                    'DUPLICATE',
                  ]);
                  expect(record(race[0]).resultPayload).toEqual(record(race[1]).resultPayload);
                  return definedValue(race.find((result) => record(result).status === 'COMMITTED'));
                }
                return commandInvoke();
              };
              if (
                processEnabled &&
                envelope.commandType === 'identity.issue_execution_capability_bundle' &&
                processStep === 4
              ) {
                const query = await recoveryEnvelope(
                  'workOrderExecutionStateReadV1',
                  workOrderRef,
                  { workOrderRef } as unknown as CanonicalJsonObject,
                  service,
                  undefined,
                  true,
                );
                await throughRecoveryProcess(query, (command) =>
                  recoveryEntryRaw.read(command, sessionFor(service)),
                );
              }
              if (
                processEnabled &&
                typeof envelope.commandType === 'string' &&
                processTypes[processStep] === envelope.commandType
              )
                return throughRecoveryProcess(envelope, targetExecute);
              if (typeof envelope.commandType === 'string')
                return targetExecute(envelope as CanonicalJsonObject);
              return invoke();
            };
          },
        });
      }
      const recoveryEntryRaw = createBlockedInputRecoveryEntry(recoveryConfig);
      const recoveryEntry = withRecoveryReceiptFaults(recoveryEntryRaw);
      async function recoveryEnvelope(
        key: string,
        target: Common.ObjectRef,
        payload: CanonicalJsonObject,
        principal: Principal,
        expectedVersion?: number,
        query = false,
      ): Promise<Record<string, unknown>> {
        const b = definedValue(
          BLOCKED_INPUT_RECOVERY_BINDINGS.find((b) => b.capabilityConfigKey === key),
        );
        const signed = await recoveryAuth.authorize(
          identityDeps([fixture.projectId], principal),
          key,
          {
            actorSnapshotRef: principal.actorRef,
            commandType: b.commandType,
            commandVersion: b.commandVersion,
            commandPayloadHash: digestCanonicalPayload(payload).hash,
            authenticationContextHash: principal.authHash,
            targetRef: target,
          },
        );
        expect(signed.outcome, key).toBe('ALLOW');
        if (signed.outcome !== 'ALLOW') throw new Error('denied recovery');
        const base = {
          scopeRef: scope(),
          authorizationDecisionRef: signed.authorizationDecisionRef,
          correlationId: newUuidV7(),
          requestedAt: new Date(clock).toISOString(),
          payload,
        };
        return query
          ? {
              ...base,
              queryId: newUuidV7(),
              queryType: b.commandType,
              queryVersion: b.commandVersion,
              requester: principal.actorRef,
              authenticationContextRef: {
                kind: 'CONTENT_ADDRESSED',
                objectType: 'zhiju.identity.authentication_context',
                objectId: principal.actorSnapshotId,
                scope: scope(),
                contentHash: contentHash(principal.authHash.toString('hex')),
              },
              consistencyRequirement: 'AUTHORITATIVE',
            }
          : {
              ...base,
              commandId: newUuidV7(),
              commandType: b.commandType,
              commandVersion: b.commandVersion,
              targetRef: target,
              actor: principal.actorRef,
              idempotencyKey: newUuidV7(),
              ...(expectedVersion === undefined
                ? {}
                : { expectedAggregateVersion: expectedVersion }),
              integrity: {
                canonicalizationVersion: '1',
                payloadHash: contentHash(digestCanonicalPayload(payload).hash.toString('hex')),
              },
            };
      }
      let recoverySource: Common.ContentAddressedRef | undefined,
        candidateMaterial: Common.VersionedRef | undefined;
      let recoveryProposeEnvelope: Record<string, unknown> | undefined;
      let otherDraftChildId: string | undefined;
      let otherChildResultRef: unknown;
      let otherChildAttemptRef: Common.ObjectRef | undefined;
      const proposalId = newUuidV7();
      if (bounded) {
        for (const b of BLOCKED_INPUT_RECOVERY_BINDINGS)
          for (const principal of b.expectedPrincipalKind === 'HUMAN'
            ? [operator()]
            : b.expectedPrincipalKind === 'SERVICE'
              ? [service]
              : [operator(), service]) {
            if (
              recoveryVariant === 'NORMAL' &&
              b.capabilityConfigKey === 'informationRequestResolveV1'
            )
              continue;
            const targetObjectType = definedValue(b.targetObjectTypes[0]);
            const id = await grant({
              principal,
              capabilityCode: definedValue(recoveryCodes[b.capabilityConfigKey]),
              action: b.requiredGrantAction,
              ...(recoveryVariant === 'NORMAL' &&
              b.capabilityConfigKey === 'informationAnswerSubmitV1'
                ? { actions: [b.requiredGrantAction, 'execution.information_request.resolve.v1'] }
                : {}),
              selectorType: b.selectorType,
              targetObjectType,
              targetObjectTypes: b.targetObjectTypes,
            });
            recoveryGrants.set(
              `${principal.principalId}:${b.capabilityConfigKey}:${targetObjectType}`,
              id,
            );
            if (
              recoveryVariant === 'NORMAL' &&
              b.capabilityConfigKey === 'informationAnswerSubmitV1'
            )
              recoveryGrants.set(
                `${principal.principalId}:informationRequestResolveV1:${targetObjectType}`,
                id,
              );
          }
        if (
          (
            await admin.query(
              "SELECT id FROM identity_policy.role_assignment WHERE principal_id=$1 AND project_id=$2 AND role_code='project.customer_material.confirmer' AND status='ACTIVE'",
              [OPERATOR, fixture.projectId],
            )
          ).rows.length === 0
        ) {
          expect(
            await assignRole(identityDeps([fixture.projectId]), {
              assignmentId: newUuidV7(),
              principalId: OPERATOR,
              roleCode: 'project.customer_material.confirmer',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              validFrom: PAST,
              justification: 'Bounded recovery Human fixture',
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
        }
        if (otherChildId) {
          otherDraftChildId = await createWorkOrder({
            taskId,
            taskMajor: '2.0',
            customDraft: structuredClone(draft),
            expiresAt,
          });
          const state = await recoveryEntryRaw.read(
            await recoveryEnvelope(
              'taskStateReadV1',
              revised.taskRef as Common.ObjectRef,
              { taskRef: revised.taskRef } as CanonicalJsonObject,
              service,
              undefined,
              true,
            ),
            sessionFor(service),
          );
          expect(record(state).workOrderRefs).toHaveLength(3);
          expect(record(state).workOrderRefs).toContainEqual(
            objectRef(WORK_ORDER_V11, otherDraftChildId, scope()),
          );
        }
        const sourceId = newUuidV7(),
          epContext = {
            ...runnerContext(),
            authorizationPurposes: [
              'enterprise.project.register_source_material',
              'enterprise.project.accept_source_material',
            ],
          };
        const epEnv = (
          type: string,
          payload: CanonicalJsonObject,
          targetType: string,
          targetId: string,
          expectedAggregateVersion?: string,
        ) => ({
          commandId: newUuidV7(),
          commandType: type,
          commandVersion: '1.0',
          idempotencyScope: `wi231:${type}`,
          idempotencyKey: newUuidV7(),
          requestPayload: payload,
          payload,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType,
          targetId,
          expectedAggregateVersion,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN' as const,
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId: POLICY_SNAPSHOT_ID,
        });
        const descriptor = {
          originRef: {
            system: 'synthetic',
            resourceType: 'document',
            externalId: newUuidV7(),
            tenantOrAccountRef: objectRef('FeishuTenant', newUuidV7(), {
              enterpriseId: fixture.enterpriseId,
            }),
            observedAt: new Date(clock).toISOString(),
          },
          submittedBy: objectRef('Principal', OPERATOR, { enterpriseId: fixture.enterpriseId }),
          receivedAt: new Date(clock).toISOString(),
          originalName: 'recovery.pdf',
          mediaType: 'application/pdf',
          byteLength: 12,
          checksum: contentHash('a'.repeat(64)),
          stagedObjectRef: `staging/${sourceId}`,
          retentionClass: 'CUSTOMER_RECORD',
        };
        const registered = await handleRegisterSourceMaterial(
          enterpriseProjectDb,
          epContext,
          epEnv(
            'project.register_source_material',
            {
              projectRef: objectRef('Project', fixture.projectId, scope()),
              descriptor,
            } as unknown as CanonicalJsonObject,
            'SourceMaterial',
            sourceId,
          ) as unknown as Parameters<typeof handleRegisterSourceMaterial>[2],
        );
        recoverySource = {
          ...record(record(committedPayload(registered)).sourceMaterialRef),
          objectType: 'zhiju.project.source_material',
        } as unknown as Common.ContentAddressedRef;
        const refs: Common.ContentAddressedRef[] = [];
        const repo = new EnterpriseBusinessRepository();
        for (const validationKind of ['SECURITY', 'INTEGRITY'] as const) {
          const validationId = newUuidV7(),
            payload = {
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
              sourceMaterialId: recoverySource.objectId,
              validationKind,
              outcome: 'PASSED',
              validatedObjectRef: `accepted/${sourceId}`,
              validatedContentHash: 'a'.repeat(64),
              validatedByteLength: 12,
              validatorId: 'synthetic-validator',
              validatorVersion: '1.0',
            };
          const digest = digestCanonicalPayload(payload);
          await withEnterpriseProjectTransaction(enterpriseProjectDb, epContext, async (trx) => {
            await repo.insertSourceMaterialValidation(trx, {
              validationId,
              sourceMaterialId: definedValue(recoverySource).objectId,
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
              validationKind,
              outcome: 'PASSED',
              validatedObjectRef: `accepted/${sourceId}`,
              validatedContentHash: Buffer.from('a'.repeat(64), 'hex'),
              validatedByteLength: 12,
              validatorId: 'synthetic-validator',
              validatorVersion: '1.0',
              payload,
              payloadHash: digest.hash,
              recordedByPrincipalId: OPERATOR,
              recordedByActorSnapshotId: OPERATOR_ACTOR,
              authorizationDecisionId: REQUEST_DECISION,
              sourceCommandId: newUuidV7(),
            });
          });
          refs.push({
            kind: 'CONTENT_ADDRESSED',
            objectType: 'ValidationResult',
            objectId: validationId,
            scope: scope(),
            contentHash: contentHash(digest.hash.toString('hex')),
          });
        }
        expect(
          await handleAcceptSourceMaterial(
            enterpriseProjectDb,
            epContext,
            epEnv(
              'project.accept_source_material',
              {
                securityValidationRefs: [definedValue(refs[0])],
                integrityValidationRef: definedValue(refs[1]),
                acceptedObjectRef: `accepted/${sourceId}`,
                acceptedAt: new Date(clock).toISOString(),
              } as unknown as CanonicalJsonObject,
              'SourceMaterial',
              recoverySource.objectId,
              '1',
            ) as unknown as Parameters<typeof handleAcceptSourceMaterial>[2],
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        const evidence = { evidence: recoverySource, relation: 'SUPPORTS' },
          propose = await recoveryEnvelope(
            'customerMaterialProposeV1',
            objectRef('zhiju.project.customer_material', newUuidV7(), scope()) as Common.ObjectRef,
            {
              projectRef: objectRef('zhiju.project.project', fixture.projectId, scope()),
              proposal: {
                materialType: 'quality.procedure',
                title: 'Recovery input',
                language: 'zh-CN',
                completeness: 'PARTIAL',
                sourceSelections: [
                  { sourceMaterialRef: recoverySource, role: 'primary', locator: 'section.1' },
                ],
                classificationRationale: {
                  reasonCode: 'SOURCE_CLASSIFICATION',
                  summary: 'Classify accepted source.',
                  evidenceRefs: [evidence],
                },
              },
            } as unknown as CanonicalJsonObject,
            operator(),
          );
        const proposalValidation = registry.validateOperation(
          'project.propose_customer_material',
          '1.0',
          propose,
        );
        expect(proposalValidation.valid, JSON.stringify(proposalValidation.errors)).toBe(true);
        recoveryProposeEnvelope = propose;
        const proposed = await recoveryEntry.command(propose, sessionFor());
        expect(proposed).toMatchObject({ status: 'COMMITTED' });
        candidateMaterial = record(committedPayload(proposed))
          .customerMaterialRef as Common.VersionedRef;
      }
      let emitEarlyFinal = false;
      const runtimeJournal = new InMemoryRenderObjectStorage();
      const runtimeDriver = new LocalSyntheticRuntimeDriver(
        (input, ack) =>
          ({
            header: {
              contractId: newUuidV7(),
              contractType:
                terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'HEADER'
                  ? 'zhiju.contract.unexpected_result'
                  : 'zhiju.contract.agent_result',
              contractVersion: '1.0',
              schemaRef: {
                kind: 'VERSIONED',
                objectType: 'zhiju.contract.schema',
                objectId: '018f22e2-7c15-7b12-8d86-2de956a9d207',
                versionId: '018f22e2-7c15-7d42-8d86-2de956a9d22a',
                scope: { enterpriseId: fixture.enterpriseId },
              },
              scopeRef: scope(),
              issuedBy: { principalKind: 'SERVICE', principalId: serviceId },
              correlationId: CORRELATION,
              dataClassification: 'INTERNAL',
              canonicalizationVersion: '1',
            },
            agentResultId: newUuidV7(),
            runRef: input.request.runRef as unknown as CanonicalJsonObject,
            workOrderRef: input.request.workOrderRef as unknown as CanonicalJsonObject,
            taskRef: revised.taskRef as CanonicalJsonObject,
            projectRef: revised.projectRef as CanonicalJsonObject,
            submissionKind: terminalScenario === 'NON_FINAL_CORE_REJECT' ? 'INTERIM' : 'FINAL',
            executionOutcome:
              bounded &&
              (input.request.runRef.objectId === runRef.objectId ||
                input.request.workOrderRef.objectId === otherChildId)
                ? 'BLOCKED_INPUT'
                : bounded && recoveryVariant === 'SECOND_BLOCKED'
                  ? 'BLOCKED_INPUT'
                  : bounded && recoveryVariant === 'SECOND_PARTIAL'
                    ? 'PARTIAL'
                    : bounded && recoveryVariant === 'SECOND_FAILED'
                      ? 'FAILED_EXECUTION'
                      : terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'OUTCOME'
                        ? 'PARTIAL'
                        : 'COMPLETED',
            businessOutputs:
              terminalScenario === 'UNSUPPORTED_FINAL' &&
              (negativeFinalCase === 'BUSINESS_OUTPUT' || negativeFinalCase === 'ARTIFACT_ALIAS')
                ? [businessOutput(input.request.runRef)]
                : [],
            workspaceOutputs:
              terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'WORKSPACE_OUTPUT'
                ? [example('workspaceOutputs')]
                : [],
            findings:
              terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'FINDING'
                ? [example('findings')]
                : [],
            knowledgeProposals:
              terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'KNOWLEDGE_PROPOSAL'
                ? [example('knowledgeProposals')]
                : [],
            inputRequestProposals:
              bounded &&
              (input.request.runRef.objectId === runRef.objectId ||
                input.request.workOrderRef.objectId === otherChildId)
                ? [
                    {
                      proposalId,
                      requestType: 'execution.input.customer_material_confirmation',
                      question: 'Confirm this customer material.',
                      reason: 'A Human must confirm the candidate.',
                      expectedAnswerSpec: {
                        profile: 'execution.answer.customer_material.v1',
                        candidateMaterialRef: candidateMaterial,
                        requiredSourceRefs: [recoverySource],
                      },
                      blocking: true,
                      requestedResponderRole: 'project.customer_material.confirmer',
                      targetRefs: [input.request.workOrderRef, revised.taskRef].sort((a, b) =>
                        Buffer.compare(
                          Buffer.from(canonicalize(a as CanonicalJsonObject)),
                          Buffer.from(canonicalize(b as CanonicalJsonObject)),
                        ),
                      ),
                    },
                  ]
                : terminalScenario === 'UNSUPPORTED_FINAL' &&
                    negativeFinalCase === 'INPUT_REQUEST_PROPOSAL'
                  ? [example('inputRequestProposals')]
                  : [],
            followUpProposals:
              terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'FOLLOW_UP_PROPOSAL'
                ? [example('followUpProposals')]
                : [],
            ...(positiveFinalScenario
              ? { agentDeclaredUsage: { measurementSource: 'AGENT_DECLARED', inputTokens: 17 } }
              : {}),
            ...(terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'RUNTIME_USAGE'
              ? { runtimeUsageRef: read.contractRef }
              : {}),
            ...(terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'CONTINUATION'
              ? {
                  continuationProposal: {
                    proposalId: newUuidV7(),
                    summary: 'Continue after this Run.',
                    suggestedContextRevision: false,
                  },
                }
              : {}),
            provenance: {
              contextSnapshotRef: input.request.contextSnapshotRef,
              workOrderContractRef: input.request.workOrderContractRef,
              capabilityGrantRef: input.request.capabilityGrantRef,
              runtimeAdapterRef: record(revised.versionPins).runtimeAdapterContractRef,
              harness: { harnessId: 'zhiju.runtime.synthetic', harnessVersion: '1.0' },
              provider: 'synthetic',
              model: {
                modelId:
                  terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'PROVENANCE'
                    ? 'synthetic.other'
                    : 'synthetic',
                modelConfigHash: record(input.request.runtimeBinding).modelConfigHash,
              },
              skillRefs: [],
              policyRefs: [],
              templateRefs: [],
              runtimeSessionExternalRef:
                terminalScenario === 'IG_WRONG_SESSION' ||
                (recoveryVariant === 'SECOND_WRONG_SESSION' &&
                  input.request.runRef.objectId !== runRef.objectId)
                  ? { ...ack.runtimeSessionRef, externalId: newUuidV7() }
                  : ack.runtimeSessionRef,
            },
            humanSummary: 'Controlled synthetic execution completed.',
          }) as unknown as CanonicalJsonObject,
        runtimeJournal,
        () => new Date(clock - (emitEarlyFinal ? 1_000 : 0)),
      );
      if (
        terminalScenario === 'TIMED_OUT' ||
        terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
        terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
        terminalScenario === 'NON_FINAL_CORE_REJECT'
      )
        runtimeDriver.releaseFinal = () => Promise.resolve();
      const firstRunConfig = {
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
        runtimeDriver,
        receiptStorage: runtimeJournal,
        capabilityCodes: firstRunCodes,
        ...(bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: recoveryCodes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      } satisfies Parameters<typeof createControlledFirstRunEntry>[0];
      const firstRunEntryRaw = createControlledFirstRunEntry(firstRunConfig);
      const firstRunEntry = observeEntry(withRecoveryReceiptFaults(firstRunEntryRaw, true));
      async function firstRunEnvelope(
        commandType: string,
        targetRef: Common.ObjectRef,
        payload: CanonicalJsonObject,
        principal: Principal,
        expectedAggregateVersion?: number,
      ) {
        // Creation's exact deadline and start's exact timestamp were prepared at
        // this trusted instant. Later final commands consume the current clock.
        if (commandType !== 'execution.create_run' && commandType !== 'execution.start_run')
          clock = Math.max(clock, Date.now());
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
                'agentResultSubmitV1',
                'runResultRecordV1',
                'agentResultValidateV1',
                'agentResultAcceptV1',
                'runFinalizeV1',
                'runExpireV1',
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
      if (exercisePreparationMatrix) {
        phase('queue revocation probe');
        const deniedQueueEntry = createControlledFirstRunEntry({
          taskExecutionDb: guardedTeDb,
          enterpriseProjectDb,
          identity: { db: identityDb, repo: identityRepo, crypto },
          integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
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
        await admin.query(`
        CREATE OR REPLACE FUNCTION task_execution.wi221_pause_queue() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(221); RETURN NEW; END $$`);
        await admin.query(`
        CREATE TRIGGER wi221_pause_queue BEFORE UPDATE ON task_execution.work_order
        FOR EACH ROW WHEN (NEW.work_order_id = '${workOrderRef.objectId}'::uuid AND NEW.status = 'QUEUED')
        EXECUTE FUNCTION task_execution.wi221_pause_queue()`);
        const queueBlocker = new pg.Client({ connectionString: databaseUrl });
        let queuedAttempt: Promise<unknown> | undefined;
        try {
          await queueBlocker.connect();
          const blockerPid = (
            await queueBlocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
          ).rows[0]?.pid;
          if (blockerPid === undefined) throw new Error('missing queue blocker backend');
          await queueBlocker.query('SELECT pg_advisory_lock(221)');
          queuedAttempt = track(firstRunEntry.queue(queueEnvelope, sessionFor())).then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          let paused = false;
          for (let poll = 0; poll < 200 && !paused; poll += 1) {
            const activity = await admin.query<{ paused: boolean }>(
              `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE pid <> pg_backend_pid() AND wait_event_type='Lock'
                 AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS paused`,
              [blockerPid],
            );
            paused = activity.rows[0]?.paused === true;
            if (!paused) await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(paused).toBe(true);
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: grantResolve,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI221_REVOKE_POLICY_READ_AFTER_MINT',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          await queueBlocker.query('SELECT pg_advisory_unlock(221)');
          expect(await queuedAttempt).toMatchObject({
            error: { code: 'AUTHORIZATION_REVOKED' },
          });
        } finally {
          // Release before draining, including assertion/timeout failures.
          try {
            await queueBlocker.end();
          } finally {
            await queuedAttempt;
            await admin.query(
              'DROP TRIGGER IF EXISTS wi221_pause_queue ON task_execution.work_order',
            );
            await admin.query('DROP FUNCTION IF EXISTS task_execution.wi221_pause_queue()');
            // Restore the shared dependency even when a probe assertion fails.
            grantResolve = await grantGeneric(dependencyCapabilities.resolvePolicy);
          }
        }
        expect(await receiptRows(queueEnvelope.idempotencyKey)).toEqual([]);
      }
      phase('queue and Run creation');
      const queued = await firstRunEntry.queue(queueEnvelope, sessionFor());
      expect(queued, JSON.stringify(queued)).toMatchObject({ status: 'COMMITTED' });
      expect(await firstRunEntry.queue(queueEnvelope, sessionFor())).toMatchObject({
        status: 'DUPLICATE',
      });
      if (terminalScenario !== 'SUCCEEDED') clock = Date.now();
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
      phase('Bundle issue');
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
      // The eligibility case's unchanged Run budget begins at Run preparation,
      // after the independently committed Bundle has finished being prepared.
      if (
        terminalScenario === 'ELIGIBILITY_CHANGE' ||
        ['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant)
      )
        clock = Date.now();
      const runDeadline = new Date(
        Math.min(
          bundleValidUntil.getTime(),
          ...(['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant)
            ? [clock + 30_000]
            : []),
          clock +
            (terminalScenario === 'LEGACY_UPGRADE'
              ? 120_000
              : terminalScenario === 'ELIGIBILITY_CHANGE' ||
                  terminalScenario === 'TIMED_OUT' ||
                  terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
                  terminalScenario === 'IG_WRONG_SESSION' ||
                  terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
                  terminalScenario === 'UNSUPPORTED_FINAL' ||
                  terminalScenario === 'NON_FINAL_CORE_REJECT'
                ? eligibilityChange?.whileLocked === true
                  ? 30_000
                  : 10_000
                : terminalScenario === 'RECOVERY_EXPIRE'
                  ? 30_000
                  : terminalScenario === 'VALIDATION_EXPIRED'
                    ? 30_000
                    : terminalScenario === 'RACE' || terminalScenario === 'LOCK_DEADLINE'
                      ? 30_000
                      : 600_000),
        ),
      );
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
            executionDeadline: runDeadline.toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      phase('Run creation');
      progress('Run deadline', `remainingMs=${runDeadline.getTime() - Date.now()}`);
      const created = await firstRunEntry
        .createRun(createEnvelope, sessionFor(service))
        .catch((error: unknown) => {
          if (bounded) process.stdout.write(JSON.stringify(error) + '\n');
          throw error;
        });
      expect(created, JSON.stringify(created)).toMatchObject({ status: 'COMMITTED' });
      expect(await firstRunEntry.createRun(createEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      const createdData = record(committedPayload(created as unknown as CommandResult));
      async function firstRunQuery(
        queryType: string,
        targetRef: Common.ObjectRef | Common.ContentAddressedRef,
        payload: CanonicalJsonObject,
        key:
          | 'runtimeAttemptBindingReadV1'
          | 'runtimeFinalReadV1'
          | 'agentResultReadV1'
          | 'runStateReadV1',
      ) {
        clock = Math.max(clock, Date.now());
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
      if (exercisePreparationMatrix) {
        const uninvokedBinding = await firstRunQuery(
          'integration.get_runtime_attempt_binding',
          attemptRef,
          { attemptRef } as unknown as CanonicalJsonObject,
          'runtimeAttemptBindingReadV1',
        );
        const uninvokedFinal = await firstRunQuery(
          'integration.get_runtime_final_observation',
          attemptRef,
          { attemptRef } as unknown as CanonicalJsonObject,
          'runtimeFinalReadV1',
        );
        await expect(
          firstRunEntry.getRuntimeAttemptBinding(uninvokedBinding, sessionFor(service)),
        ).rejects.toBeDefined();
        await expect(
          firstRunEntry.getRuntimeFinalObservation(uninvokedFinal, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(runtimeDriver.invokedAttemptIds).toEqual([]);
      }
      if (exercisePreparationMatrix) {
        for (const invalidAck of ['INSTANCE_ID', 'BINDING_HASH'] as const) {
          const invalidAttemptRef = objectRef(
            'integration.runtime_attempt',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          const invalidJournal = new InMemoryRenderObjectStorage();
          const invokedDriver = new LocalSyntheticRuntimeDriver(undefined, invalidJournal);
          const invalidEntry = createControlledFirstRunEntry({
            taskExecutionDb: guardedTeDb,
            enterpriseProjectDb,
            identity: { db: identityDb, repo: identityRepo, crypto },
            integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
            runtimeDriver: {
              invoke: async (input) => {
                const ack = await invokedDriver.invoke(input);
                return invalidAck === 'INSTANCE_ID'
                  ? {
                      ...ack,
                      runtimeAdapterIdentityRef: {
                        ...ack.runtimeAdapterIdentityRef,
                        objectId: newUuidV7(),
                      },
                    }
                  : { ...ack, bindingHash: contentHash('0'.repeat(64)) };
              },
              readBack: (ref) => invokedDriver.readBack(ref),
              readFinal: (ref) => invokedDriver.readFinal(ref),
            },
            receiptStorage: invalidJournal,
            capabilityCodes: firstRunCodes,
            ...(bounded
              ? {
                  recovery: {
                    recoveryCapabilityCodes: recoveryCodes,
                    humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                  },
                }
              : {}),
            capabilities: dependencyCapabilities,
            now: () => new Date(clock),
          });
          const invalidDispatch = await firstRunEnvelope(
            'integration.request_runtime_dispatch',
            invalidAttemptRef,
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
          await expect(
            invalidEntry.dispatch(invalidDispatch, sessionFor(service)),
          ).rejects.toBeDefined();
          const invalidBinding = await firstRunEntry.getRuntimeAttemptBinding(
            await firstRunQuery(
              'integration.get_runtime_attempt_binding',
              invalidAttemptRef,
              { attemptRef: invalidAttemptRef } as unknown as CanonicalJsonObject,
              'runtimeAttemptBindingReadV1',
            ),
            sessionFor(service),
          );
          expect(invalidBinding.status).toBe('CREATED');
          expect(invalidBinding.acknowledgement).toBeUndefined();
          await expect(
            firstRunEntry.getRuntimeFinalObservation(
              await firstRunQuery(
                'integration.get_runtime_final_observation',
                invalidAttemptRef,
                { attemptRef: invalidAttemptRef } as unknown as CanonicalJsonObject,
                'runtimeFinalReadV1',
              ),
              sessionFor(service),
            ),
          ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
          expect(invokedDriver.invokedAttemptIds).toEqual([invalidAttemptRef.objectId]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([]);
        }
        const wrongProfileAttempt = objectRef(
          'integration.runtime_attempt',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        const wrongProfileDispatch = await firstRunEnvelope(
          'integration.request_runtime_dispatch',
          wrongProfileAttempt,
          {
            request: {
              workOrderRef,
              runRef,
              workOrderContractRef: read.contractRef,
              contextSnapshotRef: contextRef,
              capabilityGrantRef: bundleRef,
              runtimeBinding: { ...runtimeBinding, adapterCode: 'te.human_operated.other' },
              stableIdempotencyKey: newUuidV7(),
              requestedAt: new Date(clock).toISOString(),
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.dispatch(wrongProfileDispatch, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(runtimeDriver.invokedAttemptIds).toEqual([]);
      }
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
      if (terminalScenario === 'SUCCEEDED') {
        const mutations: readonly (readonly [string, string])[] = [
          ['valid source', ''],
          ['preallocated ID', `NEW.instance_id:='${newUuidV7()}'::uuid;`],
          ['Attempt FK', `NEW.attempt_id:='${newUuidV7()}'::uuid;`],
          ['ack FK', `NEW.ack_observation_id:='${newUuidV7()}'::uuid;`],
          ['Enterprise Scope', `NEW.enterprise_id:='${newUuidV7()}'::uuid;`],
          ['Project Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
          ['binding Hash', "NEW.binding_hash:=decode(repeat('0',64),'hex');"],
          ['identity Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"],
          ['source Receipt', `NEW.source_command_id:='${createEnvelope.commandId}'::uuid;`],
          ['adapter code', "NEW.adapter_code:='te.human_operated.other';"],
          ['adapter version', "NEW.adapter_version:='2.0';"],
          ['ack source', "NEW.source:='CALLER';"],
          ...(['instanceId', 'attemptId', 'ackObservationId', 'bindingHash'] as const).map(
            (field) =>
              [
                `canonical ${field}`,
                `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'{${field}}',to_jsonb('${field === 'bindingHash' ? '0'.repeat(64) : newUuidV7()}'::text));
             NEW.payload_hash:=sha256(convert_to(integration_gateway.canonical_jsonb_text(NEW.canonical_payload),'UTF8'));`,
              ] as const,
          ),
        ];
        const outcomes: { label: string; code: string }[] = [];
        for (const [label, statement] of mutations) {
          const probeAttempt = objectRef(
            'integration.runtime_attempt',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          const storage = new InMemoryRenderObjectStorage();
          const driver = new LocalSyntheticRuntimeDriver(undefined, storage, () => new Date(clock));
          const entry = createControlledFirstRunEntry({
            taskExecutionDb: guardedTeDb,
            enterpriseProjectDb,
            identity: { db: identityDb, repo: identityRepo, crypto },
            integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
            runtimeDriver: driver,
            receiptStorage: storage,
            capabilityCodes: firstRunCodes,
            ...(bounded
              ? {
                  recovery: {
                    recoveryCapabilityCodes: recoveryCodes,
                    humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                  },
                }
              : {}),
            capabilities: dependencyCapabilities,
            now: () => new Date(clock),
          });
          const probeEnvelope = await firstRunEnvelope(
            'integration.request_runtime_dispatch',
            probeAttempt,
            {
              request: {
                ...record(dispatchEnvelope.payload.request),
                stableIdempotencyKey: newUuidV7(),
              },
            },
            service,
          );
          const condition = `NEW.attempt_id='${probeAttempt.objectId}'::uuid`;
          await admin.query(`CREATE FUNCTION integration_gateway.wi224_identity_sql_change() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
          await admin.query(`CREATE FUNCTION integration_gateway.wi224_identity_sql_end() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_IDENTITY_SQL_ACCEPTED'; END $f$`);
          await admin.query(`CREATE TRIGGER aa_wi224_identity_sql BEFORE INSERT ON integration_gateway.runtime_adapter_identity
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION integration_gateway.wi224_identity_sql_change()`);
          await admin.query(`CREATE TRIGGER zz_wi224_identity_sql AFTER INSERT ON integration_gateway.runtime_adapter_identity
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION integration_gateway.wi224_identity_sql_end()`);
          try {
            await entry.dispatch(probeEnvelope, sessionFor(service));
            outcomes.push({ label, code: 'UNEXPECTED_SUCCESS' });
          } catch (error) {
            outcomes.push({
              label,
              code:
                error instanceof Error && error.message.includes('WI224_IDENTITY_SQL_ACCEPTED')
                  ? 'ACCEPTED'
                  : error !== null && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : 'UNKNOWN',
            });
          } finally {
            await admin.query(
              'DROP TRIGGER aa_wi224_identity_sql ON integration_gateway.runtime_adapter_identity',
            );
            await admin.query(
              'DROP TRIGGER zz_wi224_identity_sql ON integration_gateway.runtime_adapter_identity',
            );
            await admin.query('DROP FUNCTION integration_gateway.wi224_identity_sql_change()');
            await admin.query('DROP FUNCTION integration_gateway.wi224_identity_sql_end()');
          }
          expect(driver.invokedAttemptIds, label).toEqual([probeAttempt.objectId]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM integration_gateway.runtime_attempt WHERE attempt_id=$1',
                [probeAttempt.objectId],
              )
            ).rows,
            label,
          ).toEqual([{ status: 'CREATED' }]);
          for (const table of [
            'runtime_adapter_identity',
            'runtime_attempt_observation',
            'runtime_final_observation',
          ])
            expect(
              (
                await admin.query<{ count: string }>(
                  `SELECT count(*)::text FROM integration_gateway.${table} WHERE attempt_id=$1`,
                  [probeAttempt.objectId],
                )
              ).rows,
              `${label} ${table}`,
            ).toEqual([{ count: '0' }]);
          expect(
            (
              await admin.query<{ count: string }>(
                'SELECT count(*)::text FROM integration_gateway.raw_external_receipt WHERE runtime_attempt_id=$1',
                [probeAttempt.objectId],
              )
            ).rows,
            `${label} raw receipt rollback`,
          ).toEqual([{ count: '0' }]);
          if (label === 'valid source') {
            const originalAck = await driver.readBack(probeAttempt);
            if (originalAck === undefined) throw new Error('missing original rolled-back ack');
            const recovered = await Promise.all([
              entry.dispatch(probeEnvelope, sessionFor(service)),
              entry.dispatch(probeEnvelope, sessionFor(service)),
            ]);
            expect(recovered[0]).toMatchObject({ status: 'SUCCEEDED' });
            expect(recovered[1]).toEqual(recovered[0]);
            expect(driver.invokedAttemptIds).toEqual([probeAttempt.objectId]);
            expect(
              (
                await admin.query<{ instance_id: string }>(
                  'SELECT instance_id FROM integration_gateway.runtime_adapter_identity WHERE attempt_id=$1',
                  [probeAttempt.objectId],
                )
              ).rows,
            ).toEqual([{ instance_id: originalAck.runtimeAdapterIdentityRef.objectId }]);
            for (const table of ['runtime_attempt_observation', 'raw_external_receipt']) {
              const field = table === 'raw_external_receipt' ? 'runtime_attempt_id' : 'attempt_id';
              expect(
                (
                  await admin.query<{ count: string }>(
                    `SELECT count(*)::text FROM integration_gateway.${table} WHERE ${field}=$1`,
                    [probeAttempt.objectId],
                  )
                ).rows,
              ).toEqual([{ count: '1' }]);
            }
            expect(
              (
                await admin.query<{ count: string }>(
                  "SELECT count(*)::text FROM integration_gateway.outbox_event WHERE aggregate_id=$1 AND event_type='integration.RuntimeDispatchSucceeded'",
                  [probeAttempt.objectId],
                )
              ).rows,
            ).toEqual([{ count: '1' }]);
          }
        }
        expect(outcomes[0]).toEqual({ label: 'valid source', code: 'ACCEPTED' });
        for (const outcome of outcomes.slice(1))
          expect
            .soft(['22023', '23514', '23503', '42501'], `${outcome.label}: ${outcome.code}`)
            .toContain(outcome.code);
      }

      phase('runtime dispatch and start');
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
      if (exercisePreparationMatrix) {
        const replayedDispatch = await firstRunEntry.dispatch(
          dispatchEnvelope,
          sessionFor(service),
        );
        expect(replayedDispatch).toEqual(dispatched);
      }
      expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
      if (terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'TIME')
        emitEarlyFinal = true;
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
      if (exercisePreparationMatrix) {
        const unacknowledgedAttempt = objectRef(
          'integration.runtime_attempt',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        const unacknowledgedStart = await firstRunEnvelope(
          'execution.start_run',
          runRef,
          {
            ...startEnvelope.payload,
            runtimeAttemptRef: unacknowledgedAttempt,
          } as unknown as CanonicalJsonObject,
          service,
          1,
        );
        await expect(
          firstRunEntry.startRun(unacknowledgedStart, startSession),
        ).rejects.toBeDefined();
        expect(await receiptRows(unacknowledgedStart.idempotencyKey)).toEqual([]);
        for (const key of ['runStartAttemptReadV1', 'runStartAdapterIdentityReadV1'] as const) {
          const dependencyGrantId = firstRunGrants.get(key);
          const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
            (candidate) => candidate.boundary === key,
          );
          if (dependencyGrantId === undefined || binding === undefined)
            throw new Error(`missing independent ${key} Grant`);
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: dependencyGrantId,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI224_REVOKE_START_DEPENDENCY',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          queryReads.length = 0;
          await expect(firstRunEntry.startRun(startEnvelope, startSession)).rejects.toMatchObject({
            code: 'AUTHORIZATION_REVOKED',
          });
          const table =
            key === 'runStartAttemptReadV1' ? 'runtime_attempt' : 'runtime_adapter_identity';
          expect(
            queryReads.filter((query) =>
              query.includes(`"kind":"IdentifierNode","name":"${table}"`),
            ),
            key,
          ).toEqual([]);
          expect(await receiptRows(startEnvelope.idempotencyKey)).toEqual([]);
          await grant({
            principal: service,
            capabilityCode: firstRunCodes[key],
            action: binding.requiredGrantAction,
            selectorType: binding.selectorType,
            targetObjectType: 'integration.runtime_attempt',
          });
        }
      }
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
      phase('final boundary and recovery body');
      if (terminalScenario === 'LEGACY_UPGRADE') {
        phase('historical Run backup/upgrade');
        let upgradeFailure: unknown;
        try {
          for (const binding of BLOCKED_INPUT_RECOVERY_BINDINGS)
            for (const principal of binding.expectedPrincipalKind === 'HUMAN'
              ? [operator()]
              : binding.expectedPrincipalKind === 'SERVICE'
                ? [service]
                : [operator(), service])
              await grant({
                principal,
                capabilityCode: definedValue(recoveryCodes[binding.capabilityConfigKey]),
                action: binding.requiredGrantAction,
                selectorType: binding.selectorType,
                targetObjectType: definedValue(binding.targetObjectTypes[0]),
                targetObjectTypes: binding.targetObjectTypes,
              });
          const legacyRetry = await recoveryEnvelope(
            'workOrderRetryScheduleV1',
            workOrderRef,
            {
              previousRunRef: runRef,
              nextAttemptNumber: 2,
              retryReason: 'BLOCKED_INPUT_RESOLVED',
              retryPolicyRef: controlsRef,
            } as unknown as CanonicalJsonObject,
            operator(),
            4,
          );
          await expect(recoveryEntryRaw.command(legacyRetry, sessionFor())).rejects.toMatchObject({
            code: 'EXECUTION_CRITERION_UNSUPPORTED',
          });
          expect(await receiptRows(String(legacyRetry.idempotencyKey))).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
                [woId],
              )
            ).rows,
          ).toEqual([]);
          // Restore actual one-attempt facts from both deployed baselines before adding recovery storage.
          for (const version of ['3010', '7004'] as const)
            await verifyControlledFinalUpgrade(admin, {
              schema: 'task_execution',
              version,
              enterpriseId: fixture.enterpriseId,
              requiredTables: [
                'task',
                'work_order',
                'work_order_contract',
                'context_snapshot',
                'run',
                'work_order_run_claim',
                'command_receipt',
              ],
              afterMigrate: async (legacyAdmin, connectionUri) => {
                await legacyAdmin.query(
                  "CREATE ROLE wi231_upgrade_probe LOGIN PASSWORD 'wi231-upgrade-probe' NOSUPERUSER NOBYPASSRLS",
                );
                await legacyAdmin.query(
                  'GRANT platform_context_establisher, task_execution_app TO wi231_upgrade_probe',
                );
                const url = new URL(connectionUri);
                url.username = 'wi231_upgrade_probe';
                url.password = 'wi231-upgrade-probe';
                const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
                try {
                  const restored = createControlledFirstRunEntry({
                    ...firstRunConfig,
                    taskExecutionDb: createTaskExecutionDatabase(pool),
                  });
                  expect(
                    await restored.getRunState(
                      await firstRunQuery(
                        'execution.get_run_state',
                        runRef,
                        { runRef } as unknown as CanonicalJsonObject,
                        'runStateReadV1',
                      ),
                      sessionFor(service),
                    ),
                  ).toMatchObject({
                    status: 'RUNNING',
                    aggregateVersion: 2,
                    contextSnapshotRef: contextRef,
                  });
                } finally {
                  await pool.end();
                }
              },
            });
          await verifyControlledFinalUpgrade(admin, {
            schema: 'integration_gateway',
            version: '7004',
            enterpriseId: fixture.enterpriseId,
            requiredTables: [
              'runtime_attempt',
              'runtime_adapter_identity',
              'runtime_attempt_observation',
              'raw_external_receipt',
              'command_receipt',
            ],
            afterMigrate: async (legacyAdmin, connectionUri) => {
              await legacyAdmin.query(
                "CREATE ROLE wi231_upgrade_ig LOGIN PASSWORD 'wi231-upgrade-ig' NOSUPERUSER NOBYPASSRLS",
              );
              await legacyAdmin.query(
                'GRANT platform_context_establisher, integration_gateway_app TO wi231_upgrade_ig',
              );
              const url = new URL(connectionUri);
              url.username = 'wi231_upgrade_ig';
              url.password = 'wi231-upgrade-ig';
              const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
              try {
                const restored = createControlledFirstRunEntry({
                  ...firstRunConfig,
                  integrationGatewayDb: createIntegrationRendererDatabase(pool),
                });
                expect(
                  await restored.getRuntimeAttemptBinding(
                    await firstRunQuery(
                      'integration.get_runtime_attempt_binding',
                      attemptRef,
                      { attemptRef } as unknown as CanonicalJsonObject,
                      'runtimeAttemptBindingReadV1',
                    ),
                    sessionFor(service),
                  ),
                ).toEqual(dispatched);
              } finally {
                await pool.end();
              }
            },
          });

          await verifyControlledFinalUpgrade(admin, {
            schema: 'task_execution',
            version: '3006',
            enterpriseId: fixture.enterpriseId,
            requiredTables: [
              'execution_judgment',
              'work_order_draft_snapshot',
              'context_snapshot',
              'work_order_contract',
              'run',
              'work_order_run_claim',
            ],
            afterMigrate: async (legacyAdmin, connectionUri) => {
              await legacyAdmin.query(
                "CREATE ROLE wi224_legacy_probe LOGIN PASSWORD 'wi224-legacy-probe' NOSUPERUSER NOBYPASSRLS",
              );
              await legacyAdmin.query(
                'GRANT platform_context_establisher, task_execution_app TO wi224_legacy_probe',
              );
              const url = new URL(connectionUri);
              url.username = 'wi224_legacy_probe';
              url.password = 'wi224-legacy-probe';
              const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
              const previousClock = clock;
              try {
                const legacyDb = createTaskExecutionDatabase(pool);
                const legacyEntry = createControlledFirstRunEntry({
                  taskExecutionDb: legacyDb,
                  enterpriseProjectDb,
                  identity: { db: identityDb, repo: identityRepo, crypto },
                  integrationGatewayDb:
                    createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
                  runtimeDriver,
                  receiptStorage: runtimeJournal,
                  capabilityCodes: firstRunCodes,
                  ...(bounded
                    ? {
                        recovery: {
                          recoveryCapabilityCodes: recoveryCodes,
                          humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                        },
                      }
                    : {}),
                  capabilities: dependencyCapabilities,
                  now: () => new Date(clock),
                });
                const query = await firstRunQuery(
                  'execution.get_run_state',
                  runRef,
                  { runRef } as unknown as CanonicalJsonObject,
                  'runStateReadV1',
                );
                expect(await legacyEntry.getRunState(query, sessionFor(service))).toMatchObject({
                  status: 'RUNNING',
                  aggregateVersion: 2,
                });
                const actual = await runtimeDriver.readFinal(attemptRef);
                if (actual === undefined)
                  throw new Error('missing current Driver source for legacy refusal');
                const body = actual.agentResultContract;
                if (typeof body.agentResultId !== 'string')
                  throw new Error('missing actual Result ID');
                const attemptSubmit = await firstRunEnvelope(
                  'execution.submit_agent_result',
                  objectRef(
                    'execution.agent_result',
                    body.agentResultId,
                    scope(),
                  ) as Common.ObjectRef,
                  {
                    agentResultContract: body,
                    runFencingToken: 1,
                    runtimeSubmissionRef: actual.runtimeSubmissionRef,
                  } as unknown as CanonicalJsonObject,
                  service,
                );
                await expect(
                  legacyEntry.submitAgentResult(attemptSubmit, sessionFor(service)),
                ).rejects.toMatchObject({ code: 'REFERENCE_INVALID' });
                expect(
                  (
                    await legacyAdmin.query<{ count: string }>(
                      'SELECT count(*)::text FROM task_execution.agent_result',
                    )
                  ).rows,
                ).toEqual([{ count: '0' }]);
                const wait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
                if (wait > 0) await waitForDeadline(wait, 'server deadline/wait');
                clock = Date.now();
                expect(
                  (
                    await legacyAdmin.query<{ expired: boolean }>(
                      'SELECT clock_timestamp() >= execution_deadline AS expired FROM task_execution.run WHERE run_id=$1',
                      [runRef.objectId],
                    )
                  ).rows,
                ).toEqual([{ expired: true }]);
                const expire = await firstRunEnvelope(
                  'execution.expire_run',
                  runRef,
                  { reason: 'DEADLINE_EXCEEDED' },
                  service,
                  2,
                );
                expect(await legacyEntry.expireRun(expire, sessionFor(service))).toMatchObject({
                  status: 'COMMITTED',
                });
                expect(
                  (
                    await legacyAdmin.query<{ status: string; identity: unknown }>(
                      'SELECT status,runtime_adapter_identity_ref AS identity FROM task_execution.run WHERE run_id=$1',
                      [runRef.objectId],
                    )
                  ).rows,
                ).toEqual([{ status: 'TIMED_OUT', identity: null }]);
                expect(
                  (
                    await legacyAdmin.query<{ status: string }>(
                      'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                      [runRef.objectId],
                    )
                  ).rows,
                ).toEqual([{ status: 'EXPIRED' }]);
              } finally {
                clock = previousClock;
                await pool.end();
              }
            },
          });
          await verifyControlledFinalUpgrade(admin, {
            schema: 'integration_gateway',
            version: '7002',
            enterpriseId: fixture.enterpriseId,
            requiredTables: [
              'runtime_attempt',
              'runtime_attempt_observation',
              'raw_external_receipt',
              'command_receipt',
            ],
            afterMigrate: async (legacyAdmin, connectionUri) => {
              await legacyAdmin.query(
                "CREATE ROLE wi224_legacy_ig LOGIN PASSWORD 'wi224-legacy-ig' NOSUPERUSER NOBYPASSRLS",
              );
              await legacyAdmin.query(
                'GRANT platform_context_establisher, integration_gateway_app TO wi224_legacy_ig',
              );
              const url = new URL(connectionUri);
              url.username = 'wi224_legacy_ig';
              url.password = 'wi224-legacy-ig';
              const pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
              try {
                const legacyEntry = createControlledFirstRunEntry({
                  taskExecutionDb: guardedTeDb,
                  enterpriseProjectDb,
                  identity: { db: identityDb, repo: identityRepo, crypto },
                  integrationGatewayDb: createIntegrationRendererDatabase(pool),
                  runtimeDriver,
                  receiptStorage: runtimeJournal,
                  capabilityCodes: firstRunCodes,
                  ...(bounded
                    ? {
                        recovery: {
                          recoveryCapabilityCodes: recoveryCodes,
                          humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                        },
                      }
                    : {}),
                  capabilities: dependencyCapabilities,
                  now: () => new Date(clock),
                });
                expect(
                  await legacyEntry.getRuntimeAttemptBinding(
                    await firstRunQuery(
                      'integration.get_runtime_attempt_binding',
                      attemptRef,
                      { attemptRef } as unknown as CanonicalJsonObject,
                      'runtimeAttemptBindingReadV1',
                    ),
                    sessionFor(service),
                  ),
                ).toEqual(dispatched);
                await expect(
                  legacyEntry.getRuntimeFinalObservation(
                    await firstRunQuery(
                      'integration.get_runtime_final_observation',
                      attemptRef,
                      { attemptRef } as unknown as CanonicalJsonObject,
                      'runtimeFinalReadV1',
                    ),
                    sessionFor(service),
                  ),
                ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
              } finally {
                await pool.end();
              }
            },
          });
        } catch (error) {
          upgradeFailure = error;
        }
        // Always close this source through the owning expiry path, including a
        // failed backup assertion, so it cannot poison later project scans.
        const cleanupWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (cleanupWait > 0) await waitForDeadline(cleanupWait, 'server deadline/cleanupWait');
        clock = Date.now();
        const expireSource = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          2,
        );
        expect(await firstRunEntry.expireRun(expireSource, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
        if (upgradeFailure !== undefined)
          throw upgradeFailure instanceof Error
            ? upgradeFailure
            : new Error('historical upgrade failed', { cause: upgradeFailure });
        return;
      }
      const scanTarget = objectRef(
        'zhiju.project.project',
        fixture.projectId,
        scope(),
      ) as Common.ObjectRef;
      const scanPayloadHash = digestCanonicalPayload({
        projectRef: scanTarget as unknown as CanonicalJsonObject,
      }).hash;
      const scanDecision = await firstRunAuth.authorize(
        identityDeps([fixture.projectId], service),
        'runFinalCandidateScanV1',
        {
          actorSnapshotRef: service.actorRef,
          commandType: 'execution.submit_agent_result',
          commandVersion: '1.0',
          commandPayloadHash: scanPayloadHash,
          authenticationContextHash: AUTH_HASH,
          targetRef: scanTarget,
        },
      );
      expect(scanDecision.outcome).toBe('ALLOW');
      if (scanDecision.outcome !== 'ALLOW') throw new Error('final scan denied');
      const scanProof = async () => {
        const validity = await firstRunAuth.revalidate(
          identityDeps([fixture.projectId], service),
          'runFinalCandidateScanV1',
          {
            decisionRef: scanDecision.authorizationDecisionRef,
            expectedCommandType: 'execution.submit_agent_result',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: scanPayloadHash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: scanTarget,
          },
        );
        expect(validity.valid).toBe(true);
      };
      const scanContext = {
        ...runnerContext(service),
        authorizationDecisionId: scanDecision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          scanDecision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(scanDecision.expiresAt),
      };
      const progressTarget = objectRef(
        'zhiju.project.project',
        fixture.projectId,
        scope(),
      ) as Common.ObjectRef;
      async function progressAuthorization(payload: CanonicalJsonObject) {
        const payloadHash = digestCanonicalPayload(payload).hash;
        const decision = await firstRunAuth.authorize(
          identityDeps([fixture.projectId], service),
          'runFinalProcessProgressV1',
          {
            actorSnapshotRef: service.actorRef,
            commandType: 'execution.process_final_progress',
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: AUTH_HASH,
            targetRef: progressTarget,
          },
        );
        expect(decision.outcome).toBe('ALLOW');
        if (decision.outcome !== 'ALLOW') throw new Error('final progress denied');
        const proof = async () => {
          const validity = await firstRunAuth.revalidate(
            identityDeps([fixture.projectId], service),
            'runFinalProcessProgressV1',
            {
              decisionRef: decision.authorizationDecisionRef,
              expectedCommandType: 'execution.process_final_progress',
              expectedCommandVersion: '1.0',
              expectedCommandPayloadHash: payloadHash,
              expectedAuthenticationContextHash: AUTH_HASH,
              expectedTargetRef: progressTarget,
            },
          );
          expect(validity.valid).toBe(true);
        };
        return {
          decisionRef: decision.authorizationDecisionRef,
          context: {
            ...runnerContext(service),
            authorizationDecisionId: decision.authorizationDecisionRef.objectId,
            authorizationDecisionHash: Buffer.from(
              decision.authorizationDecisionRef.contentHash.digest,
              'hex',
            ),
            authorizationDecisionExpiresAt: new Date(decision.expiresAt),
          },
          proof,
        };
      }
      const progressListPayload = { projectRef: progressTarget } as unknown as CanonicalJsonObject;
      let progressListAuthorization = await progressAuthorization(progressListPayload);
      expect(
        await firstRunAuth.revalidate(
          identityDeps([fixture.projectId], service),
          'runFinalProcessProgressV1',
          {
            decisionRef: scanDecision.authorizationDecisionRef,
            expectedCommandType: 'execution.process_final_progress',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: digestCanonicalPayload(progressListPayload).hash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: progressTarget,
          },
        ),
      ).toMatchObject({ valid: false });
      expect(
        await firstRunAuth.revalidate(
          identityDeps([fixture.projectId], service),
          'runFinalCandidateScanV1',
          {
            decisionRef: progressListAuthorization.decisionRef,
            expectedCommandType: 'execution.submit_agent_result',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: scanPayloadHash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: scanTarget,
          },
        ),
      ).toMatchObject({ valid: false });
      function progressEnvelope(
        context: TaskExecutionTransactionContext,
        processId: string,
        payload: CanonicalJsonObject,
        idempotencyKey: string,
        expectedAggregateVersion?: string,
      ) {
        return {
          commandId: newUuidV7(),
          commandType: 'execution.process_final_progress',
          commandVersion: '1.0',
          idempotencyScope: `execution.process_final_progress@1.0:${fixture.enterpriseId}:${fixture.projectId}`,
          idempotencyKey,
          requestPayload: payload,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType: 'ProcessInstance',
          targetId: processId,
          ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
          correlationId: context.correlationId,
          principalId: context.principalId,
          principalKind: context.principalKind,
          actorSnapshotId: context.actorSnapshotId,
          authorizationDecisionId: context.authorizationDecisionId,
          policySnapshotId: context.policySnapshotId,
        };
      }
      const scanned = await scanControlledFinalCandidates(
        guardedTeDb,
        scanContext,
        () => new Date(clock),
        scanProof,
      );
      expect(scanned).toContainEqual({ runRef, attemptRef });
      const finalQuery = await firstRunQuery(
        'integration.get_runtime_final_observation',
        attemptRef,
        { attemptRef } as unknown as CanonicalJsonObject,
        'runtimeFinalReadV1',
      );
      async function expireRejectedFinalRun() {
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        const expireEnvelope = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          2,
        );
        expect(await firstRunEntry.expireRun(expireEnvelope, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
      }
      if (terminalScenario === 'NON_FINAL_CORE_REJECT') {
        const malformedDriver = new LocalSyntheticRuntimeDriver(
          undefined,
          runtimeJournal,
          () => new Date(clock),
        );
        await expect(malformedDriver.releaseFinal(attemptRef)).rejects.toMatchObject({
          code: 'INTEGRATION_RUNTIME_FINAL_SCHEMA_INVALID',
        });
        expect(await malformedDriver.readFinal(attemptRef)).toBeUndefined();
        await expect(
          firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        await expireRejectedFinalRun();
        return;
      }
      if (
        terminalScenario === 'TIMED_OUT' ||
        terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
        terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
      ) {
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        if (terminalScenario === 'TERMINAL_BEFORE_FINAL') {
          const closed = await firstRunEntry.expireRun(
            await firstRunEnvelope(
              'execution.expire_run',
              runRef,
              { reason: 'DEADLINE_EXCEEDED' },
              service,
              2,
            ),
            sessionFor(service),
          );
          expect(closed).toMatchObject({ status: 'COMMITTED' });
        }
        const lateDriver = new LocalSyntheticRuntimeDriver(
          undefined,
          runtimeJournal,
          () => new Date(clock),
        );
        await lateDriver.releaseFinal(attemptRef);
        expect((await lateDriver.readFinal(attemptRef))?.observedAt).toEqual(new Date(clock));
        const lateFinalQuery = await firstRunQuery(
          'integration.get_runtime_final_observation',
          attemptRef,
          { attemptRef } as unknown as CanonicalJsonObject,
          'runtimeFinalReadV1',
        );
        const lateFinal = await firstRunEntry.observeRuntimeFinal(
          lateFinalQuery,
          sessionFor(service),
        );
        expect(lateFinal).toBeDefined();
        if (terminalScenario === 'TERMINAL_BEFORE_FINAL') {
          if (lateFinal === undefined) throw new Error('missing terminal-late final');
          expect(
            await firstRunEntry.getRuntimeFinalObservation(lateFinalQuery, sessionFor(service)),
          ).toEqual(lateFinal);
          const lateBody = record(lateFinal.agentResultContract);
          const lateSubmit = await firstRunEnvelope(
            'execution.submit_agent_result',
            objectRef(
              'execution.agent_result',
              String(lateBody.agentResultId),
              scope(),
            ) as Common.ObjectRef,
            {
              agentResultContract: lateBody,
              runFencingToken: 1,
              runtimeSubmissionRef: lateFinal.runtimeSubmissionRef,
            } as unknown as CanonicalJsonObject,
            service,
          );
          await expect(
            firstRunEntry.submitAgentResult(lateSubmit, sessionFor(service)),
          ).rejects.toBeDefined();
          expect(await receiptRows(lateSubmit.idempotencyKey)).toEqual([]);
          expect(
            (
              await admin.query<{ count: string }>(
                'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ count: '0' }]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.run WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'TIMED_OUT' }]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'EXPIRED' }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
          return;
        }
        if (terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED') {
          const bundleWait = Math.max(0, bundleValidUntil.getTime() - Date.now() + 100);
          if (bundleWait > 0) await waitForDeadline(bundleWait, 'server deadline/bundleWait');
          clock = Date.now();
          expect(clock).toBeGreaterThan(bundleValidUntil.getTime());
          expect(
            (
              await admin.query<{ expired: boolean }>(
                'SELECT clock_timestamp() > valid_until AS expired FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
                [record(bundleRef).objectId],
              )
            ).rows,
          ).toEqual([{ expired: true }]);
        }
        const expiredEnvelope = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          2,
        );
        if (terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED') {
          for (const [label, inspectedBundle, inspectedRun] of [
            [
              'Bundle Hash',
              { ...record(bundleRef), contentHash: contentHash('0'.repeat(64)) },
              runRef,
            ],
            ['Run binding', record(bundleRef), { ...runRef, objectId: newUuidV7() }],
          ] as const) {
            const inspectPayloadHash = digestCanonicalPayload({
              bundleRef: inspectedBundle,
              runRef: inspectedRun,
            } as unknown as CanonicalJsonObject).hash;
            const inspectDecision = await firstRunAuth.authorize(
              identityDeps([fixture.projectId], service),
              'runExpireBundleInspectV1',
              {
                actorSnapshotRef: service.actorRef,
                commandType: 'execution.expire_run',
                commandVersion: '1.0',
                commandPayloadHash: inspectPayloadHash,
                authenticationContextHash: service.authHash,
                targetRef: inspectedBundle as unknown as Common.ContentAddressedRef,
              },
            );
            expect(inspectDecision.outcome, label).toBe('ALLOW');
            if (inspectDecision.outcome !== 'ALLOW') throw new Error('expiry inspect denied');
            const inspectProof = async () => {
              expect(
                await firstRunAuth.revalidate(
                  identityDeps([fixture.projectId], service),
                  'runExpireBundleInspectV1',
                  {
                    decisionRef: inspectDecision.authorizationDecisionRef,
                    expectedCommandType: 'execution.expire_run',
                    expectedCommandVersion: '1.0',
                    expectedCommandPayloadHash: inspectPayloadHash,
                    expectedAuthenticationContextHash: service.authHash,
                    expectedTargetRef: inspectedBundle as unknown as Common.ContentAddressedRef,
                  },
                ),
              ).toMatchObject({ valid: true });
            };
            const inspectContext = {
              ...runnerContext(service),
              authorizationDecisionId: inspectDecision.authorizationDecisionRef.objectId,
              authorizationDecisionHash: Buffer.from(
                inspectDecision.authorizationDecisionRef.contentHash.digest,
                'hex',
              ),
              authorizationDecisionExpiresAt: new Date(inspectDecision.expiresAt),
            };
            await expect(
              readIntegrityForExpiry(
                identityDb,
                inspectContext,
                inspectedBundle as unknown as CanonicalJsonObject,
                inspectedRun as unknown as CanonicalJsonObject,
                inspectProof,
              ),
              label,
            ).rejects.toBeDefined();
            expect(await receiptRows(expiredEnvelope.idempotencyKey), label).toEqual([]);
            expect(
              (
                await admin.query<{ status: string }>(
                  'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                  [runRef.objectId],
                )
              ).rows,
              label,
            ).toEqual([{ status: 'ACTIVE' }]);
          }
          const expiryGrantId = firstRunGrants.get('runExpireV1');
          const expiryBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
            (binding) => binding.boundary === 'runExpireV1',
          );
          if (expiryGrantId === undefined || expiryBinding === undefined)
            throw new Error('missing independent expiry Grant');
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: expiryGrantId,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI224_REVOKE_EXPIRY',
              effectiveAt: new Date(),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          queryReads.length = 0;
          await expect(
            firstRunEntry.expireRun(expiredEnvelope, sessionFor(service)),
          ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          expect(protectedReads(), 'expiry Grant revoked').toEqual([]);
          expect(await receiptRows(expiredEnvelope.idempotencyKey)).toEqual([]);
          const otherServiceId = newUuidV7();
          const otherActorId = newUuidV7();
          await withIdentityTransaction(identityDb, identityContext([]), (trx) =>
            identityRepo.insertPrincipal(trx, {
              id: otherServiceId,
              principalKind: 'SERVICE',
              displayName: 'WI-224 ungranted expiry service',
              createdByPrincipalId: OPERATOR,
              createdByActorSnapshotId: OPERATOR_ACTOR,
            }),
          );
          const otherActorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
            actorSnapshotId: otherActorId,
            principalId: otherServiceId,
            declaredPrincipalKind: 'SERVICE',
            authenticationContextHash: AUTH_HASH,
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          });
          const otherService: Principal = {
            principalId: otherServiceId,
            principalKind: 'SERVICE',
            actorSnapshotId: otherActorId,
            actorRef: otherActorRef,
            authHash: AUTH_HASH,
          };
          const otherExpiryDecision = await firstRunAuth.authorize(
            identityDeps([fixture.projectId], otherService),
            'runExpireV1',
            {
              actorSnapshotRef: otherActorRef,
              commandType: 'execution.expire_run',
              commandVersion: '1.0',
              commandPayloadHash: digestCanonicalPayload(expiredEnvelope.payload).hash,
              authenticationContextHash: AUTH_HASH,
              targetRef: runRef,
            },
          );
          expect(otherExpiryDecision.outcome).toBe('DENY');
          await grant({
            principal: service,
            capabilityCode: firstRunCodes.runExpireV1,
            action: expiryBinding.requiredGrantAction,
            selectorType: expiryBinding.selectorType,
            targetObjectType: 'execution.run',
          });
        }
        const authorizedExpiryEnvelope =
          terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
            ? await firstRunEnvelope(
                'execution.expire_run',
                runRef,
                { reason: 'DEADLINE_EXCEEDED' },
                service,
                2,
              )
            : expiredEnvelope;
        const expired = await firstRunEntry.expireRun(
          authorizedExpiryEnvelope,
          sessionFor(service),
        );
        expect(expired, JSON.stringify(expired)).toMatchObject({ status: 'COMMITTED' });
        expect(
          await firstRunEntry.expireRun(authorizedExpiryEnvelope, sessionFor(service)),
        ).toMatchObject({ status: 'DUPLICATE' });
        const lateBody = record(lateFinal?.agentResultContract);
        const lateSubmit = await firstRunEnvelope(
          'execution.submit_agent_result',
          objectRef(
            'execution.agent_result',
            String(lateBody.agentResultId),
            scope(),
          ) as Common.ObjectRef,
          {
            agentResultContract: lateBody,
            runFencingToken: 1,
            runtimeSubmissionRef: lateFinal?.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(lateSubmit, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(
          await firstRunEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              runRef,
              { runRef } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({
          status: 'TIMED_OUT',
          terminationReason: 'EXECUTION_DEADLINE_EXCEEDED',
        });
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'EXPIRED' }]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(
          (
            await admin.query<{ event_type: string; count: string }>(
              "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated' GROUP BY event_type",
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ event_type: 'execution.RunTerminated', count: '1' }]);
        return;
      }
      await expect(
        firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      if (terminalScenario === 'RECOVERY' || terminalScenario === 'RECOVERY_WORKER') {
        expect(
          await recoverControlledFinalRuns(
            teDb,
            scanContext,
            {
              now: () => new Date(clock),
              revalidateScan: scanProof,
              readFinal: async (originalAttemptRef) => {
                expect(originalAttemptRef).toEqual(attemptRef);
                await expect(
                  firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
                ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
                return undefined;
              },
              readRun: () => Promise.reject(new Error('unobserved final must not read Run')),
              readPolicy: () => Promise.reject(new Error('unobserved final must not read Policy')),
              listProgress: () =>
                listControlledFinalProgress(
                  guardedTeDb,
                  progressListAuthorization.context,
                  progressListAuthorization.proof,
                ),
              createProgress: () =>
                Promise.reject(new Error('unobserved final must not create Process')),
              advanceProgress: () =>
                Promise.reject(new Error('unobserved final must not advance Process')),
              suspendTimedOutProgress: () =>
                Promise.reject(new Error('unobserved final must not suspend Process')),
              execute: () => Promise.reject(new Error('unobserved final must not submit')),
            },
            1,
          ),
        ).toBe(0);
      }
      const observingDriver = new LocalSyntheticRuntimeDriver(undefined, runtimeJournal);
      const observingEntry = createControlledFirstRunEntry({
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
        runtimeDriver: observingDriver,
        receiptStorage: runtimeJournal,
        capabilityCodes: firstRunCodes,
        ...(bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: recoveryCodes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      });
      expect(await observingDriver.readFinal(attemptRef)).toEqual(
        await runtimeDriver.readFinal(attemptRef),
      );
      expect(observingDriver.invokedAttemptIds).toEqual([]);
      if (exercisePreparationMatrix) {
        const unobservedFinal = await observingDriver.readFinal(attemptRef);
        if (unobservedFinal === undefined) throw new Error('missing unobserved synthetic final');
        const unobservedBody = record(unobservedFinal.agentResultContract);
        const unobservedSubmit = await firstRunEnvelope(
          'execution.submit_agent_result',
          objectRef(
            'execution.agent_result',
            String(unobservedBody.agentResultId),
            scope(),
          ) as Common.ObjectRef,
          {
            agentResultContract: unobservedBody,
            runFencingToken: 1,
            runtimeSubmissionRef: unobservedFinal.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(unobservedSubmit, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(unobservedSubmit.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        const unavailableEntry = createControlledFirstRunEntry({
          taskExecutionDb: guardedTeDb,
          enterpriseProjectDb,
          identity: { db: identityDb, repo: identityRepo, crypto },
          integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
          runtimeDriver: {
            invoke: () => Promise.reject(new Error('unexpected synthetic invocation')),
            readBack: (ref) => observingDriver.readBack(ref),
            readFinal: () => Promise.reject(new Error('injected IG final read outage')),
          },
          receiptStorage: runtimeJournal,
          capabilityCodes: firstRunCodes,
          ...(bounded
            ? {
                recovery: {
                  recoveryCapabilityCodes: recoveryCodes,
                  humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                },
              }
            : {}),
          capabilities: dependencyCapabilities,
          now: () => new Date(clock),
        });
        await expect(
          unavailableEntry.observeRuntimeFinal(finalQuery, sessionFor(service)),
        ).rejects.toThrow('injected IG final read outage');
        await expect(
          firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      }
      if (terminalScenario === 'IG_WRONG_SESSION') {
        const actualFinal = await observingDriver.readFinal(attemptRef);
        if (actualFinal === undefined) throw new Error('missing wrong-session final');
        expect(
          registry.validateCoreContract(
            'https://schemas.zhiju.local/core/agent-result/1.0',
            actualFinal.agentResultContract,
          ).valid,
        ).toBe(true);
        expect(
          record(actualFinal.agentResultContract.provenance).runtimeSessionExternalRef,
        ).not.toEqual(dispatched.acknowledgement?.runtimeSessionRef);
        await expect(
          observingEntry.observeRuntimeFinal(finalQuery, sessionFor(service)),
        ).rejects.toBeDefined();
        await expect(
          firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
        await expireRejectedFinalRun();
        return;
      }
      if (exercisePreparationMatrix) {
        const igDb = createIntegrationRendererDatabase(tePool);
        const actualFinal = await observingDriver.readFinal(attemptRef);
        if (actualFinal === undefined) throw new Error('missing SQL final guard source');
        const source = await withRenderTransaction(igDb, runnerContext(service), async (trx) => ({
          attempt: await trx
            .selectFrom('integration_gateway.runtime_attempt')
            .selectAll()
            .where('attempt_id', '=', attemptRef.objectId)
            .executeTakeFirstOrThrow(),
          identity: await trx
            .selectFrom('integration_gateway.runtime_adapter_identity')
            .selectAll()
            .where('attempt_id', '=', attemptRef.objectId)
            .executeTakeFirstOrThrow(),
        }));
        const resultHash = contentHash(hashContractPayload(actualFinal.agentResultContract));
        const payloadBase = {
          attemptId: attemptRef.objectId,
          runtimeAdapterIdentityRef: actualFinal.runtimeAdapterIdentityRef,
          runtimeSubmissionRef: actualFinal.runtimeSubmissionRef,
          resultPayloadHash: resultHash,
          bindingHash: actualFinal.bindingHash,
          observedAt: actualFinal.observedAt.toISOString(),
          source: 'SYNTHETIC_DRIVER',
        } as unknown as CanonicalJsonObject;
        const base = {
          observation_id: newUuidV7(),
          attempt_id: attemptRef.objectId,
          enterprise_id: fixture.enterpriseId,
          project_id: fixture.projectId,
          ack_observation_id: source.identity.ack_observation_id,
          runtime_adapter_identity_id: source.identity.instance_id,
          runtime_submission_ref: canonicalize(
            actualFinal.runtimeSubmissionRef as unknown as CanonicalJsonObject,
          ),
          result_payload: canonicalize(actualFinal.agentResultContract),
          result_payload_hash: Buffer.from(resultHash.digest, 'hex'),
          binding_hash: source.attempt.binding_hash,
          fencing_token: String(actualFinal.runFencingToken),
          observed_at: actualFinal.observedAt,
          source: 'SYNTHETIC_DRIVER' as const,
          source_command_id: source.attempt.source_command_id,
          canonical_payload: canonicalize(payloadBase),
          payload_hash: Buffer.from(sha256CanonicalJson(payloadBase), 'hex'),
        };
        const rollbackMarker = new Error('WI224 direct final insert rolled back');
        const insertAndRollback = (patch: Partial<typeof base>) => {
          const observationId = newUuidV7();
          const payload = { ...payloadBase, observationId };
          return withRenderTransaction(igDb, runnerContext(service), async (trx) => {
            await trx
              .insertInto('integration_gateway.runtime_final_observation')
              .values({
                ...base,
                observation_id: observationId,
                canonical_payload: canonicalize(payload),
                payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
                ...patch,
              })
              .execute();
            throw rollbackMarker;
          });
        };
        await expect(insertAndRollback({})).rejects.toBe(rollbackMarker);
        const bodyPatch = (body: CanonicalJsonObject) => {
          const revisedBody = {
            ...body,
            header: { ...record(body.header), payloadHash: contentHash(hashContractPayload(body)) },
          } as unknown as CanonicalJsonObject;
          expect(
            registry.validateCoreContract(
              'https://schemas.zhiju.local/core/agent-result/1.0',
              revisedBody,
            ).valid,
          ).toBe(true);
          return {
            result_payload: canonicalize(revisedBody),
            result_payload_hash: Buffer.from(hashContractPayload(revisedBody), 'hex'),
          };
        };
        const body = actualFinal.agentResultContract;
        const mutations: readonly (readonly [string, Partial<typeof base>])[] = [
          ['Attempt FK', { attempt_id: newUuidV7() }],
          ['ack FK', { ack_observation_id: newUuidV7() }],
          ['Adapter identity', { runtime_adapter_identity_id: newUuidV7() }],
          ['Enterprise Scope', { enterprise_id: newUuidV7() }],
          ['Project Scope', { project_id: newUuidV7() }],
          ['binding Hash', { binding_hash: Buffer.alloc(32) }],
          ['Result Hash', { result_payload_hash: Buffer.alloc(32) }],
          ['observation Hash', { payload_hash: Buffer.alloc(32) }],
          ['source Receipt', { source_command_id: newUuidV7() }],
          ['fencing', { fencing_token: String(actualFinal.runFencingToken + 1) }],
          [
            'Result Run',
            bodyPatch({
              ...body,
              runRef: { ...record(body.runRef), objectId: newUuidV7() },
            }),
          ],
          [
            'Result Scope',
            bodyPatch({
              ...body,
              header: {
                ...record(body.header),
                scopeRef: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
              },
            }),
          ],
          [
            'Result Adapter',
            bodyPatch({
              ...body,
              submittedByRuntime: { ...record(body.submittedByRuntime), objectId: newUuidV7() },
            }),
          ],
          [
            'Result session',
            bodyPatch({
              ...body,
              provenance: {
                ...record(body.provenance),
                runtimeSessionExternalRef: {
                  ...record(record(body.provenance).runtimeSessionExternalRef),
                  externalId: newUuidV7(),
                },
              },
            }),
          ],
        ];
        const outcomes: { label: string; code: string }[] = [];
        for (const [label, patch] of mutations) {
          try {
            await insertAndRollback(patch);
            outcomes.push({ label, code: 'NO_ROLLBACK' });
          } catch (error) {
            outcomes.push({
              label,
              code:
                error === rollbackMarker
                  ? 'ACCEPTED'
                  : error !== null &&
                      typeof error === 'object' &&
                      'code' in error &&
                      typeof error.code === 'string'
                    ? error.code
                    : 'UNKNOWN',
            });
          }
        }
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM integration_gateway.runtime_final_observation WHERE attempt_id=$1',
              [attemptRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(outcomes).toEqual(mutations.map(([label]) => ({ label, code: '22023' })));
      }
      async function finalDependencyRefusals(
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
        execute: (
          entry: ReturnType<typeof createControlledFirstRunEntry>,
          value: unknown,
          session: InitialContextSession,
        ) => Promise<unknown>,
      ) {
        if (!exercisePreparationMatrix) return;
        const reads: string[] = [];
        const probePlugin: KyselyPlugin = {
          transformQuery(args) {
            if (args.node.kind === 'SelectQueryNode') reads.push(JSON.stringify(args.node));
            return args.node;
          },
          transformResult: (args) => Promise.resolve(args.result),
        };
        const probeEntry = createControlledFirstRunEntry({
          taskExecutionDb: teDb.withPlugin(probePlugin),
          enterpriseProjectDb,
          identity: { db: identityDb.withPlugin(probePlugin), repo: identityRepo, crypto },
          integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(probePlugin),
          runtimeDriver,
          receiptStorage: runtimeJournal,
          capabilityCodes: firstRunCodes,
          ...(bounded
            ? {
                recovery: {
                  recoveryCapabilityCodes: recoveryCodes,
                  humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                },
              }
            : {}),
          capabilities: dependencyCapabilities,
          now: () => new Date(clock),
        });
        // Actor, scope, authentication and unrelated current Decisions fail
        // before any protected TE or IG repository read.
        for (const borrower of borrowedActors) {
          reads.length = 0;
          await expect(
            execute(probeEntry, { ...envelope, actor: borrower.actorRef }, sessionFor(borrower)),
          ).rejects.toBeDefined();
          expect(
            reads.filter((query) => /"name":"(?:task_execution|integration_gateway)"/u.test(query)),
          ).toEqual([]);
          expect(await receiptRows(envelope.idempotencyKey)).toEqual([]);
        }
        for (const [label, value, session] of [
          [
            'other operation Decision',
            { ...envelope, authorizationDecisionRef: startEnvelope.authorizationDecisionRef },
            sessionFor(service),
          ],
          ['other principal Actor', { ...envelope, actor: operator().actorRef }, sessionFor()],
          [
            'Actor Snapshot Hash',
            {
              ...envelope,
              actor: { ...service.actorRef, contentHash: contentHash('0'.repeat(64)) },
            },
            sessionFor(service),
          ],
          ['session Actor', envelope, sessionFor()],
          [
            'authentication Hash',
            envelope,
            { ...sessionFor(service), authenticationContextHash: Buffer.alloc(32) },
          ],
          [
            'target ID',
            { ...envelope, targetRef: { ...envelope.targetRef, objectId: newUuidV7() } },
            sessionFor(service),
          ],
          [
            'Project Scope',
            {
              ...envelope,
              scopeRef: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            },
            sessionFor(service),
          ],
          [
            'Enterprise Scope',
            { ...envelope, scopeRef: { enterpriseId: newUuidV7(), projectId: fixture.projectId } },
            sessionFor(service),
          ],
        ] as const) {
          clock = Math.max(clock, Date.now());
          reads.length = 0;
          await expect(execute(probeEntry, value, session), label).rejects.toBeDefined();
          expect(
            reads.filter((query) => /"name":"(?:task_execution|integration_gateway)"/u.test(query)),
            label,
          ).toEqual([]);
          expect(await receiptRows(envelope.idempotencyKey), label).toEqual([]);
        }
        for (const binding of CONTROLLED_FIRST_RUN_BINDINGS.filter(
          (candidate) =>
            candidate.commandType === envelope.commandType &&
            /(?:Binding|Final|Bundle|Policy|Source)ReadV1$/u.test(candidate.boundary),
        )) {
          const grantId = firstRunGrants.get(binding.boundary);
          const targetObjectType = binding.targetObjectTypes[0];
          if (grantId === undefined || targetObjectType === undefined)
            throw new Error(`missing ${binding.boundary} dependency Grant`);
          const table = binding.boundary.endsWith('BindingReadV1')
            ? 'runtime_attempt'
            : binding.boundary.endsWith('FinalReadV1')
              ? 'runtime_final_observation'
              : binding.boundary.endsWith('BundleReadV1')
                ? 'execution_capability_bundle'
                : binding.boundary.endsWith('PolicyReadV1')
                  ? 'policy_version'
                  : binding.boundary === 'runFinalizeSourceReadV1'
                    ? 'agent_result_acceptance'
                    : 'agent_result';
          const ownBoundary = CONTROLLED_FIRST_RUN_BINDINGS.find(
            (candidate) =>
              candidate.commandType === envelope.commandType &&
              candidate.targetObjectTypes.includes(envelope.targetRef.objectType) &&
              [
                'agentResultSubmitV1',
                'runResultRecordV1',
                'agentResultValidateV1',
                'agentResultAcceptV1',
                'runFinalizeV1',
              ].includes(candidate.boundary),
          )?.boundary;
          if (ownBoundary === undefined) throw new Error('missing own final boundary');
          expect(
            await firstRunAuth.revalidate(identityDeps([fixture.projectId], service), ownBoundary, {
              decisionRef: envelope.authorizationDecisionRef,
              expectedCommandType: envelope.commandType,
              expectedCommandVersion: '1.0',
              expectedCommandPayloadHash: digestCanonicalPayload(envelope.payload).hash,
              expectedAuthenticationContextHash: service.authHash,
              expectedTargetRef: envelope.targetRef,
            }),
          ).toMatchObject({ valid: true });
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: grantId,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI224_REVOKE_FINAL_DEPENDENCY',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          clock = Math.max(clock, Date.now());
          reads.length = 0;
          await expect(
            execute(probeEntry, envelope, sessionFor(service)),
            binding.boundary,
          ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          expect(
            reads.filter((query) => query.includes(`"kind":"IdentifierNode","name":"${table}"`)),
            binding.boundary,
          ).toEqual([]);
          expect(await receiptRows(envelope.idempotencyKey), binding.boundary).toEqual([]);
          firstRunGrants.set(
            binding.boundary,
            await grant({
              principal: service,
              capabilityCode: firstRunCodes[binding.boundary],
              action: binding.requiredGrantAction,
              selectorType: binding.selectorType,
              targetObjectType,
            }),
          );
        }
      }
      async function finalEligibilityLoss(
        step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE',
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
        execute: (value: unknown) => Promise<unknown>,
      ) {
        if (eligibilityChange?.step !== step) return false;
        phase(`eligibility boundary ${step}/${eligibilityChange.source}`);
        const facts = async () =>
          (
            await admin.query<{ facts: unknown }>(
              `SELECT jsonb_build_object(
            'result', (SELECT jsonb_agg(to_jsonb(f) ORDER BY result_id) FROM task_execution.agent_result f WHERE run_id=$1),
            'bundle', (SELECT jsonb_agg(to_jsonb(f) ORDER BY bundle_id) FROM task_execution.result_validation_bundle f WHERE run_id=$1),
            'validations', (SELECT jsonb_agg(to_jsonb(f) ORDER BY validation_id) FROM task_execution.result_validation_fact f
              WHERE bundle_id IN (SELECT bundle_id FROM task_execution.result_validation_bundle WHERE run_id=$1)),
            'acceptance', (SELECT jsonb_agg(to_jsonb(f) ORDER BY acceptance_id) FROM task_execution.agent_result_acceptance f WHERE run_id=$1)
          ) AS facts`,
              [runRef.objectId],
            )
          ).rows;
        const originalFacts = await facts();
        const originalRun = (
          await admin.query<{ status: string; aggregate_version: string }>(
            'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows;
        clock = Date.now();
        expect(Date.now(), 'eligibility preparation precedes the Run deadline').toBeLessThan(
          runDeadline.getTime(),
        );
        const blocker =
          eligibilityChange.whileLocked === true
            ? new pg.Client({ connectionString: databaseUrl })
            : undefined;
        let waiting: Promise<{ value?: unknown; error?: unknown }> | undefined;
        if (blocker !== undefined) {
          await blocker.connect();
          await blocker.query('BEGIN');
          await blocker.query('SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE', [
            runRef.objectId,
          ]);
          waiting = execute(envelope).then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          let locked = false;
          for (let i = 0; i < 200 && !locked; i++) {
            locked =
              (
                await admin.query<{ locked: boolean }>(
                  `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
               AND query ILIKE '%task_execution%run%') AS locked`,
                )
              ).rows[0]?.locked === true;
            if (!locked) await new Promise<void>((resolve) => setTimeout(resolve, 25));
          }
          if (!locked) {
            await blocker.query('ROLLBACK');
            await blocker.end();
            await waiting;
            throw new Error('owning final command never waited for its Run lock');
          }
        }
        try {
          progress(
            'eligibility change',
            `${step}/${eligibilityChange.source}; remainingMs=${runDeadline.getTime() - Date.now()}`,
          );
          if (eligibilityChange.source === 'GRANT') {
            expect(
              await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
                targetId: executionCapabilityGrantId,
                expectedAggregateVersion: '1',
                scope: {
                  scopeKind: 'PROJECT',
                  enterpriseId: fixture.enterpriseId,
                  projectId: fixture.projectId,
                },
                reasonCode: 'WI224_REVOKE_BUNDLE_OBSERVATION',
                effectiveAt: new Date(clock),
                idempotencyKey: newUuidV7(),
              }),
            ).toMatchObject({ status: 'COMMITTED' });
          } else {
            await registerPolicyVersionAs({
              key: { ...controlsRef, versionId: newUuidV7() },
              factId: newUuidV7(),
              idempotencyKey: newUuidV7(),
              effectiveFrom: new Date(clock),
              supersedesRef: controlsRef,
              policySchemaRefs: [profileReference('execution.work_order_controls.policy@1.0')],
              policyDocument: {
                controls: Object.fromEntries(controlFields.map((field) => [field, revised[field]])),
              } as CanonicalJsonObject,
            });
          }
          const ownBoundary = {
            SUBMIT: 'agentResultSubmitV1',
            RECORD: 'runResultRecordV1',
            VALIDATE: 'agentResultValidateV1',
            ACCEPT: 'agentResultAcceptV1',
            FINALIZE: 'runFinalizeV1',
          }[step];
          expect(
            await firstRunAuth.revalidate(identityDeps([fixture.projectId], service), ownBoundary, {
              decisionRef: envelope.authorizationDecisionRef,
              expectedCommandType: envelope.commandType,
              expectedCommandVersion: '1.0',
              expectedCommandPayloadHash: digestCanonicalPayload(envelope.payload).hash,
              expectedAuthenticationContextHash: service.authHash,
              expectedTargetRef: envelope.targetRef,
            }),
          ).toMatchObject({ valid: true });
        } finally {
          clock = Math.max(clock, Date.now());
          if (blocker !== undefined) {
            await blocker.query('ROLLBACK');
            await blocker.end();
          }
        }
        if (waiting !== undefined) {
          expect(clock, 'source loss precedes the Run deadline').toBeLessThan(
            runDeadline.getTime(),
          );
          expect(await waiting, `${step} ${eligibilityChange.source} after lock`).toHaveProperty(
            'error',
          );
        } else
          await expect(
            execute(envelope),
            `${step} ${eligibilityChange.source}`,
          ).rejects.toBeDefined();
        expect(Date.now(), 'eligibility refusal precedes the Run deadline').toBeLessThan(
          runDeadline.getTime(),
        );
        progress(
          'eligibility refusal',
          `${step}/${eligibilityChange.source}; remainingMs=${runDeadline.getTime() - Date.now()}`,
        );
        expect(await receiptRows(envelope.idempotencyKey)).toEqual([]);
        expect(await facts()).toEqual(originalFacts);
        expect(
          (
            await admin.query<{ status: string; aggregate_version: string }>(
              'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual(originalRun);
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'ACTIVE' }]);
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        const state = await firstRunEntry.getRunState(
          await firstRunQuery(
            'execution.get_run_state',
            runRef,
            { runRef } as unknown as CanonicalJsonObject,
            'runStateReadV1',
          ),
          sessionFor(service),
        );
        const expiry = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          state.aggregateVersion,
        );
        expect(await firstRunEntry.expireRun(expiry, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'EXPIRED' }]);
        expect(await facts()).toEqual(originalFacts);
        expect(
          await firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ).toEqual(finalView);
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
        return true;
      }

      async function finalSqlRefusals(
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
        execute: (value: unknown) => Promise<unknown>,
      ) {
        if (terminalScenario !== 'SUCCEEDED') return;
        const insertTables: Record<string, readonly string[]> = {
          'execution.submit_agent_result': ['agent_result', 'run_final_submission_claim'],
          'execution.validate_agent_result': [
            'execution_judgment',
            'result_validation_bundle',
            'result_validation_fact',
          ],
          'execution.accept_agent_result': ['agent_result_acceptance'],
        };
        const tables = insertTables[envelope.commandType] ?? ['run'];
        for (const table of tables) {
          const event = table === 'run' ? 'UPDATE' : 'INSERT';
          const condition =
            table === 'run'
              ? `NEW.last_command_id='${envelope.commandId}'::uuid`
              : `NEW.source_command_id='${envelope.commandId}'::uuid`;
          // The app's real INSERT/UPDATE has a valid PENDING Receipt. The
          // first trigger changes one mirror; the last trigger rolls every
          // accepted probe back. The no-change probe must reach that marker.
          const sourceField = table === 'run' ? 'last_command_id' : 'source_command_id';
          const mutations: (readonly [string, string])[] = [
            ['source Receipt', `NEW.${sourceField}:='${newUuidV7()}'::uuid;`],
            ['Enterprise Scope', `NEW.enterprise_id:='${newUuidV7()}'::uuid;`],
            ['Project Scope', `NEW.project_id:='${newUuidV7()}'::uuid;`],
          ];
          if (table === 'agent_result' || table === 'run_final_submission_claim') {
            mutations.push(
              ['Result Hash', "NEW.result_payload_hash:=decode(repeat('0',64),'hex');"],
              [
                'observation Scope',
                `NEW.observation_ref:=jsonb_set(NEW.observation_ref,'{scope,projectId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
            );
          }
          if (table === 'agent_result') {
            mutations.push(
              [
                'Attempt Ref',
                `NEW.attempt_ref:=jsonb_set(NEW.attempt_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
              [
                'Adapter Ref',
                `NEW.adapter_identity_ref:=jsonb_set(NEW.adapter_identity_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
              ['fencing', 'NEW.fencing_token:=NEW.fencing_token+1;'],
            );
            for (const [label, path] of [
              ['Result Run Scope', '{runRef,scope,projectId}'],
              ['Result Header Scope', '{header,scopeRef,projectId}'],
            ] as const) {
              mutations.push([
                label,
                `NEW.result_payload:=jsonb_set(NEW.result_payload,'${path}',to_jsonb('${newUuidV7()}'::text));
                NEW.result_payload_hash:=sha256(convert_to(task_execution.canonical_jsonb_text(NEW.result_payload #- '{header,payloadHash}'),'UTF8'));
                NEW.result_payload:=jsonb_set(NEW.result_payload,'{header,payloadHash,digest}',to_jsonb(encode(NEW.result_payload_hash,'hex')));`,
              ]);
            }
          }
          if (
            [
              'execution_judgment',
              'result_validation_bundle',
              'result_validation_fact',
              'agent_result_acceptance',
            ].includes(table)
          ) {
            mutations.push(['payload Hash', "NEW.payload_hash:=decode(repeat('0',64),'hex');"]);
          }
          if (table === 'result_validation_bundle') {
            mutations.push(
              [
                'Evaluator Ref',
                `NEW.evaluator_ref:=jsonb_set(NEW.evaluator_ref,'{versionId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
              [
                'Policy Ref',
                `NEW.policy_ref:=jsonb_set(NEW.policy_ref,'{versionId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
              [
                'Attempt Ref',
                `NEW.attempt_ref:=jsonb_set(NEW.attempt_ref,'{objectId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
              ['validUntil mirror', "NEW.valid_until:=NEW.valid_until-interval '1 second';"],
            );
          }
          if (table === 'result_validation_fact') {
            mutations.push(['Bundle Ref', `NEW.bundle_id:='${newUuidV7()}'::uuid;`]);
            for (const [label, path] of [
              ['child validUntil', '{validUntil}'],
              ['child Run', '{runRef,objectId}'],
              ['child Result', '{agentResultRef,objectId}'],
              ['child Attempt', '{attemptRef,objectId}'],
              ['child observation', '{observationRef,objectId}'],
              ['child Policy', '{policyRef,versionId}'],
              ['child Evaluator', '{evaluatorRef,versionId}'],
            ] as const)
              mutations.push([
                label,
                `NEW.canonical_payload:=jsonb_set(NEW.canonical_payload,'${path}',to_jsonb('${newUuidV7()}'::text));
              NEW.payload_hash:=sha256(convert_to(task_execution.canonical_jsonb_text(NEW.canonical_payload),'UTF8'));`,
              ]);
          }
          if (table === 'agent_result_acceptance') {
            mutations.push(
              ['Result Ref', `NEW.result_id:='${newUuidV7()}'::uuid;`],
              ['Bundle Ref', `NEW.bundle_id:='${newUuidV7()}'::uuid;`],
            );
          }
          if (table === 'run') {
            const field =
              envelope.commandType === 'execution.record_run_result'
                ? 'result_ref'
                : 'acceptance_ref';
            mutations.push(
              [
                'fact Hash',
                `NEW.${field}:=jsonb_set(NEW.${field},'{contentHash,digest}',to_jsonb(repeat('0',64)));`,
              ],
              [
                'fact Ref Scope',
                `NEW.${field}:=jsonb_set(NEW.${field},'{scope,projectId}',to_jsonb('${newUuidV7()}'::text));`,
              ],
            );
          }
          await admin.query(`CREATE FUNCTION task_execution.wi224_sql_probe_end() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_SQL_PROBE_ACCEPTED'; END $f$`);
          await admin.query(`CREATE TRIGGER zz_wi224_sql_probe AFTER ${event} ON task_execution.${table}
            FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION task_execution.wi224_sql_probe_end()`);
          const probe = async (statement: string) => {
            await admin.query(`CREATE FUNCTION task_execution.wi224_sql_probe_change() RETURNS trigger
              LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
            await admin.query(`CREATE TRIGGER aa_wi224_sql_probe BEFORE ${event} ON task_execution.${table}
              FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION task_execution.wi224_sql_probe_change()`);
            try {
              await execute(envelope);
              return 'UNEXPECTED_SUCCESS';
            } catch (error) {
              if (error instanceof Error && error.message.includes('WI224_SQL_PROBE_ACCEPTED'))
                return 'ACCEPTED';
              return error !== null && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : 'UNKNOWN';
            } finally {
              await admin.query(`DROP TRIGGER aa_wi224_sql_probe ON task_execution.${table}`);
              await admin.query('DROP FUNCTION task_execution.wi224_sql_probe_change()');
            }
          };
          try {
            expect(await probe(''), `${table} valid source baseline`).toBe('ACCEPTED');
            const outcomes: { label: string; code: string }[] = [];
            for (const [label, statement] of mutations)
              outcomes.push({ label, code: await probe(statement) });
            // Soft assertions preserve the original Run's cleanup even when
            // a guard is missing; accepted probes have already rolled back.
            for (const outcome of outcomes)
              expect
                .soft(
                  ['22023', '23514', '42501', '23503', '23505'],
                  `${table} ${outcome.label}: ${outcome.code}`,
                )
                .toContain(outcome.code);
            expect(await receiptRows(envelope.idempotencyKey)).toEqual([]);
          } finally {
            await admin.query(`DROP TRIGGER zz_wi224_sql_probe ON task_execution.${table}`);
            await admin.query('DROP FUNCTION task_execution.wi224_sql_probe_end()');
          }
        }
      }

      async function finalSourceReceiptRefusals(
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
        execute: (value: unknown) => Promise<unknown>,
      ) {
        if (terminalScenario !== 'SUCCEEDED') return;
        await admin.query(`CREATE FUNCTION task_execution.wi224_source_probe_end() RETURNS trigger
          LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_SOURCE_PROBE_ACCEPTED'; END $f$`);
        await admin.query(`CREATE TRIGGER zz_wi224_source_probe AFTER UPDATE ON task_execution.command_receipt
          FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid AND NEW.outcome='COMMITTED')
          EXECUTE FUNCTION task_execution.wi224_source_probe_end()`);
        const probe = async (statement: string) => {
          await admin.query(`CREATE FUNCTION task_execution.wi224_source_probe_change() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
          await admin.query(`CREATE TRIGGER aa_wi224_source_probe BEFORE INSERT ON task_execution.command_receipt
            FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid)
            EXECUTE FUNCTION task_execution.wi224_source_probe_change()`);
          try {
            await execute(envelope);
            return 'UNEXPECTED_SUCCESS';
          } catch (error) {
            if (error instanceof Error && error.message.includes('WI224_SOURCE_PROBE_ACCEPTED'))
              return 'ACCEPTED';
            return error !== null && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'UNKNOWN';
          } finally {
            await admin.query(
              'DROP TRIGGER aa_wi224_source_probe ON task_execution.command_receipt',
            );
            await admin.query('DROP FUNCTION task_execution.wi224_source_probe_change()');
          }
        };
        try {
          expect(await probe(''), `${envelope.commandType} complete source baseline`).toBe(
            'ACCEPTED',
          );
          for (const [label, statement] of [
            ['request Hash', "NEW.request_payload_hash:=decode(repeat('0',64),'hex');"],
            ['command version', "NEW.command_version:='9.0';"],
            ['target', `NEW.target_id:='${newUuidV7()}'::uuid;`],
            ['principal', `NEW.created_by_principal_id:='${newUuidV7()}'::uuid;`],
            ['Decision', `NEW.authorization_decision_id:='${newUuidV7()}'::uuid;`],
            ...(envelope.expectedAggregateVersion === undefined
              ? []
              : [
                  [
                    'CAS expected version',
                    `NEW.expected_aggregate_version:=${envelope.expectedAggregateVersion + 1};`,
                  ] as const,
                ]),
          ] as const) {
            const code = await probe(statement);
            expect
              .soft(
                ['22023', '23514', '42501', '23503'],
                `${envelope.commandType} ${label}: ${code}`,
              )
              .toContain(code);
            expect(await receiptRows(envelope.idempotencyKey)).toEqual([]);
          }
        } finally {
          await admin.query('DROP TRIGGER zz_wi224_source_probe ON task_execution.command_receipt');
          await admin.query('DROP FUNCTION task_execution.wi224_source_probe_end()');
        }
      }
      async function finalValidationAtomicity(
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      ) {
        if (terminalScenario !== 'SUCCEEDED') return;
        for (const kind of ['SCHEMA', 'ALL'] as const) {
          await admin.query(`CREATE FUNCTION task_execution.wi224_omit_validation() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN
              IF '${kind}'='ALL' OR NEW.kind='${kind}' THEN RETURN NULL; END IF;
              RETURN NEW; END $f$`);
          await admin.query(`CREATE TRIGGER aa_wi224_omit_validation BEFORE INSERT ON task_execution.result_validation_fact
            FOR EACH ROW WHEN (NEW.source_command_id='${envelope.commandId}'::uuid)
            EXECUTE FUNCTION task_execution.wi224_omit_validation()`);
          try {
            await expect(
              firstRunEntry.validateAgentResult(envelope, sessionFor(service)),
              kind,
            ).rejects.toMatchObject({ code: '22023' });
          } finally {
            await admin.query(
              'DROP TRIGGER aa_wi224_omit_validation ON task_execution.result_validation_fact',
            );
            await admin.query('DROP FUNCTION task_execution.wi224_omit_validation()');
          }
          expect(await receiptRows(envelope.idempotencyKey)).toEqual([]);
          for (const table of [
            'execution_judgment',
            'result_validation_bundle',
            'result_validation_fact',
          ])
            expect(
              (
                await admin.query<{ count: string }>(
                  `SELECT count(*)::text FROM task_execution.${table} WHERE source_command_id=$1`,
                  [envelope.commandId],
                )
              ).rows,
              `${table} no partial ${kind}`,
            ).toEqual([{ count: '0' }]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.run WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'RESULT_RECORDED' }]);
        }
      }
      async function finalReceiptRollback(
        envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
        execute: (value: unknown) => Promise<unknown>,
      ) {
        if (!exercisePreparationMatrix) return;
        const snapshot = async () =>
          (
            await admin.query<{ run: unknown; claim: unknown }>(
              `SELECT to_jsonb(r) AS run, to_jsonb(c) AS claim
             FROM task_execution.run r JOIN task_execution.work_order_run_claim c USING (run_id)
            WHERE r.run_id=$1`,
              [runRef.objectId],
            )
          ).rows;
        const before = await snapshot();
        await admin.query(`CREATE FUNCTION task_execution.wi224_receipt_fault() RETURNS trigger
          LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_RECEIPT_FAULT'; END $f$`);
        await admin.query(`CREATE TRIGGER wi224_receipt_fault AFTER UPDATE ON task_execution.command_receipt
          FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid AND NEW.outcome='COMMITTED')
          EXECUTE FUNCTION task_execution.wi224_receipt_fault()`);
        try {
          await expect(execute(envelope), envelope.commandType).rejects.toThrow(
            'WI224_RECEIPT_FAULT',
          );
        } finally {
          await admin.query('DROP TRIGGER wi224_receipt_fault ON task_execution.command_receipt');
          await admin.query('DROP FUNCTION task_execution.wi224_receipt_fault()');
        }
        expect(await receiptRows(envelope.idempotencyKey), envelope.commandType).toEqual([]);
        expect(await snapshot(), envelope.commandType).toEqual(before);
        for (const table of [
          'agent_result',
          'run_final_submission_claim',
          'execution_judgment',
          'result_validation_bundle',
          'result_validation_fact',
          'agent_result_acceptance',
          'reference_edge',
          'outbox_event',
        ]) {
          expect(
            (
              await admin.query<{ count: string }>(
                `SELECT count(*)::text FROM task_execution.${table} WHERE source_command_id=$1`,
                [envelope.commandId],
              )
            ).rows,
            `${envelope.commandType} ${table}`,
          ).toEqual([{ count: '0' }]);
        }
      }

      const observed = await observingEntry.observeRuntimeFinal(finalQuery, sessionFor(service));
      expect(observed).toBeDefined();
      const finalView = await firstRunEntry.getRuntimeFinalObservation(
        finalQuery,
        sessionFor(service),
      );
      expect(finalView.observationRef).toEqual(observed?.observationRef);
      if (exercisePreparationMatrix) {
        expect(await observingEntry.observeRuntimeFinal(finalQuery, sessionFor(service))).toEqual(
          finalView,
        );
      }
      if (exercisePreparationMatrix) {
        const unknownAttemptRef = objectRef(
          'integration.runtime_attempt',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        await expect(
          firstRunEntry.getRuntimeFinalObservation(
            await firstRunQuery(
              'integration.get_runtime_final_observation',
              unknownAttemptRef,
              { attemptRef: unknownAttemptRef } as unknown as CanonicalJsonObject,
              'runtimeFinalReadV1',
            ),
            sessionFor(service),
          ),
        ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
      }
      if (terminalScenario === 'UNSUPPORTED_FINAL') {
        const unsupportedBody = record(finalView.agentResultContract);
        if (negativeFinalCase === 'RUNTIME_USAGE')
          expect(unsupportedBody.runtimeUsageRef).toEqual(read.contractRef);
        if (negativeFinalCase === 'TIME') {
          const startedAt = startEnvelope.payload.startedAt;
          const submittedAt = unsupportedBody.submittedAt;
          if (typeof startedAt !== 'string' || typeof submittedAt !== 'string')
            throw new Error('missing final timestamps');
          expect(Date.parse(submittedAt)).toBeLessThan(Date.parse(startedAt));
        }
        const unsupportedSubmit = await firstRunEnvelope(
          'execution.submit_agent_result',
          objectRef(
            'execution.agent_result',
            String(unsupportedBody.agentResultId),
            scope(),
          ) as Common.ObjectRef,
          {
            agentResultContract: unsupportedBody,
            runFencingToken: 1,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          } as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(unsupportedSubmit, sessionFor(service)),
        ).rejects.toMatchObject({
          code: ['HEADER', 'PROVENANCE', 'TIME'].includes(negativeFinalCase)
            ? 'REFERENCE_INVALID'
            : 'EXECUTION_CRITERION_UNSUPPORTED',
        });
        expect(await receiptRows(unsupportedSubmit.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'ACTIVE' }]);
        await expireRejectedFinalRun();
        return;
      }
      if (exercisePreparationMatrix) {
        const conflictAudits = async () =>
          (
            await admin.query<{ safe_summary: string }>(
              `SELECT safe_summary FROM integration_gateway.audit_record WHERE target_id=$1
           AND error_code='INTEGRATION_RUNTIME_FINAL_CONFLICT' ORDER BY audit_id`,
              [attemptRef.objectId],
            )
          ).rows;
        const priorConflictAudits = await conflictAudits();
        const conflictingEntry = createControlledFirstRunEntry({
          taskExecutionDb: guardedTeDb,
          enterpriseProjectDb,
          identity: { db: identityDb, repo: identityRepo, crypto },
          integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
          runtimeDriver: {
            invoke: () => Promise.reject(new Error('unexpected second synthetic invocation')),
            readBack: (ref) => observingDriver.readBack(ref),
            readFinal: async (ref) => {
              const original = await observingDriver.readFinal(ref);
              return original === undefined
                ? undefined
                : {
                    ...original,
                    runtimeSubmissionRef: {
                      ...original.runtimeSubmissionRef,
                      externalId: newUuidV7(),
                    },
                  };
            },
          },
          receiptStorage: runtimeJournal,
          capabilityCodes: firstRunCodes,
          ...(bounded
            ? {
                recovery: {
                  recoveryCapabilityCodes: recoveryCodes,
                  humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                },
              }
            : {}),
          capabilities: dependencyCapabilities,
          now: () => new Date(clock),
        });
        await expect(
          conflictingEntry.observeRuntimeFinal(finalQuery, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_CONFLICT' });
        const retainedConflictAudits = await conflictAudits();
        expect(retainedConflictAudits).toHaveLength(priorConflictAudits.length + 1);
        expect(retainedConflictAudits.at(-1)).toEqual({
          safe_summary: 'synthetic final conflicts with the immutable observation',
        });

        expect(
          await firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ).toEqual(finalView);
      }
      if (exercisePreparationMatrix) {
        const originalFinal = await observingDriver.readFinal(attemptRef);
        if (originalFinal === undefined) throw new Error('missing synthetic final');
        const changedBody = {
          ...originalFinal.agentResultContract,
          humanSummary: 'A different final from the same Attempt.',
        };
        const conflictingBody = {
          ...changedBody,
          header: {
            ...record(originalFinal.agentResultContract.header),
            payloadHash: contentHash(hashContractPayload(changedBody)),
          },
        } as unknown as CanonicalJsonObject;
        const changedRunBody = {
          ...originalFinal.agentResultContract,
          runRef: {
            ...record(originalFinal.agentResultContract.runRef),
            objectId: newUuidV7(),
          },
        };
        const conflictingRunBody = {
          ...changedRunBody,
          header: {
            ...record(originalFinal.agentResultContract.header),
            payloadHash: contentHash(hashContractPayload(changedRunBody)),
          },
        } as unknown as CanonicalJsonObject;
        expect(
          registry.validateCoreContract(
            'https://schemas.zhiju.local/core/agent-result/1.0',
            conflictingRunBody,
          ).valid,
        ).toBe(true);
        for (const conflictingFinal of [
          { ...originalFinal, attemptRef: { ...attemptRef, objectId: newUuidV7() } },
          {
            ...originalFinal,
            attemptRef: {
              ...attemptRef,
              scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            },
          },
          {
            ...originalFinal,
            runtimeAdapterIdentityRef: {
              ...originalFinal.runtimeAdapterIdentityRef,
              objectId: newUuidV7(),
            },
          },
          {
            ...originalFinal,
            runtimeAdapterIdentityRef: {
              ...originalFinal.runtimeAdapterIdentityRef,
              scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            },
          },
          { ...originalFinal, bindingHash: contentHash('0'.repeat(64)) },
          { ...originalFinal, runFencingToken: originalFinal.runFencingToken + 1 },
          { ...originalFinal, agentResultContract: conflictingBody },
          { ...originalFinal, agentResultContract: conflictingRunBody },
        ]) {
          const conflictingFinalEntry = createControlledFirstRunEntry({
            taskExecutionDb: guardedTeDb,
            enterpriseProjectDb,
            identity: { db: identityDb, repo: identityRepo, crypto },
            integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
            runtimeDriver: {
              invoke: () => Promise.reject(new Error('unexpected second synthetic invocation')),
              readBack: (ref) => observingDriver.readBack(ref),
              readFinal: () => Promise.resolve(conflictingFinal),
            },
            receiptStorage: runtimeJournal,
            capabilityCodes: firstRunCodes,
            ...(bounded
              ? {
                  recovery: {
                    recoveryCapabilityCodes: recoveryCodes,
                    humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
                  },
                }
              : {}),
            capabilities: dependencyCapabilities,
            now: () => new Date(clock),
          });
          await expect(
            conflictingFinalEntry.observeRuntimeFinal(finalQuery, sessionFor(service)),
          ).rejects.toBeDefined();
          expect(
            await firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
          ).toEqual(finalView);
        }
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
        const igDb = createIntegrationRendererDatabase(tePool);
        await admin.query('BEGIN');
        try {
          await admin.query('SET LOCAL ROLE integration_gateway_app');
          expect(
            (
              await admin.query(
                'SELECT instance_id FROM integration_gateway.runtime_adapter_identity WHERE instance_id=$1',
                [finalView.runtimeAdapterIdentityRef.objectId],
              )
            ).rows,
          ).toEqual([]);
        } finally {
          await admin.query('ROLLBACK');
        }
        await admin.query('BEGIN');
        try {
          await admin.query('SET LOCAL ROLE integration_gateway_app');
          expect(
            (
              await admin.query(
                'SELECT observation_id FROM integration_gateway.runtime_final_observation WHERE observation_id=$1',
                [finalView.observationRef.objectId],
              )
            ).rows,
          ).toEqual([]);
        } finally {
          await admin.query('ROLLBACK');
        }
        for (const [table, idColumn, id] of [
          ['runtime_adapter_identity', 'instance_id', finalView.runtimeAdapterIdentityRef.objectId],
          ['runtime_final_observation', 'observation_id', finalView.observationRef.objectId],
        ] as const) {
          const tableName = `integration_gateway.${table}`;
          const hidden = await withRenderTransaction(
            igDb,
            { ...runnerContext(service), allowedProjectIds: [newUuidV7()] },
            (trx) =>
              sql`SELECT ${sql.ref(idColumn)} FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
                trx,
              ),
          );
          expect(hidden.rows).toEqual([]);
          await expect(
            withRenderTransaction(igDb, runnerContext(service), (trx) =>
              sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(idColumn)}=${sql.ref(idColumn)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
                trx,
              ),
            ),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            withRenderTransaction(igDb, runnerContext(service), (trx) =>
              sql`DELETE FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
                trx,
              ),
            ),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            admin.query(`UPDATE ${tableName} SET ${idColumn}=${idColumn} WHERE ${idColumn}=$1`, [
              id,
            ]),
          ).rejects.toMatchObject({ code: '55000' });
        }
        await expect(
          admin.query(
            `INSERT INTO integration_gateway.runtime_adapter_identity
              (instance_id,attempt_id,enterprise_id,project_id,adapter_code,adapter_version,
               binding_hash,ack_observation_id,source,source_command_id,canonical_payload,payload_hash)
             SELECT $2::uuid,attempt_id,enterprise_id,project_id,adapter_code,adapter_version,
                    binding_hash,ack_observation_id,source,source_command_id,canonical_payload,payload_hash
               FROM integration_gateway.runtime_adapter_identity WHERE instance_id=$1`,
            [finalView.runtimeAdapterIdentityRef.objectId, newUuidV7()],
          ),
        ).rejects.toMatchObject({ code: '22023' });
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM integration_gateway.runtime_adapter_identity WHERE attempt_id=$1',
              [attemptRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
      }
      const restartedDriver = new LocalSyntheticRuntimeDriver();
      const restartedEntry = createControlledFirstRunEntry({
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb,
        identity: { db: identityDb, repo: identityRepo, crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(tePool).withPlugin(queryProbe),
        runtimeDriver: restartedDriver,
        receiptStorage: new InMemoryRenderObjectStorage(),
        capabilityCodes: firstRunCodes,
        ...(bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: recoveryCodes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(clock),
      });
      expect(
        await restartedEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
      ).toEqual(finalView);
      expect(restartedDriver.invokedAttemptIds).toEqual([]);
      expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
      if (terminalScenario === 'RECOVERY_EXPIRE') {
        const progressPayload = {
          runRef,
          attemptRef,
          sourceRef: finalView.observationRef,
          policyRef: controlsRef,
          runVersion: '2',
        } as unknown as CanonicalJsonObject;
        const progressCreation = await progressAuthorization(progressPayload);
        const observationHash = record(record(finalView.observationRef).contentHash).digest;
        if (typeof observationHash !== 'string') throw new Error('missing final observation Hash');
        expect(
          await createControlledFinalProgress(
            guardedTeDb,
            progressCreation.context,
            scanContext,
            progressEnvelope(
              progressCreation.context,
              controlledFinalProcessId(runRef.objectId),
              progressPayload,
              `controlled-final:create:${runRef.objectId}:${observationHash}`,
            ),
            () => new Date(clock),
            progressCreation.proof,
            scanProof,
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        const resultBody = record(finalView.agentResultContract);
        const resultTarget = objectRef(
          'execution.agent_result',
          String(resultBody.agentResultId),
          scope(),
        ) as Common.ObjectRef;
        const submitted = await restartedEntry.submitAgentResult(
          await firstRunEnvelope(
            'execution.submit_agent_result',
            resultTarget,
            {
              agentResultContract: resultBody,
              runFencingToken: 1,
              runtimeSubmissionRef: finalView.runtimeSubmissionRef,
            } as unknown as CanonicalJsonObject,
            service,
          ),
          sessionFor(service),
        );
        expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'COMMITTED' });
        const resultRef = record(committedPayload(submitted as CommandResult))
          .agentResultRef as Common.ContentAddressedRef;
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        await expect(
          restartedEntry.recordRunResult(
            await firstRunEnvelope(
              'execution.record_run_result',
              runRef,
              { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
              service,
              2,
            ),
            sessionFor(service),
          ),
        ).rejects.toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
        expect(
          await restartedEntry.expireRun(
            await firstRunEnvelope(
              'execution.expire_run',
              runRef,
              { reason: 'DEADLINE_EXCEEDED' },
              service,
              2,
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        expect(
          await restartedEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              runRef,
              { runRef } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'TIMED_OUT', terminationReason: 'EXECUTION_DEADLINE_EXCEEDED' });
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'EXPIRED' }]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE result_id=$1',
              [resultTarget.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        const readExpiredRun = async (currentRunRef: CanonicalJsonObject) =>
          restartedEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              currentRunRef as unknown as Common.ObjectRef,
              { runRef: currentRunRef },
              'runStateReadV1',
            ),
            sessionFor(service),
          );
        expect(
          await recoverControlledFinalRuns(teDb, scanContext, {
            now: () => new Date(clock),
            revalidateScan: scanProof,
            readFinal: () => Promise.reject(new Error('timed-out Process must not query IG')),
            readRun: async (currentRunRef) => {
              const state = await readExpiredRun(currentRunRef);
              return state;
            },
            readPolicy: () => Promise.reject(new Error('timed-out Process must not read Policy')),
            listProgress: () =>
              listControlledFinalProgress(
                guardedTeDb,
                progressListAuthorization.context,
                progressListAuthorization.proof,
              ),
            createProgress: () =>
              Promise.reject(new Error('timed-out Process must not be recreated')),
            advanceProgress: () =>
              Promise.reject(new Error('timed-out Process must not advance owning steps')),
            suspendTimedOutProgress: async (progress) => {
              const payload = {
                runRef: progress.runRef,
                sourceRef: progress.sourceRef,
                step: progress.step,
                observedStatus: 'TIMED_OUT',
              } as CanonicalJsonObject;
              const authorized = await progressAuthorization(payload);
              expect(
                await suspendTimedOutControlledFinalProgress(
                  teDb,
                  authorized.context,
                  progressEnvelope(
                    authorized.context,
                    progress.processId,
                    payload,
                    `controlled-final:suspend:${progress.processId}:${progress.aggregateVersion}`,
                    progress.aggregateVersion,
                  ),
                  progress,
                  async (currentRunRef) => (await readExpiredRun(currentRunRef)).status,
                  authorized.proof,
                ),
              ).toMatchObject({ status: 'COMMITTED' });
            },
            execute: () => Promise.reject(new Error('timed-out Process must not execute')),
          }),
        ).toBe(0);
        expect(
          (
            await admin.query<{ state: string; blocked_reason_code: string }>(
              'SELECT state,blocked_reason_code FROM task_execution.process_instance WHERE process_id=$1',
              [controlledFinalProcessId(runRef.objectId)],
            )
          ).rows,
        ).toEqual([{ state: 'SUSPENDED', blocked_reason_code: 'RUN_TIMED_OUT' }]);
        return;
      }
      if (
        terminalScenario === 'RECOVERY' ||
        terminalScenario === 'RECOVERY_WORKER' ||
        terminalScenario === 'RECOVERY_MULTIPLE'
      ) {
        const executed: string[] = [];
        const committedKeys = new Map<string, string>();
        let failedKey: string | undefined;
        let failedBeforeSubmitKey: string | undefined;
        let failBeforeSubmit = terminalScenario === 'RECOVERY';
        const crashAfterStep = new Set<ControlledFinalProgressAdvance['expectedStep']>(
          terminalScenario === 'RECOVERY'
            ? ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE']
            : [],
        );
        const recoveryPorts = {
          now: () => new Date(clock),
          revalidateScan: scanProof,
          readFinal: async (originalAttemptRef: CanonicalJsonObject) =>
            (await restartedEntry.getRuntimeFinalObservation(
              await firstRunQuery(
                'integration.get_runtime_final_observation',
                originalAttemptRef as unknown as Common.ObjectRef,
                { attemptRef: originalAttemptRef },
                'runtimeFinalReadV1',
              ),
              sessionFor(service),
            )) as unknown as CanonicalJsonObject,
          readRun: async (currentRunRef: CanonicalJsonObject) =>
            (await restartedEntry.getRunState(
              await firstRunQuery(
                'execution.get_run_state',
                currentRunRef as unknown as Common.ObjectRef,
                { runRef: currentRunRef },
                'runStateReadV1',
              ),
              sessionFor(service),
            )) as {
              status: string;
              aggregateVersion: number;
              currentFencingToken: number;
              workOrderRef: CanonicalJsonObject;
            },
          readPolicy: async (currentWorkOrderRef: CanonicalJsonObject) => {
            expect(currentWorkOrderRef).toEqual(workOrderRef);
            const payload = { workOrderRef: currentWorkOrderRef } as CanonicalJsonObject;
            const payloadHash = digestCanonicalPayload(payload).hash;
            const signed = await auth.authorizeWorkOrderContractRead(
              identityDeps([fixture.projectId], service),
              {
                actorSnapshotRef: service.actorRef,
                commandType: 'execution.get_work_order_contract',
                commandVersion: '1.0',
                commandPayloadHash: payloadHash,
                authenticationContextHash: AUTH_HASH,
                targetRef: currentWorkOrderRef as unknown as Common.ObjectRef,
              },
            );
            expect(signed.outcome).toBe('ALLOW');
            if (
              signed.outcome !== 'ALLOW' ||
              signed.authorizationDecisionRef === undefined ||
              signed.expiresAt === undefined
            )
              throw new Error('Contract read denied');
            const decisionRef = signed.authorizationDecisionRef;
            const proof = async () => {
              const validity = await auth.revalidateWorkOrderContractRead(
                identityDeps([fixture.projectId], service),
                {
                  decisionRef,
                  expectedCommandType: 'execution.get_work_order_contract',
                  expectedCommandVersion: '1.0',
                  expectedCommandPayloadHash: payloadHash,
                  expectedAuthenticationContextHash: AUTH_HASH,
                  expectedTargetRef: currentWorkOrderRef as unknown as Common.ObjectRef,
                },
              );
              expect(validity.valid).toBe(true);
            };
            const context = {
              ...runnerContext(service),
              authorizationDecisionId: signed.authorizationDecisionRef.objectId,
              authorizationDecisionHash: Buffer.from(
                signed.authorizationDecisionRef.contentHash.digest,
                'hex',
              ),
              authorizationDecisionExpiresAt: new Date(signed.expiresAt),
            };
            const view = await handleGetWorkOrderContract(
              teDb,
              context,
              currentWorkOrderRef,
              proof,
            );
            return record(record(view.workOrderContract).executionPolicy)
              .leasePolicyRef as CanonicalJsonObject;
          },
          listProgress: () =>
            listControlledFinalProgress(
              guardedTeDb,
              progressListAuthorization.context,
              progressListAuthorization.proof,
            ),
          createProgress: async (input: {
            runRef: CanonicalJsonObject;
            attemptRef: CanonicalJsonObject;
            sourceRef: CanonicalJsonObject;
            policyRef: CanonicalJsonObject;
            runVersion: string;
          }) => {
            const payload = input as unknown as CanonicalJsonObject;
            const authorized = await progressAuthorization(payload);
            const runId = input.runRef.objectId;
            const sourceHash = record(input.sourceRef.contentHash).digest;
            if (typeof runId !== 'string' || typeof sourceHash !== 'string')
              throw new Error('invalid controlled final source');
            const processId = controlledFinalProcessId(runId);
            const outcome = await createControlledFinalProgress(
              guardedTeDb,
              authorized.context,
              scanContext,
              progressEnvelope(
                authorized.context,
                processId,
                payload,
                `controlled-final:create:${runId}:${sourceHash}`,
              ),
              () => new Date(clock),
              authorized.proof,
              scanProof,
            );
            expect(outcome.status).toBe('COMMITTED');
          },
          advanceProgress: async (
            progress: ControlledFinalProgress,
            transition: ControlledFinalProgressAdvance,
          ) => {
            if (crashAfterStep.delete(transition.expectedStep))
              throw new Error(
                `injected crash after ${transition.expectedStep} commit before Process progress`,
              );
            const payload = transition as unknown as CanonicalJsonObject;
            const authorized = await progressAuthorization(payload);
            const outcome = await advanceControlledFinalProgress(
              guardedTeDb,
              authorized.context,
              progressEnvelope(
                authorized.context,
                progress.processId,
                payload,
                `controlled-final:progress:${progress.processId}:${transition.expectedStep}:${transition.stableIdempotencyKey}`,
                progress.aggregateVersion,
              ),
              transition,
              authorized.proof,
            );
            expect(outcome.status).toBe('COMMITTED');
          },
          suspendTimedOutProgress: async (progress: ControlledFinalProgress) => {
            const payload = {
              runRef: progress.runRef,
              sourceRef: progress.sourceRef,
              step: progress.step,
              observedStatus: 'TIMED_OUT',
            } as CanonicalJsonObject;
            const authorized = await progressAuthorization(payload);
            const outcome = await suspendTimedOutControlledFinalProgress(
              teDb,
              authorized.context,
              progressEnvelope(
                authorized.context,
                progress.processId,
                payload,
                `controlled-final:suspend:${progress.processId}:${progress.aggregateVersion}`,
                progress.aggregateVersion,
              ),
              progress,
              async (currentRunRef) => {
                const state = await recoveryPorts.readRun(currentRunRef);
                return state.status;
              },
              authorized.proof,
            );
            expect(outcome.status).toBe('COMMITTED');
          },
          execute: async (next: ControlledFinalRecoveryCommand) => {
            if (next.commandType === 'execution.submit_agent_result' && failBeforeSubmit) {
              failBeforeSubmit = false;
              failedBeforeSubmitKey = next.idempotencyKey;
              throw new Error('injected TE handoff outage before submit');
            }
            const envelope = {
              ...(await firstRunEnvelope(
                next.commandType,
                next.targetRef as unknown as Common.ObjectRef,
                next.payload,
                service,
                next.expectedAggregateVersion,
              )),
              idempotencyKey: next.idempotencyKey,
            };
            let outcome: {
              status: string;
              originalOutcome?: string;
              resultPayload?: CanonicalJsonObject | null;
            };
            switch (next.commandType) {
              case 'execution.submit_agent_result':
                outcome = await restartedEntry.submitAgentResult(envelope, sessionFor(service));
                break;
              case 'execution.record_run_result':
                outcome = await restartedEntry.recordRunResult(envelope, sessionFor(service));
                break;
              case 'execution.validate_agent_result':
                outcome = await restartedEntry.validateAgentResult(envelope, sessionFor(service));
                break;
              case 'execution.accept_agent_result':
                failedKey = next.idempotencyKey;
                outcome = await restartedEntry.acceptAgentResult(envelope, sessionFor(service));
                break;
              case 'execution.finalize_run_from_acceptance':
                failedKey = next.idempotencyKey;
                outcome = await restartedEntry.finalizeRun(envelope, sessionFor(service));
                break;
            }
            committedKeys.set(next.commandType, next.idempotencyKey);
            executed.push(next.commandType);
            return outcome;
          },
        };
        if (terminalScenario === 'RECOVERY_MULTIPLE') {
          await recoveryPorts.createProgress({
            runRef: runRef as unknown as CanonicalJsonObject,
            attemptRef: attemptRef as unknown as CanonicalJsonObject,
            sourceRef: finalView.observationRef as unknown as CanonicalJsonObject,
            policyRef: controlsRef as unknown as CanonicalJsonObject,
            runVersion: '2',
          });
          const resultId = record(finalView.agentResultContract).agentResultId;
          if (typeof resultId !== 'string' || observeRecovery === undefined)
            throw new Error('missing multiple Process observer');
          await observeRecovery({
            runRef,
            attemptRef,
            workOrderRef,
            resultId,
            scanContext,
            ports: recoveryPorts,
            driver: runtimeDriver,
          });
          return;
        }
        if (terminalScenario === 'RECOVERY_WORKER') {
          const errors: unknown[] = [];
          const worker = createControlledFinalRecoveryWorker({
            taskExecutionDb: guardedTeDb,
            projects: [{ scanContext, ports: recoveryPorts }],
            intervalMs: 10,
            maxStepsPerProject: 1,
            onError: (error) => {
              errors.push(error);
            },
          });
          worker.start();
          try {
            const until = Date.now() + 90_000;
            let status = '';
            while (Date.now() < until) {
              const current = await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.run WHERE run_id=$1',
                [runRef.objectId],
              );
              status = current.rows[0]?.status ?? '';
              if (status === 'SUCCEEDED') break;
              await new Promise<void>((resolve) => setTimeout(resolve, 25));
            }
            expect(status).toBe('SUCCEEDED');
          } finally {
            await worker.stop();
          }
          expect(errors).toEqual([]);
          expect(executed).toEqual([
            'execution.submit_agent_result',
            'execution.record_run_result',
            'execution.validate_agent_result',
            'execution.accept_agent_result',
            'execution.finalize_run_from_acceptance',
          ]);
          expect(
            (
              await admin.query<{ count: string }>(
                'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
                [controlledFinalProcessId(runRef.objectId)],
              )
            ).rows,
          ).toEqual([{ count: '5' }]);
          expect(await recoveryPorts.listProgress()).toEqual([]);
          expect(restartedDriver.invokedAttemptIds).toEqual([]);
          return;
        }
        const progressGrantId = firstRunGrants.get('runFinalProcessProgressV1');
        const progressBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
          (binding) => binding.boundary === 'runFinalProcessProgressV1',
        );
        if (progressGrantId === undefined || progressBinding === undefined)
          throw new Error('missing final Process progress Grant');
        expect(
          await revokeCapabilityTracked(identityDeps([fixture.projectId], service), {
            targetId: progressGrantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_FINAL_PROGRESS',
            effectiveAt: new Date(clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        queryReads.length = 0;
        queryWrites.length = 0;
        await expect(
          recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
        ).rejects.toBeDefined();
        expect(protectedReads(), 'progress Grant revoked').toEqual([]);
        expect(queryWrites, 'progress Grant revoked writes').toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              "SELECT count(*)::text FROM task_execution.process_instance WHERE process_type='controlled-final@1' AND correlation_key=$1",
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        await grant({
          principal: service,
          capabilityCode: firstRunCodes.runFinalProcessProgressV1,
          action: progressBinding.requiredGrantAction,
          selectorType: progressBinding.selectorType,
          targetObjectType: 'zhiju.project.project',
        });
        progressListAuthorization = await progressAuthorization(progressListPayload);
        await expect(
          recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
        ).rejects.toThrow('injected TE handoff outage before submit');
        expect(failedBeforeSubmitKey).toBeDefined();
        expect(await receiptRows(failedBeforeSubmitKey ?? '')).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
        await expect(
          recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
        ).rejects.toThrow('injected crash after SUBMIT commit before Process progress');
        const submittedKey = committedKeys.get('execution.submit_agent_result');
        if (submittedKey === undefined) throw new Error('missing committed submit key');
        expect(submittedKey).toBe(failedBeforeSubmitKey);
        expect(await receiptRows(submittedKey)).toHaveLength(1);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
        expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
              [controlledFinalProcessId(runRef.objectId)],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        const pendingProgress = (await recoveryPorts.listProgress())[0];
        if (pendingProgress === undefined) throw new Error('missing pending final Process');
        const forgedSource = structuredClone(pendingProgress.sourceRef);
        record(forgedSource.contentHash).digest = '0'.repeat(64);
        const forgedSourceId = forgedSource.objectId;
        const forgedSourceHash = record(forgedSource.contentHash).digest;
        if (typeof forgedSourceId !== 'string' || typeof forgedSourceHash !== 'string')
          throw new Error('invalid forged source Ref');
        const forgedTransition: ControlledFinalProgressAdvance = {
          expectedStep: 'SUBMIT',
          nextStep: 'RECORD',
          sourceFactRef: forgedSource,
          stableIdempotencyKey: `controlled-final:${forgedSourceId}:${forgedSourceHash}:submit`,
          issuedCommandType: 'execution.submit_agent_result',
          resultRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'execution.agent_result',
            objectId: record(finalView.agentResultContract).agentResultId,
            scope: scope(),
            contentHash: contentHash(
              hashContractPayload(record(finalView.agentResultContract) as CanonicalJsonObject),
            ),
          } as unknown as CanonicalJsonObject,
        };
        const forgedPayload = forgedTransition as unknown as CanonicalJsonObject;
        const forgedAuthorization = await progressAuthorization(forgedPayload);
        await expect(
          advanceControlledFinalProgress(
            guardedTeDb,
            forgedAuthorization.context,
            progressEnvelope(
              forgedAuthorization.context,
              pendingProgress.processId,
              forgedPayload,
              `controlled-final:forged:${newUuidV7()}`,
              pendingProgress.aggregateVersion,
            ),
            forgedTransition,
            forgedAuthorization.proof,
          ),
        ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
        expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
        const sourceId = pendingProgress.sourceRef.objectId;
        const sourceHash = record(pendingProgress.sourceRef.contentHash).digest;
        if (typeof sourceId !== 'string' || typeof sourceHash !== 'string')
          throw new Error('invalid Process source Ref');
        const validTransition: ControlledFinalProgressAdvance = {
          ...forgedTransition,
          sourceFactRef: pendingProgress.sourceRef,
          stableIdempotencyKey: `controlled-final:${sourceId}:${sourceHash}:submit`,
        };
        const substitutedSourceId = newUuidV7();
        for (const [processId, transition, version] of [
          [newUuidV7(), validTransition, pendingProgress.aggregateVersion],
          [
            pendingProgress.processId,
            {
              ...validTransition,
              expectedStep: 'RECORD',
              nextStep: 'VALIDATE',
              issuedCommandType: 'execution.record_run_result',
              stableIdempotencyKey: `controlled-final:${sourceId}:${sourceHash}:record`,
            },
            pendingProgress.aggregateVersion,
          ],
          [
            pendingProgress.processId,
            validTransition,
            String(Number(pendingProgress.aggregateVersion) + 1),
          ],
          [
            pendingProgress.processId,
            {
              ...validTransition,
              sourceFactRef: {
                ...pendingProgress.sourceRef,
                objectId: substitutedSourceId,
              },
              stableIdempotencyKey: `controlled-final:${substitutedSourceId}:${sourceHash}:submit`,
            },
            pendingProgress.aggregateVersion,
          ],
          [
            pendingProgress.processId,
            {
              ...validTransition,
              sourceFactRef: {
                ...pendingProgress.sourceRef,
                scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
              },
            },
            pendingProgress.aggregateVersion,
          ],
        ] as const) {
          const invalidTransition = transition;
          const invalidPayload = invalidTransition as unknown as CanonicalJsonObject;
          const authorized = await progressAuthorization(invalidPayload);
          await expect(
            advanceControlledFinalProgress(
              guardedTeDb,
              authorized.context,
              progressEnvelope(
                authorized.context,
                processId,
                invalidPayload,
                `controlled-final:invalid:${newUuidV7()}`,
                version,
              ),
              invalidTransition,
              authorized.proof,
            ),
          ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
        }
        expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual(['SUBMIT']);
        const recoverySteps = ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE'] as const;
        const recoveryCommands = [
          'execution.submit_agent_result',
          'execution.record_run_result',
          'execution.validate_agent_result',
          'execution.accept_agent_result',
          'execution.finalize_run_from_acceptance',
        ] as const;
        for (let step = 0; step < 5; step += 1) {
          if (step === 3) {
            const resultId = String(record(finalView.agentResultContract).agentResultId);
            await admin.query(`
              CREATE OR REPLACE FUNCTION task_execution.wi224_fail_accept_event() RETURNS trigger
              LANGUAGE plpgsql AS $$ BEGIN
                IF NEW.event_type = 'execution.AgentResultAccepted'
                   AND NEW.aggregate_id = '${resultId}'::uuid THEN
                  RAISE EXCEPTION 'injected acceptance outbox failure';
                END IF;
                RETURN NEW;
              END $$`);
            await admin.query(`
              CREATE TRIGGER wi224_fail_accept_event BEFORE INSERT ON task_execution.outbox_event
              FOR EACH ROW EXECUTE FUNCTION task_execution.wi224_fail_accept_event()`);
            try {
              await expect(
                recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
              ).rejects.toBeDefined();
            } finally {
              await admin.query(
                'DROP TRIGGER wi224_fail_accept_event ON task_execution.outbox_event',
              );
              await admin.query('DROP FUNCTION task_execution.wi224_fail_accept_event()');
            }
            expect(failedKey).toBeDefined();
            expect(await receiptRows(failedKey ?? '')).toEqual([]);
            expect(
              (
                await admin.query<{ count: string }>(
                  'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE result_id=$1',
                  [resultId],
                )
              ).rows,
            ).toEqual([{ count: '0' }]);
            expect(
              (
                await admin.query<{ count: string }>(
                  "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.AgentResultAccepted'",
                  [resultId],
                )
              ).rows,
            ).toEqual([{ count: '0' }]);
          }
          if (step === 4) {
            const runId = runRef.objectId;
            await admin.query(`
              CREATE OR REPLACE FUNCTION task_execution.wi224_fail_terminal_event() RETURNS trigger
              LANGUAGE plpgsql AS $$ BEGIN
                IF NEW.event_type = 'execution.RunTerminated'
                   AND NEW.aggregate_id = '${runId}'::uuid THEN
                  RAISE EXCEPTION 'injected terminal outbox failure';
                END IF;
                RETURN NEW;
              END $$`);
            await admin.query(`
              CREATE TRIGGER wi224_fail_terminal_event BEFORE INSERT ON task_execution.outbox_event
              FOR EACH ROW EXECUTE FUNCTION task_execution.wi224_fail_terminal_event()`);
            try {
              await expect(
                recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
              ).rejects.toBeDefined();
            } finally {
              await admin.query(
                'DROP TRIGGER wi224_fail_terminal_event ON task_execution.outbox_event',
              );
              await admin.query('DROP FUNCTION task_execution.wi224_fail_terminal_event()');
            }
            expect(failedKey).toBeDefined();
            expect(await receiptRows(failedKey ?? '')).toEqual([]);
            expect(
              (
                await admin.query<{ status: string }>(
                  'SELECT status FROM task_execution.run WHERE run_id=$1',
                  [runId],
                )
              ).rows,
            ).toEqual([{ status: 'RESULT_RECORDED' }]);
            expect(
              (
                await admin.query<{ status: string }>(
                  'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                  [runId],
                )
              ).rows,
            ).toEqual([{ status: 'ACTIVE' }]);
            expect(
              (
                await admin.query<{ count: string }>(
                  "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
                  [runId],
                )
              ).rows,
            ).toEqual([{ count: '0' }]);
          }
          if (step > 0) {
            const currentStep = recoverySteps[step];
            const commandType = recoveryCommands[step];
            if (currentStep === undefined || commandType === undefined)
              throw new Error('missing recovery step');
            await expect(
              recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1),
            ).rejects.toThrow(`injected crash after ${currentStep} commit before Process progress`);
            const committedKey = committedKeys.get(commandType);
            if (committedKey === undefined) throw new Error('missing committed recovery key');
            expect(await receiptRows(committedKey)).toHaveLength(1);
            expect((await recoveryPorts.listProgress()).map((row) => row.step)).toEqual([
              currentStep,
            ]);
            expect(
              (
                await admin.query<{ count: string }>(
                  'SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1',
                  [controlledFinalProcessId(runRef.objectId)],
                )
              ).rows,
            ).toEqual([{ count: String(step) }]);
          }
          const advanced = await recoverControlledFinalRuns(teDb, scanContext, recoveryPorts, 1);
          expect(advanced).toBe(1);
        }
        expect(executed).toEqual(
          recoveryCommands.flatMap((commandType) => [commandType, commandType]),
        );
        expect(
          await recoverControlledFinalRuns(teDb, scanContext, {
            ...recoveryPorts,
            readFinal: () => Promise.reject(new Error('terminal Run must not query IG')),
            execute: () => Promise.reject(new Error('terminal Run must not execute')),
          }),
        ).toBe(0);
        expect(
          await restartedEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              runRef,
              { runRef } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'SUCCEEDED' });
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'RELEASED' }]);
        expect(
          (
            await admin.query<{ event_type: string; count: string }>(
              "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id IN ($1,$2) AND event_type IN ('execution.AgentResultAccepted','execution.RunTerminated') GROUP BY event_type ORDER BY event_type",
              [runRef.objectId, record(finalView.agentResultContract).agentResultId],
            )
          ).rows,
        ).toEqual([
          { event_type: 'execution.AgentResultAccepted', count: '1' },
          { event_type: 'execution.RunTerminated', count: '1' },
        ]);
        expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
        expect(restartedDriver.invokedAttemptIds).toEqual([]);
        return;
      }
      const resultBody = record(finalView.agentResultContract);
      const resultTarget = objectRef(
        'execution.agent_result',
        String(resultBody.agentResultId),
        scope(),
      ) as Common.ObjectRef;
      phase('Result submit boundary');
      let submitEnvelope = await firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: resultBody,
          runFencingToken: 1,
          runtimeSubmissionRef: finalView.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        service,
      );
      if (exercisePreparationMatrix) {
        const wrongSubmission = await firstRunEnvelope(
          'execution.submit_agent_result',
          resultTarget,
          {
            agentResultContract: resultBody,
            runFencingToken: 1,
            runtimeSubmissionRef: {
              ...finalView.runtimeSubmissionRef,
              externalId: newUuidV7(),
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(wrongSubmission, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (exercisePreparationMatrix) {
        const alteredCases: readonly (readonly [
          string,
          (body: Record<string, unknown>) => void,
        ])[] = [
          [
            'Run Ref',
            (body) => {
              body.runRef = { ...record(body.runRef), objectId: newUuidV7() };
            },
          ],
          [
            'WorkOrder Ref',
            (body) => {
              body.workOrderRef = { ...record(body.workOrderRef), objectId: newUuidV7() };
            },
          ],
          [
            'Task Ref',
            (body) => {
              body.taskRef = { ...record(body.taskRef), objectId: newUuidV7() };
            },
          ],
          [
            'Project Ref',
            (body) => {
              body.projectRef = { ...record(body.projectRef), objectId: newUuidV7() };
            },
          ],
          [
            'Adapter identity Ref',
            (body) => {
              body.submittedByRuntime = {
                ...record(body.submittedByRuntime),
                objectId: newUuidV7(),
              };
            },
          ],
          [
            'Attempt Ref as Adapter identity',
            (body) => {
              body.submittedByRuntime = attemptRef;
            },
          ],
          [
            'static Adapter selector as instance identity',
            (body) => {
              body.submittedByRuntime = record(revised.versionPins).runtimeAdapterContractRef;
            },
          ],
          [
            'Context Ref',
            (body) => {
              const provenance = record(body.provenance);
              provenance.contextSnapshotRef = {
                ...record(provenance.contextSnapshotRef),
                objectId: newUuidV7(),
              };
            },
          ],
          [
            'Bundle Ref',
            (body) => {
              const provenance = record(body.provenance);
              provenance.capabilityGrantRef = {
                ...record(provenance.capabilityGrantRef),
                objectId: newUuidV7(),
              };
            },
          ],
          [
            'runtime session Ref',
            (body) => {
              const provenance = record(body.provenance);
              provenance.runtimeSessionExternalRef = {
                ...record(provenance.runtimeSessionExternalRef),
                externalId: newUuidV7(),
              };
            },
          ],
          [
            'Header Scope',
            (body) => {
              const header = record(body.header);
              header.scopeRef = { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() };
            },
          ],
        ];
        for (const [label, mutate] of alteredCases) {
          const altered = structuredClone(resultBody);
          mutate(altered);
          record(altered.header).payloadHash = contentHash(
            hashContractPayload(altered as unknown as CanonicalJsonObject),
          );
          const invalidSubmit = await firstRunEnvelope(
            'execution.submit_agent_result',
            resultTarget,
            {
              agentResultContract: altered,
              runFencingToken: 1,
              runtimeSubmissionRef: finalView.runtimeSubmissionRef,
            } as unknown as CanonicalJsonObject,
            service,
          );
          await expect(
            firstRunEntry.submitAgentResult(invalidSubmit, sessionFor(service)),
            label,
          ).rejects.toBeDefined();
          expect(await receiptRows(invalidSubmit.idempotencyKey), label).toEqual([]);
        }
        const wrongFencing = await firstRunEnvelope(
          'execution.submit_agent_result',
          resultTarget,
          {
            agentResultContract: resultBody,
            runFencingToken: 2,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(wrongFencing, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(wrongFencing.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (exercisePreparationMatrix || terminalScenario === 'LOCK_DEADLINE') {
        const submitGrantId = firstRunGrants.get('agentResultSubmitV1');
        const submitBinding = CONTROLLED_FIRST_RUN_BINDINGS.find(
          (binding) => binding.boundary === 'agentResultSubmitV1',
        );
        if (submitGrantId === undefined || submitBinding === undefined)
          throw new Error('missing Result submit Grant');
        const runBlocker = new pg.Client({ connectionString: databaseUrl });
        await runBlocker.connect();
        let pendingSubmit: Promise<unknown> | undefined;
        try {
          await runBlocker.query('BEGIN');
          await runBlocker.query(
            'SELECT run_id FROM task_execution.run WHERE run_id=$1 FOR UPDATE',
            [runRef.objectId],
          );
          pendingSubmit = firstRunEntry
            .submitAgentResult(submitEnvelope, sessionFor(service))
            .catch((error: unknown) => error);
          await expect
            .poll(
              async () =>
                (
                  await admin.query<{ n: number }>(
                    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%run%'",
                  )
                ).rows[0]?.n ?? 0,
              { timeout: 10_000 },
            )
            .toBeGreaterThan(0);
          if (terminalScenario === 'LOCK_DEADLINE') {
            const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
            if (deadlineWait > 0)
              await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
            clock = Date.now();
            await runBlocker.query('ROLLBACK');
            expect(await pendingSubmit).toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
          } else {
            expect(
              await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
                targetId: submitGrantId,
                expectedAggregateVersion: '1',
                scope: {
                  scopeKind: 'PROJECT',
                  enterpriseId: fixture.enterpriseId,
                  projectId: fixture.projectId,
                },
                reasonCode: 'WI224_REVOKE_RESULT_SUBMIT_DURING_LOCK',
                effectiveAt: new Date(clock),
                idempotencyKey: newUuidV7(),
              }),
            ).toMatchObject({ status: 'COMMITTED' });
            await runBlocker.query('ROLLBACK');
            expect(await pendingSubmit).toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          }
        } finally {
          await runBlocker.query('ROLLBACK');
          await runBlocker.end();
          await pendingSubmit;
        }
        expect(await receiptRows(submitEnvelope.idempotencyKey)).toEqual([]);
        if (terminalScenario === 'LOCK_DEADLINE') {
          expect(
            (
              await admin.query<{ count: string }>(
                'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ count: '0' }]);
          const expired = await firstRunEntry.expireRun(
            await firstRunEnvelope(
              'execution.expire_run',
              runRef,
              { reason: 'DEADLINE_EXCEEDED' },
              service,
              2,
            ),
            sessionFor(service),
          );
          expect(expired).toMatchObject({ status: 'COMMITTED' });
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.run WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'TIMED_OUT' }]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'EXPIRED' }]);
          return;
        }
        await grant({
          principal: service,
          capabilityCode: firstRunCodes.agentResultSubmitV1,
          action: submitBinding.requiredGrantAction,
          selectorType: submitBinding.selectorType,
          targetObjectType: 'execution.agent_result',
        });
        submitEnvelope = await firstRunEnvelope(
          'execution.submit_agent_result',
          resultTarget,
          {
            agentResultContract: resultBody,
            runFencingToken: 1,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
      }
      if (
        await finalEligibilityLoss('SUBMIT', submitEnvelope, (value) =>
          firstRunEntry.submitAgentResult(value, sessionFor(service)),
        )
      )
        return;
      await finalDependencyRefusals(submitEnvelope, (entry, value, session) =>
        entry.submitAgentResult(value, session),
      );
      await finalSqlRefusals(submitEnvelope, (value) =>
        firstRunEntry.submitAgentResult(value, sessionFor(service)),
      );
      await finalSourceReceiptRefusals(submitEnvelope, (value) =>
        firstRunEntry.submitAgentResult(value, sessionFor(service)),
      );
      await finalReceiptRollback(submitEnvelope, (value) =>
        firstRunEntry.submitAgentResult(value, sessionFor(service)),
      );
      const submitted = await restartedEntry.submitAgentResult(submitEnvelope, sessionFor(service));
      expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'COMMITTED' });
      expect(
        await scanControlledFinalCandidates(
          guardedTeDb,
          scanContext,
          () => new Date(clock),
          scanProof,
        ),
      ).toEqual([]);
      if (exercisePreparationMatrix) {
        const forgedBody = { ...resultBody, humanSummary: 'Forged final body.' };
        const forgedSubmit = await firstRunEnvelope(
          'execution.submit_agent_result',
          resultTarget,
          {
            agentResultContract: forgedBody,
            runFencingToken: 1,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          },
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(forgedSubmit, sessionFor(service)),
        ).rejects.toBeDefined();
        const alternateId = newUuidV7();
        for (const [label, body, target] of [
          [
            'same Result ID with changed content Hash',
            {
              ...forgedBody,
              header: {
                ...record(resultBody.header),
                payloadHash: contentHash(hashContractPayload(forgedBody)),
              },
            },
            resultTarget,
          ],
          [
            'different Result ID with original Hash',
            { ...resultBody, agentResultId: alternateId },
            objectRef('execution.agent_result', alternateId, scope()) as Common.ObjectRef,
          ],
        ] as const) {
          const alternateSubmit = await firstRunEnvelope(
            'execution.submit_agent_result',
            target,
            {
              agentResultContract: body,
              runFencingToken: 1,
              runtimeSubmissionRef: finalView.runtimeSubmissionRef,
            } as unknown as CanonicalJsonObject,
            service,
          );
          await expect(
            firstRunEntry.submitAgentResult(alternateSubmit, sessionFor(service)),
            label,
          ).rejects.toBeDefined();
          expect(await receiptRows(alternateSubmit.idempotencyKey), label).toEqual([]);
          expect(await auditRows(alternateSubmit.commandId), label).toEqual([
            {
              outcome: 'DENIED',
              error_code: 'EXECUTION_FINAL_CONFLICT',
              safe_summary: 'controlled final request rejected; business transaction rolled back',
            },
          ]);
        }
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
      }
      expect(
        (
          await admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      const resultRef = record(committedPayload(submitted as CommandResult))
        .agentResultRef as Common.ContentAddressedRef;
      if (exercisePreparationMatrix) {
        const resultOnlyFinalize = await firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          runRef,
          {
            acceptanceRecordRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'execution.agent_result_acceptance',
              objectId: newUuidV7(),
              scope: scope(),
              contentHash: contentHash('0'.repeat(64)),
            },
          } as unknown as CanonicalJsonObject,
          service,
          2,
        );
        await expect(
          firstRunEntry.finalizeRun(resultOnlyFinalize, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(resultOnlyFinalize.idempotencyKey)).toEqual([]);
      }
      const resultQuery = await firstRunQuery(
        'execution.get_agent_result',
        resultRef,
        { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
        'agentResultReadV1',
      );
      await expect(
        firstRunEntry.getAgentResult(resultQuery, sessionFor(service)),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const readCurrentRun = async () =>
        firstRunEntry.getRunState(
          await firstRunQuery(
            'execution.get_run_state',
            runRef,
            { runRef } as unknown as CanonicalJsonObject,
            'runStateReadV1',
          ),
          sessionFor(service),
        );
      const reservedRunView = await readCurrentRun();
      expect(reservedRunView).toMatchObject({ status: 'RUNNING', aggregateVersion: 2 });
      expect(reservedRunView).not.toHaveProperty('resultRef');
      if (bounded) {
        const barrier = await recoveryEntryRaw.read(
          await recoveryEnvelope(
            'workOrderExecutionStateReadV1',
            workOrderRef,
            { workOrderRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(barrier).toMatchObject({
          blockerRefs: [resultRef],
          informationRequestRefs: [],
          retryEligibility: 'WAITING_INPUT',
        });
        const taskBarrier = await recoveryEntryRaw.read(
          await recoveryEnvelope(
            'taskStateReadV1',
            revised.taskRef as Common.ObjectRef,
            { taskRef: revised.taskRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(taskBarrier).toMatchObject({ blockerRefs: [resultRef] });
      }

      phase('Result record boundary');
      const recordEnvelope = await firstRunEnvelope(
        'execution.record_run_result',
        runRef,
        { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
        service,
        2,
      );
      if (
        await finalEligibilityLoss('RECORD', recordEnvelope, (value) =>
          firstRunEntry.recordRunResult(value, sessionFor(service)),
        )
      )
        return;
      await finalDependencyRefusals(recordEnvelope, (entry, value, session) =>
        entry.recordRunResult(value, session),
      );
      await finalSqlRefusals(recordEnvelope, (value) =>
        firstRunEntry.recordRunResult(value, sessionFor(service)),
      );
      await finalSourceReceiptRefusals(recordEnvelope, (value) =>
        firstRunEntry.recordRunResult(value, sessionFor(service)),
      );
      await finalReceiptRollback(recordEnvelope, (value) =>
        firstRunEntry.recordRunResult(value, sessionFor(service)),
      );
      const recorded = await firstRunEntry.recordRunResult(recordEnvelope, sessionFor(service));
      expect(recorded, JSON.stringify(recorded)).toMatchObject({ status: 'COMMITTED' });
      expect(await readCurrentRun()).toMatchObject({
        status: 'RESULT_RECORDED',
        aggregateVersion: 3,
        resultRef,
      });
      await expect(
        firstRunEntry.getAgentResult(resultQuery, sessionFor(service)),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const finalEvaluator = registeredEvaluatorProfileReference(
        'im06-evaluator-static-v1',
        'te.agent_result_validation.evaluator@1.0',
      );
      expect(finalEvaluator).toBeDefined();
      const validationTarget = objectRef(
        'zhiju.execution.agent_result_validation_bundle',
        newUuidV7(),
        scope(),
      ) as Common.ObjectRef;
      phase('Result validation boundary');
      const validateEnvelope = await firstRunEnvelope(
        'execution.validate_agent_result',
        validationTarget,
        {
          agentResultRef: resultRef,
          runRef,
          runtimeAttemptRef: attemptRef,
          policyRef: controlsRef,
          evaluatorRef: finalEvaluator,
        } as unknown as CanonicalJsonObject,
        service,
      );
      if (exercisePreparationMatrix) {
        for (const [field, replacement] of [
          ['runtimeAttemptRef', objectRef('integration.runtime_attempt', newUuidV7(), scope())],
          ['policyRef', policyKey([newUuidV7(), newUuidV7()], fixture)],
          ['agentResultRef', { ...resultRef, objectId: newUuidV7() }],
          ['agentResultRef', { ...resultRef, contentHash: contentHash('0'.repeat(64)) }],
          [
            'agentResultRef',
            {
              ...resultRef,
              scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            },
          ],
          ['runRef', { ...runRef, objectId: newUuidV7() }],
          [
            'runRef',
            { ...runRef, scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() } },
          ],
          ['evaluatorRef', { ...finalEvaluator, versionId: newUuidV7() }],
        ] as const) {
          const invalidValidation = await firstRunEnvelope(
            'execution.validate_agent_result',
            objectRef(
              'zhiju.execution.agent_result_validation_bundle',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
            { ...validateEnvelope.payload, [field]: replacement } as CanonicalJsonObject,
            service,
          );
          await expect(
            firstRunEntry.validateAgentResult(invalidValidation, sessionFor(service)),
          ).rejects.toBeDefined();
        }
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.result_validation_bundle WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (
        await finalEligibilityLoss('VALIDATE', validateEnvelope, (value) =>
          firstRunEntry.validateAgentResult(value, sessionFor(service)),
        )
      )
        return;
      await finalDependencyRefusals(validateEnvelope, (entry, value, session) =>
        entry.validateAgentResult(value, session),
      );
      await finalSqlRefusals(validateEnvelope, (value) =>
        firstRunEntry.validateAgentResult(value, sessionFor(service)),
      );
      await finalSourceReceiptRefusals(validateEnvelope, (value) =>
        firstRunEntry.validateAgentResult(value, sessionFor(service)),
      );
      await finalReceiptRollback(validateEnvelope, (value) =>
        firstRunEntry.validateAgentResult(value, sessionFor(service)),
      );
      await finalValidationAtomicity(validateEnvelope);
      const validatedFinal = await firstRunEntry.validateAgentResult(
        validateEnvelope,
        sessionFor(service),
      );
      expect(validatedFinal, JSON.stringify(validatedFinal)).toMatchObject({
        status: 'COMMITTED',
      });
      expect(
        (
          await admin.query<{ judgment_kind: string; result_id: string }>(
            'SELECT judgment_kind,result_id FROM task_execution.execution_judgment WHERE judgment_id=$1',
            [validationTarget.objectId],
          )
        ).rows,
      ).toEqual([{ judgment_kind: 'RESULT_VALIDATION_BUNDLE', result_id: resultTarget.objectId }]);
      const finalValidations = record(committedPayload(validatedFinal as CommandResult));
      if (exercisePreparationMatrix) {
        const secondBundle = await firstRunEnvelope(
          'execution.validate_agent_result',
          objectRef(
            'zhiju.execution.agent_result_validation_bundle',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef,
          validateEnvelope.payload,
          service,
        );
        await expect(
          firstRunEntry.validateAgentResult(secondBundle, sessionFor(service)),
        ).rejects.toMatchObject({ code: 'EXECUTION_FINAL_CONFLICT' });
        expect(await receiptRows(secondBundle.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.result_validation_bundle WHERE result_id=$1',
              [resultTarget.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
        const absentAcceptance = await firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          runRef,
          {
            acceptanceRecordRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'execution.agent_result_acceptance',
              objectId: newUuidV7(),
              scope: scope(),
              contentHash: contentHash('0'.repeat(64)),
            },
          } as unknown as CanonicalJsonObject,
          service,
          3,
        );
        await expect(
          firstRunEntry.finalizeRun(absentAcceptance, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(absentAcceptance.idempotencyKey)).toEqual([]);
      }
      expect(await readCurrentRun()).toMatchObject({
        status: 'RESULT_RECORDED',
        aggregateVersion: 3,
        resultRef,
      });
      await expect(
        firstRunEntry.getAgentResult(resultQuery, sessionFor(service)),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      let acceptanceTarget = objectRef(
        'execution.agent_result_acceptance',
        newUuidV7(),
        scope(),
      ) as Common.ObjectRef;
      phase('Result acceptance boundary');
      let acceptEnvelope = await firstRunEnvelope(
        'execution.accept_agent_result',
        acceptanceTarget,
        {
          agentResultRef: resultRef,
          schemaValidationRef: finalValidations.schemaValidationRef,
          identityValidationRef: finalValidations.identityValidationRef,
          runBindingValidationRef: finalValidations.runBindingValidationRef,
          scopeValidationRef: finalValidations.scopeValidationRef,
          businessOutputValidationRef: finalValidations.businessOutputValidationRef,
          disposition: 'ACCEPTED',
          reasons: [],
        } as unknown as CanonicalJsonObject,
        service,
      );
      if (terminalScenario === 'VALIDATION_EXPIRED') {
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        await expect(
          firstRunEntry.acceptAgentResult(acceptEnvelope, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(acceptEnvelope.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
        const expiredValidationRun = await firstRunEntry.expireRun(
          await firstRunEnvelope(
            'execution.expire_run',
            runRef,
            { reason: 'DEADLINE_EXCEEDED' },
            service,
            3,
          ),
          sessionFor(service),
        );
        expect(expiredValidationRun).toMatchObject({ status: 'COMMITTED' });
        return;
      }
      if (exercisePreparationMatrix) {
        const original = acceptEnvelope.payload;
        for (const [field, replacement] of [
          [
            'schemaValidationRef',
            {
              ...record(original.schemaValidationRef),
              objectId: newUuidV7(),
            },
          ],
          [
            'identityValidationRef',
            {
              ...record(original.identityValidationRef),
              contentHash: contentHash(sha256CanonicalJson({ forged: true })),
            },
          ],
          [
            'schemaValidationRef',
            {
              ...record(original.schemaValidationRef),
              scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            },
          ],
          [
            'businessOutputValidationRef',
            {
              ...record(original.businessOutputValidationRef),
              objectId: newUuidV7(),
            },
          ],
          [
            'runBindingValidationRef',
            { ...record(original.runBindingValidationRef), objectId: newUuidV7() },
          ],
          ['scopeValidationRef', { ...record(original.scopeValidationRef), objectId: newUuidV7() }],
          ['schemaValidationRef', original.identityValidationRef],
          ['identityValidationRef', original.runBindingValidationRef],
          ['runBindingValidationRef', original.scopeValidationRef],
          ['scopeValidationRef', original.businessOutputValidationRef],
          ['businessOutputValidationRef', original.schemaValidationRef],
          ['agentResultRef', { ...resultRef, objectId: newUuidV7() }],
          ['disposition', 'REJECTED'],
          ['disposition', 'QUARANTINED'],
        ] as const) {
          const invalidAcceptance = await firstRunEnvelope(
            'execution.accept_agent_result',
            objectRef(
              'execution.agent_result_acceptance',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
            { ...original, [field]: replacement } as CanonicalJsonObject,
            service,
          );
          await expect(
            firstRunEntry.acceptAgentResult(invalidAcceptance, sessionFor(service)),
          ).rejects.toBeDefined();
        }
        const selfReportedAcceptance = await firstRunEnvelope(
          'execution.accept_agent_result',
          objectRef('execution.agent_result_acceptance', newUuidV7(), scope()) as Common.ObjectRef,
          { ...original, valid: true },
          service,
        );
        await expect(
          firstRunEntry.acceptAgentResult(selfReportedAcceptance, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(selfReportedAcceptance.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      if (
        await finalEligibilityLoss('ACCEPT', acceptEnvelope, (value) =>
          firstRunEntry.acceptAgentResult(value, sessionFor(service)),
        )
      )
        return;
      await finalDependencyRefusals(acceptEnvelope, (entry, value, session) =>
        entry.acceptAgentResult(value, session),
      );
      await finalSqlRefusals(acceptEnvelope, (value) =>
        firstRunEntry.acceptAgentResult(value, sessionFor(service)),
      );
      await finalSourceReceiptRefusals(acceptEnvelope, (value) =>
        firstRunEntry.acceptAgentResult(value, sessionFor(service)),
      );
      await finalReceiptRollback(acceptEnvelope, (value) =>
        firstRunEntry.acceptAgentResult(value, sessionFor(service)),
      );
      if (positiveFinalScenario && foreignValidations !== undefined) {
        for (const field of [
          'schemaValidationRef',
          'identityValidationRef',
          'runBindingValidationRef',
          'scopeValidationRef',
          'businessOutputValidationRef',
        ] as const) {
          const foreignRef = foreignValidations[field];
          if (foreignRef === undefined) throw new Error(`missing owning ${field}`);
          const mixed = await firstRunEnvelope(
            'execution.accept_agent_result',
            objectRef(
              'execution.agent_result_acceptance',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
            { ...acceptEnvelope.payload, [field]: foreignRef },
            service,
          );
          await expect(
            firstRunEntry.acceptAgentResult(mixed, sessionFor(service)),
            field,
          ).rejects.toBeDefined();
          expect(await receiptRows(mixed.idempotencyKey), field).toEqual([]);
        }
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
      let accepted: Awaited<ReturnType<typeof firstRunEntry.acceptAgentResult>>;
      if (terminalScenario === 'ACCEPT_RACE') {
        const competingTarget = objectRef(
          'execution.agent_result_acceptance',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        const competingEnvelope = await firstRunEnvelope(
          'execution.accept_agent_result',
          competingTarget,
          acceptEnvelope.payload,
          service,
        );
        const attempts = [acceptEnvelope, competingEnvelope];
        const race = await Promise.allSettled(
          attempts.map((value) => firstRunEntry.acceptAgentResult(value, sessionFor(service))),
        );
        expect(race.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
        expect(race.filter((value) => value.status === 'rejected')).toHaveLength(1);
        const winnerIndex = race.findIndex((value) => value.status === 'fulfilled');
        const winner = race[winnerIndex];
        const winnerEnvelope = attempts[winnerIndex];
        const loserEnvelope = attempts[1 - winnerIndex];
        if (
          winner?.status !== 'fulfilled' ||
          winnerEnvelope === undefined ||
          loserEnvelope === undefined
        )
          throw new Error('missing unique Acceptance race winner');
        expect(await receiptRows(loserEnvelope.idempotencyKey)).toEqual([]);
        accepted = winner.value;
        acceptanceTarget = winnerEnvelope.targetRef;
        acceptEnvelope = winnerEnvelope;
      } else {
        accepted = await firstRunEntry.acceptAgentResult(acceptEnvelope, sessionFor(service));
      }
      expect(accepted, JSON.stringify(accepted)).toMatchObject({ status: 'COMMITTED' });
      if (exercisePreparationMatrix) {
        const secondAcceptance = await firstRunEnvelope(
          'execution.accept_agent_result',
          objectRef('execution.agent_result_acceptance', newUuidV7(), scope()) as Common.ObjectRef,
          acceptEnvelope.payload,
          service,
        );
        await expect(
          firstRunEntry.acceptAgentResult(secondAcceptance, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(secondAcceptance.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query<{ count: string }>(
              'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
      }
      const acceptedView = await firstRunEntry.getAgentResult(resultQuery, sessionFor(service));
      expect(acceptedView.agentResultContract).toEqual(finalView.agentResultContract);
      expect(await readCurrentRun()).toMatchObject({
        status: 'RESULT_RECORDED',
        aggregateVersion: 3,
        resultRef,
      });
      const acceptanceRecordRef = record(
        committedPayload(accepted as CommandResult),
      ).acceptanceRecordRef;
      if (bounded) {
        // ACCEPTED alone is insufficient: the source Run has not committed terminal state.
        const proposal = record((record(resultBody).inputRequestProposals as unknown[])[0]);
        const premature = await recoveryEnvelope(
          'informationRequestOpenV1',
          objectRef('execution.information_request', newUuidV7(), scope()) as Common.ObjectRef,
          {
            definition: {
              taskRef: revised.taskRef,
              workOrderRef,
              runRef,
              requestType: proposal.requestType,
              question: proposal.question,
              reason: proposal.reason,
              expectedAnswerSpec: proposal.expectedAnswerSpec,
              blocking: true,
              requestedResponder: {
                principalKind: 'HUMAN',
                roleCode: 'project.customer_material.confirmer',
                scopeRef: scope(),
              },
              relatedRefs: [
                resultRef,
                acceptanceRecordRef,
                candidateMaterial,
                recoverySource,
                workOrderRef,
                revised.taskRef,
              ].sort((a, b) =>
                Buffer.compare(
                  Buffer.from(canonicalize(a as CanonicalJsonObject)),
                  Buffer.from(canonicalize(b as CanonicalJsonObject)),
                ),
              ),
              expiresAt: new Date(clock + 300_000).toISOString(),
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          recoveryEntryRaw.command(premature, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(String(premature.idempotencyKey))).toEqual([]);
        for (const [key, ref, payload] of [
          ['workOrderExecutionStateReadV1', workOrderRef, { workOrderRef }],
          ['taskStateReadV1', revised.taskRef, { taskRef: revised.taskRef }],
        ] as const) {
          const state = await recoveryEntryRaw.read(
            await recoveryEnvelope(
              key,
              ref as Common.ObjectRef,
              payload as unknown as CanonicalJsonObject,
              service,
              undefined,
              true,
            ),
            sessionFor(service),
          );
          expect(state).toMatchObject({ blockerRefs: [resultRef] });
          expect(record(state).status).not.toBe('COMPLETION_PENDING');
        }
        expect(
          (
            await admin.query(
              'SELECT request_id FROM task_execution.information_request WHERE work_order_id=$1',
              [woId],
            )
          ).rows,
        ).toEqual([]);
      }
      if (recoveryVariant === 'BUDGET_EXHAUSTED') {
        const createdAt = definedValue(
          (
            await admin.query<{ created_at: Date }>(
              'SELECT created_at FROM task_execution.run WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows[0],
        ).created_at;
        await waitForDeadline(
          Math.max(0, createdAt.getTime() + 29_100 - Date.now()),
          'finite Run-1 budget consumption',
        );
        clock = Date.now();
      }
      if (recoveryVariant === 'EXPIRE_SOURCE') {
        await waitForDeadline(
          Math.max(0, runDeadline.getTime() - Date.now() + 100),
          'source expiry wins',
        );
        clock = Date.now();
        const expiry = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          3,
        );
        expect(await firstRunEntryRaw.expireRun(expiry, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
        const proposal = record((record(resultBody).inputRequestProposals as unknown[])[0]);
        const refused = await recoveryEnvelope(
          'informationRequestOpenV1',
          objectRef('execution.information_request', newUuidV7(), scope()) as Common.ObjectRef,
          {
            definition: {
              taskRef: revised.taskRef,
              workOrderRef,
              runRef,
              requestType: proposal.requestType,
              question: proposal.question,
              reason: proposal.reason,
              expectedAnswerSpec: proposal.expectedAnswerSpec,
              blocking: true,
              requestedResponder: {
                principalKind: 'HUMAN',
                roleCode: 'project.customer_material.confirmer',
                scopeRef: scope(),
              },
              relatedRefs: [
                resultRef,
                acceptanceRecordRef,
                candidateMaterial,
                recoverySource,
                workOrderRef,
                revised.taskRef,
              ],
              expiresAt: new Date(clock + 300_000).toISOString(),
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(recoveryEntryRaw.command(refused, sessionFor(service))).rejects.toBeDefined();
        expect(await receiptRows(String(refused.idempotencyKey))).toEqual([]);
        expect(
          (
            await admin.query(
              'SELECT request_id FROM task_execution.information_request WHERE work_order_id=$1',
              [woId],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await admin.query(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'EXPIRED' }]);
        return;
      }
      if (terminalScenario === 'RACE') {
        const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
        if (deadlineWait > 0) await waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
        clock = Date.now();
        const raceFinalize = await firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          runRef,
          { acceptanceRecordRef } as unknown as CanonicalJsonObject,
          service,
          3,
        );
        const raceExpire = await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          3,
        );
        const race = await Promise.allSettled([
          firstRunEntry.finalizeRun(raceFinalize, sessionFor(service)),
          firstRunEntry.expireRun(raceExpire, sessionFor(service)),
        ]);
        expect(race[0].status).toBe('rejected');
        if (race[1].status === 'rejected') throw race[1].reason;
        expect(race[1].value).toMatchObject({ status: 'COMMITTED' });
        expect(
          await firstRunEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              runRef,
              { runRef } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'TIMED_OUT', terminationReason: 'EXECUTION_DEADLINE_EXCEEDED' });
        expect(
          (
            await admin.query<{ status: string }>(
              'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'EXPIRED' }]);
        expect(
          (
            await admin.query<{ count: string }>(
              "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ count: '1' }]);
        return;
      }
      const wrongAcceptance = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        {
          acceptanceRecordRef: {
            ...record(acceptanceRecordRef),
            objectId: newUuidV7(),
          },
        },
        service,
        3,
      );
      await expect(
        firstRunEntry.finalizeRun(wrongAcceptance, sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await receiptRows(wrongAcceptance.idempotencyKey)).toEqual([]);
      expect(
        (
          await admin.query<{ status: string }>(
            'SELECT status FROM task_execution.run WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'RESULT_RECORDED' }]);
      phase('Run finalize boundary');
      const finalizeEnvelope = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        { acceptanceRecordRef } as unknown as CanonicalJsonObject,
        service,
        3,
      );
      if (
        await finalEligibilityLoss('FINALIZE', finalizeEnvelope, (value) =>
          firstRunEntry.finalizeRun(value, sessionFor(service)),
        )
      )
        return;
      await finalDependencyRefusals(finalizeEnvelope, (entry, value, session) =>
        entry.finalizeRun(value, session),
      );
      await finalSqlRefusals(finalizeEnvelope, (value) =>
        firstRunEntry.finalizeRun(value, sessionFor(service)),
      );
      await finalSourceReceiptRefusals(finalizeEnvelope, (value) =>
        firstRunEntry.finalizeRun(value, sessionFor(service)),
      );
      await finalReceiptRollback(finalizeEnvelope, (value) =>
        firstRunEntry.finalizeRun(value, sessionFor(service)),
      );
      let finalized: Awaited<ReturnType<typeof firstRunEntry.finalizeRun>>;
      const foreignAcceptance = foreignValidations?.acceptanceRecordRef;
      if (foreignAcceptance !== undefined) {
        const competing = await firstRunEnvelope(
          'execution.finalize_run_from_acceptance',
          runRef,
          { acceptanceRecordRef: foreignAcceptance },
          service,
          3,
        );
        const outcomes = await Promise.allSettled([
          firstRunEntry.finalizeRun(finalizeEnvelope, sessionFor(service)),
          firstRunEntry.finalizeRun(competing, sessionFor(service)),
        ]);
        const winner = outcomes[0];
        if (winner.status !== 'fulfilled')
          throw new Error('legitimate finalizer lost to another Run Acceptance');
        finalized = winner.value;
        expect(outcomes[1].status).toBe('rejected');
        expect(await receiptRows(competing.idempotencyKey)).toEqual([]);
      } else finalized = await firstRunEntry.finalizeRun(finalizeEnvelope, sessionFor(service));
      expect(finalized, JSON.stringify(finalized)).toMatchObject({ status: 'COMMITTED' });
      if (bounded) {
        phase('bounded recovery after terminal Run-1');
        processEnabled = true;
        const requestRef = objectRef(
          'execution.information_request',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        const savedHistory = await admin.query(
          `SELECT to_jsonb(r) run_bytes,a.result_payload result_bytes,ac.canonical_payload acceptance_bytes,c.canonical_payload context_bytes,wc.canonical_payload contract_bytes,r.result_ref,r.acceptance_ref,r.context_snapshot_ref,r.work_order_contract_ref,c.payload_hash context_hash,wc.payload_hash contract_hash FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) JOIN task_execution.agent_result_acceptance ac USING(result_id) JOIN task_execution.context_snapshot c ON c.snapshot_id=(r.context_snapshot_ref->>'snapshotId')::uuid JOIN task_execution.work_order_contract wc ON wc.contract_id=(r.work_order_contract_ref->>'objectId')::uuid WHERE r.run_id=$1`,
          [runRef.objectId],
        );
        const proposal = record((resultBody.inputRequestProposals as CanonicalJsonObject[])[0]);
        const canonicalRefs = (values: unknown[]) =>
          values.sort((a, b) =>
            Buffer.compare(
              Buffer.from(canonicalize(a as CanonicalJsonObject)),
              Buffer.from(canonicalize(b as CanonicalJsonObject)),
            ),
          );
        const definition = {
          taskRef: revised.taskRef,
          workOrderRef,
          runRef,
          requestType: proposal.requestType,
          question: proposal.question,
          reason: proposal.reason,
          expectedAnswerSpec: proposal.expectedAnswerSpec,
          blocking: true,
          requestedResponder: {
            principalKind: 'HUMAN',
            roleCode: 'project.customer_material.confirmer',
            scopeRef: scope(),
          },
          relatedRefs: canonicalRefs([
            resultRef,
            acceptanceRecordRef,
            candidateMaterial,
            recoverySource,
            workOrderRef,
            revised.taskRef,
          ]),
          expiresAt: new Date(clock + 300_000).toISOString(),
        };
        const rejectRecovery = async (
          key: string,
          target: Common.ObjectRef,
          payload: CanonicalJsonObject,
          principal: Principal = service,
          expectedVersion?: number,
        ) => {
          const envelope = await recoveryEnvelope(key, target, payload, principal, expectedVersion);
          await expect(
            recoveryEntryRaw.command(envelope, sessionFor(principal)),
            `${key} rejection`,
          ).rejects.toBeDefined();
          expect(await receiptRows(String(envelope.idempotencyKey))).toEqual([]);
        };
        const stateBeforeRequest = await recoveryEntryRaw.read(
          await recoveryEnvelope(
            'workOrderExecutionStateReadV1',
            workOrderRef,
            { workOrderRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(stateBeforeRequest).toMatchObject({
          blockerRefs: [resultRef],
          retryEligibility: 'WAITING_INPUT',
        });
        await rejectRecovery(
          'workOrderRetryScheduleV1',
          workOrderRef,
          {
            previousRunRef: runRef,
            nextAttemptNumber: 2,
            retryReason: 'BLOCKED_INPUT_RESOLVED',
            retryPolicyRef: controlsRef,
          } as unknown as CanonicalJsonObject,
          operator(),
          4,
        );
        // Both Roots derive WAITING_INPUT from the terminal source before a Request exists.
        expect(
          await firstRunEntryRaw.reconcile(
            await firstRunEnvelope(
              'execution.reconcile_work_order_execution',
              workOrderRef,
              { triggerRef: runRef } as unknown as CanonicalJsonObject,
              service,
              Number(record(stateBeforeRequest).aggregateVersion),
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
        const taskBeforeRequest = await recoveryEntryRaw.read(
          await recoveryEnvelope(
            'taskStateReadV1',
            revised.taskRef as Common.ObjectRef,
            { taskRef: revised.taskRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(
          await recoveryEntryRaw.command(
            await recoveryEnvelope(
              'taskReconcileV1',
              revised.taskRef as Common.ObjectRef,
              { triggerRef: runRef } as unknown as CanonicalJsonObject,
              service,
              Number(record(taskBeforeRequest).aggregateVersion),
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
        definition.expiresAt = new Date(clock + 300_000).toISOString();
        const open = await recoveryEnvelope(
          'informationRequestOpenV1',
          requestRef,
          { definition } as unknown as CanonicalJsonObject,
          service,
        );
        expect(await recoveryEntry.command(open, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
        expect(await recoveryEntry.command(open, sessionFor(service))).toMatchObject({
          status: 'DUPLICATE',
        });
        // A different target/key for the same accepted source returns the original winner.
        const alternateOpen = await recoveryEnvelope(
          'informationRequestOpenV1',
          objectRef('execution.information_request', newUuidV7(), scope()) as Common.ObjectRef,
          { definition } as unknown as CanonicalJsonObject,
          service,
        );
        expect(await recoveryEntryRaw.command(alternateOpen, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { informationRequestRef: requestRef },
        });
        expect(
          (
            await admin.query(
              'SELECT request_id FROM task_execution.information_request_origin WHERE source_result_id=$1',
              [resultRef.objectId],
            )
          ).rows,
        ).toEqual([{ request_id: requestRef.objectId }]);
        await rejectRecovery(
          'informationRequestOpenV1',
          objectRef('execution.information_request', newUuidV7(), scope()) as Common.ObjectRef,
          {
            definition: { ...definition, question: 'A conflicting request question.' },
          } as unknown as CanonicalJsonObject,
        );
        const requestQuery = async () =>
          recoveryEntry.read(
            await recoveryEnvelope(
              'informationRequestReadV1',
              requestRef,
              { informationRequestRef: requestRef } as unknown as CanonicalJsonObject,
              operator(),
              undefined,
              true,
            ),
            sessionFor(),
          );
        expect(await requestQuery()).toMatchObject({
          status: 'OPEN',
          aggregateVersion: 1,
          deliveryRefs: [],
        });
        const woVersion = async () =>
          Number(
            (
              await admin.query(
                'SELECT aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
                [woId],
              )
            ).rows[0].aggregate_version,
          );
        const taskVersion = async () =>
          Number(
            (
              await admin.query(
                'SELECT aggregate_version FROM task_execution.task WHERE task_id=$1',
                [taskId],
              )
            ).rows[0].aggregate_version,
          );
        const reconcileWo = async (trigger: unknown) =>
          firstRunEntry.reconcile(
            await firstRunEnvelope(
              'execution.reconcile_work_order_execution',
              workOrderRef,
              { triggerRef: trigger } as unknown as CanonicalJsonObject,
              service,
              await woVersion(),
            ),
            sessionFor(service),
          );
        const reconcileTask = async (trigger: unknown) =>
          recoveryEntry.command(
            await recoveryEnvelope(
              'taskReconcileV1',
              revised.taskRef as Common.ObjectRef,
              { triggerRef: trigger } as unknown as CanonicalJsonObject,
              service,
              await taskVersion(),
            ),
            sessionFor(service),
          );
        expect(await reconcileWo(runRef)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: 'WAITING_INPUT' },
        });
        expect(await reconcileTask(runRef)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: 'WAITING_INPUT' },
        });
        if (otherChildId) {
          const child = definedValue(otherChildContract);
          const childRef = child.workOrderRef as Common.ObjectRef;
          const childRun = objectRef('execution.run', newUuidV7(), scope()) as Common.ObjectRef;
          expect(
            await firstRunEntryRaw.queue(
              await firstRunEnvelope(
                'execution.queue_work_order',
                childRef,
                {
                  queuePolicyRef: controlsRef,
                } as unknown as CanonicalJsonObject,
                operator(),
                2,
              ),
              sessionFor(),
            ),
          ).toMatchObject({ status: 'COMMITTED' });
          const bundle = await firstRunEntryRaw.issueBundle(
            await firstRunEnvelope(
              'identity.issue_execution_capability_bundle',
              objectRef(
                'zhiju.identity.execution_capability_bundle',
                newUuidV7(),
                scope(),
              ) as Common.ObjectRef,
              {
                runRef: childRun,
                workOrderRef: childRef,
                workOrderContractRef: otherChildContractRef,
                contextSnapshotRef: otherChildContextRef,
                servicePrincipalRef: { principalKind: 'SERVICE', principalId: serviceId },
                requestedCapabilities: child.allowedCapabilities,
              } as unknown as CanonicalJsonObject,
              service,
            ),
            sessionFor(service),
          );
          const capability = record(committedPayload(bundle as CommandResult)).bundleRef;
          const validUntil = definedValue(
            (
              await admin.query<{ valid_until: Date }>(
                'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
                [record(capability).objectId],
              )
            ).rows[0],
          ).valid_until;
          clock = Math.max(clock, Date.now());
          const created = await firstRunEntryRaw.createRun(
            await firstRunEnvelope(
              'execution.create_run',
              childRun,
              {
                creation: {
                  workOrderRef: childRef,
                  workOrderContractRef: otherChildContractRef,
                  contextSnapshotRef: otherChildContextRef,
                  capabilityGrantRef: capability,
                  leasePolicyRef: controlsRef,
                  attemptNumber: 1,
                  runtimeBinding,
                  executionDeadline: validUntil.toISOString(),
                },
              } as unknown as CanonicalJsonObject,
              service,
            ),
            sessionFor(service),
          );
          const creation = record(committedPayload(created as CommandResult));
          otherChildAttemptRef = objectRef(
            'integration.runtime_attempt',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          expect(
            await firstRunEntryRaw.dispatch(
              await firstRunEnvelope(
                'integration.request_runtime_dispatch',
                otherChildAttemptRef,
                {
                  request: {
                    workOrderRef: childRef,
                    runRef: childRun,
                    workOrderContractRef: otherChildContractRef,
                    contextSnapshotRef: otherChildContextRef,
                    capabilityGrantRef: capability,
                    runtimeBinding,
                    stableIdempotencyKey: newUuidV7(),
                    requestedAt: new Date(clock).toISOString(),
                  },
                } as unknown as CanonicalJsonObject,
                service,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'SUCCEEDED' });
          expect(
            await firstRunEntryRaw.startRun(
              await firstRunEnvelope(
                'execution.start_run',
                childRun,
                {
                  leaseId: creation.leaseId,
                  fencingToken: 1,
                  runtimeAttemptRef: otherChildAttemptRef,
                  startedAt: new Date(clock).toISOString(),
                } as unknown as CanonicalJsonObject,
                service,
                1,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'COMMITTED' });
          expect(
            await firstRunEntryRaw.reconcile(
              await firstRunEnvelope(
                'execution.reconcile_work_order_execution',
                childRef,
                { triggerRef: childRun } as unknown as CanonicalJsonObject,
                service,
                3,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'RUNNING' } });
          const final = definedValue(
            await firstRunEntryRaw.observeRuntimeFinal(
              await firstRunQuery(
                'integration.get_runtime_final_observation',
                otherChildAttemptRef,
                { attemptRef: otherChildAttemptRef } as unknown as CanonicalJsonObject,
                'runtimeFinalReadV1',
              ),
              sessionFor(service),
            ),
          );
          expect(record(final.agentResultContract).executionOutcome).toBe('BLOCKED_INPUT');
          const submitted = await firstRunEntryRaw.submitAgentResult(
            await firstRunEnvelope(
              'execution.submit_agent_result',
              objectRef(
                'execution.agent_result',
                String(record(final.agentResultContract).agentResultId),
                scope(),
              ) as Common.ObjectRef,
              {
                agentResultContract: final.agentResultContract,
                runFencingToken: 1,
                runtimeSubmissionRef: final.runtimeSubmissionRef,
              },
              service,
            ),
            sessionFor(service),
          );
          otherChildResultRef = record(committedPayload(submitted as CommandResult)).agentResultRef;
          expect(
            await firstRunEntryRaw.recordRunResult(
              await firstRunEnvelope(
                'execution.record_run_result',
                childRun,
                { agentResultRef: otherChildResultRef } as CanonicalJsonObject,
                service,
                2,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'COMMITTED' });
          const validated = await firstRunEntryRaw.validateAgentResult(
            await firstRunEnvelope(
              'execution.validate_agent_result',
              objectRef(
                'zhiju.execution.agent_result_validation_bundle',
                newUuidV7(),
                scope(),
              ) as Common.ObjectRef,
              {
                agentResultRef: otherChildResultRef,
                runRef: childRun,
                runtimeAttemptRef: otherChildAttemptRef,
                policyRef: controlsRef,
                evaluatorRef: finalEvaluator,
              } as unknown as CanonicalJsonObject,
              service,
            ),
            sessionFor(service),
          );
          const judgments = record(committedPayload(validated as CommandResult));
          const accepted = await firstRunEntryRaw.acceptAgentResult(
            await firstRunEnvelope(
              'execution.accept_agent_result',
              objectRef(
                'execution.agent_result_acceptance',
                newUuidV7(),
                scope(),
              ) as Common.ObjectRef,
              {
                agentResultRef: otherChildResultRef,
                schemaValidationRef: judgments.schemaValidationRef,
                identityValidationRef: judgments.identityValidationRef,
                runBindingValidationRef: judgments.runBindingValidationRef,
                scopeValidationRef: judgments.scopeValidationRef,
                businessOutputValidationRef: judgments.businessOutputValidationRef,
                disposition: 'ACCEPTED',
                reasons: [],
              } as unknown as CanonicalJsonObject,
              service,
            ),
            sessionFor(service),
          );
          const acceptance = record(
            committedPayload(accepted as CommandResult),
          ).acceptanceRecordRef;
          expect(
            await firstRunEntryRaw.finalizeRun(
              await firstRunEnvelope(
                'execution.finalize_run_from_acceptance',
                childRun,
                { acceptanceRecordRef: acceptance } as CanonicalJsonObject,
                service,
                3,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'COMMITTED' });
          expect(
            await firstRunEntryRaw.reconcile(
              await firstRunEnvelope(
                'execution.reconcile_work_order_execution',
                childRef,
                { triggerRef: childRun } as unknown as CanonicalJsonObject,
                service,
                4,
              ),
              sessionFor(service),
            ),
          ).toMatchObject({ status: 'COMMITTED', resultPayload: { status: 'WAITING_INPUT' } });
        }
        clock = Math.max(clock, Date.now());
        const confirm = await recoveryEnvelope(
          'customerMaterialConfirmV1',
          objectRef(
            'zhiju.project.customer_material',
            definedValue(candidateMaterial).objectId,
            scope(),
          ) as Common.ObjectRef,
          {
            candidateVersionRef: candidateMaterial,
            completeness: 'COMPLETE',
            declaredStatus: 'approved',
            evidenceRefs: [{ evidence: recoverySource, relation: 'SUPPORTS' }],
            justification: {
              reasonCode: 'HUMAN_REVIEW',
              summary: 'Human confirms the exact candidate and source.',
              evidenceRefs: [{ evidence: recoverySource, relation: 'SUPPORTS' }],
            },
          } as unknown as CanonicalJsonObject,
          operator(),
          1,
        );
        const confirmed = await recoveryEntry.command(confirm, sessionFor());
        expect(confirmed).toMatchObject({ status: 'COMMITTED' });
        const confirmedRef = record(committedPayload(confirmed)).customerMaterialRef;
        const discoverPayload = { commandId: String(confirm.commandId), scopeRef: scope() },
          discoverTarget = objectRef(
            'zhiju.project.command_receipt',
            String(confirm.commandId),
            scope(),
          ) as Common.ObjectRef;
        const discovery = await recoveryAuth.authorize(
          identityDeps([fixture.projectId]),
          'confirmationReceiptDiscoverV1',
          {
            actorSnapshotRef: operator().actorRef,
            commandType: 'project.confirmation_receipt.discover',
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(discoverPayload).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef: discoverTarget,
          },
        );
        if (discovery.outcome !== 'ALLOW') throw new Error('discovery denied');
        const receipt = (
          await recoveryEntry.discoverReceipt(
            String(confirm.commandId),
            sessionFor(),
            discovery.authorizationDecisionRef,
            scope(),
          )
        ).commandReceiptRef;
        clock = Math.max(clock, Date.now());
        const answer = {
          answerId: newUuidV7(),
          responder: objectRef('zhiju.identity.principal', OPERATOR, scope()),
          answerContent: {
            candidateMaterialRef: candidateMaterial,
            confirmedMaterialRef: confirmedRef,
          },
          sourceRefs: [recoverySource],
          submittedAt: new Date(clock).toISOString(),
        };
        let answerPayload = {
          answer: {
            ...answer,
            payloadHash: contentHash(sha256CanonicalJson(answer as unknown as CanonicalJsonObject)),
          },
        } as unknown as CanonicalJsonObject;
        let answerEnv = await recoveryEnvelope(
          'informationAnswerSubmitV1',
          requestRef,
          answerPayload,
          operator(),
          1,
        );
        const denialSnapshot = async () =>
          (
            await admin.query<{
              status: string;
              aggregate_version: string;
              accepted_answer_ref: unknown;
              resolution_ref: unknown;
            }>(
              `SELECT status,aggregate_version,accepted_answer_ref,resolution_ref FROM task_execution.information_request WHERE request_id=$1`,
              [requestRef.objectId],
            )
          ).rows;
        const openBefore = await denialSnapshot();
        for (const change of [
          { responder: objectRef('zhiju.identity.principal', newUuidV7(), scope()) },
          { sourceRefs: [] },
          {
            answerContent: {
              candidateMaterialRef: { ...record(candidateMaterial), versionId: newUuidV7() },
              confirmedMaterialRef: confirmedRef,
            },
          },
          { submittedAt: new Date(clock + 1).toISOString() },
        ]) {
          const invalidAnswer = { ...answer, ...change };
          const payload = {
            answer: {
              ...invalidAnswer,
              payloadHash: contentHash(
                sha256CanonicalJson(invalidAnswer as unknown as CanonicalJsonObject),
              ),
            },
          } as unknown as CanonicalJsonObject;
          const envelope = await recoveryEnvelope(
            'informationAnswerSubmitV1',
            requestRef,
            payload,
            operator(),
            1,
          );
          await expect(
            recoveryEntryRaw.command(envelope, sessionFor()),
            'TE-REC-D-005 invalid answer',
          ).rejects.toBeDefined();
          expect(await denialSnapshot()).toEqual(openBefore);
          expect(await receiptRows(String(envelope.idempotencyKey))).toEqual([]);
        }
        queryReads.length = 0;
        await expect(
          createBlockedInputRecoveryEntry({
            ...recoveryConfig,
            taskExecutionDb: guardedTeDb,
            recoveryCapabilityCodes: {
              ...recoveryCodes,
              informationAnswerSubmitV1: 'wi231.missing',
            },
          }).command(answerEnv, sessionFor()),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(protectedReads()).toEqual([]);
        await expect(
          recoveryEntryRaw.command(answerEnv, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await denialSnapshot()).toEqual(openBefore);
        for (const borrower of borrowedActors) {
          queryReads.length = 0;
          await expect(
            recoveryEntryRaw.command(
              { ...answerEnv, actor: borrower.actorRef },
              sessionFor(borrower),
            ),
          ).rejects.toBeDefined();
          expect(protectedReads()).toEqual([]);
          expect(await denialSnapshot()).toEqual(openBefore);
          expect(await receiptRows(String(answerEnv.idempotencyKey))).toEqual([]);
        }
        if (recoveryVariant === 'NORMAL') {
          const agent = definedValue(
            borrowedActors.find((actor) => actor.principalKind === 'AGENT'),
          );
          expect(
            await recoveryAuth.authorize(
              identityDeps([fixture.projectId], agent),
              'informationAnswerSubmitV1',
              {
                actorSnapshotRef: agent.actorRef,
                commandType: 'execution.submit_information_answer',
                commandVersion: '1.0',
                commandPayloadHash: digestCanonicalPayload(answerPayload).hash,
                authenticationContextHash: agent.authHash,
                targetRef: requestRef,
              },
            ),
          ).toMatchObject({ outcome: 'DENY' });
          const actingHuman = definedValue(
            borrowedActors.find((actor) => actor.principalKind === 'HUMAN'),
          );
          const actingAnswer = await recoveryEnvelope(
            'informationAnswerSubmitV1',
            requestRef,
            answerPayload,
            actingHuman,
            1,
          );
          await expect(
            recoveryEntryRaw.command(actingAnswer, sessionFor(actingHuman)),
          ).rejects.toBeDefined();
          expect(await denialSnapshot()).toEqual(openBefore);
          expect(await receiptRows(String(actingAnswer.idempotencyKey))).toEqual([]);
        }
        if (recoveryVariant === 'NORMAL')
          for (const change of ['GRANT', 'REQUEST_EXPIRY'] as const) {
            const locked = await recoveryEnvelope(
              'informationAnswerSubmitV1',
              requestRef,
              answerPayload,
              operator(),
              1,
            );
            const blocker = new pg.Client({ connectionString: databaseUrl });
            await blocker.connect();
            const savedClock = clock;
            let pending: Promise<unknown> | undefined;
            try {
              await blocker.query('BEGIN');
              const blockerPid = definedValue(
                (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0],
              ).pid;
              await blocker.query(
                'SELECT request_id FROM task_execution.information_request WHERE request_id=$1 FOR UPDATE',
                [requestRef.objectId],
              );
              pending = recoveryEntryRaw.command(locked, sessionFor());
              void pending.catch(() => undefined);
              const until = Date.now() + 10_000;
              let waiting = false;
              while (Date.now() < until) {
                waiting =
                  (
                    await admin.query(
                      'SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                      [blockerPid],
                    )
                  ).rows.length > 0;
                if (waiting) break;
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
              }
              expect(waiting, 'actual Answer transaction waits for the Request row lock').toBe(
                true,
              );
              if (change === 'GRANT') {
                const grantId = definedValue(
                  recoveryGrants.get(
                    `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
                  ),
                );
                expect(
                  await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
                    targetId: grantId,
                    expectedAggregateVersion: '1',
                    scope: {
                      scopeKind: 'PROJECT',
                      enterpriseId: fixture.enterpriseId,
                      projectId: fixture.projectId,
                    },
                    reasonCode: 'WI231_LOCKED_ANSWER_REVOKE',
                    effectiveAt: new Date(clock),
                    idempotencyKey: newUuidV7(),
                  }),
                ).toMatchObject({ status: 'COMMITTED' });
              } else clock = new Date(definition.expiresAt).getTime() + 1;
              await blocker.query('COMMIT');
              await expect(pending).rejects.toBeDefined();
              expect(await denialSnapshot()).toEqual(openBefore);
              expect(await receiptRows(String(locked.idempotencyKey))).toEqual([]);
            } finally {
              await blocker.query('ROLLBACK');
              await Promise.allSettled(pending ? [pending] : []);
              await blocker.end();
              clock = Math.max(savedClock, Date.now());
              if (change === 'GRANT') {
                const binding = definedValue(
                  BLOCKED_INPUT_RECOVERY_BINDINGS.find(
                    (entry) => entry.capabilityConfigKey === 'informationAnswerSubmitV1',
                  ),
                );
                const restored = await grant({
                  principal: operator(),
                  capabilityCode: definedValue(recoveryCodes.informationAnswerSubmitV1),
                  action: binding.requiredGrantAction,
                  actions: [
                    binding.requiredGrantAction,
                    'execution.information_request.resolve.v1',
                  ],
                  selectorType: binding.selectorType,
                  targetObjectType: 'execution.information_request',
                });
                recoveryGrants.set(
                  `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
                  restored,
                );
                recoveryGrants.set(
                  `${OPERATOR}:informationRequestResolveV1:execution.information_request`,
                  restored,
                );
              }
            }
          }
        if (recoveryVariant === 'NORMAL') {
          answer.submittedAt = new Date(clock).toISOString();
          answerPayload = {
            answer: {
              ...answer,
              payloadHash: contentHash(
                sha256CanonicalJson(answer as unknown as CanonicalJsonObject),
              ),
            },
          } as unknown as CanonicalJsonObject;
          answerEnv = await recoveryEnvelope(
            'informationAnswerSubmitV1',
            requestRef,
            answerPayload,
            operator(),
            1,
          );
        }
        await recoveryReceiptRollback(answerEnv, () =>
          recoveryEntryRaw.command(answerEnv, sessionFor()),
        );
        const concurrentAnswer = await recoveryEnvelope(
          'informationAnswerSubmitV1',
          requestRef,
          answerPayload,
          operator(),
          1,
        );
        const [answered, answerWinner] = await Promise.all([
          recoveryEntry.command(answerEnv, sessionFor()),
          recoveryEntryRaw.command(concurrentAnswer, sessionFor()),
        ]);
        expect(answerWinner).toMatchObject({
          status: 'COMMITTED',
          resultPayload: committedPayload(answered),
        });
        const conflictingAnswer = { ...answer, answerId: newUuidV7() };
        await rejectRecovery(
          'informationAnswerSubmitV1',
          requestRef,
          {
            answer: {
              ...conflictingAnswer,
              payloadHash: contentHash(
                sha256CanonicalJson(conflictingAnswer as unknown as CanonicalJsonObject),
              ),
            },
          } as unknown as CanonicalJsonObject,
          operator(),
          2,
        );

        expect(answered).toMatchObject({ status: 'COMMITTED' });
        expect(await recoveryEntry.command(answerEnv, sessionFor())).toMatchObject({
          status: 'DUPLICATE',
        });
        expect(await requestQuery()).toMatchObject({ status: 'ANSWERED', aggregateVersion: 2 });
        clock = Math.max(clock, Date.now());
        const resolvePayload = {
          acceptedAnswerRef: record(committedPayload(answered)).answerRef,
          domainCommandRefs: [receipt],
          resolutionDisposition: 'execution.resolution.customer_material_confirmed',
          resolvedBy: objectRef('zhiju.identity.principal', OPERATOR, scope()),
          resolvedAt: new Date(clock).toISOString(),
          justification: {
            reasonCode: 'HUMAN_REVIEW',
            summary: 'Human confirms the exact material and committed confirmation receipt.',
            evidenceRefs: [receipt],
          },
        } as unknown as CanonicalJsonObject;
        const resolve = await recoveryEnvelope(
          'informationRequestResolveV1',
          requestRef,
          resolvePayload,
          operator(),
          2,
        );
        const answeredBefore = await denialSnapshot();
        if (recoveryVariant === 'NORMAL') {
          const secondPropose = await recoveryEnvelope(
            'customerMaterialProposeV1',
            objectRef('zhiju.project.customer_material', newUuidV7(), scope()) as Common.ObjectRef,
            record(definedValue(recoveryProposeEnvelope).payload) as CanonicalJsonObject,
            operator(),
          );
          const proposedOther = await recoveryEntryRaw.command(secondPropose, sessionFor());
          const otherCandidate = record(committedPayload(proposedOther)).customerMaterialRef;
          const secondConfirm = await recoveryEnvelope(
            'customerMaterialConfirmV1',
            secondPropose.targetRef as Common.ObjectRef,
            {
              ...record(confirm.payload),
              candidateVersionRef: otherCandidate,
            } as CanonicalJsonObject,
            operator(),
            1,
          );
          secondConfirm.correlationId = confirm.correlationId;
          expect(await recoveryEntryRaw.command(secondConfirm, sessionFor())).toMatchObject({
            status: 'COMMITTED',
          });
          const discoverOther = async (commandId: string) => {
            const payload = { commandId, scopeRef: scope() };
            const signed = await recoveryAuth.authorize(
              identityDeps([fixture.projectId]),
              'confirmationReceiptDiscoverV1',
              {
                actorSnapshotRef: operator().actorRef,
                commandType: 'project.confirmation_receipt.discover',
                commandVersion: '1.0',
                commandPayloadHash: digestCanonicalPayload(payload).hash,
                authenticationContextHash: AUTH_HASH,
                targetRef: objectRef(
                  'zhiju.project.command_receipt',
                  commandId,
                  scope(),
                ) as Common.ObjectRef,
              },
            );
            if (signed.outcome !== 'ALLOW') throw new Error('receipt discovery denied');
            return recoveryEntryRaw.discoverReceipt(
              commandId,
              sessionFor(),
              signed.authorizationDecisionRef,
              scope(),
            );
          };
          const otherReceipt = (await discoverOther(String(secondConfirm.commandId)))
            .commandReceiptRef;
          const unrelated = await recoveryEnvelope(
            'informationRequestResolveV1',
            requestRef,
            {
              ...resolvePayload,
              domainCommandRefs: [otherReceipt],
            } as unknown as CanonicalJsonObject,
            operator(),
            2,
          );
          await expect(recoveryEntryRaw.command(unrelated, sessionFor())).rejects.toMatchObject({
            code: 'EXECUTION_RESOLUTION_RECEIPT_INVALID',
          });
          expect(await denialSnapshot()).toEqual(answeredBefore);
          expect(await receiptRows(String(unrelated.idempotencyKey))).toEqual([]);
          await expect(discoverOther(newUuidV7())).rejects.toBeDefined();
          await expect(
            recoveryEntryRaw.discoverReceipt(
              String(confirm.commandId),
              sessionFor(other()),
              discovery.authorizationDecisionRef,
              scope(),
            ),
          ).rejects.toBeDefined();
          await expect(
            recoveryEntryRaw.discoverReceipt(
              String(confirm.commandId),
              sessionFor(),
              discovery.authorizationDecisionRef,
              { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
            ),
          ).rejects.toBeDefined();
          await expect(
            createBlockedInputRecoveryEntry({
              ...recoveryConfig,
              recoveryCapabilityCodes: {
                ...recoveryCodes,
                confirmationReceiptDiscoverV1: 'wi231.no.discovery.grant',
              },
            }).discoverReceipt(
              String(confirm.commandId),
              sessionFor(),
              discovery.authorizationDecisionRef,
              scope(),
            ),
          ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        }

        for (const change of [
          {
            domainCommandRefs: [
              {
                ...record(receipt),
                contentHash: contentHash(sha256CanonicalJson({ forged: true })),
              },
            ],
          },
          { domainCommandRefs: [{ ...record(receipt), objectId: newUuidV7() }] },
          {
            domainCommandRefs: [
              {
                ...record(receipt),
                scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
              },
            ],
          },
          {
            acceptedAnswerRef: {
              ...record(resolvePayload.acceptedAnswerRef),
              objectId: newUuidV7(),
            },
          },
          { resolvedBy: objectRef('zhiju.identity.principal', newUuidV7(), scope()) },
          { resolvedAt: new Date(clock + 1).toISOString() },
        ]) {
          const envelope = await recoveryEnvelope(
            'informationRequestResolveV1',
            requestRef,
            { ...resolvePayload, ...change } as CanonicalJsonObject,
            operator(),
            2,
          );
          await expect(
            recoveryEntryRaw.command(envelope, sessionFor()),
            'TE-REC-D-004 forged or unrelated resolution',
          ).rejects.toBeDefined();
          expect(await denialSnapshot()).toEqual(answeredBefore);
          expect(await receiptRows(String(envelope.idempotencyKey))).toEqual([]);
        }
        await rejectRecovery(
          'workOrderRetryScheduleV1',
          workOrderRef,
          {
            previousRunRef: runRef,
            nextAttemptNumber: 2,
            retryReason: 'BLOCKED_INPUT_RESOLVED',
            retryPolicyRef: controlsRef,
          } as unknown as CanonicalJsonObject,
          operator(),
          await woVersion(),
        );
        const resolved = await recoveryEntry.command(resolve, sessionFor());
        expect(resolved).toMatchObject({ status: 'COMMITTED' });
        const resolutionRef = record(committedPayload(resolved)).resolutionRef;
        expect(await recoveryEntry.command(resolve, sessionFor())).toMatchObject({
          status: 'DUPLICATE',
        });
        expect(await requestQuery()).toMatchObject({
          status: 'RESOLVED',
          aggregateVersion: 3,
          resolutionRef,
        });
        // Historical integrity uses the actual committed time, independently of current expiry.
        const attestation = record(
          (
            await admin.query(
              'SELECT canonical_payload FROM task_execution.resolution_receipt_observation WHERE resolution_id=$1',
              [record(resolutionRef).objectId],
            )
          ).rows[0].canonical_payload,
        );
        const confirmationDecisionExpiry = (
          await admin.query<{ expires_at: Date }>(
            'SELECT expires_at FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
            [record(attestation.authorizationDecisionRef).objectId],
          )
        ).rows[0]?.expires_at;
        const historyNow = new Date(definedValue(confirmationDecisionExpiry).getTime() + 1);
        const historicalAuth = createRecoveryAuthorizationPort({
          capabilityCodes: recoveryCodes,
          now: () => historyNow,
        });
        const eligibilityInput = {
          principalRef: { principalKind: 'HUMAN', principalId: OPERATOR },
          scopeRef: scope(),
          roleCode: 'project.customer_material.confirmer',
          confirmationActorSnapshotRef: attestation.actorSnapshotRef,
          confirmationAuthorizationDecisionRef: attestation.authorizationDecisionRef,
          confirmationTargetRef: attestation.targetRef,
          confirmationRequestPayloadHash: attestation.requestPayloadHash,
          confirmationCommittedAt: attestation.committedAt,
        } as unknown as RecoveryHumanEligibilityInput;
        const historyTarget = objectRef(
          'zhiju.identity.principal',
          OPERATOR,
          scope(),
        ) as Common.ObjectRef;
        const historicalDecision = await historicalAuth.authorize(
          identityDeps([fixture.projectId], service),
          'recovery.request_resolve.human.v1',
          {
            actorSnapshotRef: service.actorRef,
            commandType: 'execution.recovery.request_resolve.human',
            commandVersion: '1.0',
            commandPayloadHash: digestCanonicalPayload(
              eligibilityInput as unknown as CanonicalJsonObject,
            ).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef: historyTarget,
          },
        );
        if (historicalDecision.outcome !== 'ALLOW') throw new Error('Historical proof read denied');
        const historyProof = async () => {
          const view = await historicalAuth.revalidate(
            identityDeps([fixture.projectId], service),
            'recovery.request_resolve.human.v1',
            {
              decisionRef: historicalDecision.authorizationDecisionRef,
              expectedCommandType: 'execution.recovery.request_resolve.human',
              expectedCommandVersion: '1.0',
              expectedCommandPayloadHash: digestCanonicalPayload(
                eligibilityInput as unknown as CanonicalJsonObject,
              ).hash,
              expectedAuthenticationContextHash: AUTH_HASH,
              expectedTargetRef: historyTarget,
            },
          );
          expect(view.valid).toBe(true);
        };
        const historyAuthority = {
          now: () => historyNow,
          validUntil: () => new Date(historicalDecision.expiresAt),
          revalidateAuthorization: historyProof,
          requiredCapabilities: [
            {
              capabilityCode: recoveryConfig.humanCapabilityCodes.answerSubmit,
              action: 'execution.information_request.answer.submit.v1',
              targetObjectType: 'execution.information_request',
            },
            {
              capabilityCode: recoveryConfig.humanCapabilityCodes.requestResolve,
              action: 'execution.information_request.resolve.v1',
              targetObjectType: 'execution.information_request',
            },
            {
              capabilityCode: recoveryConfig.humanCapabilityCodes.materialRead,
              action: 'project.customer_material.recovery_refs.read.for_answer_submit.v1',
              targetObjectType: 'zhiju.project.customer_material',
            },
          ],
        };
        expect(
          await readRecoveryHumanEligibility(
            identityDeps([fixture.projectId], service),
            eligibilityInput,
            historyAuthority,
          ),
        ).toMatchObject({ confirmationProvenanceValid: true });
        if (recoveryVariant === 'NORMAL') {
          // Real owning Grants isolate same-code action/selector coverage without
          // replacing the repository, Policy integrity or historical proof.
          const sharedCode = `wi231.r2.${serviceId.replaceAll('-', '')}`;
          const answerBinding = {
            capabilityCode: sharedCode,
            action: 'execution.information_request.answer.submit.v1',
            targetObjectType: 'execution.information_request',
          };
          const resolveBinding = {
            capabilityCode: sharedCode,
            action: 'execution.information_request.resolve.v1',
            targetObjectType: 'execution.information_request',
          };
          const probeAuthority = {
            ...historyAuthority,
            requiredCapabilities: [answerBinding, resolveBinding],
          };
          const readProbe = (requiredCapabilities = probeAuthority.requiredCapabilities) =>
            readRecoveryHumanEligibility(
              identityDeps([fixture.projectId], service),
              eligibilityInput,
              { ...probeAuthority, requiredCapabilities },
            );
          const revokeProbe = async (targetId: string) => {
            expect(
              await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
                targetId,
                expectedAggregateVersion: '1',
                scope: {
                  scopeKind: 'PROJECT',
                  enterpriseId: fixture.enterpriseId,
                  projectId: fixture.projectId,
                },
                reasonCode: 'WI232_R2_REVOKE_PROBE',
                effectiveAt: new Date(clock),
                idempotencyKey: newUuidV7(),
              }),
            ).toMatchObject({ status: 'COMMITTED' });
          };
          const answerOnly = () => grant({ ...answerBinding, selectorType: 'TARGET_TYPE' });
          const answerGrant = await answerOnly();
          await expect(
            readProbe(),
            'same code cannot supply a missing action',
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          await revokeProbe(answerGrant);
          const combinedGrant = await grant({
            ...answerBinding,
            actions: [answerBinding.action, resolveBinding.action],
            selectorType: 'TARGET_TYPE',
          });
          const usable = await readProbe();
          expect(usable).toMatchObject({ useStatus: 'USABLE', confirmationProvenanceValid: true });
          expect(usable.grantRefs.map((ref) => ref.objectId)).toEqual([combinedGrant]);
          await expect(
            readProbe([
              answerBinding,
              { ...resolveBinding, targetObjectType: 'zhiju.execution.work_order' },
            ]),
            'same code cannot cover a different target',
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          await revokeProbe(combinedGrant);
          const remainingAnswer = await answerOnly();
          expect(await readProbe([answerBinding])).toMatchObject({ useStatus: 'USABLE' });
          await expect(
            readProbe(),
            'same code cannot mask removed resolve rights',
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          await revokeProbe(remainingAnswer);
          await grant({
            ...answerBinding,
            actions: [answerBinding.action, resolveBinding.action],
            selectorType: 'CREATE_TARGET_TYPE',
          });
          await expect(
            readProbe(),
            'CREATE selector does not cover TARGET_TYPE',
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
        }
        for (const change of [
          { confirmationTargetRef: { ...record(attestation.targetRef), objectId: newUuidV7() } },
          { confirmationRequestPayloadHash: contentHash('0'.repeat(64)) },
          {
            confirmationActorSnapshotRef: {
              ...record(attestation.actorSnapshotRef),
              objectId: newUuidV7(),
            },
          },
          {
            confirmationAuthorizationDecisionRef: {
              ...record(attestation.authorizationDecisionRef),
              objectId: newUuidV7(),
            },
          },
          { confirmationCommittedAt: new Date(historyNow.getTime() + 1).toISOString() },
          // An actual propose Decision has intact hashes, actor, Scope and target, but the wrong operation/Purpose.
          {
            confirmationAuthorizationDecisionRef:
              definedValue(recoveryProposeEnvelope).authorizationDecisionRef,
            confirmationTargetRef: definedValue(recoveryProposeEnvelope).targetRef,
            confirmationRequestPayloadHash: record(definedValue(recoveryProposeEnvelope).integrity)
              .payloadHash,
          },
        ]) {
          const changed = { ...eligibilityInput, ...change } as RecoveryHumanEligibilityInput;
          const payloadHash = digestCanonicalPayload(
            changed as unknown as CanonicalJsonObject,
          ).hash;
          const proof = await historicalAuth.authorize(
            identityDeps([fixture.projectId], service),
            'recovery.request_resolve.human.v1',
            {
              actorSnapshotRef: service.actorRef,
              commandType: 'execution.recovery.request_resolve.human',
              commandVersion: '1.0',
              commandPayloadHash: payloadHash,
              authenticationContextHash: AUTH_HASH,
              targetRef: historyTarget,
            },
          );
          if (proof.outcome !== 'ALLOW') throw new Error('history consumer proof denied');
          await expect(
            readRecoveryHumanEligibility(identityDeps([fixture.projectId], service), changed, {
              ...historyAuthority,
              validUntil: () => new Date(proof.expiresAt),
              revalidateAuthorization: async () => {
                expect(
                  await historicalAuth.revalidate(
                    identityDeps([fixture.projectId], service),
                    'recovery.request_resolve.human.v1',
                    {
                      decisionRef: proof.authorizationDecisionRef,
                      expectedCommandType: 'execution.recovery.request_resolve.human',
                      expectedCommandVersion: '1.0',
                      expectedCommandPayloadHash: payloadHash,
                      expectedAuthenticationContextHash: AUTH_HASH,
                      expectedTargetRef: historyTarget,
                    },
                  ),
                ).toMatchObject({ valid: true });
              },
            }),
          ).rejects.toBeDefined();
        }
        // Different-key replay keeps original effectiveAt and Event/version.
        const resolveAgain = await recoveryEnvelope(
          'informationRequestResolveV1',
          requestRef,
          resolvePayload,
          operator(),
          3,
        );
        expect(await recoveryEntry.command(resolveAgain, sessionFor())).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { resolutionRef },
        });
        clock = Math.max(clock, Date.now());
        const freshSlice = await captureSlice({
          principal: service,
          purpose: PURPOSE_DOCUMENT,
          capturePolicyRef: captureRef,
          idempotencyKey: newUuidV7(),
        });
        const firstBinding = definedValue(
          await contextSnapshotBuildRow(String(record(contextRef).snapshotId)),
        );
        const buildRequest = {
          workOrderRef,
          workOrderContractRef: read.contractRef,
          projectionType: record(
            record(
              definedValue(await contextSnapshotRow(String(record(contextRef).objectId)))
                .canonical_payload,
            ).projection,
          ).projectionType,
          purpose: record(firstBinding.canonical_payload).purpose,
          audience: objectRef(
            'zhiju.identity.principal',
            String(record(record(firstBinding.canonical_payload).audience).principalId),
            scope(),
          ),
          sourceSlices: [freshSlice],
          answeredInformationRefs: [resolutionRef],
          builderPolicyRef: record(firstBinding.canonical_payload).builderPolicyRef,
          ...(recoveryVariant === 'STALE_CONTEXT'
            ? { expiresAt: new Date(clock + 10_000).toISOString() }
            : recoveryVariant.startsWith('SECOND_')
              ? { expiresAt: new Date(clock + 60_000).toISOString() }
              : {}),
        };
        const buildEnv = await recoveryEnvelope(
          'frozenContextBuildV1_1',
          objectRef('zhiju.execution.context_snapshot', newUuidV7(), scope()) as Common.ObjectRef,
          { request: buildRequest } as unknown as CanonicalJsonObject,
          service,
        );
        // The public request accepts ordinary TypedReference arrays. The finite
        // recovery profile rejects unsupported arrays at the owning Handler.
        for (const answeredInformationRefs of [
          [],
          [resolutionRef, resolutionRef],
          [record(committedPayload(answered)).answerRef],
          [workOrderRef],
        ]) {
          const target = objectRef(
            'zhiju.execution.context_snapshot',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          const envelope = await recoveryEnvelope(
            'frozenContextBuildV1_1',
            target,
            {
              request: { ...buildRequest, answeredInformationRefs },
            } as unknown as CanonicalJsonObject,
            service,
          );
          expect(
            registry.validateOperation('execution.build_context_snapshot', '1.1', envelope),
          ).toEqual({
            valid: true,
            errors: [],
          });
          await expect(
            recoveryEntryRaw.command(envelope, sessionFor(service)),
          ).rejects.toMatchObject({
            code: 'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
          });
          expect(await receiptRows(String(envelope.idempotencyKey))).toEqual([]);
          expect(await contextSnapshotRow(target.objectId)).toBeUndefined();
        }
        for (const change of [
          { sourceSlices: [slice] },
          {
            workOrderContractRef: {
              ...record(read.contractRef),
              contentHash: contentHash('0'.repeat(64)),
            },
          },
          { purpose: 'execution.other_purpose' },
          { audience: objectRef('zhiju.identity.principal', OPERATOR, scope()) },
        ])
          await rejectRecovery(
            'frozenContextBuildV1_1',
            objectRef('zhiju.execution.context_snapshot', newUuidV7(), scope()) as Common.ObjectRef,
            { request: { ...buildRequest, ...change } } as unknown as CanonicalJsonObject,
          );

        if (
          ['REQUEST_EXPIRED', 'CONTROLS_SUPERSEDED', 'BUILDER_SUPERSEDED'].includes(recoveryVariant)
        ) {
          if (recoveryVariant === 'REQUEST_EXPIRED') {
            clock = new Date(definition.expiresAt).getTime() + 1;
          } else {
            clock = Math.max(clock, Date.now());
            const builder = recoveryVariant === 'BUILDER_SUPERSEDED';
            const oldRef = builder ? recoveryBuilderRef : controlsRef;
            const originalPolicy = definedValue(
              (
                await admin.query<{ policy_document: CanonicalJsonObject }>(
                  "SELECT canonical_payload->'policyDocument' AS policy_document FROM identity_policy.policy_version WHERE policy_object_id=$1 AND policy_key_version_id=$2",
                  [oldRef.objectId, oldRef.versionId],
                )
              ).rows[0],
            );
            await registerPolicyVersionAs({
              key: { ...oldRef, versionId: newUuidV7() },
              factId: newUuidV7(),
              idempotencyKey: newUuidV7(),
              effectiveFrom: new Date(clock),
              supersedesRef: oldRef,
              policySchemaRefs: [
                profileReference(
                  builder ? BUILDER_PROFILE : 'execution.work_order_controls.policy@1.1',
                ),
              ],
              policyDocument: originalPolicy.policy_document,
            });
          }
          processPending = buildEnv as CanonicalJsonObject;
          processExecute = (command) => recoveryEntryRaw.command(command, sessionFor(service));
          if (recoveryVariant === 'REQUEST_EXPIRED') {
            // Renew only the worker's independent scan/progress authority. The saved business
            // inputs and the expired Request remain unchanged.
            for (const worker of definedValue(processWorkers)) await worker.stop();
            processWorkers = undefined;
            processAuthorities.length = 0;
            await expect(throughRecoveryProcess(buildEnv, processExecute)).rejects.toThrow(
              'Unexpected recovery wait at 3',
            );
          } else for (const worker of definedValue(processWorkers)) await worker.tick();
          const authority = definedValue(processAuthorities[0]);
          expect(
            await readBlockedInputRecoveryProgress(
              teDb,
              authority.progressContext,
              authority.revalidateProgress,
            ),
          ).toContainEqual(
            expect.objectContaining({
              process_id: blockedInputRecoveryProcessId(
                resultRef as unknown as CanonicalJsonObject,
                proposalId,
              ),
              state: 'SUSPENDED',
              recovery_step: 3,
              blocked_reason_code:
                recoveryVariant === 'REQUEST_EXPIRED'
                  ? 'EXECUTION_CONTEXT_SOURCE_INVALID'
                  : 'POLICY_EXPIRED',
            }),
          );
          expect(
            await contextSnapshotRow(String(record(buildEnv.targetRef).objectId)),
          ).toBeUndefined();
          expect(await receiptRows(String(buildEnv.idempotencyKey))).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
                [woId],
              )
            ).rows,
          ).toEqual([{ attempt_number: 1 }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        if (recoveryVariant === 'SUSPEND') {
          const buildGrant = definedValue(
            recoveryGrants.get(
              `${serviceId}:frozenContextBuildV1_1:zhiju.execution.context_snapshot`,
            ),
          );
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: buildGrant,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI231_SUSPEND_BUILD',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          processPending = buildEnv as CanonicalJsonObject;
          processExecute = (command) => recoveryEntryRaw.command(command, sessionFor(service));
          await definedValue(definedValue(processWorkers)[0]).tick();
          await definedValue(definedValue(processWorkers)[1]).tick();
          const authority = definedValue(processAuthorities[0]);
          expect(
            await readBlockedInputRecoveryProgress(
              teDb,
              authority.progressContext,
              authority.revalidateProgress,
            ),
          ).toContainEqual(
            expect.objectContaining({
              process_id: blockedInputRecoveryProcessId(
                resultRef as unknown as CanonicalJsonObject,
                proposalId,
              ),
              state: 'SUSPENDED',
              recovery_step: 3,
              blocked_reason_code: 'AUTHORIZATION_REVOKED',
            }),
          );
          expect(
            await contextSnapshotRow(String(record(buildEnv.targetRef).objectId)),
          ).toBeUndefined();
          expect(
            (
              await admin.query(
                'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
                [woId],
              )
            ).rows,
          ).toEqual([{ attempt_number: 1 }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        const built = await recoveryEntry.command(buildEnv, sessionFor(service));
        expect(built).toMatchObject({ status: 'COMMITTED' });
        const context2 = record(committedPayload(built)).contextSnapshotRef;
        const context2Row = definedValue(
          await contextSnapshotRow(String(record(context2).objectId)),
        );
        const context2Read = await attemptRead(
          await preparedRead({ snapshotRef: context2 as Common.SnapshotRef }),
        );
        expect(context2Read).toMatchObject({ code: 'COMMITTED', thrown: false });
        if (context2Read.result?.status !== 'COMMITTED')
          throw new Error('Context-2 read did not commit');
        expect(record(context2Read.result.resultPayload).projectContextContract).toEqual(
          context2Row.canonical_payload,
        );
        expect(
          (context2Row.canonical_payload.contextItems as CanonicalJsonObject[]).filter(
            (item) => item.kind === 'MATERIAL',
          ),
        ).toMatchObject([
          {
            subjectRef: confirmedRef,
            value: {
              presence: 'PRESENT',
              value: {
                candidateMaterialRef: candidateMaterial,
                confirmedMaterialRef: confirmedRef,
              },
            },
            epistemicState: 'CONFIRMED',
          },
        ]);

        expect(context2).not.toEqual(contextRef);
        expect(await recoveryEntry.command(buildEnv, sessionFor(service))).toMatchObject({
          status: 'DUPLICATE',
        });
        // An actual worker reads current state and waits; it cannot schedule for the Human.
        processPending = (await recoveryEnvelope(
          'workOrderExecutionStateReadV1',
          workOrderRef,
          { workOrderRef } as unknown as CanonicalJsonObject,
          service,
          undefined,
          true,
        )) as CanonicalJsonObject;
        processExecute = (command) => recoveryEntryRaw.read(command, sessionFor(service));
        processResult = undefined;
        await definedValue(definedValue(processWorkers)[0]).tick();
        if (recoveryVariant === 'BUDGET_EXHAUSTED') {
          expect(processResult).toMatchObject({ retryEligibility: 'EXHAUSTED' });
          const authority = definedValue(processAuthorities[0]);
          expect(
            await readBlockedInputRecoveryProgress(
              teDb,
              authority.progressContext,
              authority.revalidateProgress,
            ),
          ).toContainEqual(
            expect.objectContaining({
              process_id: blockedInputRecoveryProcessId(
                resultRef as unknown as CanonicalJsonObject,
                proposalId,
              ),
              state: 'SUSPENDED',
              recovery_step: 4,
              blocked_reason_code: 'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
            }),
          );
          const refused = await recoveryEnvelope(
            'workOrderRetryScheduleV1',
            workOrderRef,
            {
              previousRunRef: runRef,
              nextAttemptNumber: 2,
              retryReason: 'BLOCKED_INPUT_RESOLVED',
              retryPolicyRef: controlsRef,
            } as unknown as CanonicalJsonObject,
            operator(),
            await woVersion(),
          );
          await expect(recoveryEntryRaw.command(refused, sessionFor())).rejects.toMatchObject({
            code: 'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
          });
          expect(await receiptRows(String(refused.idempotencyKey))).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
                [woId],
              )
            ).rows,
          ).toEqual([]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        expect(processResult).toMatchObject({
          status: 'WAITING_INPUT',
          retryEligibility: 'READY_TO_SCHEDULE',
        });
        expect(
          (
            await admin.query(
              "SELECT recovery_step,state FROM task_execution.process_instance WHERE process_type='blocked-input-recovery@1' AND process_id=$1",
              [
                blockedInputRecoveryProcessId(
                  resultRef as unknown as CanonicalJsonObject,
                  proposalId,
                ),
              ],
            )
          ).rows,
        ).toEqual([{ recovery_step: 4, state: 'ACTIVE' }]);
        expect(
          (
            await admin.query(
              'SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
              [woId],
            )
          ).rows,
        ).toEqual([]);
        processPending = undefined;
        const schedule = await recoveryEnvelope(
          'workOrderRetryScheduleV1',
          workOrderRef,
          {
            previousRunRef: runRef,
            nextAttemptNumber: 2,
            retryReason: 'BLOCKED_INPUT_RESOLVED',
            retryPolicyRef: controlsRef,
          } as unknown as CanonicalJsonObject,
          operator(),
          await woVersion(),
        );
        expect(await recoveryEntry.command(schedule, sessionFor())).toMatchObject({
          status: 'COMMITTED',
        });
        expect(await recoveryEntry.command(schedule, sessionFor())).toMatchObject({
          status: 'DUPLICATE',
        });
        const scheduleAgain = await recoveryEnvelope(
          'workOrderRetryScheduleV1',
          workOrderRef,
          record(schedule.payload) as CanonicalJsonObject,
          operator(),
          await woVersion(),
        );
        expect(await recoveryEntryRaw.command(scheduleAgain, sessionFor())).toMatchObject({
          status: 'COMMITTED',
        });
        await rejectRecovery(
          'workOrderRetryScheduleV1',
          workOrderRef,
          { ...record(schedule.payload), nextAttemptNumber: 3 },
          operator(),
          await woVersion(),
        );
        expect(
          (
            await admin.query(
              'SELECT next_attempt_number FROM task_execution.work_order_retry_intent WHERE work_order_id=$1',
              [woId],
            )
          ).rows,
        ).toEqual([{ next_attempt_number: 2 }]);

        faultFirstRunCommands = true;
        const run2 = objectRef('execution.run', newUuidV7(), scope()) as Common.ObjectRef;
        const bundle2Envelope = await firstRunEnvelope(
          'identity.issue_execution_capability_bundle',
          objectRef(
            'zhiju.identity.execution_capability_bundle',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef,
          {
            runRef: run2,
            workOrderRef,
            workOrderContractRef: read.contractRef,
            contextSnapshotRef: context2,
            servicePrincipalRef: { principalKind: 'SERVICE', principalId: serviceId },
            requestedCapabilities: revised.allowedCapabilities,
          } as unknown as CanonicalJsonObject,
          service,
        );
        if (recoveryVariant === 'STALE_CONTEXT') {
          await throughRecoveryProcess(
            await recoveryEnvelope(
              'workOrderExecutionStateReadV1',
              workOrderRef,
              { workOrderRef } as unknown as CanonicalJsonObject,
              service,
              undefined,
              true,
            ),
            (command) => recoveryEntryRaw.read(command, sessionFor(service)),
          );
          // A committed build Receipt remains history when the current Snapshot expires.
          // The saved Process command must keep its old bytes and cannot swap in a new Context.
          clock = definedValue(context2Row.effective_expires_at).getTime() + 1;
          const expiredBundleEnvelope = await firstRunEnvelope(
            'identity.issue_execution_capability_bundle',
            bundle2Envelope.targetRef,
            bundle2Envelope.payload,
            service,
          );
          processPending = expiredBundleEnvelope as unknown as CanonicalJsonObject;
          processExecute = (command) => firstRunEntryRaw.issueBundle(command, sessionFor(service));
          await definedValue(definedValue(processWorkers)[0]).tick();
          await definedValue(definedValue(processWorkers)[1]).tick();
          const processId = blockedInputRecoveryProcessId(
            resultRef as unknown as CanonicalJsonObject,
            proposalId,
          );
          const saved = await admin.query<{ command_bytes: CanonicalJsonObject }>(
            'SELECT command_bytes FROM task_execution.recovery_process_command WHERE process_id=$1 AND step_no=5',
            [processId],
          );
          const originalCommand = structuredClone(definedValue(saved.rows[0]).command_bytes);
          expect(originalCommand.payload).toMatchObject({ contextSnapshotRef: context2 });
          const authority = definedValue(processAuthorities[0]);
          expect(
            await readBlockedInputRecoveryProgress(
              teDb,
              authority.progressContext,
              authority.revalidateProgress,
            ),
          ).toContainEqual(
            expect.objectContaining({
              process_id: processId,
              state: 'SUSPENDED',
              recovery_step: 5,
              blocked_reason_code: 'EXECUTION_CONTEXT_SOURCE_INVALID',
            }),
          );
          expect(await receiptRows(String(expiredBundleEnvelope.idempotencyKey))).toEqual([]);
          const replacementSlice = await captureSlice({
            principal: service,
            purpose: PURPOSE_DOCUMENT,
            capturePolicyRef: captureRef,
            idempotencyKey: newUuidV7(),
          });
          const replacementEnvelope = await recoveryEnvelope(
            'frozenContextBuildV1_1',
            objectRef('zhiju.execution.context_snapshot', newUuidV7(), scope()) as Common.ObjectRef,
            {
              request: {
                ...buildRequest,
                expiresAt: new Date(clock + 30_000).toISOString(),
                sourceSlices: [replacementSlice],
              },
            } as unknown as CanonicalJsonObject,
            service,
          );
          const replacement = await recoveryEntryRaw.command(
            replacementEnvelope,
            sessionFor(service),
          );
          expect(replacement).toMatchObject({ status: 'COMMITTED' });
          const replacementRef = record(committedPayload(replacement)).contextSnapshotRef;
          expect(replacementRef).not.toEqual(context2);
          expect(replacementEnvelope.idempotencyKey).not.toEqual(buildEnv.idempotencyKey);
          expect(await contextSnapshotRow(String(record(context2).objectId))).toEqual(context2Row);
          expect(
            (
              await admin.query(
                'SELECT command_bytes FROM task_execution.recovery_process_command WHERE process_id=$1 AND step_no=5',
                [processId],
              )
            ).rows,
          ).toEqual([{ command_bytes: originalCommand }]);
          expect(
            (
              await admin.query(
                'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1',
                [woId],
              )
            ).rows,
          ).toEqual([{ attempt_number: 1 }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        const bundle2 = await firstRunEntry.issueBundle(bundle2Envelope, sessionFor(service));
        expect(bundle2).toMatchObject({ status: 'COMMITTED' });
        const bundle2Ref = record(committedPayload(bundle2 as CommandResult)).bundleRef;
        const bundle2Row = (
          await admin.query(
            'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
            [record(bundle2Ref).objectId],
          )
        ).rows[0];
        const deadline2 = (bundle2Row.valid_until as Date).toISOString();
        const create2 = await firstRunEnvelope(
          'execution.create_run',
          run2,
          {
            creation: {
              workOrderRef,
              workOrderContractRef: read.contractRef,
              contextSnapshotRef: context2,
              capabilityGrantRef: bundle2Ref,
              leasePolicyRef: controlsRef,
              attemptNumber: 2,
              runtimeBinding,
              executionDeadline: deadline2,
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        if (recoveryVariant === 'NORMAL') {
          // A saved Resolution/Context/Bundle must not hide current Human
          // resolve revocation behind an answer Grant with the same code.
          expect(recoveryConfig.humanCapabilityCodes.requestResolve).toBe(
            recoveryConfig.humanCapabilityCodes.answerSubmit,
          );
          const grantKey = `${OPERATOR}:informationRequestResolveV1:execution.information_request`;
          const resolvedBeforeRevoke = await denialSnapshot();
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: definedValue(recoveryGrants.get(grantKey)),
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI232_R2_REVOKE_CURRENT_RESOLVE',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          const remainingAnswerGrant = await grant({
            capabilityCode: recoveryConfig.humanCapabilityCodes.answerSubmit,
            action: 'execution.information_request.answer.submit.v1',
            selectorType: 'TARGET_TYPE',
            targetObjectType: 'execution.information_request',
          });
          expect(
            await readRecoveryHumanEligibility(
              identityDeps([fixture.projectId], service),
              eligibilityInput,
              {
                ...historyAuthority,
                requiredCapabilities: [definedValue(historyAuthority.requiredCapabilities[0])],
              },
            ),
          ).toMatchObject({ useStatus: 'USABLE' });
          const refusedContextTarget = objectRef(
            'zhiju.execution.context_snapshot',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          const refusedContext = await recoveryEnvelope(
            'frozenContextBuildV1_1',
            refusedContextTarget,
            { request: buildRequest } as unknown as CanonicalJsonObject,
            service,
          );
          await expect(
            recoveryEntryRaw.command(refusedContext, sessionFor(service)),
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          expect(await contextSnapshotRow(refusedContextTarget.objectId)).toBeUndefined();
          expect(await receiptRows(String(refusedContext.idempotencyKey))).toEqual([]);
          const refusedBundleTarget = objectRef(
            'zhiju.identity.execution_capability_bundle',
            newUuidV7(),
            scope(),
          ) as Common.ObjectRef;
          const refusedBundle = await firstRunEnvelope(
            'identity.issue_execution_capability_bundle',
            refusedBundleTarget,
            bundle2Envelope.payload,
            service,
          );
          await expect(
            firstRunEntryRaw.issueBundle(refusedBundle, sessionFor(service)),
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          expect(
            (
              await admin.query(
                'SELECT bundle_id FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
                [refusedBundleTarget.objectId],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT command_id FROM identity_policy.command_receipt WHERE idempotency_key=$1',
                [refusedBundle.idempotencyKey],
              )
            ).rows,
          ).toEqual([]);
          await expect(
            firstRunEntryRaw.createRun(create2, sessionFor(service)),
          ).rejects.toMatchObject({
            code: 'AUTHORIZATION_DECISION_INVALID',
          });
          expect(
            (
              await admin.query('SELECT run_id FROM task_execution.run WHERE run_id=$1', [
                run2.objectId,
              ])
            ).rows,
          ).toEqual([]);
          expect(await receiptRows(create2.idempotencyKey)).toEqual([]);
          expect(await denialSnapshot()).toEqual(resolvedBeforeRevoke);
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: remainingAnswerGrant,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI232_R2_RESTORE_FULL_RIGHTS',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          const restoredGrant = await grant({
            capabilityCode: recoveryConfig.humanCapabilityCodes.requestResolve,
            action: 'execution.information_request.resolve.v1',
            actions: [
              'execution.information_request.answer.submit.v1',
              'execution.information_request.resolve.v1',
            ],
            selectorType: 'TARGET_TYPE',
            targetObjectType: 'execution.information_request',
          });
          recoveryGrants.set(grantKey, restoredGrant);
          recoveryGrants.set(
            `${OPERATOR}:informationAnswerSubmitV1:execution.information_request`,
            restoredGrant,
          );
        }
        if (recoveryVariant === 'NORMAL')
          for (const change of [
            { contextSnapshotRef: contextRef },
            { runtimeBinding: { ...runtimeBinding, modelId: 'synthetic.other' } },
            {
              runtimeBinding: {
                ...runtimeBinding,
                executionNodeRef: {
                  system: 'synthetic',
                  resourceType: 'runtime.node',
                  externalId: 'unsupported-node',
                  observedAt: new Date(clock).toISOString(),
                },
              },
            },
          ]) {
            const refused = await firstRunEnvelope(
              'execution.create_run',
              run2,
              {
                creation: { ...record(create2.payload.creation), ...change },
              } as unknown as CanonicalJsonObject,
              service,
            );
            expect(registry.validateOperation('execution.create_run', '1.0', refused).valid).toBe(
              true,
            );
            await expect(
              firstRunEntryRaw.createRun(refused, sessionFor(service)),
            ).rejects.toBeDefined();
            expect(await receiptRows(refused.idempotencyKey)).toEqual([]);
            expect(
              (
                await admin.query('SELECT run_id FROM task_execution.run WHERE run_id=$1', [
                  run2.objectId,
                ])
              ).rows,
            ).toEqual([]);
          }
        const created2 = await firstRunEntry.createRun(create2, sessionFor(service));
        expect(created2).toMatchObject({ status: 'COMMITTED' });
        const created2Data = record(committedPayload(created2 as CommandResult));
        expect(created2Data.fencingToken).toBe(2);
        expect(await firstRunEntry.createRun(create2, sessionFor(service))).toMatchObject({
          status: 'DUPLICATE',
        });
        const attempt2 = objectRef(
          'integration.runtime_attempt',
          newUuidV7(),
          scope(),
        ) as Common.ObjectRef;
        const dispatch2 = await firstRunEnvelope(
          'integration.request_runtime_dispatch',
          attempt2,
          {
            request: {
              workOrderRef,
              runRef: run2,
              workOrderContractRef: read.contractRef,
              contextSnapshotRef: context2,
              capabilityGrantRef: bundle2Ref,
              runtimeBinding,
              stableIdempotencyKey: newUuidV7(),
              requestedAt: new Date(clock).toISOString(),
            },
          } as unknown as CanonicalJsonObject,
          service,
        );
        if (recoveryVariant === 'NORMAL')
          for (const change of [
            { contextSnapshotRef: contextRef },
            { capabilityGrantRef: bundleRef },
            { runtimeBinding: { ...runtimeBinding, modelId: 'synthetic.other' } },
          ]) {
            const refused = await firstRunEnvelope(
              'integration.request_runtime_dispatch',
              attempt2,
              {
                request: { ...record(dispatch2.payload.request), ...change },
              } as unknown as CanonicalJsonObject,
              service,
            );
            await expect(
              firstRunEntryRaw.dispatch(refused, sessionFor(service)),
            ).rejects.toBeDefined();
            expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
          }
        expect(await firstRunEntry.dispatch(dispatch2, sessionFor(service))).toMatchObject({
          status: 'SUCCEEDED',
        });
        const binding2 = await firstRunEntry.getRuntimeAttemptBinding(
          await firstRunQuery(
            'integration.get_runtime_attempt_binding',
            attempt2,
            { attemptRef: attempt2 } as unknown as CanonicalJsonObject,
            'runtimeAttemptBindingReadV1',
          ),
          sessionFor(service),
        );
        const start2 = await firstRunEnvelope(
          'execution.start_run',
          run2,
          {
            leaseId: created2Data.leaseId,
            fencingToken: 2,
            runtimeAttemptRef: attempt2,
            startedAt: new Date(clock).toISOString(),
          } as unknown as CanonicalJsonObject,
          service,
          1,
        );
        if (recoveryVariant === 'NORMAL')
          for (const change of [{ fencingToken: 1 }, { runtimeAttemptRef: attemptRef }]) {
            const refused = await firstRunEnvelope(
              'execution.start_run',
              run2,
              { ...start2.payload, ...change } as unknown as CanonicalJsonObject,
              service,
              1,
            );
            await expect(
              firstRunEntryRaw.startRun(refused, sessionFor(service)),
            ).rejects.toBeDefined();
            expect(await receiptRows(refused.idempotencyKey)).toEqual([]);
          }
        expect(await firstRunEntry.startRun(start2, sessionFor(service))).toMatchObject({
          status: 'COMMITTED',
        });
        expect(await reconcileWo(run2)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: 'RUNNING' },
        });
        expect(await reconcileTask(run2)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: otherChildId ? 'WAITING_INPUT' : 'IN_PROGRESS' },
        });
        const finalQuery2 = await firstRunQuery(
          'integration.get_runtime_final_observation',
          attempt2,
          { attemptRef: attempt2 } as unknown as CanonicalJsonObject,
          'runtimeFinalReadV1',
        );
        if (recoveryVariant === 'SECOND_WRONG_SESSION') {
          await expect(
            firstRunEntryRaw.observeRuntimeFinal(finalQuery2, sessionFor(service)),
          ).rejects.toBeDefined();
          expect(
            (
              await admin.query(
                'SELECT observation_id FROM integration_gateway.runtime_final_observation WHERE attempt_id=$1',
                [attempt2.objectId],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT result_id FROM task_execution.agent_result WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId, attempt2.objectId]);
          await waitForDeadline(
            Math.max(0, Date.parse(deadline2) - Date.now() + 100),
            'Run-2 bad session expiry',
          );
          clock = Date.now();
          const expire = await firstRunEnvelope(
            'execution.expire_run',
            run2,
            { reason: 'DEADLINE_EXCEEDED' },
            service,
            2,
          );
          expect(await firstRunEntryRaw.expireRun(expire, sessionFor(service))).toMatchObject({
            status: 'COMMITTED',
          });
          expect(
            (
              await admin.query(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'EXPIRED' }]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        const final2 = await firstRunEntry.observeRuntimeFinal(finalQuery2, sessionFor(service));
        if (final2 === undefined) throw new Error('Run-2 final absent');
        if (!['SECOND_BLOCKED', 'SECOND_PARTIAL', 'SECOND_FAILED'].includes(recoveryVariant))
          expect(record(final2.agentResultContract).executionOutcome).toBe('COMPLETED');
        const result2Body = record(final2.agentResultContract) as unknown as CanonicalJsonObject,
          result2Target = objectRef(
            'execution.agent_result',
            String(record(final2.agentResultContract).agentResultId),
            scope(),
          ) as Common.ObjectRef;
        const lateRun1 = await firstRunEnvelope(
          'execution.submit_agent_result',
          resultTarget,
          {
            agentResultContract: resultBody,
            runFencingToken: 2,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntryRaw.submitAgentResult(lateRun1, sessionFor(service)),
        ).rejects.toBeDefined();
        expect(await receiptRows(lateRun1.idempotencyKey)).toEqual([]);
        if (['SECOND_BLOCKED', 'SECOND_PARTIAL', 'SECOND_FAILED'].includes(recoveryVariant)) {
          const unsupportedSecond = await firstRunEnvelope(
            'execution.submit_agent_result',
            result2Target,
            {
              agentResultContract: result2Body,
              runFencingToken: 2,
              runtimeSubmissionRef: final2.runtimeSubmissionRef,
            },
            service,
          );
          await expect(
            firstRunEntryRaw.submitAgentResult(unsupportedSecond, sessionFor(service)),
          ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
          expect(await receiptRows(unsupportedSecond.idempotencyKey)).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT result_id FROM task_execution.agent_result WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT result_id FROM task_execution.run_final_submission_claim WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([]);
          const third = await firstRunEnvelope(
            'execution.create_run',
            objectRef('execution.run', newUuidV7(), scope()) as Common.ObjectRef,
            { creation: { ...record(create2.payload.creation), attemptNumber: 3 } },
            service,
          );
          await expect(
            firstRunEntryRaw.createRun(third, sessionFor(service)),
          ).rejects.toBeDefined();
          expect(await receiptRows(third.idempotencyKey)).toEqual([]);
          expect(
            (
              await admin.query(
                'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
                [woId],
              )
            ).rows,
          ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId, attempt2.objectId]);
          // Close this test's actual unsupported invocation before the next Project scan.
          // Expiry is independent and does not accept its rejected Result.
          const expiryWait = Math.max(0, Date.parse(deadline2) - Date.now() + 100);
          if (expiryWait > 0) await waitForDeadline(expiryWait, 'Run-2 unsupported final cleanup');
          clock = Date.now();
          const expireUnsupported = await firstRunEnvelope(
            'execution.expire_run',
            run2,
            { reason: 'DEADLINE_EXCEEDED' },
            service,
            2,
          );
          expect(
            await firstRunEntryRaw.expireRun(expireUnsupported, sessionFor(service)),
          ).toMatchObject({ status: 'COMMITTED' });
          expect(
            (
              await admin.query(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'EXPIRED' }]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        const submit2 = await firstRunEntry.submitAgentResult(
          await firstRunEnvelope(
            'execution.submit_agent_result',
            result2Target,
            {
              agentResultContract: result2Body,
              runFencingToken: 2,
              runtimeSubmissionRef: final2.runtimeSubmissionRef,
            },
            service,
          ),
          sessionFor(service),
        );
        expect(submit2).toMatchObject({ status: 'COMMITTED' });
        const result2Ref = record(committedPayload(submit2 as CommandResult)).agentResultRef;
        expect(
          await firstRunEntry.recordRunResult(
            await firstRunEnvelope(
              'execution.record_run_result',
              run2,
              { agentResultRef: result2Ref } as unknown as CanonicalJsonObject,
              service,
              2,
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        const validate2 = await firstRunEntry.validateAgentResult(
          await firstRunEnvelope(
            'execution.validate_agent_result',
            objectRef(
              'zhiju.execution.agent_result_validation_bundle',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
            {
              agentResultRef: result2Ref,
              runRef: run2,
              runtimeAttemptRef: attempt2,
              policyRef: controlsRef,
              evaluatorRef: finalEvaluator,
            } as unknown as CanonicalJsonObject,
            service,
          ),
          sessionFor(service),
        );
        expect(validate2).toMatchObject({ status: 'COMMITTED' });
        const validations2 = record(committedPayload(validate2 as CommandResult));
        const accept2 = await firstRunEntry.acceptAgentResult(
          await firstRunEnvelope(
            'execution.accept_agent_result',
            objectRef(
              'execution.agent_result_acceptance',
              newUuidV7(),
              scope(),
            ) as Common.ObjectRef,
            {
              agentResultRef: result2Ref,
              schemaValidationRef: validations2.schemaValidationRef,
              identityValidationRef: validations2.identityValidationRef,
              runBindingValidationRef: validations2.runBindingValidationRef,
              scopeValidationRef: validations2.scopeValidationRef,
              businessOutputValidationRef: validations2.businessOutputValidationRef,
              disposition: 'ACCEPTED',
              reasons: [],
            } as unknown as CanonicalJsonObject,
            service,
          ),
          sessionFor(service),
        );
        expect(accept2).toMatchObject({ status: 'COMMITTED' });
        const acceptance2 = record(committedPayload(accept2 as CommandResult)).acceptanceRecordRef;
        if (recoveryVariant === 'SECOND_EXPIRY_RACE') {
          await waitForDeadline(
            Math.max(0, Date.parse(deadline2) - Date.now() + 100),
            'Run-2 finalize/expiry arbitration',
          );
          clock = Date.now();
          const final = await firstRunEnvelope(
            'execution.finalize_run_from_acceptance',
            run2,
            { acceptanceRecordRef: acceptance2 } as CanonicalJsonObject,
            service,
            3,
          );
          const expiry = await firstRunEnvelope(
            'execution.expire_run',
            run2,
            { reason: 'DEADLINE_EXCEEDED' },
            service,
            3,
          );
          const race = await Promise.allSettled([
            firstRunEntryRaw.finalizeRun(final, sessionFor(service)),
            firstRunEntryRaw.expireRun(expiry, sessionFor(service)),
          ]);
          expect(race[0].status).toBe('rejected');
          expect(race[1]).toMatchObject({ status: 'fulfilled', value: { status: 'COMMITTED' } });
          expect(
            (
              await admin.query('SELECT status FROM task_execution.run WHERE run_id=$1', [
                run2.objectId,
              ])
            ).rows,
          ).toEqual([{ status: 'TIMED_OUT' }]);
          expect(
            (
              await admin.query(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [run2.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'EXPIRED' }]);
          expect(
            (
              await admin.query(
                "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
                [run2.objectId],
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
          const resume = await firstRunEnvelope(
            'execution.start_run',
            run2,
            start2.payload,
            service,
            4,
          );
          await expect(
            firstRunEntryRaw.startRun(resume, sessionFor(service)),
          ).rejects.toBeDefined();
          expect(
            (
              await admin.query(
                'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
                [woId],
              )
            ).rows,
          ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }

        expect(
          await firstRunEntry.finalizeRun(
            await firstRunEnvelope(
              'execution.finalize_run_from_acceptance',
              run2,
              { acceptanceRecordRef: acceptance2 } as unknown as CanonicalJsonObject,
              service,
              3,
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ status: 'COMMITTED' });
        expect(
          await firstRunEntry.getRunState(
            await firstRunQuery(
              'execution.get_run_state',
              run2,
              { runRef: run2 } as unknown as CanonicalJsonObject,
              'runStateReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({
          status: 'SUCCEEDED',
          aggregateVersion: 4,
          resultRef: result2Ref,
        });
        expect(
          await firstRunEntry.getAgentResult(
            await firstRunQuery(
              'execution.get_agent_result',
              result2Ref as Common.ContentAddressedRef,
              { agentResultRef: result2Ref } as CanonicalJsonObject,
              'agentResultReadV1',
            ),
            sessionFor(service),
          ),
        ).toMatchObject({ agentResultContract: result2Body });
        expect(await reconcileWo(run2)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: 'COMPLETION_PENDING' },
        });
        expect(await reconcileTask(run2)).toMatchObject({
          status: 'COMMITTED',
          resultPayload: { status: otherChildId ? 'WAITING_INPUT' : 'COMPLETION_PENDING' },
        });
        const woState = await recoveryEntry.read(
          await recoveryEnvelope(
            'workOrderExecutionStateReadV1',
            workOrderRef,
            { workOrderRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(woState).toMatchObject({
          status: 'COMPLETION_PENDING',
          blockerRefs: [],
          retryEligibility: 'CONSUMED',
        });
        const taskState = await recoveryEntry.read(
          await recoveryEnvelope(
            'taskStateReadV1',
            revised.taskRef as Common.ObjectRef,
            { taskRef: revised.taskRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          sessionFor(service),
        );
        expect(taskState).toMatchObject({
          status: otherChildId ? 'WAITING_INPUT' : 'COMPLETION_PENDING',
          blockerRefs: otherChildId ? [otherChildResultRef] : [],
          completionUseStatus: 'NOT_EVALUATED',
        });
        if (otherChildId) {
          expect(record(taskState).workOrderRefs).toHaveLength(3);
          expect(record(taskState).workOrderRefs).toContainEqual(
            objectRef(WORK_ORDER_V11, otherChildId, scope()),
          );
          expect(record(taskState).workOrderRefs).toContainEqual(
            objectRef(WORK_ORDER_V11, definedValue(otherDraftChildId), scope()),
          );
          expect(
            (
              await admin.query(
                'SELECT status FROM task_execution.work_order WHERE work_order_id=$1',
                [otherChildId],
              )
            ).rows,
          ).toEqual([{ status: 'WAITING_INPUT' }]);
          expect(runtimeDriver.invokedAttemptIds).toEqual([
            attemptRef.objectId,
            definedValue(otherChildAttemptRef).objectId,
            attempt2.objectId,
          ]);
          for (const worker of definedValue(processWorkers)) await worker.stop();
          return;
        }
        expect(
          (
            await admin.query(
              'SELECT attempt_number,status,fencing_token,context_snapshot_ref,capability_grant_ref FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
              [woId],
            )
          ).rows,
        ).toMatchObject([
          {
            attempt_number: 1,
            status: 'SUCCEEDED',
            fencing_token: '1',
            context_snapshot_ref: contextRef,
            capability_grant_ref: bundleRef,
          },
          {
            attempt_number: 2,
            status: 'SUCCEEDED',
            fencing_token: '2',
            context_snapshot_ref: context2,
            capability_grant_ref: bundle2Ref,
          },
        ]);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM task_execution.work_order_run_claim WHERE work_order_id=$1 AND status='ACTIVE'",
              [woId],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(
          await admin.query(
            `SELECT to_jsonb(r) run_bytes,a.result_payload result_bytes,ac.canonical_payload acceptance_bytes,c.canonical_payload context_bytes,wc.canonical_payload contract_bytes,r.result_ref,r.acceptance_ref,r.context_snapshot_ref,r.work_order_contract_ref,c.payload_hash context_hash,wc.payload_hash contract_hash FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) JOIN task_execution.agent_result_acceptance ac USING(result_id) JOIN task_execution.context_snapshot c ON c.snapshot_id=(r.context_snapshot_ref->>'snapshotId')::uuid JOIN task_execution.work_order_contract wc ON wc.contract_id=(r.work_order_contract_ref->>'objectId')::uuid WHERE r.run_id=$1`,
            [runRef.objectId],
          ),
        ).toMatchObject({ rows: savedHistory.rows });
        expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId, attempt2.objectId]);
        for (const table of [
          'recovery_command_material',
          'information_request_origin',
          'answer_submission',
          'answer_resolution',
          'resolution_receipt_observation',
          'work_order_retry_intent',
          'run_retry_intent_consumption',
          'run_budget_reservation',
          'run_budget_consumption',
          'recovery_process_command',
        ]) {
          const tableName = `task_execution.${table}`;
          expect(
            (
              await admin.query<{ n: number }>(
                `SELECT count(*)::int n FROM ${tableName} WHERE project_id=$1`,
                [fixture.projectId],
              )
            ).rows[0]?.n,
            table,
          ).toBeGreaterThan(0);
          const hidden = await withTaskExecutionTransaction(
            teDb,
            { ...runnerContext(service), allowedProjectIds: [newUuidV7()] },
            (trx) =>
              sql`SELECT project_id FROM ${sql.table(tableName)} WHERE project_id=${fixture.projectId}::uuid`.execute(
                trx,
              ),
          );
          expect(hidden.rows, `TE-REC-D-011 ${table} foreign Project`).toEqual([]);
          for (const verb of ['UPDATE', 'DELETE']) {
            await expect(
              withTaskExecutionTransaction(teDb, runnerContext(service), (trx) =>
                verb === 'UPDATE'
                  ? sql`UPDATE ${sql.table(tableName)} SET project_id=project_id WHERE project_id=${fixture.projectId}::uuid`.execute(
                      trx,
                    )
                  : sql`DELETE FROM ${sql.table(tableName)} WHERE project_id=${fixture.projectId}::uuid`.execute(
                      trx,
                    ),
              ),
            ).rejects.toMatchObject({ code: '42501' });
            await expect(
              admin.query(
                verb === 'UPDATE'
                  ? `UPDATE ${tableName} SET project_id=project_id WHERE project_id=$1`
                  : `DELETE FROM ${tableName} WHERE project_id=$1`,
                [fixture.projectId],
              ),
            ).rejects.toMatchObject({ code: '55000' });
          }
        }
        const budgetRows = (
          await admin.query<{
            attempt_number: number;
            reserved_seconds: number;
            total_seconds: number;
            consumed_seconds: number;
          }>(
            'SELECT b.attempt_number,b.reserved_seconds,b.total_seconds,c.consumed_seconds FROM task_execution.run_budget_reservation b JOIN task_execution.run_budget_consumption c USING(run_id) WHERE b.work_order_id=$1 ORDER BY b.attempt_number',
            [woId],
          )
        ).rows;
        expect(budgetRows).toHaveLength(2);
        expect(budgetRows[1]?.reserved_seconds).toBe(
          definedValue(budgetRows[0]).total_seconds - definedValue(budgetRows[0]).consumed_seconds,
        );
        expect(
          budgetRows.every(
            (row) => row.consumed_seconds >= 0 && row.consumed_seconds <= row.reserved_seconds,
          ),
        ).toBe(true);
        const third = await firstRunEnvelope(
          'execution.create_run',
          objectRef('execution.run', newUuidV7(), scope()) as Common.ObjectRef,
          {
            creation: { ...record(record(create2.payload).creation), attemptNumber: 3 },
          },
          service,
        );
        await expect(firstRunEntryRaw.createRun(third, sessionFor(service))).rejects.toBeDefined();
        expect(await receiptRows(third.idempotencyKey)).toEqual([]);
        expect(
          (
            await admin.query(
              'SELECT attempt_number FROM task_execution.run WHERE work_order_id=$1 ORDER BY attempt_number',
              [woId],
            )
          ).rows,
        ).toEqual([{ attempt_number: 1 }, { attempt_number: 2 }]);
        if (recoveryVariant === 'NORMAL') {
          const receiptGrant = definedValue(
            recoveryGrants.get(
              `${OPERATOR}:confirmationReceiptDiscoverV1:zhiju.project.command_receipt`,
            ),
          );
          expect(
            await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
              targetId: receiptGrant,
              expectedAggregateVersion: '1',
              scope: {
                scopeKind: 'PROJECT',
                enterpriseId: fixture.enterpriseId,
                projectId: fixture.projectId,
              },
              reasonCode: 'WI231_REVOKE_RECEIPT_DISCOVERY',
              effectiveAt: new Date(clock),
              idempotencyKey: newUuidV7(),
            }),
          ).toMatchObject({ status: 'COMMITTED' });
          const receiptReads: string[] = [];
          const probe: KyselyPlugin = {
            transformQuery(args) {
              if (['SelectQueryNode', 'RawNode'].includes(args.node.kind))
                receiptReads.push(JSON.stringify(args.node));
              return args.node;
            },
            transformResult: (args) => Promise.resolve(args.result),
          };
          await expect(
            createBlockedInputRecoveryEntry({
              ...recoveryConfig,
              enterpriseProjectDb: enterpriseProjectDb.withPlugin(probe),
            }).discoverReceipt(
              String(confirm.commandId),
              sessionFor(),
              discovery.authorizationDecisionRef,
              scope(),
            ),
          ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          expect(receiptReads.filter((query) => query.includes('enterprise_project'))).toEqual([]);
        }
        const resolvedFactsBeforeRevoke = await denialSnapshot();
        const resolveGrant = definedValue(
          recoveryGrants.get(
            `${OPERATOR}:informationRequestResolveV1:execution.information_request`,
          ),
        );
        expect(
          await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
            targetId: resolveGrant,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            },
            reasonCode: 'WI231_REVOKE_RESOLVE',
            effectiveAt: new Date(clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        queryReads.length = 0;
        await expect(
          createBlockedInputRecoveryEntry({
            ...recoveryConfig,
            taskExecutionDb: guardedTeDb,
          }).command(resolve, sessionFor()),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(protectedReads()).toEqual([]);
        await expect(
          readRecoveryHumanEligibility(
            identityDeps([fixture.projectId], service),
            eligibilityInput,
            historyAuthority,
          ),
        ).rejects.toBeDefined();
        expect(await denialSnapshot()).toEqual(resolvedFactsBeforeRevoke);
        const roleId = definedValue(
          (
            await admin.query<{ assignment_id: string }>(
              "SELECT id AS assignment_id FROM identity_policy.role_assignment WHERE principal_id=$1 AND project_id=$2 AND role_code='project.customer_material.confirmer' AND status='ACTIVE'",
              [OPERATOR, fixture.projectId],
            )
          ).rows[0]?.assignment_id,
        );
        expect(
          await revokeRole(identityDeps([fixture.projectId]), {
            targetId: roleId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            },
            reasonCode: 'WI231_REVOKE_CONFIRMER',
            effectiveAt: new Date(clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        queryReads.length = 0;
        const roleGuardedEntry = createBlockedInputRecoveryEntry({
          ...recoveryConfig,
          taskExecutionDb: guardedTeDb,
        });
        const deniedRead = await recoveryEnvelope(
          'informationRequestReadV1',
          requestRef,
          { informationRequestRef: requestRef } as unknown as CanonicalJsonObject,
          operator(),
          undefined,
          true,
        );
        await expect(roleGuardedEntry.read(deniedRead, sessionFor())).rejects.toMatchObject({
          code: 'AUTHORIZATION_DECISION_INVALID',
        });
        expect(protectedReads()).toEqual([]);

        expect(processStep).toBe(13);
        expect(processHandoffs.size).toBe(13);
        for (const worker of definedValue(processWorkers)) await worker.stop();
        expect(final2.runtimeAdapterIdentityRef).not.toEqual(finalView.runtimeAdapterIdentityRef);
        expect(record(binding2.acknowledgement).runtimeSessionRef).not.toEqual(
          record(attemptBinding.acknowledgement).runtimeSessionRef,
        );

        return;
      }
      const boundIdentity = await admin.query<{
        runtime_adapter_identity_ref: CanonicalJsonObject;
      }>('SELECT runtime_adapter_identity_ref FROM task_execution.run WHERE run_id=$1', [
        runRef.objectId,
      ]);
      expect(boundIdentity.rows).toEqual([
        { runtime_adapter_identity_ref: finalView.runtimeAdapterIdentityRef },
      ]);
      expect(finalView.runtimeAdapterIdentityRef).not.toEqual(attemptRef);
      const storedResult = await admin.query<{ result_payload: CanonicalJsonObject }>(
        'SELECT result_payload FROM task_execution.agent_result WHERE run_id=$1',
        [runRef.objectId],
      );
      expect(storedResult.rows[0]?.result_payload.submittedByRuntime).toEqual(
        finalView.runtimeAdapterIdentityRef,
      );
      expect(
        (
          await admin.query<{
            result_count: number;
            claim_count: number;
            bundle_count: number;
            fact_count: number;
            acceptance_count: number;
          }>(
            `SELECT
               (SELECT count(*)::int FROM task_execution.agent_result WHERE run_id=$1) AS result_count,
               (SELECT count(*)::int FROM task_execution.run_final_submission_claim WHERE run_id=$1) AS claim_count,
               (SELECT count(*)::int FROM task_execution.result_validation_bundle WHERE run_id=$1) AS bundle_count,
               (SELECT count(*)::int FROM task_execution.result_validation_fact WHERE bundle_id=$2) AS fact_count,
               (SELECT count(*)::int FROM task_execution.agent_result_acceptance WHERE run_id=$1) AS acceptance_count`,
            [runRef.objectId, validationTarget.objectId],
          )
        ).rows,
      ).toEqual([
        {
          result_count: 1,
          claim_count: 1,
          bundle_count: 1,
          fact_count: 5,
          acceptance_count: 1,
        },
      ]);
      const replayFinalize = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        { acceptanceRecordRef } as unknown as CanonicalJsonObject,
        service,
        3,
      );
      expect(await firstRunEntry.finalizeRun(replayFinalize, sessionFor(service))).toMatchObject({
        status: 'COMMITTED',
        resultPayload: committedPayload(finalized as CommandResult),
      });
      const replaySubmit = await firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: resultBody,
          runFencingToken: 1,
          runtimeSubmissionRef: finalView.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        service,
      );
      expect(
        await firstRunEntry.submitAgentResult(replaySubmit, sessionFor(service)),
      ).toMatchObject({
        status: 'COMMITTED',
        resultPayload: committedPayload(submitted as CommandResult),
      });
      const replayRecord = await firstRunEnvelope(
        'execution.record_run_result',
        runRef,
        { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
        service,
        2,
      );
      expect(await firstRunEntry.recordRunResult(replayRecord, sessionFor(service))).toMatchObject({
        status: 'COMMITTED',
        resultPayload: committedPayload(recorded as CommandResult),
      });
      const replayValidate = await firstRunEnvelope(
        'execution.validate_agent_result',
        validationTarget,
        record(validateEnvelope.payload) as CanonicalJsonObject,
        service,
      );
      expect(
        await firstRunEntry.validateAgentResult(replayValidate, sessionFor(service)),
      ).toMatchObject({
        status: 'COMMITTED',
        resultPayload: committedPayload(validatedFinal as CommandResult),
      });
      const replayAccept = await firstRunEnvelope(
        'execution.accept_agent_result',
        acceptanceTarget,
        record(acceptEnvelope.payload) as CanonicalJsonObject,
        service,
      );
      expect(
        await firstRunEntry.acceptAgentResult(replayAccept, sessionFor(service)),
      ).toMatchObject({
        status: 'COMMITTED',
        resultPayload: committedPayload(accepted as CommandResult),
      });
      const prematureExpire = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        4,
      );
      await expect(
        firstRunEntry.expireRun(prematureExpire, sessionFor(service)),
      ).rejects.toMatchObject({
        code: 'EXECUTION_JUDGMENT_STALE',
      });
      expect(
        await firstRunEntry.submitAgentResult(submitEnvelope, sessionFor(service)),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
      expect(
        await firstRunEntry.acceptAgentResult(acceptEnvelope, sessionFor(service)),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
      expect(await firstRunEntry.finalizeRun(finalizeEnvelope, sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      const runQuery = await firstRunQuery(
        'execution.get_run_state',
        runRef,
        { runRef } as unknown as CanonicalJsonObject,
        'runStateReadV1',
      );
      expect(await firstRunEntry.getRunState(runQuery, sessionFor(service))).toMatchObject({
        status: 'SUCCEEDED',
        resultRef,
        terminationReason: 'EXECUTION_RESULT_ACCEPTED',
      });
      expect(
        (
          await admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'RELEASED' }]);
      await expect(
        withTaskExecutionTransaction(teDb, runnerContext(service), (trx) =>
          sql`UPDATE task_execution.agent_result SET result_payload=result_payload WHERE result_id=${resultTarget.objectId}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const hiddenFinal = await withTaskExecutionTransaction(
        teDb,
        { ...runnerContext(service), allowedProjectIds: [newUuidV7()] },
        (trx) =>
          sql`SELECT result_id FROM task_execution.agent_result WHERE result_id=${resultTarget.objectId}::uuid`.execute(
            trx,
          ),
      );
      expect(hiddenFinal.rows).toEqual([]);
      await admin.query('BEGIN');
      try {
        await admin.query('SET LOCAL ROLE task_execution_app');
        expect(
          (
            await admin.query(
              'SELECT result_id FROM task_execution.agent_result WHERE result_id=$1',
              [resultTarget.objectId],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await admin.query('ROLLBACK');
      }
      for (const [table, idColumn, id] of [
        ['run_final_submission_claim', 'run_id', runRef.objectId],
        ['result_validation_bundle', 'bundle_id', validationTarget.objectId],
        [
          'result_validation_fact',
          'validation_id',
          String(record(finalValidations.schemaValidationRef).objectId),
        ],
        ['agent_result_acceptance', 'acceptance_id', acceptanceTarget.objectId],
      ] as const) {
        const tableName = `task_execution.${table}`;
        await admin.query('BEGIN');
        try {
          await admin.query('SET LOCAL ROLE task_execution_app');
          expect(
            (await admin.query(`SELECT ${idColumn} FROM ${tableName} WHERE ${idColumn}=$1`, [id]))
              .rows,
          ).toEqual([]);
        } finally {
          await admin.query('ROLLBACK');
        }
        const hidden = await withTaskExecutionTransaction(
          teDb,
          { ...runnerContext(service), allowedProjectIds: [newUuidV7()] },
          (trx) =>
            sql`SELECT ${sql.ref(idColumn)} FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
              trx,
            ),
        );
        expect(hidden.rows).toEqual([]);
        await expect(
          withTaskExecutionTransaction(teDb, runnerContext(service), (trx) =>
            sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(idColumn)}=${sql.ref(idColumn)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
              trx,
            ),
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          withTaskExecutionTransaction(teDb, runnerContext(service), (trx) =>
            sql`DELETE FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
              trx,
            ),
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          admin.query(`UPDATE ${tableName} SET ${idColumn}=${idColumn} WHERE ${idColumn}=$1`, [id]),
        ).rejects.toMatchObject({ code: '55000' });
      }
      expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
      expect(
        (
          await admin.query<{ event_type: string; count: string }>(
            "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id IN ($1,$2) AND event_type IN ('execution.AgentResultAccepted','execution.RunTerminated') GROUP BY event_type ORDER BY event_type",
            [runRef.objectId, resultTarget.objectId],
          )
        ).rows,
      ).toEqual([
        { event_type: 'execution.AgentResultAccepted', count: '1' },
        { event_type: 'execution.RunTerminated', count: '1' },
      ]);
      const lateExpire = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        4,
      );
      await expect(firstRunEntry.expireRun(lateExpire, sessionFor(service))).rejects.toBeDefined();
      expect(await receiptRows(lateExpire.idempotencyKey)).toEqual([]);
      const lateConflictingFinalize = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        {
          acceptanceRecordRef: {
            ...record(acceptanceRecordRef),
            objectId: newUuidV7(),
          },
        },
        service,
        3,
      );
      await expect(
        firstRunEntry.finalizeRun(lateConflictingFinalize, sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await receiptRows(lateConflictingFinalize.idempotencyKey)).toEqual([]);
      expect(
        (
          await admin.query<{ status: string }>(
            'SELECT status FROM task_execution.run WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'SUCCEEDED' }]);
      expect(
        (
          await admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ status: 'RUNNING' }]);
      expect(revised.expectedOutputs).toHaveLength(1);
      expect(record(finalView.agentResultContract).businessOutputs).toEqual([]);
      const taskAfterFinal = await admin.query<{ status: string }>(
        'SELECT status FROM task_execution.task WHERE task_id=$1',
        [taskId],
      );
      expect(taskAfterFinal.rows).toHaveLength(1);
      expect(taskAfterFinal.rows[0]?.status).not.toBe('COMPLETED');
      expect(
        (
          await admin.query<{ count: string }>(
            'SELECT count(*)::text FROM integration_gateway.reference_edge WHERE owner_object_id=$1',
            [record(finalView.observationRef).objectId],
          )
        ).rows,
      ).toEqual([{ count: '3' }]);
      expect(
        (
          await admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.reference_edge WHERE source_command_id = ANY($1::uuid[])',
            [
              [
                submitEnvelope.commandId,
                recordEnvelope.commandId,
                validateEnvelope.commandId,
                acceptEnvelope.commandId,
                finalizeEnvelope.commandId,
              ],
            ],
          )
        ).rows,
      ).toEqual([{ count: '10' }]);
      expect(
        (
          await admin.query<{ count: string }>(
            "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunStarted'",
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      const terminalRunQuery = await firstRunQuery(
        'execution.get_run_state',
        runRef,
        { runRef } as unknown as CanonicalJsonObject,
        'runStateReadV1',
      );
      if (terminalScenario === 'SUCCEEDED') {
        const currentClock = clock;
        try {
          for (const [envelope, replay] of [
            [startEnvelope, () => firstRunEntry.startRun(startEnvelope, startSession)],
            [
              submitEnvelope,
              () => firstRunEntry.submitAgentResult(submitEnvelope, sessionFor(service)),
            ],
            [
              recordEnvelope,
              () => firstRunEntry.recordRunResult(recordEnvelope, sessionFor(service)),
            ],
            [
              validateEnvelope,
              () => firstRunEntry.validateAgentResult(validateEnvelope, sessionFor(service)),
            ],
            [
              acceptEnvelope,
              () => firstRunEntry.acceptAgentResult(acceptEnvelope, sessionFor(service)),
            ],
            [
              finalizeEnvelope,
              () => firstRunEntry.finalizeRun(finalizeEnvelope, sessionFor(service)),
            ],
            [resultQuery, () => firstRunEntry.getAgentResult(resultQuery, sessionFor(service))],
            [
              terminalRunQuery,
              () => firstRunEntry.getRunState(terminalRunQuery, sessionFor(service)),
            ],
            [
              finalQuery,
              () => firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
            ],
          ] as const) {
            const expiry = (
              await admin.query<{ expires_at: Date }>(
                'SELECT expires_at FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
                [envelope.authorizationDecisionRef.objectId],
              )
            ).rows[0]?.expires_at;
            if (expiry === undefined) throw new Error('missing original Decision expiry');
            // Exercise the owning consumer with its trusted clock. The immutable
            // Decision is not rewritten; wall-clock Bundle expiry has its own case.
            clock = expiry.getTime() + 1;
            queryReads.length = 0;
            await expect(replay()).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
            expect(protectedReads(), 'expired original Decision').toEqual([]);
          }
        } finally {
          clock = Math.max(currentClock, Date.now());
        }
      }
      for (const [boundary, replay] of [
        ['runStartV1', () => firstRunEntry.startRun(startEnvelope, startSession)],
        [
          'runResultRecordV1',
          () => firstRunEntry.recordRunResult(recordEnvelope, sessionFor(service)),
        ],
        [
          'agentResultValidateV1',
          () => firstRunEntry.validateAgentResult(validateEnvelope, sessionFor(service)),
        ],
        [
          'agentResultAcceptV1',
          () => firstRunEntry.acceptAgentResult(acceptEnvelope, sessionFor(service)),
        ],
        ['runFinalizeV1', () => firstRunEntry.finalizeRun(finalizeEnvelope, sessionFor(service))],
        ['agentResultReadV1', () => firstRunEntry.getAgentResult(resultQuery, sessionFor(service))],
        ['runStateReadV1', () => firstRunEntry.getRunState(terminalRunQuery, sessionFor(service))],
        [
          'runtimeFinalReadV1',
          () => firstRunEntry.getRuntimeFinalObservation(finalQuery, sessionFor(service)),
        ],
      ] as const) {
        const grantId = firstRunGrants.get(boundary);
        const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
          (candidate) => candidate.boundary === boundary,
        );
        const targetObjectType = binding?.targetObjectTypes[0];
        if (grantId === undefined || binding === undefined || targetObjectType === undefined)
          throw new Error(`missing independent ${boundary} Grant`);
        expect(
          await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
            targetId: grantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_FINAL_BOUNDARY',
            effectiveAt: new Date(clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        queryReads.length = 0;
        await expect(replay()).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(protectedReads(), boundary).toEqual([]);
        await grant({
          principal: service,
          capabilityCode: firstRunCodes[boundary],
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType,
        });
      }
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
      const scanGrantId = firstRunGrants.get('runFinalCandidateScanV1');
      if (scanGrantId === undefined) throw new Error('missing final scan Grant');
      expect(
        await revokeCapabilityTracked(identityDeps([fixture.projectId]), {
          targetId: scanGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          },
          reasonCode: 'WI224_REVOKE_FINAL_SCAN',
          effectiveAt: new Date(clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
      queryReads.length = 0;
      await expect(
        scanControlledFinalCandidates(guardedTeDb, scanContext, () => new Date(clock), scanProof),
      ).rejects.toBeDefined();
      expect(protectedReads(), 'scan Grant revoked').toEqual([]);
      observeValidations?.({ ...finalValidations, acceptanceRecordRef } as CanonicalJsonObject);
    };
    // The full owning chain includes the queue lock probe and a real server deadline.
    // Keep the broader suite's 60s default while giving these paths CI headroom.
    // Capture the old-version backup before this shared project contains new
    // RESULT_RECORDED/SUCCEEDED Runs or RESULT_VALIDATION_BUNDLE judgments.
    itIntegration(
      'upgrades historical Run/Claim/ack facts without fabricating identities and expires the legacy Run',
      () => runScenario('LEGACY_UPGRADE'),
      360_000,
    );
    itIntegration(
      'TE-REC-D-001 bounded BLOCKED_INPUT Human recovery reaches two SUCCEEDED Runs and COMPLETION_PENDING',
      () => runScenario('BOUNDED_RECOVERY'),
      420_000,
    );
    itIntegration(
      'TE-REC-D-010 suspends real recovery workers after current build Grant revocation',
      async () => {
        await runScenario(
          'BOUNDED_RECOVERY',
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          undefined,
          'SUSPEND',
        );
      },
      420_000,
    );
    itIntegration(
      'TE-REC-D-010 preserves expired Context and saved Process bytes while independently building a new identity',
      () =>
        runScenario(
          'BOUNDED_RECOVERY',
          'RUNTIME_USAGE',
          undefined,
          undefined,
          undefined,
          undefined,
          'STALE_CONTEXT',
        ),
      420_000,
    );

    for (const variant of [
      'REQUEST_EXPIRED',
      'CONTROLS_SUPERSEDED',
      'BUILDER_SUPERSEDED',
      'OTHER_CHILD',
      'BUDGET_EXHAUSTED',
      'EXPIRE_SOURCE',
      'SECOND_WRONG_SESSION',
      'SECOND_EXPIRY_RACE',
    ] as const)
      itIntegration(
        `TE-REC-D-005/007/010 validates bounded recovery variant ${variant}`,
        () =>
          runScenario(
            'BOUNDED_RECOVERY',
            'RUNTIME_USAGE',
            undefined,
            undefined,
            undefined,
            undefined,
            variant,
          ),
        420_000,
      );

    for (const [variant, outcome] of [
      ['SECOND_BLOCKED', 'BLOCKED_INPUT'],
      ['SECOND_PARTIAL', 'PARTIAL'],
      ['SECOND_FAILED', 'FAILED_EXECUTION'],
    ] as const)
      itIntegration(
        `TE-REC-D-009 refuses actual Run-2 ${outcome} final without reserving a Result or creating a third Run`,
        () =>
          runScenario(
            'BOUNDED_RECOVERY',
            'RUNTIME_USAGE',
            undefined,
            undefined,
            undefined,
            undefined,
            variant,
          ),
        420_000,
      );

    itIntegration(
      'completes Validation, Freeze and SUCCEEDED Run',
      () => runScenario('SUCCEEDED'),
      420_000,
    );

    itIntegration(
      'rejects mixed validations from two real owning Run Bundles',
      async () => {
        let first: CanonicalJsonObject | undefined;
        await runScenario('MIX_VALIDATIONS', 'RUNTIME_USAGE', undefined, (value) => {
          first = value;
        });
        if (first === undefined) throw new Error('missing first owning validation Bundle');
        await runScenario('MIX_VALIDATIONS', 'RUNTIME_USAGE', first);
      },
      360_000,
    );
    itIntegration(
      'serializes two owning accept commands with different Acceptance targets',
      () => runScenario('ACCEPT_RACE'),
      240_000,
    );
    for (const source of ['GRANT', 'POLICY'] as const)
      for (const step of ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE'] as const)
        itIntegration(
          `rejects ${step} after current ${source} eligibility changes and expires without renewing rights`,
          () =>
            runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
              source,
              step,
            }),
          180_000,
        );
    for (const [step, source] of [
      ['SUBMIT', 'POLICY'],
      ['ACCEPT', 'GRANT'],
    ] as const)
      itIntegration(
        `refuses ${step} when ${source} eligibility changes while the owning Run lock is held`,
        () =>
          runScenario('ELIGIBILITY_CHANGE', 'RUNTIME_USAGE', undefined, undefined, {
            step,
            source,
            whileLocked: true,
          }),
        180_000,
      );
    itIntegration(
      'expires a Run after a late synthetic final',
      () => runScenario('TIMED_OUT'),
      180_000,
    );
    itIntegration(
      'preserves the original late IG final after TE has already expired the Run',
      () => runScenario('TERMINAL_BEFORE_FINAL'),
      180_000,
    );
    itIntegration(
      'rejects a Core-valid Driver final whose session differs from the original ack',
      () => runScenario('IG_WRONG_SESSION'),
      180_000,
    );
    itIntegration(
      'expires a Run after its execution Bundle expires under independent monitor authorization',
      () => runScenario('TIMED_OUT_BUNDLE_EXPIRED'),
      180_000,
    );
    itIntegration(
      'serializes concurrent finalize and expire after the deadline',
      () => runScenario('RACE'),
      240_000,
    );
    itIntegration(
      'rejects Result submit when the Run deadline passes during its row-lock wait',
      () => runScenario('LOCK_DEADLINE'),
      180_000,
    );
    itIntegration(
      'recovers each committed final step after Process restart',
      () => runScenario('RECOVERY'),
      240_000,
    );
    itIntegration(
      'periodically recovers the controlled final Process without overlapping ticks',
      () => runScenario('RECOVERY_WORKER'),
      240_000,
    );
    itIntegration(
      'recovers two real pending Process instances with one owning command per worker tick',
      async () => {
        const fixtures: RecoveryFixture[] = [];
        for (let i = 0; i < 2; i++)
          await runScenario(
            'RECOVERY_MULTIPLE',
            'RUNTIME_USAGE',
            undefined,
            undefined,
            undefined,
            (value) => {
              fixtures.push(value);
              return Promise.resolve();
            },
          );
        const first = fixtures[0];
        if (first === undefined) throw new Error('missing first Process fixture');
        const byRun = (ref: CanonicalJsonObject) => {
          const found = fixtures.find((row) => row.runRef.objectId === ref.objectId);
          if (found === undefined) throw new Error('unknown owning Run');
          return found;
        };
        const trace: { runId: string; operation: string }[] = [];
        const errors: unknown[] = [];
        const ports: Parameters<typeof recoverControlledFinalRuns>[2] = {
          ...first.ports,
          readFinal: (ref) => {
            const found = fixtures.find((row) => row.attemptRef.objectId === ref.objectId);
            if (found === undefined) throw new Error('unknown original Attempt');
            return found.ports.readFinal(ref);
          },
          readRun: (ref) => byRun(ref).ports.readRun(ref),
          readPolicy: (ref) => {
            const found = fixtures.find((row) => row.workOrderRef.objectId === ref.objectId);
            if (found === undefined) throw new Error('unknown frozen WorkOrder');
            return found.ports.readPolicy(ref);
          },
          createProgress: (input) => byRun(input.runRef).ports.createProgress(input),
          advanceProgress: (progress, transition) =>
            byRun(progress.runRef).ports.advanceProgress(progress, transition),
          suspendTimedOutProgress: (progress) =>
            byRun(progress.runRef).ports.suspendTimedOutProgress(progress),
          execute: (command) => {
            const resultRef = command.payload.agentResultRef;
            const contract = command.payload.agentResultContract;
            const found = fixtures.find(
              (row) =>
                command.targetRef.objectId === row.runRef.objectId ||
                (resultRef !== undefined && record(resultRef).objectId === row.resultId) ||
                (contract !== undefined &&
                  record(record(contract).runRef).objectId === row.runRef.objectId),
            );
            if (found === undefined) throw new Error('unknown Process source fact');
            trace.push({ runId: found.runRef.objectId, operation: command.commandType });
            return found.ports.execute(command);
          },
        };
        expect((await ports.listProgress()).map((row) => row.runRef.objectId).sort()).toEqual(
          fixtures.map((row) => row.runRef.objectId).sort(),
        );
        const worker = createControlledFinalRecoveryWorker({
          taskExecutionDb: teDb,
          projects: [{ scanContext: first.scanContext, ports }],
          intervalMs: 10,
          maxStepsPerProject: 1,
          onError: (error) => {
            errors.push(error);
          },
        });
        worker.start();
        try {
          const until = Date.now() + 90_000;
          while (Date.now() < until) {
            const pending = await ports.listProgress();
            if (pending.length === 0) break;
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
          }
          expect(await ports.listProgress()).toEqual([]);
        } finally {
          await worker.stop();
        }
        expect(errors).toEqual([]);
        expect(trace).toHaveLength(10);
        for (const row of fixtures) {
          expect(
            trace
              .filter((step) => step.runId === row.runRef.objectId)
              .map((step) => step.operation),
          ).toEqual([
            'execution.submit_agent_result',
            'execution.record_run_result',
            'execution.validate_agent_result',
            'execution.accept_agent_result',
            'execution.finalize_run_from_acceptance',
          ]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.run WHERE run_id=$1',
                [row.runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'SUCCEEDED' }]);
          expect(
            (
              await admin.query<{ status: string }>(
                'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
                [row.runRef.objectId],
              )
            ).rows,
          ).toEqual([{ status: 'RELEASED' }]);
          expect(row.driver.invokedAttemptIds).toEqual([row.attemptRef.objectId]);
          expect(
            (
              await admin.query<{ count: string }>(
                "SELECT count(*)::text FROM task_execution.process_step WHERE process_id=$1 AND outcome='COMPLETED'",
                [controlledFinalProcessId(row.runRef.objectId)],
              )
            ).rows,
          ).toEqual([{ count: '5' }]);
        }
      },
      300_000,
    );

    itIntegration(
      'expires a Run with a reserved Result before recovery records it',
      () => runScenario('RECOVERY_EXPIRE'),
      180_000,
    );
    itIntegration(
      'rejects Acceptance after its Validation Bundle and Run deadline expire',
      () => runScenario('VALIDATION_EXPIRED'),
      180_000,
    );
    for (const negativeFinalCase of [
      'RUNTIME_USAGE',
      'OUTCOME',
      'BUSINESS_OUTPUT',
      'ARTIFACT_ALIAS',
      'WORKSPACE_OUTPUT',
      'FINDING',
      'KNOWLEDGE_PROPOSAL',
      'INPUT_REQUEST_PROPOSAL',
      'FOLLOW_UP_PROPOSAL',
      'CONTINUATION',
      'HEADER',
      'PROVENANCE',
      'TIME',
    ] as const)
      itIntegration(
        `rejects Core-valid unsupported final ${negativeFinalCase} without reserving a Result`,
        () => runScenario('UNSUPPORTED_FINAL', negativeFinalCase),
        180_000,
      );
    itIntegration(
      'rejects a non-final Result at the Core contract boundary before IG observation',
      () => runScenario('NON_FINAL_CORE_REJECT'),
      180_000,
    );
  });
});

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
