// IM-04 WI-03 (issue #92): stable Artifact Root business failures.
// Messages are intentionally safe summaries and never include raw payloads.

export const ARTIFACT_SCOPE_INVALID = 'ARTIFACT_SCOPE_INVALID';
export const ARTIFACT_NOT_ACTIVE = 'ARTIFACT_NOT_ACTIVE';
export const ARTIFACT_METADATA_FIELD_FORBIDDEN = 'ARTIFACT_METADATA_FIELD_FORBIDDEN';
export const ARTIFACT_IDENTITY_CONFLICT = 'ARTIFACT_IDENTITY_CONFLICT';
export const ARTIFACT_EXPECTED_VERSION_REQUIRED = 'ARTIFACT_EXPECTED_VERSION_REQUIRED';
export const ARTIFACT_HUMAN_ONLY_DENIED = 'ARTIFACT_HUMAN_ONLY_DENIED';
export const ARTIFACT_QUERY_NOT_FOUND = 'ARTIFACT_QUERY_NOT_FOUND';
export const ARTIFACT_QUERY_SCOPE_MISMATCH = 'ARTIFACT_QUERY_SCOPE_MISMATCH';

export class ArtifactBusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactBusinessError';
  }
}
