// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Console connection lifecycle (#877): gives the console client an explicit,
// testable notion of "connected" — fetch the console's identity (/xinfo +
// /info) once reachable, and keep deriving liveness from a cheap /status
// heartbeat poll rather than from parameter reads or a handshake echo the
// console never sends (#848 discovery findings). Reuses the deps-injected
// socket-lifecycle pattern and exported primitives console-discovery.ts
// (#876) already established, adding one generic send/retry primitive
// (queryConsole) parameterized over request address and reply parser.
//
// The 350ms timeout / 3 retries defaults are the issue's measured values —
// RTT p95 7.9ms, max 93.3ms, zero of 2103 queries lost at that setting.

import * as dgram from 'dgram';
import {
  encodeOscMessage,
  decodeOscMessage,
  replyAddressMatches,
  type DecodedOscMessage,
  type OscArg,
} from '@sound-buddy/console/dist-cjs/index.js';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import {
  CONSOLE_OSC_PORT,
  parseInfoReply,
  parseXInfoReply,
  type ConsoleIdentity,
  type ConsoleDiscoverySocket,
  type ConsoleDiscoveryDeps,
} from './console-discovery';

export const DEFAULT_CONNECTION_QUERY_TIMEOUT_MS = 350;
export const DEFAULT_CONNECTION_QUERY_MAX_RETRIES = 3;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
// /status replies with exactly 3 OSC string args (sss): state, ip, name.
const EXPECTED_STATUS_REPLY_ARG_COUNT = 3;

export interface ConsoleQueryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  /** Args to send with the request — /node carries the node path as one string arg (#888). */
  requestArgs?: OscArg[];
}

/** `/status` replies `sss`: state ("active"), ip, console name. */
export interface ConsoleStatus {
  state: string;
  ip: string;
  name: string;
}

// dgram.createSocket('udp4')'s return type doesn't structurally narrow to
// ConsoleDiscoverySocket without a cast, even though a real dgram.Socket
// satisfies every member of that interface at runtime.
function defaultCreateSocket(): ConsoleDiscoverySocket {
  return dgram.createSocket('udp4') as unknown as ConsoleDiscoverySocket;
}

export function parseStatusReply(message: DecodedOscMessage): ConsoleStatus | null {
  if (!replyAddressMatches('/status', message.address)) return null;
  if (message.args.length !== EXPECTED_STATUS_REPLY_ARG_COUNT || message.args.some((a) => a.type !== 's')) {
    return null;
  }
  const [state, ip, name] = message.args.map((a) => (a as { value: string }).value);
  return { state, ip, name };
}

export async function queryConsole<T>(
  deps: ConsoleDiscoveryDeps,
  ip: string,
  requestAddress: string,
  parseReply: (message: DecodedOscMessage) => T | null,
  options?: ConsoleQueryOptions
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECTION_QUERY_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_CONNECTION_QUERY_MAX_RETRIES;
  const socket = deps.createSocket?.() ?? defaultCreateSocket();
  const request = encodeOscMessage({ address: requestAddress, args: options?.requestArgs ?? [] });

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let attemptTimeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(attemptTimeout);
      socket.close();
    };

    const sendAttempt = () => {
      socket.send(request, CONSOLE_OSC_PORT, ip);
      attempt += 1;
      attemptTimeout = setTimeout(() => {
        if (attempt <= maxRetries) {
          sendAttempt();
          return;
        }
        settled = true;
        cleanup();
        reject(
          new Error(
            `No reply from console at ${ip}:${CONSOLE_OSC_PORT} for "${requestAddress}" after ${maxRetries} retries (${timeoutMs}ms each) — check the IP is correct and the console is powered on and reachable on the network.`
          )
        );
      }, timeoutMs);
    };

    socket.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    socket.on('message', (msg: Buffer) => {
      if (settled) return;
      let decoded: DecodedOscMessage;
      try {
        decoded = decodeOscMessage(new Uint8Array(msg));
      } catch (err) {
        deps.log(`console-connection: ignoring unparsable datagram from ${ip}: ${String(err)}`);
        return;
      }
      const parsed = parseReply(decoded);
      if (!parsed) {
        deps.log(`console-connection: ignoring unrelated reply from ${ip} (address ${decoded.address})`);
        return;
      }
      settled = true;
      cleanup();
      resolve(parsed);
    });

    socket.bind(() => sendAttempt());
  });
}

export async function fetchConsoleIdentity(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options?: ConsoleQueryOptions
): Promise<ConsoleIdentity> {
  assertConsoleNetworkConsent(settings);

  const [xinfo, info] = await Promise.all([
    queryConsole(deps, ip, '/xinfo', parseXInfoReply, options),
    queryConsole(deps, ip, '/info', (message) => parseInfoReply(ip, message), options),
  ]);

  return {
    ip: xinfo.ip,
    name: xinfo.name,
    model: xinfo.model,
    firmware: xinfo.firmware,
    serverVersion: info.serverVersion,
    oscServer: info.oscServer,
  };
}

export function startConsoleHeartbeat(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  onStatusChange: (status: 'online' | 'offline') => void,
  options?: { intervalMs?: number; queryOptions?: ConsoleQueryOptions }
): () => void {
  assertConsoleNetworkConsent(settings);

  const intervalMs = options?.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  let stopped = false;

  const poll = () => {
    queryConsole(deps, ip, '/status', parseStatusReply, options?.queryOptions).then(
      () => {
        if (!stopped) onStatusChange('online');
      },
      () => {
        if (!stopped) onStatusChange('offline');
      }
    );
  };

  poll();
  const handle = setInterval(poll, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
