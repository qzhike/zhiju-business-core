-- Admit new @4 batches without rewriting any previous policy or sealed fact.
SET ROLE mvp_ddl;

ALTER TABLE document_delivery.input_batches
  DROP CONSTRAINT input_batches_policy_version_check,
  ADD CONSTRAINT input_batches_policy_version_check
    CHECK (policy_version IN ('mvp.zip-input@1', 'mvp.zip-input@2', 'mvp.zip-input@3', 'mvp.zip-input@4')),
  DROP CONSTRAINT input_batches_rejected_archive_paths_check,
  ADD CONSTRAINT input_batches_rejected_archive_paths_check CHECK (
    (rejected_archive_paths IS NOT NULL) =
      (status = 'REJECTED' AND reason_codes ? 'NESTED_ARCHIVE_NOT_ALLOWED')
    AND (rejected_archive_paths IS NULL OR (
      policy_version IN ('mvp.zip-input@2', 'mvp.zip-input@3', 'mvp.zip-input@4') AND manifest_id IS NULL
      AND document_delivery.valid_rejected_archive_paths(rejected_archive_paths)
    ))
  ),
  DROP CONSTRAINT input_batches_limit_violation_check,
  ADD CONSTRAINT input_batches_limit_violation_check CHECK (
    (limit_violation IS NOT NULL) =
      (policy_version IN ('mvp.zip-input@3', 'mvp.zip-input@4') AND status = 'REJECTED' AND reason_codes ? 'ZIP_LIMIT_EXCEEDED')
    AND (limit_violation IS NULL OR (
      manifest_id IS NULL AND document_delivery.valid_limit_violation(limit_violation)
    ))
  );

RESET ROLE;
