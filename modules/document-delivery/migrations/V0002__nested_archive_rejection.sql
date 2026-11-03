-- Preserve immutable @1 history and admit new @2 batches with durable rejection details.
SET ROLE mvp_ddl;

ALTER TABLE document_delivery.input_batches
  DROP CONSTRAINT input_batches_policy_version_check,
  ADD CONSTRAINT input_batches_policy_version_check
    CHECK (policy_version IN ('mvp.zip-input@1', 'mvp.zip-input@2')),
  ADD COLUMN rejected_archive_paths jsonb;

CREATE FUNCTION document_delivery.valid_rejected_archive_paths(paths jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(paths) = 'array' THEN
    jsonb_array_length(paths) BETWEEN 1 AND 1000
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(paths) AS item(value)
      WHERE jsonb_typeof(value) <> 'string'
        OR octet_length(value #>> '{}') NOT BETWEEN 1 AND 240
    )
  ELSE false END
$$;
REVOKE ALL ON FUNCTION document_delivery.valid_rejected_archive_paths(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_delivery.valid_rejected_archive_paths(jsonb) TO mvp_runtime;

ALTER TABLE document_delivery.input_batches
  ADD CONSTRAINT input_batches_rejected_archive_paths_check CHECK (
    (rejected_archive_paths IS NOT NULL) =
      (status = 'REJECTED' AND reason_codes ? 'NESTED_ARCHIVE_NOT_ALLOWED')
    AND (rejected_archive_paths IS NULL OR (
      policy_version = 'mvp.zip-input@2' AND manifest_id IS NULL
      AND document_delivery.valid_rejected_archive_paths(rejected_archive_paths)
    ))
  );

RESET ROLE;
