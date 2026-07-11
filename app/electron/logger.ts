// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ─── File logger ────────────────────────────────────────────────────────────
// Zero-dependency logger that writes to both stdout/stderr (so a foreground or
// backgrounded `npm start` surfaces everything) and a persistent log file.
// Captures: process-level crashes, main-process errors, renderer console
// output, and renderer/GPU crashes.

let logStream: fs.WriteStream | null = null;
let logFilePath = '';

function ts(): string {
  return new Date().toISOString();
}

// Renderer console messages, AI/network error text, and preload crash detail
// all flow through write() and none of it is trusted — strip control
// characters (CR/LF/other C0 codes) before it hits the terminal or the
// persistent log file so it can't forge extra log lines or inject terminal
// escape sequences (CWE-117 log injection / CWE-912 untrusted data to file).
function sanitizeLogText(msg: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars
  return msg.replace(/[\x00-\x1f]/g, ' ');
}

function write(level: string, msg: string): void {
  const line = `[${ts()}] [${level}] ${sanitizeLogText(msg)}`;
  if (level === 'ERROR' || level === 'FATAL' || level.endsWith('-ERROR')) {
    console.error(line);
  } else {
    console.log(line);
  }
  // `line` is already run through sanitizeLogText() above, which strips the
  // control characters (CR/LF/etc.) this query cares about — CodeQL's
  // HttpToFileAccess query doesn't have a built-in sanitizer for custom
  // string transforms, so it can't see that.
  // codeql[js/http-to-file-access]
  logStream?.write(line + '\n');
}

export function getLogFilePath(): string {
  return logFilePath;
}

export const log = (msg: string): void => write('INFO', msg);
export const logWarn = (msg: string): void => write('WARN', msg);
export function logError(msg: string, err?: unknown): void {
  const detail =
    err instanceof Error ? (err.stack ?? err.message) : err !== undefined ? String(err) : '';
  write('ERROR', detail ? `${msg}: ${detail}` : msg);
}

/** Initialize the log file + process-level crash handlers. Call once, early. */
export function initLogging(): string {
  // SB_LOG_FILE overrides the location (handy for CI / watching in a fixed spot).
  if (process.env.SB_LOG_FILE) {
    logFilePath = process.env.SB_LOG_FILE;
  } else {
    let dir: string;
    try {
      dir = app.getPath('logs'); // macOS: ~/Library/Logs/<appName>
    } catch {
      dir = app.getPath('userData');
    }
    logFilePath = path.join(dir, 'sound-buddy.log');
  }

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  write('INFO', `─── Sound Buddy started (pid ${process.pid}, electron ${process.versions.electron}) ───`);
  write('INFO', `log file: ${logFilePath}`);

  process.on('uncaughtException', (err) => {
    write('FATAL', `uncaughtException: ${err?.stack ?? String(err)}`);
  });
  process.on('unhandledRejection', (reason) => {
    write('ERROR', `unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });

  return logFilePath;
}

/** Capture renderer console output and renderer/preload crashes for a window. */
export function attachWindowLogging(win: BrowserWindow): void {
  const wc = win.webContents;

  // level: 0=verbose/log, 1=warning, 2=error, 3=info (Electron numeric levels).
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level < 1) return; // skip plain logs; keep warnings + errors
    const tag = level === 2 ? 'RENDERER-ERROR' : 'RENDERER-WARN';
    write(tag, `${message} (${sourceId}:${line})`);
  });

  wc.on('render-process-gone', (_e, details) => {
    write('FATAL', `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  wc.on('unresponsive', () => write('ERROR', 'renderer became unresponsive'));

  wc.on('preload-error', (_e, preloadPath, err) => {
    write('ERROR', `preload-error (${preloadPath}): ${err.stack ?? err.message}`);
  });

  wc.on('did-fail-load', (_e, code, desc, url) => {
    // -3 is ERR_ABORTED, common/benign during navigation; skip it.
    if (code === -3) return;
    write('ERROR', `did-fail-load: code=${code} "${desc}" url=${url}`);
  });
}
