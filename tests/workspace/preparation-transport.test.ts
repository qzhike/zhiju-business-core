import { describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  sha256CanonicalJson,
  newUuidV7,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { assertPreparationCommand, preparationHash, samePreparationValue } from '@zhiju/contracts';
import {
  canonicalPreparationJson,
  bytesSha256,
  preparationCommand,
  uploadPreparationZip,
} from '../../apps/workspace-web/src/intake/live-client.js';
import { safeReturnTo } from '../../apps/workspace-web/src/trusted/session.js';

describe('preparation public command integrity', () => {
  it.each([
    { note: '  原说明\n不得作为系统指令\t', nested: { z: 1, a: ['é', 'e\u0301', -0] } },
    { '𐀀': 1, '\ue000': 2, 'e\u0301': 'raw \r\n' },
  ])('uses identical browser/Core cv1 while retaining original strings', async (payload) => {
    const original = structuredClone(payload);
    expect(canonicalPreparationJson(payload)).toBe(canonicalize(payload as CanonicalJsonValue));
    const scope = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
    const command = await preparationCommand(
      'project.request_project_preparation',
      {
        kind: 'OBJECT',
        objectType: 'zhiju.project.preparation_request',
        objectId: newUuidV7(),
        scope,
      },
      payload,
    );
    assertPreparationCommand(
      command,
      'project.request_project_preparation',
      'zhiju.project.preparation_request',
      'CREATE',
    );
    expect(command.payload).toEqual(original);
    expect((command.integrity as { payloadHash: { digest: string } }).payloadHash.digest).toBe(
      sha256CanonicalJson(payload as CanonicalJsonValue),
    );
  });
  it('rejects normalization collisions and unsupported number values', () => {
    for (const value of [{ é: 1, 'e\u0301': 2 }, { x: 1.1 }, { x: Number.NaN }, { x: undefined }])
      expect(() => canonicalPreparationJson(value)).toThrow('UI_CLIENT_STATE_INVALID');
  });
  it('keeps raw equality separate from canonical hash equality', () => {
    const a = { submittedNote: 'é' },
      b = { submittedNote: 'e\u0301' };
    expect(preparationHash(a)).toEqual(preparationHash(b));
    expect(samePreparationValue(a, b)).toBe(false);
  });
  it('rejects a forged Actor, changed Scope and a stale payload hash before admission', async () => {
    const scope = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
    const original = await preparationCommand(
      'project.request_project_preparation',
      {
        kind: 'OBJECT',
        objectType: 'zhiju.project.preparation_request',
        objectId: newUuidV7(),
        scope,
      },
      { name: '原名称' },
    );
    for (const changed of [
      { ...original, actor: {} },
      { ...original, scopeRef: { ...scope, projectId: newUuidV7() } },
      { ...original, payload: { name: '修改名称' } },
    ])
      expect(() => {
        assertPreparationCommand(
          changed,
          'project.request_project_preparation',
          'zhiju.project.preparation_request',
          'CREATE',
        );
      }).toThrow();
  });
  it('preserves only safe recovery identifiers through login', () => {
    const request = newUuidV7(),
      enterprise = newUuidV7(),
      project = newUuidV7(),
      intake = newUuidV7();
    const href = `/preparations/${request}?enterprise=${enterprise}&project=${project}&intake=${intake}`;
    expect(safeReturnTo(href)).toBe(href);
    for (const unsafe of [
      `${href}&note=secret`,
      `${href}#token`,
      href.replace(request, '../another'),
    ])
      expect(safeReturnTo(unsafe)).toBe('/workbench');
  });
});

describe('preparation ZIP transport completion', () => {
  it.each(['complete', 'interrupted'] as const)(
    'awaits the response body after HTTP 200: %s',
    async (ending) => {
      const file = new File(['controlled original bytes'], 'original.zip');
      const upload = {
        path: `/api/customer-intakes/${newUuidV7()}/zip`,
        token: 'A'.repeat(43),
        method: 'PUT',
        expectedByteLength: file.size,
        expectedZipBytesSha256: await bytesSha256(await file.arrayBuffer()),
      };
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
          },
        }),
        { status: 200 },
      );
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      let completed = false;
      const result = uploadPreparationZip(
        file,
        upload,
        'controlled-csrf',
        new AbortController().signal,
      );
      const observed = result.then(
        () => {
          completed = true;
          return 'COMPLETE';
        },
        () => 'INTERRUPTED',
      );
      try {
        await vi.waitFor(() => {
          expect(fetch).toHaveBeenCalledOnce();
        });
        expect(completed).toBe(false);
        if (ending === 'complete') {
          body.enqueue(new TextEncoder().encode('{"disposition":"STAGED"}'));
          body.close();
        } else body.error(new Error('Response interrupted'));
        expect(await observed).toBe(ending === 'complete' ? 'COMPLETE' : 'INTERRUPTED');
      } finally {
        if (!response.bodyUsed) body.close();
        fetch.mockRestore();
      }
    },
  );
});
