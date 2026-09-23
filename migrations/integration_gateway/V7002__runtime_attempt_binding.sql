-- IM-06: authoritative RuntimeAttempt binding and synthetic-driver acknowledgement.

SET ROLE integration_gateway_owner;

CREATE TABLE integration_gateway.runtime_attempt (
    attempt_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    stable_key_hash bytea NOT NULL,
    request_payload jsonb NOT NULL,
    request_payload_hash bytea NOT NULL,
    invocation_binding jsonb NOT NULL,
    binding_hash bytea NOT NULL,
    status text NOT NULL DEFAULT 'CREATED',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT runtime_attempt_stable_hash_len CHECK (octet_length(stable_key_hash) = 32),
    CONSTRAINT runtime_attempt_request_hash_len CHECK (octet_length(request_payload_hash) = 32),
    CONSTRAINT runtime_attempt_binding_hash_len CHECK (octet_length(binding_hash) = 32),
    CONSTRAINT runtime_attempt_status_closed CHECK (status IN ('CREATED', 'SUCCEEDED', 'UNKNOWN')),
    CONSTRAINT runtime_attempt_scope_shape CHECK (
        request_payload->'runRef'->'scope'->>'enterpriseId' = enterprise_id::text
        AND request_payload->'runRef'->'scope'->>'projectId' = project_id::text
        AND invocation_binding->'runRef' = request_payload->'runRef'),
    CONSTRAINT runtime_attempt_scope_key_unique
        UNIQUE (enterprise_id, project_id, stable_key_hash)
);

CREATE TABLE integration_gateway.runtime_attempt_observation (
    observation_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL UNIQUE
        REFERENCES integration_gateway.runtime_attempt (attempt_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    raw_receipt_id uuid NOT NULL UNIQUE,
    runtime_session_ref jsonb NOT NULL,
    acknowledgement_source text NOT NULL,
    acknowledged_at timestamptz NOT NULL,
    observation_payload jsonb NOT NULL,
    observation_hash bytea NOT NULL,
    CONSTRAINT runtime_observation_source_closed CHECK (
        acknowledgement_source IN ('SYNTHETIC_DRIVER', 'PROVIDER')),
    CONSTRAINT runtime_observation_hash_len CHECK (octet_length(observation_hash) = 32),
    CONSTRAINT runtime_observation_scope_fk UNIQUE
        (observation_id, enterprise_id, project_id)
);

ALTER TABLE integration_gateway.raw_external_receipt
    ALTER COLUMN attempt_id DROP NOT NULL,
    ADD COLUMN attempt_kind text NOT NULL DEFAULT 'RENDERER',
    ADD COLUMN runtime_attempt_id uuid UNIQUE
        REFERENCES integration_gateway.runtime_attempt (attempt_id) ON DELETE RESTRICT,
    ADD CONSTRAINT raw_receipt_attempt_kind_closed CHECK (
        (attempt_kind = 'RENDERER' AND attempt_id IS NOT NULL AND runtime_attempt_id IS NULL)
        OR (attempt_kind = 'RUNTIME' AND attempt_id IS NULL AND runtime_attempt_id IS NOT NULL));

ALTER TABLE integration_gateway.runtime_attempt_observation
    ADD CONSTRAINT runtime_observation_receipt_scope_fk
    FOREIGN KEY (raw_receipt_id, enterprise_id, project_id)
    REFERENCES integration_gateway.raw_external_receipt (receipt_id, enterprise_id, project_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION integration_gateway.guard_runtime_attempt_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.stable_key_hash IS DISTINCT FROM OLD.stable_key_hash
       OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
       OR NEW.request_payload_hash IS DISTINCT FROM OLD.request_payload_hash
       OR NEW.invocation_binding IS DISTINCT FROM OLD.invocation_binding
       OR NEW.binding_hash IS DISTINCT FROM OLD.binding_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NOT ((OLD.status = 'CREATED' AND NEW.status IN ('SUCCEEDED', 'UNKNOWN'))
           OR (OLD.status = 'UNKNOWN' AND NEW.status = 'SUCCEEDED')) THEN
        RAISE EXCEPTION 'runtime attempt immutable binding or transition violation'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'SUCCEEDED' AND NOT EXISTS (
        SELECT 1 FROM integration_gateway.runtime_attempt_observation observation
        JOIN integration_gateway.raw_external_receipt receipt
          ON receipt.receipt_id = observation.raw_receipt_id
         AND receipt.runtime_attempt_id = OLD.attempt_id
         AND receipt.attempt_kind = 'RUNTIME'
         AND receipt.observed_outcome = 'SUCCEEDED'
        WHERE observation.attempt_id = OLD.attempt_id
          AND observation.enterprise_id = OLD.enterprise_id
          AND observation.project_id = OLD.project_id
    ) THEN
        RAISE EXCEPTION 'runtime success requires matching receipt and observation'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION integration_gateway.guard_runtime_attempt_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.status <> 'CREATED' THEN
        RAISE EXCEPTION 'runtime attempt must be inserted as CREATED'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER runtime_attempt_insert_guard
    BEFORE INSERT ON integration_gateway.runtime_attempt
    FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_runtime_attempt_insert();

CREATE TRIGGER runtime_attempt_update_guard
    BEFORE UPDATE ON integration_gateway.runtime_attempt
    FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_runtime_attempt_update();

CREATE FUNCTION integration_gateway.guard_runtime_observation_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'runtime attempt observation is immutable' USING ERRCODE = '55000';
END
$guard$;

CREATE TRIGGER runtime_observation_immutable
    BEFORE UPDATE OR DELETE ON integration_gateway.runtime_attempt_observation
    FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_runtime_observation_immutable();

REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_attempt_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_attempt_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_observation_immutable() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON integration_gateway.runtime_attempt TO integration_gateway_app;
GRANT SELECT, INSERT ON integration_gateway.runtime_attempt_observation TO integration_gateway_app;
REVOKE DELETE ON integration_gateway.runtime_attempt FROM integration_gateway_app;
REVOKE UPDATE, DELETE ON integration_gateway.runtime_attempt_observation FROM integration_gateway_app;

ALTER TABLE integration_gateway.runtime_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.runtime_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_attempt_select ON integration_gateway.runtime_attempt
    FOR SELECT TO integration_gateway_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_attempt_insert ON integration_gateway.runtime_attempt
    FOR INSERT TO integration_gateway_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_attempt_update ON integration_gateway.runtime_attempt
    FOR UPDATE TO integration_gateway_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_attempt_owner_all ON integration_gateway.runtime_attempt
    FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);

ALTER TABLE integration_gateway.runtime_attempt_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.runtime_attempt_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_observation_select ON integration_gateway.runtime_attempt_observation
    FOR SELECT TO integration_gateway_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_observation_insert ON integration_gateway.runtime_attempt_observation
    FOR INSERT TO integration_gateway_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_observation_owner_all ON integration_gateway.runtime_attempt_observation
    FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);

RESET ROLE;
