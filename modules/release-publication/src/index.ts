export * from './receipt-validator.js';
export * from './release-publication-runtime.js';

export const releasePublicationModule = Object.freeze({
  name: 'release-publication',
  status: 'RUNTIME_RECEIPT_VALIDATOR' as const,
});
