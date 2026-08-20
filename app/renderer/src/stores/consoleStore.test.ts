// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createConsoleStore,
  CONSENT_DECLINED_MESSAGE,
  NO_CONSOLE_SELECTED_MESSAGE,
  LIVE_STATE_FAILED_MESSAGE,
  CAPTURE_FAILED_MESSAGE,
  INITIAL_CONSOLE_LINK,
} from './consoleStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

const CONSOLE_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' };
const IDENTITY_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0', name: 'Main' };
const CHANNEL_1 = { index: 1, name: 'Kick', faderDb: -10.5, on: true };

function allow() {
  return Promise.resolve(true);
}

function decline() {
  return Promise.resolve(false);
}

describe('createConsoleStore', () => {
  it('starts idle with nothing found and no identity', () => {
    const mock = createMockSoundBuddy();
    const store = createConsoleStore(() => mock.api, allow);

    const s = store.getState();
    expect(s.scanStatus).toBe('idle');
    expect(s.found).toEqual([]);
    expect(s.scanError).toBeNull();
    expect(s.identity).toBeNull();
    expect(s.identityStatus).toBe('idle');
    expect(s.manualIp).toBe('');
    expect(s.liveChannels).toEqual([]);
    expect(s.liveStateStatus).toBe('idle');
    expect(s.liveStateError).toBeNull();
    expect(s.liveMeters).toEqual([]);
    expect(s.link).toEqual(INITIAL_CONSOLE_LINK);
    expect(s.captureStatus).toBe('idle');
    expect(s.captureDone).toBe(0);
    expect(s.captureTotal).toBe(0);
    expect(s.captureFilePath).toBeNull();
    expect(s.captureError).toBeNull();
  });

  describe('scan', () => {
    it('populates found on a successful scan', async () => {
      const mock = createMockSoundBuddy({
        scanConsoles: async () => ({ success: true, consoles: [CONSOLE_A] }),
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().scan();

      expect(store.getState().scanStatus).toBe('done');
      expect(store.getState().found).toEqual([CONSOLE_A]);
      expect(store.getState().scanError).toBeNull();
    });

    it('sets scanning while the IPC round trip is in flight', async () => {
      let resolveScan!: (v: { success: true; consoles: typeof CONSOLE_A[] }) => void;
      const mock = createMockSoundBuddy({
        scanConsoles: () => new Promise((resolve) => { resolveScan = resolve; }),
      });
      const store = createConsoleStore(() => mock.api, allow);

      const pending = store.getState().scan();
      // requestConsent() is itself awaited first, so let that microtask settle
      // before the store reaches the 'scanning' set() call.
      await Promise.resolve();
      expect(store.getState().scanStatus).toBe('scanning');

      resolveScan({ success: true, consoles: [CONSOLE_A] });
      await pending;
      expect(store.getState().scanStatus).toBe('done');
    });

    it('a failed scan sets scanError and clears found', async () => {
      const mock = createMockSoundBuddy({
        scanConsoles: async () => ({ success: false, error: "Couldn't scan for a console." }),
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ found: [CONSOLE_A] });

      await store.getState().scan();

      expect(store.getState().scanStatus).toBe('error');
      expect(store.getState().scanError).toBe("Couldn't scan for a console.");
      expect(store.getState().found).toEqual([]);
    });

    it('a thrown bridge call is caught and mapped to an actionable error', async () => {
      const mock = createMockSoundBuddy({
        scanConsoles: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().scan();

      expect(store.getState().scanStatus).toBe('error');
      expect(store.getState().scanError).toBe(
        "Couldn't scan for a console. Check this Mac is on the same network as the console, then try again."
      );
      expect(store.getState().found).toEqual([]);
    });

    it('a declined consent leaves scanStatus idle, sets CONSENT_DECLINED_MESSAGE, and never calls scanConsoles', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);

      await store.getState().scan();

      expect(store.getState().scanStatus).toBe('idle');
      expect(store.getState().scanError).toBe(CONSENT_DECLINED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'scanConsoles')).toBeUndefined();
    });

    it('ignores a stale scan response superseded by a newer scan (race guard)', async () => {
      let resolveFirst!: (v: { success: true; consoles: typeof CONSOLE_A[] }) => void;
      let calls = 0;
      const mock = createMockSoundBuddy({
        scanConsoles: async () => {
          calls += 1;
          if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
          return { success: true, consoles: [{ ...CONSOLE_A, ip: '10.0.0.9' }] };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);

      const firstPending = store.getState().scan();
      await store.getState().scan();

      expect(store.getState().found).toEqual([{ ...CONSOLE_A, ip: '10.0.0.9' }]);

      resolveFirst({ success: true, consoles: [CONSOLE_A] });
      await firstPending;

      expect(store.getState().found).toEqual([{ ...CONSOLE_A, ip: '10.0.0.9' }]);
    });
  });

  describe('selectConsole', () => {
    it('sets identitySource scan and loads the identity', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async () => ({ success: true, identity: IDENTITY_A }),
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().selectConsole('10.0.0.5');

      expect(store.getState().selectedIp).toBe('10.0.0.5');
      expect(store.getState().identitySource).toBe('scan');
      expect(store.getState().identityStatus).toBe('loaded');
      expect(store.getState().identity).toEqual(IDENTITY_A);
    });

    it('a failed identity fetch sets identityError and clears identity', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async () => ({ success: false, error: 'No reply from the console.' }),
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().selectConsole('10.0.0.5');

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identityError).toBe('No reply from the console.');
      expect(store.getState().identity).toBeNull();
    });

    it('a thrown bridge call is caught and mapped to an actionable error', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().selectConsole('10.0.0.5');

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identity).toBeNull();
    });

    it('a declined consent sets identityError to CONSENT_DECLINED_MESSAGE, clears any identity, and never calls fetchConsoleIdentity', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);
      store.setState({ identity: IDENTITY_A, identityStatus: 'loaded' });

      await store.getState().selectConsole('10.0.0.5');

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identityError).toBe(CONSENT_DECLINED_MESSAGE);
      expect(store.getState().identity).toBeNull();
      expect(mock.calls.find((c) => c.method === 'fetchConsoleIdentity')).toBeUndefined();
    });
  });

  describe('setManualIp / submitManualIp', () => {
    it('setManualIp is a plain, no-network state update', () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);

      store.getState().setManualIp('192.168.1.50');

      expect(store.getState().manualIp).toBe('192.168.1.50');
      expect(mock.calls).toEqual([]);
    });

    it('submitManualIp sets identitySource manual and loads identity', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async (ip: string) => {
          mock.calls.push({ method: 'fetchConsoleIdentity', args: [ip] });
          return { success: true, identity: IDENTITY_A };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.getState().setManualIp('10.0.0.5');

      await store.getState().submitManualIp();

      expect(store.getState().identitySource).toBe('manual');
      expect(store.getState().identityStatus).toBe('loaded');
      expect(store.getState().identity).toEqual(IDENTITY_A);
      expect(mock.calls).toContainEqual({ method: 'fetchConsoleIdentity', args: ['10.0.0.5'] });
    });

    it('submitManualIp with whitespace-only input performs no IPC call', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.getState().setManualIp('   ');

      await store.getState().submitManualIp();

      expect(mock.calls.find((c) => c.method === 'fetchConsoleIdentity')).toBeUndefined();
      expect(store.getState().identityStatus).toBe('idle');
    });

    it('a declined consent sets identityError to CONSENT_DECLINED_MESSAGE and never calls fetchConsoleIdentity', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);
      store.getState().setManualIp('10.0.0.5');

      await store.getState().submitManualIp();

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identityError).toBe(CONSENT_DECLINED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'fetchConsoleIdentity')).toBeUndefined();
    });

    it('a failed identity fetch sets identityError and clears identity', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async () => ({ success: false, error: 'No reply from the console.' }),
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.getState().setManualIp('10.0.0.5');

      await store.getState().submitManualIp();

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identityError).toBe('No reply from the console.');
      expect(store.getState().identity).toBeNull();
    });

    it('a thrown bridge call is caught and mapped to an actionable error', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.getState().setManualIp('10.0.0.5');

      await store.getState().submitManualIp();

      expect(store.getState().identityStatus).toBe('error');
      expect(store.getState().identity).toBeNull();
    });

    it('submitManualIp trims the entered IP before sending', async () => {
      const mock = createMockSoundBuddy({
        fetchConsoleIdentity: async (ip: string) => {
          mock.calls.push({ method: 'fetchConsoleIdentity', args: [ip] });
          return { success: true, identity: IDENTITY_A };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.getState().setManualIp('  10.0.0.5  ');

      await store.getState().submitManualIp();

      expect(mock.calls).toContainEqual({ method: 'fetchConsoleIdentity', args: ['10.0.0.5'] });
    });
  });

  describe('startLiveState / stopLiveState', () => {
    it('errors with NO_CONSOLE_SELECTED_MESSAGE and never calls the bridge when nothing is selected', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().startLiveState();

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe(NO_CONSOLE_SELECTED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'startConsoleLiveState')).toBeUndefined();
    });

    it('a declined consent errors with CONSENT_DECLINED_MESSAGE and never calls the bridge', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe(CONSENT_DECLINED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'startConsoleLiveState')).toBeUndefined();
      expect(store.getState().liveMeters).toEqual([]);
    });

    it('a successful start reaches watching and passes selectedIp to startConsoleLiveState', async () => {
      const mock = createMockSoundBuddy({
        startConsoleLiveState: async (ip: string) => {
          mock.calls.push({ method: 'startConsoleLiveState', args: [ip] });
          return { success: true };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();

      expect(store.getState().liveStateStatus).toBe('watching');
      expect(store.getState().liveStateError).toBeNull();
      expect(mock.calls).toContainEqual({ method: 'startConsoleLiveState', args: ['10.0.0.5'] });
    });

    it('a { success: false } start surfaces the backend error and clears liveChannels', async () => {
      const mock = createMockSoundBuddy({
        startConsoleLiveState: async () => ({ success: false, error: 'No reply from the console.' }),
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5', liveChannels: [CHANNEL_1], liveMeters: [0.5] });

      await store.getState().startLiveState();

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe('No reply from the console.');
      expect(store.getState().liveChannels).toEqual([]);
      expect(store.getState().liveMeters).toEqual([]);
    });

    it('a throwing bridge yields LIVE_STATE_FAILED_MESSAGE', async () => {
      const mock = createMockSoundBuddy({
        startConsoleLiveState: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5', liveMeters: [0.5] });

      await store.getState().startLiveState();

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe(LIVE_STATE_FAILED_MESSAGE);
      expect(store.getState().liveMeters).toEqual([]);
    });

    it('an emitted snapshot populates liveChannels and sets watching', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      mock.emit('onConsoleLiveState', { channels: [CHANNEL_1] });

      expect(store.getState().liveChannels).toEqual([CHANNEL_1]);
      expect(store.getState().liveStateStatus).toBe('watching');
    });

    it('an emitted meter frame sets liveMeters and leaves liveChannels/liveStateStatus/liveStateError untouched', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      mock.emit('onConsoleLiveState', { channels: [CHANNEL_1] });
      mock.emit('onConsoleLiveState', { meters: { inputs: [0.5, 0.25] } });

      expect(store.getState().liveMeters).toEqual([0.5, 0.25]);
      expect(store.getState().liveChannels).toEqual([CHANNEL_1]);
      expect(store.getState().liveStateStatus).toBe('watching');
      expect(store.getState().liveStateError).toBeNull();
    });

    it('a channel snapshot arriving after a meter frame leaves liveMeters intact', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      mock.emit('onConsoleLiveState', { meters: { inputs: [0.5, 0.25] } });
      mock.emit('onConsoleLiveState', { channels: [CHANNEL_1] });

      expect(store.getState().liveMeters).toEqual([0.5, 0.25]);
      expect(store.getState().liveChannels).toEqual([CHANNEL_1]);
    });

    it('an emitted { error } sets liveStateStatus error with that message', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      mock.emit('onConsoleLiveState', { error: 'the console did not answer' });

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe('the console did not answer');
    });

    it('a second startLiveState does not register a second listener', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      await store.getState().startLiveState();

      expect(mock.calls.filter((c) => c.method === 'onConsoleLiveState')).toHaveLength(1);
    });

    it('stopLiveState returns the store to idle and clears liveMeters', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ liveStateStatus: 'watching', liveChannels: [CHANNEL_1], liveMeters: [0.5] });

      await store.getState().stopLiveState();

      expect(store.getState().liveStateStatus).toBe('idle');
      expect(store.getState().liveStateError).toBeNull();
      expect(store.getState().liveMeters).toEqual([]);
    });

    it('a throwing stop yields LIVE_STATE_FAILED_MESSAGE', async () => {
      const mock = createMockSoundBuddy({
        stopConsoleLiveState: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ liveStateStatus: 'watching' });

      await store.getState().stopLiveState();

      expect(store.getState().liveStateStatus).toBe('error');
      expect(store.getState().liveStateError).toBe(LIVE_STATE_FAILED_MESSAGE);
    });

    it('a { link } push updates link and leaves liveChannels / liveMeters / liveStateStatus untouched', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startLiveState();
      mock.emit('onConsoleLiveState', { channels: [CHANNEL_1] });
      mock.emit('onConsoleLiveState', { meters: { inputs: [0.5] } });
      mock.emit('onConsoleLiveState', { link: { status: 'offline', metersDegraded: false } });

      expect(store.getState().link).toEqual({ status: 'offline', metersDegraded: false });
      expect(store.getState().liveChannels).toEqual([CHANNEL_1]);
      expect(store.getState().liveMeters).toEqual([0.5]);
      expect(store.getState().liveStateStatus).toBe('watching');
    });

    it('startLiveState resets link to INITIAL_CONSOLE_LINK', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5', link: { status: 'offline', metersDegraded: true } });

      await store.getState().startLiveState();

      expect(store.getState().link).toEqual(INITIAL_CONSOLE_LINK);
    });

    it('stopLiveState resets link to INITIAL_CONSOLE_LINK', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ liveStateStatus: 'watching', link: { status: 'offline', metersDegraded: true } });

      await store.getState().stopLiveState();

      expect(store.getState().link).toEqual(INITIAL_CONSOLE_LINK);
    });
  });

  describe('startSceneCapture / cancelSceneCapture', () => {
    it('errors with NO_CONSOLE_SELECTED_MESSAGE and never calls the bridge when nothing is selected', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().startSceneCapture();

      expect(store.getState().captureStatus).toBe('error');
      expect(store.getState().captureError).toBe(NO_CONSOLE_SELECTED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'startConsoleSceneCapture')).toBeUndefined();
    });

    it('a declined consent errors with CONSENT_DECLINED_MESSAGE and never calls the bridge', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startSceneCapture();

      expect(store.getState().captureStatus).toBe('error');
      expect(store.getState().captureError).toBe(CONSENT_DECLINED_MESSAGE);
      expect(mock.calls.find((c) => c.method === 'startConsoleSceneCapture')).toBeUndefined();
    });

    it('a successful capture records the local file path and passes selectedIp to the bridge', async () => {
      const mock = createMockSoundBuddy({
        startConsoleSceneCapture: async (ip: string) => {
          mock.calls.push({ method: 'startConsoleSceneCapture', args: [ip] });
          return { success: true, filePath: '/mock/userData/console-captures/capture.local.scn' };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startSceneCapture();

      expect(store.getState().captureStatus).toBe('done');
      expect(store.getState().captureFilePath).toBe('/mock/userData/console-captures/capture.local.scn');
      expect(mock.calls).toContainEqual({ method: 'startConsoleSceneCapture', args: ['10.0.0.5'] });
    });

    it('progress pushes update captureDone and captureTotal while the capture is running', async () => {
      let resolveCapture!: (v: { success: true; filePath: string }) => void;
      const mock = createMockSoundBuddy({
        startConsoleSceneCapture: () => new Promise((resolve) => { resolveCapture = resolve; }),
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      const pending = store.getState().startSceneCapture();
      await Promise.resolve();
      mock.emit('onConsoleSceneCaptureProgress', { done: 501, total: 2103 });

      expect(store.getState().captureStatus).toBe('capturing');
      expect(store.getState().captureDone).toBe(501);
      expect(store.getState().captureTotal).toBe(2103);

      resolveCapture({ success: true, filePath: '/mock/capture.local.scn' });
      await pending;
    });

    it('a cancelled result sets cancelled status and no file path', async () => {
      const mock = createMockSoundBuddy({
        startConsoleSceneCapture: async () => ({ success: false, cancelled: true, error: 'Scene capture cancelled. Nothing was saved.' }),
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startSceneCapture();

      expect(store.getState().captureStatus).toBe('cancelled');
      expect(store.getState().captureFilePath).toBeNull();
      expect(store.getState().captureError).toMatch(/cancelled/i);
    });

    it('a throwing bridge yields CAPTURE_FAILED_MESSAGE', async () => {
      const mock = createMockSoundBuddy({
        startConsoleSceneCapture: async () => {
          throw new Error('bridge disconnected');
        },
      });
      const store = createConsoleStore(() => mock.api, allow);
      store.setState({ selectedIp: '10.0.0.5' });

      await store.getState().startSceneCapture();

      expect(store.getState().captureStatus).toBe('error');
      expect(store.getState().captureError).toBe(CAPTURE_FAILED_MESSAGE);
    });

    it('cancelSceneCapture delegates to the bridge', async () => {
      const mock = createMockSoundBuddy({
        cancelConsoleSceneCapture: async () => {
          mock.calls.push({ method: 'cancelConsoleSceneCapture', args: [] });
          return { success: true };
        },
      });
      const store = createConsoleStore(() => mock.api, allow);

      await store.getState().cancelSceneCapture();

      expect(mock.calls).toContainEqual({ method: 'cancelConsoleSceneCapture', args: [] });
    });
  });
});
