// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as storageSettings from './storage-settings';

// Batch-settings gate (#1022): epic #1000 moved every Settings control onto
// an immediate-commit path (#1018 instant settings, #1019 storage folder,
// #1020 debounced church name, #1021 close-only Done + ADR-0084), and #1021
// deleted the staged-patch-builder, the storage-toggle seeding helper, its
// key list, the save-all committer and its field list, and the save handler
// from the source tree. This gate enforces the other half of ADR-0084 —
// that the batch-save machinery cannot be reintroduced silently — by
// scanning every file under app/renderer/src for the removed tokens. The
// tokens are built by string concatenation (never spelled out literally in
// this file, including in prose) so this gate file never trips its own scan
// and the issue's own verification grep stays clean.

const TREE_TOKENS = ['build' + 'StoragePatch', 'Storage' + 'Toggles', 'TOGGLE' + '_KEYS', 'save' + 'All'];

const SETTINGS_FILE_TOKENS = ['Save' + 'AllFields', 'function handle' + 'Save'];

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));
const GATE_FILE_NAME = path.basename(fileURLToPath(import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|js|html)$/.test(entry.name) &&
      entry.name !== GATE_FILE_NAME
    ) {
      found.push(full);
    }
  }
  return found;
}

describe('batch-settings gate (#1022)', () => {
  const files = collectSourceFiles(rendererRoot);

  it.each(files.map((f) => [path.relative(rendererRoot, f), f] as const))(
    '%s contains no batch-save token',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of TREE_TOKENS) {
        expect(text).not.toContain(token);
      }
    },
  );

  it('SettingsPanel.tsx and storage-settings.ts contain no file-scoped batch-save token', () => {
    const settingsPanelSrc = fs.readFileSync(path.join(rendererRoot, 'SettingsPanel.tsx'), 'utf8');
    const storageSettingsSrc = fs.readFileSync(path.join(rendererRoot, 'storage-settings.ts'), 'utf8');
    for (const token of SETTINGS_FILE_TOKENS) {
      expect(settingsPanelSrc).not.toContain(token);
      expect(storageSettingsSrc).not.toContain(token);
    }
  });

  it('SettingsPanel.tsx holds no local mirror of consoleNetworkConsentGranted', () => {
    const src = fs.readFileSync(path.join(rendererRoot, 'SettingsPanel.tsx'), 'utf8');
    expect(src).not.toContain('setConsoleNetworkConsent' + 'Granted');
    expect(src).toContain('const consoleNetworkConsentGranted = !!settings?.consoleNetworkConsentGranted');
  });

  it('storage-settings.ts exports no batch-save API', () => {
    expect(Object.keys(storageSettings)).not.toContain('build' + 'StoragePatch');
    expect(Object.keys(storageSettings)).not.toContain('Storage' + 'Toggles');
  });
});
