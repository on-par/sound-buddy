import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  createPublicKey,
  verify as nodeVerify,
} from "node:crypto";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  verifyLicenseKey,
} from "./license-sign";

// Pins issue #1156's two acceptance criteria to executable assertions against
// the already-shipped Worker signer (worker/src/license-sign.ts, #109): a
// minted SB1. key verifies byte-for-byte against app/electron/license.ts's
// exact crypto path, and a tampered payload is rejected by both that path and
// the Worker's own verifier. Mirrors the #1155 -> webhook-verify.test.ts
// precedent (commit 25cea07): a colocated acceptance suite for behavior that
// already exists, no production code changes.

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Decode a base64url segment to bytes (test-side mirror of fromBase64Url). */
function fromB64url(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64url-encode raw bytes (test-side mirror of toBase64Url in license-sign.ts). */
function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

describe("SB1 signer acceptance (#1156)", () => {
  it("Scenario: signed key round-trips — starts with SB1. and license.ts verifies it", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const key = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "k1",
      email: "engineer@example.test",
      expiresAt: future,
      sub: "sub_ABC123",
    });

    expect(key.startsWith("SB1.")).toBe(true);
    expect(key.split(".")).toHaveLength(3);

    // license.ts's exact crypto path accepts it (byte-for-byte parity, no
    // network involved).
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);

    // ...and the Worker verifier's state semantics resolve to Pro / valid.
    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");
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
    const tamperedSeg = bytesToB64url(bytes);
    const tampered = `${prefix}.${tamperedSeg}.${sigSeg}`;
    expect(tampered).not.toBe(key);

    // license.ts's exact crypto path rejects the altered payload.
    expect(verifiesLikeLicenseTs(tampered, spkiPem)).toBe(false);

    // ...and the Worker verifier agrees.
    const state = await verifyLicenseKey(tampered, verifyKey, now);
    expect(state.status).toBe("invalid");
    expect(state.tier).toBe("free");
  });
});
