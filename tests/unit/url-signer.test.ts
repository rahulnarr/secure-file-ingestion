import { describe, expect, it } from "vitest";
import { UrlSigner } from "../../src/infrastructure/crypto/url-signer.js";

const NOW = 1_700_000_000_000;
const signer = new UrlSigner("unit-test-signing-secret", "http://127.0.0.1:3847");

describe("UrlSigner", () => {
  it("signs fileId + TTL into a URL that verifies", () => {
    const signed = signer.sign("file-1", 60, NOW);

    expect(signed.url).toContain("/download?fileId=file-1");
    expect(
      signer.verify({
        fileId: "file-1",
        expires: String(signed.expiresAt),
        signature: signed.signature,
        nowMs: NOW,
      }),
    ).toEqual({ ok: true, fileId: "file-1", expiresAt: signed.expiresAt });
  });

  it("stays valid across signer instances with the same secret (restart safety)", () => {
    const signed = signer.sign("file-1", 60, NOW);
    const afterRestart = new UrlSigner("unit-test-signing-secret", "http://127.0.0.1:3847");

    expect(
      afterRestart.verify({
        fileId: "file-1",
        expires: String(signed.expiresAt),
        signature: signed.signature,
        nowMs: NOW,
      }).ok,
    ).toBe(true);
  });

  it("rejects expired, tampered, and wrong-secret signatures", () => {
    const signed = signer.sign("file-1", 10, NOW);
    const base = { expires: String(signed.expiresAt), signature: signed.signature };

    expect(signer.verify({ ...base, fileId: "file-1", nowMs: NOW + 20_000 }).ok).toBe(false);
    expect(signer.verify({ ...base, fileId: "other-file", nowMs: NOW }).ok).toBe(false);
    expect(
      signer.verify({ ...base, fileId: "file-1", expires: String(signed.expiresAt + 3600), nowMs: NOW })
        .ok,
    ).toBe(false);

    const otherSecret = new UrlSigner("a-completely-different-secret", "http://127.0.0.1:3847");
    expect(otherSecret.verify({ ...base, fileId: "file-1", nowMs: NOW }).ok).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(signer.verify({ fileId: "f", expires: "abc", signature: "00" }).ok).toBe(false);
    expect(signer.verify({ fileId: "f", expires: "9999999999", signature: "not-hex" }).ok).toBe(
      false,
    );
  });
});
