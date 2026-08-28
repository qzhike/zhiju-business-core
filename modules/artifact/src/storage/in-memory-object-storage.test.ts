import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

describe('IM-04 WI-04 local Object Storage port', () => {
  it('returns an immutable versioned staging reference and authoritative readback', async () => {
    const storage = new InMemoryObjectStorage();
    const bytes = Buffer.from('{"content":true}', 'utf8');
    const reference = await storage.putStaging({
      objectLocator: 'staging/canonical/018f22e2-7c15-7b2e-8d86-2de956a9d231',
      bytes,
      mediaType: 'application/json',
    });

    bytes[0] = 0x58;
    const readback = await storage.read(reference);
    expect(readback).toMatchObject({
      storageProvider: 'memory',
      objectLocator: reference.objectLocator,
      objectVersionId: reference.objectVersionId,
      mediaType: 'application/json',
      byteSize: Buffer.byteLength('{"content":true}', 'utf8'),
    });
    expect(readback.bytes.toString('utf8')).toBe('{"content":true}');

    await storage.finalize(reference);
    expect(await storage.delete(reference)).toBe('DELETED');
    expect(await storage.delete(reference)).toBe('NOT_FOUND');
  });

  it('exposes tampered bytes and metadata through readback for service rejection', async () => {
    const storage = new InMemoryObjectStorage();
    const reference = await storage.putStaging({
      objectLocator: 'staging/canonical/018f22e2-7c15-7b2e-8d86-2de956a9d232',
      bytes: Buffer.from('{"content":true}', 'utf8'),
      mediaType: 'application/json',
    });

    storage.tamper(reference.objectLocator, {
      bytes: Buffer.from('{"content":false}', 'utf8'),
      mediaType: 'application/octet-stream',
      reportedByteSize: 99,
    });
    const readback = await storage.read(reference);
    expect(readback.mediaType).toBe('application/octet-stream');
    expect(readback.byteSize).toBe(99);
    expect(readback.bytes.toString('utf8')).toBe('{"content":false}');
  });
});
