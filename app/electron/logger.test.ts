import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showMessageBoxSync: vi.fn() },
  BrowserWindow: {},
}));

import { app, dialog } from 'electron';
import { handleUncaughtException, getLogFilePath, initLogging, attachWindowLogging, setCrashSink } from './logger';

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
});
