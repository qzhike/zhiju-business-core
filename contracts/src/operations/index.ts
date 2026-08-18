import { artifactSchema } from './artifact.schema.js';
import { enterpriseProjectSchema } from './enterprise-project.schema.js';
import { identityPolicySchema } from './identity-policy.schema.js';
import { qualityGovernanceSchema } from './quality-governance.schema.js';
import { releasePublicationSchema } from './release-publication.schema.js';
import { taskExecutionSchema } from './task-execution.schema.js';

export * from './artifact.schema.js';
export * from './enterprise-project.schema.js';
export * from './identity-policy.schema.js';
export * from './quality-governance.schema.js';
export * from './release-publication.schema.js';
export * from './task-execution.schema.js';

export const executableOperationSchemas = [
  identityPolicySchema,
  enterpriseProjectSchema,
  taskExecutionSchema,
  artifactSchema,
  qualityGovernanceSchema,
  releasePublicationSchema,
] as const;
