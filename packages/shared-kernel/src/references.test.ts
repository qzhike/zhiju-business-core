import { describe, expect, it } from 'vitest';

import { assertReferenceScope, objectRef, scopeRef } from './references.js';

const enterpriseA = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const enterpriseB = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const projectA = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d204';

describe('typed reference scope', () => {
  it('requires enterprise scope when project scope is present', () => {
    expect(() => scopeRef({ projectId: projectA })).toThrow('enterpriseId');
  });

  it('rejects a cross-enterprise reference', () => {
    const reference = objectRef({
      objectType: 'zhiju.artifact',
      objectId,
      scope: scopeRef({ enterpriseId: enterpriseA, projectId: projectA }),
    });
    expect(() => {
      assertReferenceScope(reference, scopeRef({ enterpriseId: enterpriseB }));
    }).toThrow('REFERENCE_SCOPE_MISMATCH');
  });
});
