import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Same mocking discipline as electron/settings.test.ts: point userData at a
// per-test temp dir so update-settings writes land in real JSON we can assert
// against, plus the ipcMain.handle capture pattern from ipc/analysis.test.ts.
let userDataDir = '';
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getVersion: () => '0.0.0', isPackaged: false },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(name, fn);
    },
  },
  dialog: {},
  BrowserWindow: class {},
}));

vi.mock('../license', () => ({ isEntitled: () => true }));

import { registerSettingsHandlers } from './settings';

const settingsFile = () => path.join(userDataDir, 'settings.json');
const readFile = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ipc-settings-'));
  handlers.clear();
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
