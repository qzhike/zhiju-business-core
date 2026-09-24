-- The controlled final worker keeps its own resumable technical progress.
-- Business facts remain owned by their existing command transactions.

ALTER TABLE task_execution.process_instance
  ADD COLUMN controlled_final_source_ref jsonb,
  ADD COLUMN controlled_final_attempt_ref jsonb,
  ADD COLUMN controlled_final_policy_ref jsonb,
  ADD COLUMN controlled_final_run_version bigint,
  ADD COLUMN controlled_final_result_ref jsonb,
  ADD COLUMN controlled_final_bundle_ref jsonb,
  ADD COLUMN controlled_final_validation_refs jsonb,
  ADD COLUMN controlled_final_acceptance_ref jsonb,
  ADD COLUMN controlled_final_step text,
  ADD CONSTRAINT controlled_final_process_shape CHECK (
    process_type <> 'controlled-final@1'
    OR (
      project_id IS NOT NULL
      AND controlled_final_source_ref IS NOT NULL
      AND controlled_final_attempt_ref IS NOT NULL
      AND controlled_final_policy_ref IS NOT NULL
      AND controlled_final_run_version >= 1
      AND controlled_final_step IN ('SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE', 'DONE')
    )
  );

CREATE INDEX process_instance_controlled_final_due_idx
  ON task_execution.process_instance (enterprise_id, project_id, next_action_at, updated_at)
  WHERE process_type = 'controlled-final@1' AND state = 'ACTIVE';

ALTER TABLE task_execution.process_step
  ADD COLUMN source_fact_ref jsonb,
  ADD COLUMN stable_idempotency_key text;

CREATE UNIQUE INDEX process_step_stable_key_unique
  ON task_execution.process_step (process_id, stable_idempotency_key)
  WHERE stable_idempotency_key IS NOT NULL;
