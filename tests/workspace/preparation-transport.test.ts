import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  sha256CanonicalJson,
  newUuidV7,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { assertPreparationCommand, preparationHash, samePreparationValue } from '@zhiju/contracts';
import {
  canonicalPreparationJson,
  preparationCommand,
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
