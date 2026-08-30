-- IM-05 WI-05: Renderer Attempt, sanitized Raw Receipt, and authoritative
-- binding read model. V7000 remains immutable.

SET ROLE integration_gateway_owner;

CREATE TABLE integration_gateway.render_attempt (
    attempt_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    stable_key_hash bytea NOT NULL,
    request_payload_hash bytea NOT NULL,
    request_payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'CREATED',
    output_object_ref text,
    output_checksum bytea,
    raw_receipt_id uuid,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT render_attempt_stable_hash_len CHECK (octet_length(stable_key_hash) = 32),
    CONSTRAINT render_attempt_request_hash_len CHECK (octet_length(request_payload_hash) = 32),
    CONSTRAINT render_attempt_output_hash_len CHECK (
        output_checksum IS NULL OR octet_length(output_checksum) = 32),
    CONSTRAINT render_attempt_status_closed CHECK (
        status IN ('CREATED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
    CONSTRAINT render_attempt_scope_shape CHECK (
        jsonb_typeof(request_payload->'revisionRef'->'scope') = 'object'
        AND request_payload->'revisionRef'->'scope'->>'enterpriseId' = enterprise_id::text
        AND request_payload->'revisionRef'->'scope'->>'projectId' IS NOT DISTINCT FROM project_id::text),
    CONSTRAINT render_attempt_source_locator_safe CHECK (
        request_payload->>'canonicalContentRef' ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'
        AND request_payload->>'canonicalContentRef' !~* '(token|secret|credential|presigned)'),
    CONSTRAINT render_attempt_output_locator_safe CHECK (
        output_object_ref IS NULL
        OR (output_object_ref ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'
            AND output_object_ref !~* '(token|secret|credential|presigned)')),
    CONSTRAINT render_attempt_terminal_shape CHECK (
        (status = 'SUCCEEDED'
         AND output_object_ref IS NOT NULL
         AND output_checksum IS NOT NULL
         AND raw_receipt_id IS NOT NULL
         AND error_code IS NULL)
        OR (status IN ('FAILED', 'UNKNOWN')
            AND output_object_ref IS NULL
            AND output_checksum IS NULL
            AND raw_receipt_id IS NULL
            AND error_code IS NOT NULL)
        OR (status = 'CREATED'
            AND output_object_ref IS NULL
            AND output_checksum IS NULL
            AND raw_receipt_id IS NULL
            AND error_code IS NULL)),
    CONSTRAINT render_attempt_scope_key_unique
        UNIQUE NULLS NOT DISTINCT (enterprise_id, project_id, stable_key_hash)
);

CREATE INDEX render_attempt_scope_updated_idx
    ON integration_gateway.render_attempt (enterprise_id, project_id, updated_at DESC);
CREATE INDEX render_attempt_reconcile_idx
    ON integration_gateway.render_attempt (updated_at)
    WHERE status = 'UNKNOWN';

CREATE TABLE integration_gateway.raw_external_receipt (
    receipt_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    attempt_id uuid NOT NULL UNIQUE
        REFERENCES integration_gateway.render_attempt (attempt_id) ON DELETE RESTRICT,
    provider_receipt_ref jsonb NOT NULL,
    receipt_payload_ref text NOT NULL,
    receipt_payload_hash bytea NOT NULL,
    receipt_content_hash bytea NOT NULL,
    observed_outcome text NOT NULL,
    occurred_at timestamptz,
    recorded_at timestamptz NOT NULL,
    CONSTRAINT raw_receipt_payload_hash_len CHECK (octet_length(receipt_payload_hash) = 32),
    CONSTRAINT raw_receipt_content_hash_len CHECK (octet_length(receipt_content_hash) = 32),
    CONSTRAINT raw_receipt_outcome_closed CHECK (
        observed_outcome IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')),
    CONSTRAINT raw_receipt_scope_fk UNIQUE (receipt_id, enterprise_id, project_id),
    CONSTRAINT raw_receipt_safe_locator CHECK (
        receipt_payload_ref ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'
        AND receipt_payload_ref !~* '(token|secret|credential|presigned)'),
    CONSTRAINT raw_receipt_provider_ref_safe CHECK (
        provider_receipt_ref::text !~* '(access[_ -]?token|app[_ -]?secret|credential|presigned[_ -]?url)')
);

ALTER TABLE integration_gateway.render_attempt
    ADD CONSTRAINT render_attempt_receipt_scope_fk
    FOREIGN KEY (raw_receipt_id, enterprise_id, project_id)
    REFERENCES integration_gateway.raw_external_receipt (receipt_id, enterprise_id, project_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION integration_gateway.guard_render_attempt_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.status <> 'CREATED'
       OR NEW.output_object_ref IS NOT NULL
       OR NEW.output_checksum IS NOT NULL
       OR NEW.raw_receipt_id IS NOT NULL
       OR NEW.error_code IS NOT NULL THEN
        RAISE EXCEPTION 'render attempt must be inserted as CREATED'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER render_attempt_insert_guard
    BEFORE INSERT ON integration_gateway.render_attempt
    FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_render_attempt_insert();

CREATE FUNCTION integration_gateway.transition_render_attempt(
    p_attempt_id uuid,
    p_expected_request_hash bytea,
    p_status text,
    p_output_object_ref text,
    p_output_checksum bytea,
    p_raw_receipt_id uuid,
    p_error_code text,
    p_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, integration_gateway, platform_security
AS $transition$
DECLARE
    current_row integration_gateway.render_attempt%ROWTYPE;
    receipt_row integration_gateway.raw_external_receipt%ROWTYPE;
BEGIN
    SELECT * INTO current_row
      FROM integration_gateway.render_attempt
     WHERE attempt_id = p_attempt_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'render attempt not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (
        (current_row.project_id IS NULL
         AND platform_security.context_allows_enterprise(current_row.enterprise_id))
        OR platform_security.context_allows_project(
            current_row.enterprise_id, current_row.project_id)) THEN
        RAISE EXCEPTION 'render attempt outside transaction context' USING ERRCODE = '42501';
    END IF;
    IF current_row.request_payload_hash IS DISTINCT FROM p_expected_request_hash THEN
        RAISE EXCEPTION 'render attempt request hash mismatch' USING ERRCODE = '22023';
    END IF;
    IF current_row.status IN ('SUCCEEDED', 'FAILED') THEN
        RAISE EXCEPTION 'render attempt is terminal' USING ERRCODE = '55000';
    END IF;
    IF current_row.status = 'UNKNOWN' AND p_status = 'UNKNOWN' THEN
        RETURN;
    END IF;
    IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'invalid render attempt transition' USING ERRCODE = '22023';
    END IF;
    IF p_status = 'SUCCEEDED' THEN
        IF p_output_object_ref IS NULL OR p_output_checksum IS NULL OR p_raw_receipt_id IS NULL
           OR p_error_code IS NOT NULL THEN
            RAISE EXCEPTION 'successful render transition is incomplete' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO receipt_row
          FROM integration_gateway.raw_external_receipt
         WHERE receipt_id = p_raw_receipt_id
           AND attempt_id = p_attempt_id
           AND enterprise_id = current_row.enterprise_id
           AND project_id IS NOT DISTINCT FROM current_row.project_id
           AND observed_outcome = 'SUCCEEDED';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'successful render receipt is missing or mismatched'
                USING ERRCODE = '22023';
        END IF;
    ELSIF p_output_object_ref IS NOT NULL OR p_output_checksum IS NOT NULL
          OR p_raw_receipt_id IS NOT NULL OR p_error_code IS NULL THEN
        RAISE EXCEPTION 'failed or unknown render transition has invalid shape'
            USING ERRCODE = '22023';
    END IF;

    UPDATE integration_gateway.render_attempt
       SET status = p_status,
           output_object_ref = p_output_object_ref,
           output_checksum = p_output_checksum,
           raw_receipt_id = p_raw_receipt_id,
           error_code = p_error_code,
           updated_at = p_updated_at
     WHERE attempt_id = p_attempt_id;
END
$transition$;

REVOKE ALL ON FUNCTION integration_gateway.guard_render_attempt_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_gateway.transition_render_attempt(
    uuid, bytea, text, text, bytea, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_gateway.transition_render_attempt(
    uuid, bytea, text, text, bytea, uuid, text, timestamptz) TO integration_gateway_app;

REVOKE UPDATE, DELETE ON integration_gateway.render_attempt FROM integration_gateway_app;
REVOKE UPDATE, DELETE ON integration_gateway.raw_external_receipt FROM integration_gateway_app;
GRANT SELECT, INSERT ON integration_gateway.render_attempt TO integration_gateway_app;
GRANT SELECT, INSERT ON integration_gateway.raw_external_receipt TO integration_gateway_app;

ALTER TABLE integration_gateway.render_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.render_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY render_attempt_select ON integration_gateway.render_attempt
    FOR SELECT TO integration_gateway_app
    USING (((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY render_attempt_insert ON integration_gateway.render_attempt
    FOR INSERT TO integration_gateway_app
    WITH CHECK (((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY render_attempt_owner_all ON integration_gateway.render_attempt
    FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);

ALTER TABLE integration_gateway.raw_external_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.raw_external_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY raw_external_receipt_select ON integration_gateway.raw_external_receipt
    FOR SELECT TO integration_gateway_app
    USING (((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY raw_external_receipt_insert ON integration_gateway.raw_external_receipt
    FOR INSERT TO integration_gateway_app
    WITH CHECK (((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY raw_external_receipt_owner_all ON integration_gateway.raw_external_receipt
    FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);

RESET ROLE;
