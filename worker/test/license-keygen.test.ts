// Behavior tests for the dev tool scripts/license-keygen.mjs (#124). The tool
// is the reference signer for #109's cross-tool parity — these cover its two
// local-safety guards (`gen` refuses to spill a private key into a checkout,
// and requires an explicit outdir) and the payload v2 claims (`kid`/`jti`/
// `iss`/`sub`) its `sign` command now stamps. Parity-of-signature with the
// Worker/app crypto lives in license-sign.test.ts; this file drives the CLI.

import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  importVerifyKey,
  verifyLicenseKey,
  LICENSE_ISSUER,
  type LicensePayload,
} from "../src/license-sign";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEYGEN = join(repoRoot, "scripts", "license-keygen.mjs");
const now = new Date("2026-07-08T00:00:00.000Z");

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Decode a minted key's base64url payload segment back to JSON. */
function decodePayload(key: string): LicensePayload {
  const seg = key.split(".")[1];
  const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json) as LicensePayload;
}

/** Write a throwaway private key to a fresh temp dir and return its path. */
function writePriv(pkcs8Pem: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sb-sign-"));
  const priv = join(dir, "license-priv.pem");
  writeFileSync(priv, pkcs8Pem);
  return priv;
}

describe("license-keygen `gen` — local key-material guards (#124)", () => {
  it("Scenario: requires an explicit outdir", () => {
    const cwd = mkdtempSync(join(tmpdir(), "sb-nogit-"));
    const r = spawnSync("node", [KEYGEN, "gen"], { cwd, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage|outdir/i);
    expect(readdirSync(cwd)).toEqual([]); // nothing written
  });

  it("Scenario: refuses a git working tree (no --force), writes no pem", () => {
    const repo = mkdtempSync(join(tmpdir(), "sb-git-"));
    mkdirSync(join(repo, ".git")); // marks a working tree; gen walks up and finds it
    const out = join(repo, "keys");
    mkdirSync(out);
    const r = spawnSync("node", [KEYGEN, "gen", out], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/git working tree/i);
    expect(existsSync(join(out, "license-priv.pem"))).toBe(false);
    expect(existsSync(join(out, "license-pub.pem"))).toBe(false);
  });

  it("--force overrides the git-tree guard (test escape hatch)", () => {
    const repo = mkdtempSync(join(tmpdir(), "sb-git-"));
    mkdirSync(join(repo, ".git"));
    const r = spawnSync("node", [KEYGEN, "gen", repo, "--force"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(repo, "license-priv.pem"))).toBe(true);
    expect(existsSync(join(repo, "license-pub.pem"))).toBe(true);
  });

  it("writes a keypair to an outdir outside any git tree", () => {
    const out = mkdtempSync(join(tmpdir(), "sb-keys-"));
    const r = spawnSync("node", [KEYGEN, "gen", out], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "license-priv.pem"))).toBe(true);
    expect(existsSync(join(out, "license-pub.pem"))).toBe(true);
  });
});

describe("license-keygen `sign` — payload v2 claims (#124/#109)", () => {
  it("Scenario: signed payloads carry kid, jti, iss, sub — and still verify", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const priv = writePriv(pkcs8Pem);
    const key = execFileSync(
      "node",
      [KEYGEN, "sign", priv, "--kind", "subscription", "--days", "365", "--kid", "prod-2026", "--sub", "sub_123"],
      { encoding: "utf8" },
    ).trim();

    const payload = decodePayload(key);
    expect(payload.kid).toBe("prod-2026");
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(payload.iss).toBe(LICENSE_ISSUER);
    expect(payload.iss).toBe("soundbuddy.online");
    expect(payload.sub).toBe("sub_123");

    // verifyLicenseKey-equivalent logic still accepts the key.
    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");
  });

  it("lifetime keys carry jti/iss but never a sub or expiry", () => {
    const { pkcs8Pem } = throwawayKeypair();
    const priv = writePriv(pkcs8Pem);
    const key = execFileSync(
      "node",
      [KEYGEN, "sign", priv, "--kind", "lifetime", "--kid", "k1", "--sub", "sub_ignored"],
      { encoding: "utf8" },
    ).trim();

    const payload = decodePayload(key);
    expect(payload.kind).toBe("lifetime");
    expect(payload.kid).toBe("k1");
    expect(payload.iss).toBe(LICENSE_ISSUER);
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(payload.sub).toBeUndefined();
    expect(payload.expiresAt).toBeUndefined();
  });

  it("stamps a fresh jti on every signing, and defaults iss without --kid", () => {
    const { pkcs8Pem } = throwawayKeypair();
    const priv = writePriv(pkcs8Pem);
    const run = () =>
      decodePayload(execFileSync("node", [KEYGEN, "sign", priv], { encoding: "utf8" }).trim());
    const a = run();
    const b = run();
    expect(a.jti).not.toBe(b.jti);
    expect(a.iss).toBe(LICENSE_ISSUER);
    expect(a.kid).toBeUndefined(); // omitted when --kid is not passed (v1-shaped key)
  });
});
