import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  FEEDBACK_EMAIL,
  feedbackMailtoUrl,
  revealDiagnosticLog,
  redactFeedbackText,
  submitFeedback,
  openFeedback,
} from './feedback';
import { getLogFilePath, logWarn } from './logger';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.7.0',
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
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

describe('openFeedback', () => {
  beforeEach(async () => {
    const { shell } = await import('electron');
    vi.mocked(shell.openExternal).mockReset();
    vi.mocked(logWarn).mockClear();
    (process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '14.5.0';
  });

  afterEach(() => {
    delete (process as unknown as { getSystemVersion?: () => string }).getSystemVersion;
  });

  it('opens the mailto URL via shell.openExternal', async () => {
    const { shell } = await import('electron');
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    await openFeedback();

    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(shell.openExternal).mock.calls[0];
    expect(url).toMatch(new RegExp(`^mailto:${FEEDBACK_EMAIL}\\?`));
  });

  it('logs a warning and does not throw when openExternal rejects', async () => {
    const { shell } = await import('electron');
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no default mail client'));

    await expect(openFeedback()).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('feedback mailto failed'));
  });
});

describe('redactFeedbackText', () => {
  it('redacts an email address', () => {
    expect(redactFeedbackText('contact pat@example.com now')).toBe(
      'contact [redacted-email] now'
    );
  });

  it('redacts a signed license string', () => {
    expect(redactFeedbackText('key SB1.abcDEF_123-x.sig')).toBe('key [redacted-license]');
  });

  it('redacts a macOS home path', () => {
    expect(redactFeedbackText('see /Users/patrick/Library/logs')).toBe(
      'see /Users/[redacted]/Library/logs'
    );
  });

  it('redacts all patterns combined', () => {
    expect(redactFeedbackText('pat@example.com SB1.a.b /Users/pat/file')).toBe(
      '[redacted-email] [redacted-license] /Users/[redacted]/file'
    );
  });

  it('passes through text with no sensitive content unchanged', () => {
    expect(redactFeedbackText('everything is fine here')).toBe('everything is fine here');
  });
});

describe('submitFeedback', () => {
  beforeEach(() => {
    (process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '14.5.0';
    electronState.isPackaged = false;
    delete process.env.SOUND_BUDDY_INGEST_API_URL;
    vi.mocked(logWarn).mockClear();
  });

  afterEach(() => {
    delete (process as unknown as { getSystemVersion?: () => string }).getSystemVersion;
    delete process.env.SOUND_BUDDY_INGEST_API_URL;
  });

  function okFetch() {
    return vi.fn().mockResolvedValue({ ok: true, status: 202 });
  }

  it('posts the exact allowlisted payload shape', async () => {
    const fetchFn = okFetch();

    const result = await submitFeedback(
      { message: 'it crashed on launch', category: 'bug', contactEmail: 'pat@example.test' },
      fetchFn
    );

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://soundbuddy.online/api/ingest');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      type: 'feedback',
      appVersion: '0.7.0',
      osVersion: '14.5.0',
      platform: `${process.platform}-${process.arch}`,
      message: 'it crashed on launch',
      category: 'bug',
      contactEmail: 'pat@example.test',
    });
    expect(Object.keys(body).sort()).toEqual(
      ['type', 'appVersion', 'osVersion', 'platform', 'message', 'category', 'contactEmail'].sort()
    );
  });

  it('omits contactEmail from the payload when not provided', async () => {
    const fetchFn = okFetch();

    await submitFeedback({ message: 'a thought', category: 'idea' }, fetchFn);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('contactEmail');
  });

  it('omits contactEmail from the payload when it is an empty string', async () => {
    const fetchFn = okFetch();

    await submitFeedback({ message: 'a thought', category: 'idea', contactEmail: '' }, fetchFn);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('contactEmail');
  });

  it('redacts a license key, home path, and email inside the message before sending', async () => {
    const fetchFn = okFetch();
    const message = 'mail me at pat@x.com, key SB1.abc.def, log in /Users/patrick/Library';

    await submitFeedback({ message, category: 'other' }, fetchFn);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.message).toBe(
      'mail me at [redacted-email], key [redacted-license], log in /Users/[redacted]/Library'
    );
  });

  it('trims the message before sending', async () => {
    const fetchFn = okFetch();

    await submitFeedback({ message: '  hello there  ', category: 'idea' }, fetchFn);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.message).toBe('hello there');
  });

  it('sets a bounded abort-timeout signal on the request', async () => {
    const fetchFn = okFetch();

    await submitFeedback({ message: 'hi', category: 'idea' }, fetchFn);

    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the global fetch when no fetchFn is injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitFeedback({ message: 'hi', category: 'idea' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  describe('validation', () => {
    it('rejects a non-object input', async () => {
      const fetchFn = vi.fn();

      const result = await submitFeedback('not an object', fetchFn);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; retryable: boolean }).retryable).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects an empty/whitespace-only message', async () => {
      const fetchFn = vi.fn();

      const result = await submitFeedback({ message: '   ', category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: expect.stringContaining('message'),
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects a message over 4000 chars', async () => {
      const fetchFn = vi.fn();

      const result = await submitFeedback({ message: 'x'.repeat(4001), category: 'bug' }, fetchFn);

      expect(result.ok).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects a category outside the allowed set', async () => {
      const fetchFn = vi.fn();

      const result = await submitFeedback({ message: 'hi', category: 'rant' }, fetchFn);

      expect(result.ok).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects a malformed contactEmail', async () => {
      const fetchFn = vi.fn();

      const result = await submitFeedback(
        { message: 'hi', category: 'bug', contactEmail: 'not-an-email' },
        fetchFn
      );

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: expect.stringContaining('email'),
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects a contactEmail over 254 chars, matching the worker\'s bound', async () => {
      const fetchFn = vi.fn();
      const overlong = `${'a'.repeat(250)}@x.com`; // > 254 chars

      const result = await submitFeedback(
        { message: 'hi', category: 'bug', contactEmail: overlong },
        fetchFn
      );

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: expect.stringContaining('email'),
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects locally (no fetch) a message that only exceeds 4000 chars after redaction expands it', async () => {
      const fetchFn = vi.fn();
      // Each "a@b.co" (6 chars) redacts to "[redacted-email]" (16 chars) — a
      // message under the raw 4000-char cap can still grow past it once
      // every short email-shaped match is replaced with the longer placeholder.
      const message = 'a@b.co '.repeat(560); // 3920 raw chars, well under 4000

      const result = await submitFeedback({ message, category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: expect.stringMatching(/too long/i),
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('response classification', () => {
    it('a 2xx response resolves ok: true', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(result).toEqual({ ok: true });
    });

    it('a 429 response is retryable with a busy message', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 });

      const result = await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: true,
        error: 'The feedback service is busy — try again in a minute.',
      });
    });

    it('a 5xx response is retryable with a busy message', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: true,
        error: 'The feedback service is busy — try again in a minute.',
      });
    });

    it('another non-2xx response is a non-retryable failure naming the support email', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400 });

      const result = await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: `Could not submit feedback — email ${FEEDBACK_EMAIL} instead.`,
      });
    });

    it('a thrown fetch/timeout error is a retryable connection failure', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

      const result = await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(result).toEqual({
        ok: false,
        retryable: true,
        error: 'Could not reach the feedback service — check your internet connection and try again.',
      });
    });

    it('never throws on a network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(
        submitFeedback({ message: 'hi', category: 'bug' }, fetchFn)
      ).resolves.toBeDefined();
    });
  });

  describe('logging', () => {
    it('logs outcomes only — never the message body or contact email', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      await submitFeedback(
        { message: 'super secret body', category: 'bug', contactEmail: 'pat@example.test' },
        fetchFn
      );

      expect(logWarn).toHaveBeenCalled();
      const loggedText = vi.mocked(logWarn).mock.calls.map((c) => String(c[0])).join(' ');
      expect(loggedText).not.toContain('super secret body');
      expect(loggedText).not.toContain('pat@example.test');
    });
  });

  describe('endpoint resolution (dev/e2e override)', () => {
    it('honors SOUND_BUDDY_INGEST_API_URL when not packaged', async () => {
      process.env.SOUND_BUDDY_INGEST_API_URL = 'https://staging.example/api/ingest';
      const fetchFn = okFetch();

      await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(fetchFn.mock.calls[0][0]).toBe('https://staging.example/api/ingest');
    });

    it('ignores the override and uses the default URL when packaged', async () => {
      electronState.isPackaged = true;
      process.env.SOUND_BUDDY_INGEST_API_URL = 'https://staging.example/api/ingest';
      const fetchFn = okFetch();

      await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(fetchFn.mock.calls[0][0]).toBe('https://soundbuddy.online/api/ingest');
    });

    it('falls back to the default URL when the override is unset', async () => {
      const fetchFn = okFetch();

      await submitFeedback({ message: 'hi', category: 'bug' }, fetchFn);

      expect(fetchFn.mock.calls[0][0]).toBe('https://soundbuddy.online/api/ingest');
    });
  });
});
