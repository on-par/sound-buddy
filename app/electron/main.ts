import { app, BrowserWindow, Menu, dialog } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc';
import { initLogging, attachWindowLogging, log } from './logger';

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
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  augmentPathForGuiLaunch();
  initLogging();
  registerIpcHandlers();
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
