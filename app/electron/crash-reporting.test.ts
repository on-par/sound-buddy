import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  redactCrashText,
  recordAppEvent,
  resetCrashReportingForTest,
  buildCrashPayload,
  submitCrashPayload,
  captureMainError,
  flushPendingCrashReport,
  handleRendererErrorReport,
  MAX_CRASH_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  MAX_RECENT_EVENTS,
  MAX_REPORTS_PER_SESSION,
  PENDING_CRASH_FILENAME,
} from './crash-reporting';
import { getSettings } from './settings';
import { logWarn } from './logger';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.7.0',
    getPath: (name: string) => `/tmp/userdata-${name}`,
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('./logger', () => ({
  logWarn: vi.fn(),
}));

vi.mock('./settings', () => ({
  getSettings: vi.fn(),
}));

function withCrashReportingEnabled(enabled: boolean): void {
  vi.mocked(getSettings).mockReturnValue({
    crashReportingEnabled: enabled,
  } as ReturnType<typeof getSettings>);
}

describe('crash-reporting', () => {
  beforeEach(() => {
    resetCrashReportingForTest();
    (process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '14.5.0';
    electronState.isPackaged = false;
    vi.mocked(logWarn).mockClear();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.unlinkSync).mockReset();
    withCrashReportingEnabled(false);
  });

  afterEach(() => {
    delete (process as unknown as { getSystemVersion?: () => string }).getSystemVersion;
    vi.unstubAllGlobals();
  });

  describe('redactCrashText', () => {
    it('redacts an email address', () => {
      expect(redactCrashText('contact pat@example.com now')).toBe('contact [redacted-email] now');
    });

    it('redacts a signed license string', () => {
      expect(redactCrashText('key SB1.abcDEF_123-x.sig')).toBe('key [redacted-license]');
    });

    it('reduces a macOS path with spaced segments to its basename', () => {
      expect(redactCrashText('/Users/patrick/Music/Sound Buddy/worship set.wav')).toBe(
        '…/worship set.wav'
      );
    });

    it('keeps only the basename of a stack frame path', () => {
      expect(redactCrashText('at (/Users/patrick/dev/app/dist/main.js:10:5)')).toBe(
        'at (…/main.js:10:5)'
      );
    });

    it('passes through text with no sensitive content unchanged', () => {
      expect(redactCrashText('everything is fine here')).toBe('everything is fine here');
    });
  });

  describe('recordAppEvent', () => {
    it('accepts a pattern-valid name', () => {
      recordAppEvent('screen.live');
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toEqual(['screen.live']);
    });

    it('drops a non-string value', () => {
      recordAppEvent(42);
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toBeUndefined();
    });

    it('drops an empty string', () => {
      recordAppEvent('');
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toBeUndefined();
    });

    it('drops an uppercase name', () => {
      recordAppEvent('Screen.Live');
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toBeUndefined();
    });

    it('drops a name with spaces', () => {
      recordAppEvent('screen live');
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toBeUndefined();
    });

    it('drops a name over 64 chars', () => {
      recordAppEvent('a'.repeat(65));
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toBeUndefined();
    });

    it('caps the buffer at MAX_RECENT_EVENTS, evicting the oldest', () => {
      for (let i = 0; i < MAX_RECENT_EVENTS + 5; i++) recordAppEvent(`app.tick${i}`);
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.recentEvents).toHaveLength(MAX_RECENT_EVENTS);
      expect(payload.recentEvents?.[0]).toBe('app.tick5');
      expect(payload.recentEvents?.[MAX_RECENT_EVENTS - 1]).toBe(`app.tick${MAX_RECENT_EVENTS + 4}`);
    });

    it('a "screen." prefixed name updates the route used by the next payload', () => {
      recordAppEvent('app.launch');
      recordAppEvent('screen.live');
      const payload = buildCrashPayload({ message: 'x', processType: 'main' });
      expect(payload.route).toBe('screen.live');
    });
  });

  describe('buildCrashPayload', () => {
    it('has the exact allowlisted key set with everything present', () => {
      recordAppEvent('screen.live');
      const payload = buildCrashPayload({
        message: 'boom',
        stack: 'Error: boom',
        processType: 'renderer',
      });
      expect(Object.keys(payload).sort()).toEqual(
        [
          'type',
          'appVersion',
          'osVersion',
          'platform',
          'message',
          'stack',
          'processType',
          'route',
          'recentEvents',
        ].sort()
      );
    });

    it('omits stack/route/recentEvents when unset', () => {
      const payload = buildCrashPayload({ message: 'boom', processType: 'main' });
      expect(payload).not.toHaveProperty('stack');
      expect(payload).not.toHaveProperty('route');
      expect(payload).not.toHaveProperty('recentEvents');
    });

    it('truncates the message to MAX_CRASH_MESSAGE_LENGTH after redaction', () => {
      const payload = buildCrashPayload({
        message: 'x'.repeat(MAX_CRASH_MESSAGE_LENGTH + 500),
        processType: 'main',
      });
      expect(payload.message).toHaveLength(MAX_CRASH_MESSAGE_LENGTH);
    });

    it('truncates the stack to MAX_STACK_LENGTH after redaction', () => {
      const payload = buildCrashPayload({
        message: 'boom',
        stack: 'x'.repeat(MAX_STACK_LENGTH + 500),
        processType: 'main',
      });
      expect(payload.stack).toHaveLength(MAX_STACK_LENGTH);
    });
  });

  describe('submitCrashPayload', () => {
    const payload = () => buildCrashPayload({ message: 'boom', processType: 'main' });

    it('never calls fetchFn when opt-in is off', async () => {
      withCrashReportingEnabled(false);
      const fetchFn = vi.fn();

      const result = await submitCrashPayload(payload(), fetchFn);

      expect(result).toEqual({ sent: false });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('POSTs the payload as JSON to the ingest URL when opt-in is on', async () => {
      withCrashReportingEnabled(true);
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await submitCrashPayload(payload(), fetchFn);

      expect(result).toEqual({ sent: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe('https://soundbuddy.online/api/ingest');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual(payload());
    });

    it('sends up to MAX_REPORTS_PER_SESSION and blocks further attempts', async () => {
      withCrashReportingEnabled(true);
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      for (let i = 0; i < MAX_REPORTS_PER_SESSION; i++) {
        const result = await submitCrashPayload(payload(), fetchFn);
        expect(result).toEqual({ sent: true });
      }
      const sixth = await submitCrashPayload(payload(), fetchFn);

      expect(sixth).toEqual({ sent: false });
      expect(fetchFn).toHaveBeenCalledTimes(MAX_REPORTS_PER_SESSION);
    });

    it('a non-ok response resolves sent:false without throwing', async () => {
      withCrashReportingEnabled(true);
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await submitCrashPayload(payload(), fetchFn);

      expect(result).toEqual({ sent: false });
    });

    it('a thrown fetch error resolves sent:false without throwing', async () => {
      withCrashReportingEnabled(true);
      const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

      await expect(submitCrashPayload(payload(), fetchFn)).resolves.toEqual({ sent: false });
    });

    it('logs outcomes only — never the message or stack contents', async () => {
      withCrashReportingEnabled(true);
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      await submitCrashPayload(
        buildCrashPayload({ message: 'super secret crash text', processType: 'main' }),
        fetchFn
      );

      expect(logWarn).toHaveBeenCalled();
      const loggedText = vi.mocked(logWarn).mock.calls.map((c) => String(c[0])).join(' ');
      expect(loggedText).not.toContain('super secret crash text');
    });
  });

  describe('captureMainError', () => {
    it('fatal + enabled writes a pending-crash file that parses back with processType main', () => {
      withCrashReportingEnabled(true);

      captureMainError(new Error('boom'), { fatal: true });

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath, contents] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(String(filePath)).toContain(PENDING_CRASH_FILENAME);
      expect(JSON.parse(contents as string).processType).toBe('main');
    });

    it('fatal + disabled does not write', () => {
      withCrashReportingEnabled(false);

      captureMainError(new Error('boom'), { fatal: true });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('non-fatal + enabled attempts a submit via the global fetch', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      vi.stubGlobal('fetch', fetchMock);

      captureMainError(new Error('boom'), { fatal: false });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows a writeFileSync throw', () => {
      withCrashReportingEnabled(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('disk full');
      });

      expect(() => captureMainError(new Error('boom'), { fatal: true })).not.toThrow();
    });
  });

  describe('flushPendingCrashReport', () => {
    it('submits then unlinks when a pending file exists and opt-in is on', async () => {
      withCrashReportingEnabled(true);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(buildCrashPayload({ message: 'boom', processType: 'main' }))
      );
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      await flushPendingCrashReport(fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    });

    it('unlinks without fetching when opt-in is off', async () => {
      withCrashReportingEnabled(false);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(buildCrashPayload({ message: 'boom', processType: 'main' }))
      );
      const fetchFn = vi.fn();

      await flushPendingCrashReport(fetchFn);

      expect(fetchFn).not.toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no pending file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const fetchFn = vi.fn();

      await flushPendingCrashReport(fetchFn);

      expect(fetchFn).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('unlinks and does not throw on malformed pending JSON', async () => {
      withCrashReportingEnabled(true);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ not json');
      const fetchFn = vi.fn();

      await expect(flushPendingCrashReport(fetchFn)).resolves.toBeUndefined();

      expect(fetchFn).not.toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRendererErrorReport', () => {
    it('submits a valid {message, stack} with processType renderer', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      vi.stubGlobal('fetch', fetchMock);

      handleRendererErrorReport({ message: 'boom', stack: 'Error: boom' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.processType).toBe('renderer');
    });

    it('drops a non-object input', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      handleRendererErrorReport('not an object');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops input missing a message', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      handleRendererErrorReport({ stack: 'x' });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops a non-string stack', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      handleRendererErrorReport({ message: 'boom', stack: 42 });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('truncates over-length message and stack', () => {
      withCrashReportingEnabled(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      vi.stubGlobal('fetch', fetchMock);

      handleRendererErrorReport({
        message: 'x'.repeat(MAX_CRASH_MESSAGE_LENGTH + 500),
        stack: 'y'.repeat(MAX_STACK_LENGTH + 500),
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.message).toHaveLength(MAX_CRASH_MESSAGE_LENGTH);
      expect(body.stack).toHaveLength(MAX_STACK_LENGTH);
    });
  });
});
