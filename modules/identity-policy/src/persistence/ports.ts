// IM-02 WI-05 (issue #33): explicit ports for keyed lookup hashes and field
// encryption. Production uses OpenBao Transit (IM-DG decision); until it is
// wired, only test implementations exist and the integration status stays
// NOT RUN. A test double must never be presented as a production crypto
// acceptance.

export interface KeyedLookupHash {
  readonly hash: Buffer;
  readonly algorithm: 'HMAC-SHA-256';
  readonly keyVersion: number;
}

/**
 * Computes the keyed lookup hash for a normalized external identifier
 * (provider/account/subject). Raw identifiers never leave the caller through
 * this port — only keyed hashes are persisted or logged.
 */
export interface LookupHashPort {
  computeKeyedLookupHash(normalizedInput: string): KeyedLookupHash;
}

export interface EncryptedField {
  readonly ciphertext: Buffer;
  readonly algorithm: 'AES-256-GCM';
  readonly keyVersion: number;
}

/**
 * Envelope-style field encryption for external identifiers that must be
 * recoverable (e.g. to call back to the provider). Key material lives in the
 * secret manager behind the port, never in the database or in logs.
 */
export interface FieldEncryptionPort {
  encryptField(plainText: string): EncryptedField;
  decryptField(field: EncryptedField): string;
}

export interface IdentityCryptoPorts {
  readonly lookupHash: LookupHashPort;
  readonly fieldEncryption: FieldEncryptionPort;
}
