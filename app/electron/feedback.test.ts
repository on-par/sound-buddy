import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { FEEDBACK_EMAIL, feedbackMailtoUrl, revealDiagnosticLog } from './feedback';
import { getLogFilePath } from './logger';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('./logger', () => ({
  getLogFilePath: vi.fn(),
  logWarn: vi.fn(),
}));

describe('feedbackMailtoUrl', () => {
  it('returns a mailto URL addressed to support', () => {
    expect(feedbackMailtoUrl('0.7.0', '14.5.0')).toMatch(
      new RegExp(`^mailto:${FEEDBACK_EMAIL}\\?`)
    );
  });

  it('encodes the feedback subject', () => {
    const url = new URL(feedbackMailtoUrl('0.7.0', '14.5.0'));
    expect(url.searchParams.get('subject')).toBe('Sound Buddy Feedback');
    expect(feedbackMailtoUrl('0.7.0', '14.5.0')).toContain('subject=Sound%20Buddy%20Feedback');
  });

  it('includes the app and macOS versions in the decoded body', () => {
    const url = new URL(feedbackMailtoUrl('0.7.0-beta 1', '14.5.0 (23F79)'));
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('App version: 0.7.0-beta 1');
    expect(body).toContain('macOS: 14.5.0 (23F79)');
  });

  it('URL-encodes the body', () => {
    const raw = feedbackMailtoUrl('0.7.0 beta', '14.5.0 test');
    expect(raw).toContain('body=%0A%0A---%0AApp%20version%3A%200.7.0%20beta%0AmacOS%3A%2014.5.0%20test');
  });
});

describe('revealDiagnosticLog', () => {
  beforeEach(async () => {
    vi.mocked(getLogFilePath).mockReset();
    vi.mocked(fs.existsSync).mockReset();
    const { shell } = await import('electron');
    vi.mocked(shell.showItemInFolder).mockClear();
  });

  it('reveals the log file in Finder when it exists', async () => {
    const { shell } = await import('electron');
    vi.mocked(getLogFilePath).mockReturnValue('/Users/test/Library/Logs/SoundBuddy/app.log');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = revealDiagnosticLog();

    expect(shell.showItemInFolder).toHaveBeenCalledWith('/Users/test/Library/Logs/SoundBuddy/app.log');
    expect(result).toEqual({ revealed: true });
  });

  it('does not reveal and reports missing when the log file does not exist', async () => {
    const { shell } = await import('electron');
    vi.mocked(getLogFilePath).mockReturnValue('/Users/test/Library/Logs/SoundBuddy/app.log');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = revealDiagnosticLog();

    expect(shell.showItemInFolder).not.toHaveBeenCalled();
    expect(result).toEqual({ revealed: false, missing: true });
  });

  it('does not throw and reports missing when there is no log path yet', () => {
    vi.mocked(getLogFilePath).mockReturnValue('');

    expect(() => revealDiagnosticLog()).not.toThrow();
    expect(revealDiagnosticLog()).toEqual({ revealed: false, missing: true });
  });
});
