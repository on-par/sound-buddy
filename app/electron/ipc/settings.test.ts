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
let openDialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] };

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getVersion: () => '0.0.0', isPackaged: false },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(name, fn);
    },
  },
  dialog: {
    showSaveDialog: () => Promise.resolve(saveDialogResult),
    showOpenDialog: () => Promise.resolve(openDialogResult),
  },
  BrowserWindow: {
    getFocusedWindow: () => focusedWindow,
  },
}));

const isEntitledMock = vi.hoisted(() => vi.fn(() => true));
vi.mock('../license', () => ({ isEntitled: isEntitledMock }));

const dirSizeBytesMock = vi.hoisted(() => vi.fn());
vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return { ...actual, dirSizeBytes: dirSizeBytesMock.mockImplementation(actual.dirSizeBytes) };
});

const recordTelemetryEventMock = vi.hoisted(() => vi.fn());
const clearTelemetryStateMock = vi.hoisted(() => vi.fn());
vi.mock('../telemetry', () => ({
  recordTelemetryEvent: recordTelemetryEventMock,
  clearTelemetryState: clearTelemetryStateMock,
}));

// get-app-version (#402) delegates to resolveAppVersion(APP_ROOT) rather than
// Electron's app.getVersion() — see app-version.ts for why. Stub it here so
// this file tests the IPC wiring; resolveAppVersion's own file-reading logic
// is covered by app-version.test.ts.
vi.mock('../app-version', () => ({ resolveAppVersion: (appRoot: string) => `stub-version-for:${appRoot}` }));

import {
  registerSettingsHandlers,
  safeExportFilename,
  sanitizeChannelLabels,
  sanitizeChannelGroups,
  sanitizeInputInstrumentProfiles,
  sanitizeShareChurchName,
} from './settings';
import { APP_ROOT } from './shared';

const settingsFile = () => path.join(userDataDir, 'settings.json');
const readFile = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ipc-settings-'));
  handlers.clear();
  focusedWindow = {};
  saveDialogResult = { canceled: false, filePath: '' };
  openDialogResult = { canceled: true, filePaths: [] };
  recordTelemetryEventMock.mockClear();
  clearTelemetryStateMock.mockClear();
  isEntitledMock.mockReset().mockReturnValue(true);
  dirSizeBytesMock.mockClear();
  registerSettingsHandlers();
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('get-app-version (#402)', () => {
  it('delegates to resolveAppVersion(APP_ROOT) rather than Electron app.getVersion()', async () => {
    const handler = handlers.get('get-app-version');
    expect(handler).toBeTypeOf('function');
    expect(await handler!(null)).toBe(`stub-version-for:${APP_ROOT}`);
  });
});

describe('get-settings', () => {
  it('returns the current settings', async () => {
    const handler = handlers.get('get-settings');
    expect(handler).toBeTypeOf('function');
    const result = (await handler!(null)) as { aiEnabled: boolean; rigs: unknown[] };
    expect(result.aiEnabled).toBe(false);
    expect(result.rigs).toEqual([]);
  });
});

describe('get-storage-usage', () => {
  it('reports byte size and exists:true for a real dir with a file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-storage-usage-'));
    fs.writeFileSync(path.join(dir, 'a.wav'), Buffer.alloc(1024));
    const update = handlers.get('update-settings')!;
    await update(null, { storageDir: dir });

    const handler = handlers.get('get-storage-usage')!;
    const result = (await handler(null)) as {
      path: string;
      isDefault: boolean;
      bytes: number;
      exists: boolean;
      human: string;
    };

    expect(result.path).toBe(dir);
    expect(result.isDefault).toBe(false);
    expect(result.bytes).toBe(1024);
    expect(result.exists).toBe(true);
    expect(result.human).toBe('1 KB');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports exists:false and bytes:0 for a nonexistent dir, isDefault:true when unset', async () => {
    const handler = handlers.get('get-storage-usage')!;
    const result = (await handler(null)) as {
      isDefault: boolean;
      bytes: number;
      exists: boolean;
    };

    expect(result.isDefault).toBe(true);
    expect(result.bytes).toBe(0);
    expect(result.exists).toBe(false);
  });

  it('logs a warning and reports bytes:0 when dirSizeBytes throws', async () => {
    dirSizeBytesMock.mockRejectedValueOnce(new Error('boom'));
    const handler = handlers.get('get-storage-usage')!;

    const result = (await handler(null)) as { bytes: number };

    expect(result.bytes).toBe(0);
  });
});

describe('list-rigs / set-active-rig / onboarding-disabled', () => {
  it('list-rigs returns the persisted rigs array', async () => {
    const handler = handlers.get('list-rigs')!;
    expect(await handler(null)).toEqual([]);
  });

  it('set-active-rig selects a saved rig', async () => {
    const saved = (await handlers.get('save-rig')!(null, {
      name: 'Main',
      deviceName: 'Scarlett',
      channelConfig: [],
      mode: 'monitor',
      recordDir: '/tmp',
      intervalMs: 100,
      windowSecs: 5,
    })) as { rigs: { id: string }[] };
    const id = saved.rigs[0].id;

    const result = (await handlers.get('set-active-rig')!(null, id)) as { activeRigId: string };
    expect(result.activeRigId).toBe(id);
  });

  it('onboarding-disabled reflects SOUND_BUDDY_DISABLE_ONBOARDING', async () => {
    const handler = handlers.get('onboarding-disabled')!;
    expect(await handler(null)).toBe(false);

    process.env.SOUND_BUDDY_DISABLE_ONBOARDING = '1';
    try {
      expect(await handler(null)).toBe(true);
    } finally {
      delete process.env.SOUND_BUDDY_DISABLE_ONBOARDING;
    }
  });
});

describe('save-rig / delete-rig Pro gating', () => {
  const rig = {
    name: 'Main',
    deviceName: 'Scarlett',
    channelConfig: [],
    mode: 'monitor' as const,
    recordDir: '/tmp',
    intervalMs: 100,
    windowSecs: 5,
  };

  it('save-rig succeeds when entitled', async () => {
    const result = (await handlers.get('save-rig')!(null, rig)) as { rigs: unknown[] };
    expect(result.rigs).toHaveLength(1);
  });

  it('save-rig throws the Pro-gate error when not entitled', () => {
    isEntitledMock.mockReturnValue(false);
    expect(() => handlers.get('save-rig')!(null, rig)).toThrow(/Pro license/);
  });

  it('delete-rig succeeds when entitled', async () => {
    const saved = (await handlers.get('save-rig')!(null, rig)) as { rigs: { id: string }[] };
    const id = saved.rigs[0].id;
    const result = (await handlers.get('delete-rig')!(null, id)) as { rigs: unknown[] };
    expect(result.rigs).toHaveLength(0);
  });

  it('delete-rig throws the Pro-gate error when not entitled', async () => {
    const saved = (await handlers.get('save-rig')!(null, rig)) as { rigs: { id: string }[] };
    const id = saved.rigs[0].id;
    isEntitledMock.mockReturnValue(false);
    expect(() => handlers.get('delete-rig')!(null, id)).toThrow(/Pro license/);
  });
});

describe('open-file-dialog / open-dir-dialog', () => {
  it('open-file-dialog returns the chosen path', async () => {
    openDialogResult = { canceled: false, filePaths: ['/x/audio.wav'] };
    const handler = handlers.get('open-file-dialog')!;
    expect(await handler(null)).toBe('/x/audio.wav');
  });

  it('open-file-dialog returns null when canceled', async () => {
    openDialogResult = { canceled: true, filePaths: [] };
    const handler = handlers.get('open-file-dialog')!;
    expect(await handler(null)).toBeNull();
  });

  it('open-file-dialog returns null when there is no focused window', async () => {
    focusedWindow = null;
    const handler = handlers.get('open-file-dialog')!;
    expect(await handler(null)).toBeNull();
  });

  it('open-dir-dialog returns the chosen path', async () => {
    openDialogResult = { canceled: false, filePaths: ['/x/folder'] };
    const handler = handlers.get('open-dir-dialog')!;
    expect(await handler(null)).toBe('/x/folder');
  });

  it('open-dir-dialog returns null when canceled', async () => {
    openDialogResult = { canceled: true, filePaths: [] };
    const handler = handlers.get('open-dir-dialog')!;
    expect(await handler(null)).toBeNull();
  });

  it('open-dir-dialog returns null when there is no focused window', async () => {
    focusedWindow = null;
    const handler = handlers.get('open-dir-dialog')!;
    expect(await handler(null)).toBeNull();
  });
});

describe('to-file-url', () => {
  it('returns a file:// URL for an existing path', async () => {
    const target = path.join(userDataDir, 'exists.wav');
    fs.writeFileSync(target, 'x');
    const handler = handlers.get('to-file-url')!;
    const { pathToFileURL } = await import('url');
    expect(await handler(null, target)).toBe(pathToFileURL(target).href);
  });

  it('returns null for a nonexistent path', async () => {
    const handler = handlers.get('to-file-url')!;
    expect(await handler(null, path.join(userDataDir, 'missing.wav'))).toBeNull();
  });
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

  it('turning usageSignalEnabled off calls clearTelemetryState (#474)', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { usageSignalEnabled: false });
    expect(clearTelemetryStateMock).toHaveBeenCalledTimes(1);
  });

  it('turning usageSignalEnabled on does not call clearTelemetryState (#474)', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { usageSignalEnabled: true });
    expect(clearTelemetryStateMock).not.toHaveBeenCalled();
  });
});

describe('update-settings IPC whitelist — crashReportingEnabled (#473)', () => {
  it('accepts a boolean and persists it', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { crashReportingEnabled: true })) as {
      crashReportingEnabled: boolean;
    };
    expect(result.crashReportingEnabled).toBe(true);
    expect(readFile().crashReportingEnabled).toBe(true);
  });

  it('ignores a string value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { crashReportingEnabled: 'true' })) as {
      crashReportingEnabled: boolean;
    };
    expect(result.crashReportingEnabled).toBe(false);
  });

  it('ignores a number value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { crashReportingEnabled: 1 })) as {
      crashReportingEnabled: boolean;
    };
    expect(result.crashReportingEnabled).toBe(false);
  });

  it('still passes an existing whitelisted key through (regression guard)', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { aiEnabled: true })) as { aiEnabled: boolean };
    expect(result.aiEnabled).toBe(true);
    expect(readFile().aiEnabled).toBe(true);
  });
});

describe('update-settings IPC whitelist — dawWorkspaceEnabled (#516)', () => {
  it('accepts a boolean and persists it', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { dawWorkspaceEnabled: true })) as {
      dawWorkspaceEnabled: boolean;
    };
    expect(result.dawWorkspaceEnabled).toBe(true);
    expect(readFile().dawWorkspaceEnabled).toBe(true);
  });

  it('ignores a string value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { dawWorkspaceEnabled: 'true' })) as {
      dawWorkspaceEnabled: boolean;
    };
    expect(result.dawWorkspaceEnabled).toBe(false);
  });

  it('ignores a number value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { dawWorkspaceEnabled: 1 })) as {
      dawWorkspaceEnabled: boolean;
    };
    expect(result.dawWorkspaceEnabled).toBe(false);
  });
});

describe('update-settings IPC whitelist — liveAdjustmentsEnabled (#522)', () => {
  it('accepts a boolean and persists it', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { liveAdjustmentsEnabled: true })) as {
      liveAdjustmentsEnabled: boolean;
    };
    expect(result.liveAdjustmentsEnabled).toBe(true);
    expect(readFile().liveAdjustmentsEnabled).toBe(true);
  });

  it('ignores a string value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { liveAdjustmentsEnabled: 'true' })) as {
      liveAdjustmentsEnabled: boolean;
    };
    expect(result.liveAdjustmentsEnabled).toBe(false);
  });

  it('ignores a number value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { liveAdjustmentsEnabled: 1 })) as {
      liveAdjustmentsEnabled: boolean;
    };
    expect(result.liveAdjustmentsEnabled).toBe(false);
  });
});

describe('update-settings IPC whitelist — reportFirstUxEnabled (#538)', () => {
  it('accepts a boolean and persists it', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { reportFirstUxEnabled: true })) as {
      reportFirstUxEnabled: boolean;
    };
    expect(result.reportFirstUxEnabled).toBe(true);
    expect(readFile().reportFirstUxEnabled).toBe(true);
  });

  it('ignores a string value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { reportFirstUxEnabled: 'true' })) as {
      reportFirstUxEnabled: boolean;
    };
    expect(result.reportFirstUxEnabled).toBe(false);
  });

  it('ignores a number value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { reportFirstUxEnabled: 1 })) as {
      reportFirstUxEnabled: boolean;
    };
    expect(result.reportFirstUxEnabled).toBe(false);
  });
});

describe('sanitizeShareChurchName (#265)', () => {
  it('returns null for a non-string value (patch key ignored)', () => {
    expect(sanitizeShareChurchName(42)).toBeNull();
    expect(sanitizeShareChurchName({})).toBeNull();
    expect(sanitizeShareChurchName(undefined)).toBeNull();
    expect(sanitizeShareChurchName(null)).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeShareChurchName('  Grace Chapel  ')).toBe('Grace Chapel');
  });

  it('truncates past the length cap', () => {
    const long = 'a'.repeat(60);
    expect(sanitizeShareChurchName(long)).toBe('a'.repeat(40));
  });

  it('preserves a normal name unchanged', () => {
    expect(sanitizeShareChurchName('First Baptist')).toBe('First Baptist');
  });

  it('accepts an empty string (clears the setting back to the privacy default)', () => {
    expect(sanitizeShareChurchName('')).toBe('');
  });
});

describe('update-settings IPC whitelist — shareChurchName (#265)', () => {
  it('accepts and persists a church name', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { shareChurchName: 'Grace Chapel' })) as { shareChurchName: string };
    expect(result.shareChurchName).toBe('Grace Chapel');
    expect(readFile().shareChurchName).toBe('Grace Chapel');
  });

  it('ignores a non-string value, leaving the setting at its default', async () => {
    const handler = handlers.get('update-settings');
    const result = (await handler!(null, { shareChurchName: 42 })) as { shareChurchName: string };
    expect(result.shareChurchName).toBe('');
  });

  it('accepts an empty string to clear a previously-saved name', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { shareChurchName: 'Grace Chapel' });
    const result = (await handler!(null, { shareChurchName: '' })) as { shareChurchName: string };
    expect(result.shareChurchName).toBe('');
  });
});

describe('sanitizeChannelLabels (#482)', () => {
  it('returns null for a non-object value (patch key ignored)', () => {
    expect(sanitizeChannelLabels('nope')).toBeNull();
    expect(sanitizeChannelLabels(123)).toBeNull();
    expect(sanitizeChannelLabels(null)).toBeNull();
    expect(sanitizeChannelLabels(undefined)).toBeNull();
    expect(sanitizeChannelLabels([{ '0': 'Kick' }])).toBeNull();
  });

  it('drops a device entry whose value is not a plain object', () => {
    expect(sanitizeChannelLabels({ 'Scarlett 18i20': 'nope', Other: { '0': 'Kick' } })).toEqual({
      Other: { '0': 'Kick' },
    });
  });

  it('drops a non-string label value', () => {
    expect(sanitizeChannelLabels({ Scarlett: { '0': 'Kick', '1': 42 } })).toEqual({
      Scarlett: { '0': 'Kick' },
    });
  });

  it('trims labels and caps them at 40 chars', () => {
    const long = 'x'.repeat(50);
    const result = sanitizeChannelLabels({ Scarlett: { '0': '  Kick  ', '1': long } });
    expect(result).toEqual({ Scarlett: { '0': 'Kick', '1': 'x'.repeat(40) } });
  });

  it('drops a label that is empty after trim, and prunes an empty device map', () => {
    expect(sanitizeChannelLabels({ Scarlett: { '0': '   ' } })).toEqual({});
    expect(sanitizeChannelLabels({ Scarlett: { '0': '   ', '1': 'Kick' } })).toEqual({
      Scarlett: { '1': 'Kick' },
    });
  });

  it('drops an empty token key', () => {
    expect(sanitizeChannelLabels({ Scarlett: { '': 'Kick', '0': 'Snare' } })).toEqual({
      Scarlett: { '0': 'Snare' },
    });
  });
});

describe('update-settings IPC whitelist — channelLabels (#482)', () => {
  it('accepts a valid nested map and persists it', async () => {
    const handler = handlers.get('update-settings');
    const map = { Scarlett: { '0': 'Kick', '2-3': 'OH' } };
    const result = (await handler!(null, { channelLabels: map })) as {
      channelLabels: Record<string, Record<string, string>>;
    };
    expect(result.channelLabels).toEqual(map);
    expect(readFile().channelLabels).toEqual(map);
  });

  it('replaces the whole stored map rather than merging', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { channelLabels: { Scarlett: { '0': 'Kick' } } });
    await handler!(null, { channelLabels: { Scarlett: { '1': 'Snare' } } });
    expect(readFile().channelLabels).toEqual({ Scarlett: { '1': 'Snare' } });
  });

  it('ignores a non-object channelLabels patch value', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { channelLabels: { Scarlett: { '0': 'Kick' } } });
    await handler!(null, { channelLabels: 'nope' });
    expect(readFile().channelLabels).toEqual({ Scarlett: { '0': 'Kick' } });
  });
});

describe('sanitizeInputInstrumentProfiles (#524)', () => {
  it('returns null for a non-object value (patch key ignored)', () => {
    expect(sanitizeInputInstrumentProfiles('nope')).toBeNull();
    expect(sanitizeInputInstrumentProfiles(123)).toBeNull();
    expect(sanitizeInputInstrumentProfiles(null)).toBeNull();
    expect(sanitizeInputInstrumentProfiles(undefined)).toBeNull();
    expect(sanitizeInputInstrumentProfiles([{ '0': 'kick' }])).toBeNull();
  });

  it('drops a device entry whose value is not a plain object', () => {
    expect(sanitizeInputInstrumentProfiles({ 'Scarlett 18i20': 'nope', Other: { '0': 'kick' } })).toEqual({
      Other: { '0': 'kick' },
    });
  });

  it('drops a non-string profile-id value', () => {
    expect(sanitizeInputInstrumentProfiles({ Scarlett: { '0': 'kick', '1': 42 } })).toEqual({
      Scarlett: { '0': 'kick' },
    });
  });

  it('trims profile ids and caps them at 64 chars', () => {
    const long = 'x'.repeat(80);
    const result = sanitizeInputInstrumentProfiles({ Scarlett: { '0': '  kick  ', '1': long } });
    expect(result).toEqual({ Scarlett: { '0': 'kick', '1': 'x'.repeat(64) } });
  });

  it('drops a profile id that is empty after trim, and prunes an empty device map', () => {
    expect(sanitizeInputInstrumentProfiles({ Scarlett: { '0': '   ' } })).toEqual({});
    expect(sanitizeInputInstrumentProfiles({ Scarlett: { '0': '   ', '1': 'kick' } })).toEqual({
      Scarlett: { '1': 'kick' },
    });
  });

  it('drops an empty token key', () => {
    expect(sanitizeInputInstrumentProfiles({ Scarlett: { '': 'kick', '0': 'vocal' } })).toEqual({
      Scarlett: { '0': 'vocal' },
    });
  });
});

describe('update-settings IPC whitelist — inputInstrumentProfiles (#524)', () => {
  it('accepts a valid nested map and persists it', async () => {
    const handler = handlers.get('update-settings');
    const map = { Scarlett: { '0': 'kick', '2-3': 'vocal' } };
    const result = (await handler!(null, { inputInstrumentProfiles: map })) as {
      inputInstrumentProfiles: Record<string, Record<string, string>>;
    };
    expect(result.inputInstrumentProfiles).toEqual(map);
    expect(readFile().inputInstrumentProfiles).toEqual(map);
  });

  it('replaces the whole stored map rather than merging', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { inputInstrumentProfiles: { Scarlett: { '0': 'kick' } } });
    await handler!(null, { inputInstrumentProfiles: { Scarlett: { '1': 'vocal' } } });
    expect(readFile().inputInstrumentProfiles).toEqual({ Scarlett: { '1': 'vocal' } });
  });

  it('ignores a non-object inputInstrumentProfiles patch value', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { inputInstrumentProfiles: { Scarlett: { '0': 'kick' } } });
    await handler!(null, { inputInstrumentProfiles: 'nope' });
    expect(readFile().inputInstrumentProfiles).toEqual({ Scarlett: { '0': 'kick' } });
  });
});

describe('sanitizeChannelGroups (#483)', () => {
  it('returns null for a non-object value (patch key ignored)', () => {
    expect(sanitizeChannelGroups('nope')).toBeNull();
    expect(sanitizeChannelGroups(123)).toBeNull();
    expect(sanitizeChannelGroups(null)).toBeNull();
    expect(sanitizeChannelGroups(undefined)).toBeNull();
    expect(sanitizeChannelGroups([{ name: 'Drums', members: [0] }])).toBeNull();
  });

  it('drops a device entry whose value is not an array', () => {
    expect(sanitizeChannelGroups({ Scarlett: 'nope', Other: [{ name: 'Drums', members: [0] }] })).toEqual({
      Other: [{ name: 'Drums', members: [0] }],
    });
  });

  it('drops a group with a missing or non-string name', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ members: [0] }, { name: 'Drums', members: [1] }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [1] }],
    });
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 42, members: [0] }] })).toEqual({});
  });

  it('trims a group name and caps it at 40 chars', () => {
    const long = 'x'.repeat(50);
    const result = sanitizeChannelGroups({ Scarlett: [{ name: '  Drums  ', members: [] }, { name: long, members: [] }] });
    expect(result).toEqual({ Scarlett: [{ name: 'Drums', members: [] }, { name: 'x'.repeat(40), members: [] }] });
  });

  it('drops a group whose name is empty after trim', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ name: '   ', members: [0] }] })).toEqual({});
  });

  it('filters members to non-negative integers, deduped in order', () => {
    const result = sanitizeChannelGroups({ Scarlett: [{ name: 'Drums', members: [2, -1, 0.5, 2, 0, 'x'] }] });
    expect(result).toEqual({ Scarlett: [{ name: 'Drums', members: [2, 0] }] });
  });

  it('defaults members to [] when absent or malformed', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Drums' }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [] }],
    });
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Drums', members: 'nope' }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [] }],
    });
  });

  it('keeps a group with empty members (a named empty group is legal)', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Empty', members: [] }] })).toEqual({
      Scarlett: [{ name: 'Empty', members: [] }],
    });
  });

  it('keeps collapsed only when it is literally true', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Drums', members: [0], collapsed: true }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [0], collapsed: true }],
    });
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Drums', members: [0], collapsed: 'true' }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [0] }],
    });
    expect(sanitizeChannelGroups({ Scarlett: [{ name: 'Drums', members: [0], collapsed: false }] })).toEqual({
      Scarlett: [{ name: 'Drums', members: [0] }],
    });
  });

  it('drops a device key whose group list ends up empty', () => {
    expect(sanitizeChannelGroups({ Scarlett: [{ name: '   ', members: [0] }], Other: [] })).toEqual({});
  });
});

describe('update-settings IPC whitelist — channelGroups (#483)', () => {
  it('accepts a valid group list and persists it', async () => {
    const handler = handlers.get('update-settings');
    const map = { Scarlett: [{ name: 'Drums', members: [0, 1], collapsed: true }] };
    const result = (await handler!(null, { channelGroups: map })) as {
      channelGroups: Record<string, unknown>;
    };
    expect(result.channelGroups).toEqual(map);
    expect(readFile().channelGroups).toEqual(map);
  });

  it('replaces the whole stored map rather than merging', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { channelGroups: { Scarlett: [{ name: 'Drums', members: [0] }] } });
    await handler!(null, { channelGroups: { Scarlett: [{ name: 'Vox', members: [1] }] } });
    expect(readFile().channelGroups).toEqual({ Scarlett: [{ name: 'Vox', members: [1] }] });
  });

  it('ignores a non-object channelGroups patch value', async () => {
    const handler = handlers.get('update-settings');
    await handler!(null, { channelGroups: { Scarlett: [{ name: 'Drums', members: [0] }] } });
    await handler!(null, { channelGroups: 'nope' });
    expect(readFile().channelGroups).toEqual({ Scarlett: [{ name: 'Drums', members: [0] }] });
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

  it('records report_exported telemetry on a successful save (#474)', async () => {
    const target = path.join(userDataDir, 'my-export.png');
    saveDialogResult = { canceled: false, filePath: target };
    const handler = handlers.get('save-report-image');
    await handler!(null, PNG_BYTES, 'sound-buddy-report.png');
    expect(recordTelemetryEventMock).toHaveBeenCalledWith('report_exported');
  });

  it('does not record telemetry when the save dialog is cancelled (#474)', async () => {
    saveDialogResult = { canceled: true };
    const handler = handlers.get('save-report-image');
    await handler!(null, PNG_BYTES, 'report.png');
    expect(recordTelemetryEventMock).not.toHaveBeenCalled();
  });
});
