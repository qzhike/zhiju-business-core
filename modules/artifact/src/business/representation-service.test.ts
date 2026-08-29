import { describe, expect, it } from 'vitest';
import type { Artifact, IntegrationGateway } from '@zhiju/contracts';
import type { ArtifactTransactionContext } from '../persistence/artifact-db.js';
import {
  ArtifactBusinessError,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_REPRESENTATION_BINDING_INVALID,
  ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
  ARTIFACT_REPRESENTATION_FORMAT_INVALID,
} from './artifact-business-errors.js';
import { validateRepresentationBinding } from './representation-service.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d291';
const ATTEMPT = '018f22e2-7c15-7b2e-8d86-2de956a9d281';
const RECEIPT = '018f22e2-7c15-7b2e-8d86-2de956a9d295';
const HASH = '11'.repeat(32);
const OUTPUT_HASH = '44'.repeat(32);

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableRegistration = DeepMutable<Artifact.RepresentationRegistration>;
type MutableBinding = DeepMutable<IntegrationGateway.RenderAttemptBindingView>;

function context(): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    principalKind: 'SERVICE',
    actorSnapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d302',
    authorizationDecisionId: '018f22e2-7c15-7b2e-8d86-2de956a9d303',
    authorizationDecisionHash: Buffer.alloc(32, 0x97),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
    policySnapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d305',
  };
}

function hash(digest: string) {
  return { algorithm: 'SHA-256' as const, digest, canonicalizationVersion: '1' as const };
}

function revisionRef() {
  return {
    kind: 'CONTENT_ADDRESSED' as const,
    objectType: 'artifact.artifact_revision',
    objectId: REVISION,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(HASH),
  };
}

function attemptRef() {
  return {
    kind: 'OBJECT' as const,
    objectType: 'integration.render_attempt',
    objectId: ATTEMPT,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function receiptRef() {
  return {
    kind: 'CONTENT_ADDRESSED' as const,
    objectType: 'integration.raw_external_receipt',
    objectId: RECEIPT,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash('55'.repeat(32)),
  };
}

function registration(): Artifact.RepresentationRegistration {
  return {
    revisionRef: revisionRef(),
    format: 'document.pdf',
    mediaType: 'application/pdf',
    objectRef: 'artifact/rendered/document-001.pdf',
    checksum: hash(OUTPUT_HASH),
    rendererId: 'renderer.pdf',
    rendererVersion: '1.0.0',
    renderAttemptRef: attemptRef(),
    createdAt: '2026-08-29T00:00:01Z',
  };
}

function binding(): IntegrationGateway.RenderAttemptBindingView {
  return {
    attemptRef: attemptRef(),
    status: 'SUCCEEDED',
    request: {
      revisionRef: revisionRef(),
      canonicalContentRef: 'artifact/canonical/document-001',
      inputHash: hash(HASH),
      outputFormat: 'document.pdf',
      rendererId: 'renderer.pdf',
      rendererVersion: '1.0.0',
      renderPolicyRef: {
        kind: 'VERSIONED',
        objectType: 'policy.render',
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d293',
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d294',
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      },
      stableIdempotencyKey: 'issue-97-render',
      requestedAt: '2026-08-29T00:00:00Z',
    },
    requestPayloadHash: hash('33'.repeat(32)),
    succeededResult: {
      attemptRef: attemptRef(),
      revisionRef: revisionRef(),
      outputObjectRef: 'artifact/rendered/document-001.pdf',
      outputChecksum: hash(OUTPUT_HASH),
      rendererId: 'renderer.pdf',
      rendererVersion: '1.0.0',
      rawReceiptRef: receiptRef(),
    },
    rawReceiptRef: receiptRef(),
  };
}

function expectBusinessError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactBusinessError);
    expect((error as ArtifactBusinessError).code).toBe(code);
  }
}

describe('Artifact WI-08 Representation binding validation', () => {
  it('accepts a complete public successful binding and preserves exact facts', () => {
    const result = validateRepresentationBinding(registration(), binding(), context());

    expect(result.format).toBe('document.pdf');
    expect(result.mediaType).toBe('application/pdf');
    expect(result.inputHash.digest).toBe(HASH);
    expect(result.checksum.digest).toBe(OUTPUT_HASH);
    expect(result.rawReceiptRef.objectId).toBe(RECEIPT);
  });

  it('rejects every caller substitution against the authoritative binding', () => {
    const cases: {
      readonly label: string;
      readonly mutate: (registration: MutableRegistration, binding: MutableBinding) => void;
      readonly code?: string;
    }[] = [
      {
        label: 'revision hash',
        mutate: (candidate) => {
          candidate.revisionRef.contentHash.digest = '22'.repeat(32);
        },
      },
      {
        label: 'input hash',
        mutate: (_candidate, authoritative) => {
          authoritative.request.inputHash.digest = '22'.repeat(32);
        },
      },
      {
        label: 'format',
        mutate: (candidate) => {
          candidate.format = 'document.docx';
          candidate.mediaType =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        },
      },
      {
        label: 'renderer ID',
        mutate: (candidate) => {
          candidate.rendererId = 'renderer.foreign';
        },
      },
      {
        label: 'renderer version',
        mutate: (candidate) => {
          candidate.rendererVersion = '2.0.0';
        },
      },
      {
        label: 'output locator',
        mutate: (candidate) => {
          candidate.objectRef = 'artifact/rendered/substituted.pdf';
        },
      },
      {
        label: 'output checksum',
        mutate: (candidate) => {
          candidate.checksum.digest = '66'.repeat(32);
        },
      },
      {
        label: 'attempt',
        mutate: (candidate) => {
          candidate.renderAttemptRef.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d282';
        },
      },
      {
        label: 'raw receipt',
        mutate: (_candidate, authoritative) => {
          if (authoritative.rawReceiptRef === undefined) throw new Error('missing fixture receipt');
          authoritative.rawReceiptRef.contentHash.digest = '77'.repeat(32);
        },
      },
      {
        label: 'created before request',
        mutate: (candidate) => {
          candidate.createdAt = '2026-08-28T23:59:59Z';
        },
      },
    ];

    for (const testCase of cases) {
      const candidate = structuredClone(registration()) as MutableRegistration;
      const authoritative = structuredClone(binding()) as MutableBinding;
      testCase.mutate(candidate, authoritative);
      expectBusinessError(
        () => validateRepresentationBinding(candidate, authoritative, context()),
        testCase.code ?? ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
      );
    }
  });

  it('rejects failed, unknown, contract-invalid and cross-project bindings', () => {
    for (const status of ['FAILED', 'UNKNOWN', 'CANCELLED', 'QUARANTINED'] as const) {
      const candidate = structuredClone(binding()) as MutableBinding;
      candidate.status = status;
      delete candidate.succeededResult;
      expectBusinessError(
        () => validateRepresentationBinding(registration(), candidate, context()),
        ARTIFACT_REPRESENTATION_BINDING_INVALID,
      );
    }

    const incomplete = structuredClone(binding()) as MutableBinding;
    delete incomplete.rawReceiptRef;
    expectBusinessError(
      () => validateRepresentationBinding(registration(), incomplete, context()),
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
    );

    const wrongReceiptType = structuredClone(binding()) as MutableBinding;
    if (wrongReceiptType.rawReceiptRef === undefined) throw new Error('missing fixture receipt');
    if (wrongReceiptType.succeededResult === undefined) throw new Error('missing fixture result');
    wrongReceiptType.rawReceiptRef.objectType = 'integration.unrelated_receipt';
    wrongReceiptType.succeededResult.rawReceiptRef.objectType = 'integration.unrelated_receipt';
    expectBusinessError(
      () => validateRepresentationBinding(registration(), wrongReceiptType, context()),
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
    );

    const crossProject = structuredClone(binding()) as MutableBinding;
    crossProject.attemptRef.scope.projectId = OTHER_PROJECT;
    expectBusinessError(
      () => validateRepresentationBinding(registration(), crossProject, context()),
      ARTIFACT_QUERY_NOT_FOUND,
    );
  });

  it('fails closed for unknown format families or mismatched media types', () => {
    const unknown = structuredClone(registration()) as MutableRegistration;
    unknown.format = 'document.odt';
    unknown.mediaType = 'application/vnd.oasis.opendocument.text';
    expectBusinessError(
      () => validateRepresentationBinding(unknown, binding(), context()),
      ARTIFACT_REPRESENTATION_FORMAT_INVALID,
    );

    const wrongMedia = structuredClone(registration()) as MutableRegistration;
    wrongMedia.mediaType = 'application/octet-stream';
    expectBusinessError(
      () => validateRepresentationBinding(wrongMedia, binding(), context()),
      ARTIFACT_REPRESENTATION_FORMAT_INVALID,
    );

    const uppercaseRevisionType = structuredClone(registration()) as MutableRegistration;
    uppercaseRevisionType.revisionRef.objectType = 'ArtifactRevision';
    expectBusinessError(
      () => validateRepresentationBinding(uppercaseRevisionType, binding(), context()),
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
    );
  });
});
