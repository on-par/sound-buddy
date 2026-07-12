import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  createPublicKey,
  verify as nodeVerify,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  verifyLicenseKey,
  LICENSE_ISSUER,
  type LicensePayload,
} from "./license-sign";

// The interop core (#109): keys minted in the Worker (Web Crypto) must verify
// byte-for-byte against app/electron/license.ts's crypto path — Node's
// `crypto.verify(null, …)` over the SPKI public key — and against the Worker's
// own verify helper. A throwaway keypair is generated with the SAME code path
// as `scripts/license-keygen.mjs gen` (generateKeyPairSync('ed25519') exported
// as spki/pkcs8 PEM); the real production keypair (H3) is never used in tests.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEYGEN = join(repoRoot, "scripts", "license-keygen.mjs");

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Decode a base64url segment to bytes (test-side mirror of fromBase64Url). */
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodePayload(key: string): LicensePayload {
  return JSON.parse(fromB64url(key.split(".")[1]).toString("utf8"));
}

/**
 * license.ts's exact signature check: Ed25519 verify with a null digest against
 * the SPKI public key, over the transmitted payload bytes. This is what the app
 * runs on launch — a `true` here is the "verifies against license.ts" guarantee.
 */
function verifiesLikeLicenseTs(key: string, spkiPem: string): boolean {
  const [, payloadSeg, sigSeg] = key.split(".");
  return nodeVerify(
    null,
    fromB64url(payloadSeg),
    createPublicKey(spkiPem),
    fromB64url(sigSeg),
  );
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const now = new Date("2026-07-08T00:00:00.000Z");
const future = new Date(now.getTime() + YEAR_MS).toISOString();

describe("worker license signing — SB1 format & interop (#109)", () => {
  it("Scenario: minted subscription key verifies against license.ts logic", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const key = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "k1",
      email: "engineer@example.test",
      expiresAt: future,
      sub: "sub_ABC123",
    });

    // Format: SB1 with exactly three dot-separated parts.
    const parts = key.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("SB1");

    // license.ts crypto path accepts it (byte-for-byte parity).
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);

    // …and license.ts state semantics resolve to Pro / valid.
    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");
    expect(state.kind).toBe("subscription");
    expect(state.email).toBe("engineer@example.test");
  });

  it("Scenario: minted lifetime key never expires", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);
    const verifyKey = await importVerifyKey(spkiPem);

    const key = await mintLicenseKey(signingKey, { kind: "lifetime", kid: "k1" });

    const payload = decodePayload(key);
    expect(payload.kind).toBe("lifetime");
    expect(payload.expiresAt).toBeUndefined();

    // Pro regardless of clock — even a decade out.
    const farFuture = new Date(now.getTime() + 10 * YEAR_MS);
    for (const clock of [now, farFuture]) {
      const state = await verifyLicenseKey(key, verifyKey, clock);
      expect(state.tier).toBe("pro");
      expect(state.status).toBe("valid");
    }
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);
  });

  it("Scenario: base64url has no padding or +/ characters", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    for (const key of [
      await mintLicenseKey(signingKey, {
        kind: "subscription",
        kid: "k1",
        // Padding-prone email + long sub to make un-padded base64 likely.
        email: "someone.with.a.long.address@example.test",
        expiresAt: future,
        sub: "sub_0000000000000000",
      }),
      await mintLicenseKey(signingKey, { kind: "lifetime", kid: "k1" }),
    ]) {
      const [, payloadSeg, sigSeg] = key.split(".");
      for (const seg of [payloadSeg, sigSeg]) {
        expect(seg).not.toContain("=");
        expect(seg).not.toContain("+");
        expect(seg).not.toContain("/");
      }
    }
  });

  it("stamps v2 claims: kid, unique jti, iss (and sub for subscriptions)", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const subKey = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "sign-key-2026-07",
      expiresAt: future,
      sub: "sub_XYZ",
    });
    const subPayload = decodePayload(subKey);
    expect(subPayload.kid).toBe("sign-key-2026-07");
    expect(subPayload.iss).toBe(LICENSE_ISSUER);
    expect(subPayload.sub).toBe("sub_XYZ");
    expect(typeof subPayload.jti).toBe("string");
    expect(subPayload.jti.length).toBeGreaterThan(0);

    // jti is unique per mint.
    const another = decodePayload(
      await mintLicenseKey(signingKey, {
        kind: "subscription",
        kid: "sign-key-2026-07",
        expiresAt: future,
        sub: "sub_XYZ",
      }),
    );
    expect(another.jti).not.toBe(subPayload.jti);

    // Lifetime carries kid/jti/iss but never a sub.
    const lifePayload = decodePayload(
      await mintLicenseKey(signingKey, { kind: "lifetime", kid: "sign-key-2026-07" }),
    );
    expect(lifePayload.kid).toBe("sign-key-2026-07");
    expect(lifePayload.iss).toBe(LICENSE_ISSUER);
    expect(lifePayload.jti.length).toBeGreaterThan(0);
    expect(lifePayload.sub).toBeUndefined();
  });

  it("Scenario: cross-tool parity — keygen `sign` output verifies in the Worker", async () => {
    // A throwaway keypair written to disk, then signed by the REAL dev tool.
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const dir = mkdtempSync(join(tmpdir(), "sb-keygen-"));
    const privPath = join(dir, "license-priv.pem");
    writeFileSync(privPath, pkcs8Pem);

    const keygenKey = execFileSync(
      "node",
      [KEYGEN, "sign", privPath, "--kind", "subscription", "--days", "365"],
      { encoding: "utf8" },
    ).trim();

    expect(keygenKey.startsWith("SB1.")).toBe(true);

    // The Worker's verify helper accepts a key the dev tool produced (v1 payload
    // with no v2 claims — verify stays tolerant of missing fields).
    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(keygenKey, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");
  });

  it("Scenario: cross-tool parity — a Worker-minted key verifies against license.ts logic", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const key = await mintLicenseKey(signingKey, {
      kind: "lifetime",
      kid: "k1",
      email: "buyer@example.test",
    });

    // license.ts crypto path (Node crypto.verify) accepts the Worker's key.
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);
  });

  it("Scenario: tampered payload fails verification", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);
    const verifyKey = await importVerifyKey(spkiPem);

    const key = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "k1",
      expiresAt: future,
      sub: "sub_1",
    });

    // Flip one byte of the payload segment, re-encode, keep the original sig.
    const [prefix, payloadSeg, sigSeg] = key.split(".");
    const bytes = fromB64url(payloadSeg);
    bytes[0] ^= 0x01;
    const tamperedSeg = bytes
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tampered = `${prefix}.${tamperedSeg}.${sigSeg}`;
    expect(tampered).not.toBe(key);

    const state = await verifyLicenseKey(tampered, verifyKey, now);
    expect(state.status).toBe("invalid");
    expect(state.tier).toBe("free");
    // And license.ts's crypto path agrees.
    expect(verifiesLikeLicenseTs(tampered, spkiPem)).toBe(false);
  });

  it("subscription past grace verifies but resolves to expired/free", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);
    const verifyKey = await importVerifyKey(spkiPem);

    const expiresAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const key = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "k1",
      expiresAt,
      sub: "sub_old",
    });

    // Signature is still valid (byte-for-byte) — only the clock lapsed it.
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.status).toBe("expired");
    expect(state.tier).toBe("free");
  });

  it("rejects malformed input without throwing", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const verifyKey = await importVerifyKey(spkiPem);
    // A well-formed key signed by a DIFFERENT keypair must not verify here.
    const otherKey = await mintLicenseKey(await importSigningKey(pkcs8Pem), {
      kind: "lifetime",
      kid: "k1",
    });
    const { spkiPem: strangerSpki } = throwawayKeypair();
    const strangerVerify = await importVerifyKey(strangerSpki);

    for (const [input, key] of [
      ["", verifyKey],
      ["   ", verifyKey],
      ["not-a-key", verifyKey],
      ["SB1.only-two", verifyKey],
      ["SB2.aaa.bbb", verifyKey],
      [otherKey, strangerVerify], // valid format, wrong signer
    ] as const) {
      const state = await verifyLicenseKey(input, key, now);
      expect(state.status, `input=${JSON.stringify(input)}`).toBe("invalid");
      expect(state.tier).toBe("free");
    }
  });

  it("mint rejects contradictory kind/expiry combinations", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    await expect(
      mintLicenseKey(signingKey, { kind: "subscription", kid: "k1" }),
    ).rejects.toThrow(/expiresAt/);

    await expect(
      mintLicenseKey(signingKey, { kind: "lifetime", kid: "k1", expiresAt: future }),
    ).rejects.toThrow(/lifetime/);
  });
});
