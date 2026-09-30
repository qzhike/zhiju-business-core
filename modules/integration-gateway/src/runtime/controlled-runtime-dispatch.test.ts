import { expect, it } from 'vitest';
import { LocalSyntheticRuntimeDriver } from './controlled-runtime-dispatch.js';
import type { Common } from '@zhiju/contracts';

it('requires an immutable journal before a formal invocation can have any effect', async () => {
  const driver = new LocalSyntheticRuntimeDriver();
  const input = {
    invocationBinding: { runtimeBinding: { adapterCode: 'te.human_operated.synthetic.formal' } },
  } as unknown as Parameters<LocalSyntheticRuntimeDriver['invoke']>[0];
  await expect(driver.invoke(input)).rejects.toThrow();
  expect(driver.invokedAttemptIds).toEqual([]);
});

it('refuses a formal release without a journal before authorization or owning output reads', async () => {
  const driver = new LocalSyntheticRuntimeDriver();
  let reads = 0;
  await expect(
    driver.releaseFormalOutput(
      {} as Common.ObjectRef,
      {},
      {
        revalidateAuthorization: () => {
          reads += 1;
          return Promise.resolve();
        },
        readExecutionOutput: () => {
          reads += 1;
          return Promise.resolve({});
        },
      },
    ),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
