/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Owning SQL returns schema-checked rows; transport values are validated before queries. */
import type { PoolClient } from 'pg';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { MvpError, fail } from '../domain/errors.js';
import { createCursorCodec, type CursorCodec } from '../domain/cursor.js';
import { instantFromDatabase } from '../domain/validation.js';
import type { ManifestEntry, Page, Receipt } from '../domain/types.js';
import { entryRecord } from '../persistence/rows.js';
import type { MvpDatabase } from '../persistence/db.js';
import type { WriteOutcome } from '../persistence/repository.js';
import { READ_CHECK_PROFILE, READ_CHECK_PROFILE_HASH, READ_CHECK_RESULT_BYTES } from './profile.js';
import type {
  ReadCheckCounts,
  ReadCheckFilter,
  ReadCheckIdentity,
  ReadCheckLease,
  ReadCheckPage,
  ReadCheckResult,
  ReadCheckScope,
  ReadCheckStatus,
  ReadCheckView,
} from './types.js';

const ACTIVE = ['QUEUED', 'RUNNING', 'UNKNOWN'];
const scopeValues = (identity: ReadCheckIdentity, scope: ReadCheckScope) => [
  identity.ownerId,
  scope.projectId,
  scope.batchId,
  scope.checkId,
];

export class ReadCheckRepository {
  readonly cursors: CursorCodec;
  constructor(
    readonly db: MvpDatabase,
    key: Buffer,
    readonly incarnation: string,
  ) {
    this.cursors = createCursorCodec(key);
  }

  async authorize(client: PoolClient, identity: ReadCheckIdentity): Promise<void> {
    const row = (
      await client.query('SELECT * FROM document_delivery.lock_read_check_binding($1)', [
        identity.ownerId,
      ])
    ).rows[0];
    if (row?.enabled !== true || Number(row.auth_epoch) !== identity.authEpoch)
      fail('INSTANCE_ACCESS_DENIED');
  }

  async row(
    client: PoolClient,
    identity: ReadCheckIdentity,
    scope: ReadCheckScope,
    write = false,
  ): Promise<Record<string, unknown>> {
    const row = (
      await client.query(
        `SELECT * FROM document_delivery.read_checks WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        scopeValues(identity, scope),
      )
    ).rows[0];
    if (row === undefined) fail('RESOURCE_NOT_FOUND');
    return row as Record<string, unknown>;
  }

  async view(client: PoolClient, row: Record<string, unknown>): Promise<ReadCheckView> {
    const counts: ReadCheckCounts = {
      available: 0,
      limited: 0,
      unsupported: 0,
      failed: 0,
      notEligible: 0,
      pending: Number(row.total_entries),
    };
    const keys = {
      AVAILABLE: 'available',
      LIMITED: 'limited',
      UNSUPPORTED: 'unsupported',
      FAILED: 'failed',
      NOT_ELIGIBLE: 'notEligible',
    } as const;
    const rows = (
      await client.query(
        'SELECT outcome,count(*) AS amount FROM document_delivery.read_check_results WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4 GROUP BY outcome',
        [row.owner_id, row.project_id, row.batch_id, row.check_id],
      )
    ).rows;
    for (const value of rows) {
      const key = keys[value.outcome as keyof typeof keys];
      counts[key] = Number(value.amount);
      counts.pending -= Number(value.amount);
    }
    return {
      checkId: String(row.check_id),
      projectId: String(row.project_id),
      batchId: String(row.batch_id),
      manifestId: String(row.manifest_id),
      manifestHash: (row.manifest_hash as Buffer).toString('hex'),
      profileId: String(row.profile_id),
      profileHash: (row.profile_hash as Buffer).toString('hex'),
      status: row.status as ReadCheckStatus,
      resultVersion: Number(row.result_version),
      totalEntries: Number(row.total_entries),
      counts,
      createdAt: instantFromDatabase(row.created_at),
      ...(row.started_at === null ? {} : { startedAt: instantFromDatabase(row.started_at) }),
      ...(row.ended_at === null ? {} : { endedAt: instantFromDatabase(row.ended_at) }),
      reasonCodes: row.reason_codes as string[],
    };
  }

  async create(
    identity: ReadCheckIdentity,
    projectId: string,
    batchId: string,
    manifestId: string,
    requestId: string,
  ): Promise<WriteOutcome<{ check: ReadCheckView }>> {
    return this.db.transaction(identity.ownerId, projectId, async (client) => {
      await this.authorize(client, identity);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${identity.ownerId}:${requestId}`,
      ]);
      const operation = 'mvp.create_batch_read_check';
      const payload = { manifestId };
      const payloadHash = sha256CanonicalJson({
        protocol: 'mvp@1',
        operation,
        projectId,
        targetId: batchId,
        payload,
      });
      const previous = (
        await client.query(
          'SELECT * FROM document_delivery.requests WHERE owner_id=$1 AND request_id=$2',
          [identity.ownerId, requestId],
        )
      ).rows[0];
      if (previous !== undefined) {
        if (
          previous.operation !== operation ||
          previous.project_id !== projectId ||
          previous.target_id !== batchId ||
          (previous.payload_hash as Buffer).toString('hex') !== payloadHash
        )
          fail('IDEMPOTENCY_CONFLICT');
        const receipt = previous.receipt as Receipt;
        return { data: receipt.result as { check: ReadCheckView }, receipt, replayed: true };
      }
      const project = (
        await client.query(
          'SELECT project_id FROM document_delivery.projects WHERE owner_id=$1 AND project_id=$2 FOR UPDATE',
          [identity.ownerId, projectId],
        )
      ).rows[0];
      if (project === undefined) fail('RESOURCE_NOT_FOUND');
      const manifest = (
        await client.query(
          'SELECT * FROM document_delivery.input_manifests WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND manifest_id=$4',
          [identity.ownerId, projectId, batchId, manifestId],
        )
      ).rows[0];
      if (manifest === undefined) fail('READ_CHECK_NOT_READY');
      const active = (
        await client.query(
          "SELECT check_id,batch_id FROM document_delivery.read_checks WHERE owner_id=$1 AND project_id=$2 AND status IN ('QUEUED','RUNNING','UNKNOWN')",
          [identity.ownerId, projectId],
        )
      ).rows[0];
      if (active !== undefined)
        throw new MvpError('READ_CHECK_ACTIVE', {
          checkId: String(active.check_id),
          batchId: String(active.batch_id),
        });
      const checkId = newUuidV7(),
        at = new Date().toISOString();
      const check: ReadCheckView = {
        checkId,
        projectId,
        batchId,
        manifestId,
        manifestHash: (manifest.manifest_hash as Buffer).toString('hex'),
        profileId: READ_CHECK_PROFILE,
        profileHash: READ_CHECK_PROFILE_HASH,
        status: 'QUEUED',
        resultVersion: 1,
        totalEntries: Number(manifest.total_entries),
        counts: {
          available: 0,
          limited: 0,
          unsupported: 0,
          failed: 0,
          notEligible: 0,
          pending: Number(manifest.total_entries),
        },
        createdAt: at,
        reasonCodes: [],
      };
      const data = { check };
      const receipt: Receipt = {
        requestId,
        projectId,
        operation,
        targetId: batchId,
        payloadHash,
        committedAt: at,
        result: data,
      };
      await client.query(
        `INSERT INTO document_delivery.requests(owner_id,project_id,request_id,operation,target_id,original_payload,payload_hash,authorization_fact,receipt,committed_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10)`,
        [
          identity.ownerId,
          projectId,
          requestId,
          operation,
          batchId,
          JSON.stringify(payload),
          Buffer.from(payloadHash, 'hex'),
          JSON.stringify({
            ownerId: identity.ownerId,
            authEpoch: identity.authEpoch,
            authorizedAt: at,
          }),
          JSON.stringify(receipt),
          at,
        ],
      );
      await client.query(
        `INSERT INTO document_delivery.read_checks(owner_id,project_id,batch_id,check_id,manifest_id,manifest_hash,profile_id,profile_hash,request_id,authorized_auth_epoch,status,result_version,total_entries,generation,fencing_token,process_incarnation,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',1,$11,1,$12,'',$13)`,
        [
          identity.ownerId,
          projectId,
          batchId,
          checkId,
          manifestId,
          manifest.manifest_hash,
          READ_CHECK_PROFILE,
          Buffer.from(READ_CHECK_PROFILE_HASH, 'hex'),
          requestId,
          identity.authEpoch,
          manifest.total_entries,
          newUuidV7(),
          at,
        ],
      );
      return { data, receipt, replayed: false };
    });
  }

  get(
    identity: ReadCheckIdentity,
    scope: ReadCheckScope,
    signal?: AbortSignal,
  ): Promise<ReadCheckView> {
    return this.db.transaction(
      identity.ownerId,
      scope.projectId,
      async (client) => {
        await this.authorize(client, identity);
        return this.view(client, await this.row(client, identity, scope));
      },
      signal,
    );
  }

  list(
    identity: ReadCheckIdentity,
    projectId: string,
    batchId: string,
    limit: number,
    cursor?: string,
  ): Promise<Page<ReadCheckView>> {
    return this.db.transaction(identity.ownerId, projectId, async (client) => {
      await this.authorize(client, identity);
      if (
        (
          await client.query(
            'SELECT 1 FROM document_delivery.input_batches WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3',
            [identity.ownerId, projectId, batchId],
          )
        ).rowCount !== 1
      )
        fail('RESOURCE_NOT_FOUND');
      const scope = {
        endpoint: 'read-checks',
        ownerId: identity.ownerId,
        authEpoch: identity.authEpoch,
        projectId,
        batchId,
      };
      const position = cursor === undefined ? undefined : this.cursors.decode(cursor, scope);
      const upper =
        position?.upper ??
        Number(
          (
            await client.query(
              'SELECT coalesce(max(creation_seq),0) AS upper FROM document_delivery.read_checks WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3',
              [identity.ownerId, projectId, batchId],
            )
          ).rows[0].upper,
        );
      const rows = (
        await client.query(
          'SELECT * FROM document_delivery.read_checks WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND creation_seq<=$4 AND creation_seq<$5 ORDER BY creation_seq DESC LIMIT $6 FOR SHARE',
          [identity.ownerId, projectId, batchId, upper, position?.last ?? upper + 1, limit + 1],
        )
      ).rows;
      const visible = rows.slice(0, limit),
        last = visible.at(-1);
      return {
        items: await Promise.all(visible.map((row) => this.view(client, row))),
        ...(rows.length > limit && last !== undefined
          ? {
              nextCursor: this.cursors.encode({ ...scope, upper, last: Number(last.creation_seq) }),
            }
          : {}),
      };
    });
  }

  entries(
    identity: ReadCheckIdentity,
    scope: ReadCheckScope,
    filter: ReadCheckFilter,
    limit: number,
    cursor?: string,
    resultVersion?: number,
  ): Promise<ReadCheckPage> {
    return this.db.transaction(identity.ownerId, scope.projectId, async (client) => {
      await this.authorize(client, identity);
      const row = await this.row(client, identity, scope),
        check = await this.view(client, row);
      if (cursor !== undefined && resultVersion === undefined) fail('INVALID_REQUEST');
      const version = resultVersion ?? check.resultVersion;
      const cursorScope = {
        endpoint: `read-check-entries:${scope.checkId}:${filter}:${limit}:${version}`,
        ownerId: identity.ownerId,
        authEpoch: identity.authEpoch,
        projectId: scope.projectId,
        batchId: scope.batchId,
        manifestId: check.manifestId,
      };
      const position = cursor === undefined ? undefined : this.cursors.decode(cursor, cursorScope);
      if (version !== check.resultVersion) fail('READ_CHECK_RESULTS_CHANGED');
      const join = `FROM document_delivery.source_entries e LEFT JOIN document_delivery.read_check_results r ON r.owner_id=e.owner_id AND r.project_id=e.project_id AND r.batch_id=e.batch_id AND r.entry_id=e.entry_id AND r.check_id=$4
        WHERE e.owner_id=$1 AND e.project_id=$2 AND e.batch_id=$3`;
      const predicate =
        filter === 'ALL'
          ? 'true'
          : filter === 'PENDING'
            ? 'r.entry_id IS NULL'
            : filter === 'PROBLEMS'
              ? "(r.entry_id IS NULL OR r.outcome IN ('LIMITED','UNSUPPORTED','FAILED') OR (r.outcome='NOT_ELIGIBLE' AND NOT e.reason_codes ? 'SYSTEM_METADATA_NOT_DOCUMENT'))"
              : 'r.outcome=$5';
      const values = [...scopeValues(identity, scope), filter];
      // Parameter 5 is always consumed, including the fixed ALL/PENDING branches.
      const where = `${join} AND ($5::text IS NOT NULL) AND (${predicate})`;
      const total = Number(
        (await client.query(`SELECT count(*) AS total ${where}`, values)).rows[0].total,
      );
      const rows = (
        await client.query(
          `SELECT e.*,r.payload AS read_result ${where} AND e.ordinal >= $6 ORDER BY e.ordinal ASC LIMIT $7`,
          [...values, position?.last ?? 0, limit + 1],
        )
      ).rows;
      const entries = rows.slice(0, limit).map((row) => ({
        entry: entryRecord(row),
        ...(row.read_result === null ? {} : { result: row.read_result as ReadCheckResult }),
      }));
      const last = entries.at(-1);
      return {
        check,
        filter,
        total,
        entries,
        ...(rows.length > limit && last !== undefined
          ? {
              nextCursor: this.cursors.encode({
                ...cursorScope,
                upper: Number.MAX_SAFE_INTEGER,
                last: last.entry.ordinal + 1,
              }),
            }
          : {}),
      };
    });
  }

  claim(
    identity: ReadCheckIdentity,
    scope: ReadCheckScope,
    signal?: AbortSignal,
  ): Promise<ReadCheckLease | undefined> {
    return this.db.transaction(
      identity.ownerId,
      scope.projectId,
      async (client) => {
        await this.authorize(client, identity);
        const row = await this.row(client, identity, scope, true);
        if (row.status !== 'QUEUED') return undefined;
        if (Number(row.authorized_auth_epoch) !== identity.authEpoch)
          fail('INSTANCE_ACCESS_DENIED');
        const startedAt = new Date().toISOString();
        await client.query(
          "UPDATE document_delivery.read_checks SET status='RUNNING',result_version=result_version+1,process_incarnation=$5,started_at=$6 WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4",
          [...scopeValues(identity, scope), this.incarnation, startedAt],
        );
        return {
          ...scope,
          ...identity,
          generation: Number(row.generation),
          fencingToken: String(row.fencing_token),
          manifestId: String(row.manifest_id),
          profileHash: (row.profile_hash as Buffer).toString('hex'),
          startedAt,
        };
      },
      signal,
    );
  }

  async assertLease(client: PoolClient, lease: ReadCheckLease): Promise<Record<string, unknown>> {
    await this.authorize(client, lease);
    const row = await this.row(client, lease, lease, true);
    if (
      row.status !== 'RUNNING' ||
      Number(row.generation) !== lease.generation ||
      row.fencing_token !== lease.fencingToken ||
      Number(row.authorized_auth_epoch) !== lease.authEpoch
    )
      fail('RECOVERY_NOT_ALLOWED');
    return row;
  }

  next(lease: ReadCheckLease, signal?: AbortSignal): Promise<ManifestEntry | undefined> {
    return this.db.transaction(
      lease.ownerId,
      lease.projectId,
      async (client) => {
        await this.assertLease(client, lease);
        const row = (
          await client.query(
            `SELECT e.* FROM document_delivery.source_entries e WHERE e.owner_id=$1 AND e.project_id=$2 AND e.batch_id=$3 AND NOT EXISTS
        (SELECT 1 FROM document_delivery.read_check_results r WHERE r.owner_id=e.owner_id AND r.project_id=e.project_id AND r.batch_id=e.batch_id AND r.entry_id=e.entry_id AND r.check_id=$4)
        ORDER BY e.ordinal LIMIT 1`,
            scopeValues(lease, lease),
          )
        ).rows[0];
        return row === undefined ? undefined : entryRecord(row);
      },
      signal,
    );
  }

  commit(lease: ReadCheckLease, result: ReadCheckResult, signal?: AbortSignal): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(result)) > READ_CHECK_RESULT_BYTES)
      fail('INPUT_LIMIT_EXCEEDED');
    return this.db.transaction(
      lease.ownerId,
      lease.projectId,
      async (client) => {
        const row = await this.assertLease(client, lease);
        const previous = (
          await client.query(
            'SELECT payload,generation,fencing_token FROM document_delivery.read_check_results WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4 AND entry_id=$5',
            [...scopeValues(lease, lease), result.entryId],
          )
        ).rows[0];
        if (previous !== undefined) {
          if (
            Number(previous.generation) !== lease.generation ||
            previous.fencing_token !== lease.fencingToken ||
            sha256CanonicalJson(previous.payload as CanonicalJsonValue) !==
              sha256CanonicalJson(result as unknown as CanonicalJsonValue)
          )
            fail('OUTCOME_UNKNOWN');
          return;
        }
        await client.query(
          `INSERT INTO document_delivery.read_check_results(owner_id,project_id,batch_id,check_id,entry_id,ordinal,generation,fencing_token,outcome,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            ...scopeValues(lease, lease),
            result.entryId,
            result.ordinal,
            lease.generation,
            lease.fencingToken,
            result.status,
            JSON.stringify(result),
          ],
        );
        const count = Number(
          (
            await client.query(
              'SELECT count(*) AS amount FROM document_delivery.read_check_results WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4',
              scopeValues(lease, lease),
            )
          ).rows[0].amount,
        );
        const done = count === Number(row.total_entries);
        await client.query(
          `UPDATE document_delivery.read_checks SET result_version=result_version+1,status=$5,ended_at=$6 WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4`,
          [
            ...scopeValues(lease, lease),
            done ? 'COMPLETED' : 'RUNNING',
            done ? new Date().toISOString() : null,
          ],
        );
      },
      signal,
    );
  }

  /** Inspect a possibly committed write without accepting a second result. */
  confirmed(
    lease: ReadCheckLease,
    result: ReadCheckResult,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.db.transaction(
      lease.ownerId,
      lease.projectId,
      async (client) => {
        const row = await this.row(client, lease, lease);
        if (Number(row.generation) !== lease.generation || row.fencing_token !== lease.fencingToken)
          return false;
        const saved = (
          await client.query(
            'SELECT payload,generation,fencing_token FROM document_delivery.read_check_results WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4 AND entry_id=$5',
            [...scopeValues(lease, lease), result.entryId],
          )
        ).rows[0];
        return (
          saved !== undefined &&
          Number(saved.generation) === lease.generation &&
          saved.fencing_token === lease.fencingToken &&
          sha256CanonicalJson(saved.payload as CanonicalJsonValue) ===
            sha256CanonicalJson(result as unknown as CanonicalJsonValue)
        );
      },
      signal,
    );
  }

  finish(
    identity: ReadCheckIdentity,
    scope: ReadCheckScope,
    status: 'FAILED' | 'INTERRUPTED' | 'UNKNOWN' | 'COMPLETED',
    reason: string,
    lease?: ReadCheckLease,
    signal: AbortSignal = AbortSignal.timeout(20_000),
  ): Promise<void> {
    return this.db.transaction(
      identity.ownerId,
      scope.projectId,
      async (client) => {
        const row = await this.row(client, identity, scope, true);
        if (!ACTIVE.includes(String(row.status))) return;
        if (
          lease !== undefined &&
          (Number(row.generation) !== lease.generation || row.fencing_token !== lease.fencingToken)
        )
          return;
        if (row.status === 'QUEUED' && status !== 'FAILED') return;
        if (status === 'COMPLETED' && lease !== undefined) await this.authorize(client, lease);
        await client.query(
          `UPDATE document_delivery.read_checks SET status=$5,reason_codes=$6::jsonb,result_version=result_version+1,ended_at=$7 WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4`,
          [
            ...scopeValues(identity, scope),
            status,
            JSON.stringify(reason.length ? [reason] : []),
            status === 'UNKNOWN' ? null : new Date().toISOString(),
          ],
        );
      },
      signal,
    );
  }

  /** The caller must hold both stable execution and inherited reader locks. */
  reconcile(identity: ReadCheckIdentity, scope: ReadCheckScope): Promise<void> {
    return this.db.transaction(identity.ownerId, scope.projectId, async (client) => {
      const row = await this.row(client, identity, scope, true);
      if (!['RUNNING', 'UNKNOWN'].includes(String(row.status))) return;
      const view = await this.view(client, row),
        status = view.counts.pending === 0 ? 'COMPLETED' : 'INTERRUPTED';
      await client.query(
        `UPDATE document_delivery.read_checks SET status=$5,reason_codes=$6::jsonb,result_version=result_version+1,generation=generation+1,fencing_token=$7,ended_at=$8 WHERE owner_id=$1 AND project_id=$2 AND batch_id=$3 AND check_id=$4`,
        [
          ...scopeValues(identity, scope),
          status,
          JSON.stringify(status === 'COMPLETED' ? [] : ['CHECK_INTERRUPTED']),
          newUuidV7(),
          new Date().toISOString(),
        ],
      );
    });
  }
}
