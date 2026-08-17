import { identityPolicySchema } from './identity-policy.schema.js';

export * from './identity-policy.schema.js';

export const executableOperationSchemas = [identityPolicySchema] as const;
