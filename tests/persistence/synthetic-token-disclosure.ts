// The synthetic OIDC provider signs compact JSON JWTs whose header starts eyJ.
// Require all three segments: random PKCE/state/cookie values may contain eyJ.
// Keep empty signatures detectable and avoid stateful global/sticky matching.
export const SYNTHETIC_COMPACT_JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;
