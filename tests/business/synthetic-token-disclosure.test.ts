import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_COMPACT_JWT_PATTERN } from '../helpers/synthetic-token-disclosure.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function signedToken(kind: 'access' | 'id'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'probe' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://synthetic.invalid',
      sub: 'synthetic-subject',
      aud: kind === 'access' ? 'api' : 'client',
      ...(kind === 'access' ? { typ: 'Bearer' } : { nonce: 'synthetic-nonce' }),
    }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url')}`;
}

describe('synthetic OIDC token disclosure probe', () => {
  it.each([
    ['PKCE challenge', '/authorize?code_challenge=IDF6Hia7VkAClaREe6eyJuVBHEuF-V4ZZjzxlySew4Y'],
    ['state', '/callback?state=opaque_eyJ_state'],
    ['nonce', '/authorize?nonce=opaque_eyJ_nonce'],
    ['opaque cookie', '__Host-zhiju_session=opaque_eyJ_cookie; Secure; HttpOnly'],
  ])('allows a non-token %s containing the old three-character marker', (_name, observed) => {
    expect(observed).toContain('eyJ');
    expect(observed).not.toMatch(SYNTHETIC_COMPACT_JWT_PATTERN);
  });

  for (const kind of ['access', 'id'] as const) {
    const token = signedToken(kind);
    it.each([
      ['plain value', token],
      ['URL', `https://synthetic.invalid/callback?leaked=${encodeURIComponent(token)}`],
      ['JSON', JSON.stringify({ leaked: token })],
      ['cookie', `session=${token}; Secure; HttpOnly`],
      ['embedded value', `prefix${token}suffix`],
    ])(`detects a real signed ${kind} token in a %s`, (_name, observed) => {
      expect(SYNTHETIC_COMPACT_JWT_PATTERN.test(observed)).toBe(true);
    });
  }

  it('also detects an unsigned three-segment token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'synthetic-subject' })).toString('base64url');
    expect(SYNTHETIC_COMPACT_JWT_PATTERN.test(`${header}.${payload}.`)).toBe(true);
  });

  it('remains stable across repeated observations', () => {
    const token = signedToken('access');
    for (let index = 0; index < 3; index += 1) {
      expect(SYNTHETIC_COMPACT_JWT_PATTERN.test(token)).toBe(true);
      expect(SYNTHETIC_COMPACT_JWT_PATTERN.test('opaque_eyJ_value')).toBe(false);
    }
  });
});
