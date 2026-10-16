/* eslint-disable @typescript-eslint/require-await -- Immediate async sources model bounded network chunks without timers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedZipBody } from './zip-body.js';

afterEach(() => vi.useRealTimers());
async function* chunks(...sizes: number[]) {
  for (const size of sizes) yield new Uint8Array(size);
}
async function consume(body: ReadableStream<Uint8Array>): Promise<number> {
  const reader = body.getReader();
  let count = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) return count;
    count += part.value.byteLength;
  }
}
describe('bounded original ZIP forwarding', () => {
  it('forwards the exact bytes with backpressure and no buffering before a read', async () => {
    let reads = 0;
    async function* source() {
      reads += 1;
      yield new Uint8Array([1, 2, 3]);
      reads += 1;
      yield new Uint8Array([4, 5]);
    }
    const upload = createBoundedZipBody({
      source: source(),
      currentSession: () => true,
      cancelSource: () => undefined,
      contentLength: 5,
    });
    await Promise.resolve();
    expect(reads).toBe(0);
    const reader = upload.body.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    expect(reads).toBe(1);
    expect((await reader.read()).value).toEqual(new Uint8Array([4, 5]));
    expect((await reader.read()).done).toBe(true);
  });
  it('aborts before the next byte leaves an invalidated Session', async () => {
    let current = true;
    const cancel = vi.fn();
    const upload = createBoundedZipBody({
      source: chunks(4, 4),
      currentSession: () => current,
      cancelSource: cancel,
      contentLength: 8,
    });
    const reader = upload.body.getReader();
    expect((await reader.read()).value?.length).toBe(4);
    current = false;
    await expect(reader.read()).rejects.toThrow('ZIP_UPLOAD_INTERRUPTED');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    [3, 4],
    [5, 4],
  ])('refuses actual length %i for a declared length %i', async (actual, declared) => {
    const upload = createBoundedZipBody({
      source: chunks(actual),
      currentSession: () => true,
      cancelSource: () => undefined,
      contentLength: declared,
    });
    await expect(consume(upload.body)).rejects.toThrow('ZIP_UPLOAD_INTERRUPTED');
  });
  it('bounds chunked streams independently of a Content-Length header', async () => {
    async function* source() {
      for (let index = 0; index < 101; index += 1) yield new Uint8Array(1024 * 1024);
    }
    const upload = createBoundedZipBody({
      source: source(),
      currentSession: () => true,
      cancelSource: () => undefined,
    });
    await expect(consume(upload.body)).rejects.toThrow('ZIP_UPLOAD_INTERRUPTED');
  });
  it('refuses an application chunk larger than the one-MiB buffer limit', async () => {
    const upload = createBoundedZipBody({
      source: chunks(1024 * 1024 + 1),
      currentSession: () => true,
      cancelSource: () => undefined,
    });
    await expect(consume(upload.body)).rejects.toThrow('ZIP_UPLOAD_INTERRUPTED');
  });
  it('closes a stalled source at the thirty-second idle boundary', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      }),
    };
    const upload = createBoundedZipBody({
      source,
      currentSession: () => true,
      cancelSource: cancel,
    });
    const observed = consume(upload.body).then(
      () => false,
      () => true,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await observed).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects an invalid declared length before reading the source', () => {
    for (const contentLength of [0, -1, 1.5, 104_857_601])
      expect(() =>
        createBoundedZipBody({
          source: chunks(1),
          currentSession: () => true,
          cancelSource: () => undefined,
          contentLength,
        }),
      ).toThrow('ZIP_UPLOAD_REJECTED');
  });
});
