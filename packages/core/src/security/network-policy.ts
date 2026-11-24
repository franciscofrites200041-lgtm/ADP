import { isIP } from "node:net";

/**
 * SSRF policy (§8/S5): which destinations a user-supplied URL may never reach.
 *
 * Pure on purpose. Resolving names is infrastructure and lives in
 * `packages/adapters`; deciding that `127.0.0.1` or `169.254.169.254` is
 * off-limits is domain knowledge, so it is here and it is tested without a
 * network. The guard is applied to every address a name resolves to, not just
 * to the name itself, which is what makes DNS rebinding useless.
 */

export type ForbiddenReason =
  | "not_an_ip"
  | "unresolvable"
  | "loopback"
  | "private"
  | "link_local"
  | "carrier_grade_nat"
  | "metadata"
  | "unspecified"
  | "multicast"
  | "reserved";

/** 169.254.169.254 is the instance metadata service on AWS, GCP and Azure. */
const METADATA_ADDRESSES = new Set(["169.254.169.254", "169.254.170.2"]);

/** The eight 16-bit groups of an expanded IPv6 address. */
type Ipv6Groups = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function parseOctet(part: string | undefined): number | null {
  if (part === undefined) return null;
  // "01" and " 1" parse differently across resolvers; refuse anything odd.
  if (!/^\d{1,3}$/.test(part)) return null;
  const value = Number(part);
  return value >= 0 && value <= 255 ? value : null;
}

function ipv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const a = parseOctet(parts[0]);
  const b = parseOctet(parts[1]);
  const c = parseOctet(parts[2]);
  const d = parseOctet(parts[3]);
  if (a === null || b === null || c === null || d === null) return null;
  return [a, b, c, d];
}

/**
 * Wraps a list of groups as the fixed-size tuple the classifier indexes into,
 * or returns null when the count does not make an address.
 */
function toGroups(values: number[]): Ipv6Groups | null {
  if (values.length !== 8) return null;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = values;
  if (
    g0 === undefined ||
    g1 === undefined ||
    g2 === undefined ||
    g3 === undefined ||
    g4 === undefined ||
    g5 === undefined ||
    g6 === undefined ||
    g7 === undefined
  ) {
    return null;
  }
  return [g0, g1, g2, g3, g4, g5, g6, g7];
}

/**
 * Expands an IPv6 literal into eight 16-bit groups, or returns null.
 * Handles `::` compression and a trailing dotted quad (`::ffff:127.0.0.1`).
 */
function ipv6Groups(address: string): Ipv6Groups | null {
  let text = address;

  // A zone index ("fe80::1%eth0") names a local interface, not the target.
  const zoneIndex = text.indexOf("%");
  if (zoneIndex !== -1) text = text.slice(0, zoneIndex);

  const doubleColonCount = text.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (lastColon !== -1 && text.includes(".", lastColon)) {
    const quad = ipv4Octets(text.slice(lastColon + 1));
    if (quad === null) return null;
    const [a, b, c, d] = quad;
    tail = [(a << 8) | b, (c << 8) | d];
    // "::" and a bare ":" both mean an empty prefix; stripping only the
    // trailing colon would leave ":" and lose the embedded address.
    const prefix = text.slice(0, lastColon + 1).replace(/:+$/, "");
    if (prefix === "") return toGroups([0, 0, 0, 0, 0, 0, ...tail]);
    text = prefix;
  }

  const [head = "", rest = ""] = text.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const restGroups = rest === "" ? [] : rest.split(":");

  const parse = (group: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    return Number.parseInt(group, 16);
  };

  // Each group is parsed and checked before it is kept, so the arrays below
  // hold numbers only and no assertion ever lies about it.
  const headValues: number[] = [];
  for (const group of headGroups) {
    const value = parse(group);
    if (value === null) return null;
    headValues.push(value);
  }
  const restValues: number[] = [];
  for (const group of restGroups) {
    const value = parse(group);
    if (value === null) return null;
    restValues.push(value);
  }

  const explicit = [...headValues, ...restValues, ...tail];

  if (doubleColonCount === 0) return toGroups(explicit);

  const missing = 8 - explicit.length;
  if (missing < 0) return null;
  const headLength = headValues.length;
  const expanded = [
    ...explicit.slice(0, headLength),
    ...new Array<number>(missing).fill(0),
    ...explicit.slice(headLength),
  ];
  return toGroups(expanded);
}

/** Returns why an address is off-limits, or null when it may be contacted. */
export function forbiddenReason(address: string): ForbiddenReason | null {
  const version = isIP(address);
  if (version === 0) return "not_an_ip";

  if (version === 4) {
    const octets = ipv4Octets(address);
    if (octets === null) return "not_an_ip";
    const [a, b, c] = octets;

    if (METADATA_ADDRESSES.has(address)) return "metadata";
    if (a === 0) return "unspecified";
    if (a === 10) return "private";
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link_local";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "carrier_grade_nat";
    // 198.18.0.0/15 benchmarking, 192.0.0.0/24 IETF protocol use.
    if (a === 198 && (b === 18 || b === 19)) return "reserved";
    if (a === 192 && b === 0 && c === 0) return "reserved";
    if (a >= 224 && a <= 239) return "multicast";
    if (a >= 240) return "reserved";
    return null;
  }

  const groups = ipv6Groups(address);
  if (groups === null) return "not_an_ip";
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = groups;

  if (groups.every((group) => group === 0)) return "unspecified";
  if (groups.slice(0, 7).every((group) => group === 0) && eighth === 1) {
    return "loopback";
  }

  // Three layouts hide an IPv4 address in the last two groups: IPv4-mapped
  // (::ffff:0:0/96), IPv4-compatible (::/96, deprecated but still routed) and
  // NAT64 (64:ff9b::/96). Looking only at the mapped form leaves
  // ::127.0.0.1 reachable, which is the whole bypass.
  const isMapped =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0xffff;
  const isCompatible =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0;
  // The well-known prefix is exactly /96: groups 2 to 5 must be zero, or the
  // address is some other 64:ff9b space and carries no embedded IPv4.
  const isNat64 =
    first === 0x64 &&
    second === 0xff9b &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0;
  if (isMapped || isCompatible || isNat64) {
    // In all three layouts the embedded IPv4 address occupies the last two groups.
    const high = `${seventh >> 8}.${seventh & 0xff}`;
    const low = `${eighth >> 8}.${eighth & 0xff}`;
    const embedded = `${high}.${low}`;
    if (embedded === "0.0.0.0") return "unspecified";
    return forbiddenReason(embedded);
  }

  if ((first & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
  if ((first & 0xff00) === 0xff00) return "multicast"; // ff00::/8
  return null;
}

export interface AddressPolicyInput {
  /** The literal host as written by the user, when it is already an IP. */
  host: string;
  /** Every address the name resolved to. Empty means resolution failed. */
  resolvedAddresses: readonly string[];
}

/**
 * Accepts only hosts whose every resolved address is publicly routable.
 *
 * An empty resolution is a failure, not a pass: a name we cannot resolve is not
 * a name we can vouch for.
 */
export function checkAddresses(
  input: AddressPolicyInput,
): ForbiddenReason | null {
  if (isIP(input.host) !== 0) return forbiddenReason(input.host);
  if (input.resolvedAddresses.length === 0) return "unresolvable";

  for (const address of input.resolvedAddresses) {
    const reason = forbiddenReason(address);
    if (reason !== null) return reason;
  }
  return null;
}
