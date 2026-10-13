import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Artifact } from '@zhiju/contracts';
import { getContractRegistry } from '@zhiju/contracts';
import {
  exactMarkdownRevision,
  fileReviewLocation,
  markdownBytesHash,
  MarkdownBoundTokens,
} from '@zhiju/artifact';
import { MarkdownRenderService } from '@zhiju/integration-gateway';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { createMarkdownReviewEntry } from '../../apps/api/src/composition/markdown-review-entry.js';
import type { WorkspaceBoardSession } from '../../apps/api/src/composition/workspace-board-entries.js';
import { provisionTrustedWorkspace, type ProvisionedWorkspace } from './trusted-http-fixtures.js';
import {
  provisionMarkdownReview,
  markdownQuery,
  type MarkdownFixture,
} from './markdown-review-fixtures.js';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
describe.skipIf(!databaseUrl)('exact Markdown review and download #279 (real PostgreSQL)', () => {
  let workspace: ProvisionedWorkspace;
  let fixture: MarkdownFixture;
  let entry: ReturnType<typeof createMarkdownReviewEntry>;
  let session: WorkspaceBoardSession;
  beforeAll(async () => {
    const lookupKey = Buffer.alloc(32, 0x11);
    const fieldKey = Buffer.alloc(32, 0x22);
    workspace = await provisionTrustedWorkspace({
      databaseUrl: requiredValue(databaseUrl),
      lookupKey,
      fieldKey,
      issuer: 'https://controlled.example/realms/zhiju',
    });
    fixture = await provisionMarkdownReview({
      databaseUrl: requiredValue(databaseUrl),
      workspace,
      lookupKey,
      fieldKey,
    });
    entry = createMarkdownReviewEntry(fixture);
    session = {
      principalRef: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: workspace.principalId,
        scope: {},
      },
      sessionBinding: Buffer.alloc(32, 0x83),
      authenticationContextHash: Buffer.alloc(32, 0x84),
      context: {
        trustConfigHash: '11'.repeat(32),
        issuerConfigHash: '22'.repeat(32),
        providerCode: 'keycloak',
        issuer: 'https://controlled.example/realms/zhiju',
        accountExternalId: 'https://controlled.example/realms/zhiju',
        subjectExternalId: 'controlled',
        clientId: 'workspace-bff',
        apiAudience: 'zhiju-api',
        azp: 'workspace-bff',
        tokenSha256: Buffer.alloc(32, 0x85),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        validatedAt: new Date(),
        sessionBindingHash: Buffer.alloc(32, 0x83),
      },
    };
  }, 120_000);
  afterAll(async () => {
    await fixture.close();
    await workspace.close();
  });
  async function query<T>(
    operation: Parameters<typeof entry.query>[0],
    payload: unknown,
    caller = session,
  ): Promise<T> {
    const { type, version, ...transport } = markdownQuery(operation, fixture.scope, payload);
    const result = await entry.query(
      operation,
      {
        ...transport,
        queryType: type,
        queryVersion: version,
        requester: caller.principalRef,
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: newUuidV7(),
          scope: {},
          contentHash: {
            algorithm: 'SHA-256',
            canonicalizationVersion: '1',
            digest: caller.authenticationContextHash.toString('hex'),
          },
        },
      },
      caller,
    );
    expect(getContractRegistry().validateOperationResult(operation, '1.0', result.data).valid).toBe(
      true,
    );
    return result.data as T;
  }
  function diff(limit = 7, cursor?: string) {
    return {
      fromRevisionRef: fixture.from.revisionRef,
      toRevisionRef: fixture.to.revisionRef,
      baselineKind: 'REVISION',
      filter: {},
      page: { limit, ...(cursor ? { cursor } : {}) },
    };
  }
  it('reads FROZEN content and all 36 changes / 9 chapters with stable scoped pagination', async () => {
    const content = await query<Artifact.FileReviewContent>('artifact.get_file_review_content', {
      revisionRef: fixture.to.revisionRef,
    });
    expect(content.document).toEqual(fixture.after.body);
    expect(content.canonicalContentHash).toEqual(fixture.to.revisionRef.contentHash);
    const first = await query<Artifact.FileChangeDirectory>(
      'artifact.get_file_change_directory',
      diff(),
    );
    expect(first.totalChanges).toBe(36);
    expect(first.changedUnitCount).toBe(36);
    expect(first.chapterGroups).toHaveLength(9);
    const ids = first.entries.map((e) => e.changeId.digest);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await query<Artifact.FileChangeDirectory>(
        'artifact.get_file_change_directory',
        diff(7, cursor),
        { ...session, authenticationContextHash: Buffer.alloc(32, 0x96) },
      );
      expect(page.diffHash).toEqual(first.diffHash);
      ids.push(...page.entries.map((e) => e.changeId.digest));
      cursor = page.nextCursor;
    }
    expect(new Set(ids).size).toBe(36);
    const filtered = await query<Artifact.FileChangeDirectory>(
      'artifact.get_file_change_directory',
      { ...diff(), filter: { chapterUnitId: requiredValue(first.chapterGroups[0]).unitId } },
    );
    expect(filtered.diffHash).toEqual(first.diffHash);
    expect(filtered.filteredChanges).toBe(4);
    await expect(
      query('artifact.get_file_change_directory', {
        ...diff(7, first.nextCursor),
        filter: { text: 'updated' },
      }),
    ).rejects.toThrow();
    await expect(
      query('artifact.get_file_change_directory', diff(7, first.nextCursor), {
        ...session,
        sessionBinding: Buffer.alloc(32, 0xff),
      }),
    ).rejects.toThrow();
    await expect(
      query('artifact.get_file_review_content', {
        revisionRef: {
          ...fixture.to.revisionRef,
          scope: { ...fixture.scope, projectId: newUuidV7() },
        },
      }),
    ).rejects.toThrow();
    await expect(
      query('artifact.get_file_review_content', {
        revisionRef: {
          ...fixture.to.revisionRef,
          contentHash: markdownBytesHash(Buffer.from('wrong')),
        },
      }),
    ).rejects.toThrow();
    await expect(
      query('artifact.get_file_change_directory', {
        toRevisionRef: fixture.to.revisionRef,
        baselineKind: 'EMPTY_INITIAL',
        filter: {},
        page: { limit: 100 },
      }),
    ).rejects.toThrow();
    const initial = await query<Artifact.FileChangeDirectory>(
      'artifact.get_file_change_directory',
      {
        toRevisionRef: fixture.from.revisionRef,
        baselineKind: 'EMPTY_INITIAL',
        filter: {},
        page: { limit: 100 },
      },
    );
    expect(initial.entries.every((e) => e.kind === 'ADDED')).toBe(true);
  });
  it('validates full subtree claims and returns suggestions without migrating originals', async () => {
    const section = requiredValue(fixture.before.body.units[0]);
    const location = fileReviewLocation(
      fixture.from.revisionRef,
      fixture.before.body,
      section.unitId,
    );
    const payload = {
      fromRevisionRef: fixture.from.revisionRef,
      toRevisionRef: fixture.to.revisionRef,
      locations: [location],
    };
    const result = await query<Artifact.ArtifactResolveFileReviewLocationsResult>(
      'artifact.resolve_file_review_locations',
      payload,
    );
    expect(result.items[0]?.resolution).toBe('CHANGED');
    expect(result.items[0]?.originalLocation).toEqual(location);
    expect(result.items[0]?.suggestedLocation?.revisionRef).toEqual(fixture.to.revisionRef);
    await expect(
      query('artifact.resolve_file_review_locations', {
        ...payload,
        locations: [{ ...location, claimHash: markdownBytesHash(Buffer.from('forged subtree')) }],
      }),
    ).rejects.toThrow();
  });
  it('persists the original operation and reuses its Attempt and receipt after finalize uncertainty', async () => {
    const request = await fixture.renderRequest();
    expect(await fixture.renderer.request(request.authority, request.command)).toEqual(
      request.receipt,
    );
    fixture.storage.setFinalizeFailure(true);
    try {
      expect((await fixture.renderer.work(request.authority, request.attemptRef)).status).toBe(
        'UNKNOWN',
      );
      await expect(fixture.register(request.attemptRef)).rejects.toThrow();
      expect((await fixture.renderer.work(request.authority, request.attemptRef)).status).toBe(
        'UNKNOWN',
      );
    } finally {
      fixture.storage.setFinalizeFailure(false);
    }
    const recovered = await fixture.renderer.work(request.authority, request.attemptRef, true);
    expect(recovered.status).toBe('SUCCEEDED');
    expect(recovered.originalOperation).toEqual({
      type: 'integration.request_markdown_render',
      version: '1.0',
    });
    expect(recovered.originalRequest).toEqual(request.command.payload);
    expect(await fixture.renderer.work(request.authority, request.attemptRef, true)).toMatchObject({
      attemptRef: request.attemptRef,
      rawReceiptRef: recovered.rawReceiptRef,
    });
    expect((await fixture.register(request.attemptRef)).representationRef.revision).toEqual(
      fixture.to.revisionRef,
    );
    const wrong = {
      ...recovered,
      originalOperation: { type: 'integration.request_render', version: '1.0' },
    };
    expect(
      getContractRegistry().validateOperationResult(
        'integration.get_markdown_render_binding',
        '1.0',
        wrong,
      ).valid,
    ).toBe(false);
    await expect(
      fixture.renderer.request(request.authority, {
        ...request.command,
        payload: {
          ...request.command.payload,
          rendererDigest: markdownBytesHash(Buffer.from('untrusted')),
        },
      }),
    ).rejects.toThrow();
  });
  it('refuses late results and cannot promote a failed Attempt to success', async () => {
    let time = Date.now();
    const lateStorage = {
      putStaging: fixture.storage.putStaging.bind(fixture.storage),
      finalize: fixture.storage.finalize.bind(fixture.storage),
      read: async (...args: Parameters<typeof fixture.storage.read>) => {
        const result = await fixture.storage.read(...args);
        time += 20_000;
        return result;
      },
    };
    const late = new MarkdownRenderService({
      db: fixture.integrationDb,
      storage: lateStorage,
      canonical: fixture.canonical,
      rendererDigest: fixture.rendererDigest,
      now: () => time,
      timeoutMs: 10_000,
    });
    const request = await fixture.renderRequest(fixture.to.revisionRef, late);
    expect((await late.work(request.authority, request.attemptRef)).status).toBe('FAILED');
    expect((await late.work(request.authority, request.attemptRef, true)).status).toBe('FAILED');
    await expect(fixture.register(request.attemptRef)).rejects.toThrow();
  });
  it('downloads the registered bytes twice and rejects ticket replay, interruption, mutation and expiry', async () => {
    const ticket = await query<Artifact.MarkdownDownload>('artifact.get_markdown_download', {
      representationRef: fixture.representationRef,
    });
    const read = async (caller = session, signal = new AbortController().signal) => {
      const stream = await entry.stream(
        caller,
        fixture.representationRef.representationId,
        ticket.downloadTicket,
        signal,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stream.bytes) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    const bytes = await read();
    expect(await read({ ...session, authenticationContextHash: Buffer.alloc(32, 0x97) })).toEqual(
      bytes,
    );
    expect(markdownBytesHash(bytes)).toEqual(fixture.representationRef.checksum);
    expect(bytes.toString()).toContain('最后一列完整');
    expect(bytes.toString()).toContain('| 0');
    await expect(read({ ...session, sessionBinding: Buffer.alloc(32, 0xfe) })).rejects.toThrow();
    const abort = new AbortController();
    const stream = await entry.stream(
      session,
      fixture.representationRef.representationId,
      ticket.downloadTicket,
      abort.signal,
    );
    abort.abort();
    await expect(stream.bytes.next()).rejects.toThrow();
    const binding = await fixture.renderer.getBinding(
      fixture.requested.authority,
      fixture.requested.attemptRef,
    );
    const locator = requiredValue(binding.succeededResult).outputObjectRef;
    fixture.storage.tamper(locator, { bytes: Buffer.from('changed externally') });
    await expect(read()).rejects.toThrow();
    fixture.storage.tamper(locator, { bytes });
    let now = 0;
    const tokens = new MarkdownBoundTokens(Buffer.alloc(32, 0x82), () => now);
    const expired = tokens.issue('markdown-bytes-read', {}, {}, 60_000);
    now = 60_000;
    expect(() => tokens.open('markdown-bytes-read', expired)).toThrow();
    await expect(
      query('artifact.get_markdown_download', {
        representationRef: {
          ...fixture.representationRef,
          revision: exactMarkdownRevision(fixture.from.revisionRef),
        },
      }),
    ).rejects.toThrow();
  });
  it('rechecks revoked grants for existing cursors, tickets and Service bindings', async () => {
    const directory = await query<Artifact.FileChangeDirectory>(
      'artifact.get_file_change_directory',
      diff(),
    );
    const ticket = await query<Artifact.MarkdownDownload>('artifact.get_markdown_download', {
      representationRef: fixture.representationRef,
    });
    await fixture.revoke('artifact.get_file_change_directory');
    await expect(
      query('artifact.get_file_change_directory', diff(7, directory.nextCursor)),
    ).rejects.toThrow();
    await fixture.revoke('artifact.get_markdown_download');
    await expect(
      entry.stream(
        session,
        fixture.representationRef.representationId,
        ticket.downloadTicket,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await fixture.revoke('integration.get_markdown_render_binding');
    await expect(
      fixture.renderer.getBinding(fixture.requested.authority, fixture.requested.attemptRef),
    ).rejects.toThrow();
  });
});

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
