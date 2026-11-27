// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSecretStore, TOKEN_FILE_NAME, MAX_TOKEN_LENGTH, type SafeStorageLike, type SecretFileSystem } from './secret-store';

const FAKE_TOKEN = 'fake-oauth-token-for-tests-0123456789';

function fakeSafeStorage(available = true): SafeStorageLike & { encrypted: string[] } {
  const encrypted: string[] = [];
  return {
    encrypted,
    isEncryptionAvailable: () => available,
    encryptString: (plain) => {
      encrypted.push(plain);
      return Buffer.from(plain.split('').reverse().join(''), 'utf8').map((b) => b ^ 0x5a) as Buffer;
    },
    decryptString: (cipher) => Buffer.from(cipher.map((b) => b ^ 0x5a)).toString('utf8').split('').reverse().join(''),
  };
}

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-secret-store-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readAllFiles(root: string): string {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? readAllFiles(path.join(root, e.name)) : fs.readFileSync(path.join(root, e.name)).toString('latin1')))
    .join('\n');
}

describe('secret-store', () => {
  it('saves ciphertext only, in its own file under the given dir, and reads the token back', () => {
    const safe = fakeSafeStorage();
    const store = createSecretStore({ safeStorage: safe, fs, dir });
    expect(store.save(`  ${FAKE_TOKEN}  `)).toEqual({ ok: true });
    expect(fs.readdirSync(dir)).toEqual([TOKEN_FILE_NAME]);
    expect(readAllFiles(dir)).not.toContain(FAKE_TOKEN);
    expect(store.isSaved()).toBe(true);
    expect(store.read()).toBe(FAKE_TOKEN);
    expect(safe.encrypted).toEqual([FAKE_TOKEN]);
  });

  it('writes the file owner-only', () => {
    createSecretStore({ safeStorage: fakeSafeStorage(), fs, dir }).save(FAKE_TOKEN);
    expect(fs.statSync(path.join(dir, TOKEN_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it('refuses to save when encryption is unavailable and writes nothing', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(false), fs, dir });
    expect(store.save(FAKE_TOKEN)).toEqual({ ok: false, reason: 'no-encryption' });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(store.encryptionAvailable()).toBe(false);
  });

  it('refuses an empty or oversized token', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), fs, dir });
    expect(store.save('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(store.save('x'.repeat(MAX_TOKEN_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reports a write failure without throwing', () => {
    const failing: SecretFileSystem = {
      ...fs,
      writeFileSync: () => {
        throw new Error('EACCES');
      },
    };
    expect(createSecretStore({ safeStorage: fakeSafeStorage(), fs: failing, dir }).save(FAKE_TOKEN)).toEqual({ ok: false, reason: 'write-failed' });
  });

  it('reads nothing when no token is saved, when encryption became unavailable, or when the file cannot be decrypted', () => {
    expect(createSecretStore({ safeStorage: fakeSafeStorage(), fs, dir }).read()).toBeNull();
    createSecretStore({ safeStorage: fakeSafeStorage(), fs, dir }).save(FAKE_TOKEN);
    expect(createSecretStore({ safeStorage: fakeSafeStorage(false), fs, dir }).read()).toBeNull();
    const broken: SafeStorageLike = {
      ...fakeSafeStorage(),
      decryptString: () => {
        throw new Error('bad ciphertext');
      },
    };
    expect(createSecretStore({ safeStorage: broken, fs, dir }).read()).toBeNull();
  });

  it('clear removes the file and is safe when nothing is saved', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), fs, dir });
    store.clear();
    store.save(FAKE_TOKEN);
    store.clear();
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(store.isSaved()).toBe(false);
  });
});
