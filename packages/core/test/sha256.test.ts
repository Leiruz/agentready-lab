import { describe, expect, it } from "vitest";

import {
  formatDigest,
  sha256Hex,
  sha256HexOfUtf8,
} from "../src/schema/sha256.js";

// The first three vectors are the published SHA-256 examples: the empty
// string and "abc" from NIST FIPS 180-4 Appendix B.1, and the 448-bit message
// from Appendix B.2. The million-a case from Appendix B.3 is included because
// it is the only one that exercises multi-block streaming, and it is cheap.
describe("SHA-256 published vectors", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("hashes %j", async (input, expected) => {
    await expect(sha256HexOfUtf8(input)).resolves.toBe(expected);
  });

  it("hashes one million 'a' characters", async () => {
    await expect(sha256HexOfUtf8("a".repeat(1_000_000))).resolves.toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("hashes UTF-8 bytes, not UTF-16 code units", async () => {
    // "€" is one UTF-16 code unit and the three bytes e2 82 ac. Hashing the
    // code unit instead would give a different digest, and every ruleset
    // digest containing a non-ASCII character would then be implementation
    // specific.
    await expect(sha256HexOfUtf8("€")).resolves.toBe(
      await sha256Hex(new Uint8Array([0xe2, 0x82, 0xac])),
    );
  });

  it("hashes raw bytes that are not valid UTF-8", async () => {
    // Evidence body digests are taken over wire bytes, which are frequently
    // not text at all, so the byte-taking entry point needs its own vector.
    await expect(sha256Hex(new Uint8Array([0x00, 0xff]))).resolves.toBe(
      "06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8",
    );
  });

  it("zero-pads a byte whose hex is a single digit", async () => {
    // The digest of "39" starts with the byte 0x0b. An unpadded hex
    // conversion would produce a 63-character string here and nowhere else.
    await expect(sha256HexOfUtf8("39")).resolves.toBe(
      "0b918943df0962bc7a1824c0555a389347b4febdc7cf9d1254406d80ce44e3f9",
    );
  });

  it("returns lowercase hex of exactly 64 characters", async () => {
    const hex = await sha256HexOfUtf8("");
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prefixes a digest with its algorithm", () => {
    expect(formatDigest("00".repeat(32))).toBe(`sha256:${"00".repeat(32)}`);
  });
});
