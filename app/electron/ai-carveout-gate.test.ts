// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// AI carve-out 2/5 (#658): removes the AI-narrative IPC channel end to end —
// the ipc/narrative.ts handler module (all six handlers), the llm-delta/
// llm-done push channels, the eight preload bridge methods, the LlmApi slice
// of SoundBuddyApi, and the live-capture LLM interval timer — so the app's
// trusted preload surface stops carrying a channel with no caller (the
// renderer UI was removed in #657). The provider stack (llm.ts,
// llm-config.ts, llm-providers.ts, ollama-probe.ts, narrative-port.ts) is
// left for #659. The banned tokens are built by string concatenation below
// (never spelled out literally in this file, including in prose) so this
// file itself never trips its own greps.
//
// AI carve-out 3/5 (#659) completes the provider-stack removal left above:
// deletes llm.ts/llm-config.ts/ollama-probe.ts/narrative-port.ts (and their
// tests) plus the prompt-drift guard whose loading path goes with them, and
// removes the aiEnabled settings layer end to end (defaults, file merge, the
// SOUND_BUDDY_AI_ENABLED env override, isAiEnabled()). The #659 section below
// scans every .ts file (including tests) under app/electron for the removed
// tokens, built by string concatenation for the same self-immunity reason as
// the #658 section above.

const TOKENS = [
  'trigger-' + 'llm-analysis',
  'llm-' + 'delta',
  'llm-' + 'done',
  'llm-get-' + 'config',
  'llm-save-' + 'config',
  'llm-detect-' + 'ollama',
  'llm-test-' + 'provider',
  'llm-list-' + 'models',
  'trigger' + 'LlmAnalysis',
  'on' + 'LlmDelta',
  'on' + 'LlmDone',
  'get' + 'LlmConfig',
  'save' + 'LlmConfig',
  'detect' + 'Ollama',
  'test' + 'LlmProvider',
  'list' + 'LlmModels',
  'stream' + 'LLM',
  'Llm' + 'Api',
  'registerNarrative' + 'Handlers',
];

const files: Record<string, string> = {
  'preload.ts': fs.readFileSync(fileURLToPath(new URL('./preload.ts', import.meta.url)), 'utf8'),
  'ipc.ts': fs.readFileSync(fileURLToPath(new URL('./ipc.ts', import.meta.url)), 'utf8'),
  'ipc/api.ts': fs.readFileSync(fileURLToPath(new URL('./ipc/api.ts', import.meta.url)), 'utf8'),
  'ipc/live-capture.ts': fs.readFileSync(fileURLToPath(new URL('./ipc/live-capture.ts', import.meta.url)), 'utf8'),
  '../renderer/src/mock-sound-buddy.ts': fs.readFileSync(
    fileURLToPath(new URL('../renderer/src/mock-sound-buddy.ts', import.meta.url)),
    'utf8',
  ),
};

describe('AI carve-out gate (#658)', () => {
  for (const [name, content] of Object.entries(files)) {
    for (const token of TOKENS) {
      it(`${name} does not contain the removed-surface token "${token}"`, () => {
        expect(content).not.toContain(token);
      });
    }
  }

  it('the narrative IPC handler module no longer exists', () => {
    expect(fs.existsSync(fileURLToPath(new URL('./ipc/' + 'narrative.ts', import.meta.url)))).toBe(false);
    expect(fs.existsSync(fileURLToPath(new URL('./ipc/' + 'narrative.test.ts', import.meta.url)))).toBe(false);
  });
});

// ─── #659 section: main-process LLM stack + aiEnabled removal ──────────────

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const GATE_FILE_NAME = path.basename(fileURLToPath(import.meta.url));

function collectAllTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectAllTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== GATE_FILE_NAME) {
      found.push(full);
    }
  }
  return found;
}

const TOKENS_659 = [
  'll' + 'm',
  'Ll' + 'm',
  'LL' + 'M',
  'oll' + 'ama',
  'Oll' + 'ama',
  'narrative-' + 'port',
  'ai' + 'Enabled',
  'AI_' + 'ENABLED',
];

const REMOVED_FILES_659 = [
  'llm.ts',
  'llm.test.ts',
  'llm-config.ts',
  'llm-config.test.ts',
  'ollama-probe.ts',
  'ollama-probe.test.ts',
  'narrative-port.ts',
  'narrative-port.test.ts',
  'prompt-drift.test.ts',
];

describe('AI carve-out gate (#659)', () => {
  const scannedFiles = collectAllTsFiles(electronRoot);

  it.each(scannedFiles.map((f) => [path.relative(electronRoot, f), f] as const))(
    '%s contains no removed main-process LLM-stack token',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of TOKENS_659) {
        expect(text).not.toContain(token);
      }
    },
  );

  it.each(REMOVED_FILES_659)('%s no longer exists', (name) => {
    expect(fs.existsSync(path.join(electronRoot, name))).toBe(false);
  });
});

const ASSIST_CONFINED_TOKENS = ['CLAUDE_CODE_' + 'OAUTH_TOKEN', 'safe' + 'Storage'];
const SKIP_PERMISSIONS_TOKEN = 'dangerously-' + 'skip-permissions';
const BANNED_DEPENDENCY_FRAGMENTS = ['anth' + 'ropic', 'open' + 'ai', 'cla' + 'ude'];
const ASSIST_DIR = 'mixer-' + 'assist';
const ASSIST_IPC_FILE = path.join('ipc', 'mixer-' + 'assist.ts');
const repoRoot = path.resolve(electronRoot, '..', '..');

function collectEveryFile(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? collectEveryFile(full) : [full];
  });
}

function workspacePackageJsons(): string[] {
  const packagesDir = path.join(repoRoot, 'packages');
  return [
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'app', 'package.json'),
    path.join(repoRoot, 'app', 'renderer', 'package.json'),
    ...fs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(packagesDir, e.name, 'package.json')))
      .map((e) => path.join(packagesDir, e.name, 'package.json')),
  ];
}

describe('Mixer assist confinement (Cloud and Local assist)', () => {
  const nonTestOutsideAssist = collectAllTsFiles(electronRoot).filter((file) => {
    const relative = path.relative(electronRoot, file);
    return !relative.endsWith('.test.ts') && relative.split(path.sep)[0] !== ASSIST_DIR && relative !== ASSIST_IPC_FILE;
  });

  it('scans the whole electron tree except the assist module and its IPC file', () => {
    const relatives = nonTestOutsideAssist.map((f) => path.relative(electronRoot, f));
    expect(relatives).toEqual(expect.arrayContaining(['main.ts', 'preload.ts', path.join('ipc', 'console.ts'), path.join('ipc', 'api.ts')]));
    expect(relatives.some((r) => r.startsWith(ASSIST_DIR) || r === ASSIST_IPC_FILE)).toBe(false);
  });

  it.each(nonTestOutsideAssist.map((f) => [path.relative(electronRoot, f), f] as const))(
    '%s holds no oauth-token or safe-storage token outside the assist module',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of ASSIST_CONFINED_TOKENS) expect(text).not.toContain(token);
    },
  );

  it('no file under app/electron contains the permission-bypass flag', () => {
    const offenders = collectEveryFile(electronRoot).filter((file) => fs.readFileSync(file, 'utf8').includes(SKIP_PERMISSIONS_TOKEN));
    expect(offenders).toEqual([]);
  });

  it('no workspace package.json declares a dependency named for an AI vendor SDK', () => {
    const files = workspacePackageJsons();
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>;
      const names = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((block) => Object.keys(pkg[block] ?? {}));
      const banned = names.filter((name) => BANNED_DEPENDENCY_FRAGMENTS.some((fragment) => name.toLowerCase().includes(fragment)));
      expect(banned, file).toEqual([]);
    }
  });
});
