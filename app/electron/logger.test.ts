import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showMessageBoxSync: vi.fn() },
  BrowserWindow: {},
}));

import { app, dialog } from 'electron';
import {
  handleUncaughtException,
  getLogFilePath,
  initLogging,
  attachWindowLogging,
  setCrashSink,
  log,
  logWarn,
  logError,
} from './logger';

describe('handleUncaughtException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOUND_BUDDY_DISABLE_CRASH_DIALOG;
  });

  it('restarts when the user picks Restart', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(0);

    handleUncaughtException(new Error('boom'));

    expect(app.relaunch).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it('quits without relaunching when the user picks Quit', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(1);

    handleUncaughtException(new Error('boom'));

    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it('logs the FATAL line before showing the dialog', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(1);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    handleUncaughtException(new Error('boom'));

    const fatalCall = consoleErrorSpy.mock.calls.find((call) =>
      String(call[0]).includes('FATAL') && String(call[0]).includes('uncaughtException')
    );
    expect(fatalCall).toBeDefined();
    expect(consoleErrorSpy.mock.invocationCallOrder[consoleErrorSpy.mock.calls.indexOf(fatalCall!)]).toBeLessThan(
      vi.mocked(dialog.showMessageBoxSync).mock.invocationCallOrder[0]
    );

    consoleErrorSpy.mockRestore();
  });

  it('names the log path in the dialog with Restart/Quit buttons', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(1);

    handleUncaughtException(new Error('boom'));

    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Restart', 'Quit'],
        detail: expect.stringContaining(getLogFilePath()),
      })
    );
  });

  it('skips the dialog and exits when automation guard is set', () => {
    process.env.SOUND_BUDDY_DISABLE_CRASH_DIALOG = '1';

    handleUncaughtException(new Error('boom'));

    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  });
});

describe('CrashSink (#473)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOUND_BUDDY_DISABLE_CRASH_DIALOG = '1';
  });

  afterEach(() => {
    setCrashSink(null);
    delete process.env.SOUND_BUDDY_DISABLE_CRASH_DIALOG;
  });

  it('handleUncaughtException invokes the sink with fatal:true before app.exit', () => {
    const sink = vi.fn();
    setCrashSink(sink);
    const err = new Error('boom');

    handleUncaughtException(err);

    expect(sink).toHaveBeenCalledWith(err, { fatal: true });
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(sink.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(app.exit).mock.invocationCallOrder[0]
    );
  });

  it('a throwing sink does not prevent app.exit', () => {
    setCrashSink(() => {
      throw new Error('sink exploded');
    });

    expect(() => handleUncaughtException(new Error('boom'))).not.toThrow();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it('the unhandledRejection handler invokes the sink with fatal:false', () => {
    const onSpy = vi.spyOn(process, 'on');
    initLogging();
    const rejectionHandler = onSpy.mock.calls.find((c) => c[0] === 'unhandledRejection')?.[1] as
      | ((reason: unknown) => void)
      | undefined;
    expect(rejectionHandler).toBeTypeOf('function');
    onSpy.mockRestore();

    const sink = vi.fn();
    setCrashSink(sink);
    const reason = new Error('rejected');

    rejectionHandler!(reason);

    expect(sink).toHaveBeenCalledWith(reason, { fatal: false });
  });

  it('the render-process-gone handler invokes the sink with fatal:false and a metadata-only Error', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const fakeWin = {
      webContents: {
        on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb),
      },
    } as unknown as Parameters<typeof attachWindowLogging>[0];

    attachWindowLogging(fakeWin);
    const sink = vi.fn();
    setCrashSink(sink);

    handlers.get('render-process-gone')!({}, { reason: 'crashed', exitCode: 133 });

    expect(sink).toHaveBeenCalledTimes(1);
    const [err, opts] = sink.mock.calls[0];
    expect(opts).toEqual({ fatal: false });
    expect((err as Error).message).toContain('render-process-gone');
    expect((err as Error).message).toContain('reason=crashed');
    expect((err as Error).message).toContain('exitCode=133');
  });

  it('a throwing sink on unhandledRejection does not crash the process', () => {
    const onSpy = vi.spyOn(process, 'on');
    initLogging();
    const rejectionHandler = onSpy.mock.calls.find((c) => c[0] === 'unhandledRejection')?.[1] as
      | ((reason: unknown) => void)
      | undefined;
    onSpy.mockRestore();
    expect(rejectionHandler).toBeTypeOf('function');

    setCrashSink(() => {
      throw new Error('sink exploded');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => rejectionHandler!(new Error('rejected'))).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('a throwing sink on render-process-gone does not crash the process', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const fakeWin = {
      webContents: {
        on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb),
      },
    } as unknown as Parameters<typeof attachWindowLogging>[0];

    attachWindowLogging(fakeWin);
    setCrashSink(() => {
      throw new Error('sink exploded');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      handlers.get('render-process-gone')!({}, { reason: 'crashed', exitCode: 133 })
    ).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('log/logWarn/logError formatting', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('log() writes an INFO line to console.log', () => {
    log('hello world');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] hello world'));
  });

  it('logWarn() writes a WARN line to console.log (not console.error)', () => {
    logWarn('careful now');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] careful now'));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logError() with an Error carrying a stack includes the stack in the ERROR line', () => {
    const err = new Error('boom');
    logError('operation failed', err);
    const line = consoleErrorSpy.mock.calls[0][0] as string;
    expect(line).toContain('[ERROR] operation failed:');
    expect(line).toContain('Error: boom');
    // The stack (control chars sanitized to spaces) carries this frame's file.
    expect(line).toContain('logger.test.ts');
  });

  it('logError() with a non-Error value stringifies it', () => {
    logError('operation failed', 'a plain string reason');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('operation failed: a plain string reason')
    );
  });

  it('logError() with no second arg logs just the message', () => {
    logError('operation failed');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\] operation failed$/)
    );
  });
});

describe('initLogging', () => {
  afterEach(() => {
    delete process.env.SB_LOG_FILE;
    vi.mocked(app.getPath).mockImplementation(() => '/tmp');
  });

  it('uses SB_LOG_FILE when set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logger-'));
    const target = path.join(dir, 'custom.log');
    process.env.SB_LOG_FILE = target;

    const filePath = initLogging();

    expect(filePath).toBe(target);
    expect(getLogFilePath()).toBe(target);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to userData when app.getPath("logs") throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logger-fallback-'));
    vi.mocked(app.getPath).mockImplementation((name: string) => {
      if (name === 'logs') throw new Error('no logs dir on this platform');
      return dir;
    });

    const filePath = initLogging();

    expect(filePath).toBe(path.join(dir, 'sound-buddy.log'));
    expect(getLogFilePath()).toBe(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a log() call after initLogging writes through logStream to the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logger-write-'));
    const target = path.join(dir, 'write-test.log');
    process.env.SB_LOG_FILE = target;

    initLogging();
    log('distinctive log line for the write test');

    // logStream writes asynchronously; give it a tick to flush.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const contents = fs.readFileSync(target, 'utf8');
        expect(contents).toContain('distinctive log line for the write test');
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      }, 50);
    });
  });
});

describe('attachWindowLogging', () => {
  function fakeWindow() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const win = {
      webContents: {
        on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb),
      },
    } as unknown as Parameters<typeof attachWindowLogging>[0];
    return { win, handlers };
  }

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('console-message level 0 (verbose/log) is skipped', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('console-message')!({}, 0, 'a debug message', 12, 'file.js');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('console-message level 1 logs as RENDERER-WARN', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('console-message')!({}, 1, 'a warning', 12, 'file.js');

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[RENDERER-WARN] a warning (file.js:12)'));
  });

  it('console-message level 2+ logs as RENDERER-ERROR', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('console-message')!({}, 2, 'an error', 34, 'file.js');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RENDERER-ERROR] an error (file.js:34)')
    );
  });

  it('unresponsive logs an ERROR line', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('unresponsive')!();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('renderer became unresponsive'));
  });

  it('preload-error logs the preload path and error stack/message', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('preload-error')!({}, '/path/to/preload.js', new Error('preload broke'));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('preload-error (/path/to/preload.js): Error: preload broke')
    );
  });

  it('did-fail-load with code -3 (ERR_ABORTED) is skipped', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('did-fail-load')!({}, -3, 'aborted', 'https://example.test');

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('did-fail-load with another code logs an ERROR line', () => {
    const { win, handlers } = fakeWindow();
    attachWindowLogging(win);

    handlers.get('did-fail-load')!({}, -6, 'file not found', 'https://example.test');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('did-fail-load: code=-6 "file not found" url=https://example.test')
    );
  });
});
