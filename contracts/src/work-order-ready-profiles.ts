import { isDeepStrictEqual } from 'node:util';
import { sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import data from './generated/work-order-ready-profiles.json' with { type: 'json' };
import type { Common } from './generated/types/common.js';

export const WORK_ORDER_READY_REGISTRY_VERSION = 'im06-work-order-ready-static-v1';
export type WorkOrderReadyProfileKey =
  | 'core.work_order@1.0'
  | 'te.human_operated.synthetic@1.0'
  | 'te.work_order.human_review@1.0'
  | 'te.human_operated.synthetic.formal@1.0';

export interface WorkOrderReadyProfile {
  readonly registryKey: WorkOrderReadyProfileKey;
  readonly owner: string;
  readonly reference: Common.VersionedRef;
  readonly descriptor: CanonicalJsonObject;
}

// These identities and descriptors are immutable versioned declarations, not
// persisted business objects or evidence that a Runtime has been deployed.
const declarations: readonly [WorkOrderReadyProfileKey, string, string, CanonicalJsonObject][] = [
  [
    'core.work_order@1.0',
    'contracts',
    'zhiju.contract.work_order_schema',
    { schemaId: 'https://schemas.zhiju.local/core/work-order/1.0' },
  ],
  [
    'te.human_operated.synthetic@1.0',
    'integration-gateway',
    'zhiju.runtime.adapter_contract',
    {
      mode: 'SYNTHETIC_TECHNICAL_ONLY',
      harness: 'zhiju.runtime.synthetic',
      provider: 'synthetic',
      model: 'synthetic',
      resumePolicy: 'new_run_only',
      fallbackPolicy: 'human_intervention',
    },
  ],
  [
    'te.work_order.human_review@1.0',
    'task-execution',
    'zhiju.execution.work_order_risk_profile',
    { humanReviewRequired: true, technicalOnly: true },
  ],
];
const approved: WorkOrderReadyProfile[] = declarations.map(
  ([registryKey, owner, objectType, descriptor], index) => ({
    registryKey,
    owner,
    descriptor,
    reference: {
      kind: 'VERSIONED',
      objectType,
      objectId: `01996900-0000-7000-8000-00000000010${index + 1}`,
      versionId: `01996900-0000-7000-8000-00000000011${index + 1}`,
      scope: {},
    },
  }),
);

approved.push({
  registryKey: 'te.human_operated.synthetic.formal@1.0',
  owner: 'integration-gateway',
  descriptor: {
    ...(approved.find((p) => p.registryKey === 'te.human_operated.synthetic@1.0')?.descriptor ??
      (() => {
        throw new Error('Missing synthetic descriptor');
      })()),
  },
  reference: {
    kind: 'VERSIONED',
    objectType: 'zhiju.runtime.adapter_contract',
    objectId: '0199b600-0000-7000-8000-000000000301',
    versionId: '0199b600-0000-7000-8000-000000000311',
    scope: {},
  },
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadWorkOrderReadyProfileRegistry(input: unknown): {
  readonly registryVersion: string;
  readonly profiles: readonly WorkOrderReadyProfile[];
} {
  const expected = { registryVersion: WORK_ORDER_READY_REGISTRY_VERSION, profiles: approved };
  if (!isDeepStrictEqual(input, expected)) {
    throw new Error('WorkOrder READY registry differs from its approved immutable declarations');
  }
  return freeze(structuredClone(expected));
}

export const workOrderReadyProfileRegistry = loadWorkOrderReadyProfileRegistry(data);

export function resolveWorkOrderReadyProfile(
  reference: unknown,
  registryKey: WorkOrderReadyProfileKey,
): (WorkOrderReadyProfile & { readonly descriptorHash: Common.ContentHash }) | undefined {
  const entry = workOrderReadyProfileRegistry.profiles.find(
    (profile) =>
      profile.registryKey === registryKey && isDeepStrictEqual(profile.reference, reference),
  );
  if (entry === undefined) return undefined;
  return {
    ...entry,
    descriptorHash: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: sha256CanonicalJson(entry.descriptor),
    },
  };
}
