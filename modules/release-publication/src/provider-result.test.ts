import { describe, expect, it } from 'vitest';

import {
  createProviderResultFromAdapter,
  providerResultContainsSensitiveData,
  sanitizeProviderResult,
  type ProviderResultAdapterExtraction,
} from './provider-result.js';

const REDACTED_VALUE = { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' };

describe('ReleasePublication provider result minimization', () => {
  it('keeps closed status fields and removes caller-declared identifiers and nested payloads', () => {
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

    expect(result.value).toEqual({ status: 'ACCEPTED' });
    expect(result.redactedPaths).toEqual([
      '/messageId',
      '/details',
      '/nested',
      '/authorization',
      '/customRecipientData',
    ]);
    expect(JSON.stringify(result.value)).not.toContain('provider-message-801');
    expect(JSON.stringify(result.value)).not.toContain('customer@example.com');
    expect(JSON.stringify(result.value)).not.toContain('original document body');
    expect(providerResultContainsSensitiveData(input)).toBe(true);
    expect(providerResultContainsSensitiveData(result.value)).toBe(false);
  });

  it('rejects the direct allowlisted-key counterexample from Issue #23', () => {
    const input = {
      messageId: 'AliceCustomer',
      providerStatus: 'AliceCustomer',
      reasonCode: 'BobBuyer',
      status: 'CustomerName',
    };
    const result = sanitizeProviderResult(input);

    expect(result.value).toEqual({
      providerStatus: REDACTED_VALUE,
      reasonCode: REDACTED_VALUE,
      status: REDACTED_VALUE,
    });
    expect(result.redactedPaths).toEqual([
      '/messageId',
      '/providerStatus',
      '/reasonCode',
      '/status',
    ]);
    expect(JSON.stringify(result.value)).not.toContain('AliceCustomer');
    expect(JSON.stringify(result.value)).not.toContain('BobBuyer');
    expect(JSON.stringify(result.value)).not.toContain('CustomerName');
  });

  it('does not retain raw identifiers from an untrusted result even when their shape is token-like', () => {
    const result = sanitizeProviderResult({
      deliveryId: 'delivery-801',
      messageId: 'provider-message-801',
      providerAttemptId: 'attempt-801',
      providerMessageId: 'provider-message-801',
      providerRequestId: 'request-801',
      requestId: 'request-801',
      traceId: 'trace-801',
      messageIdHash: 'a'.repeat(64),
      status: 'delivered',
      attemptNumber: 1,
      retryable: false,
    });

    expect(result.value).toEqual({
      status: 'DELIVERED',
      attemptNumber: 1,
      retryable: false,
    });
    expect(result.redactedPaths).toEqual([
      '/deliveryId',
      '/messageId',
      '/providerAttemptId',
      '/providerMessageId',
      '/providerRequestId',
      '/requestId',
      '/traceId',
      '/messageIdHash',
    ]);
    expect(JSON.stringify(result.value)).not.toContain('provider-message-801');
  });

  it('maps a registered Adapter extraction to closed values and field-separated opaque hashes', () => {
    const extraction = {
      adapterCode: 'feishu.channel',
      messageId: 'AliceCustomer',
      providerRequestId: 'request-801',
      providerAttemptId: 'attempt-801',
      status: 'delivered',
      providerStatus: 'delivered',
      outcome: 'success',
      errorCode: 'rate_limited',
      reasonCode: 'delivery_rejected',
      attemptNumber: 1,
      retryable: false,
    };
    const first = createProviderResultFromAdapter(extraction);
    const second = createProviderResultFromAdapter(extraction);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (first.ok) {
      expect(first.value).toMatchObject({
        providerCode: 'feishu.channel',
        status: 'DELIVERED',
        providerStatus: 'DELIVERED',
        outcome: 'SUCCEEDED',
        errorCode: 'RATE_LIMITED',
        reasonCode: 'DELIVERY_REJECTED',
        attemptNumber: 1,
        retryable: false,
      });
      expect(first.value.messageIdHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(first.value.providerRequestIdHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(first.value.providerAttemptIdHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(first.value)).not.toContain('AliceCustomer');
      expect(sanitizeProviderResult(first.value)).toEqual({
        value: first.value,
        redactedPaths: [],
      });
      expect(providerResultContainsSensitiveData(first.value)).toBe(false);
    }
  });

  it('fails closed for an unregistered Adapter and unmapped provider values without echoing raw input', () => {
    expect(
      createProviderResultFromAdapter({
        adapterCode: 'unknown.provider',
        status: 'CustomerName',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'PROVIDER_RESULT_ADAPTER_UNREGISTERED', fieldPath: '/adapterCode' },
    });
    expect(
      createProviderResultFromAdapter({
        adapterCode: 'feishu.channel',
        status: 'CustomerName',
        messageId: 'AliceCustomer',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'PROVIDER_RESULT_FIELD_UNMAPPED', fieldPath: '/status' },
    });
    expect(
      createProviderResultFromAdapter({
        adapterCode: 'feishu.channel',
        messageId: '',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'PROVIDER_RESULT_IDENTIFIER_INVALID', fieldPath: '/messageId' },
    });
    const extraField = {
      adapterCode: 'feishu.channel',
      status: 'DELIVERED',
      'customer@example.com': 'AliceCustomer',
    } as unknown as ProviderResultAdapterExtraction;
    const extraFieldResult = createProviderResultFromAdapter(extraField);
    expect(extraFieldResult).toEqual({
      ok: false,
      error: { code: 'PROVIDER_RESULT_EXTRA_FIELD', fieldPath: '/providerResult' },
    });
    expect(JSON.stringify(extraFieldResult)).not.toContain('customer@example.com');
    expect(JSON.stringify(extraFieldResult)).not.toContain('AliceCustomer');
  });

  it('fails closed for misplaced fields and non-object provider result roots', () => {
    const nested = sanitizeProviderResult({
      status: { value: 'CustomerName' },
      details: [{ messageId: 'AliceCustomer' }],
      messageIdHash: 'AliceCustomer',
    });
    expect(nested.value).toEqual({
      status: REDACTED_VALUE,
    });
    expect(nested.redactedPaths).toEqual(['/status', '/details', '/messageIdHash']);
    expect(JSON.stringify(nested.value)).not.toContain('AliceCustomer');

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
