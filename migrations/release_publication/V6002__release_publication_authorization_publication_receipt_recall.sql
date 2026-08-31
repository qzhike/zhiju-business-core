-- IM-05 WI-07 (issue #127): Release authorization, publication facts,
-- formal receipts, completion and append-only recall.
-- This migration is forward-only. V6000/V6001 remain immutable baselines.

SET ROLE release_publication_owner;

ALTER TABLE release_publication.release_record
    ADD COLUMN release_readiness_snapshot_ref jsonb,
    ADD COLUMN authorization_actor_snapshot_ref jsonb,
    ADD COLUMN authorization_decision_ref jsonb,
    ADD COLUMN authorization_ref jsonb,
    ADD COLUMN authorized_at timestamptz,
    ADD COLUMN recall_ref jsonb;

ALTER TABLE release_publication.release_record
    DROP CONSTRAINT release_record_status_closed;

ALTER TABLE release_publication.release_record
    ADD CONSTRAINT release_record_status_closed CHECK (
        status IN ('DRAFT', 'PREPARED', 'VALIDATING', 'AUTHORIZED', 'PUBLISHING',
                   'RELEASED', 'PARTIALLY_RELEASED', 'FAILED', 'CANCELLED',
                   'RECALLED', 'SUPERSEDED'));

ALTER TABLE release_publication.release_record
    ADD CONSTRAINT release_record_active_with_package CHECK (
        status IN ('DRAFT', 'CANCELLED')
        OR (package_id IS NOT NULL AND package_hash IS NOT NULL));

CREATE TABLE release_publication.publication_attempt (
    attempt_id uuid PRIMARY KEY,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    destination_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    stable_idempotency_key text NOT NULL,
    stable_key_hash bytea NOT NULL,
    definition jsonb NOT NULL,
    outcome text NOT NULL DEFAULT 'PENDING',
    requested_at timestamptz NOT NULL,
    external_delivery_request_ref jsonb NOT NULL,
    raw_receipt_ref jsonb,
    formal_receipt_ref jsonb,
    failure_ref jsonb,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT publication_attempt_number_positive CHECK (attempt_number > 0),
    CONSTRAINT publication_attempt_stable_key_nonempty CHECK (length(btrim(stable_idempotency_key)) > 0),
    CONSTRAINT publication_attempt_stable_key_hash_nonempty CHECK (octet_length(stable_key_hash) > 0),
    CONSTRAINT publication_attempt_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT publication_attempt_request_ref_object CHECK (jsonb_typeof(external_delivery_request_ref) = 'object'),
    CONSTRAINT publication_attempt_outcome_closed CHECK (outcome IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
    CONSTRAINT publication_attempt_number_unique UNIQUE (release_id, package_id, destination_id, attempt_number)
);

-- A stable key is bound by the owner function to one release/package/destination,
-- while a retry records a new attempt number under the same key.
CREATE INDEX publication_attempt_stable_key_idx
    ON release_publication.publication_attempt (
        release_id, package_id, destination_id, stable_idempotency_key);

CREATE INDEX publication_attempt_release_destination_idx
    ON release_publication.publication_attempt (release_id, destination_id, attempt_number DESC);

CREATE TABLE release_publication.publication_observation (
    observation_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL
        REFERENCES release_publication.publication_attempt (attempt_id) ON DELETE RESTRICT,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    destination_id uuid NOT NULL,
    observation_kind text NOT NULL,
    outcome text NOT NULL,
    raw_receipt_ref jsonb,
    observed_at timestamptz NOT NULL,
    observation_payload jsonb NOT NULL,
    observation_payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT publication_observation_kind_closed CHECK (
        observation_kind IN ('ATTEMPT_CREATED', 'PROVIDER_RESULT', 'RECONCILED')),
    CONSTRAINT publication_observation_outcome_closed CHECK (
        outcome IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
    CONSTRAINT publication_observation_payload_object CHECK (jsonb_typeof(observation_payload) = 'object'),
    CONSTRAINT publication_observation_hash_len CHECK (octet_length(observation_payload_hash) = 32)
);

CREATE INDEX publication_observation_attempt_idx
    ON release_publication.publication_observation (attempt_id, observed_at);

CREATE TABLE release_publication.publication_receipt (
    receipt_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL
        REFERENCES release_publication.publication_attempt (attempt_id) ON DELETE RESTRICT,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    destination_id uuid NOT NULL,
    raw_receipt_ref jsonb NOT NULL,
    formal_receipt_ref jsonb NOT NULL,
    provider_result jsonb NOT NULL,
    receipt_payload_hash bytea NOT NULL,
    occurred_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT publication_receipt_raw_ref_object CHECK (jsonb_typeof(raw_receipt_ref) = 'object'),
    CONSTRAINT publication_receipt_formal_ref_object CHECK (jsonb_typeof(formal_receipt_ref) = 'object'),
    CONSTRAINT publication_receipt_raw_ref_shape CHECK (
        raw_receipt_ref ->> 'kind' = 'CONTENT_ADDRESSED'
        AND raw_receipt_ref ->> 'objectType' = 'integration.raw_external_receipt'
        AND raw_receipt_ref ->> 'objectId' IS NOT NULL
        AND raw_receipt_ref -> 'contentHash' ->> 'algorithm' = 'SHA-256'
        AND raw_receipt_ref -> 'contentHash' ->> 'canonicalizationVersion' = '1'
        AND raw_receipt_ref -> 'contentHash' ->> 'digest' ~ '^[0-9a-f]{64}$'),
    CONSTRAINT publication_receipt_formal_ref_shape CHECK (
        formal_receipt_ref ->> 'kind' = 'CONTENT_ADDRESSED'
        AND formal_receipt_ref ->> 'objectType' = 'release.publication_receipt'
        AND formal_receipt_ref ->> 'objectId' IS NOT NULL
        AND formal_receipt_ref -> 'contentHash' ->> 'algorithm' = 'SHA-256'
        AND formal_receipt_ref -> 'contentHash' ->> 'canonicalizationVersion' = '1'
        AND formal_receipt_ref -> 'contentHash' ->> 'digest' ~ '^[0-9a-f]{64}$'),
    CONSTRAINT publication_receipt_provider_result_json CHECK (jsonb_typeof(provider_result) IS NOT NULL),
    CONSTRAINT publication_receipt_payload_hash_len CHECK (octet_length(receipt_payload_hash) = 32),
    CONSTRAINT publication_receipt_attempt_unique UNIQUE (attempt_id)
);

CREATE INDEX publication_receipt_release_destination_idx
    ON release_publication.publication_receipt (release_id, destination_id, occurred_at);

CREATE UNIQUE INDEX publication_receipt_raw_digest_idx
    ON release_publication.publication_receipt ((raw_receipt_ref -> 'contentHash' ->> 'digest'));

CREATE TABLE release_publication.publication_failure (
    failure_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL
        REFERENCES release_publication.publication_attempt (attempt_id) ON DELETE RESTRICT,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    destination_id uuid NOT NULL,
    failure_ref jsonb NOT NULL,
    classification text NOT NULL,
    retryable boolean NOT NULL,
    outcome text NOT NULL,
    provider_ref jsonb,
    diagnostic_ref jsonb,
    occurred_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT publication_failure_classification_nonempty CHECK (length(btrim(classification)) > 0),
    CONSTRAINT publication_failure_ref_shape CHECK (
        failure_ref ->> 'kind' = 'CONTENT_ADDRESSED'
        AND failure_ref ->> 'objectType' = 'release.publication_failure'
        AND failure_ref ->> 'objectId' IS NOT NULL
        AND failure_ref -> 'contentHash' ->> 'algorithm' = 'SHA-256'
        AND failure_ref -> 'contentHash' ->> 'canonicalizationVersion' = '1'
        AND failure_ref -> 'contentHash' ->> 'digest' ~ '^[0-9a-f]{64}$'),
    CONSTRAINT publication_failure_outcome_closed CHECK (outcome IN ('FAILED', 'UNKNOWN')),
    CONSTRAINT publication_failure_provider_ref_object CHECK (
        provider_ref IS NULL OR jsonb_typeof(provider_ref) = 'object'),
    CONSTRAINT publication_failure_diagnostic_ref_object CHECK (
        diagnostic_ref IS NULL OR jsonb_typeof(diagnostic_ref) = 'object'),
    CONSTRAINT publication_failure_attempt_unique UNIQUE (attempt_id)
);

CREATE TABLE release_publication.release_recall (
    recall_id uuid PRIMARY KEY,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    recall_scope jsonb NOT NULL,
    recall_reason jsonb NOT NULL,
    authorizing_human_ref jsonb NOT NULL,
    authorization_decision_ref jsonb NOT NULL,
    notification_policy_ref jsonb NOT NULL,
    affected_destinations jsonb NOT NULL,
    recalled_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_recall_scope_object CHECK (jsonb_typeof(recall_scope) IN ('object', 'array')),
    CONSTRAINT release_recall_reason_object CHECK (jsonb_typeof(recall_reason) = 'object'),
    CONSTRAINT release_recall_human_ref_object CHECK (jsonb_typeof(authorizing_human_ref) = 'object'),
    CONSTRAINT release_recall_decision_ref_object CHECK (jsonb_typeof(authorization_decision_ref) = 'object'),
    CONSTRAINT release_recall_policy_ref_object CHECK (jsonb_typeof(notification_policy_ref) = 'object'),
    CONSTRAINT release_recall_destinations_array CHECK (
        jsonb_typeof(affected_destinations) = 'array' AND jsonb_array_length(affected_destinations) > 0),
    CONSTRAINT release_recall_payload_hash_len CHECK (octet_length(payload_hash) = 32)
);

CREATE TABLE release_publication.release_impact_review (
    impact_review_id uuid PRIMARY KEY,
    release_id uuid NOT NULL
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    triggering_refs jsonb NOT NULL,
    affected_destinations jsonb NOT NULL,
    risk_classification text NOT NULL,
    required_actions jsonb NOT NULL,
    human_intervention_required boolean NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_impact_triggering_refs_array CHECK (jsonb_typeof(triggering_refs) = 'array'),
    CONSTRAINT release_impact_destinations_array CHECK (jsonb_typeof(affected_destinations) = 'array'),
    CONSTRAINT release_impact_actions_array CHECK (jsonb_typeof(required_actions) = 'array'),
    CONSTRAINT release_impact_risk_nonempty CHECK (length(btrim(risk_classification)) > 0),
    CONSTRAINT release_impact_payload_hash_len CHECK (octet_length(payload_hash) = 32)
);

CREATE INDEX release_recall_release_idx
    ON release_publication.release_recall (release_id, recalled_at DESC);
CREATE INDEX release_impact_review_release_idx
    ON release_publication.release_impact_review (release_id, created_at DESC);

-- The table guard is shared by all ReleasePublication business facts.
CREATE FUNCTION release_publication.guard_publication_attempt_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF OLD.attempt_id IS DISTINCT FROM NEW.attempt_id
       OR OLD.release_id IS DISTINCT FROM NEW.release_id
       OR OLD.package_id IS DISTINCT FROM NEW.package_id
       OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.destination_id IS DISTINCT FROM NEW.destination_id
       OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
       OR OLD.stable_idempotency_key IS DISTINCT FROM NEW.stable_idempotency_key
       OR OLD.stable_key_hash IS DISTINCT FROM NEW.stable_key_hash
       OR OLD.definition IS DISTINCT FROM NEW.definition
       OR OLD.requested_at IS DISTINCT FROM NEW.requested_at
       OR OLD.external_delivery_request_ref IS DISTINCT FROM NEW.external_delivery_request_ref
       OR OLD.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
       OR OLD.created_by_actor_snapshot_id IS DISTINCT FROM NEW.created_by_actor_snapshot_id
       OR OLD.created_authorization_decision_id IS DISTINCT FROM NEW.created_authorization_decision_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.source_command_id IS DISTINCT FROM NEW.source_command_id THEN
        RAISE EXCEPTION 'publication Attempt identity facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.outcome = 'SUCCEEDED' AND NEW.outcome <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'successful publication Attempt cannot be downgraded'
            USING ERRCODE = '55000';
    ELSIF OLD.outcome = 'FAILED' AND NEW.outcome NOT IN ('FAILED', 'SUCCEEDED') THEN
        RAISE EXCEPTION 'failed publication Attempt cannot become pending or unknown'
            USING ERRCODE = '55000';
    ELSIF OLD.outcome = 'UNKNOWN' AND NEW.outcome NOT IN ('UNKNOWN', 'FAILED', 'SUCCEEDED') THEN
        RAISE EXCEPTION 'unknown publication Attempt can only reconcile to a terminal outcome'
            USING ERRCODE = '55000';
    ELSIF OLD.outcome = 'PENDING' AND NEW.outcome NOT IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'invalid publication Attempt outcome transition'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER publication_attempt_insert_guard
    BEFORE INSERT ON release_publication.publication_attempt
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER publication_attempt_immutable_guard
    BEFORE UPDATE ON release_publication.publication_attempt
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_publication_attempt_update();
CREATE TRIGGER publication_attempt_delete_guard
    BEFORE DELETE ON release_publication.publication_attempt
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER publication_observation_insert_guard
    BEFORE INSERT ON release_publication.publication_observation
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER publication_observation_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.publication_observation
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER publication_receipt_insert_guard
    BEFORE INSERT ON release_publication.publication_receipt
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER publication_receipt_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.publication_receipt
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER publication_failure_insert_guard
    BEFORE INSERT ON release_publication.publication_failure
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER publication_failure_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.publication_failure
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER release_recall_insert_guard
    BEFORE INSERT ON release_publication.release_recall
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_recall_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.release_recall
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER release_impact_insert_guard
    BEFORE INSERT ON release_publication.release_impact_review
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_impact_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.release_impact_review
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();

CREATE OR REPLACE FUNCTION release_publication.guard_release_record_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM release_publication.assert_business_write_context(
        NEW.enterprise_id,
        NEW.project_id,
        NEW.updated_by_principal_id,
        NEW.updated_by_actor_snapshot_id,
        NEW.updated_authorization_decision_id);
    IF OLD.release_id IS DISTINCT FROM NEW.release_id
       OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.artifact_ref IS DISTINCT FROM NEW.artifact_ref
       OR OLD.revision_ref IS DISTINCT FROM NEW.revision_ref
       OR OLD.revision_content_hash IS DISTINCT FROM NEW.revision_content_hash
       OR OLD.release_number IS DISTINCT FROM NEW.release_number
       OR OLD.purpose IS DISTINCT FROM NEW.purpose
       OR OLD.requested_effective_at IS DISTINCT FROM NEW.requested_effective_at
       OR OLD.quality_profile_ref IS DISTINCT FROM NEW.quality_profile_ref
       OR OLD.revision_acceptance_snapshot_ref IS DISTINCT FROM NEW.revision_acceptance_snapshot_ref
       OR OLD.approval_bundle_snapshot_ref IS DISTINCT FROM NEW.approval_bundle_snapshot_ref
       OR OLD.supersedes_release_ref IS DISTINCT FROM NEW.supersedes_release_ref
       OR OLD.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
       OR OLD.created_by_actor_snapshot_id IS DISTINCT FROM NEW.created_by_actor_snapshot_id
       OR OLD.created_authorization_decision_id IS DISTINCT FROM NEW.created_authorization_decision_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'release identity facts are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.status IN ('CANCELLED', 'RECALLED', 'SUPERSEDED') THEN
        RAISE EXCEPTION 'terminal Release is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PREPARED', 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid DRAFT Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'PREPARED' AND NEW.status NOT IN ('PREPARED', 'VALIDATING', 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid PREPARED Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'VALIDATING' AND NEW.status NOT IN ('VALIDATING', 'AUTHORIZED', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid VALIDATING Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'AUTHORIZED' AND NEW.status NOT IN ('AUTHORIZED', 'PUBLISHING', 'FAILED', 'RECALLED') THEN
        RAISE EXCEPTION 'invalid AUTHORIZED Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'PUBLISHING' AND NEW.status NOT IN ('PUBLISHING', 'RELEASED', 'PARTIALLY_RELEASED', 'FAILED', 'RECALLED') THEN
        RAISE EXCEPTION 'invalid PUBLISHING Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'PARTIALLY_RELEASED' AND NEW.status NOT IN ('PARTIALLY_RELEASED', 'PUBLISHING', 'RELEASED', 'FAILED', 'RECALLED') THEN
        RAISE EXCEPTION 'invalid PARTIALLY_RELEASED Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'FAILED' AND NEW.status NOT IN ('FAILED', 'PUBLISHING', 'RECALLED') THEN
        RAISE EXCEPTION 'invalid FAILED Release status transition' USING ERRCODE = '22023';
    ELSIF OLD.status = 'RELEASED' AND NEW.status NOT IN ('RELEASED', 'RECALLED', 'SUPERSEDED') THEN
        RAISE EXCEPTION 'invalid RELEASED Release status transition' USING ERRCODE = '22023';
    END IF;
    IF OLD.status IN ('PREPARED', 'VALIDATING', 'AUTHORIZED', 'PUBLISHING',
                       'PARTIALLY_RELEASED', 'FAILED', 'RELEASED')
       AND (OLD.representation_selections IS DISTINCT FROM NEW.representation_selections
            OR OLD.representation_selection_reason IS DISTINCT FROM NEW.representation_selection_reason
            OR OLD.destination_definitions IS DISTINCT FROM NEW.destination_definitions
            OR OLD.recipient_scope_snapshot_ref IS DISTINCT FROM NEW.recipient_scope_snapshot_ref
            OR OLD.package_id IS DISTINCT FROM NEW.package_id
            OR OLD.package_hash IS DISTINCT FROM NEW.package_hash
            OR OLD.preparation_validation_ref IS DISTINCT FROM NEW.preparation_validation_ref) THEN
        RAISE EXCEPTION 'frozen Release package facts are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.status IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED', 'RELEASED')
       AND OLD.release_readiness_snapshot_ref IS DISTINCT FROM NEW.release_readiness_snapshot_ref THEN
        RAISE EXCEPTION 'authorized Release readiness facts are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.authorization_actor_snapshot_ref IS NOT NULL
       AND OLD.authorization_actor_snapshot_ref IS DISTINCT FROM NEW.authorization_actor_snapshot_ref THEN
        RAISE EXCEPTION 'Release authorization actor facts are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.authorization_decision_ref IS NOT NULL
       AND OLD.authorization_decision_ref IS DISTINCT FROM NEW.authorization_decision_ref THEN
        RAISE EXCEPTION 'Release authorization decision facts are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.authorization_ref IS NOT NULL
       AND OLD.authorization_ref IS DISTINCT FROM NEW.authorization_ref THEN
        RAISE EXCEPTION 'Release authorization reference is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.authorized_at IS NOT NULL AND OLD.authorized_at IS DISTINCT FROM NEW.authorized_at THEN
        RAISE EXCEPTION 'Release authorization time is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.recall_ref IS NOT NULL AND OLD.recall_ref IS DISTINCT FROM NEW.recall_ref THEN
        RAISE EXCEPTION 'Release recall reference is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'DRAFT'
       AND NEW.status = 'DRAFT'
       AND (NEW.package_id IS NOT NULL OR NEW.package_hash IS NOT NULL
            OR NEW.preparation_validation_ref IS NOT NULL) THEN
        RAISE EXCEPTION 'DRAFT Release cannot carry a Package' USING ERRCODE = '55000';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'Release aggregate version must advance by one' USING ERRCODE = '40001';
    END IF;
    IF NEW.status = 'PREPARED'
       AND (NEW.package_id IS NULL OR NEW.package_hash IS NULL
            OR NEW.preparation_validation_ref IS NULL) THEN
        RAISE EXCEPTION 'PREPARED Release requires a frozen Package' USING ERRCODE = '22023';
    END IF;
    IF NEW.status IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED', 'RELEASED')
       AND (NEW.release_readiness_snapshot_ref IS NULL
            OR NEW.authorization_actor_snapshot_ref IS NULL
            OR NEW.authorization_decision_ref IS NULL
            OR NEW.authorization_ref IS NULL
            OR NEW.authorized_at IS NULL) THEN
        RAISE EXCEPTION 'authorized Release requires readiness and authorization facts'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'RECALLED' AND NEW.recall_ref IS NULL THEN
        RAISE EXCEPTION 'RECALLED Release requires a Recall reference' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE FUNCTION release_publication.validate_release_readiness(
    p_release_id uuid,
    p_expected_version bigint,
    p_release_readiness_snapshot_ref jsonb,
    p_validated_package_ref jsonb,
    p_validated_at timestamptz,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    package_hash bytea;
BEGIN
    IF p_release_readiness_snapshot_ref IS NULL
       OR jsonb_typeof(p_release_readiness_snapshot_ref) <> 'object'
       OR p_validated_package_ref IS NULL
       OR jsonb_typeof(p_validated_package_ref) <> 'object'
       OR p_validated_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    IF p_validated_package_ref -> 'packageHash' ->> 'digest' !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    package_hash := decode(p_validated_package_ref -> 'packageHash' ->> 'digest', 'hex');
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.status NOT IN ('PREPARED', 'VALIDATING') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version;
        RETURN;
    END IF;
    IF (p_validated_package_ref -> 'releaseRef' ->> 'objectId')::uuid IS DISTINCT FROM release_row.release_id
       OR (p_validated_package_ref -> 'packageSnapshotRef' ->> 'objectId')::uuid IS DISTINCT FROM release_row.package_id
       OR package_hash IS DISTINCT FROM release_row.package_hash THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version;
        RETURN;
    END IF;
    UPDATE release_publication.release_record
       SET release_readiness_snapshot_ref = p_release_readiness_snapshot_ref,
           status = 'VALIDATING',
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = p_validated_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1;
END
$fn$;

CREATE FUNCTION release_publication.authorize_release(
    p_release_id uuid,
    p_expected_version bigint,
    p_release_readiness_snapshot_ref jsonb,
    p_authorizing_human_ref jsonb,
    p_actor_snapshot_ref jsonb,
    p_authorization_decision_ref jsonb,
    p_authorization_ref jsonb,
    p_authorized_at timestamptz,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
BEGIN
    IF p_release_readiness_snapshot_ref IS NULL
       OR jsonb_typeof(p_release_readiness_snapshot_ref) <> 'object'
       OR p_authorizing_human_ref IS NULL
       OR jsonb_typeof(p_authorizing_human_ref) <> 'object'
       OR p_authorizing_human_ref ->> 'principalKind' <> 'HUMAN'
       OR p_actor_snapshot_ref IS NULL
       OR jsonb_typeof(p_actor_snapshot_ref) <> 'object'
       OR p_authorization_decision_ref IS NULL
       OR jsonb_typeof(p_authorization_decision_ref) <> 'object'
       OR p_authorization_ref IS NULL
       OR jsonb_typeof(p_authorization_ref) <> 'object'
       OR p_authorization_ref ->> 'objectType' <> 'release.release_authorization'
       OR p_authorization_ref ->> 'objectId' IS DISTINCT FROM p_source_command_id::text
       OR p_authorization_ref -> 'contentHash' ->> 'digest' !~ '^[0-9a-f]{64}$'
       OR p_authorized_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint, NULL::text; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF p_authorizing_human_ref ->> 'principalId' IS DISTINCT FROM platform_security.context_principal_id()::text
       OR p_actor_snapshot_ref ->> 'snapshotId' IS DISTINCT FROM platform_security.context_actor_snapshot_id()::text
       OR p_authorization_decision_ref ->> 'objectId' IS DISTINCT FROM (
           SELECT decision_id::text FROM platform_security.context_authorization_decision_ref())
       OR p_actor_snapshot_ref ->> 'objectType' <> 'identity.actor_snapshot'
       OR p_authorization_decision_ref ->> 'objectType' <> 'identity.authorization_decision' THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF release_row.status NOT IN ('PREPARED', 'VALIDATING')
       OR (release_row.release_readiness_snapshot_ref IS NOT NULL
           AND release_row.release_readiness_snapshot_ref IS DISTINCT FROM p_release_readiness_snapshot_ref) THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    UPDATE release_publication.release_record
       SET release_readiness_snapshot_ref = p_release_readiness_snapshot_ref,
           authorization_actor_snapshot_ref = p_actor_snapshot_ref,
           authorization_decision_ref = p_authorization_decision_ref,
           authorization_ref = p_authorization_ref,
           authorized_at = p_authorized_at,
           status = 'AUTHORIZED',
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = p_authorized_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1, 'AUTHORIZED'::text;
END
$fn$;

CREATE FUNCTION release_publication.create_publication_attempt(
    p_attempt_id uuid,
    p_release_id uuid,
    p_package_id uuid,
    p_destination_id uuid,
    p_attempt_number integer,
    p_stable_idempotency_key text,
    p_definition jsonb,
    p_requested_at timestamptz,
    p_external_delivery_request_ref jsonb,
    p_observation_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    existing_attempt release_publication.publication_attempt%ROWTYPE;
    destination_exists boolean;
BEGIN
    IF p_attempt_id IS NULL OR p_release_id IS NULL OR p_package_id IS NULL
       OR p_destination_id IS NULL OR p_attempt_number IS NULL OR p_attempt_number <= 0
       OR p_stable_idempotency_key IS NULL OR length(btrim(p_stable_idempotency_key)) = 0
       OR p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_requested_at IS NULL OR p_external_delivery_request_ref IS NULL
       OR jsonb_typeof(p_external_delivery_request_ref) <> 'object'
       OR p_observation_payload_hash IS NULL
       OR octet_length(p_observation_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF release_row.status NOT IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.package_id IS DISTINCT FROM p_package_id
       OR (p_definition -> 'packageRef' -> 'releaseRef' ->> 'objectId')::uuid IS DISTINCT FROM p_release_id
       OR (p_definition -> 'packageRef' -> 'packageSnapshotRef' ->> 'objectId')::uuid IS DISTINCT FROM p_package_id
       OR p_definition ->> 'stableIdempotencyKey' IS DISTINCT FROM p_stable_idempotency_key
       OR (p_definition ->> 'destinationId')::uuid IS DISTINCT FROM p_destination_id THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version;
        RETURN;
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM release_publication.release_destination
         WHERE package_id = p_package_id AND destination_id = p_destination_id)
      INTO destination_exists;
    IF NOT destination_exists THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version;
        RETURN;
    END IF;
    SELECT * INTO existing_attempt
      FROM release_publication.publication_attempt
     WHERE attempt_id = p_attempt_id;
    IF FOUND THEN
        IF existing_attempt.definition IS NOT DISTINCT FROM p_definition THEN
            RETURN QUERY SELECT 'DUPLICATE', release_row.aggregate_version;
        ELSE
            RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        END IF;
        RETURN;
    END IF;
    SELECT * INTO existing_attempt
      FROM release_publication.publication_attempt
     WHERE release_id = p_release_id
       AND stable_idempotency_key = p_stable_idempotency_key
     ORDER BY attempt_number DESC
     LIMIT 1;
    IF FOUND AND (existing_attempt.package_id IS DISTINCT FROM p_package_id
                  OR existing_attempt.destination_id IS DISTINCT FROM p_destination_id) THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM release_publication.publication_attempt
         WHERE release_id = p_release_id AND package_id = p_package_id
           AND destination_id = p_destination_id AND attempt_number = p_attempt_number) THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    INSERT INTO release_publication.publication_attempt (
        attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id, attempt_number,
        stable_idempotency_key, stable_key_hash, definition, outcome, requested_at,
        external_delivery_request_ref, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        p_attempt_id, p_release_id, p_package_id, release_row.enterprise_id, release_row.project_id,
        p_destination_id, p_attempt_number,
        p_stable_idempotency_key, decode(md5(p_stable_idempotency_key), 'hex'), p_definition,
        'PENDING', p_requested_at, p_external_delivery_request_ref,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    UPDATE release_publication.release_record
       SET status = 'PUBLISHING',
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_created_by_principal_id,
           updated_by_actor_snapshot_id = p_created_by_actor_snapshot_id,
           updated_authorization_decision_id = p_created_authorization_decision_id,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    INSERT INTO release_publication.publication_observation (
        observation_id, attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id,
        observation_kind, outcome, observed_at, observation_payload,
        observation_payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        uuidv7(), p_attempt_id, p_release_id, p_package_id,
        release_row.enterprise_id, release_row.project_id, p_destination_id,
        'ATTEMPT_CREATED', 'PENDING', p_requested_at,
        jsonb_build_object('attemptRef', jsonb_build_object('objectId', p_attempt_id::text),
                           'stableIdempotencyKey', p_stable_idempotency_key),
        p_observation_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1;
END
$fn$;

CREATE FUNCTION release_publication.record_publication_receipt(
    p_receipt_id uuid,
    p_attempt_id uuid,
    p_release_id uuid,
    p_package_id uuid,
    p_destination_id uuid,
    p_raw_receipt_ref jsonb,
    p_formal_receipt_ref jsonb,
    p_provider_result jsonb,
    p_receipt_payload_hash bytea,
    p_observation_payload_hash bytea,
    p_occurred_at timestamptz,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    attempt_row release_publication.publication_attempt%ROWTYPE;
    required_count integer;
    succeeded_count integer;
    next_status text;
BEGIN
    IF p_receipt_id IS NULL OR p_attempt_id IS NULL OR p_release_id IS NULL OR p_package_id IS NULL
       OR p_destination_id IS NULL OR p_raw_receipt_ref IS NULL
       OR jsonb_typeof(p_raw_receipt_ref) <> 'object'
       OR p_raw_receipt_ref ->> 'objectType' <> 'integration.raw_external_receipt'
       OR p_raw_receipt_ref ->> 'objectId' IS NULL
       OR p_formal_receipt_ref IS NULL OR jsonb_typeof(p_formal_receipt_ref) <> 'object'
       OR p_formal_receipt_ref ->> 'objectType' <> 'release.publication_receipt'
       OR (p_formal_receipt_ref ->> 'objectId')::uuid IS DISTINCT FROM p_receipt_id
       OR p_formal_receipt_ref -> 'contentHash' ->> 'digest' !~ '^[0-9a-f]{64}$'
       OR p_provider_result IS NULL OR p_receipt_payload_hash IS NULL
       OR octet_length(p_receipt_payload_hash) <> 32
       OR p_observation_payload_hash IS NULL
       OR octet_length(p_observation_payload_hash) <> 32
       OR p_occurred_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    IF p_provider_result::text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
       OR p_provider_result::text ~* '"(email|phone|mobile|name|personalName|address|location|token|secret|credential|body|content|subject|message)"' THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint, NULL::text; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF release_row.status NOT IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    SELECT * INTO attempt_row
      FROM release_publication.publication_attempt
     WHERE attempt_id = p_attempt_id
     FOR UPDATE;
    IF NOT FOUND OR attempt_row.release_id IS DISTINCT FROM p_release_id
       OR attempt_row.package_id IS DISTINCT FROM p_package_id
       OR attempt_row.destination_id IS DISTINCT FROM p_destination_id
       OR attempt_row.enterprise_id IS DISTINCT FROM release_row.enterprise_id
       OR attempt_row.project_id IS DISTINCT FROM release_row.project_id THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM release_publication.publication_receipt WHERE attempt_id = p_attempt_id) THEN
        RETURN QUERY SELECT 'DUPLICATE', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM release_publication.publication_receipt receipt
         WHERE receipt.raw_receipt_ref -> 'contentHash' ->> 'digest' =
               p_raw_receipt_ref -> 'contentHash' ->> 'digest')
       OR EXISTS (
        SELECT 1
          FROM release_publication.publication_receipt receipt
          JOIN release_publication.publication_attempt recorded_attempt
            ON recorded_attempt.attempt_id = receipt.attempt_id
         WHERE recorded_attempt.release_id = attempt_row.release_id
           AND recorded_attempt.package_id = attempt_row.package_id
           AND recorded_attempt.destination_id = attempt_row.destination_id
           AND recorded_attempt.stable_idempotency_key = attempt_row.stable_idempotency_key) THEN
        RETURN QUERY SELECT 'DUPLICATE', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    INSERT INTO release_publication.publication_receipt (
        receipt_id, attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id,
        raw_receipt_ref, formal_receipt_ref, provider_result, receipt_payload_hash,
        occurred_at, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_receipt_id, p_attempt_id, p_release_id, p_package_id,
        release_row.enterprise_id, release_row.project_id, p_destination_id,
        p_raw_receipt_ref, p_formal_receipt_ref, p_provider_result, p_receipt_payload_hash,
        p_occurred_at, p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    INSERT INTO release_publication.publication_observation (
        observation_id, attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id,
        observation_kind, outcome, raw_receipt_ref, observed_at, observation_payload,
        observation_payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        uuidv7(), p_attempt_id, p_release_id, p_package_id,
        release_row.enterprise_id, release_row.project_id, p_destination_id,
        'PROVIDER_RESULT', 'SUCCEEDED', p_raw_receipt_ref, p_occurred_at,
        jsonb_build_object('formalReceiptRef', p_formal_receipt_ref,
                           'providerResult', p_provider_result),
        p_observation_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);
    UPDATE release_publication.publication_attempt
       SET outcome = 'SUCCEEDED', raw_receipt_ref = p_raw_receipt_ref,
           formal_receipt_ref = p_formal_receipt_ref
     WHERE attempt_id = p_attempt_id;
    SELECT count(*)::integer INTO required_count
      FROM release_publication.release_destination
     WHERE package_id = release_row.package_id AND required;
    SELECT count(*)::integer INTO succeeded_count
      FROM release_publication.release_destination destination
     WHERE destination.package_id = release_row.package_id AND destination.required
       AND EXISTS (
           SELECT 1 FROM release_publication.publication_receipt receipt
            WHERE receipt.release_id = release_row.release_id
              AND receipt.package_id = release_row.package_id
              AND receipt.destination_id = destination.destination_id);
    IF required_count > 0 AND succeeded_count = required_count THEN
        next_status := 'RELEASED';
    ELSIF succeeded_count > 0 THEN
        next_status := 'PARTIALLY_RELEASED';
    ELSE
        next_status := 'PUBLISHING';
    END IF;
    UPDATE release_publication.release_record
       SET status = next_status,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_created_by_principal_id,
           updated_by_actor_snapshot_id = p_created_by_actor_snapshot_id,
           updated_authorization_decision_id = p_created_authorization_decision_id,
           updated_at = p_occurred_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1, next_status;
END
$fn$;

CREATE FUNCTION release_publication.record_publication_failure(
    p_failure_id uuid,
    p_failure_ref jsonb,
    p_attempt_id uuid,
    p_release_id uuid,
    p_package_id uuid,
    p_destination_id uuid,
    p_classification text,
    p_retryable boolean,
    p_outcome text,
    p_provider_ref jsonb,
    p_diagnostic_ref jsonb,
    p_observation_payload_hash bytea,
    p_occurred_at timestamptz,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    attempt_row release_publication.publication_attempt%ROWTYPE;
    required_count integer;
    succeeded_count integer;
    terminal_count integer;
    next_status text;
BEGIN
    IF p_failure_id IS NULL OR p_failure_ref IS NULL OR jsonb_typeof(p_failure_ref) <> 'object'
       OR p_failure_ref ->> 'objectType' <> 'release.publication_failure'
       OR (p_failure_ref ->> 'objectId')::uuid IS DISTINCT FROM p_failure_id
       OR p_failure_ref -> 'contentHash' ->> 'digest' !~ '^[0-9a-f]{64}$'
       OR p_attempt_id IS NULL OR p_release_id IS NULL OR p_package_id IS NULL
       OR p_destination_id IS NULL OR p_classification IS NULL
       OR length(btrim(p_classification)) = 0 OR p_retryable IS NULL
       OR p_outcome NOT IN ('FAILED', 'UNKNOWN')
       OR p_observation_payload_hash IS NULL
       OR octet_length(p_observation_payload_hash) <> 32
       OR p_occurred_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint, NULL::text; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF release_row.status NOT IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    SELECT * INTO attempt_row
      FROM release_publication.publication_attempt
     WHERE attempt_id = p_attempt_id
     FOR UPDATE;
    IF NOT FOUND OR attempt_row.release_id IS DISTINCT FROM p_release_id
       OR attempt_row.package_id IS DISTINCT FROM p_package_id
       OR attempt_row.destination_id IS DISTINCT FROM p_destination_id
       OR attempt_row.enterprise_id IS DISTINCT FROM release_row.enterprise_id
       OR attempt_row.project_id IS DISTINCT FROM release_row.project_id THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM release_publication.publication_receipt WHERE attempt_id = p_attempt_id)
       OR EXISTS (SELECT 1 FROM release_publication.publication_failure WHERE attempt_id = p_attempt_id) THEN
        RETURN QUERY SELECT 'DUPLICATE', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    INSERT INTO release_publication.publication_failure (
        failure_id, attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id,
        failure_ref, classification, retryable, outcome, provider_ref, diagnostic_ref, occurred_at,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_failure_id, p_attempt_id, p_release_id, p_package_id,
        release_row.enterprise_id, release_row.project_id, p_destination_id,
        p_failure_ref, p_classification, p_retryable, p_outcome, p_provider_ref, p_diagnostic_ref, p_occurred_at,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    INSERT INTO release_publication.publication_observation (
        observation_id, attempt_id, release_id, package_id, enterprise_id, project_id,
        destination_id,
        observation_kind, outcome, observed_at, observation_payload,
        observation_payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        uuidv7(), p_attempt_id, p_release_id, p_package_id,
        release_row.enterprise_id, release_row.project_id, p_destination_id,
        'PROVIDER_RESULT', p_outcome, p_occurred_at,
        jsonb_build_object('failureRef', p_failure_ref, 'classification', p_classification),
        p_observation_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);
    UPDATE release_publication.publication_attempt
       SET outcome = p_outcome, failure_ref = p_failure_ref
       WHERE attempt_id = p_attempt_id;
    SELECT count(*)::integer INTO required_count
      FROM release_publication.release_destination
     WHERE package_id = release_row.package_id AND required;
    SELECT count(*)::integer INTO succeeded_count
      FROM release_publication.release_destination destination
     WHERE destination.package_id = release_row.package_id AND destination.required
       AND EXISTS (
           SELECT 1 FROM release_publication.publication_receipt receipt
            WHERE receipt.release_id = release_row.release_id
              AND receipt.package_id = release_row.package_id
              AND receipt.destination_id = destination.destination_id);
    SELECT count(*)::integer INTO terminal_count
      FROM release_publication.release_destination destination
     WHERE destination.package_id = release_row.package_id AND destination.required
       AND NOT EXISTS (
           SELECT 1 FROM release_publication.publication_receipt receipt
            WHERE receipt.release_id = release_row.release_id
              AND receipt.package_id = release_row.package_id
              AND receipt.destination_id = destination.destination_id)
       AND NOT EXISTS (
           SELECT 1 FROM release_publication.publication_attempt pending_attempt
            WHERE pending_attempt.release_id = release_row.release_id
              AND pending_attempt.package_id = release_row.package_id
              AND pending_attempt.destination_id = destination.destination_id
              AND pending_attempt.outcome = 'PENDING')
       AND EXISTS (
           SELECT 1 FROM release_publication.publication_attempt terminal_attempt
            WHERE terminal_attempt.release_id = release_row.release_id
              AND terminal_attempt.package_id = release_row.package_id
              AND terminal_attempt.destination_id = destination.destination_id
              AND terminal_attempt.outcome IN ('FAILED', 'UNKNOWN'));
    IF required_count > 0 AND succeeded_count = required_count THEN
        next_status := 'RELEASED';
    ELSIF succeeded_count > 0 THEN
        next_status := 'PARTIALLY_RELEASED';
    ELSIF required_count > 0 AND terminal_count = required_count THEN
        next_status := 'FAILED';
    ELSE
        next_status := 'PUBLISHING';
    END IF;
    UPDATE release_publication.release_record
       SET status = next_status,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_created_by_principal_id,
           updated_by_actor_snapshot_id = p_created_by_actor_snapshot_id,
           updated_authorization_decision_id = p_created_authorization_decision_id,
           updated_at = p_occurred_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1, next_status;
END
$fn$;

CREATE FUNCTION release_publication.complete_release(
    p_release_id uuid,
    p_expected_version bigint,
    p_completion_policy_ref jsonb,
    p_destination_outcome_refs jsonb,
    p_evaluated_at timestamptz,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    required_count integer;
    succeeded_count integer;
    terminal_count integer;
    next_status text;
BEGIN
    IF p_completion_policy_ref IS NULL OR jsonb_typeof(p_completion_policy_ref) <> 'object'
       OR p_destination_outcome_refs IS NULL OR jsonb_typeof(p_destination_outcome_refs) <> 'array'
       OR jsonb_array_length(p_destination_outcome_refs) = 0 OR p_evaluated_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint, NULL::text; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF release_row.status NOT IN ('AUTHORIZED', 'PUBLISHING', 'PARTIALLY_RELEASED', 'FAILED', 'RELEASED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    SELECT count(*)::integer INTO required_count
      FROM release_publication.release_destination
     WHERE package_id = release_row.package_id AND required;
    SELECT count(*)::integer INTO succeeded_count
      FROM release_publication.release_destination destination
     WHERE destination.package_id = release_row.package_id AND destination.required
       AND EXISTS (
           SELECT 1 FROM release_publication.publication_receipt receipt
            WHERE receipt.release_id = release_row.release_id
              AND receipt.package_id = release_row.package_id
              AND receipt.destination_id = destination.destination_id);
    SELECT count(*)::integer INTO terminal_count
      FROM release_publication.release_destination destination
     WHERE destination.package_id = release_row.package_id AND destination.required
       AND NOT EXISTS (
           SELECT 1 FROM release_publication.publication_receipt receipt
            WHERE receipt.release_id = release_row.release_id
              AND receipt.package_id = release_row.package_id
              AND receipt.destination_id = destination.destination_id)
       AND NOT EXISTS (
           SELECT 1 FROM release_publication.publication_attempt pending_attempt
            WHERE pending_attempt.release_id = release_row.release_id
              AND pending_attempt.package_id = release_row.package_id
              AND pending_attempt.destination_id = destination.destination_id
              AND pending_attempt.outcome = 'PENDING')
       AND EXISTS (
           SELECT 1 FROM release_publication.publication_attempt attempt
            WHERE attempt.release_id = release_row.release_id
              AND attempt.package_id = release_row.package_id
              AND attempt.destination_id = destination.destination_id
              AND attempt.outcome IN ('FAILED', 'UNKNOWN'));
    IF required_count > 0 AND succeeded_count = required_count THEN
        next_status := 'RELEASED';
    ELSIF succeeded_count > 0 THEN
        next_status := 'PARTIALLY_RELEASED';
    ELSIF required_count > 0 AND terminal_count = required_count THEN
        next_status := 'FAILED';
    ELSE
        next_status := 'PUBLISHING';
    END IF;
    UPDATE release_publication.release_record
       SET status = next_status,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = p_evaluated_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1, next_status;
END
$fn$;

CREATE FUNCTION release_publication.recall_release(
    p_recall_id uuid,
    p_recall_ref jsonb,
    p_release_id uuid,
    p_package_id uuid,
    p_recall_scope jsonb,
    p_recall_reason jsonb,
    p_authorizing_human_ref jsonb,
    p_authorization_decision_ref jsonb,
    p_notification_policy_ref jsonb,
    p_affected_destinations jsonb,
    p_recalled_at timestamptz,
    p_payload_hash bytea,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    destination_id_text text;
BEGIN
    IF p_recall_id IS NULL OR p_recall_ref IS NULL OR jsonb_typeof(p_recall_ref) <> 'object'
       OR p_recall_ref ->> 'objectType' <> 'release.recall'
       OR (p_recall_ref ->> 'objectId')::uuid IS DISTINCT FROM p_recall_id
       OR p_recall_ref -> 'contentHash' ->> 'digest' !~ '^[0-9a-f]{64}$'
       OR p_release_id IS NULL OR p_package_id IS NULL
       OR p_recall_scope IS NULL OR jsonb_typeof(p_recall_scope) NOT IN ('object', 'array')
       OR p_recall_reason IS NULL OR jsonb_typeof(p_recall_reason) <> 'object'
       OR p_authorizing_human_ref IS NULL OR jsonb_typeof(p_authorizing_human_ref) <> 'object'
       OR p_authorizing_human_ref ->> 'principalKind' <> 'HUMAN'
       OR p_authorization_decision_ref IS NULL OR jsonb_typeof(p_authorization_decision_ref) <> 'object'
       OR p_notification_policy_ref IS NULL OR jsonb_typeof(p_notification_policy_ref) <> 'object'
       OR p_affected_destinations IS NULL OR jsonb_typeof(p_affected_destinations) <> 'array'
       OR jsonb_array_length(p_affected_destinations) = 0
       OR p_recalled_at IS NULL OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint, NULL::text;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint, NULL::text; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF p_authorizing_human_ref ->> 'principalId' IS DISTINCT FROM platform_security.context_principal_id()::text
       OR p_authorization_decision_ref ->> 'objectId' IS DISTINCT FROM (
           SELECT decision_id::text FROM platform_security.context_authorization_decision_ref())
       OR p_authorization_decision_ref ->> 'objectType' <> 'identity.authorization_decision' THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    IF release_row.aggregate_version IS NULL
       OR release_row.package_id IS DISTINCT FROM p_package_id
       OR release_row.status IN ('DRAFT', 'CANCELLED', 'SUPERSEDED', 'RECALLED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    FOR destination_id_text IN SELECT jsonb_array_elements_text(p_affected_destinations) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM release_publication.release_destination
             WHERE package_id = p_package_id AND destination_id = destination_id_text::uuid) THEN
            RETURN QUERY SELECT 'INVALID', release_row.aggregate_version, release_row.status;
            RETURN;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM release_publication.release_recall WHERE recall_id = p_recall_id) THEN
        RETURN QUERY SELECT 'DUPLICATE', release_row.aggregate_version, release_row.status;
        RETURN;
    END IF;
    INSERT INTO release_publication.release_recall (
        recall_id, release_id, package_id, enterprise_id, project_id,
        recall_scope, recall_reason,
        authorizing_human_ref, authorization_decision_ref, notification_policy_ref,
        affected_destinations, recalled_at, payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        p_recall_id, p_release_id, p_package_id, release_row.enterprise_id,
        release_row.project_id, p_recall_scope, p_recall_reason,
        p_authorizing_human_ref, p_authorization_decision_ref, p_notification_policy_ref,
        p_affected_destinations, p_recalled_at, p_payload_hash, p_updated_by_principal_id,
        p_updated_by_actor_snapshot_id, p_updated_authorization_decision_id, p_source_command_id);
    INSERT INTO release_publication.release_impact_review (
        impact_review_id, release_id, package_id, enterprise_id, project_id,
        triggering_refs, affected_destinations,
        risk_classification, required_actions, human_intervention_required, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        uuidv7(), p_release_id, p_package_id, release_row.enterprise_id,
        release_row.project_id,
        jsonb_build_array(p_authorization_decision_ref), p_affected_destinations,
        'RECALL_REQUESTED', jsonb_build_array('NOTIFY_DESTINATIONS'), true, p_payload_hash,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id, p_source_command_id);
    UPDATE release_publication.release_record
       SET recall_ref = p_recall_ref,
           status = 'RECALLED',
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = p_recalled_at,
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', release_row.aggregate_version + 1, 'RECALLED'::text;
END
$fn$;

-- Application can only read these facts and execute the owner functions.
ALTER TABLE release_publication.publication_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.publication_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_attempt_select ON release_publication.publication_attempt
    FOR SELECT TO release_publication_app USING (
        (release_publication.publication_attempt.project_id IS NULL
         AND platform_security.context_allows_enterprise(release_publication.publication_attempt.enterprise_id))
        OR (release_publication.publication_attempt.project_id IS NOT NULL
            AND platform_security.context_allows_project(
                release_publication.publication_attempt.enterprise_id,
                release_publication.publication_attempt.project_id)));
CREATE POLICY publication_attempt_owner_all ON release_publication.publication_attempt
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.publication_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.publication_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_observation_select ON release_publication.publication_observation
    FOR SELECT TO release_publication_app USING (
        (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY publication_observation_owner_all ON release_publication.publication_observation
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.publication_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.publication_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_receipt_select ON release_publication.publication_receipt
    FOR SELECT TO release_publication_app USING (
        (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY publication_receipt_owner_all ON release_publication.publication_receipt
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.publication_failure ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.publication_failure FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_failure_select ON release_publication.publication_failure
    FOR SELECT TO release_publication_app USING (
        (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY publication_failure_owner_all ON release_publication.publication_failure
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.release_recall ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_recall FORCE ROW LEVEL SECURITY;
CREATE POLICY release_recall_select ON release_publication.release_recall
    FOR SELECT TO release_publication_app USING (
        (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_recall_owner_all ON release_publication.release_recall
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.release_impact_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_impact_review FORCE ROW LEVEL SECURITY;
CREATE POLICY release_impact_select ON release_publication.release_impact_review
    FOR SELECT TO release_publication_app USING (
        (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_impact_owner_all ON release_publication.release_impact_review
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

-- Scope mirrors are copied from the owning Release by the owner functions and
-- are immutable thereafter. They let the application read policy enforce the
-- same enterprise/project boundary as the Release aggregate.
CREATE INDEX publication_attempt_scope_idx
    ON release_publication.publication_attempt (enterprise_id, project_id, release_id);
CREATE INDEX publication_observation_scope_idx
    ON release_publication.publication_observation (enterprise_id, project_id, release_id);
CREATE INDEX publication_receipt_scope_idx
    ON release_publication.publication_receipt (enterprise_id, project_id, release_id);
CREATE INDEX publication_failure_scope_idx
    ON release_publication.publication_failure (enterprise_id, project_id, release_id);
CREATE INDEX release_recall_scope_idx
    ON release_publication.release_recall (enterprise_id, project_id, release_id);
CREATE INDEX release_impact_scope_idx
    ON release_publication.release_impact_review (enterprise_id, project_id, release_id);

-- The owner functions are the only application write boundary. The grants are
-- declared after all signatures exist so no overloaded function is exposed.
REVOKE ALL ON release_publication.publication_attempt,
    release_publication.publication_observation,
    release_publication.publication_receipt,
    release_publication.publication_failure,
    release_publication.release_recall,
    release_publication.release_impact_review
    FROM release_publication_app;
GRANT SELECT ON release_publication.publication_attempt,
    release_publication.publication_observation,
    release_publication.publication_receipt,
    release_publication.publication_failure,
    release_publication.release_recall,
    release_publication.release_impact_review
    TO release_publication_app;

REVOKE ALL ON FUNCTION release_publication.validate_release_readiness(
    uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.authorize_release(
    uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.create_publication_attempt(
    uuid, uuid, uuid, uuid, integer, text, jsonb, timestamptz, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.record_publication_receipt(
    uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, bytea, bytea, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.record_publication_failure(
    uuid, jsonb, uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, bytea, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.complete_release(
    uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.recall_release(
    uuid, jsonb, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_publication.validate_release_readiness(
    uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.authorize_release(
    uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.create_publication_attempt(
    uuid, uuid, uuid, uuid, integer, text, jsonb, timestamptz, jsonb, bytea, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.record_publication_receipt(
    uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, bytea, bytea, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.record_publication_failure(
    uuid, jsonb, uuid, uuid, uuid, uuid, text, boolean, text, jsonb, jsonb, bytea, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.complete_release(
    uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.recall_release(
    uuid, jsonb, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, bytea, uuid, uuid, uuid, uuid) TO release_publication_app;

RESET ROLE;
