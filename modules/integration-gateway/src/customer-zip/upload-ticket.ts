import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { isUuidV7 } from '@zhiju/shared-kernel';

const TICKET_LIFETIME_MS = 300_000;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** These facts come from the committed intake, never from an upload header. */
export interface CustomerZipTicketBinding {
  readonly intakeId: string;
  readonly creatorId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly submissionPayloadHash: string;
  readonly zipBytesSha256: string;
  readonly declaredByteLength: number;
  readonly generation: 1 | 2;
}

/** Persist only in the protected generation record, never in a public receipt. */
export interface EncryptedCustomerZipTicket {
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authenticationTag: string;
  readonly tokenDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CustomerZipUploadTicket {
  readonly generation: 1 | 2;
  readonly token: string;
  readonly expiresAt: string;
  readonly method: 'PUT';
  readonly path: string;
  readonly expectedByteLength: number;
  readonly expectedZipBytesSha256: string;
}

export class CustomerZipTicketError extends Error {
  constructor(
    readonly code:
      | 'INTEGRATION_ZIP_TICKET_INVALID'
      | 'INTEGRATION_ZIP_TICKET_EXPIRED'
      | 'DEPENDENCY_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'CustomerZipTicketError';
  }
}

function invalid(): never {
  throw new CustomerZipTicketError('INTEGRATION_ZIP_TICKET_INVALID');
}

function validateBinding(binding: CustomerZipTicketBinding): void {
  const keys = [
    'intakeId',
    'creatorId',
    'enterpriseId',
    'projectId',
    'submissionPayloadHash',
    'zipBytesSha256',
    'declaredByteLength',
    'generation',
  ];
  if (
    Object.keys(binding).length !== keys.length ||
    Object.keys(binding).some((key) => !keys.includes(key)) ||
    ![binding.intakeId, binding.creatorId, binding.enterpriseId, binding.projectId].every(
      (id) => typeof id === 'string' && isUuidV7(id),
    ) ||
    !HASH_PATTERN.test(binding.submissionPayloadHash) ||
    !HASH_PATTERN.test(binding.zipBytesSha256) ||
    !Number.isSafeInteger(binding.declaredByteLength) ||
    binding.declaredByteLength < 1 ||
    binding.declaredByteLength > MAX_ZIP_BYTES ||
    ![1, 2].includes(binding.generation)
  )
    invalid();
}

function instant(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid();
  return time;
}

function currentTime(now: Date): number {
  const time = now.getTime();
  if (!Number.isFinite(time)) invalid();
  return time;
}

function decode(value: string, length: number): Buffer {
  if (typeof value !== 'string') invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) invalid();
  return bytes;
}

/** A fixed ordered tuple avoids depending on object insertion order for AAD. */
function authenticatedData(
  binding: CustomerZipTicketBinding,
  stored: Pick<EncryptedCustomerZipTicket, 'keyId' | 'issuedAt' | 'expiresAt'>,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      'zhiju.customer_zip.upload_ticket.v1',
      stored.keyId,
      stored.issuedAt,
      stored.expiresAt,
      binding.intakeId,
      binding.creatorId,
      binding.enterpriseId,
      binding.projectId,
      binding.submissionPayloadHash,
      binding.zipBytesSha256,
      binding.declaredByteLength,
      binding.generation,
    ]),
    'utf8',
  );
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'ascii').digest();
}

function publicTicket(
  binding: CustomerZipTicketBinding,
  stored: EncryptedCustomerZipTicket,
  token: string,
): CustomerZipUploadTicket {
  return {
    generation: binding.generation,
    token,
    expiresAt: stored.expiresAt,
    method: 'PUT',
    path: `/api/customer-intakes/${binding.intakeId}/zip`,
    expectedByteLength: binding.declaredByteLength,
    expectedZipBytesSha256: binding.zipBytesSha256,
  };
}

/**
 * Cryptography only: callers must separately revalidate current Human authority
 * and the owning generation/stream facts before issuing, replaying or using a
 * ticket. There is deliberately no automatic renewal or fallback key.
 */
export function createCustomerZipTicketCodec(config: {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}) {
  const keys = new Map<string, Buffer>();
  for (const [id, value] of config.keys) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || value.byteLength !== 32)
      throw new CustomerZipTicketError('DEPENDENCY_UNAVAILABLE');
    keys.set(id, Buffer.from(value));
  }
  const activeKeyId = config.activeKeyId;
  if (!keys.has(activeKeyId)) throw new CustomerZipTicketError('DEPENDENCY_UNAVAILABLE');

  function keyFor(id: string): Buffer {
    const key = keys.get(id);
    if (!key) throw new CustomerZipTicketError('DEPENDENCY_UNAVAILABLE');
    return key;
  }

  function decrypt(
    binding: CustomerZipTicketBinding,
    stored: EncryptedCustomerZipTicket,
    now: Date,
  ): string {
    validateBinding(binding);
    const issued = instant(stored.issuedAt);
    const expires = instant(stored.expiresAt);
    const time = currentTime(now);
    if (expires - issued !== TICKET_LIFETIME_MS || time < issued) invalid();
    if (time >= expires) throw new CustomerZipTicketError('INTEGRATION_ZIP_TICKET_EXPIRED');
    const key = keyFor(stored.keyId);
    const nonce = decode(stored.nonce, 12);
    const tag = decode(stored.authenticationTag, 16);
    const ciphertext = decode(stored.ciphertext, 43);
    if (!HASH_PATTERN.test(stored.tokenDigest)) invalid();
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(authenticatedData(binding, stored));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      invalid();
    }
    try {
      const token = plaintext.toString('ascii');
      if (
        !TOKEN_PATTERN.test(token) ||
        !timingSafeEqual(digest(token), Buffer.from(stored.tokenDigest, 'hex'))
      )
        invalid();
      return token;
    } finally {
      plaintext.fill(0);
    }
  }

  return {
    /** The owner persists this result atomically with the generation and receipt. */
    issue(binding: CustomerZipTicketBinding, now: Date): EncryptedCustomerZipTicket {
      validateBinding(binding);
      const issued = currentTime(now);
      const header = {
        keyId: activeKeyId,
        issuedAt: new Date(issued).toISOString(),
        expiresAt: new Date(issued + TICKET_LIFETIME_MS).toISOString(),
      };
      const token = randomBytes(32).toString('base64url');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keyFor(activeKeyId), nonce);
      cipher.setAAD(authenticatedData(binding, header));
      const ciphertext = Buffer.concat([cipher.update(token, 'ascii'), cipher.final()]);
      return {
        ...header,
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        authenticationTag: cipher.getAuthTag().toString('base64url'),
        tokenDigest: digest(token).toString('hex'),
      };
    },

    /** Replay returns the stored token and expiry without any write or renewal. */
    replay(
      binding: CustomerZipTicketBinding,
      stored: EncryptedCustomerZipTicket,
      now: Date,
    ): CustomerZipUploadTicket {
      return publicTicket(binding, stored, decrypt(binding, stored, now));
    },

    verify(
      binding: CustomerZipTicketBinding,
      stored: EncryptedCustomerZipTicket,
      token: string,
      now: Date,
    ): void {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) invalid();
      const expected = decrypt(binding, stored, now);
      if (!timingSafeEqual(digest(expected), digest(token))) invalid();
    },
  };
}
