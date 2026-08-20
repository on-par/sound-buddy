// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createConsoleStore, CONSENT_DECLINED_MESSAGE } from './consoleStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

const CONSOLE_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' };
const IDENTITY_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0', name: 'Main' };

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

    it('a declined consent leaves identityStatus untouched and never calls fetchConsoleIdentity', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);

      await store.getState().selectConsole('10.0.0.5');

      expect(store.getState().identityStatus).toBe('idle');
      expect(store.getState().scanError).toBe(CONSENT_DECLINED_MESSAGE);
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

    it('a declined consent sets CONSENT_DECLINED_MESSAGE and never calls fetchConsoleIdentity', async () => {
      const mock = createMockSoundBuddy();
      const store = createConsoleStore(() => mock.api, decline);
      store.getState().setManualIp('10.0.0.5');

      await store.getState().submitManualIp();

      expect(store.getState().scanError).toBe(CONSENT_DECLINED_MESSAGE);
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
});
