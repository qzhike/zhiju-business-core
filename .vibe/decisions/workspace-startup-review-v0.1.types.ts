// Design draft only. Not registered, not a public SDK.
// Generated from workspace-startup-review-v0.1.schema.json.
// Runtime validation, identity resolution, permissions and CAS remain mandatory.

export type Id = string;

export type Sha256 = string;

export type ObjectRef = {
  readonly kind: "OBJECT";
  readonly objectType: NamespaceCode;
  readonly objectId: UuidV7;
  readonly scope: ScopeRef;
};

export type NamespaceCode = string;

export type UuidV7 = string;

export type ScopeRef = {
  readonly enterpriseId?: UuidV7;
  readonly projectId?: UuidV7;
};

export type SnapshotRef = {
  readonly kind: "SNAPSHOT";
  readonly objectType: NamespaceCode;
  readonly objectId: UuidV7;
  readonly snapshotId: UuidV7;
  readonly scope: ScopeRef;
  readonly contentHash: ContentHash;
};

export type ContentHash = {
  readonly algorithm: "SHA-256";
  readonly digest: string;
  readonly canonicalizationVersion: "1";
};

export type VersionedRef = {
  readonly kind: "VERSIONED";
  readonly objectType: NamespaceCode;
  readonly objectId: UuidV7;
  readonly versionId: UuidV7;
  readonly scope: ScopeRef;
};

export type Binding = {
  readonly projectRef: ObjectRef;
  readonly projectVersion: number;
  readonly reportRef: SnapshotRef;
  readonly reportJsonSha256: Sha256;
  readonly candidateSetRef: SnapshotRef;
  readonly inputManifestSha256: Sha256;
  readonly ruleBundleRef: SnapshotRef;
  readonly planRef: SnapshotRef;
};

export type DisplayField = {
  readonly path: string;
  readonly label: string;
  readonly value: (string | null);
};

export type CandidateReview = {
  readonly candidateId: Id;
  readonly kind: ("ENTERPRISE_FACT" | "PRODUCT" | "QMS_APPLICABILITY" | "QMS_MANAGEMENT_CHOICE" | "QMS_PROFESSIONAL_DECISION");
  readonly valueState: ("EVIDENCED" | "UNKNOWN" | "CONFLICT");
  readonly summary: string;
  readonly displayFields: ReadonlyArray<DisplayField>;
  readonly alternatives: ReadonlyArray<{
  readonly displayFields: ReadonlyArray<DisplayField>;
  readonly evidenceIds: ReadonlyArray<Id>;
}>;
  readonly evidenceIds: ReadonlyArray<Id>;
};

export type InformationGroup = {
  readonly group: ("PROFILE" | "QMS" | "PRODUCT_SCOPE");
  readonly summary: string;
  readonly candidateIds: ReadonlyArray<Id>;
};

export type EvidenceView = {
  readonly evidenceId: Id;
  readonly sourceRef: ObjectRef;
  readonly role: ("CUSTOMER_MATERIAL" | "TEMPLATE" | "TRUSTED_DECISION_INPUT" | "PRIOR_REPORT");
  readonly displayName: string;
  readonly locator: string;
  readonly quote: (string | null);
};

export type PlannedFileView = {
  readonly plannedFileId: Id;
  readonly title: string;
  readonly customerCode: (string | null);
  readonly chapter: string;
  readonly processingCondition: ("ELIGIBLE" | "BLOCKED" | "ALREADY_REQUESTED");
  readonly reason: string;
  readonly changeIds: ReadonlyArray<Id>;
};

export type Blocker = {
  readonly scope: ("PROJECT_START" | "FILE");
  readonly reason: string;
  readonly candidateIds: ReadonlyArray<Id>;
  readonly plannedFileIds: ReadonlyArray<Id>;
  readonly attentionItemIds: ReadonlyArray<Id>;
};

export type StartupReview = {
  readonly schemaVersion: "0.1.0";
  readonly kind: "STARTUP_REVIEW";
  readonly binding: Binding;
  readonly projectState: ("PREPARING" | "ACTIVE");
  readonly informationGroups: ReadonlyArray<InformationGroup>;
  readonly candidateReviews: ReadonlyArray<CandidateReview>;
  readonly requiredCandidateIds: ReadonlyArray<Id>;
  readonly confirmationCandidateIds: ReadonlyArray<Id>;
  readonly evidenceViews: ReadonlyArray<EvidenceView>;
  readonly plannedFiles: ReadonlyArray<PlannedFileView>;
  readonly blockers: ReadonlyArray<Blocker>;
  readonly allowedActions: ReadonlyArray<("CONFIRM_AND_START" | "RECOVER_ORIGINAL_REQUEST" | "VIEW_ONLY")>;
};

export type ConfirmationRequest = {
  readonly schemaVersion: "0.1.0";
  readonly kind: "STARTUP_CONFIRMATION_REQUEST";
  readonly binding: Binding;
  readonly idempotencyKey: Id;
  readonly confirmedCandidateIds: ReadonlyArray<Id>;
  readonly selectedPlannedFileIds: ReadonlyArray<Id>;
};

export type StartSnapshot = {
  readonly enterpriseProfileSnapshotRef: SnapshotRef;
  readonly qmsConfigurationRef: VersionedRef;
  readonly productScopeSnapshotRef: SnapshotRef;
};

export type InformationStep = ({
  readonly state: ("NOT_CONFIRMED" | "UNKNOWN");
} | {
  readonly state: "CONFIRMED";
  readonly decisionRefs: ReadonlyArray<ObjectRef>;
});

export type StartupStep = ({
  readonly state: ("NOT_STARTED" | "UNKNOWN");
} | {
  readonly state: "STARTED";
  readonly startSnapshot: StartSnapshot;
});

export type ScopeStep = ({
  readonly state: ("NOT_RECEIVED" | "UNKNOWN");
} | {
  readonly state: "RECEIVED";
  readonly workScopeRef: SnapshotRef;
});

export type Receipt = {
  readonly schemaVersion: "0.1.0";
  readonly kind: "STARTUP_CONFIRMATION_RECEIPT";
  readonly requestRef: ObjectRef;
  readonly binding: Binding;
  readonly idempotencyKey: Id;
  readonly confirmedCandidateIds: ReadonlyArray<Id>;
  readonly selectedPlannedFileIds: ReadonlyArray<Id>;
  readonly projectState: ("PREPARING" | "ACTIVE");
  readonly status: ("PENDING" | "ACCEPTED" | "FAILED" | "UNKNOWN" | "STALE" | "PARTIAL");
  readonly information: InformationStep;
  readonly startup: StartupStep;
  readonly scope: ScopeStep;
  readonly reasons: ReadonlyArray<string>;
  readonly allowedRecoveryActions: ReadonlyArray<("READ_ORIGINAL" | "RETRY_INCOMPLETE_STEP" | "RECHECK_CURRENT_INPUTS")>;
};

export type RecoveryRequest = {
  readonly schemaVersion: "0.1.0";
  readonly kind: "STARTUP_RECOVERY_REQUEST";
  readonly requestRef: ObjectRef;
  readonly idempotencyKey: Id;
  readonly action: ("READ_ORIGINAL" | "RETRY_INCOMPLETE_STEP");
};

export type WorkspaceStartupReviewDTO = (StartupReview | ConfirmationRequest | Receipt | RecoveryRequest);
