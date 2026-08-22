// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ConsolePanel, {
  formatFaderDb,
  meterDbfs,
  formatMeterDbfs,
  meterBarPercent,
  consoleLinkMessage,
  captureProgressPercent,
  captureStatusLine,
  formatSceneValue,
  sceneDiffGroups,
  CONSOLE_OFFLINE_MESSAGE,
  CONSOLE_METERS_DEGRADED_MESSAGE,
} from './ConsolePanel';
import { useConsoleStore } from './stores/consoleStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

const CONSOLE_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' };
const CONSOLE_B = { ip: '10.0.0.9', model: 'M32R', firmware: '4.0' };
const IDENTITY_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0', name: 'Main Console' };
const CHANNEL_1 = { index: 1, name: 'Kick', faderDb: -10.5, on: true };
const CHANNEL_3_UNNAMED = { index: 3, name: '', faderDb: 0, on: false };

const CONSOLE_INITIAL_STATE = {
  scanStatus: 'idle' as const,
  found: [],
  scanError: null,
  selectedIp: null,
  identity: null,
  identitySource: null,
  identityStatus: 'idle' as const,
  identityError: null,
  manualIp: '',
  liveChannels: [],
  liveStateStatus: 'idle' as const,
  liveStateError: null,
  liveMeters: [],
  link: { status: 'unknown' as const, metersDegraded: false },
  captureStatus: 'idle' as const,
  captureDone: 0,
  captureTotal: 0,
  captureFilePath: null,
  captureError: null,
  captureHistory: [],
  sceneDiffStatus: 'idle' as const,
  sceneDiff: null,
  sceneDiffNameA: null,
  sceneDiffNameB: null,
  sceneDiffError: null,
};
const DIFF = {
  changes: [
    { path: '/ch/01/mix/on', label: 'Kick — mute', from: true, to: false },
    { path: '/dca/1/on', label: 'Band — DCA', from: false, to: true },
    { path: '/main/st/mix/fader', label: 'Main — fader', from: -3, to: 0 },
  ],
  summary: '3 changes',
  bySection: {
    channels: [{ path: '/ch/01/mix/on', label: 'Kick — mute', from: true, to: false }],
    dcas: [{ path: '/dca/1/on', label: 'Band — DCA', from: false, to: true }],
    main: [{ path: '/main/st/mix/fader', label: 'Main — fader', from: -3, to: 0 }],
  },
};

function renderMarkup(): string {
  return renderToString(createElement(ConsolePanel));
}

beforeEach(() => {
  useLiveCaptureStore.setState({ appMode: 'console' });
});

afterEach(() => {
  useConsoleStore.setState({ ...CONSOLE_INITIAL_STATE });
  useLiveCaptureStore.setState({ appMode: 'console' });
});

describe('ConsolePanel (#884)', () => {
  it('renders nothing when not on the Console tab', () => {
    useLiveCaptureStore.setState({ appMode: 'live' });

    const html = renderMarkup();

    expect(html).toBe('');
  });

  it('lists every console the scan found, with IP and model', () => {
    useLiveCaptureStore.setState({ appMode: 'console' });
    useConsoleStore.setState({ scanStatus: 'done', found: [CONSOLE_A, CONSOLE_B] });

    const html = renderMarkup();

    expect(html).toContain('id="console-found"');
    expect(html).toContain(CONSOLE_A.ip);
    expect(html).toContain(CONSOLE_A.model);
    expect(html).toContain(CONSOLE_B.ip);
  });

  it('marks the selected console current in the found list', () => {
    useConsoleStore.setState({ scanStatus: 'done', found: [CONSOLE_A, CONSOLE_B], selectedIp: CONSOLE_A.ip });

    const html = renderMarkup();

    expect(html).toMatch(/data-console-ip="10\.0\.0\.5"[^>]*aria-current="true"/);
  });

  it('shows a loading line while the identity read is in flight', () => {
    useConsoleStore.setState({ identityStatus: 'loading' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-loading"');
    expect(html).toMatch(/Reading console identity/);
  });

  it('shows the full identity once loaded — name, model, firmware, IP', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'scan' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity"');
    expect(html).toContain(IDENTITY_A.name);
    expect(html).toContain(IDENTITY_A.model);
    expect(html).toContain(IDENTITY_A.firmware);
    expect(html).toContain(IDENTITY_A.ip);
  });

  it('renders an em dash for a missing optional name', () => {
    useConsoleStore.setState({
      identityStatus: 'loaded',
      identity: { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' },
      identitySource: 'scan',
    });

    const html = renderMarkup();

    expect(html).toContain('—');
  });

  it('labels a manually-entered identity as the secondary path', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'manual' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-source"');
    expect(html).toMatch(/Secondary/);
  });

  it('does not show the secondary tag for a scan-sourced identity', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'scan' });

    const html = renderMarkup();

    expect(html).not.toContain('id="console-identity-source"');
  });

  it('disables the scan button while scanning', () => {
    useConsoleStore.setState({ scanStatus: 'scanning' });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan"');
    expect(html).toMatch(/id="console-scan"[^>]*disabled/);
    expect(html).toContain('Scanning…');
  });

  it('renders scanError in a role="alert" node', () => {
    useConsoleStore.setState({ scanStatus: 'error', scanError: "Couldn't scan for a console." });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan-error"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/scan for a console/);
  });

  it('renders identityError in a role="alert" node', () => {
    useConsoleStore.setState({ identityStatus: 'error', identityError: 'No reply from the console.' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-error"');
    expect(html).toContain('No reply from the console.');
  });

  it('shows a fallback pointer to manual entry when a scan completes with nothing found', () => {
    useConsoleStore.setState({ scanStatus: 'done', found: [] });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan-empty"');
    expect(html).not.toContain('id="console-found"');
  });

  it('the manual IP input and submit button are always present as the fallback path', () => {
    const html = renderMarkup();

    expect(html).toContain('id="console-manual-ip"');
    expect(html).toContain('id="console-manual-submit"');
  });

  it('disables the manual submit button while the manual IP is empty', () => {
    useConsoleStore.setState({ manualIp: '' });

    const html = renderMarkup();

    expect(html).toMatch(/id="console-manual-submit"[^>]*disabled/);
  });

  it('enables the manual submit button once an IP is entered', () => {
    useConsoleStore.setState({ manualIp: '192.168.1.50' });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="console-manual-submit"[^>]*disabled/);
  });

  it('states the read-only guarantee', () => {
    const html = renderMarkup();

    expect(html).toContain('console-readonly-note');
    expect(html).toMatch(/only reads/i);
  });

  describe('formatFaderDb', () => {
    it('formats a finite dB value to one decimal', () => {
      expect(formatFaderDb(-10.5)).toBe('-10.5 dB');
      expect(formatFaderDb(0)).toBe('0.0 dB');
    });

    it('formats -Infinity as the console "-oo" reading', () => {
      expect(formatFaderDb(-Infinity)).toBe('-∞ dB');
    });
  });

  describe('live channel state', () => {
    it('disables the watch toggle with no selectedIp', () => {
      const html = renderMarkup();

      expect(html).toMatch(/id="console-live-toggle"[^>]*disabled/);
      expect(html).toContain('Watch channel state');
    });

    it('enables the watch toggle once a console is selected', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip });

      const html = renderMarkup();

      expect(html).not.toMatch(/id="console-live-toggle"[^>]*disabled/);
    });

    it('flips the toggle label to Stop watching while watching', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip, liveStateStatus: 'watching' });

      const html = renderMarkup();

      expect(html).toContain('Stop watching');
    });

    it('shows a waiting line while starting with no channels yet', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip, liveStateStatus: 'starting', liveChannels: [] });

      const html = renderMarkup();

      expect(html).toContain('id="console-live-waiting"');
      expect(html).toMatch(/Reading channel state/);
    });

    it('does not show the waiting line once channels have arrived, even mid-restart', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip, liveStateStatus: 'starting', liveChannels: [CHANNEL_1] });

      const html = renderMarkup();

      expect(html).not.toContain('id="console-live-waiting"');
    });

    it('renders populated liveChannels with name, formatted dB, and ON/OFF', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip, liveStateStatus: 'watching', liveChannels: [CHANNEL_1] });

      const html = renderMarkup();

      expect(html).toContain('id="console-channel-list"');
      expect(html).toContain('Kick');
      expect(html).toContain('-10.5 dB');
      expect(html).toContain('ON');
    });

    it('falls back to "Ch N" for an unnamed channel', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip, liveStateStatus: 'watching', liveChannels: [CHANNEL_3_UNNAMED] });

      const html = renderMarkup();

      expect(html).toContain('Ch 3');
      expect(html).toContain('OFF');
    });

    it('renders liveStateError in a role="alert" node', () => {
      useConsoleStore.setState({ liveStateStatus: 'error', liveStateError: "Couldn't watch the console's channel state." });

      const html = renderMarkup();

      expect(html).toContain('id="console-live-error"');
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/watch the console.{1,10}s channel state/);
    });
  });

  describe('meterDbfs', () => {
    it('maps full scale (1) to 0 dBFS', () => {
      expect(meterDbfs(1)).toBeCloseTo(0, 5);
    });

    it('maps half amplitude (0.5) to approximately -6.02 dBFS', () => {
      expect(meterDbfs(0.5)).toBeCloseTo(-6.02, 2);
    });

    it('treats silence and non-positive/NaN readings as -Infinity', () => {
      expect(meterDbfs(0)).toBe(-Infinity);
      expect(meterDbfs(-0.1)).toBe(-Infinity);
      expect(meterDbfs(NaN)).toBe(-Infinity);
    });
  });

  describe('formatMeterDbfs', () => {
    it('formats full scale to one decimal', () => {
      expect(formatMeterDbfs(1)).toBe('0.0 dBFS');
    });

    it('formats silence as the -∞ reading', () => {
      expect(formatMeterDbfs(0)).toBe('-∞ dBFS');
    });
  });

  describe('meterBarPercent', () => {
    it('is 100 at full scale', () => {
      expect(meterBarPercent(1)).toBe(100);
    });

    it('clamps above full scale to 100', () => {
      expect(meterBarPercent(2)).toBe(100);
    });

    it('is 0 at silence', () => {
      expect(meterBarPercent(0)).toBe(0);
    });

    it('is 0 exactly at the -60 dBFS floor', () => {
      expect(meterBarPercent(0.001)).toBe(0);
    });

    it('lands strictly between 0 and 100 for a mid-window value', () => {
      const pct = meterBarPercent(0.1);
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(100);
    });
  });

  describe('meter markup', () => {
    it('draws a fill bar and dBFS readout for each channel with a frame', () => {
      useConsoleStore.setState({
        selectedIp: CONSOLE_A.ip,
        liveStateStatus: 'watching',
        liveChannels: [CHANNEL_1],
        liveMeters: [0.5],
      });

      const html = renderMarkup();

      expect(html).toContain('console-channel-meter-fill');
      expect(html).toContain('width:');
      expect(html).toContain(formatMeterDbfs(0.5));
    });

    it('reads -∞ dBFS at 0% fill for every row when the meter frame has not arrived yet', () => {
      useConsoleStore.setState({
        selectedIp: CONSOLE_A.ip,
        liveStateStatus: 'watching',
        liveChannels: [CHANNEL_1, CHANNEL_3_UNNAMED],
        liveMeters: [],
      });

      const html = renderMarkup();

      const matches = html.match(/-∞ dBFS/g) ?? [];
      expect(matches).toHaveLength(2);
    });
  });

  describe('consoleLinkMessage (#886)', () => {
    it('returns null for a healthy link', () => {
      expect(consoleLinkMessage({ status: 'online', metersDegraded: false })).toBeNull();
    });

    it('returns null for an unknown link', () => {
      expect(consoleLinkMessage({ status: 'unknown', metersDegraded: false })).toBeNull();
    });

    it('returns CONSOLE_OFFLINE_MESSAGE for an offline link', () => {
      expect(consoleLinkMessage({ status: 'offline', metersDegraded: false })).toBe(CONSOLE_OFFLINE_MESSAGE);
    });

    it('returns CONSOLE_METERS_DEGRADED_MESSAGE for degraded meters on an online link', () => {
      expect(consoleLinkMessage({ status: 'online', metersDegraded: true })).toBe(CONSOLE_METERS_DEGRADED_MESSAGE);
    });

    it('prioritises the offline message when both offline and meters degraded', () => {
      expect(consoleLinkMessage({ status: 'offline', metersDegraded: true })).toBe(CONSOLE_OFFLINE_MESSAGE);
    });
  });

  describe('link status rendering (#886)', () => {
    it('renders the offline message with #console-link-status when the link is offline', () => {
      useConsoleStore.setState({ link: { status: 'offline', metersDegraded: false } });

      const html = renderMarkup();

      expect(html).toContain('id="console-link-status"');
      expect(html).toContain(CONSOLE_OFFLINE_MESSAGE);
    });

    it('renders no link status markup when the link is healthy', () => {
      useConsoleStore.setState({ link: { status: 'online', metersDegraded: false } });

      const html = renderMarkup();

      expect(html).not.toContain('id="console-link-status"');
    });
  });

  describe('captureProgressPercent', () => {
    it('is 0 when total is 0', () => {
      expect(captureProgressPercent(0, 0)).toBe(0);
    });

    it('is approximately 50 at half progress', () => {
      expect(captureProgressPercent(1051, 2103)).toBeCloseTo(50, 0);
    });

    it('clamps an over-count to 100', () => {
      expect(captureProgressPercent(2200, 2103)).toBe(100);
    });
  });

  describe('captureStatusLine', () => {
    it('describes progress while capturing', () => {
      expect(captureStatusLine('capturing', 501, 2103, null)).toMatch(/501 of 2103/);
    });

    it('names the destination and stays-local guarantee once done', () => {
      const line = captureStatusLine('done', 2103, 2103, '/mock/userData/console-captures/capture-x.local.scn');
      expect(line).toContain('/mock/userData/console-captures/capture-x.local.scn');
      expect(line).toMatch(/stays on this Mac/i);
    });

    it('reports cancellation', () => {
      expect(captureStatusLine('cancelled', 5, 2103, null)).toMatch(/cancelled/i);
    });

    it('returns null when idle or error', () => {
      expect(captureStatusLine('idle', 0, 0, null)).toBeNull();
      expect(captureStatusLine('error', 0, 0, null)).toBeNull();
    });
  });

  describe('capture controls', () => {
    it('disables the capture button with no selectedIp', () => {
      const html = renderMarkup();

      expect(html).toMatch(/id="console-capture"[^>]*disabled/);
      expect(html).toContain('Capture scene');
    });

    it('enables the capture button once a console is selected', () => {
      useConsoleStore.setState({ selectedIp: CONSOLE_A.ip });

      const html = renderMarkup();

      expect(html).not.toMatch(/id="console-capture"[^>]*disabled/);
    });

    it('shows Capturing, a Cancel button, and progress while capturing', () => {
      useConsoleStore.setState({
        selectedIp: CONSOLE_A.ip,
        captureStatus: 'capturing',
        captureDone: 501,
        captureTotal: 2103,
      });

      const html = renderMarkup();

      expect(html).toContain('Capturing');
      expect(html).toContain('id="console-capture-cancel"');
      expect(html).toContain('id="console-capture-progress"');
      expect(html).toContain('id="console-capture-percent"');
    });

    it('renders the saved path and the stays-on-this-Mac sentence when done', () => {
      useConsoleStore.setState({
        selectedIp: CONSOLE_A.ip,
        captureStatus: 'done',
        captureFilePath: '/mock/userData/console-captures/capture-x.local.scn',
      });

      const html = renderMarkup();

      expect(html).toContain('id="console-capture-status"');
      expect(html).toContain('/mock/userData/console-captures/capture-x.local.scn');
      expect(html).toMatch(/stays on this Mac/i);
    });

    it('renders #console-capture-error with role="alert" when capture errors', () => {
      useConsoleStore.setState({
        selectedIp: CONSOLE_A.ip,
        captureStatus: 'error',
        captureError: "Couldn't capture the console scene.",
      });

      const html = renderMarkup();

      expect(html).toContain('id="console-capture-error"');
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/Couldn(?:'|&#x27;)t capture the console scene/);
    });

    it('states captures stay local and nothing is uploaded', () => {
      const html = renderMarkup();

      expect(html).toMatch(/nothing is uploaded or shared/i);
    });
  });

  describe('scene diff helpers', () => {
    it('formats unknown diff values into stable display strings', () => {
      expect(formatSceneValue(true)).toBe('on');
      expect(formatSceneValue(false)).toBe('off');
      expect(formatSceneValue(-3.25)).toBe('-3.3');
      expect(formatSceneValue(null)).toBe('—');
    });

    it('returns only non-empty grouped sections', () => {
      expect(sceneDiffGroups({ ...DIFF, bySection: { channels: DIFF.bySection.channels, dcas: [], main: [] } })).toEqual([
        { key: 'channels', title: 'Channels', changes: DIFF.bySection.channels },
      ]);
    });
  });

  describe('scene diff controls (#892)', () => {
    it('disables compare until two captures exist', () => {
      const html = renderMarkup();

      expect(html).toMatch(/id="console-diff"[^>]*disabled/);
    });

    it('enables compare once two captures exist', () => {
      useConsoleStore.setState({ captureHistory: ['/mock/before.local.scn', '/mock/after.local.scn'] });

      const html = renderMarkup();

      expect(html).not.toMatch(/id="console-diff"[^>]*disabled/);
    });

    it('shows the clean no-differences state', () => {
      useConsoleStore.setState({
        captureHistory: ['/mock/before.local.scn', '/mock/after.local.scn'],
        sceneDiffStatus: 'done',
        sceneDiff: { changes: [], summary: '0 changes', bySection: { channels: [], dcas: [], main: [] } },
      });

      const html = renderMarkup();

      expect(html).toContain('id="console-diff-empty"');
      expect(html).toMatch(/No differences/);
    });

    it('renders grouped channel, DCA, and main changes with from/to values', () => {
      useConsoleStore.setState({
        captureHistory: ['/mock/before.local.scn', '/mock/after.local.scn'],
        sceneDiffStatus: 'done',
        sceneDiff: DIFF,
        sceneDiffNameA: 'Before',
        sceneDiffNameB: 'After',
      });

      const html = renderMarkup();

      expect(html).toContain('id="console-diff-results"');
      expect(html).toContain('Before');
      expect(html).toContain('After');
      expect(html).toContain('Channels');
      expect(html).toContain('DCA');
      expect(html).toContain('Main');
      expect(html).toContain('Kick — mute');
      expect(html).toMatch(/on.*→.*off/);
      expect(html).toContain('Main — fader');
    });

    it('renders diff errors as alerts', () => {
      useConsoleStore.setState({
        sceneDiffStatus: 'error',
        sceneDiffError: "Couldn't compare those scene captures.",
      });

      const html = renderMarkup();

      expect(html).toContain('id="console-diff-error"');
      expect(html).toContain('role="alert"');
    });
  });
});
