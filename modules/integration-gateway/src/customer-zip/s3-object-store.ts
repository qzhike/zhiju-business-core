import { createHash, createHmac } from 'node:crypto';
import type { CustomerZipObjectStore, CustomerZipObjectReceipt } from './intake-service.js';
export interface CustomerZipS3Configuration {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly clock?: () => Date;
  readonly fetch?: typeof fetch;
}
function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
function unavailable(): never {
  throw new Error('DEPENDENCY_UNAVAILABLE');
}
/** S3 path-style SigV4 adapter; all deployment identity and credentials are explicit. */
export function createCustomerZipS3ObjectStore(
  config: CustomerZipS3Configuration,
): CustomerZipObjectStore {
  return createS3Store(config, new Set());
}
/** Read-only access to explicit deployment-owned company source objects. */
export function createPreparationCompanyS3Reader(
  config: CustomerZipS3Configuration,
  keys: readonly string[],
): Pick<CustomerZipObjectStore, 'read'> {
  if (
    keys.some(
      (key) =>
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(key) ||
        key.split('/').some((part) => !part || part === '.' || part === '..'),
    )
  )
    unavailable();
  const allowedKeys = new Set(keys);
  const store = createS3Store(config, allowedKeys);
  return {
    read: (key) =>
      allowedKeys.has(key) ? store.read(key) : Promise.reject(new Error('DEPENDENCY_UNAVAILABLE')),
  };
}
function createS3Store(
  config: CustomerZipS3Configuration,
  companyReadKeys: ReadonlySet<string>,
): CustomerZipObjectStore {
  const endpoint = new URL(config.endpoint);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !config.region ||
    !/^[A-Za-z0-9-]+$/.test(config.region) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
    !config.accessKeyId ||
    !config.secretAccessKey
  )
    unavailable();
  const request = config.fetch ?? fetch,
    clock = config.clock ?? (() => new Date());
  async function call(
    method: 'GET' | 'HEAD' | 'PUT',
    key: string,
    bytes?: Uint8Array,
  ): Promise<Response> {
    if (
      !/^customer-zip\/[0-9a-f-]+\/(?:[12]\/original|sources\/[0-9a-f-]+)$/.test(key) &&
      !(method === 'GET' && companyReadKeys.has(key))
    )
      unavailable();
    const url = new URL(endpoint);
    url.pathname =
      '/' +
      [config.bucket, ...key.split('/')]
        .map((value) =>
          encodeURIComponent(value).replace(
            /[!'()*]/g,
            (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
          ),
        )
        .join('/');
    const timestamp = clock()
        .toISOString()
        .replace(/[:-]|\.\d{3}/g, ''),
      day = timestamp.slice(0, 8),
      bodyHash = digest(bytes ?? new Uint8Array());
    const values: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': timestamp,
    };
    if (config.sessionToken) values['x-amz-security-token'] = config.sessionToken;
    if (bytes) {
      values['if-none-match'] = '*';
      values['x-amz-checksum-sha256'] = Buffer.from(bodyHash, 'hex').toString('base64');
      values['x-amz-meta-sha256'] = bodyHash;
    }
    const names = Object.keys(values).sort(),
      signed = names.join(';'),
      canonicalHeaders = names.map((name) => `${name}:${values[name]}\n`).join('');
    const canonical = [method, url.pathname, '', canonicalHeaders, signed, bodyHash].join('\n'),
      credentialScope = `${day}/${config.region}/s3/aws4_request`,
      signingKey = hmac(
        hmac(hmac(hmac('AWS4' + config.secretAccessKey, day), config.region), 's3'),
        'aws4_request',
      );
    const signature = createHmac('sha256', signingKey)
      .update(['AWS4-HMAC-SHA256', timestamp, credentialScope, digest(canonical)].join('\n'))
      .digest('hex');
    const headers = new Headers(values);
    headers.set(
      'authorization',
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`,
    );
    return request(url, {
      method,
      headers,
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
    });
  }
  async function read(key: string): Promise<Uint8Array> {
    const response = await call('GET', key);
    if (!response.ok || !response.body) unavailable();
    const length = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(length) || length < 0 || length > 104857600) unavailable();
    const chunks: Buffer[] = [];
    let count = 0;
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) unavailable();
      count += chunk.length;
      if (count > length || count > 104857600) unavailable();
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (count !== length || digest(bytes) !== response.headers.get('x-amz-meta-sha256'))
      unavailable();
    return bytes;
  }
  return {
    async put(key, bytes): Promise<CustomerZipObjectReceipt> {
      if (bytes.byteLength > 104857600) unavailable();
      const expected = digest(bytes),
        response = await call('PUT', key, bytes);
      if (!response.ok && response.status !== 412) unavailable();
      // Read back exact durable bytes. A previous object is never overwritten.
      const stored = await read(key);
      if (stored.byteLength !== bytes.byteLength || digest(stored) !== expected)
        throw new Error('INTEGRATION_OBJECT_IDENTITY_CONFLICT');
      return { key, sha256: expected, byteLength: stored.byteLength };
    },
    read,
    async inspect(key) {
      try {
        const response = await call('HEAD', key);
        if (response.status === 404) return { state: 'ABSENT' };
        if (!response.ok) return { state: 'UNKNOWN' };
        const sha256 = response.headers.get('x-amz-meta-sha256') ?? '',
          length = Number(response.headers.get('content-length'));
        if (
          !/^[0-9a-f]{64}$/.test(sha256) ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > 104857600
        )
          return { state: 'UNKNOWN' };
        return { state: 'COMPLETE', receipt: { key, sha256, byteLength: length } };
      } catch {
        return { state: 'UNKNOWN' };
      }
    },
  };
}
