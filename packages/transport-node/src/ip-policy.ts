/**
 * Address classification, `docs/THREAT_MODEL.md` section 12.1.
 *
 * The classifier runs on a hostname the WHATWG URL parser has already
 * canonicalized. That ordering is the point of section 11: the parser turns
 * `127.1`, `2130706433`, `0x7f000001` and `0177.0.0.1` into the dotted quad
 * `127.0.0.1` before anything here sees them, so this file can parse strictly
 * and treat anything it cannot read unambiguously as "not an address" rather
 * than trying to out-guess a second spelling of the same number.
 *
 * Section 12.1's closing rule is the one that shapes the tables below:
 * "Conservative over-blocking is preferable to treating an unknown range as
 * public." An IPv6 address outside `2000::/3` is therefore `reserved` and not
 * `public`, whatever IANA later does with it.
 */

/**
 * What one address is, from the network policy's point of view.
 *
 * `public` means "definitely public global unicast" and is the only value a
 * public profile may ever accept. Every other member is a denial, and they are
 * distinct so a test can assert which range matched rather than only that
 * something was refused.
 */
export type AddressClass =
  | "loopback"
  | "private"
  | "unique-local"
  | "link-local"
  | "carrier-grade-nat"
  | "unspecified"
  | "multicast"
  | "broadcast"
  | "documentation"
  | "benchmarking"
  | "reserved"
  | "public";

export interface ClassifiedAddress {
  readonly kind: "address";
  readonly family: 4 | 6;
  /** Dotted quad for IPv4; the compressed lowercase form for IPv6. */
  readonly canonical: string;
  readonly addressClass: AddressClass;
  /**
   * Set when an IPv6 address embeds an IPv4 address that the policy has to
   * judge instead: `::ffff:a.b.c.d`, the deprecated `::a.b.c.d`, and the
   * `64:ff9b::/96` NAT64 prefix. `docs/THREAT_MODEL.md` section 12.1 denies
   * "IPv4-mapped or compatible IPv6 that contains a denied IPv4" and "NAT64 or
   * transition forms that can represent a denied IPv4".
   */
  readonly embeddedIpv4: string | undefined;
}

export interface NotAnAddress {
  readonly kind: "not-an-address";
}

export type AddressClassification = ClassifiedAddress | NotAnAddress;

const NOT_AN_ADDRESS: NotAnAddress = { kind: "not-an-address" };

/** Strict dotted quad. No leading zeros, no shorthand, no hex, exactly four parts. */
function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index];
    if (part === undefined) return null;
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

/**
 * IPv6, including the `x:x:x:x:x:x:d.d.d.d` mixed form.
 *
 * A zone identifier is not accepted here and is not stripped: section 12.1
 * denies "IPv6 zone-scoped addresses", and section 11 rejects zone ids at the
 * URL layer, so an address carrying one must not resolve to a classification
 * at all.
 */
function parseIpv6(text: string): Uint8Array | null {
  if (text.includes("%")) return null;
  const doubleColonAt = text.indexOf("::");
  if (doubleColonAt !== text.lastIndexOf("::")) return null;

  const head: string[] = [];
  const tail: string[] = [];
  if (doubleColonAt === -1) {
    head.push(...text.split(":"));
  } else {
    const before = text.slice(0, doubleColonAt);
    const after = text.slice(doubleColonAt + 2);
    if (before !== "") head.push(...before.split(":"));
    if (after !== "") tail.push(...after.split(":"));
  }

  const bytes = new Uint8Array(16);
  let headBytes = 0;
  let tailBytes = 0;

  const writeGroups = (
    groups: readonly string[],
    into: (offset: number, byte: number) => void,
  ): number | null => {
    let written = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group === undefined) return null;
      const isLast = index === groups.length - 1;
      if (isLast && group.includes(".")) {
        const quad = parseIpv4(group);
        if (quad === null) return null;
        for (const byte of quad) into(written++, byte);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      into(written++, value >>> 8);
      into(written++, value & 0xff);
    }
    return written;
  };

  const headWritten = writeGroups(head, (offset, byte) => {
    if (offset < 16) bytes[offset] = byte;
    headBytes = Math.max(headBytes, offset + 1);
  });
  if (headWritten === null) return null;

  const tailScratch = new Uint8Array(16);
  const tailWritten = writeGroups(tail, (offset, byte) => {
    if (offset < 16) tailScratch[offset] = byte;
    tailBytes = Math.max(tailBytes, offset + 1);
  });
  if (tailWritten === null) return null;

  if (doubleColonAt === -1) {
    if (headBytes !== 16) return null;
    return bytes;
  }
  // `::` must stand for at least one omitted group, so a compressed form that
  // already spells out all 16 bytes is malformed rather than merely redundant.
  if (headBytes + tailBytes >= 16) return null;
  for (let index = 0; index < tailBytes; index += 1) {
    bytes[16 - tailBytes + index] = tailScratch[index] ?? 0;
  }
  return bytes;
}

function ipv4Text(bytes: Uint8Array, offset = 0): string {
  return [0, 1, 2, 3].map((index) => bytes[offset + index] ?? 0).join(".");
}

function ipv6Text(bytes: Uint8Array): string {
  const groups: number[] = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }

  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (runStart === -1) runStart = index;
      continue;
    }
    if (runStart !== -1) {
      const length = index - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }

  const text = groups.map((group) => group.toString(16));
  if (bestLength < 2) return text.join(":");
  return `${text.slice(0, bestStart).join(":")}::${text.slice(bestStart + bestLength).join(":")}`;
}

function inIpv4Range(
  bytes: Uint8Array,
  prefix: readonly number[],
  maskBits: number,
): boolean {
  const value =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0);
  const prefixValue =
    ((prefix[0] ?? 0) << 24) |
    ((prefix[1] ?? 0) << 16) |
    ((prefix[2] ?? 0) << 8) |
    (prefix[3] ?? 0);
  const mask = maskBits === 0 ? 0 : (-1 << (32 - maskBits)) >>> 0;
  return ((value ^ prefixValue) & mask) === 0;
}

interface Ipv4Range {
  readonly prefix: readonly number[];
  readonly bits: number;
  readonly addressClass: AddressClass;
}

/**
 * IANA IPv4 Special-Purpose Address Registry, plus the classes section 12.1
 * names explicitly. Ordered most specific first: `192.0.2.0/24` has to be
 * matched as documentation before `192.0.0.0/24`'s neighbours are considered.
 *
 * `docs/THREAT_MODEL.md` section 12.1 asks for "a reviewed, generated snapshot
 * of the IANA IPv4 and IPv6 special-purpose registries". This table is
 * hand-written, not generated, and that gap is real: it is complete enough for
 * the loopback-only profile M1 ships, and M3 is the milestone that owes the
 * generated snapshot and the per-range table-driven cases
 * (`docs/FIXTURE_CATALOG.md` section 13, note under `sec-024`).
 */
const IPV4_RANGES: readonly Ipv4Range[] = [
  { prefix: [0, 0, 0, 0], bits: 8, addressClass: "unspecified" },
  { prefix: [10, 0, 0, 0], bits: 8, addressClass: "private" },
  { prefix: [100, 64, 0, 0], bits: 10, addressClass: "carrier-grade-nat" },
  { prefix: [127, 0, 0, 0], bits: 8, addressClass: "loopback" },
  { prefix: [169, 254, 0, 0], bits: 16, addressClass: "link-local" },
  { prefix: [172, 16, 0, 0], bits: 12, addressClass: "private" },
  { prefix: [192, 0, 0, 0], bits: 24, addressClass: "reserved" },
  { prefix: [192, 0, 2, 0], bits: 24, addressClass: "documentation" },
  { prefix: [192, 88, 99, 0], bits: 24, addressClass: "reserved" },
  { prefix: [192, 168, 0, 0], bits: 16, addressClass: "private" },
  { prefix: [198, 18, 0, 0], bits: 15, addressClass: "benchmarking" },
  { prefix: [198, 51, 100, 0], bits: 24, addressClass: "documentation" },
  { prefix: [203, 0, 113, 0], bits: 24, addressClass: "documentation" },
  { prefix: [224, 0, 0, 0], bits: 4, addressClass: "multicast" },
  { prefix: [255, 255, 255, 255], bits: 32, addressClass: "broadcast" },
  { prefix: [240, 0, 0, 0], bits: 4, addressClass: "reserved" },
];

function classifyIpv4Bytes(bytes: Uint8Array): AddressClass {
  for (const range of IPV4_RANGES) {
    if (inIpv4Range(bytes, range.prefix, range.bits)) return range.addressClass;
  }
  return "public";
}

function group(bytes: Uint8Array, index: number): number {
  return ((bytes[index * 2] ?? 0) << 8) | (bytes[index * 2 + 1] ?? 0);
}

function allZero(bytes: Uint8Array, upToGroup: number): boolean {
  for (let index = 0; index < upToGroup; index += 1) {
    if (group(bytes, index) !== 0) return false;
  }
  return true;
}

interface Ipv6Verdict {
  readonly addressClass: AddressClass;
  readonly embeddedIpv4: string | undefined;
}

function classifyIpv6Bytes(bytes: Uint8Array): Ipv6Verdict {
  const first = group(bytes, 0);

  if (allZero(bytes, 8))
    return { addressClass: "unspecified", embeddedIpv4: undefined };

  const lastGroups = group(bytes, 6) !== 0 || group(bytes, 7) !== 0;
  if (allZero(bytes, 7) && group(bytes, 7) === 1) {
    return { addressClass: "loopback", embeddedIpv4: undefined };
  }

  // `::ffff:a.b.c.d` and the deprecated `::a.b.c.d` both carry an IPv4 the
  // policy must judge instead of the wrapper.
  if (allZero(bytes, 5) && group(bytes, 5) === 0xffff) {
    const embedded = ipv4Text(bytes, 12);
    return {
      addressClass: classifyIpv4Bytes(bytes.subarray(12, 16)),
      embeddedIpv4: embedded,
    };
  }
  if (allZero(bytes, 6) && lastGroups) {
    const embedded = ipv4Text(bytes, 12);
    return {
      addressClass: classifyIpv4Bytes(bytes.subarray(12, 16)),
      embeddedIpv4: embedded,
    };
  }
  // NAT64 `64:ff9b::/96` embeds an IPv4 in its last 32 bits.
  if (
    first === 0x0064 &&
    group(bytes, 1) === 0xff9b &&
    allZero(bytes.subarray(4), 4)
  ) {
    const embedded = ipv4Text(bytes, 12);
    return {
      addressClass: classifyIpv4Bytes(bytes.subarray(12, 16)),
      embeddedIpv4: embedded,
    };
  }

  if ((first & 0xff00) === 0xff00) {
    return { addressClass: "multicast", embeddedIpv4: undefined };
  }
  if ((first & 0xffc0) === 0xfe80) {
    return { addressClass: "link-local", embeddedIpv4: undefined };
  }
  if ((first & 0xfe00) === 0xfc00) {
    return { addressClass: "unique-local", embeddedIpv4: undefined };
  }
  if (first === 0x2001 && group(bytes, 1) === 0x0db8) {
    return { addressClass: "documentation", embeddedIpv4: undefined };
  }
  // `3fff::/20`, the documentation range RFC 9637 added in 2024.
  if (first === 0x3fff && (group(bytes, 1) & 0xf000) === 0) {
    return { addressClass: "documentation", embeddedIpv4: undefined };
  }
  // `2001:2::/48`, benchmarking. Checked before the `2001::/23` rule below,
  // which would otherwise swallow it as an undifferentiated reservation.
  if (first === 0x2001 && group(bytes, 1) === 0x0002) {
    return { addressClass: "benchmarking", embeddedIpv4: undefined };
  }

  // Only `2000::/3` can be global unicast. Everything outside it, including
  // `100::/64` and `5f00::/16`, is refused as reserved because section 12.1
  // prefers over-blocking to guessing.
  if ((first & 0xe000) !== 0x2000) {
    return { addressClass: "reserved", embeddedIpv4: undefined };
  }
  // `2001::/23` IETF protocol assignments, and `2002::/16` 6to4, which can
  // carry a denied IPv4 in bits 16 to 47 and is deprecated by RFC 7526.
  if ((first === 0x2001 && group(bytes, 1) < 0x0200) || first === 0x2002) {
    return { addressClass: "reserved", embeddedIpv4: undefined };
  }
  return { addressClass: "public", embeddedIpv4: undefined };
}

/**
 * Classifies a canonical hostname.
 *
 * `text` may carry the brackets the WHATWG URL serialization puts around an
 * IPv6 literal; they are removed here so callers do not have to remember which
 * of `URL.hostname` and `URL.host` keeps them.
 */
export function classifyAddress(text: string): AddressClassification {
  const bare =
    text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;

  const v4 = parseIpv4(bare);
  if (v4 !== null) {
    return {
      kind: "address",
      family: 4,
      canonical: ipv4Text(v4),
      addressClass: classifyIpv4Bytes(v4),
      embeddedIpv4: undefined,
    };
  }

  const v6 = parseIpv6(bare);
  if (v6 === null) return NOT_AN_ADDRESS;
  const verdict = classifyIpv6Bytes(v6);
  return {
    kind: "address",
    family: 6,
    canonical: ipv6Text(v6),
    addressClass: verdict.addressClass,
    embeddedIpv4: verdict.embeddedIpv4,
  };
}

/** True for every class that is not definitely public global unicast. */
export function isDeniedInPublicProfile(addressClass: AddressClass): boolean {
  return addressClass !== "public";
}

/**
 * Whether two address strings name the same address.
 *
 * Used for the section 12.3 peer check, where the two sides come from
 * different producers: one from the URL, one from `socket.remoteAddress`. A
 * dual-stack listener reports `::ffff:127.0.0.1` for a connection the policy
 * selected as `127.0.0.1`, and `::1` may come back spelled out in full, so
 * string equality on the two raw values would fail closed on a correct
 * connection. Comparing parsed forms, with an IPv4-mapped wrapper resolved to
 * its embedded IPv4, is the comparison that means what the check intends.
 */
export function sameAddress(left: string, right: string): boolean {
  const a = classifyAddress(left);
  const b = classifyAddress(right);
  if (a.kind !== "address" || b.kind !== "address") return false;
  return (a.embeddedIpv4 ?? a.canonical) === (b.embeddedIpv4 ?? b.canonical);
}
