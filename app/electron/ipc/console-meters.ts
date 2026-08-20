// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Meter subscription establishment (#883): meters are a push subscription,
// not a poll — send /meters once and the console streams /meters/1 pushes
// back to the sending socket at a rate set by the throttle time factor,
// then silently lapses after ~10s unless renewed. The subscribe message,
// its /xremote + /renew keepalive, and its push receiver all ride one bound
// UDP socket (docs/adr/0069), because the console registers a subscription
// against the source address/port of the socket that sent it — renewing on
// a different socket would silently extend the wrong (or no) registration.
// Every decoded push feeds the renewal handle's onMeterFrame() because
// ADR-0063 makes frame arrival the only liveness signal for both /meters
// and the silently-refused four-client cap. No IPC handler, no preload
// bridge entry, no renderer consumer yet — R4b owns wiring this to the UI.

import * as dgram from 'dgram';
import type { DecodedOscMessage, Meters1Snapshot } from '@sound-buddy/console/dist-cjs/index.js';
import { loadConsoleModule } from '../console-loader';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import { CONSOLE_OSC_PORT, type ConsoleDiscoveryDeps, type ConsoleDiscoverySocket } from './console-discovery';
import {
  startSubscriptionRenewal,
  DEFAULT_METER_FRAME_STALL_MS,
  type ConsoleSubscriptionEvent,
  type ConsoleSubscriptionHandle,
} from './console-subscription';

const {
  encodeOscMessage,
  decodeOscMessage,
  replyAddressMatches,
  buildMetersSubscribeMessage,
  meterFrameIntervalMs,
  decodeMeters1Message,
  METERS_1_ADDRESS,
} = loadConsoleModule();

// A stall window must outlast several throttled frames or a healthy heavily
// throttled stream (tf=99 => 4950ms between frames) would look like a lapse.
export const METER_STALL_INTERVAL_MULTIPLIER = 3;

export interface MeterSubscriptionHandle {
  stop: () => void;
}

export function deriveFrameStallMs(intervalMs: number): number {
  return Math.max(DEFAULT_METER_FRAME_STALL_MS, intervalMs * METER_STALL_INTERVAL_MULTIPLIER);
}

// dgram.createSocket('udp4')'s return type doesn't structurally narrow to
// ConsoleDiscoverySocket without a cast, even though a real dgram.Socket
// satisfies every member of that interface at runtime.
function defaultCreateSocket(): ConsoleDiscoverySocket {
  return dgram.createSocket('udp4') as unknown as ConsoleDiscoverySocket;
}

export function startMeterSubscription(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  onFrame: (snapshot: Meters1Snapshot) => void,
  onEvent: (event: ConsoleSubscriptionEvent) => void,
  options?: { timeFactor?: number; renewalIntervalMs?: number; frameStallMs?: number; subscriptionGraceMs?: number }
): MeterSubscriptionHandle {
  assertConsoleNetworkConsent(settings);

  const subscribe = encodeOscMessage(buildMetersSubscribeMessage(METERS_1_ADDRESS, options?.timeFactor));
  const frameStallMs = options?.frameStallMs ?? deriveFrameStallMs(meterFrameIntervalMs(options?.timeFactor));
  const socket = deps.createSocket?.() ?? defaultCreateSocket();

  let stopped = false;
  let renewal: ConsoleSubscriptionHandle | undefined;

  socket.on('error', (err: Error) => {
    if (stopped) return;
    deps.log(`console-meters: socket error while subscribed to ${ip}: ${String(err)} — will attempt to resubscribe`);
    onEvent({ type: 'reconnect' });
  });

  socket.on('message', (msg: Buffer) => {
    if (stopped) return;

    let decoded: DecodedOscMessage;
    try {
      decoded = decodeOscMessage(new Uint8Array(msg));
    } catch (err) {
      deps.log(`console-meters: ignoring unparsable datagram from ${ip}: ${String(err)}`);
      return;
    }

    if (!replyAddressMatches(METERS_1_ADDRESS, decoded.address)) {
      deps.log(`console-meters: ignoring unrelated reply from ${ip} (address ${decoded.address})`);
      return;
    }

    let snapshot: Meters1Snapshot;
    try {
      snapshot = decodeMeters1Message(decoded);
    } catch (err) {
      deps.log(`console-meters: ignoring malformed ${METERS_1_ADDRESS} frame from ${ip}: ${String(err)}`);
      return;
    }

    renewal?.onMeterFrame();
    onFrame(snapshot);
  });

  socket.bind(() => {
    if (stopped) return;
    socket.send(subscribe, CONSOLE_OSC_PORT, ip);
    renewal = startSubscriptionRenewal({ socket, log: deps.log }, settings, ip, onEvent, {
      renewalIntervalMs: options?.renewalIntervalMs,
      frameStallMs,
      subscriptionGraceMs: options?.subscriptionGraceMs,
    });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      renewal?.stop();
      socket.close();
    },
  };
}
