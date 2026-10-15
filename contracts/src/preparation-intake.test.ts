import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { ContractRegistry } from './registry.js';
import { preparationHash } from './preparation-transport.js';
const registry = new ContractRegistry();
const scope = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
const object = (objectType: string) => ({
  kind: 'OBJECT',
  objectType,
  objectId: newUuidV7(),
  scope,
});
function accepted() {
  const intakeRef = object('zhiju.integration.customer_zip_intake');
  return {
    intakeRef,
    originalCommandId: newUuidV7(),
    originalKey: `integration.request_customer_zip_intake:1.0:${intakeRef.objectId}`,
    payloadHash: preparationHash({ original: true }),
    receiptRef: object('zhiju.integration.command_receipt'),
    disposition: 'ACCEPTED',
    analysis: { status: 'WAITING_INPUT' },
    upload: {
      generation: 1,
      token: 'a'.repeat(43),
      expiresAt: '2026-10-15T10:00:00Z',
      method: 'PUT',
      path: `/api/customer-intakes/${intakeRef.objectId}/zip`,
      expectedByteLength: 10,
      expectedZipBytesSha256: 'ab'.repeat(32),
    },
  };
}
const valid = (value: unknown) =>
  registry.validateOperationResult('integration.request_customer_zip_intake', '1.0', value).valid;
describe('customer ZIP named result references', () => {
  it('accepts the owning intake/receipt and requires an upload on first acceptance', () => {
    const result = accepted();
    expect(valid(result)).toBe(true);
    const { upload, ...withoutUpload } = result;
    void upload;
    expect(valid(withoutUpload)).toBe(false);
    expect(valid({ ...withoutUpload, disposition: 'IDEMPOTENT_REPLAY' })).toBe(true);
  });
  it.each(['intakeRef', 'receiptRef'] as const)(
    'rejects an unrelated type or missing Project Scope in %s',
    (key) => {
      const result = accepted();
      expect(valid({ ...result, [key]: object('identity.principal') })).toBe(false);
      expect(valid({ ...result, [key]: { ...result[key], scope: {} } })).toBe(false);
    },
  );
});
