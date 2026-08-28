// IM-04 WI-04 (issue #93): deterministic local/CI Object Storage adapter.
// This adapter is a test and local boundary, not a Ceph/OpenBao conformance
// implementation.

import type {
  ObjectStoragePort,
  ObjectStorageReadback,
  ObjectStorageReference,
} from './object-storage.js';

interface StoredObject {
  readonly storageProvider: string;
  readonly objectLocator: string;
  readonly objectVersionId: string;
  bytes: Buffer;
  mediaType: string;
  reportedByteSize: number | undefined;
  finalized: boolean;
}

export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly #objects = new Map<string, StoredObject>();
  #version = 0;
  #finalizeFailure = false;
  #deleteOutcome: 'DELETED' | 'NOT_FOUND' | 'UNKNOWN' | undefined;

  putStaging(input: {
    readonly objectLocator: string;
    readonly bytes: Buffer;
    readonly mediaType: string;
  }): Promise<ObjectStorageReference> {
    if (this.#objects.has(input.objectLocator)) {
      throw new Error('staging object already exists');
    }
    this.#version += 1;
    const stored: StoredObject = {
      storageProvider: 'memory',
      objectLocator: input.objectLocator,
      objectVersionId: `memory-v${this.#version}`,
      bytes: Buffer.from(input.bytes),
      mediaType: input.mediaType,
      reportedByteSize: undefined,
      finalized: false,
    };
    this.#objects.set(input.objectLocator, stored);
    return Promise.resolve(this.#reference(stored));
  }

  read(reference: ObjectStorageReference): Promise<ObjectStorageReadback> {
    const stored = this.#objects.get(reference.objectLocator);
    if (stored === undefined || !this.#matches(stored, reference)) {
      return Promise.reject(new Error('object readback is unavailable'));
    }
    return Promise.resolve({
      ...this.#reference(stored),
      bytes: Buffer.from(stored.bytes),
      byteSize: stored.reportedByteSize ?? stored.bytes.byteLength,
      mediaType: stored.mediaType,
    });
  }

  finalize(reference: ObjectStorageReference): Promise<void> {
    if (this.#finalizeFailure) return Promise.reject(new Error('object finalize failed'));
    const stored = this.#objects.get(reference.objectLocator);
    if (stored === undefined || !this.#matches(stored, reference)) {
      return Promise.reject(new Error('object finalize target is unavailable'));
    }
    stored.finalized = true;
    return Promise.resolve();
  }

  delete(reference: ObjectStorageReference): Promise<'DELETED' | 'NOT_FOUND' | 'UNKNOWN'> {
    if (this.#deleteOutcome === 'UNKNOWN') return Promise.resolve('UNKNOWN');
    if (this.#deleteOutcome === 'NOT_FOUND') {
      this.#objects.delete(reference.objectLocator);
      return Promise.resolve('NOT_FOUND');
    }
    const stored = this.#objects.get(reference.objectLocator);
    if (stored === undefined || !this.#matches(stored, reference))
      return Promise.resolve('NOT_FOUND');
    this.#objects.delete(reference.objectLocator);
    return Promise.resolve('DELETED');
  }

  setFinalizeFailure(failed: boolean): void {
    this.#finalizeFailure = failed;
  }

  setDeleteOutcome(outcome: 'DELETED' | 'NOT_FOUND' | 'UNKNOWN' | undefined): void {
    this.#deleteOutcome = outcome;
  }

  tamper(
    objectLocator: string,
    patch: {
      readonly bytes?: Buffer;
      readonly mediaType?: string;
      readonly reportedByteSize?: number;
    },
  ): void {
    const stored = this.#objects.get(objectLocator);
    if (stored === undefined) throw new Error('object to tamper is unavailable');
    if (patch.bytes !== undefined) stored.bytes = Buffer.from(patch.bytes);
    if (patch.mediaType !== undefined) stored.mediaType = patch.mediaType;
    if (patch.reportedByteSize !== undefined) stored.reportedByteSize = patch.reportedByteSize;
  }

  has(objectLocator: string): boolean {
    return this.#objects.has(objectLocator);
  }

  #reference(stored: StoredObject): ObjectStorageReference {
    return {
      storageProvider: stored.storageProvider,
      objectLocator: stored.objectLocator,
      objectVersionId: stored.objectVersionId,
    };
  }

  #matches(stored: StoredObject, reference: ObjectStorageReference): boolean {
    return (
      stored.storageProvider === reference.storageProvider &&
      stored.objectVersionId === reference.objectVersionId
    );
  }
}
