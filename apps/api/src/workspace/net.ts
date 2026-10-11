// IM-UI-01 (#258): the Core-side transport peer gate. Session Delta §1/§2 make
// the Core workspace entry reachable *only* from a fixed BFF technical peer:
// the Browser can neither choose its upstream nor present a "verified" hint,
// so the connection peer is checked against the deployment's closed
// `apiGatewayPeers` list (exact IPv4/IPv6 address or CIDR block) before any
// token is parsed.
//
// The same parser validates the peer list at configuration load time, so an
// entry that can never match a real socket address is rejected at startup
// rather than silently ignored at request time.

/** One parsed peer specification: a family, an address and a prefix length. */
export interface PeerSpec {
  readonly family: 4 | 6;
  readonly value: bigint;
  readonly prefix: number;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/u;

function ipv4ToBigInt(text: string): bigint | undefined {
  const match = IPV4_PATTERN.exec(text);
  if (match === null) return undefined;
  let value = 0n;
  for (let index = 1; index <= 4; index += 1) {
    const part = match[index];
    if (part === undefined) return undefined;
    if (part.length > 1 && part.startsWith('0')) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function groupsToBigInt(groups: readonly number[]): bigint {
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

function parseIpv6Groups(text: string): number[] | undefined {
  const groups: number[] = [];
  for (const part of text.split(':')) {
    if (!IPV6_GROUP_PATTERN.test(part)) return undefined;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

function parseIpv6(text: string): bigint | undefined {
  let input = text;
  // A trailing dotted quad is the embedded-IPv4 notation of the last two groups.
  const lastColon = input.lastIndexOf(':');
  if (lastColon !== -1 && input.slice(lastColon + 1).includes('.')) {
    const embedded = ipv4ToBigInt(input.slice(lastColon + 1));
    if (embedded === undefined) return undefined;
    const high = ((embedded >> 16n) & 0xffffn).toString(16);
    const low = (embedded & 0xffffn).toString(16);
    input = `${input.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return undefined;
  const [head, tail] = halves;
  if (head === undefined) return undefined;
  if (tail === undefined) {
    const groups = parseIpv6Groups(head);
    if (groups?.length !== 8) return undefined;
    return groupsToBigInt(groups);
  }
  const leading = head.length === 0 ? [] : parseIpv6Groups(head);
  const trailing = tail.length === 0 ? [] : parseIpv6Groups(tail);
  if (leading === undefined || trailing === undefined) return undefined;
  const elided = 8 - leading.length - trailing.length;
  if (elided < 1) return undefined;
  return groupsToBigInt([...leading, ...new Array<number>(elided).fill(0), ...trailing]);
}

function ipv4ToString(value: bigint): string {
  const octets: number[] = [];
  for (let shift = 24n; shift >= 0n; shift -= 8n) octets.push(Number((value >> shift) & 0xffn));
  return octets.join('.');
}

/**
 * Canonicalizes a socket address for comparison: zone ids and brackets are
 * dropped, IPv6 is lower-cased and an IPv4-mapped IPv6 address is reduced to
 * its IPv4 spelling so `::ffff:127.0.0.1` matches the `127.0.0.1` peer entry.
 */
export function normalizeRemoteAddress(remoteAddress: string): string {
  let value = remoteAddress.trim().toLowerCase();
  const zoneIndex = value.indexOf('%');
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const packed = parseIpv6(value);
  // The mapped range is the whole `0:0:0:0:0:ffff:0:0/96` block.
  if (packed !== undefined && packed >> 32n === 0xffffn) return ipv4ToString(packed & 0xffffffffn);
  return value;
}

/**
 * Parses one closed peer entry: a bare IP address (which behaves as a full
 * prefix) or a CIDR block. Returns `undefined` for anything else, including a
 * prefix outside the address family's range, so configuration load fails
 * closed instead of accepting an entry that can never match.
 */
export function parsePeerSpec(entry: string): PeerSpec | undefined {
  const parts = entry.split('/');
  if (parts.length > 2) return undefined;
  const [addressPart, prefixPart] = parts;
  if (addressPart === undefined) return undefined;
  const address = normalizeRemoteAddress(addressPart);
  const ipv4 = ipv4ToBigInt(address);
  const bits = ipv4 === undefined ? 128 : 32;
  const value = ipv4 ?? parseIpv6(address);
  if (value === undefined) return undefined;
  let prefix = bits;
  if (prefixPart !== undefined) {
    if (!/^\d{1,3}$/u.test(prefixPart)) return undefined;
    prefix = Number(prefixPart);
    if (prefix > bits) return undefined;
  }
  return { family: ipv4 === undefined ? 6 : 4, value, prefix };
}

/**
 * The Core peer gate: `true` only for a connection address inside the closed
 * `apiGatewayPeers` list. A malformed address, an unparsable entry or a
 * family mismatch is a rejection, never a wildcard.
 */
export function peerAllowed(
  config: Readonly<{ apiGatewayPeers: readonly string[] }>,
  remoteAddress: string,
): boolean {
  if (remoteAddress.length === 0) return false;
  const remote = normalizeRemoteAddress(remoteAddress);
  const ipv4 = ipv4ToBigInt(remote);
  const remoteValue = ipv4 ?? parseIpv6(remote);
  if (remoteValue === undefined) return false;
  const remoteFamily = ipv4 === undefined ? 6 : 4;
  for (const entry of config.apiGatewayPeers) {
    const spec = parsePeerSpec(entry);
    if (spec?.family !== remoteFamily) continue;
    const bits = BigInt(spec.family === 4 ? 32 : 128);
    if (spec.prefix === 0) return true;
    const shift = bits - BigInt(spec.prefix);
    if (remoteValue >> shift === spec.value >> shift) return true;
  }
  return false;
}
