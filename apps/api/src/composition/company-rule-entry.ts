import {
  createCompanyRuleAuthorizationPort,
  createCompanyRuleCapabilities,
  type CompanyRuleAuthorityConfig,
  type CompanyRuleSnapshotConfig,
} from '@zhiju/identity-policy';
import {
  createCompanyStartupCapabilities,
  type CompanyStartupConfig,
} from '@zhiju/enterprise-project';
import {
  companyObjectTarget,
  companySnapshotReadRequest,
  type CompanyRuleSession,
} from '@zhiju/contracts';

export interface CompanyRuleCompositionConfig {
  identity: CompanyRuleAuthorityConfig;
  enterprise: Omit<CompanyStartupConfig, 'authorization' | 'readSnapshot'>;
  dependencySession(): Promise<CompanyRuleSession>;
  validateIdentityResult?: CompanyRuleSnapshotConfig['validateResult'];
}

/** Internal owning composition; it exposes no HTTP route or Browser-controlled actor. */
export function createCompanyRuleComposition(config: CompanyRuleCompositionConfig) {
  const authorization = createCompanyRuleAuthorizationPort(config.identity);
  const enterprise = createCompanyStartupCapabilities({
    ...config.enterprise,
    authorization,
    readSnapshot: async (ref, profile) => {
      const request = companySnapshotReadRequest(ref, profile);
      const proof = await authorization.authorize(
        await config.dependencySession(),
        'identity.company_rule.snapshot.read',
        companyObjectTarget('identity.policy_snapshot', ref.objectId),
        request,
      );
      return identity.read(proof, request);
    },
  });
  const identity = createCompanyRuleCapabilities({
    db: config.identity.db,
    authorization,
    ...(config.identity.clock ? { clock: config.identity.clock } : {}),
    ...(config.validateIdentityResult ? { validateResult: config.validateIdentityResult } : {}),
    validateDefinition: async (request) => {
      const proof = await authorization.authorize(
        await config.dependencySession(),
        'project.company_startup.definition.validate',
        companyObjectTarget('identity.policy_snapshot', request.snapshotId),
        request,
      );
      return enterprise.validate(proof, request);
    },
    readAuthorization: async (request) =>
      authorization.authorize(
        await config.dependencySession(),
        'identity.company_rule.snapshot.read',
        companyObjectTarget('identity.policy_snapshot', request.policySnapshotRef.objectId),
        request,
      ),
  });
  return { authorization, enterprise, identity };
}
