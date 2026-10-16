const MAX_BYTES = 100 * 1024 * 1024;
const BUFFER_BYTES = 1024 * 1024;
export interface BoundedZipBody {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  abort: () => void;
}

/** Technical stream bounds only. The IG owner validates the original bytes. */
export function createBoundedZipBody(input: {
  source: AsyncIterable<Uint8Array>;
  currentSession: () => boolean;
  cancelSource: () => void;
  contentLength?: number;
  signal?: AbortSignal;
}): BoundedZipBody {
  if (
    input.contentLength !== undefined &&
    (!Number.isSafeInteger(input.contentLength) ||
      input.contentLength < 1 ||
      input.contentLength > MAX_BYTES)
  )
    throw new Error('ZIP_UPLOAD_REJECTED');
  const controller = new AbortController();
  const iterator = input.source[Symbol.asyncIterator]();
  const total = setTimeout(() => {
    controller.abort();
  }, 300_000);
  let idle: ReturnType<typeof setTimeout> | undefined;
  let count = 0;
  let closed = false;
  function resetIdle() {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => {
      controller.abort();
    }, 30_000);
  }
  function clear() {
    closed = true;
    clearTimeout(total);
    if (idle !== undefined) clearTimeout(idle);
    input.signal?.removeEventListener('abort', abort);
  }
  function abort() {
    controller.abort();
  }
  controller.signal.addEventListener(
    'abort',
    () => {
      clear();
      input.cancelSource();
    },
    { once: true },
  );
  input.signal?.addEventListener('abort', abort, { once: true });
  resetIdle();
  if (input.signal?.aborted) controller.abort();

  async function next(): Promise<IteratorResult<Uint8Array>> {
    controller.signal.throwIfAborted();
    let abortRead: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      abortRead = () => {
        reject(new Error('ZIP_UPLOAD_INTERRUPTED'));
      };
      controller.signal.addEventListener('abort', abortRead, { once: true });
    });
    try {
      return await Promise.race([iterator.next(), interrupted]);
    } finally {
      if (abortRead) controller.signal.removeEventListener('abort', abortRead);
    }
  }
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(stream) {
        try {
          if (closed || !input.currentSession()) throw new Error('ZIP_UPLOAD_INTERRUPTED');
          const part = await next();
          controller.signal.throwIfAborted();
          if (!input.currentSession()) throw new Error('ZIP_UPLOAD_INTERRUPTED');
          if (part.done) {
            if (count === 0 || (input.contentLength !== undefined && count !== input.contentLength))
              throw new Error('ZIP_UPLOAD_REJECTED');
            clear();
            stream.close();
            return;
          }
          const bytes = part.value;
          count += bytes.byteLength;
          if (
            bytes.byteLength > BUFFER_BYTES ||
            count > MAX_BYTES ||
            (input.contentLength !== undefined && count > input.contentLength)
          )
            throw new Error('ZIP_UPLOAD_REJECTED');
          resetIdle();
          stream.enqueue(bytes);
        } catch {
          controller.abort();
          stream.error(new Error('ZIP_UPLOAD_INTERRUPTED'));
        }
      },
      cancel() {
        controller.abort();
      },
    },
    { highWaterMark: 0, size: (chunk) => chunk.byteLength },
  );
  return { body, signal: controller.signal, abort };
}
