import type pg from 'pg';
import { sql, type Kysely } from 'kysely';
import { expect } from 'vitest';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';

type Json = Record<string, unknown>;
const record = (value: unknown) => value as Json;
const bytea = (hex: unknown) => `\\x${String(hex)}`;
const hash = (value: unknown) => sha256CanonicalJson(value as CanonicalJsonObject);
const rolledBack = new Error('accepted INSERT rolled back');

/** Database-boundary evidence only. Clone a real owning judgment into a fresh
 * identity, recompute both hashes, insert a matching PENDING Receipt as the app
 * role, then roll back every probe. No trigger, CHECK or RLS is disabled. */
export async function verifyWorkOrderValidationGuards(
  admin: pg.Client,
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  judgmentId: string,
) {
  const source = (
    await admin.query<{ row: Json }>(
      'SELECT to_jsonb(j) AS row FROM task_execution.execution_judgment j WHERE judgment_id=$1',
      [judgmentId],
    )
  ).rows[0]?.row;
  if (source === undefined) throw new Error('missing owning judgment');
  const originalReceipt = (
    await admin.query<{ row: Json }>(
      'SELECT to_jsonb(r) AS row FROM task_execution.command_receipt r WHERE command_id=$1',
      [source.source_command_id],
    )
  ).rows[0]?.row;
  if (originalReceipt === undefined) throw new Error('missing owning Receipt');

  interface Probe {
    name: string;
    payload?: (p: Json) => void;
    row?: (r: Json) => void;
    receipt?: (r: Json) => void;
    valid?: boolean;
    helperValid?: boolean;
    code?: string;
  }
  async function probe(input: Probe) {
    const id = newUuidV7(),
      commandId = newUuidV7();
    const p = structuredClone(record(source?.canonical_payload));
    p.judgmentId = id;
    input.payload?.(p);
    p.inputHash = hash({
      subjectRefs: p.subjectRefs,
      candidateContractHash: p.candidateContractHash,
      dependencyObservations: p.dependencyObservations,
      sourceWatermarks: p.sourceWatermarks,
    });
    const row: Json = {
      ...source,
      judgment_id: id,
      canonical_payload: p,
      payload_hash: bytea(hash(p)),
      input_hash: bytea(p.inputHash),
      source_command_id: commandId,
      // Keep these mirrors coherent even when a nested observation is corrupt.
      policy_version_ref: p.policyVersionRef,
      evaluator_ref: p.evaluatorRef,
    };
    input.row?.(row);
    const receipt: Json = {
      ...originalReceipt,
      command_id: commandId,
      target_id: id,
      idempotency_key: commandId,
      outcome: 'PENDING',
      result_payload: null,
      result_payload_hash: null,
      completed_at: null,
    };
    input.receipt?.(receipt);
    const helper = await admin.query<{ valid: boolean }>(
      'SELECT task_execution.work_order_validation_payload_valid($1::jsonb) AS valid',
      [JSON.stringify(p)],
    );
    expect(helper.rows[0]?.valid, `${input.name}: helper`).toBe(
      input.helperValid ?? input.valid ?? false,
    );
    let stage = 'context';
    let result: unknown;
    try {
      await withTaskExecutionTransaction(db, context, async (trx) => {
        const role = await sql<{ role: string }>`SELECT current_user AS role`.execute(trx);
        expect(role.rows[0]?.role).toBe('task_execution_app');
        stage = 'receipt';
        await sql`INSERT INTO task_execution.command_receipt
          SELECT * FROM jsonb_populate_record(NULL::task_execution.command_receipt, ${JSON.stringify(receipt)}::jsonb)`.execute(
          trx,
        );
        stage = 'judgment';
        const inserted = await sql`INSERT INTO task_execution.execution_judgment
          SELECT * FROM jsonb_populate_record(NULL::task_execution.execution_judgment, ${JSON.stringify(row)}::jsonb)
          RETURNING judgment_id`.execute(trx);
        expect(inserted.rows).toHaveLength(1);
        throw rolledBack;
      });
    } catch (error) {
      result = error;
    }
    expect(stage, `${input.name}: rejection must reach the judgment INSERT`).toBe('judgment');
    if (input.valid) expect(result, input.name).toBe(rolledBack);
    else expect(result, input.name).toMatchObject({ code: input.code ?? '23514' });
    const residue = await admin.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM task_execution.execution_judgment WHERE judgment_id=$1)
        + (SELECT count(*) FROM task_execution.command_receipt WHERE command_id=$2) AS n`,
      [id, commandId],
    );
    expect(Number(residue.rows[0]?.n), `${input.name}: rollback`).toBe(0);
  }

  const syncSubjects = (p: Json) => {
    p.subjectRefs = [p.draftSnapshotRef, p.workOrderRef, p.contextSnapshotRef];
  };
  const observations = (p: Json) => p.dependencyObservations as Json[];
  const refs: [string, (p: Json) => Json][] = [
    ...[
      'workOrderRef',
      'draftSnapshotRef',
      'contextSnapshotRef',
      'actorSnapshotRef',
      'authorizationDecisionRef',
    ].map((key): [string, (p: Json) => Json] => [key, (p) => record(p[key])]),
    ...observations(record(source.canonical_payload)).flatMap(
      (item, i): [string, (p: Json) => Json][] => [
        [`${String(item.role)}.reference`, (p) => record(observations(p)[i]?.reference)],
        ...(item.kind === 'POLICY'
          ? [
              [
                `${String(item.role)}.policyVersionRef`,
                (p: Json) => record(observations(p)[i]?.policyVersionRef),
              ] as [string, (p: Json) => Json],
            ]
          : []),
      ],
    ),
  ];
  await probe({ name: 'complete owning reference structure', valid: true });
  for (const [name, select] of refs) {
    const original = select(record(source.canonical_payload));
    for (const key of Object.keys(original)) {
      for (const mutation of ['missing', 'null'] as const) {
        await probe({
          name: `${name}.${key} ${mutation}`,
          payload: (p) => {
            const ref = select(p);
            if (mutation === 'missing') Reflect.deleteProperty(ref, key);
            else ref[key] = null;
            syncSubjects(p);
          },
          // Promoted subject UUID/hash members are also checked by the mirror trigger.
          code: [
            'workOrderRef.objectId',
            'draftSnapshotRef.objectId',
            'draftSnapshotRef.contentHash',
            'contextSnapshotRef.snapshotId',
            'contextSnapshotRef.contentHash',
          ].includes(`${name}.${key}`)
            ? '22023'
            : '23514',
        });
      }
    }
    for (const [label, change] of [
      [
        'extra',
        (r: Json) => {
          r.extra = true;
        },
      ],
      [
        'wrong kind',
        (r: Json) => {
          r.kind = 'OBJECT_ALIAS';
        },
      ],
      [
        'wrong namespace',
        (r: Json) => {
          r.objectType = 'zhiju.invalid.reference';
        },
      ],
      [
        'non-UUID identity',
        (r: Json) => {
          r.objectId = 'invalid';
        },
      ],
      [
        'numeric identity',
        (r: Json) => {
          r.objectId = 123;
        },
      ],
      [
        'scope extra',
        (r: Json) => {
          record(r.scope).extra = true;
        },
      ],
      [
        'foreign scope',
        (r: Json) => {
          record(r.scope).projectId = newUuidV7();
        },
      ],
    ] as const) {
      await probe({
        name: `${name}: ${label}`,
        payload: (p) => {
          change(select(p));
          syncSubjects(p);
        },
        code:
          (label === 'non-UUID identity' || label === 'numeric identity') &&
          ['workOrderRef', 'draftSnapshotRef'].includes(name)
            ? '22023'
            : '23514',
      });
    }
  }
  const hashes: [string, (p: Json) => Json][] = [
    ...refs
      .filter(([, select]) => 'contentHash' in select(record(source.canonical_payload)))
      .map(([name, select]): [string, (p: Json) => Json] => [
        `${name}.contentHash`,
        (p) => record(select(p).contentHash),
      ]),
    ...observations(record(source.canonical_payload)).map(
      (item, i): [string, (p: Json) => Json] => {
        const key = item.kind === 'POLICY' ? 'contentHash' : 'descriptorHash';
        return [`${String(item.role)}.${key}`, (p) => record(observations(p)[i]?.[key])];
      },
    ),
  ];
  for (const [name, select] of hashes) {
    for (const [label, change] of [
      [
        'extra',
        (h: Json) => {
          h.extra = true;
        },
      ],
      [
        'algorithm missing',
        (h: Json) => {
          delete h.algorithm;
        },
      ],
      [
        'algorithm invalid',
        (h: Json) => {
          h.algorithm = 'SHA-512';
        },
      ],
      [
        'version missing',
        (h: Json) => {
          delete h.canonicalizationVersion;
        },
      ],
      [
        'version numeric',
        (h: Json) => {
          h.canonicalizationVersion = 1;
        },
      ],
      [
        'digest missing',
        (h: Json) => {
          delete h.digest;
        },
      ],
      [
        'digest null',
        (h: Json) => {
          h.digest = null;
        },
      ],
      [
        'digest malformed',
        (h: Json) => {
          h.digest = 'ab';
        },
      ],
    ] as const)
      await probe({
        name: `${name}: ${label}`,
        payload: (p) => {
          change(select(p));
          syncSubjects(p);
        },
        code:
          label.startsWith('digest') &&
          ['draftSnapshotRef.contentHash', 'contextSnapshotRef.contentHash'].includes(name)
            ? '22023'
            : '23514',
      });
  }
  for (const [name, value] of [
    ['empty', []],
    [
      'missing Context',
      [
        record(source.canonical_payload).draftSnapshotRef,
        record(source.canonical_payload).workOrderRef,
      ],
    ],
    ['reversed', [...(record(source.canonical_payload).subjectRefs as unknown[])].reverse()],
    [
      'duplicate',
      [
        record(source.canonical_payload).draftSnapshotRef,
        record(source.canonical_payload).workOrderRef,
        record(source.canonical_payload).workOrderRef,
      ],
    ],
    [
      'different member',
      [
        record(source.canonical_payload).draftSnapshotRef,
        record(source.canonical_payload).workOrderRef,
        { ...record(record(source.canonical_payload).contextSnapshotRef), objectId: newUuidV7() },
      ],
    ],
  ] as const)
    await probe({
      name: `subjectRefs ${name}`,
      payload: (p) => {
        p.subjectRefs = value;
      },
    });

  for (const [column, value] of [
    ['work_order_id', newUuidV7()],
    ['draft_snapshot_id', newUuidV7()],
    ['context_snapshot_id', newUuidV7()],
    ['draft_snapshot_hash', bytea('a'.repeat(64))],
    ['context_snapshot_hash', bytea('a'.repeat(64))],
    ['candidate_contract_hash', bytea('a'.repeat(64))],
    ['specification_hash', bytea('a'.repeat(64))],
    ['policy_content_hash', bytea('a'.repeat(64))],
    ['input_hash', bytea('a'.repeat(64))],
    ['payload_hash', bytea('a'.repeat(64))],
    ['validation_executable', false],
  ] as const)
    await probe({
      name: `promoted ${column}`,
      row: (r) => {
        r[column] = value;
      },
      helperValid: true,
      code: '22023',
    });
  await probe({
    name: 'mixed Task columns',
    row: (r) => {
      r.task_id = newUuidV7();
    },
    helperValid: true,
  });
  await probe({
    name: 'missing source Receipt',
    row: (r) => {
      r.source_command_id = newUuidV7();
    },
    helperValid: true,
    code: '22023',
  });
  for (const [column, value] of [
    ['command_type', 'execution.build_task_readiness'],
    ['command_version', '2.0'],
    ['target_type', 'zhiju.execution.task_readiness'],
    ['target_id', newUuidV7()],
    ['project_id', null],
    ['request_payload_hash', bytea('a'.repeat(64))],
    ['outcome', 'COMMITTED'],
  ] as const)
    await probe({
      name: `source Receipt ${column}`,
      receipt: (r) => {
        r[column] = value;
      },
      helperValid: true,
      code: '22023',
    });
  // The structural helper can use private validators through its owner; app
  // callers gain no direct executable surface on those new private helpers.
  for (const statement of [
    sql`SELECT task_execution.work_order_validation_hash_valid('{}'::jsonb)`,
    sql`SELECT task_execution.work_order_validation_ref_valid('{}'::jsonb,'OBJECT','x','{}'::jsonb)`,
  ])
    await expect(
      withTaskExecutionTransaction(db, context, (trx) => statement.execute(trx)),
    ).rejects.toMatchObject({ code: '42501' });
}
