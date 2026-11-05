-- Preserve previous policy history and persist the first @3 budget violation.
SET ROLE mvp_ddl;

ALTER TABLE document_delivery.input_batches
  DROP CONSTRAINT input_batches_policy_version_check,
  ADD CONSTRAINT input_batches_policy_version_check
    CHECK (policy_version IN ('mvp.zip-input@1', 'mvp.zip-input@2', 'mvp.zip-input@3')),
  DROP CONSTRAINT input_batches_rejected_archive_paths_check,
  ADD CONSTRAINT input_batches_rejected_archive_paths_check CHECK (
    (rejected_archive_paths IS NOT NULL) =
      (status = 'REJECTED' AND reason_codes ? 'NESTED_ARCHIVE_NOT_ALLOWED')
    AND (rejected_archive_paths IS NULL OR (
      policy_version IN ('mvp.zip-input@2', 'mvp.zip-input@3') AND manifest_id IS NULL
      AND document_delivery.valid_rejected_archive_paths(rejected_archive_paths)
    ))
  ),
  ADD COLUMN limit_violation jsonb;

CREATE FUNCTION document_delivery.valid_limit_violation(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  metric text;
  expected bigint;
  actual numeric;
  expanded numeric;
  compressed numeric;
  path text;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR jsonb_typeof(value->'metric') IS DISTINCT FROM 'string'
    THEN RETURN false; END IF;
  metric := value->>'metric';
  IF value ? 'documentPath' THEN
    IF jsonb_typeof(value->'documentPath') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    path := value->>'documentPath';
    IF octet_length(path) NOT BETWEEN 1 AND 240 OR octet_length(normalize(path, NFC)) > 240
      OR path ~ '^[/~]|^[A-Za-z]:' OR position(chr(92) in path) > 0
      OR position(chr(127) in path) > 0
      OR EXISTS (SELECT 1 FROM generate_series(1,31) AS c WHERE position(chr(c) in path) > 0)
      OR EXISTS (SELECT 1 FROM unnest(string_to_array(path, '/')) AS part WHERE part IN ('.','..'))
      OR (SELECT count(*) FROM unnest(string_to_array(path, '/')) AS part WHERE part <> '') > 16
      OR lower(path) !~ '\.(docx|xlsx)$' OR metric = 'OUTER_ENTRIES'
      THEN RETURN false; END IF;
  END IF;
  IF jsonb_typeof(value->'limit') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF metric = 'EXPANSION_RATIO' THEN
    IF value - ARRAY['metric','expandedBytes','compressedBytes','limit','documentPath'] <> '{}'::jsonb
      OR (value->>'limit')::numeric <> 100
      OR jsonb_typeof(value->'expandedBytes') IS DISTINCT FROM 'number'
      OR jsonb_typeof(value->'compressedBytes') IS DISTINCT FROM 'number'
      THEN RETURN false; END IF;
    expanded := (value->>'expandedBytes')::numeric;
    compressed := (value->>'compressedBytes')::numeric;
    RETURN expanded BETWEEN 0 AND 9007199254740991 AND expanded = trunc(expanded)
      AND compressed BETWEEN 0 AND 9007199254740991 AND compressed = trunc(compressed)
      AND expanded > compressed * 100;
  END IF;
  expected := CASE metric
    WHEN 'ZIP_BYTES' THEN 104857600 WHEN 'OUTER_ENTRIES' THEN 1000
    WHEN 'OFFICE_DOCUMENT_ENTRIES' THEN 1000 WHEN 'OFFICE_ENTRIES' THEN 20000
    WHEN 'ENTRY_BYTES' THEN 52428800 WHEN 'EXPANDED_BYTES' THEN 524288000
    WHEN 'MEMORY_BYTES' THEN 536870912 WHEN 'PROCESSING_TIME_MS' THEN 120000
    ELSE NULL END;
  IF expected IS NULL OR (value->>'limit')::numeric <> expected
    OR value - ARRAY['metric','actual','limit','documentPath'] <> '{}'::jsonb
    OR jsonb_typeof(value->'actual') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  actual := (value->>'actual')::numeric;
  RETURN actual > expected AND actual <= 9007199254740991 AND actual = trunc(actual);
END
$$;
REVOKE ALL ON FUNCTION document_delivery.valid_limit_violation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_delivery.valid_limit_violation(jsonb) TO mvp_runtime;

ALTER TABLE document_delivery.input_batches
  ADD CONSTRAINT input_batches_limit_violation_check CHECK (
    (limit_violation IS NOT NULL) =
      (policy_version = 'mvp.zip-input@3' AND status = 'REJECTED' AND reason_codes ? 'ZIP_LIMIT_EXCEEDED')
    AND (limit_violation IS NULL OR (
      manifest_id IS NULL AND document_delivery.valid_limit_violation(limit_violation)
    ))
  );

RESET ROLE;
