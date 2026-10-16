/* eslint-disable @typescript-eslint/require-await -- Fetch protocol doubles intentionally return immediate asynchronous responses. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCustomerZipS3ObjectStore,
  createPreparationCompanyS3Reader,
} from './s3-object-store.js';
const key = 'customer-zip/0199e61a-7000-7000-8000-000000000001/1/original';
const bytes = Buffer.from('original zip bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const base = {
  endpoint: 'https://rgw.example.test',
  bucket: 'customer-materials',
  region: 'test-1',
  accessKeyId: 'EXPLICIT_ACCESS',
  secretAccessKey: 'explicit-secret',
  clock: () => new Date('2026-10-15T12:00:00.000Z'),
};
describe('real S3 compatible object adapter protocol', () => {
  it('signs the fixed endpoint and immutable conditional PUT then verifies actual durable readback', async () => {
    const seen: string[] = [];
    const adapter = createCustomerZipS3ObjectStore({
      ...base,
      fetch: async (url, init) => {
        const method = init?.method ?? 'GET';
        seen.push(method);
        if (!(url instanceof URL)) throw new Error('Expected URL');
        expect(url.toString()).toBe('https://rgw.example.test/customer-materials/' + key);
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toContain(
          'Credential=EXPLICIT_ACCESS/20261015/test-1/s3/aws4_request',
        );
        expect(headers.get('authorization')).toMatch(/Signature=[0-9a-f]{64}$/);
        expect(headers.get('x-amz-date')).toBe('20261015T120000Z');
        if (method === 'PUT') {
          expect(headers.get('if-none-match')).toBe('*');
          expect(headers.get('x-amz-checksum-sha256')).toBe(
            Buffer.from(sha256, 'hex').toString('base64'),
          );
          return new Response(null, { status: 200 });
        }
        return new Response(bytes, {
          headers: { 'content-length': String(bytes.length), 'x-amz-meta-sha256': sha256 },
        });
      },
    });
    expect(await adapter.put(key, bytes)).toEqual({ key, sha256, byteLength: bytes.length });
    expect(seen).toEqual(['PUT', 'GET']);
  });
  it('never overwrites an existing different object and reports unavailable HEAD as UNKNOWN', async () => {
    const adapter = createCustomerZipS3ObjectStore({
      ...base,
      fetch: async (_url, init) =>
        init?.method === 'PUT'
          ? new Response(null, { status: 412 })
          : init?.method === 'HEAD'
            ? new Response(null, { status: 503 })
            : new Response(Buffer.from('different'), {
                headers: {
                  'content-length': '9',
                  'x-amz-meta-sha256': createHash('sha256').update('different').digest('hex'),
                },
              }),
    });
    await expect(adapter.put(key, bytes)).rejects.toThrow('INTEGRATION_OBJECT_IDENTITY_CONFLICT');
    expect(await adapter.inspect(key)).toEqual({ state: 'UNKNOWN' });
  });
  it('does not mistake authorization or transport failure for proof of absence', async () => {
    const adapter = createCustomerZipS3ObjectStore({
      ...base,
      fetch: async () => new Response(null, { status: 403 }),
    });
    expect(await adapter.inspect(key)).toEqual({ state: 'UNKNOWN' });
  });
});

it('reads only explicit company keys without widening customer intake writes', async () => {
  const companyKey = 'approved-company/template';
  let calls = 0;
  const config = {
    ...base,
    fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls++;
      if (!(url instanceof URL)) throw new Error('Expected URL');
      expect(url.toString()).toBe('https://rgw.example.test/customer-materials/' + companyKey);
      expect(init?.method).toBe('GET');
      return new Response(bytes, {
        headers: { 'content-length': String(bytes.length), 'x-amz-meta-sha256': sha256 },
      });
    },
  };
  const reader = createPreparationCompanyS3Reader(config, [companyKey]);
  expect(Buffer.from(await reader.read(companyKey))).toEqual(bytes);
  await expect(reader.read('unreviewed/source')).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(createCustomerZipS3ObjectStore(config).put(companyKey, bytes)).rejects.toThrow(
    'DEPENDENCY_UNAVAILABLE',
  );
  expect(calls).toBe(1);
  expect(() => createPreparationCompanyS3Reader(config, ['company/../other'])).toThrow(
    'DEPENDENCY_UNAVAILABLE',
  );
});
