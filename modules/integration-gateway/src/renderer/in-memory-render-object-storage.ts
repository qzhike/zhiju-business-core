// IM-05 WI-05 (issue #125): local/CI opaque object-storage adapter.

import { createHash } from 'node:crypto';

import type { Common } from '@zhiju/contracts';

const LOCATOR = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;

export interface RenderObjectReadback {
  readonly locator: string;
  readonly bytes: Buffer;
  readonly checksum: Common.ContentHash;
  readonly mediaType: string;
}

export interface RenderObjectStoragePort {
  read(locator: string): Promise<RenderObjectReadback | undefined>;
  putImmutable(input: {
    readonly locator: string;
    readonly bytes: Buffer;
    readonly mediaType: string;
  }): Promise<RenderObjectReadback>;
}

function checksum(bytes: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    canonicalizationVersion: '1',
  };
}

function assertLocator(locator: string): void {
  if (!LOCATOR.test(locator) || /(?:token|secret|credential|presigned)/i.test(locator)) {
    throw new Error('object locator must be opaque and free of credential-like data');
  }
}

export class InMemoryRenderObjectStorage implements RenderObjectStoragePort {
  readonly #objects = new Map<string, RenderObjectReadback>();

  async read(locator: string): Promise<RenderObjectReadback | undefined> {
    await Promise.resolve();
    assertLocator(locator);
    const found = this.#objects.get(locator);
    return found === undefined
      ? undefined
      : { ...found, bytes: Buffer.from(found.bytes), checksum: { ...found.checksum } };
  }

  async putImmutable(input: {
    readonly locator: string;
    readonly bytes: Buffer;
    readonly mediaType: string;
  }): Promise<RenderObjectReadback> {
    await Promise.resolve();
    assertLocator(input.locator);
    const candidate: RenderObjectReadback = {
      locator: input.locator,
      bytes: Buffer.from(input.bytes),
      checksum: checksum(input.bytes),
      mediaType: input.mediaType,
    };
    const existing = this.#objects.get(input.locator);
    if (existing !== undefined) {
      if (
        existing.checksum.digest !== candidate.checksum.digest ||
        existing.mediaType !== candidate.mediaType
      ) {
        throw new Error('immutable object locator already contains different bytes');
      }
      return {
        ...existing,
        bytes: Buffer.from(existing.bytes),
        checksum: { ...existing.checksum },
      };
    }
    this.#objects.set(input.locator, candidate);
    return {
      ...candidate,
      bytes: Buffer.from(candidate.bytes),
      checksum: { ...candidate.checksum },
    };
  }
}
