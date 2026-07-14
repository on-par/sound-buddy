import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Same mocking discipline as electron/settings.test.ts: point userData at a
// per-test temp dir so update-settings writes land in real JSON we can assert
// against, plus the ipcMain.handle capture pattern from ipc/analysis.test.ts.
let userDataDir = '';
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

// Controllable per-test fixtures for the save-report-image IPC's dialog/
// window dependencies (#368) — a fake focused window (or null, simulating no
// window) and a fake save-dialog result (cancel vs a chosen path).
let focusedWindow: object | null = {};
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: false, filePath: '' };

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getVersion: () => '0.0.0', isPackaged: false },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(name, fn);
    },
  },
  dialog: {
    showSaveDialog: () => Promise.resolve(saveDialogResult),
  },
  BrowserWindow: {
    getFocusedWindow: () => focusedWindow,
  },
}));

vi.mock('../license', () => ({ isEntitled: () => true }));

import { registerSettingsHandlers, safeExportFilename } from './settings';

const settingsFile = () => path.join(userDataDir, 'settings.json');
const readFile = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ipc-settings-'));
  handlers.clear();
  focusedWindow = {};
  saveDialogResult = { canceled: false, filePath: '' };
  registerSettingsHandlers();
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('update-settings IPC whitelist — usageSignalEnabled (#145)', () => {
  it('accepts a boolean and persists it', async () => {
    const handler = handlers.get('update-settings');
    expect(handler).toBeTypeOf('function');
    const result = (await handler!(null, { usageSignalEnabled: true })) as {
      usageSignalEnabled: boolean;
    };
    expect(result.usageSignalEnabled).toBe(true);
    expect(readFile().usageSignalEnabled).toBe(true);
  });

  it('strips a non-boolean value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { usageSignalEnabled: 'true' })) as {
      usageSignalEnabled: boolean;
    };
    expect(result.usageSignalEnabled).toBe(false);
  });

  it('does not write an unknown key to settings.json', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { bogus: 1 });
    expect(readFile().bogus).toBeUndefined();
  });

  it('still passes an existing whitelisted key through (regression guard)', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { aiEnabled: true })) as { aiEnabled: boolean };
    expect(result.aiEnabled).toBe(true);
    expect(readFile().aiEnabled).toBe(true);
  });
});

describe('safeExportFilename (#368)', () => {
  it('leaves an already-.png name unchanged', () => {
    expect(safeExportFilename('sound-buddy-report-my-mix.png')).toBe('sound-buddy-report-my-mix.png');
  });

  it('forces a .png extension onto an extension-less name', () => {
    expect(safeExportFilename('sound-buddy-report-my-mix')).toBe('sound-buddy-report-my-mix.png');
  });

  it('checks the extension case-insensitively', () => {
    expect(safeExportFilename('My-Mix.PNG')).toBe('My-Mix.PNG');
  });

  it('falls back to report.png for an empty/whitespace name', () => {
    expect(safeExportFilename('')).toBe('report.png');
    expect(safeExportFilename('   ')).toBe('report.png');
  });

  it('strips a directory component (defense-in-depth against a tampered IPC arg)', () => {
    expect(safeExportFilename('/etc/passwd')).toBe('passwd.png');
    expect(safeExportFilename('C:\\a\\b')).toBe('b.png');
  });
});

describe('save-report-image IPC (#368)', () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

  it('returns { saved: false } when there is no focused window', async () => {
    focusedWindow = null;
    const handler = handlers.get('save-report-image');
    expect(handler).toBeTypeOf('function');
    const result = await handler!(null, PNG_BYTES, 'report.png');
    expect(result).toEqual({ saved: false });
  });

  it('returns { saved: false } when the save dialog is cancelled', async () => {
    saveDialogResult = { canceled: true };
    const handler = handlers.get('save-report-image');
    const result = await handler!(null, PNG_BYTES, 'report.png');
    expect(result).toEqual({ saved: false });
  });

  it('writes the bytes to the chosen path and reports it saved', async () => {
    const target = path.join(userDataDir, 'my-export.png');
    saveDialogResult = { canceled: false, filePath: target };
    const handler = handlers.get('save-report-image');
    const result = await handler!(null, PNG_BYTES, 'sound-buddy-report.png');
    expect(result).toEqual({ saved: true, filePath: target });
    expect(new Uint8Array(fs.readFileSync(target))).toEqual(PNG_BYTES);
  });
});
