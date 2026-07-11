import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showMessageBoxSync: vi.fn() },
  BrowserWindow: {},
}));

import { app, dialog } from 'electron';
import { handleUncaughtException, getLogFilePath } from './logger';

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
