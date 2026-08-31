import { describe, expect, it } from 'vitest';
import { providerResultContainsSensitiveData, sanitizeProviderResult } from './provider-result.js';

describe('ReleasePublication provider result minimization', () => {
  it('keeps only allowlisted provider fields and removes nested/custom payloads', () => {
    const input = {
      messageId: 'provider-message-801',
      status: 'accepted',
      details: {
        email: 'customer@example.com',
        name: 'Customer Name',
      },
      nested: [{ body: 'original document body' }, { note: 'safe status' }],
      authorization: 'Bearer secret-token',
      customRecipientData: [{ destination: 'alice@example.com' }],
    } as const;
    const result = sanitizeProviderResult(input);

    expect(result.value).toEqual({
      messageId: 'provider-message-801',
      status: 'accepted',
    });
    expect(result.redactedPaths).toEqual([
      '/details',
      '/nested',
      '/authorization',
      '/customRecipientData',
    ]);
    expect(JSON.stringify(result.value)).not.toContain('customer@example.com');
    expect(JSON.stringify(result.value)).not.toContain('original document body');
    expect(providerResultContainsSensitiveData(input)).toBe(true);
    expect(providerResultContainsSensitiveData(result.value)).toBe(false);
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

  it('rejects unsafe values even when their field name is allowlisted', () => {
    const result = sanitizeProviderResult({
      messageId: 'alice@example.com',
      providerStatus: 'https://provider.example/receipt/1',
      attemptNumber: 1.5,
      retryable: 'yes',
    });

    expect(result.value).toEqual({
      messageId: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      providerStatus: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      attemptNumber: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      retryable: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
    });
    expect(result.redactedPaths).toEqual([
      '/messageId',
      '/providerStatus',
      '/attemptNumber',
      '/retryable',
    ]);
  });

  it('fails closed for non-object provider result roots', () => {
    const marker = { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' };

    expect(sanitizeProviderResult('raw provider body')).toEqual({
      value: marker,
      redactedPaths: [''],
    });
    expect(sanitizeProviderResult([{ messageId: 'safe-id' }, 'raw provider body'])).toEqual({
      value: marker,
      redactedPaths: [''],
    });
  });
});
