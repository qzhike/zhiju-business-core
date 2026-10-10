import { describe, expect, it } from 'vitest';

import type { IdentityCommandDeps } from './actor-snapshot.js';
import {
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED,
  PROJECT_BOARD_SLICE_READ_BINDINGS,
  PROJECT_BOARD_SLICE_READ_PURPOSE,
  WORKSPACE_PROJECT_DISCOVERY_BINDINGS,
  WORKSPACE_PROJECT_DISCOVERY_PURPOSES,
  WORKSPACE_PROJECT_DISCOVERY_PURPOSE,
  WORKSPACE_PROJECT_DISCOVERY_SCAN_BUDGET,
  computeWorkspaceProjectDiscoveryPage,
  createWorkspaceProjectDiscoveryPort,
  discoverWorkspaceProjectScopes,
  type WorkspaceProjectDiscoveryAuthorizationInput,
  type WorkspaceProjectDiscoveryCapabilityKey,
  type WorkspaceProjectDiscoveryGrantRow,
  type WorkspaceProjectDiscoveryPortConfig,
  type WorkspaceProjectDiscoveryRevalidationInput,
  type WorkspaceProjectDiscoveryScanConfig,
  type WorkspaceProjectDiscoveryScanInput,
} from './workspace-project-discovery.js';

const CAPABILITY_CODE = 'project.workspace.discover.v1';
const GRANT_ACTION = 'project.workspace.discover.v1';
const BOARD_ACTION = 'project.get_project_board_slice.v1';
const PRINCIPAL_ID = '01920000-0000-7000-8000-000000000001';

const capabilityCodes: WorkspaceProjectDiscoveryPortConfig['capabilityCodes'] = {
  workspaceProjectDiscoveryHumanV1: CAPABILITY_CODE,
  projectBoardSliceReadHumanV1: BOARD_ACTION,
};

function port(config: unknown = { capabilityCodes }) {
  return createWorkspaceProjectDiscoveryPort(config as WorkspaceProjectDiscoveryPortConfig);
}

const pureDeps = {} as unknown as IdentityCommandDeps;

function authorizeInput(commandType: string, commandVersion = '1.0') {
  return { commandType, commandVersion } as unknown as WorkspaceProjectDiscoveryAuthorizationInput;
}

function revalidationInput(commandType: string, commandVersion = '1.0') {
  return {
    expectedCommandType: commandType,
    expectedCommandVersion: commandVersion,
  } as unknown as WorkspaceProjectDiscoveryRevalidationInput;
}

describe('workspace project discovery bindings', () => {
  it('publishes exactly the discovery row of spec §258', () => {
    const row = WORKSPACE_PROJECT_DISCOVERY_BINDINGS.workspaceProjectDiscoveryHumanV1;
    expect(row).toMatchObject({
      commandType: 'project.workspace.discover',
      commandVersion: '1.0',
      authorizationPurpose: WORKSPACE_PROJECT_DISCOVERY_PURPOSE,
      requiredGrantAction: 'project.workspace.discover.v1',
      targetKind: 'OBJECT',
      selectorType: 'TARGET_TYPE',
      expectedPrincipalKind: 'HUMAN',
      forbidActingFor: true,
      capabilityConfigKey: 'workspaceProjectDiscoveryHumanV1',
    });
    expect([...row.targetObjectTypes]).toEqual(['project.project', 'zhiju.project.project']);
  });

  it('keeps the board slice row in its own removable map with the registered purpose', () => {
    const row = PROJECT_BOARD_SLICE_READ_BINDINGS.projectBoardSliceReadHumanV1;
    expect(row).toMatchObject({
      commandType: 'project.get_project_board_slice',
      commandVersion: '1.0',
      authorizationPurpose: 'enterprise.project.get_project_board_slice',
      requiredGrantAction: 'project.get_project_board_slice.v1',
      targetKind: 'OBJECT',
      selectorType: 'TARGET_TYPE',
      expectedPrincipalKind: 'HUMAN',
      forbidActingFor: true,
      capabilityConfigKey: 'projectBoardSliceReadHumanV1',
    });
    expect(PROJECT_BOARD_SLICE_READ_PURPOSE).toBe('enterprise.project.get_project_board_slice');
    expect([...row.targetObjectTypes]).toEqual(['project.project', 'zhiju.project.project']);
  });

  it('freezes the maps, rows and target sets', () => {
    expect(Object.isFrozen(WORKSPACE_PROJECT_DISCOVERY_BINDINGS)).toBe(true);
    expect(Object.isFrozen(PROJECT_BOARD_SLICE_READ_BINDINGS)).toBe(true);
    expect(
      Object.isFrozen(WORKSPACE_PROJECT_DISCOVERY_BINDINGS.workspaceProjectDiscoveryHumanV1),
    ).toBe(true);
    expect(
      Object.isFrozen(
        WORKSPACE_PROJECT_DISCOVERY_BINDINGS.workspaceProjectDiscoveryHumanV1.targetObjectTypes,
      ),
    ).toBe(true);
  });

  it('agrees with the published Purpose map for every config key', () => {
    for (const key of Object.keys(capabilityCodes) as WorkspaceProjectDiscoveryCapabilityKey[]) {
      const row = {
        ...WORKSPACE_PROJECT_DISCOVERY_BINDINGS,
        ...PROJECT_BOARD_SLICE_READ_BINDINGS,
      }[key];
      expect(WORKSPACE_PROJECT_DISCOVERY_PURPOSES[key]).toBe(row.authorizationPurpose);
    }
  });
});

describe('workspace project discovery: exact key resolution', () => {
  it('refuses an unknown key for authorize and revalidate', async () => {
    for (const key of ['workspaceProjectDiscovery', 'workspaceProjectDiscoveryHumanV2', '', '*']) {
      await expect(
        port().authorize(
          pureDeps,
          key as WorkspaceProjectDiscoveryCapabilityKey,
          authorizeInput('project.workspace.discover'),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
      await expect(
        port().revalidate(
          pureDeps,
          key as WorkspaceProjectDiscoveryCapabilityKey,
          revalidationInput('project.workspace.discover'),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
    }
  });

  it('refuses a drifted operation or version for every approved key', async () => {
    for (const [key, commandType] of [
      ['workspaceProjectDiscoveryHumanV1', 'project.workspace.discover'],
      ['projectBoardSliceReadHumanV1', 'project.get_project_board_slice'],
    ] as const) {
      await expect(
        port().authorize(pureDeps, key, authorizeInput(`${commandType}.alias`)),
      ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
      for (const version of ['2.0', '1.0.0', 'v1', '']) {
        await expect(
          port().authorize(pureDeps, key, authorizeInput(commandType, version)),
        ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
      }
      await expect(
        port().revalidate(pureDeps, key, revalidationInput(commandType, '2.0')),
      ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
    }
  });

  it('never substitutes one approved key for another', async () => {
    await expect(
      port().authorize(
        pureDeps,
        'workspaceProjectDiscoveryHumanV1',
        authorizeInput('project.get_project_board_slice'),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
    await expect(
      port().authorize(
        pureDeps,
        'projectBoardSliceReadHumanV1',
        authorizeInput('project.workspace.discover'),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
  });

  it('refuses a missing capability configuration fail-closed', async () => {
    let failure: Error | undefined;
    try {
      await port({}).authorize(
        pureDeps,
        'workspaceProjectDiscoveryHumanV1',
        authorizeInput('project.workspace.discover'),
      );
    } catch (caught) {
      failure = caught as Error;
    }
    expect(failure?.message).toMatch(/trusted capability configuration/u);
  });

  it('binds the candidate convenience wrappers to the discovery entry', async () => {
    await expect(
      createWorkspaceProjectDiscoveryPort({ capabilityCodes }).authorizeCandidate(
        pureDeps,
        authorizeInput('project.get_project_board_slice'),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
    await expect(
      createWorkspaceProjectDiscoveryPort({ capabilityCodes }).revalidateCandidate(
        pureDeps,
        revalidationInput('project.get_project_board_slice'),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
  });
});

// ---------------------------------------------------------------------------
// Pure candidate scan
// ---------------------------------------------------------------------------

const scanNow = new Date('2026-06-01T00:00:00.000Z');

function grantRow(
  overrides: Partial<WorkspaceProjectDiscoveryGrantRow> = {},
): WorkspaceProjectDiscoveryGrantRow {
  return {
    id: '01920000-0000-7000-8000-0000000000f1',
    principal_id: PRINCIPAL_ID,
    capability_code: CAPABILITY_CODE,
    scope_kind: 'PROJECT',
    enterprise_id: 'e1',
    project_id: 'p1',
    resource_selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'project.project' }],
    actions: [GRANT_ACTION],
    valid_from: new Date('2026-01-01T00:00:00.000Z'),
    valid_to: null,
    status: 'ACTIVE',
    aggregate_version: '1',
    grant_policy_snapshot_id: '01920000-0000-7000-8000-0000000000f2',
    grant_policy_snapshot_hash: Buffer.alloc(32, 7),
    ...overrides,
  };
}

function scanInput(
  overrides: Partial<WorkspaceProjectDiscoveryScanInput> = {},
): WorkspaceProjectDiscoveryScanInput {
  return {
    authenticationContextHash: Buffer.alloc(32, 3),
    sessionBindingHash: Buffer.alloc(32, 4),
    principalId: PRINCIPAL_ID,
    principalKind: 'HUMAN',
    pageSize: 50,
    ...overrides,
  };
}

function page(
  grants: readonly WorkspaceProjectDiscoveryGrantRow[],
  input: WorkspaceProjectDiscoveryScanInput = scanInput(),
  now: Date = scanNow,
) {
  return computeWorkspaceProjectDiscoveryPage(grants, input, {
    capabilityCode: CAPABILITY_CODE,
    requiredGrantAction: GRANT_ACTION,
    now,
  });
}

describe('workspace project discovery scan: filtering', () => {
  it('returns the exact Project candidate of one covering Grant', () => {
    const result = page([grantRow()]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.projectRef).toEqual({
      kind: 'OBJECT',
      objectType: 'project.project',
      objectId: 'p1',
      scope: { enterpriseId: 'e1', projectId: 'p1' },
    });
    expect(result.nextCursor).toBeUndefined();
    expect(result.sourceWatermarks).toHaveLength(1);
    expect(result.sourceWatermarks[0]).toMatchObject({
      sourceModule: 'identity_policy',
      partition: `workspace_project_discovery:${PRINCIPAL_ID}`,
      sequence: 1,
    });
  });

  it('honors both accepted Project spellings without converting one into the other', () => {
    const result = page([
      grantRow({
        id: 'g-legacy',
        resource_selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.project.project' }],
      }),
    ]);
    expect(result.items[0]?.projectRef.objectType).toBe('zhiju.project.project');
  });

  it('never expands an Enterprise-scope Grant into a candidate', () => {
    const result = page([grantRow({ scope_kind: 'ENTERPRISE', project_id: 'p9' })]);
    expect(result.items).toHaveLength(0);
  });

  it('refuses a wildcard, aliased, unknown or wrongly-typed selector', () => {
    const bad = [
      [{ selectorType: 'TARGET_TYPE', objectType: '*' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'project.*' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.project.other' }],
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'project.project' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'project.project', extra: true }],
      [
        { selectorType: 'TARGET_TYPE', objectType: 'project.project' },
        { selectorType: 'TARGET_TYPE', objectType: '*' },
      ],
      [],
    ];
    for (const resource_selectors of bad) {
      const result = page([grantRow({ resource_selectors })]);
      expect(result.items).toHaveLength(0);
    }
  });

  it('excludes a revoked, not-yet-valid, expired or action-less Grant', () => {
    const expired = grantRow({ id: 'g-expired', valid_to: new Date('2026-05-31T23:59:59.000Z') });
    const notYet = grantRow({ id: 'g-not-yet', valid_from: new Date('2026-06-02T00:00:00.000Z') });
    const revoked = grantRow({ id: 'g-revoked', status: 'REVOKED' });
    const wrongAction = grantRow({ id: 'g-action', actions: ['project.something.else.v1'] });
    const result = page([expired, notYet, revoked, wrongAction]);
    expect(result.items).toHaveLength(0);
  });

  it('excludes a Grant for another principal or capability code', () => {
    const result = page([
      grantRow({ id: 'g-other-principal', principal_id: 'other' }),
      grantRow({ id: 'g-other-capability', capability_code: 'other.capability.v1' }),
    ]);
    expect(result.items).toHaveLength(0);
  });

  it('orders candidates by (enterprise_id, project_id)', () => {
    const result = page([
      grantRow({ id: 'g1', enterprise_id: 'e2', project_id: 'p1' }),
      grantRow({ id: 'g2', enterprise_id: 'e1', project_id: 'p2' }),
      grantRow({ id: 'g3', enterprise_id: 'e1', project_id: 'p1' }),
    ]);
    expect(result.items.map((item) => item.projectRef.objectId)).toEqual(['p1', 'p2', 'p1']);
    expect(result.items.map((item) => item.projectRef.scope.enterpriseId)).toEqual([
      'e1',
      'e1',
      'e2',
    ]);
  });

  it('deduplicates several Grants of the same Project into one candidate', () => {
    const result = page([
      grantRow({ id: 'g1', project_id: 'p1' }),
      grantRow({ id: 'g2', project_id: 'p1' }),
    ]);
    expect(result.items).toHaveLength(1);
  });
});

describe('workspace project discovery scan: budget, cursor and fingerprint', () => {
  function manyGrants(count: number): WorkspaceProjectDiscoveryGrantRow[] {
    return Array.from({ length: count }, (_unused, index) =>
      grantRow({
        id: `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`,
        project_id: `p${String(index).padStart(3, '0')}`,
      }),
    );
  }

  it('bounds each request at 200 candidates and reaches every candidate through the bound cursor', () => {
    // The approved per-request scan budget is part of the contract.
    expect(WORKSPACE_PROJECT_DISCOVERY_SCAN_BUDGET).toBe(200);
    const grants = manyGrants(250);
    const collected: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      pages += 1;
      const result = page(grants, scanInput({ pageSize: 50, cursor }));
      pageSizes.push(result.items.length);
      collected.push(...result.items.map((item) => item.projectRef.objectId));
      if (result.nextCursor === undefined) break;
      cursor = result.nextCursor;
      if (pages > 20) throw new Error('cursor chain did not terminate');
    }
    // The scan budget bounds one request, not the enumeration: every authorized
    // candidate stays reachable by following the bound cursor.
    expect(collected).toEqual(
      Array.from({ length: 250 }, (_unused, index) => `p${String(index).padStart(3, '0')}`),
    );
    expect(pageSizes.every((size) => size <= 50)).toBe(true);
    // 250 candidates at pageSize 50 need five pages, and the fifth request
    // starts after the first 200-candidate window.
    expect(pages).toBe(5);
  });

  it('changes the authorization fingerprint when the effective Grant set changes', () => {
    const before = page([grantRow()]).authorizationFingerprint;
    const after = page([
      grantRow(),
      grantRow({ id: 'g2', project_id: 'p2' }),
    ]).authorizationFingerprint;
    expect(before).not.toBe(after);
    // Normal paging and trusted-clock observations do not move the fingerprint.
    expect(
      page([grantRow()], scanInput(), new Date('2026-06-02T00:00:00.000Z'))
        .authorizationFingerprint,
    ).toBe(before);
  });

  it('changes the fingerprint and drops the candidate when the clock crosses valid_to', () => {
    const grant = grantRow({ valid_to: new Date('2026-06-01T12:00:00.000Z') });
    const before = page([grant], scanInput(), new Date('2026-06-01T11:59:59.000Z'));
    const after = page([grant], scanInput(), new Date('2026-06-01T12:00:00.000Z'));
    expect(before.items).toHaveLength(1);
    expect(after.items).toHaveLength(0);
    expect(before.authorizationFingerprint).not.toBe(after.authorizationFingerprint);
  });

  it('invalidates a cursor when the effective Grant set changed', () => {
    const grants = [grantRow({ project_id: 'p1' }), grantRow({ id: 'g2', project_id: 'p2' })];
    const first = page(grants, scanInput({ pageSize: 1 }));
    expect(first.nextCursor).toBeDefined();
    const grown = [...grants, grantRow({ id: 'g3', project_id: 'p3' })];
    const failure = (() => {
      try {
        page(grown, scanInput({ pageSize: 1, cursor: first.nextCursor }));
        return undefined;
      } catch (error) {
        return error as { code?: string; message?: string };
      }
    })();
    expect(failure?.code).toBe(IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID);
    expect(failure?.message).toMatch(/changed discovery authorization set/u);
  });

  it('binds a cursor to its principal and capability', () => {
    const grants = [grantRow({ project_id: 'p1' }), grantRow({ id: 'g2', project_id: 'p2' })];
    const first = page(grants, scanInput({ pageSize: 1 }));
    const decoded = JSON.parse(
      Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const forged = Buffer.from(
      JSON.stringify({ ...decoded, principalId: 'another-principal' }),
      'utf8',
    ).toString('base64url');
    expect(() => page(grants, scanInput({ pageSize: 1, cursor: forged }))).toThrow(
      /another principal/u,
    );
  });

  it('rejects a structurally malformed cursor', () => {
    const grants = [grantRow(), grantRow({ id: 'g2', project_id: 'p2' })];
    const failure = (() => {
      try {
        page(grants, scanInput({ pageSize: 1, cursor: 'not-a-cursor' }));
        return undefined;
      } catch (error) {
        return error as { code?: string };
      }
    })();
    expect(failure?.code).toBe(IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID);
  });
});

describe('discoverWorkspaceProjectScopes: fail-closed input gates', () => {
  const config: WorkspaceProjectDiscoveryScanConfig = {
    capabilityCode: CAPABILITY_CODE,
    requiredGrantAction: GRANT_ACTION,
  };

  it('refuses a non-HUMAN principal', async () => {
    await expect(
      discoverWorkspaceProjectScopes(pureDeps, config, scanInput({ principalKind: 'SERVICE' })),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED });
  });

  it('refuses an out-of-range pageSize', async () => {
    for (const pageSize of [0, 51, 2.5, Number.NaN]) {
      await expect(
        discoverWorkspaceProjectScopes(pureDeps, config, scanInput({ pageSize })),
      ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID });
    }
  });

  it('refuses an invalid session binding and authentication context hash', async () => {
    await expect(
      discoverWorkspaceProjectScopes(
        pureDeps,
        config,
        scanInput({ sessionBindingHash: Buffer.alloc(16, 1) }),
      ),
    ).rejects.toThrow(/session binding hash/u);
    await expect(
      discoverWorkspaceProjectScopes(
        pureDeps,
        config,
        scanInput({ authenticationContextHash: Buffer.alloc(16, 1) }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID });
  });

  it('fails closed on an invalid trusted capability configuration', async () => {
    for (const bad of [
      { capabilityCode: 'Not A Code', requiredGrantAction: GRANT_ACTION },
      { capabilityCode: '', requiredGrantAction: GRANT_ACTION },
      { capabilityCode: CAPABILITY_CODE, requiredGrantAction: '' },
    ]) {
      await expect(
        discoverWorkspaceProjectScopes(pureDeps, bad, scanInput()),
      ).rejects.toMatchObject({
        code: IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID,
      });
    }
  });
});
