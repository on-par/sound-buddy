// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Live console channel state (#977): a polled /node walk, not an /xremote
// push subscription — see this PR's ADR. /node answers with the console's
// own already-in-dB text (the same text a .scn capture is made of), which
// parseChannelStrips (#879) already parses, so this reuses a tested parser
// instead of consuming raw OSC floats and reimplementing scaling.ts's
// conversions. The console's /xremote + /meters subscription budget (capped
// at four clients, ADR-0063) stays reserved for the meter stream R3a/R3b
// will build on console-meters.ts. Consent is asserted before any socket is
// opened (ADR-0006/ADR-0013); the walk composes console-connection.ts's
// queryConsole with parseChannelStrips, reusing its socket lifecycle.

import { loadConsoleModule } from '../console-loader';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import type { ConsoleDiscoveryDeps } from './console-discovery';
import { queryConsole, type ConsoleQueryOptions } from './console-connection';

const { parseChannelStrips, parseNodeReplyLine } = loadConsoleModule();

export const CONSOLE_CHANNEL_COUNT = 32; // M32R input channels
export const DEFAULT_CHANNEL_POLL_INTERVAL_MS = 1000;
const CHANNEL_INDEX_PAD = 2; // /ch/01, not /ch/1

/** One input channel as the board currently has it. `faderDb` is engineering
 *  units straight from the console's own text (R1b) — -Infinity when the
 *  console reports "-oo". */
export interface ConsoleChannelState {
  index: number; // 1-based, matches the OSC path number
  name: string;
  faderDb: number;
  on: boolean;
}

export interface ChannelStateSubscriptionHandle {
  stop: () => void;
}

export function channelNodePaths(count: number = CONSOLE_CHANNEL_COUNT): string[] {
  const paths: string[] = [];
  for (let n = 1; n <= count; n++) {
    const padded = String(n).padStart(CHANNEL_INDEX_PAD, '0');
    paths.push(`/ch/${padded}/config`);
    paths.push(`/ch/${padded}/mix`);
  }
  return paths;
}

// Sequential, not parallel: the same rate-limit rationale console-scene-capture.ts
// documents (measured ~250 q/s, and parallel bursts risk the console's rate limits).
export async function readChannelStates(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options?: { channelCount?: number; queryOptions?: ConsoleQueryOptions }
): Promise<ConsoleChannelState[]> {
  assertConsoleNetworkConsent(settings);

  const paths = channelNodePaths(options?.channelCount);
  const lines: string[] = [];
  for (const path of paths) {
    try {
      const line = await queryConsole(deps, ip, '/node', (m) => parseNodeReplyLine(path, m), {
        ...options?.queryOptions,
        requestArgs: [{ type: 's', value: path }],
      });
      lines.push(line);
    } catch (err) {
      throw new Error(
        `Couldn't read channel state: the console at ${ip} did not answer "${path}" ` +
          `(${lines.length} of ${paths.length} reads completed). Check the console is still ` +
          `powered on and reachable on the network, then start watching again.`,
        { cause: err }
      );
    }
  }

  const strips = parseChannelStrips(lines.join('\n'));
  return strips.map((s) => ({ index: s.index, name: s.name, faderDb: s.fader, on: s.on }));
}

export function startChannelStateSubscription(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  onSnapshot: (channels: ConsoleChannelState[]) => void,
  onError: (message: string) => void,
  options?: { pollIntervalMs?: number; channelCount?: number; queryOptions?: ConsoleQueryOptions }
): ChannelStateSubscriptionHandle {
  assertConsoleNetworkConsent(settings);

  let stopped = false;
  let inFlight = false;

  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    readChannelStates(deps, settings, ip, { channelCount: options?.channelCount, queryOptions: options?.queryOptions })
      .then(
        (channels) => {
          if (!stopped) onSnapshot(channels);
        },
        (err) => {
          if (!stopped) {
            deps.log(`console-channel-state: walk failed for ${ip}: ${String(err)}`);
            // readChannelStates always rejects with `new Error(...)` (see above), so the
            // non-Error branch is unreachable through this module's own call chain — kept
            // only as a defensive fallback against a future readChannelStates change.
            /* c8 ignore next */
            onError(err instanceof Error ? err.message : String(err));
          }
        }
      )
      .finally(() => {
        inFlight = false;
      });
  };

  tick(); // fills the panel immediately instead of waiting a full interval
  const handle = setInterval(tick, options?.pollIntervalMs ?? DEFAULT_CHANNEL_POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
