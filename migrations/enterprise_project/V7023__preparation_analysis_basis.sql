-- Separate immutable template-analysis basis facts; legacy source and preset rows stay intact.
SET ROLE enterprise_project_owner;
ALTER TABLE enterprise_project.preparation_fact DROP CONSTRAINT preparation_fact_kind_check;
ALTER TABLE enterprise_project.preparation_fact ADD CONSTRAINT preparation_fact_kind_check CHECK (kind IN (
 'PRESET','PUBLICATION','WITHDRAWAL','REQUEST','STEP','SOURCE_LINK','SOURCE','HANDOFF','HANDOFF_STEP','HANDOFF_ATTEMPT','HANDOFF_RESULT','INBOX',
 'ANALYSIS_BASIS','ANALYSIS_BASIS_PUBLICATION','ANALYSIS_BASIS_WITHDRAWAL'
));
CREATE UNIQUE INDEX preparation_analysis_basis_publication_version
 ON enterprise_project.preparation_fact ((payload->'basisRef'->>'versionId'))
 WHERE kind='ANALYSIS_BASIS_PUBLICATION';
CREATE UNIQUE INDEX preparation_analysis_basis_single_successor
 ON enterprise_project.preparation_fact ((payload->'supersedesPublicationRef'->>'objectId'))
 WHERE kind='ANALYSIS_BASIS_PUBLICATION' AND payload ? 'supersedesPublicationRef';
RESET ROLE;
