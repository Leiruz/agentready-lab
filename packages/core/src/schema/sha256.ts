/**
 * SHA-256 over canonical bytes.
 *
 * Deliberately built on `globalThis.crypto.subtle` and not on `node:crypto`.
 * `packages/core` is runtime-neutral (docs/ARCHITECTURE.md section 4), and
 * WebCrypto is the only digest API present in both Node.js 24 and workerd.
 * `node:crypto` would also be a synchronous API, which would make this
 * function's shape a lie the first time core runs somewhere it is unavailable.
 *
 * The cost is that every caller is async. That is the correct cost: the
 * ruleset digest and the evidence body digest are computed once per scan.
 */

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export async function sha256HexOfUtf8(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/**
 * The `sha256:<hex>` form used by `ruleset.digest` and the evidence digests in
 * `docs/IMPLEMENTATION_SPEC.md` section 13. The prefix is not decoration: it
 * is what lets a later algorithm change be readable in a diff instead of
 * silently producing a same-length string with a different meaning.
 */
export function formatDigest(hex: string): string {
  return `sha256:${hex}`;
}
