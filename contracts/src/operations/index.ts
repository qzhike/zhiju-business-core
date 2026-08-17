import { artifactSchema } from './artifact.schema.js';
import { enterpriseProjectSchema } from './enterprise-project.schema.js';
import { identityPolicySchema } from './identity-policy.schema.js';

export * from './artifact.schema.js';
export * from './enterprise-project.schema.js';
export * from './identity-policy.schema.js';

export const executableOperationSchemas = [
  identityPolicySchema,
  enterpriseProjectSchema,
  artifactSchema,
] as const;
