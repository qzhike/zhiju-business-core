import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PreparationError, preparationHash, type Common } from '@zhiju/contracts';
import { isUuidV7 } from '@zhiju/shared-kernel';

interface Binding {
  attemptRef: Common.ObjectRef;
  packageHash: Common.ContentHash;
}
const queues = new Map<string, Promise<void>>();
const held = new Map<string, string>();
const same = (a: unknown, b: unknown) => preparationHash(a).digest === preparationHash(b).digest;
const absent = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
async function bytes(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 32 * 1024 * 1024)
      throw new PreparationError('INTEGRATION_OMP_FILE_INVALID');
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function readLock(root: string): Promise<Binding | undefined> {
  try {
    return JSON.parse((await bytes(join(root, 'active-invocation.json'))).toString()) as Binding;
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}
/** Environment B has one owning supervisor/Core per execution directory. */
async function serial<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) ?? Promise.resolve();
  const result = previous.then(action);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(root, tail);
  try {
    return await result;
  } finally {
    if (queues.get(root) === tail) queues.delete(root);
  }
}
async function closed(root: string, lock: Binding, profileHash: Common.ContentHash) {
  try {
    if (!isUuidV7(lock.attemptRef.objectId)) return false;
    const attempt = join(root, lock.attemptRef.objectId);
    const prepared = JSON.parse((await bytes(join(attempt, 'prepared.json'))).toString()) as {
      binding: { attemptRef: Common.ObjectRef };
      packageHash: Common.ContentHash;
      profileHash: Common.ContentHash;
    };
    const closure = JSON.parse(
      (await bytes(join(attempt, 'process-closure.json'))).toString(),
    ) as Binding & {
      profileHash: Common.ContentHash;
      promptSent: boolean;
      eventBytes: number;
      eventSha256: string;
    };
    if (
      !same(prepared.binding.attemptRef, lock.attemptRef) ||
      !same(preparationHash(prepared.binding), lock.packageHash) ||
      !same(prepared.packageHash, lock.packageHash) ||
      !same(prepared.profileHash, profileHash) ||
      !same(closure.attemptRef, lock.attemptRef) ||
      !same(closure.packageHash, lock.packageHash) ||
      !same(closure.profileHash, profileHash) ||
      typeof closure.promptSent !== 'boolean' ||
      !Number.isSafeInteger(closure.eventBytes) ||
      closure.eventBytes < 0
    )
      return false;
    const events = await bytes(join(attempt, 'events.jsonl'));
    return (
      events.length === closure.eventBytes &&
      createHash('sha256').update(events).digest('hex') === closure.eventSha256
    );
  } catch {
    // Missing, partial, legacy or mismatched evidence never proves process closure.
    return false;
  }
}
async function recover(root: string, profileHash: Common.ContentHash) {
  if (held.has(root)) return;
  const current = await readLock(root);
  if (current && (await closed(root, current, profileHash)))
    await unlink(join(root, 'active-invocation.json'));
}
export async function recoverOmpInvocation(root: string, profileHash: Common.ContentHash) {
  await serial(root, () => recover(root, profileHash));
}
export async function acquireOmpInvocation(
  root: string,
  binding: Binding,
  profileHash: Common.ContentHash,
): Promise<() => Promise<void>> {
  await serial(root, async () => {
    await recover(root, profileHash);
    let file;
    try {
      file = await open(join(root, 'active-invocation.json'), 'wx', 0o600);
      await file.writeFile(JSON.stringify(binding) + '\n');
      await file.sync();
      held.set(root, preparationHash(binding).digest);
    } catch {
      throw new PreparationError('INTEGRATION_OMP_INSTANCE_BUSY');
    } finally {
      await file?.close();
    }
  });
  return () =>
    serial(root, async () => {
      if (held.get(root) !== preparationHash(binding).digest) return;
      const current = await readLock(root);
      if (current && same(current, binding)) await unlink(join(root, 'active-invocation.json'));
      held.delete(root);
    });
}
