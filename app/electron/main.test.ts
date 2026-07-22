// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// vi.mock is hoisted above regular top-level statements, so the object it
// closes over must be too (vi.hoisted) or the factory sees a TDZ reference.
const whenReadyDeferred = vi.hoisted(() => ({ resolve: (() => {}) as () => void }));

vi.mock('electron', () => {
  const webContents = { once: vi.fn(), send: vi.fn(), toggleDevTools: vi.fn() };
  // The mocked constructor needs `as any` since vitest's mock factory can't
  // express the real BrowserWindow class shape — mirrors preload.test.ts practice.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const BrowserWindow = vi.fn(function (this: any) {
    this.webContents = webContents;
    this.on = vi.fn();
    this.loadFile = vi.fn();
    this.loadURL = vi.fn();
    this.isDestroyed = vi.fn(() => false);
  }) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  BrowserWindow.getAllWindows = vi.fn(() => []);
  return {
    app: {
      setName: vi.fn(),
      whenReady: vi.fn(
        () =>
          new Promise<void>((r) => {
            whenReadyDeferred.resolve = r;
          })
      ),
      on: vi.fn(),
      quit: vi.fn(),
      isPackaged: false,
    },
    BrowserWindow,
    Menu: { buildFromTemplate: vi.fn((t) => t), setApplicationMenu: vi.fn() },
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ filePaths: [] }) },
    ipcMain: { handle: vi.fn() },
    shell: { openExternal: vi.fn() },
  };
});
vi.mock('./ipc', () => ({ registerIpcHandlers: vi.fn() }));
vi.mock('./logger', () => ({
  initLogging: vi.fn(),
  attachWindowLogging: vi.fn(),
  log: vi.fn(),
  logWarn: vi.fn(),
  setCrashSink: vi.fn(),
}));
vi.mock('./crash-reporting', () => ({
  captureMainError: vi.fn(),
  flushPendingCrashReport: vi.fn().mockResolvedValue(undefined),
  handleRendererErrorReport: vi.fn(),
  recordAppEvent: vi.fn(),
}));
vi.mock('./telemetry', () => ({
  recordTelemetryEvent: vi.fn(),
}));
vi.mock('./updater', () => ({ openReleasePage: vi.fn() }));
vi.mock('./auto-updater', () => ({
  wireAutoUpdater: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));
vi.mock('electron-updater', () => ({ autoUpdater: {} }));
vi.mock('./checkout', () => ({ checkoutUrl: vi.fn((plan?: string) => `https://example.com/checkout/${plan}`) }));
vi.mock('./capture-guide', () => ({ captureGuideUrl: vi.fn(() => 'https://example.com/guide') }));
vi.mock('./feedback', () => ({
  openFeedback: vi.fn(),
  revealDiagnosticLog: vi.fn(),
  submitFeedback: vi.fn(),
}));
vi.mock('./license', () => ({ ensureTrialStarted: vi.fn() }));
vi.mock('./license-refresh', () => ({ maybeRefreshLicense: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./weekly-reminder', () => ({ scheduleWeeklyReminder: vi.fn() }));

import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { registerIpcHandlers } from './ipc';
import { initLogging, attachWindowLogging, setCrashSink } from './logger';
import { captureMainError, flushPendingCrashReport, handleRendererErrorReport, recordAppEvent } from './crash-reporting';
import { recordTelemetryEvent } from './telemetry';
import { openReleasePage } from './updater';
import { wireAutoUpdater, checkForUpdates, downloadUpdate, installUpdate } from './auto-updater';
import { checkoutUrl } from './checkout';
import { captureGuideUrl } from './capture-guide';
import { openFeedback, revealDiagnosticLog, submitFeedback } from './feedback';
import { ensureTrialStarted } from './license';
import { maybeRefreshLicense } from './license-refresh';
import { scheduleWeeklyReminder } from './weekly-reminder';
import {
  buildAugmentedPath,
  augmentPathForGuiLaunch,
  getPreloadPath,
  getWindowOptions,
  getMenuTemplate,
  openFileFromMenu,
  sendFeedbackFromMenu,
  type MenuDeps,
} from './main';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('buildAugmentedPath', () => {
  it('prepends the standard bin dirs ahead of an existing PATH', () => {
    const result = buildAugmentedPath('/custom/bin');
    expect(result.startsWith('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:')).toBe(true);
    expect(result.endsWith(':/custom/bin')).toBe(true);
  });

  it('does not duplicate entries already present', () => {
    const result = buildAugmentedPath('/usr/local/bin:/custom/bin');
    const segments = result.split(':');
    expect(segments.filter((s) => s === '/usr/local/bin')).toHaveLength(1);
  });

  it('works when PATH is undefined', () => {
    expect(buildAugmentedPath(undefined)).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
  });

  it('drops empty segments', () => {
    const result = buildAugmentedPath(':/custom/bin:');
    expect(result.split(':')).not.toContain('');
  });
});

describe('augmentPathForGuiLaunch', () => {
  const original = process.env.PATH;

  beforeEach(() => {
    process.env.PATH = '/custom/bin';
  });

  afterEach(() => {
    process.env.PATH = original;
  });

  it('sets process.env.PATH to the augmented value', () => {
    augmentPathForGuiLaunch();
    expect(process.env.PATH).toBe(buildAugmentedPath('/custom/bin'));
  });
});

describe('getPreloadPath', () => {
  it('joins the base dir with preload.js', () => {
    expect(getPreloadPath('/some/dir')).toBe(path.join('/some/dir', 'preload.js'));
  });
});

describe('getWindowOptions', () => {
  it('returns the exact expected window options', () => {
    const options = getWindowOptions('/p/preload.js');
    expect(options.width).toBe(1200);
    expect(options.height).toBe(800);
    expect(options.minWidth).toBe(900);
    expect(options.minHeight).toBe(600);
    expect(options.backgroundColor).toBe('#0d0d0d');
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/p/preload.js',
    });
  });
});

describe('getMenuTemplate', () => {
  function makeDeps(): MenuDeps {
    return {
      openFile: vi.fn(),
      toggleDevTools: vi.fn(),
      checkForUpdates: vi.fn(),
      openLicenseDialog: vi.fn(),
      sendFeedback: vi.fn(),
    };
  }

  it('has exactly File, View, Edit, Help top-level items in order', () => {
    const template = getMenuTemplate(makeDeps());
    expect(template.map((item) => item.label)).toEqual(['File', 'View', 'Edit', 'Help']);
  });

  it('File submenu: Open File… first, separator, quit last', () => {
    const template = getMenuTemplate(makeDeps());
    const fileSubmenu = template[0].submenu as Electron.MenuItemConstructorOptions[];
    expect(fileSubmenu[0].label).toBe('Open File…');
    expect(fileSubmenu[0].accelerator).toBe('CmdOrCtrl+O');
    expect(fileSubmenu.some((item) => item.type === 'separator')).toBe(true);
    expect(fileSubmenu[fileSubmenu.length - 1]).toEqual({ role: 'quit' });
  });

  it('View submenu contains Toggle DevTools and the expected roles', () => {
    const template = getMenuTemplate(makeDeps());
    const viewSubmenu = template[1].submenu as Electron.MenuItemConstructorOptions[];
    const toggleItem = viewSubmenu.find((item) => item.label === 'Toggle DevTools');
    expect(toggleItem?.accelerator).toBe('CmdOrCtrl+Alt+I');
    const roles = viewSubmenu.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(['reload', 'forceReload', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']);
  });

  it('Edit submenu roles are exactly the expected set, in order', () => {
    const template = getMenuTemplate(makeDeps());
    const editSubmenu = template[2].submenu as Electron.MenuItemConstructorOptions[];
    const roles = editSubmenu.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('Help submenu includes Check for Updates…, License…, Send Feedback…', () => {
    const template = getMenuTemplate(makeDeps());
    const helpSubmenu = template[3].submenu as Electron.MenuItemConstructorOptions[];
    const labels = helpSubmenu.map((item) => item.label).filter(Boolean);
    expect(labels).toContain('Check for Updates…');
    expect(labels).toContain('License…');
    expect(labels).toContain('Send Feedback…');
  });

  it('invoking each item click calls the matching dep exactly once', () => {
    const deps = makeDeps();
    const template = getMenuTemplate(deps);
    const fileSubmenu = template[0].submenu as Electron.MenuItemConstructorOptions[];
    const viewSubmenu = template[1].submenu as Electron.MenuItemConstructorOptions[];
    const helpSubmenu = template[3].submenu as Electron.MenuItemConstructorOptions[];

    (fileSubmenu.find((item) => item.label === 'Open File…')?.click as () => void)();
    expect(deps.openFile).toHaveBeenCalledTimes(1);

    (viewSubmenu.find((item) => item.label === 'Toggle DevTools')?.click as () => void)();
    expect(deps.toggleDevTools).toHaveBeenCalledTimes(1);

    (helpSubmenu.find((item) => item.label === 'Check for Updates…')?.click as () => void)();
    expect(deps.checkForUpdates).toHaveBeenCalledTimes(1);

    (helpSubmenu.find((item) => item.label === 'License…')?.click as () => void)();
    expect(deps.openLicenseDialog).toHaveBeenCalledTimes(1);

    (helpSubmenu.find((item) => item.label === 'Send Feedback…')?.click as () => void)();
    expect(deps.sendFeedback).toHaveBeenCalledTimes(1);
  });
});

describe('openFileFromMenu', () => {
  it('sends menu-open-file with the first path when a file is chosen', async () => {
    const win = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
    const showOpenDialog = vi.fn().mockResolvedValue({ filePaths: ['/a.wav', '/b.wav'] });

    openFileFromMenu(win, showOpenDialog);
    await flushMicrotasks();

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('menu-open-file', '/a.wav');
    expect(showOpenDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        properties: ['openFile'],
        filters: expect.arrayContaining([expect.objectContaining({ extensions: expect.arrayContaining(['wav', 'flac']) })]),
      })
    );
  });

  it('does not send when no file is chosen', async () => {
    const win = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
    const showOpenDialog = vi.fn().mockResolvedValue({ filePaths: [] });

    openFileFromMenu(win, showOpenDialog);
    await flushMicrotasks();

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('does nothing when the window is null', () => {
    const showOpenDialog = vi.fn();

    openFileFromMenu(null, showOpenDialog);

    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});

describe('sendFeedbackFromMenu', () => {
  beforeEach(() => {
    vi.mocked(openFeedback).mockClear();
  });

  it('pushes the renderer open to the in-app feedback form when a window exists', () => {
    const win = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;

    sendFeedbackFromMenu(win);

    expect(win.webContents.send).toHaveBeenCalledWith('open-feedback-dialog');
    expect(openFeedback).not.toHaveBeenCalled();
  });

  it('falls back to the mailto dialog when there is no window', () => {
    sendFeedbackFromMenu(null);

    expect(openFeedback).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle (whenReady callback)', () => {
  beforeAll(async () => {
    delete process.env.SOUND_BUDDY_RENDERER_URL;
    whenReadyDeferred.resolve();
    await flushMicrotasks();
    await flushMicrotasks();
  });

  it('registers IPC handlers once', () => {
    expect(registerIpcHandlers).toHaveBeenCalledTimes(1);
  });

  it('wires the electron-updater event listeners once', () => {
    expect(wireAutoUpdater).toHaveBeenCalledTimes(1);
  });

  it('calls ensureTrialStarted, initLogging, and maybeRefreshLicense once each', () => {
    expect(ensureTrialStarted).toHaveBeenCalledTimes(1);
    expect(initLogging).toHaveBeenCalledTimes(1);
    expect(maybeRefreshLicense).toHaveBeenCalledTimes(1);
  });

  it('arms the opt-in weekly reminder (#268) once at boot', () => {
    expect(scheduleWeeklyReminder).toHaveBeenCalledTimes(1);
  });

  it('registers exactly the expected ipcMain.handle channels', () => {
    const channels = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(new Set(channels)).toEqual(
      new Set([
        'check-for-updates',
        'open-release-page',
        'download-update',
        'install-update',
        'open-checkout',
        'open-feedback',
        'submit-feedback',
        'open-capture-guide',
        'reveal-diagnostics',
        'report-renderer-error',
        'record-app-event',
      ])
    );
  });

  it('wires the logger crash sink to captureMainError and flushes any pending crash report', () => {
    expect(setCrashSink).toHaveBeenCalledTimes(1);
    const sink = (setCrashSink as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const err = new Error('boom');
    sink(err, { fatal: true });
    expect(captureMainError).toHaveBeenCalledWith(err, { fatal: true });

    expect(flushPendingCrashReport).toHaveBeenCalledTimes(1);
  });

  it('records app_opened telemetry once at startup', () => {
    expect(recordTelemetryEvent).toHaveBeenCalledWith('app_opened');
  });

  it('report-renderer-error handler forwards the renderer input to handleRendererErrorReport', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'report-renderer-error')?.[1];
    const input = { message: 'boom', stack: 'Error: boom' };
    handler(undefined, input);
    expect(handleRendererErrorReport).toHaveBeenCalledWith(input);
  });

  it('record-app-event handler forwards the name to both recordAppEvent and recordTelemetryEvent', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'record-app-event')?.[1];
    handler(undefined, 'screen.live');
    expect(recordAppEvent).toHaveBeenCalledWith('screen.live');
    expect(recordTelemetryEvent).toHaveBeenCalledWith('screen.live');
  });

  it('open-checkout handler opens the checkout URL for the given plan', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'open-checkout')?.[1];
    handler(undefined, 'monthly');
    expect(shell.openExternal).toHaveBeenCalledWith(checkoutUrl('monthly'));
  });

  it('reveal-diagnostics handler calls revealDiagnosticLog', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'reveal-diagnostics')?.[1];
    handler();
    expect(revealDiagnosticLog).toHaveBeenCalled();
  });

  it('open-capture-guide handler opens the guide URL', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'open-capture-guide')?.[1];
    handler();
    expect(shell.openExternal).toHaveBeenCalledWith(captureGuideUrl());
  });

  it('check-for-updates and open-release-page handlers call their respective mocks', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const checkHandler = calls.find((c) => c[0] === 'check-for-updates')?.[1];
    const releaseHandler = calls.find((c) => c[0] === 'open-release-page')?.[1];

    checkHandler();
    expect(checkForUpdates).toHaveBeenCalledWith(expect.anything(), false);

    releaseHandler(undefined, 'https://example.com/release');
    expect(openReleasePage).toHaveBeenCalledWith('https://example.com/release');
  });

  it('download-update and install-update handlers delegate to the auto-updater adapter', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const downloadHandler = calls.find((c) => c[0] === 'download-update')?.[1];
    const installHandler = calls.find((c) => c[0] === 'install-update')?.[1];

    downloadHandler();
    expect(downloadUpdate).toHaveBeenCalledWith(expect.anything());

    installHandler();
    expect(installUpdate).toHaveBeenCalledWith(expect.anything());
  });

  it('open-feedback handler calls openFeedback', () => {
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'open-feedback')?.[1];
    handler();
    expect(openFeedback).toHaveBeenCalled();
  });

  it('submit-feedback handler forwards the renderer input to submitFeedback', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ ok: true });
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'submit-feedback')?.[1];
    const input = { message: 'hi', category: 'bug' };
    await handler(undefined, input);
    expect(submitFeedback).toHaveBeenCalledWith(input);
  });

  it('submit-feedback handler records feedback_sent telemetry when the result is ok', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ ok: true });
    vi.mocked(recordTelemetryEvent).mockClear();
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'submit-feedback')?.[1];

    await handler(undefined, { message: 'hi', category: 'bug' });

    expect(recordTelemetryEvent).toHaveBeenCalledWith('feedback_sent');
  });

  it('submit-feedback handler does not record telemetry when the result is not ok', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ ok: false, retryable: false, error: 'nope' });
    vi.mocked(recordTelemetryEvent).mockClear();
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const handler = calls.find((c) => c[0] === 'submit-feedback')?.[1];

    await handler(undefined, { message: 'hi', category: 'bug' });

    expect(recordTelemetryEvent).not.toHaveBeenCalledWith('feedback_sent');
  });

  it('constructs the BrowserWindow with the expected options', () => {
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1200,
        webPreferences: expect.objectContaining({ contextIsolation: true }),
      })
    );
  });

  it('attaches window logging and loads the built renderer file (not a dev URL)', () => {
    const win = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(attachWindowLogging).toHaveBeenCalledWith(win);
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining(path.join('renderer', 'dist', 'index.html')));
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it('runs a background update check when did-finish-load fires', () => {
    const win = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const onceCall = (win.webContents.once as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'did-finish-load'
    );
    onceCall[1]();
    expect(checkForUpdates).toHaveBeenCalledWith(expect.anything(), true);
  });

  describe('updaterDeps.send (guarded window.webContents.send)', () => {
    it('forwards to the current window when it exists and is not destroyed', () => {
      const win = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const deps = (wireAutoUpdater as ReturnType<typeof vi.fn>).mock.calls[0][0];
      win.webContents.send.mockClear();

      deps.send('update-available', { version: '1.2.3' });

      expect(win.webContents.send).toHaveBeenCalledWith('update-available', { version: '1.2.3' });
    });

    it('does nothing when the window is destroyed', () => {
      const win = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const deps = (wireAutoUpdater as ReturnType<typeof vi.fn>).mock.calls[0][0];
      win.webContents.send.mockClear();
      win.isDestroyed.mockReturnValue(true);

      deps.send('update-available', {});

      expect(win.webContents.send).not.toHaveBeenCalled();
      win.isDestroyed.mockReturnValue(false);
    });

    it('does nothing once the window has closed (mainWindow reset to null)', () => {
      const win = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const deps = (wireAutoUpdater as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const closedCall = (win.on as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) => c[0] === 'closed');
      closedCall[1]();
      win.webContents.send.mockClear();

      deps.send('update-available', {});

      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  it('sets the application menu', () => {
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it('sets the app name', () => {
    expect(app.setName).toHaveBeenCalledWith('SoundBuddy');
  });

  it('activate handler creates a new window only when none exist', () => {
    const constructCountBefore = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const activateCall = (app.on as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'activate');
    const activateHandler = activateCall?.[1] as () => void;

    (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);
    activateHandler();
    expect((BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(constructCountBefore + 1);

    const constructCountAfter = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValueOnce([{}]);
    activateHandler();
    expect((BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(constructCountAfter);
  });
});

describe('window-all-closed', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  function getHandler(): () => void {
    const call = (app.on as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'window-all-closed');
    return call?.[1] as () => void;
  }

  it('quits on non-darwin platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    (app.quit as ReturnType<typeof vi.fn>).mockClear();

    getHandler()();

    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('does not quit on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    (app.quit as ReturnType<typeof vi.fn>).mockClear();

    getHandler()();

    expect(app.quit).not.toHaveBeenCalled();
  });
});
