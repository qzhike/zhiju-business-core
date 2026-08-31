import { describe, expect, it } from 'vitest';
import { providerResultContainsSensitiveData, sanitizeProviderResult } from './provider-result.js';

describe('ReleasePublication provider result minimization', () => {
  it('redacts sensitive keys and values recursively while retaining safe provider ids', () => {
    const result = sanitizeProviderResult({
      messageId: 'provider-message-801',
      status: 'accepted',
      details: {
        email: 'customer@example.com',
        name: 'Customer Name',
      },
      nested: [{ body: 'original document body' }, { note: 'safe status' }],
      authorization: 'Bearer secret-token',
    });

    expect(result.value).toEqual({
      messageId: 'provider-message-801',
      status: 'accepted',
      details: {
        email: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
        name: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      },
      nested: [
        { body: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' } },
        { note: 'safe status' },
      ],
      authorization: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
    });
    expect(result.redactedPaths).toContain('/details/email');
    expect(result.redactedPaths).toContain('/nested/0/body');
    expect(providerResultContainsSensitiveData(result.value)).toBe(true);
  });

  it('does not alter a provider result containing only safe identifiers', () => {
    const result = sanitizeProviderResult({
      messageId: 'provider-message-801',
      providerStatus: 'delivered',
      attemptNumber: 1,
    });

    expect(result.value).toEqual({
      messageId: 'provider-message-801',
      providerStatus: 'delivered',
      attemptNumber: 1,
    });
    expect(result.redactedPaths).toEqual([]);
    expect(providerResultContainsSensitiveData(result.value)).toBe(false);
  });
});
