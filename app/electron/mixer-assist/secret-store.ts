// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import * as path from 'path';

export const TOKEN_FILE_NAME = 'mixer-assist-token.bin';
export const MAX_TOKEN_LENGTH = 4096;
const OWNER_ONLY_MODE = 0o600;

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface SecretFileSystem {
  readFileSync(file: string): Buffer;
  writeFileSync(file: string, data: Buffer, opts: { mode: number }): void;
  existsSync(file: string): boolean;
  rmSync(file: string, opts: { force: boolean }): void;
  chmodSync(file: string, mode: number): void;
}

export type SaveTokenOutcome = { ok: true } | { ok: false; reason: 'empty' | 'too-long' | 'no-encryption' | 'write-failed' };

export interface SecretStore {
  save(token: string): SaveTokenOutcome;
  clear(): void;
  isSaved(): boolean;
  read(): string | null;
  encryptionAvailable(): boolean;
}

export function createSecretStore(deps: { safeStorage: SafeStorageLike; fs: SecretFileSystem; dir: string }): SecretStore {
  const file = path.join(deps.dir, TOKEN_FILE_NAME);
  return {
    save(token) {
      const trimmed = token.trim();
      if (trimmed === '') return { ok: false, reason: 'empty' };
      if (trimmed.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'too-long' };
      if (!deps.safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'no-encryption' };
      try {
        deps.fs.writeFileSync(file, deps.safeStorage.encryptString(trimmed), { mode: OWNER_ONLY_MODE });
        deps.fs.chmodSync(file, OWNER_ONLY_MODE);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'write-failed' };
      }
    },
    clear() {
      deps.fs.rmSync(file, { force: true });
    },
    isSaved() {
      return deps.fs.existsSync(file);
    },
    read() {
      if (!deps.fs.existsSync(file) || !deps.safeStorage.isEncryptionAvailable()) return null;
      try {
        return deps.safeStorage.decryptString(deps.fs.readFileSync(file));
      } catch {
        return null;
      }
    },
    encryptionAvailable() {
      return deps.safeStorage.isEncryptionAvailable();
    },
  };
}
