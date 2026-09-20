import { describe, expect, it, vi } from 'vitest';

import { configureDockerHostFromCurrentContext, resolveTagDigest } from '../persistence/docker.mjs';

describe('Docker runtime resolution', () => {
  it('preserves an explicit DOCKER_HOST without inspecting the current context', async () => {
    const env = { DOCKER_HOST: 'tcp://explicit.example:2376' };
    const inspectContext = vi.fn(() => Promise.resolve('unix:///unused/docker.sock'));

    await expect(
      configureDockerHostFromCurrentContext({ env, platform: 'darwin', inspectContext }),
    ).resolves.toEqual({
      host: 'tcp://explicit.example:2376',
      source: 'environment',
      configured: false,
    });
    expect(inspectContext).not.toHaveBeenCalled();
  });

  it('exports the active macOS Unix socket for Testcontainers', async () => {
    const env: Record<string, string | undefined> = {};

    await expect(
      configureDockerHostFromCurrentContext({
        env,
        platform: 'darwin',
        inspectContext: () => Promise.resolve('unix:///tmp/orbstack/docker.sock'),
        socketExists: () => true,
      }),
    ).resolves.toEqual({
      host: 'unix:///tmp/orbstack/docker.sock',
      source: 'docker-context',
      configured: true,
    });
    expect(env.DOCKER_HOST).toBe('unix:///tmp/orbstack/docker.sock');
  });

  it('fails before the persistence gate when the selected Unix socket is absent', async () => {
    await expect(
      configureDockerHostFromCurrentContext({
        env: {},
        platform: 'darwin',
        inspectContext: () => Promise.resolve('unix:///tmp/missing/docker.sock'),
        socketExists: () => false,
      }),
    ).rejects.toThrow('Docker context socket is unavailable');
  });

  it('leaves the platform default unchanged outside macOS', async () => {
    const env: Record<string, string | undefined> = {};
    const inspectContext = vi.fn(() => Promise.resolve('unix:///unused/docker.sock'));

    await expect(
      configureDockerHostFromCurrentContext({ env, platform: 'linux', inspectContext }),
    ).resolves.toEqual({ host: null, source: 'docker-default', configured: false });
    expect(env.DOCKER_HOST).toBeUndefined();
    expect(inspectContext).not.toHaveBeenCalled();
  });

  it('retries a transient registry EOF and returns the resolved digest', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const inspectTag = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('registry request failed: EOF'))
      .mockResolvedValueOnce(digest);
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      resolveTagDigest('docker.io/library/postgres', '18.6', {
        inspectTag,
        wait,
      }),
    ).resolves.toBe(digest);
    expect(inspectTag).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it('does not retry a non-transient registry rejection', async () => {
    const inspectTag = vi.fn(() => Promise.reject(new Error('unauthorized: access denied')));
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      resolveTagDigest('docker.io/library/postgres', '18.6', {
        inspectTag,
        wait,
      }),
    ).rejects.toThrow('unauthorized');
    expect(inspectTag).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
