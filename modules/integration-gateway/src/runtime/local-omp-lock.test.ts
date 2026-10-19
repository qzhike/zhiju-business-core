import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparationHash, type Common } from '@zhiju/contracts';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { acquireOmpInvocation, recoverOmpInvocation } from './local-omp-lock.js';

const roots: string[] = [];
const profileHash = preparationHash({ profile: 'test-only' });
const binding = () => {
  const attemptRef: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.integration.runtime_attempt',
    objectId: newUuidV7(),
    scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() },
  };
  const value = { attemptRef, source: 'synthetic' };
  return { binding: value, attemptRef, packageHash: preparationHash(value) };
};
async function fixture(mode = 'closed') {
  const root = await mkdtemp(join(tmpdir(), 'zhiju-omp-lock-'));
  roots.push(root);
  const original = binding();
  const dir = join(root, original.attemptRef.objectId);
  await mkdir(dir);
  const json = (path: string, value: unknown) =>
    writeFile(join(root, path), JSON.stringify(value), { mode: 0o600 });
  await json('active-invocation.json', {
    attemptRef: original.attemptRef,
    packageHash: original.packageHash,
  });
  await json(original.attemptRef.objectId + '/prepared.json', {
    binding: original.binding,
    packageHash: original.packageHash,
    profileHash,
  });
  const events = Buffer.from('{"type":"prompt_result","status":"completed"}\n');
  await writeFile(join(dir, 'events.jsonl'), events);
  const closure = {
    attemptRef: original.attemptRef,
    packageHash: original.packageHash,
    profileHash,
    promptSent: true,
    eventBytes: events.length,
    eventSha256: createHash('sha256').update(events).digest('hex'),
  };
  if (mode === 'attempt') closure.attemptRef = binding().attemptRef;
  if (mode === 'package') closure.packageHash = preparationHash({ different: true });
  if (mode === 'profile') closure.profileHash = preparationHash({ different: true });
  if (mode === 'events') await writeFile(join(dir, 'events.jsonl'), 'changed');
  if (mode !== 'unknown')
    await json(original.attemptRef.objectId + '/process-closure.json', closure);
  return { root, original, closure, json };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('local OMP original-invocation lock recovery', () => {
  it('recovers a crash after durable closure without invoking the original attempt again', async () => {
    const { root, original } = await fixture();
    await recoverOmpInvocation(root, profileHash);
    await expect(readFile(join(root, 'active-invocation.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const next = binding();
    const release = await acquireOmpInvocation(root, next, profileHash);
    expect(
      JSON.parse(await readFile(join(root, 'active-invocation.json'), 'utf8')).attemptRef,
    ).toEqual(next.attemptRef);
    expect(
      await readFile(join(root, original.attemptRef.objectId, 'process-closure.json'), 'utf8'),
    ).toContain(original.attemptRef.objectId);
    await release();
  });
  it('recovers on a new acquisition even if the old task is no longer polled', async () => {
    const { root } = await fixture();
    const release = await acquireOmpInvocation(root, binding(), profileHash);
    await release();
  });
  it.each(['unknown', 'attempt', 'package', 'profile', 'events'])(
    'quarantines missing or mismatched host closure: %s',
    async (mode) => {
      const { root, original } = await fixture(mode);
      await recoverOmpInvocation(root, profileHash);
      await expect(acquireOmpInvocation(root, binding(), profileHash)).rejects.toThrow(
        'INTEGRATION_OMP_INSTANCE_BUSY',
      );
      expect(
        JSON.parse(await readFile(join(root, 'active-invocation.json'), 'utf8')).attemptRef,
      ).toEqual(original.attemptRef);
    },
  );
  it('serializes concurrent recovery and acquisition without deleting the new owner', async () => {
    const { root } = await fixture();
    const next = binding();
    const [, release] = await Promise.all([
      recoverOmpInvocation(root, profileHash),
      acquireOmpInvocation(root, next, profileHash),
      recoverOmpInvocation(root, profileHash),
    ]);
    await expect(acquireOmpInvocation(root, binding(), profileHash)).rejects.toThrow(
      'INTEGRATION_OMP_INSTANCE_BUSY',
    );
    expect(
      JSON.parse(await readFile(join(root, 'active-invocation.json'), 'utf8')).attemptRef,
    ).toEqual(next.attemptRef);
    await release();
    const second = binding();
    const releaseSecond = await acquireOmpInvocation(root, second, profileHash);
    await release();
    expect(
      JSON.parse(await readFile(join(root, 'active-invocation.json'), 'utf8')).attemptRef,
    ).toEqual(second.attemptRef);
    await releaseSecond();
  });
  it('does not release a live invocation that is still finalizing after host closure', async () => {
    const { root, original } = await fixture();
    await recoverOmpInvocation(root, profileHash);
    const release = await acquireOmpInvocation(root, original, profileHash);
    await recoverOmpInvocation(root, profileHash);
    await expect(acquireOmpInvocation(root, binding(), profileHash)).rejects.toThrow(
      'INTEGRATION_OMP_INSTANCE_BUSY',
    );
    await release();
  });
});
