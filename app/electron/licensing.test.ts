import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Guards the dual-license structure (#55): the Electron app is proprietary,
// everything outside app/ is MIT. If a LICENSE file, package.json license
// field, or source header drifts, this fails before anything ships under the
// wrong terms. Repo-level checks are skipped when app/ is checked out without
// the surrounding monorepo (e.g. an app-only source export).
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const hasMonorepo = fs.existsSync(path.join(repoRoot, 'packages'));

const read = (...parts: string[]) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readPkg = (...parts: string[]) => JSON.parse(read(...parts, 'package.json'));

const MIT_PACKAGES = ['shared', 'scene-inspector', 'audio-engine', 'ai-analyst', 'cli'];
const MIT_GRANT = 'Permission is hereby granted, free of charge';

describe('app/ proprietary license', () => {
  it('carries the proprietary license, not MIT', () => {
    const text = fs.readFileSync(path.join(appRoot, 'LICENSE'), 'utf8');
    expect(text).toContain('Sound Buddy Desktop Application License');
    expect(text).toMatch(/redistribute/i);
    expect(text).toMatch(/License Key/);
    expect(text).not.toContain(MIT_GRANT);
    expect(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).license).toBe(
      'SEE LICENSE IN LICENSE'
    );
  });

  it('the packaged app ships the LICENSE file alongside package.json', () => {
    const builderConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(builderConfig).toMatch(/^\s*-\s*LICENSE\s*$/m);
  });

  it('app source files carry the proprietary header', () => {
    const header = 'Licensed under the Sound Buddy Desktop Application License (app/LICENSE).';
    const sources = ['electron', 'renderer']
      .flatMap((dir) =>
        fs
          .readdirSync(path.join(appRoot, dir))
          .filter((f) => /\.(ts|js)$/.test(f) && !/\.test\./.test(f))
          .map((f) => path.join(dir, f))
      )
      .concat(['renderer/index.html']);
    for (const file of sources) {
      const head = fs.readFileSync(path.join(appRoot, file), 'utf8').slice(0, 400);
      expect(head, `${file} is missing the proprietary license header`).toContain(header);
    }
  });
});

describe.runIf(hasMonorepo)('repo-wide dual-license structure', () => {
  it('root LICENSE explains the split: proprietary app, MIT everything else', () => {
    const text = read('LICENSE');
    expect(text).toContain('app/LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg().license).toBe('MIT');
  });

  it.each(MIT_PACKAGES)('packages/%s is MIT in both LICENSE and package.json', (name) => {
    const text = read('packages', name, 'LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg('packages', name).license).toBe('MIT');
  });

  it('README documents the dual-license split', () => {
    const readme = read('README.md');
    expect(readme).toContain('## License');
    expect(readme).toMatch(/proprietary/i);
    expect(readme).toContain('app/LICENSE');
    expect(readme).toContain('MIT');
  });
});

// Key-material guard (#124): no git-tracked file may contain an armored
// private-key block. The production signing key (#56) lives only with the
// Stripe webhook; scripts/license-keygen.mjs refuses to write one into a
// checkout and .gitignore ignores *.pem — this backstops both, so a stray
// commit of key material fails the suite before it can ship.
//
// The needle is assembled from fragments so THIS file never itself contains a
// literal armor header (which the scan below would otherwise flag on itself).
const BEGIN = 'BEG' + 'IN';
const PRIV = 'PRIVATE' + ' KEY';
const PRIVATE_KEY_ARMOR = new RegExp(`${BEGIN} (?:[A-Z0-9]+ )*${PRIV}`);

/** True if `text` contains an armored private-key block header (PKCS#8, OpenSSH, RSA/EC). */
function hasPrivateKeyBlock(text: string): boolean {
  return PRIVATE_KEY_ARMOR.test(text);
}

// Skip known-binary tracked fixtures (audio, images, fonts) — they never carry
// PEM armor and decoding them as utf8 is wasted work.
const BINARY_EXT = /\.(wav|flac|mp3|aiff|png|jpe?g|gif|ico|icns|pdf|zip|woff2?|ttf|otf)$/i;

describe.runIf(hasMonorepo)('key-material guard (#124)', () => {
  it('detects armored private-key blocks (and ignores public keys / prose)', () => {
    const pkcs8 = [`-----${BEGIN} ${PRIV}-----`, 'MIIBVQ...', `-----END ${PRIV}-----`].join('\n');
    const openssh = `-----${BEGIN} OPENSSH ${PRIV}-----\n...`;
    const rsa = `-----${BEGIN} RSA ${PRIV}-----\n...`;
    expect(hasPrivateKeyBlock(pkcs8)).toBe(true);
    expect(hasPrivateKeyBlock(openssh)).toBe(true);
    expect(hasPrivateKeyBlock(rsa)).toBe(true);
    expect(hasPrivateKeyBlock(`-----${BEGIN} PUBLIC KEY-----`)).toBe(false);
    expect(hasPrivateKeyBlock('rotate the private key stored with the webhook')).toBe(false);
  });

  it('no git-tracked file contains a private-key block', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const offenders: string[] = [];
    for (const rel of tracked) {
      if (BINARY_EXT.test(rel)) continue;
      const abs = path.join(repoRoot, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue; // tracked-but-absent (deleted, submodule gitlink) — nothing to read
      }
      if (!stat.isFile() || stat.size > 1_000_000) continue;
      if (hasPrivateKeyBlock(fs.readFileSync(abs, 'utf8'))) offenders.push(rel);
    }
    expect(offenders, `tracked files contain private-key material: ${offenders.join(', ')}`).toEqual(
      []
    );
  });
});
