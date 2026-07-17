// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc';
import { initLogging, attachWindowLogging, log } from './logger';
import { checkForUpdates, openReleasePage } from './updater';
import { checkoutUrl } from './checkout';
import { captureGuideUrl } from './capture-guide';
import { openFeedback, revealDiagnosticLog, submitFeedback } from './feedback';
import { ensureTrialStarted } from './license';
import { maybeRefreshLicense } from './license-refresh';

// Deterministic app name so logs land in ~/Library/Logs/SoundBuddy (not "Electron").
app.setName('SoundBuddy');

export function buildAugmentedPath(currentPath: string | undefined): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = (currentPath ?? '').split(':').filter(Boolean);
  return [...extra, ...current].filter((p, i, a) => a.indexOf(p) === i).join(':');
}

// A GUI app launched from Finder inherits a minimal PATH (/usr/bin:/bin) that
// excludes Homebrew, so execFile/spawn can't find sox, ffprobe, or python3.
// Prepend the usual install locations. No-op when launched from a shell that
// already has them.
export function augmentPathForGuiLaunch(): void {
  process.env.PATH = buildAugmentedPath(process.env.PATH);
}

export function getPreloadPath(baseDir: string): string {
  return path.join(baseDir, 'preload.js');
}

export function getWindowOptions(preloadPath: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  };
}

export function openFileFromMenu(
  win: BrowserWindow | null,
  showOpenDialog: typeof dialog.showOpenDialog
): void {
  if (!win) return;
  void showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  }).then(({ filePaths }) => {
    if (filePaths.length > 0 && win) {
      win.webContents.send('menu-open-file', filePaths[0]);
    }
  });
}

/**
 * Help ▸ "Send Feedback…" click handler (#472). When a window exists, push
 * the renderer open to the in-app feedback form; when it doesn't (e.g. the
 * user closed the last window on macOS, where the app stays running), fall
 * back to the mailto: dialog so the menu item still does something instead
 * of silently no-oping.
 */
export function sendFeedbackFromMenu(win: BrowserWindow | null): void {
  if (win) {
    win.webContents.send('open-feedback-dialog');
  } else {
    void openFeedback();
  }
}

export interface MenuDeps {
  openFile: () => void;
  toggleDevTools: () => void;
  checkForUpdates: () => void;
  openLicenseDialog: () => void;
  sendFeedback: () => void;
}

export function getMenuTemplate(deps: MenuDeps): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => deps.openFile(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Alt+I',
          click: () => deps.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => deps.checkForUpdates(),
        },
        { type: 'separator' },
        {
          // License entry/status (#54) — the renderer owns the dialog; the
          // header badge opens the same one.
          label: 'License…',
          click: () => deps.openLicenseDialog(),
        },
        {
          label: 'Send Feedback…',
          click: () => deps.sendFeedback(),
        },
      ],
    },
  ];
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow(getWindowOptions(getPreloadPath(__dirname)));

  attachWindowLogging(mainWindow);
  // Dev: `npm run dev` starts the renderer's Vite dev server and sets this so
  // HMR works. Everything else (built-and-launched for e2e, `npm run start`,
  // and the packaged app) loads the built single-file bundle — never a dev
  // URL, even if the env var somehow leaked into a packaged build (#303).
  const devServerUrl = !app.isPackaged && process.env.SOUND_BUDDY_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
  }

  // Quiet background update check shortly after the UI is ready.
  mainWindow.webContents.once('did-finish-load', () => {
    void checkForUpdates(mainWindow, true);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu(): void {
  const template = getMenuTemplate({
    openFile: () => openFileFromMenu(mainWindow, dialog.showOpenDialog.bind(dialog)),
    toggleDevTools: () => mainWindow?.webContents.toggleDevTools(),
    checkForUpdates: () => void checkForUpdates(mainWindow, false),
    openLicenseDialog: () => mainWindow?.webContents.send('open-license-dialog'),
    // #472: the Help-menu item now opens the in-app feedback form; the
    // preserved mailto (openFeedback/'open-feedback') is both the dialog's
    // explicit "Email instead" fallback on a non-retryable failure, and
    // sendFeedbackFromMenu's own fallback when there's no window to push to.
    sendFeedback: () => sendFeedbackFromMenu(mainWindow),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  augmentPathForGuiLaunch();
  initLogging();
  // Start the 14-day Pro trial on first launch (#61) before the renderer reads
  // the license, so a new user boots straight into Pro (no free-tier flash).
  ensureTrialStarted();
  registerIpcHandlers();
  // Automatic license refresh (#117), fire-and-forget on every launch — only
  // makes a request when a subscription key is within 7 days of expiry or
  // already in grace; never delays window creation.
  void maybeRefreshLicense();

  // Manual update check + "Download" button (opens the release page in browser).
  ipcMain.handle('check-for-updates', () => checkForUpdates(mainWindow, false));
  ipcMain.handle('open-release-page', (_event, url?: string) => openReleasePage(url));

  // Upgrade CTA (#58): open the hosted Stripe checkout for a plan in the user's
  // browser. Sound Buddy never handles card data; the real Payment Links are
  // provisioned in #56 (checkout.ts holds the placeholder/override mapping).
  ipcMain.handle('open-checkout', (_event, plan?: string) => {
    void shell.openExternal(checkoutUrl(plan));
  });
  ipcMain.handle('open-feedback', () => openFeedback());
  ipcMain.handle('submit-feedback', (_event, input) => submitFeedback(input));
  // Capture guidance (#142): "Grade your own service" panel's "Read the full
  // guide" CTA opens the hosted docs page in the user's browser.
  ipcMain.handle('open-capture-guide', () => {
    void shell.openExternal(captureGuideUrl());
  });
  ipcMain.handle('reveal-diagnostics', () => revealDiagnosticLog());

  createWindow();
  log('main window created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
