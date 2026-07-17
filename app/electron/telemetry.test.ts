// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  TELEMETRY_EVENTS,
  isApprovedTelemetryEvent,
  coarseTimestamp,
  getOrCreateInstallId,
  recordTelemetryEvent,
  flushTelemetry,
  clearTelemetryState,
  resetTelemetryForTest,
  MAX_QUEUE,
  FLUSH_INTERVAL_MS,
} from './telemetry';
import { getSettings } from './settings';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.7.0',
    getPath: (name: string) => `/tmp/userdata-${name}`,
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
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

import { logWarn } from './logger';

function withUsageSignalEnabled(enabled: boolean): void {
  vi.mocked(getSettings).mockReturnValue({
    usageSignalEnabled: enabled,
  } as ReturnType<typeof getSettings>);
}

const FIXED_NOW = new Date('2026-07-17T14:23:45.000Z');
const now = () => FIXED_NOW;

describe('telemetry', () => {
  beforeEach(() => {
    resetTelemetryForTest();
    (process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '14.5.0';
    electronState.isPackaged = false;
    vi.mocked(logWarn).mockClear();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.existsSync).mockReset().mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.unlinkSync).mockReset();
    withUsageSignalEnabled(false);
  });

  afterEach(() => {
    delete (process as unknown as { getSystemVersion?: () => string }).getSystemVersion;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('coarseTimestamp', () => {
    it('truncates to the hour', () => {
      expect(coarseTimestamp(new Date('2026-07-17T14:23:45.000Z'))).toBe('2026-07-17T14:00:00Z');
    });
  });

  describe('isApprovedTelemetryEvent', () => {
    it('accepts every documented event name', () => {
      for (const name of TELEMETRY_EVENTS) {
        expect(isApprovedTelemetryEvent(name)).toBe(true);
      }
    });

    it('rejects an unknown name', () => {
      expect(isApprovedTelemetryEvent('church_name')).toBe(false);
    });

    it('rejects a non-string value', () => {
      expect(isApprovedTelemetryEvent(42)).toBe(false);
      expect(isApprovedTelemetryEvent(null)).toBe(false);
      expect(isApprovedTelemetryEvent(undefined)).toBe(false);
    });

    it('rejects a pattern-valid but unapproved name', () => {
      expect(isApprovedTelemetryEvent('app.opened')).toBe(false);
    });
  });

  describe('getOrCreateInstallId', () => {
    it('generates and persists a fresh install id when no file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const id = getOrCreateInstallId();

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath, contents] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(String(filePath)).toContain('telemetry-install-id.json');
      expect(JSON.parse(contents as string)).toEqual({ installId: id });
    });

    it('reads back a previously persisted install id', () => {
      const existing = '11111111-1111-1111-1111-111111111111';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ installId: existing }));

      expect(getOrCreateInstallId()).toBe(existing);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('regenerates when the persisted file is malformed', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ not json');

      const id = getOrCreateInstallId();

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('regenerates when the persisted installId is not a lowercase UUID', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ installId: 'NOT-A-UUID' }));

      const id = getOrCreateInstallId();

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordTelemetryEvent / flushTelemetry', () => {
    it('default-off: queues nothing and sends nothing', async () => {
      withUsageSignalEnabled(false);
      recordTelemetryEvent('app_opened', { now });
      const fetchFn = vi.fn();

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('drops an unknown event name', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('church_name', { now });
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('drops a non-string event name', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent(42, { now });
      const fetchFn = vi.fn();

      await flushTelemetry(fetchFn);

      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('drops a pattern-valid but unapproved event name', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app.opened', { now });
      const fetchFn = vi.fn();

      await flushTelemetry(fetchFn);

      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('accepts every documented event name', async () => {
      withUsageSignalEnabled(true);
      for (const name of TELEMETRY_EVENTS) recordTelemetryEvent(name, { now });
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: TELEMETRY_EVENTS.length });
      expect(fetchFn).toHaveBeenCalledTimes(TELEMETRY_EVENTS.length);
    });

    it('POSTs a payload with exactly the documented keys', async () => {
      withUsageSignalEnabled(true);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      recordTelemetryEvent('app_opened', { now });
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      await flushTelemetry(fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe('https://soundbuddy.online/api/ingest');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(Object.keys(body).sort()).toEqual(
        ['type', 'appVersion', 'osVersion', 'platform', 'name', 'installId', 'sessionId', 'occurredAt'].sort()
      );
      expect(body.type).toBe('telemetry');
      expect(body.appVersion).toBe('0.7.0');
      expect(body.osVersion).toBe('14.5.0');
      expect(body.platform).toBe(`${process.platform}-${process.arch}`);
      expect(body.name).toBe('app_opened');
      expect(body.occurredAt).toMatch(/T\d{2}:00:00Z$/);
      expect(body.occurredAt).toBe('2026-07-17T14:00:00Z');
    });

    it('installId is a UUID and stays identical across two flushes (persisted file)', async () => {
      withUsageSignalEnabled(true);
      let persisted: string | undefined;
      vi.mocked(fs.existsSync).mockImplementation(() => persisted !== undefined);
      vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify({ installId: persisted }));
      vi.mocked(fs.writeFileSync).mockImplementation((_p, contents) => {
        persisted = (JSON.parse(contents as string) as { installId: string }).installId;
      });

      recordTelemetryEvent('app_opened', { now });
      const fetchFn1 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn1);
      const firstInstallId = JSON.parse(fetchFn1.mock.calls[0][1].body as string).installId;

      recordTelemetryEvent('app_opened', { now });
      const fetchFn2 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn2);
      const secondInstallId = JSON.parse(fetchFn2.mock.calls[0][1].body as string).installId;

      expect(firstInstallId).toMatch(/^[0-9a-f-]{36}$/);
      expect(secondInstallId).toBe(firstInstallId);
    });

    it('sessionId stays identical across two flushes within the same session', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });
      const fetchFn1 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn1);
      const firstSessionId = JSON.parse(fetchFn1.mock.calls[0][1].body as string).sessionId;

      recordTelemetryEvent('report_viewed', { now });
      const fetchFn2 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn2);
      const secondSessionId = JSON.parse(fetchFn2.mock.calls[0][1].body as string).sessionId;

      expect(firstSessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(secondSessionId).toBe(firstSessionId);
    });

    it('batches: three recorded events produce three POSTs on one flush, queue empty after', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });
      recordTelemetryEvent('analysis_started', { now });
      recordTelemetryEvent('analysis_completed', { now });
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: 3 });
      expect(fetchFn).toHaveBeenCalledTimes(3);

      const second = await flushTelemetry(fetchFn);
      expect(second).toEqual({ sent: 0 });
    });

    it('drops the oldest event once the queue exceeds MAX_QUEUE', async () => {
      withUsageSignalEnabled(true);
      for (let i = 0; i <= MAX_QUEUE; i++) {
        recordTelemetryEvent(i % 2 === 0 ? 'app_opened' : 'report_viewed', { now });
      }
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: MAX_QUEUE });
    });

    it('uses the real clock when now is not injected', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened');
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

      await flushTelemetry(fetchFn);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
      expect(body.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
    });

    it('starts a flush timer that resetTelemetryForTest can clear', () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });

      expect(() => resetTelemetryForTest()).not.toThrow();
    });

    it('automatically flushes via the timer after FLUSH_INTERVAL_MS', async () => {
      vi.useFakeTimers();
      withUsageSignalEnabled(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      vi.stubGlobal('fetch', fetchMock);

      recordTelemetryEvent('app_opened', { now });
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('opt-out mid-flight: disabling before flush sends nothing and empties the queue', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });
      recordTelemetryEvent('report_viewed', { now });
      withUsageSignalEnabled(false);
      const fetchFn = vi.fn();

      const result = await flushTelemetry(fetchFn);

      expect(result).toEqual({ sent: 0 });
      expect(fetchFn).not.toHaveBeenCalled();

      withUsageSignalEnabled(true);
      const fetchFn2 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      const secondResult = await flushTelemetry(fetchFn2);
      expect(secondResult).toEqual({ sent: 0 });
    });
  });

  describe('clearTelemetryState', () => {
    it('deletes the install-id file and empties the queue', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });

      clearTelemetryState();

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      const result = await flushTelemetry(fetchFn);
      expect(result).toEqual({ sent: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('swallows an unlink failure', () => {
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('no such file');
      });

      expect(() => clearTelemetryState()).not.toThrow();
    });

    it('a subsequent opt-in flush produces a different installId', async () => {
      withUsageSignalEnabled(true);
      let persisted: string | undefined;
      vi.mocked(fs.existsSync).mockImplementation(() => persisted !== undefined);
      vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify({ installId: persisted }));
      vi.mocked(fs.writeFileSync).mockImplementation((_p, contents) => {
        persisted = (JSON.parse(contents as string) as { installId: string }).installId;
      });
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        persisted = undefined;
      });

      recordTelemetryEvent('app_opened', { now });
      const fetchFn1 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn1);
      const firstInstallId = JSON.parse(fetchFn1.mock.calls[0][1].body as string).installId;

      clearTelemetryState();

      recordTelemetryEvent('app_opened', { now });
      const fetchFn2 = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      await flushTelemetry(fetchFn2);
      const secondInstallId = JSON.parse(fetchFn2.mock.calls[0][1].body as string).installId;

      expect(secondInstallId).not.toBe(firstInstallId);
    });
  });

  describe('failure paths', () => {
    it('a non-ok response resolves without throwing and logs the outcome only', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('app_opened', { now });
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      await expect(flushTelemetry(fetchFn)).resolves.toEqual({ sent: 0 });

      expect(logWarn).toHaveBeenCalled();
      const loggedText = vi.mocked(logWarn).mock.calls.map((c) => String(c[0])).join(' ');
      expect(loggedText).not.toContain('app_opened');
    });

    it('a thrown fetch error resolves without throwing and logs the outcome only', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('report_exported', { now });
      const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

      await expect(flushTelemetry(fetchFn)).resolves.toEqual({ sent: 0 });

      expect(logWarn).toHaveBeenCalled();
      const loggedText = vi.mocked(logWarn).mock.calls.map((c) => String(c[0])).join(' ');
      expect(loggedText).not.toContain('report_exported');
    });

    it('a thrown non-Error value resolves without throwing and logs the outcome only', async () => {
      withUsageSignalEnabled(true);
      recordTelemetryEvent('report_exported', { now });
      const fetchFn = vi.fn().mockRejectedValue('boom');

      await expect(flushTelemetry(fetchFn)).resolves.toEqual({ sent: 0 });

      expect(logWarn).toHaveBeenCalled();
      const loggedText = vi.mocked(logWarn).mock.calls.map((c) => String(c[0])).join(' ');
      expect(loggedText).not.toContain('report_exported');
    });
  });
});
