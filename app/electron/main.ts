// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc';
import { initLogging, attachWindowLogging, log } from './logger';
import { checkForUpdates, openReleasePage } from './updater';
import { ensureTrialStarted } from './license';

// Deterministic app name so logs land in ~/Library/Logs/SoundBuddy (not "Electron").
app.setName('SoundBuddy');

// A GUI app launched from Finder inherits a minimal PATH (/usr/bin:/bin) that
// excludes Homebrew, so execFile/spawn can't find sox, ffprobe, or python3.
// Prepend the usual install locations. No-op when launched from a shell that
// already has them.
function augmentPathForGuiLaunch(): void {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = (process.env.PATH ?? '').split(':').filter(Boolean);
  process.env.PATH = [...extra, ...current].filter((p, i, a) => a.indexOf(p) === i).join(':');
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  attachWindowLogging(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

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
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            dialog
              .showOpenDialog(mainWindow!, {
                properties: ['openFile'],
                filters: [
                  { name: 'Audio Files', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] },
                  { name: 'All Files', extensions: ['*'] },
                ],
              })
              .then(({ filePaths }) => {
                if (filePaths.length > 0 && mainWindow) {
                  mainWindow.webContents.send('menu-open-file', filePaths[0]);
                }
              });
          },
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
          click: () => {
            mainWindow?.webContents.toggleDevTools();
          },
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
          click: () => {
            void checkForUpdates(mainWindow, false);
          },
        },
        { type: 'separator' },
        {
          // License entry/status (#54) — the renderer owns the dialog; the
          // header badge opens the same one.
          label: 'License…',
          click: () => {
            mainWindow?.webContents.send('open-license-dialog');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  augmentPathForGuiLaunch();
  initLogging();
  // Start the 14-day Pro trial on first launch (#61) before the renderer reads
  // the license, so a new user boots straight into Pro (no free-tier flash).
  ensureTrialStarted();
  registerIpcHandlers();

  // Manual update check + "Download" button (opens the release page in browser).
  ipcMain.handle('check-for-updates', () => checkForUpdates(mainWindow, false));
  ipcMain.handle('open-release-page', (_event, url?: string) => openReleasePage(url));

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
