// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The thin IPC surface for #884/#977/#978/#886: wires #876's discoverConsoles,
// #877's fetchConsoleIdentity, #977's live channel-state poll, #883's meter
// subscription, and #877's /status heartbeat to the renderer.
// start/stop-console-live-state start and stop the channel poll, the meter
// subscription, and the heartbeat together, folding heartbeat results and
// meter-subscription liveness events through console-link.ts's
// reduceConsoleLink into one derived link state pushed on the same channel
// (#886). All four channels are reads — see the #884 ADR and this PR's ADR
// (console IPC surface is read-only by construction, pinned by
// console-read-only-gate.test.ts). Consent (ADR-0006/ADR-0013) is asserted
// inside the delegated modules via assertConsoleNetworkConsent; main
// revalidates a manually-entered IP before ever touching the network because
// the renderer is never trusted (threat-model.test.ts discipline).

import { ipcMain } from 'electron';
import { log, logWarn } from '../logger';
import { getSettings } from '../settings';
import { discoverConsoles } from './console-discovery';
import { fetchConsoleIdentity, startConsoleHeartbeat } from './console-connection';
import { startChannelStateSubscription, type ChannelStateSubscriptionHandle } from './console-channel-state';
import { startMeterSubscription, type MeterSubscriptionHandle } from './console-meters';
import { reduceConsoleLink, INITIAL_CONSOLE_LINK_STATE, type ConsoleLinkState, type ConsoleLinkInput } from './console-link';
import type {
  ScanConsolesResult,
  FetchConsoleIdentityResult,
  StartConsoleLiveStateResult,
  OperationResult,
} from './api';

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_OCTET = 255;

// The console streams /meters at ~20 Hz unthrottled. Frames land in
// consoleStore (discrete React state), so throttle at the source instead of
// re-rendering the channel list at animation rate — see this PR's ADR and
// ADR-0005. #883's grammar: frame interval = 50ms x time factor.
export const CONSOLE_METER_TIME_FACTOR = 4; // 200ms frames (5 Hz)

export function isValidConsoleIp(ip: unknown): ip is string {
  if (typeof ip !== 'string') return false;
  const match = IPV4_PATTERN.exec(ip);
  if (!match) return false;
  return match.slice(1).every((octet) => {
    if (octet.length > 1 && octet.startsWith('0')) return false;
    return Number(octet) <= MAX_OCTET;
  });
}

function actionableError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// A second start-console-live-state replaces the first handle instead of
// stacking a second poll loop; module-level so both handlers can reach it.
let liveStateHandle: ChannelStateSubscriptionHandle | null = null;
let meterHandle: MeterSubscriptionHandle | null = null;
let heartbeatStop: (() => void) | null = null;
let linkState: ConsoleLinkState = INITIAL_CONSOLE_LINK_STATE;

function stopLiveStateSubscription(): void {
  liveStateHandle?.stop();
  liveStateHandle = null;
  meterHandle?.stop();
  meterHandle = null;
  heartbeatStop?.();
  heartbeatStop = null;
  linkState = INITIAL_CONSOLE_LINK_STATE;
}

export function registerConsoleHandlers(): void {
  ipcMain.handle('scan-consoles', async (): Promise<ScanConsolesResult> => {
    try {
      const consoles = await discoverConsoles({ log }, getSettings());
      return { success: true, consoles };
    } catch (err) {
      const error = actionableError(
        err,
        "Couldn't scan for a console. Check this Mac is on the same network as the console, then try again."
      );
      logWarn(`scan-consoles failed: ${error}`);
      return { success: false, error };
    }
  });

  ipcMain.handle('fetch-console-identity', async (_e, ip: unknown): Promise<FetchConsoleIdentityResult> => {
    if (!isValidConsoleIp(ip)) {
      return {
        success: false,
        error: 'Enter the console IP as four numbers separated by dots, for example 192.168.1.50.',
      };
    }
    try {
      const identity = await fetchConsoleIdentity({ log }, getSettings(), ip);
      return { success: true, identity };
    } catch (err) {
      const error = actionableError(
        err,
        "Couldn't read the console's identity. Check the IP is correct and the console is powered on and reachable on the network."
      );
      logWarn(`fetch-console-identity failed: ${error}`);
      return { success: false, error };
    }
  });

  ipcMain.handle('start-console-live-state', async (event, ip: unknown): Promise<StartConsoleLiveStateResult> => {
    if (!isValidConsoleIp(ip)) {
      return {
        success: false,
        error: 'Enter the console IP as four numbers separated by dots, for example 192.168.1.50.',
      };
    }
    stopLiveStateSubscription(); // a second start replaces the first, never stacks
    const wc = event.sender;
    try {
      const pushLink = (input: ConsoleLinkInput) => {
        const next = reduceConsoleLink(linkState, input);
        if (next === linkState) return; // edge-triggered: no push when nothing changed
        linkState = next;
        if (!wc.isDestroyed()) wc.send('console-live-state', { link: next });
      };
      liveStateHandle = startChannelStateSubscription(
        { log },
        getSettings(),
        ip,
        (channels) => {
          if (!wc.isDestroyed()) wc.send('console-live-state', { channels });
        },
        (error) => {
          if (!wc.isDestroyed()) wc.send('console-live-state', { error });
        }
      );
      meterHandle = startMeterSubscription(
        { log },
        getSettings(),
        ip,
        (snapshot) => {
          pushLink({ type: 'meter-frame' });
          if (!wc.isDestroyed()) wc.send('console-live-state', { meters: { inputs: snapshot.inputs } });
        },
        // #886: liveness events are surfaced via pushLink (metersDegraded) as
        // well as logged — the channel poll keeps running either way.
        (event) => {
          log(`console-live-state: meter subscription ${event.type} for ${ip}`);
          pushLink({ type: 'subscription', event });
        },
        { timeFactor: CONSOLE_METER_TIME_FACTOR }
      );
      // Each heartbeat poll is queryConsole with the default 350ms timeout and
      // 3 retries (<=1.4s), fired on a fixed 5s interval — no backoff growth,
      // no unbounded loop (#886 acceptance criterion). Started last, inside
      // this try, so a thrown consent error is handled by the existing catch.
      heartbeatStop = startConsoleHeartbeat({ log }, getSettings(), ip, (status) => pushLink({ type: 'heartbeat', status }));
      return { success: true };
    } catch (err) {
      stopLiveStateSubscription();
      const error = actionableError(
        err,
        "Couldn't start watching the console's channel state. Check the IP is correct and the console is powered on and reachable on the network."
      );
      logWarn(`start-console-live-state failed: ${error}`);
      return { success: false, error };
    }
  });

  ipcMain.handle('stop-console-live-state', async (): Promise<OperationResult> => {
    stopLiveStateSubscription();
    return { success: true };
  });
}
