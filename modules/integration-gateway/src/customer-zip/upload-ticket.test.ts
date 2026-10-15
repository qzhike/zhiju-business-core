import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCustomerZipTicketCodec,
  type CustomerZipTicketBinding,
  type EncryptedCustomerZipTicket,
} from './upload-ticket.js';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const OTHER = '0199e61a-7000-7000-8000-000000000005';
const binding: CustomerZipTicketBinding = {
  intakeId: '0199e61a-7000-7000-8000-000000000001',
  creatorId: '0199e61a-7000-7000-8000-000000000002',
  enterpriseId: '0199e61a-7000-7000-8000-000000000003',
  projectId: '0199e61a-7000-7000-8000-000000000004',
  submissionPayloadHash: 'a'.repeat(64),
  zipBytesSha256: 'b'.repeat(64),
  declaredByteLength: 8192,
  generation: 1,
};

function fixture() {
  const key = randomBytes(32);
  const codec = createCustomerZipTicketCodec({
    activeKeyId: 'ticket-key-1',
    keys: new Map([['ticket-key-1', key]]),
  });
  const stored = codec.issue(binding, NOW);
  return { key, codec, stored };
}

describe('customer ZIP upload ticket encryption', () => {
  it('replays the same 256-bit token, fixed path and original five-minute expiry', () => {
    const { codec, stored } = fixture();
    const first = codec.replay(binding, stored, NOW);
    const replay = codec.replay(binding, stored, new Date(NOW.getTime() + 299_999));
    expect(replay).toEqual(first);
    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first).toMatchObject({
      generation: 1,
      method: 'PUT',
      path: `/api/customer-intakes/${binding.intakeId}/zip`,
      expiresAt: '2026-10-15T10:05:00.000Z',
      expectedByteLength: binding.declaredByteLength,
      expectedZipBytesSha256: binding.zipBytesSha256,
    });
    expect(JSON.stringify(stored)).not.toContain(first.token);
    expect(() => {
      codec.verify(binding, stored, first.token, NOW);
    }).not.toThrow();
  });

  it.each([
    ['intakeId', OTHER],
    ['creatorId', OTHER],
    ['enterpriseId', OTHER],
    ['projectId', OTHER],
    ['submissionPayloadHash', 'c'.repeat(64)],
    ['zipBytesSha256', 'c'.repeat(64)],
    ['declaredByteLength', 8193],
    ['generation', 2],
  ] as const)('authenticates the immutable %s binding', (field, value) => {
    const { codec, stored } = fixture();
    const token = codec.replay(binding, stored, NOW).token;
    const changed = { ...binding, [field]: value };
    expect(() => codec.replay(changed, stored, NOW)).toThrow('INTEGRATION_ZIP_TICKET_INVALID');
    expect(() => {
      codec.verify(changed, stored, token, NOW);
    }).toThrow('INTEGRATION_ZIP_TICKET_INVALID');
  });

  it('rejects another token and a noncanonical token without exposing either value', () => {
    const { codec, stored } = fixture();
    const token = codec.replay(binding, stored, NOW).token;
    for (const candidate of [randomBytes(32).toString('base64url'), `${token}=`, '', 'secret']) {
      expect(() => {
        codec.verify(binding, stored, candidate, NOW);
      }).toThrow(/^INTEGRATION_ZIP_TICKET_INVALID$/);
    }
  });

  it.each(['nonce', 'ciphertext', 'authenticationTag', 'tokenDigest'] as const)(
    'rejects tampering with stored %s',
    (field) => {
      const { codec, stored } = fixture();
      const original = stored[field];
      const changed = `${original.startsWith('a') ? 'b' : 'a'}${original.slice(1)}`;
      expect(() => codec.replay(binding, { ...stored, [field]: changed }, NOW)).toThrow(
        'INTEGRATION_ZIP_TICKET_INVALID',
      );
    },
  );

  it('authenticates the complete expiry window and prevents expiry extension', () => {
    const { codec, stored } = fixture();
    const changed: EncryptedCustomerZipTicket = {
      ...stored,
      issuedAt: '2026-10-15T10:01:00.000Z',
      expiresAt: '2026-10-15T10:06:00.000Z',
    };
    expect(() => codec.replay(binding, changed, new Date(changed.issuedAt))).toThrow(
      'INTEGRATION_ZIP_TICKET_INVALID',
    );
    expect(() => codec.replay(binding, { ...stored, expiresAt: changed.expiresAt }, NOW)).toThrow(
      'INTEGRATION_ZIP_TICKET_INVALID',
    );
  });

  it('rejects at the exact expiry boundary without issuing a replacement', () => {
    const { codec, stored } = fixture();
    const token = codec.replay(binding, stored, NOW).token;
    const snapshot = structuredClone(stored);
    const expiry = new Date(stored.expiresAt);
    expect(() => codec.replay(binding, stored, expiry)).toThrow('INTEGRATION_ZIP_TICKET_EXPIRED');
    expect(() => {
      codec.verify(binding, stored, token, expiry);
    }).toThrow('INTEGRATION_ZIP_TICKET_EXPIRED');
    expect(stored).toEqual(snapshot);
    expect(() => codec.replay(binding, stored, new Date(NOW.getTime() - 1))).toThrow(
      'INTEGRATION_ZIP_TICKET_INVALID',
    );
  });

  it('recovers after process restart and explicit key rotation, without re-encryption', () => {
    const { codec, stored, key } = fixture();
    const expected = codec.replay(binding, stored, NOW);
    const restarted = createCustomerZipTicketCodec({
      activeKeyId: 'ticket-key-2',
      keys: new Map([
        ['ticket-key-1', key],
        ['ticket-key-2', randomBytes(32)],
      ]),
    });
    expect(restarted.replay(binding, structuredClone(stored), NOW)).toEqual(expected);
    const unavailable = createCustomerZipTicketCodec({
      activeKeyId: 'ticket-key-2',
      keys: new Map([['ticket-key-2', randomBytes(32)]]),
    });
    expect(() => unavailable.replay(binding, stored, NOW)).toThrow('DEPENDENCY_UNAVAILABLE');
  });

  it('does not retain mutable caller key buffers or maps', () => {
    const key = randomBytes(32);
    const keys = new Map([['key', key]]);
    const codec = createCustomerZipTicketCodec({ activeKeyId: 'key', keys });
    const stored = codec.issue(binding, NOW);
    const original = codec.replay(binding, stored, NOW);
    key.fill(0);
    keys.clear();
    expect(codec.replay(binding, stored, NOW)).toEqual(original);
  });

  it('rejects missing or invalid key configuration', () => {
    for (const keys of [new Map<string, Uint8Array>(), new Map([['key', randomBytes(31)]])]) {
      expect(() => createCustomerZipTicketCodec({ activeKeyId: 'key', keys })).toThrow(
        'DEPENDENCY_UNAVAILABLE',
      );
    }
  });

  it.each([
    { generation: 3 },
    { declaredByteLength: 0 },
    { declaredByteLength: 100 * 1024 * 1024 + 1 },
    { declaredByteLength: 1.5 },
    { intakeId: '../another-intake' },
    { submissionPayloadHash: '' },
    { unexpected: true },
  ])('rejects malformed or out-of-policy owning binding %j', (patch) => {
    const { codec } = fixture();
    const malformed = { ...binding, ...patch } as CustomerZipTicketBinding;
    expect(() => codec.issue(malformed, NOW)).toThrow('INTEGRATION_ZIP_TICKET_INVALID');
  });
});
