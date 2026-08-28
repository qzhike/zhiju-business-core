import { canonicalize, sha256CanonicalJson, type CanonicalJsonValue } from './canonical-json.js';
import { contentHash, type ContentHash } from './references.js';

export type CanonicalContentType = 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';

export interface CanonicalContentPayload<Body extends CanonicalJsonValue = CanonicalJsonValue> {
  readonly schemaRef: CanonicalJsonValue;
  readonly contentType: CanonicalContentType;
  readonly canonicalizationVersion: '1';
  readonly body: Body;
}

function canonicalHashInput<Body extends CanonicalJsonValue>(
  payload: CanonicalContentPayload<Body>,
): CanonicalJsonValue {
  return {
    schemaRef: payload.schemaRef,
    contentType: payload.contentType,
    canonicalizationVersion: payload.canonicalizationVersion,
    body: payload.body,
  };
}

export function canonicalizeCanonicalContentPayload<Body extends CanonicalJsonValue>(
  payload: CanonicalContentPayload<Body>,
): string {
  return canonicalize(canonicalHashInput(payload));
}

export function hashCanonicalContentPayload<Body extends CanonicalJsonValue>(
  payload: CanonicalContentPayload<Body>,
): ContentHash {
  return contentHash(sha256CanonicalJson(canonicalHashInput(payload)));
}
