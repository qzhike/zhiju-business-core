import { describe, expect, it, vi } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash as hash,
  type Common,
  type PreparationMembershipTemplate,
  type PreparationSession,
} from '@zhiju/contracts';
import {
  createPreparationIdentityPort,
  PREPARATION_CREATOR_BINDINGS,
  type PreparationIdentityConfig,
} from './preparation-identity.js';
const s: PreparationSession = {
  principalId: newUuidV7(),
  authenticationContextHash: hash({ session: 'controlled' }),
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const id = newUuidV7();
const policyRef: Common.SnapshotRef = {
  kind: 'SNAPSHOT',
  objectType: 'identity.policy_snapshot',
  objectId: id,
  snapshotId: id,
  scope: {},
  contentHash: hash({ policy: true }),
};
const template = (): PreparationMembershipTemplate => ({
  profile: 'ip.preparation_membership_template@1.0',
  templateCode: 'controlled.preparation',
  templateVersion: '1.0.0',
  creatorBindings: PREPARATION_CREATOR_BINDINGS.map((b, i) => ({
    operation: b[0],
    version: '1.0' as const,
    purpose: b[1],
    action: b[2],
    targetObjectType: b[3],
    capabilityCode: `controlled.slot${i}`,
  })).sort((a, b) => a.operation.localeCompare(b.operation)),
  grantPolicySnapshotRef: policyRef,
  maxGrantLifetimeSeconds: 600,
});
function setup() {
  const read = vi.fn(() => {
    throw new Error('protected read forbidden');
  });
  const verify = vi.fn(() => Promise.reject(new Error('current trusted identity rejected')));
  const config: PreparationIdentityConfig = {
    db: { connection: read } as unknown as PreparationIdentityConfig['db'],
    grantAdministrators: [s.principalId],
    administratorPolicySnapshotRef: policyRef,
    servicePrincipalIds: [],
    enterpriseCapabilities: { select: 'controlled.select', create: 'controlled.create' },
    verifySession: verify,
    verifyProjectCreation: () => Promise.reject(new Error('no owner Project')),
    authorizeService: () => Promise.reject(new Error('no SERVICE grant')),
    authorizeCurrentOperation: () => Promise.reject(new Error('no scoped grant')),
  };
  return { port: createPreparationIdentityPort(config), read, verify };
}
describe('preparation identity closed input and trusted identity boundary', () => {
  it.each([
    'extra',
    'wrong-version',
    'wrong-purpose',
    'duplicate-capability',
    'missing-slot',
    'wildcard-action',
    'unsorted',
  ])('rejects %s membership before protected storage', async (kind) => {
    const { port, read, verify } = setup();
    const payload = template();
    if (kind === 'extra') Object.assign(payload, { companyRole: 'ADMIN' });
    if (kind === 'wrong-version') Object.assign(payload, { profile: 'im02-static-v1' });
    if (kind === 'wrong-purpose')
      payload.creatorBindings[0] = {
        ...payload.creatorBindings[0],
        purpose: 'enterprise.project.start',
      } as (typeof payload.creatorBindings)[number];
    if (kind === 'duplicate-capability')
      payload.creatorBindings[1] = {
        ...payload.creatorBindings[1],
        capabilityCode: payload.creatorBindings[0]?.capabilityCode,
      } as (typeof payload.creatorBindings)[number];
    if (kind === 'missing-slot') payload.creatorBindings.pop();
    if (kind === 'wildcard-action')
      payload.creatorBindings[0] = {
        ...payload.creatorBindings[0],
        action: '*',
      } as (typeof payload.creatorBindings)[number];
    if (kind === 'unsorted') payload.creatorBindings.reverse();
    await expect(
      port.publishMembershipTemplate(s, {
        templateId: newUuidV7(),
        versionId: newUuidV7(),
        payload,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toHaveProperty('code');
    expect(read).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('checks current verifier before any protected read even for configured administrator', async () => {
    const { port, read, verify } = setup();
    await expect(
      port.publishMembershipTemplate(s, {
        templateId: newUuidV7(),
        versionId: newUuidV7(),
        payload: template(),
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('current trusted identity rejected');
    expect(verify).toHaveBeenCalledExactlyOnceWith(s);
    expect(read).not.toHaveBeenCalled();
  });
});
