import { afterEach, describe, expect, it, vi } from 'vitest';

import { ControlledFinalRecoveryWorker } from './controlled-final-recovery-worker.js';

afterEach(() => vi.useRealTimers());

describe('controlled final recovery worker', () => {
  it('polls immediately, never overlaps work, and stops after the active tick', async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const recover = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const worker = new ControlledFinalRecoveryWorker({ intervalMs: 100, recover, onError });

    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(recover).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(recover).toHaveBeenCalledTimes(2);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
