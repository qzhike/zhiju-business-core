-- IM-06 #221: immutable, Project-scoped execution capability bundles.
SET ROLE identity_policy_owner;

CREATE FUNCTION identity_policy.canonical_jsonb_text(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog
AS $fn$
DECLARE item record; kind text; result text; separator text := '';
DECLARE number_value numeric; normalized_key text; previous_key text;
BEGIN
    kind := jsonb_typeof(p_value);
    IF kind = 'object' THEN
        result := '{';
        FOR item IN SELECT key, value FROM jsonb_each(p_value)
            ORDER BY encode(convert_to(normalize(key, NFC), 'UTF8'), 'hex') LOOP
            normalized_key := normalize(item.key, NFC);
            IF normalized_key = previous_key THEN
                RAISE EXCEPTION 'canonical JSON property names collide after NFC normalization'
                    USING ERRCODE = '22023';
            END IF;
            previous_key := normalized_key;
            result := result || separator || to_jsonb(normalized_key)::text || ':'
                || identity_policy.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || '}';
    ELSIF kind = 'array' THEN
        result := '[';
        FOR item IN SELECT value FROM jsonb_array_elements(p_value)
            WITH ORDINALITY AS elements(value, ordinal) ORDER BY ordinal LOOP
            result := result || separator || identity_policy.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || ']';
    ELSIF kind = 'string' THEN
        RETURN to_jsonb(normalize(p_value #>> '{}', NFC))::text;
    ELSIF kind = 'number' THEN
        number_value := (p_value #>> '{}')::numeric;
        IF number_value <> trunc(number_value)
           OR abs(number_value) > 9007199254740991::numeric THEN
            RAISE EXCEPTION 'canonical JSON number is not a safe integer'
                USING ERRCODE = '22023';
        END IF;
        RETURN trunc(number_value)::text;
    ELSIF kind = 'boolean' THEN RETURN p_value #>> '{}';
    ELSIF kind = 'null' THEN RETURN 'null';
    END IF;
    RAISE EXCEPTION 'unsupported canonical JSON value' USING ERRCODE = '22023';
END
$fn$;
REVOKE ALL ON FUNCTION identity_policy.canonical_jsonb_text(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_policy.canonical_jsonb_text(jsonb)
    FROM identity_policy_app;

CREATE TABLE identity_policy.execution_capability_bundle (
    bundle_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    work_order_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    contract_hash bytea NOT NULL CHECK (octet_length(contract_hash) = 32),
    context_snapshot_id uuid NOT NULL,
    context_hash bytea NOT NULL CHECK (octet_length(context_hash) = 32),
    service_principal_id uuid NOT NULL,
    canonical_payload jsonb NOT NULL,
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    issued_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    source_command_id uuid NOT NULL,
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT execution_bundle_expiry CHECK (valid_until > issued_at),
    CONSTRAINT execution_bundle_scope_unique UNIQUE (enterprise_id, project_id, bundle_id),
    CONSTRAINT execution_bundle_target_unique UNIQUE (enterprise_id, project_id, run_id, bundle_id)
);

CREATE FUNCTION identity_policy.guard_execution_capability_bundle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $guard$
DECLARE receipt identity_policy.command_receipt%ROWTYPE;
DECLARE payload_scope jsonb;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'execution capability bundle is immutable' USING ERRCODE = '23514';
    END IF;
    payload_scope := jsonb_build_object('enterpriseId', NEW.enterprise_id::text,
        'projectId', NEW.project_id::text);
    SELECT * INTO receipt FROM identity_policy.command_receipt
     WHERE command_id = NEW.source_command_id;
    IF NOT FOUND OR receipt.outcome <> 'PENDING'
       OR receipt.command_type <> 'identity.issue_execution_capability_bundle'
       OR receipt.command_version <> '1.0'
       OR receipt.target_type <> 'zhiju.identity.execution_capability_bundle'
       OR receipt.target_id <> NEW.bundle_id
       OR receipt.enterprise_id <> NEW.enterprise_id
       OR receipt.project_id <> NEW.project_id
       OR receipt.created_by_principal_id <> NEW.created_by_principal_id
       OR NEW.created_by_principal_id <> platform_security.context_principal_id()
       OR receipt.authorization_decision_id IS DISTINCT FROM
            (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
       OR NEW.canonical_payload->'runRef'->>'objectId' <> NEW.run_id::text
       OR NEW.canonical_payload->'workOrderRef'->>'objectId' <> NEW.work_order_id::text
       OR NEW.canonical_payload->'workOrderContractRef'->>'objectId' <> NEW.contract_id::text
       OR NEW.canonical_payload->'workOrderContractRef'->'contentHash'->>'digest'
            <> encode(NEW.contract_hash, 'hex')
       OR NEW.canonical_payload->'contextSnapshotRef'->>'snapshotId'
            <> NEW.context_snapshot_id::text
       OR NEW.canonical_payload->'contextSnapshotRef'->'contentHash'->>'digest'
            <> encode(NEW.context_hash, 'hex')
       OR NEW.canonical_payload->'servicePrincipalRef'->>'principalId'
            <> NEW.service_principal_id::text
       OR NEW.service_principal_id <> NEW.created_by_principal_id
       OR NEW.canonical_payload->'runRef'->'scope' <> payload_scope
       OR NEW.canonical_payload->'workOrderRef'->'scope' <> payload_scope
       OR NEW.canonical_payload->'workOrderContractRef'->'scope' <> payload_scope
       OR NEW.canonical_payload->'contextSnapshotRef'->'scope' <> payload_scope
       OR NEW.canonical_payload->>'issuedAt' <> to_char(NEW.issued_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR NEW.canonical_payload->>'validUntil' <> to_char(NEW.valid_until AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR NEW.payload_hash <> sha256(convert_to(
            identity_policy.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
        RAISE EXCEPTION 'execution bundle source or payload mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION identity_policy.guard_execution_capability_bundle() FROM PUBLIC;
-- FORCE RLS applies to the SECURITY DEFINER owner while it verifies the
-- pending source Receipt. The app role keeps its existing scoped policy.
CREATE POLICY execution_bundle_source_receipt_owner_read
    ON identity_policy.command_receipt FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER execution_bundle_guard
    BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.execution_capability_bundle
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_execution_capability_bundle();

ALTER TABLE identity_policy.execution_capability_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.execution_capability_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_bundle_select ON identity_policy.execution_capability_bundle
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY execution_bundle_insert ON identity_policy.execution_capability_bundle
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
        AND created_by_principal_id = platform_security.context_principal_id());
REVOKE UPDATE, DELETE ON identity_policy.execution_capability_bundle FROM identity_policy_app;

RESET ROLE;
