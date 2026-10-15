-- Preparation intent and append-only owning facts. No cross-owner foreign keys.
SET ROLE enterprise_project_owner;
ALTER TABLE enterprise_project.project DROP CONSTRAINT project_status_closed;
ALTER TABLE enterprise_project.project ADD CONSTRAINT project_status_closed CHECK(status IN ('PREPARING','ACTIVE','SUSPENDED','ARCHIVED'));
ALTER TABLE enterprise_project.project ADD COLUMN creation_mode text NOT NULL DEFAULT 'FULL_START' CHECK(creation_mode IN ('FULL_START','PREPARATION'));
CREATE TABLE enterprise_project.preparation_fact (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('PRESET','PUBLICATION','WITHDRAWAL','REQUEST','STEP','SOURCE_LINK','SOURCE','HANDOFF','HANDOFF_STEP','HANDOFF_ATTEMPT','HANDOFF_RESULT','INBOX')),
 enterprise_id uuid NOT NULL, project_id uuid, creator_id uuid NOT NULL,
 identity_key text NOT NULL, payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 actor_ref jsonb NOT NULL, decision_ref jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,identity_key), CHECK(length(identity_key)>0)
);
CREATE FUNCTION enterprise_project.guard_preparation_fact_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'preparation facts are immutable' USING ERRCODE='23514'; END$$;
REVOKE ALL ON FUNCTION enterprise_project.guard_preparation_fact_immutable() FROM PUBLIC;
CREATE TRIGGER preparation_fact_immutable BEFORE UPDATE OR DELETE ON enterprise_project.preparation_fact FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_preparation_fact_immutable();
ALTER TABLE enterprise_project.preparation_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.preparation_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY preparation_fact_scope ON enterprise_project.preparation_fact TO enterprise_project_app USING (
 platform_security.context_allows_enterprise(enterprise_id) AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id,project_id))) WITH CHECK (
 platform_security.context_allows_enterprise(enterprise_id) AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id,project_id)));
GRANT SELECT,INSERT ON enterprise_project.preparation_fact TO enterprise_project_app;
CREATE FUNCTION enterprise_project.guard_preparation_fact_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.actor_ref->>'objectId' IS DISTINCT FROM platform_security.context_actor_snapshot_id()::text THEN
  RAISE EXCEPTION 'preparation actor does not match context' USING ERRCODE='23514';
 END IF;
 IF NEW.kind='REQUEST' AND (NEW.payload->>'creatorId' IS DISTINCT FROM NEW.creator_id::text OR NEW.payload->'originalCommand'->'scopeRef'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR NEW.payload->'originalCommand'->'scopeRef'->>'projectId' IS DISTINCT FROM NEW.project_id::text OR NEW.payload->'originalCommand'->'targetRef'->>'objectId' IS DISTINCT FROM NEW.id::text) THEN
  RAISE EXCEPTION 'preparation intent scope mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION enterprise_project.guard_preparation_fact_provenance() FROM PUBLIC;
CREATE TRIGGER preparation_fact_provenance BEFORE INSERT ON enterprise_project.preparation_fact FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_preparation_fact_provenance();
CREATE OR REPLACE FUNCTION enterprise_project.guard_outbox_scope_mirror() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
 IF NEW.event_type='project.PreparingProjectCreated' AND NEW.event_version='1.0' THEN
  IF NEW.payload->'projectRef'->'scope'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR NEW.payload->'projectRef'->'scope'->>'projectId' IS DISTINCT FROM NEW.project_id::text OR NEW.payload->'projectRef'->>'objectId' IS DISTINCT FROM NEW.project_id::text OR NEW.payload->'enterpriseRef'->>'objectId' IS DISTINCT FROM NEW.enterprise_id::text THEN
   RAISE EXCEPTION 'preparation event scope mirror mismatch' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.event_type='project.SourceMaterialAccepted' AND NEW.event_version='1.0' AND NEW.payload->'sourceMaterialRef'->>'objectType'='zhiju.project.source_material' AND NOT (NEW.payload ? 'enterpriseId') AND NOT (NEW.payload ? 'projectId') THEN
  IF NEW.payload->'sourceMaterialRef'->'scope'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR NEW.payload->'sourceMaterialRef'->'scope'->>'projectId' IS DISTINCT FROM NEW.project_id::text OR NEW.payload->'projectRef'->'scope'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR NEW.payload->'projectRef'->>'objectId' IS DISTINCT FROM NEW.project_id::text THEN
   RAISE EXCEPTION 'bounded source event scope mirror mismatch' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text THEN
  RAISE EXCEPTION 'outbox scope mirror mismatch: payload enterpriseId' USING ERRCODE='22023';
 END IF;
 IF NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
  RAISE EXCEPTION 'outbox scope mirror mismatch: payload projectId' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END
$guard$;
CREATE UNIQUE INDEX preparation_request_scope_reservation ON enterprise_project.preparation_fact(enterprise_id,project_id) WHERE kind='REQUEST';
RESET ROLE;
