// IM-UI-01 (#258): the internal IdentityPolicy identity bridge of the workspace
// trusted-Human entry. This module owns field-level `AuthenticationContext`
// canonicalization and the controlled `resolveVerifiedHuman` Port of
// Module-Spec-001 §"Workspace 可信 Human 入口与目录授权提案（#258）" and the
// Session Delta §2.
//
// It is an internal Port, not a registered operation: it never enters the
// Contract Catalog and it does not widen `identity.authorize_command@1.0`. The
// only construction path is a `VerifiedOidcContext` produced by the trusted
// Core token verifier under the fixed issuer/audience/client/TLS peer; raw
// tokens, subjects and Cookies never enter this module. Subject stability uses
// the existing keyed lookup port only — an email, a display name, a realm role,
// a Browser PrincipalRef or an acting-for value is never an identity key.
//
// `resolveVerifiedHuman` only *reads* the current mapping. It never registers a
// Principal, links an identity, assigns a Role or issues a Grant (no JIT), and
// it never reveals whether a mapping exists, was revoked, conflicts or resolves
// to another Principal: every one of those outcomes is the single safe code
// `IDENTITY_WORKSPACE_HUMAN_NOT_LINKED`. A storage failure is deliberately not
// folded into that code — an unavailable dependency must surface as
// `DEPENDENCY_UNAVAILABLE` rather than being reported as "no identity".

import { sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import {
  IDENTITY_DECISION_INPUT_INVALID,
  SnapshotBoundaryError,
  validateHash,
  type PrincipalKind,
} from './actor-snapshot.js';
import {
  externalIdentityLinkReference,
  principalReference,
  type IdentityCommandDeps,
} from './link-external-identity.js';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';

/** The canonical object type of a committed `AuthenticationContext` summary. */
export const AUTHENTICATION_CONTEXT_OBJECT_TYPE = 'zhiju.identity.authentication_context';

/** The single safe rejection of `resolveVerifiedHuman`. */
export const IDENTITY_WORKSPACE_HUMAN_NOT_LINKED = 'IDENTITY_WORKSPACE_HUMAN_NOT_LINKED';
/** A dependency (storage / crypto) failure is never reported as "no identity". */
const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

const SESSION_BINDING_BYTES = 32;
const HTTP_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type WorkspaceHumanIdentityErrorCode =
  typeof IDENTITY_WORKSPACE_HUMAN_NOT_LINKED | typeof DEPENDENCY_UNAVAILABLE;

/**
 * The stable, safe failure of this Port. `code` is the only thing a transport
 * may branch on; the message never carries an external identifier, a Principal
 * ref or a reason that would disclose whether another mapping exists.
 */
export class WorkspaceHumanIdentityError extends Error {
  readonly code: WorkspaceHumanIdentityErrorCode;

  constructor(code: WorkspaceHumanIdentityErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceHumanIdentityError';
    this.code = code;
  }
}

/**
 * The field-level verified OIDC context. Only the trusted Core verifier can
 * construct it; every field is produced by that verifier and a Browser cannot
 * choose the issuer, client, audience, algorithms or session binding.
 */
export interface VerifiedOidcContextInput {
  /** SHA-256 hex of the raw trust-config bytes deployed to Core and BFF. */
  readonly trustConfigHash: string;
  /** The verifier's hash of the resolved issuer configuration. */
  readonly issuerConfigHash: string;
  /** The registered Keycloak provider code. */
  readonly providerCode: string;
  /** The fixed issuer string of the realm (`verified iss`). */
  readonly issuer: string;
  /** The registered account external identifier (`verified iss`). */
  readonly accountExternalId: string;
  /** The external subject (`verified sub`). */
  readonly subjectExternalId: string;
  readonly clientId: string;
  readonly apiAudience: string;
  readonly azp: string;
  /** Digest of the actual access token; never an authorization credential. */
  readonly tokenSha256: Buffer;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly validatedAt: Date;
  /** Random per-login BFF session binding, at least 32 bytes. */
  readonly sessionBindingHash: Buffer;
  readonly authTime?: Date | undefined;
  /** Keyed lookup hash of the OIDC session id (`sid`) when present. */
  readonly sidHash?: Buffer | undefined;
}

/**
 * The canonical `AuthenticationContext` summary. It carries no raw token,
 * subject, Cookie or secret: only opaque hashes and instants, with instants
 * serialized as ISO strings so the canonical hash is stable across calls.
 */
export interface AuthenticationContextSummary {
  readonly trustConfigHash: string;
  readonly issuerConfigHash: string;
  readonly subjectLookupHash: string;
  readonly clientId: string;
  readonly apiAudience: string;
  readonly tokenSha256: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly validatedAt: string;
  readonly sessionBindingHash: string;
  readonly authTime?: string | undefined;
  readonly sidLookupHash?: string | undefined;
}

export interface AuthenticationContextHashResult {
  readonly summary: AuthenticationContextSummary;
  /** SHA-256 (32 bytes) of the canonical summary. */
  readonly authenticationContextHash: Buffer;
}

/** Enforces the `sessionBindingHash` shape: exactly 32 bytes of randomness. */
export function assertSessionBindingHash(value: Buffer): void {
  if (value.length !== SESSION_BINDING_BYTES) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      `session binding hash must be ${SESSION_BINDING_BYTES} bytes`,
    );
  }
}

function isoInstant(value: Date, field: string): string {
  if (!Number.isFinite(value.getTime())) {
    throw new SnapshotBoundaryError(IDENTITY_DECISION_INPUT_INVALID, `${field} must be an instant`);
  }
  return value.toISOString();
}

/**
 * The keyed subject lookup of the verified context. The normalization matches
 * `link-external-identity.ts` exactly (`providerCode:subjectExternalId`, both
 * trimmed and lowercased) so the same mapping is found at bootstrap and at
 * link time; raw identifiers stay inside the crypto port.
 */
function subjectLookupHash(input: VerifiedOidcContextInput, crypto: IdentityCryptoPorts): string {
  const providerCode = input.providerCode.trim().toLowerCase();
  const subjectExternalId = input.subjectExternalId.trim().toLowerCase();
  return crypto.lookupHash
    .computeKeyedLookupHash(`${providerCode}:${subjectExternalId}`)
    .hash.toString('hex');
}

/**
 * The canonical `AuthenticationContext` summary. Optional members are omitted
 * entirely when absent (never serialized as `null`) so presence and absence
 * hash to different digests.
 */
export function authenticationContextSummary(
  input: VerifiedOidcContextInput,
  crypto: IdentityCryptoPorts,
): AuthenticationContextSummary {
  if (!HTTP_SHA256_HEX_PATTERN.test(input.trustConfigHash)) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'trust config hash must be a 64-character hex digest',
    );
  }
  if (input.issuerConfigHash.length === 0) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'issuer config hash must be a non-empty string',
    );
  }
  validateHash(input.tokenSha256, IDENTITY_DECISION_INPUT_INVALID, 'token digest');
  assertSessionBindingHash(input.sessionBindingHash);
  if (input.sidHash !== undefined) {
    validateHash(input.sidHash, IDENTITY_DECISION_INPUT_INVALID, 'sid lookup hash');
  }
  const summary: {
    trustConfigHash: string;
    issuerConfigHash: string;
    subjectLookupHash: string;
    clientId: string;
    apiAudience: string;
    tokenSha256: string;
    issuedAt: string;
    expiresAt: string;
    validatedAt: string;
    sessionBindingHash: string;
    authTime?: string;
    sidLookupHash?: string;
  } = {
    trustConfigHash: input.trustConfigHash,
    issuerConfigHash: input.issuerConfigHash,
    subjectLookupHash: subjectLookupHash(input, crypto),
    clientId: input.clientId,
    apiAudience: input.apiAudience,
    tokenSha256: input.tokenSha256.toString('hex'),
    issuedAt: isoInstant(input.issuedAt, 'issuedAt'),
    expiresAt: isoInstant(input.expiresAt, 'expiresAt'),
    validatedAt: isoInstant(input.validatedAt, 'validatedAt'),
    sessionBindingHash: input.sessionBindingHash.toString('hex'),
    ...(input.authTime === undefined ? {} : { authTime: isoInstant(input.authTime, 'authTime') }),
    ...(input.sidHash === undefined ? {} : { sidLookupHash: input.sidHash.toString('hex') }),
  };
  return summary;
}

/**
 * `cv1` hash of the canonical summary, plus that summary. The trusted Core
 * transport builds any `authenticationContextRef` from the 32-byte hash; this
 * module deliberately returns only the hash and the summary so no caller can
 * invent a ref identity the summary does not cover.
 */
export function authenticationContextHash(
  input: VerifiedOidcContextInput,
  crypto: IdentityCryptoPorts,
): AuthenticationContextHashResult {
  const summary = authenticationContextSummary(input, crypto);
  return {
    summary,
    authenticationContextHash: Buffer.from(
      sha256CanonicalJson(summary as unknown as CanonicalJsonObject),
      'hex',
    ),
  };
}

/** The verified Human identity bridge result of §258. */
export interface VerifiedHumanResolution {
  readonly principalRef: Common.ObjectRef;
  readonly resolvedByLinkRef: Common.ObjectRef;
  readonly principalKind: PrincipalKind;
  readonly status: 'ACTIVE';
  readonly displayName: string;
  /** The canonical `AuthenticationContext` hash of this exact request. */
  readonly authenticationContextHash: Buffer;
}

/**
 * Resolves the current ACTIVE HUMAN Principal behind a verified OIDC context.
 * The context must be an ACTIVE link whose Principal is ACTIVE and `HUMAN`;
 * any other outcome (missing, revoked, conflicting, non-HUMAN, non-ACTIVE or
 * another Principal) is the single safe rejection so no other Principal is
 * disclosed. A storage failure is not folded into that rejection.
 */
export async function resolveVerifiedHuman(
  deps: IdentityCommandDeps,
  input: VerifiedOidcContextInput,
): Promise<VerifiedHumanResolution> {
  assertSessionBindingHash(input.sessionBindingHash);
  const { authenticationContextHash: contextHash } = authenticationContextHash(input, deps.crypto);

  return withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const link = await deps.repo.findExternalIdentityLinkByLookup(
      trx,
      input.providerCode,
      input.accountExternalId,
      input.subjectExternalId,
    );
    if (link?.status !== 'ACTIVE') {
      throw new WorkspaceHumanIdentityError(
        IDENTITY_WORKSPACE_HUMAN_NOT_LINKED,
        'verified identity is not a current active link',
      );
    }
    const principal = await deps.repo.getPrincipalById(trx, link.principalId);
    if (principal?.status !== 'ACTIVE' || principal.principal_kind !== 'HUMAN') {
      throw new WorkspaceHumanIdentityError(
        IDENTITY_WORKSPACE_HUMAN_NOT_LINKED,
        'verified identity is not a current active human principal',
      );
    }
    return {
      principalRef: principalReference(principal.id, deps.context.enterpriseId),
      resolvedByLinkRef: externalIdentityLinkReference(link.id, deps.context.enterpriseId),
      principalKind: principal.principal_kind,
      status: 'ACTIVE' as const,
      displayName: principal.display_name,
      authenticationContextHash: contextHash,
    };
  }).catch((error: unknown) => {
    if (error instanceof WorkspaceHumanIdentityError) throw error;
    // A storage/crypto dependency failure must never be mistaken for "no
    // identity": the caller maps it to DEPENDENCY_UNAVAILABLE, not to 403.
    throw new WorkspaceHumanIdentityError(
      DEPENDENCY_UNAVAILABLE,
      'identity dependency unavailable during verified-human resolution',
    );
  });
}
