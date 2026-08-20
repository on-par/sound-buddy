// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The one place degraded console link state is derived (#886, R5 of #848):
// folds heartbeat results (#877), meter-subscription liveness events (#878),
// and meter-frame arrivals into a single ConsoleLinkState. Recovery rides the
// timers that already run — the heartbeat keeps polling, startSubscriptionRenewal
// keeps re-sending /xremote + /renew, and the channel poll keeps ticking — so
// this module never creates a socket, a timer, or a retry loop of its own.

import type { ConsoleSubscriptionEvent } from './console-subscription';

export type ConsoleLinkStatus = 'unknown' | 'online' | 'offline';

/** How the console link currently looks. `status` is console reachability (the
 *  /status heartbeat, #877). `metersDegraded` is subscription health only — a
 *  lapsed or silently-refused /meters registration (ADR-0063) — and never
 *  implies the console is gone: the /node channel poll keeps running. */
export interface ConsoleLinkState {
  status: ConsoleLinkStatus;
  metersDegraded: boolean;
}

export type ConsoleLinkInput =
  | { type: 'heartbeat'; status: 'online' | 'offline' }
  | { type: 'subscription'; event: ConsoleSubscriptionEvent }
  | { type: 'meter-frame' };

export const INITIAL_CONSOLE_LINK_STATE: ConsoleLinkState = { status: 'unknown', metersDegraded: false };

/** Folds one signal into the link state. Returns the *same object reference*
 *  when nothing changed, so callers can make the IPC push edge-triggered
 *  (a 5 Hz meter stream must not generate 5 link messages a second). */
export function reduceConsoleLink(state: ConsoleLinkState, input: ConsoleLinkInput): ConsoleLinkState {
  switch (input.type) {
    case 'heartbeat':
      return state.status === input.status ? state : { ...state, status: input.status };
    case 'subscription':
      // Both events mean frames are not arriving: 'degraded-to-polling' = they
      // never started (four-client cap or a refused registration),
      // 'reconnect' = they stopped after flowing (subscription lapse).
      return state.metersDegraded ? state : { ...state, metersDegraded: true };
    case 'meter-frame':
      // A real decoded frame is the only proof the subscription is live again.
      return state.metersDegraded ? { ...state, metersDegraded: false } : state;
  }
}
