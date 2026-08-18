// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Console subscription renewal + liveness detection (#878): the M32R console
// silently expires /xremote and /meters OSC subscriptions after ~10s with no
// acknowledgment either way, so a healthy-but-idle stream looks identical to
// a lapsed one, and a silently-refused registration (four-client cap already
// hit) looks identical to one that's simply slow to start pushing.
// startSubscriptionRenewal periodically re-sends /xremote and /renew well
// inside that window, and layers a grace/stall watchdog over the caller's
// onMeterFrame() calls to distinguish "frames never started" (degrade to
// polling) from "frames stopped after flowing" (reconnect). Establishing the
// initial /meters subscription and decoding meter payloads are both out of
// scope here — see #878's ADRs.

import { encodeOscMessage } from '@sound-buddy/console/dist-cjs/index.js';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import { CONSOLE_OSC_PORT } from './console-discovery';

export const DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS = 5000; // well inside the console's ~10s silent-lapse window
export const DEFAULT_METER_FRAME_STALL_MS = 3000; // no /meters frame for this long after frames were flowing => reconnect signal
export const DEFAULT_SUBSCRIPTION_GRACE_MS = 5000; // no first /meters frame within this long of starting => silently refused, degrade to polling

export interface ConsoleSubscriptionSocket {
  send(msg: Uint8Array, port: number, address: string): void;
}

export interface ConsoleSubscriptionDeps {
  socket: ConsoleSubscriptionSocket;
  log: (msg: string) => void;
}

export type ConsoleSubscriptionEvent = { type: 'reconnect' } | { type: 'degraded-to-polling' };

export interface ConsoleSubscriptionHandle {
  onMeterFrame: () => void;
  stop: () => void;
}

export function startSubscriptionRenewal(
  deps: ConsoleSubscriptionDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  onEvent: (event: ConsoleSubscriptionEvent) => void,
  options?: { renewalIntervalMs?: number; frameStallMs?: number; subscriptionGraceMs?: number }
): ConsoleSubscriptionHandle {
  assertConsoleNetworkConsent(settings);

  const renewalIntervalMs = options?.renewalIntervalMs ?? DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS;
  const frameStallMs = options?.frameStallMs ?? DEFAULT_METER_FRAME_STALL_MS;
  const subscriptionGraceMs = options?.subscriptionGraceMs ?? DEFAULT_SUBSCRIPTION_GRACE_MS;

  let stopped = false;
  let everReceivedFrame = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;

  const sendRenewal = () => {
    deps.socket.send(encodeOscMessage({ address: '/xremote', args: [] }), CONSOLE_OSC_PORT, ip);
    deps.socket.send(encodeOscMessage({ address: '/renew', args: [] }), CONSOLE_OSC_PORT, ip);
  };

  sendRenewal();
  const renewalInterval = setInterval(sendRenewal, renewalIntervalMs);

  const graceTimer = setTimeout(() => {
    // stop() clears this timer synchronously, so `stopped` can never be true
    // when this callback runs — kept as defense-in-depth per the frozen spec
    // ("no onEvent call after stop(), regardless of timers already in
    // flight"); not reachable by any test.
    /* c8 ignore next */
    if (stopped) return;
    // No `everReceivedFrame` check needed here: onMeterFrame's first call
    // clears this timer synchronously, so this body can only ever run when
    // a frame has never arrived.
    deps.log(`console-subscription: no /meters frame from ${ip} within ${subscriptionGraceMs}ms — degrading to polling`);
    onEvent({ type: 'degraded-to-polling' });
  }, subscriptionGraceMs);

  const armStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      // Same defense-in-depth reasoning as the grace timer above: stop()
      // clears this timer synchronously, so this branch is unreachable.
      /* c8 ignore next */
      if (stopped) return;
      deps.log(`console-subscription: no /meters frame from ${ip} for ${frameStallMs}ms — reconnecting`);
      onEvent({ type: 'reconnect' });
      armStallTimer();
    }, frameStallMs);
  };

  return {
    onMeterFrame: () => {
      if (stopped) return;
      if (!everReceivedFrame) {
        everReceivedFrame = true;
        clearTimeout(graceTimer);
      }
      armStallTimer();
    },
    stop: () => {
      stopped = true;
      clearInterval(renewalInterval);
      clearTimeout(graceTimer);
      clearTimeout(stallTimer);
    },
  };
}
