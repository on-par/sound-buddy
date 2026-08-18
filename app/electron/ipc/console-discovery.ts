// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// M32R console discovery (#876): a standalone, deps-injected module that
// finds a console on the network by broadcasting an OSC /info request and
// resolves a single console's identity via a unicast /xinfo request (the
// manual-IP fallback). Follows the same deps-injected, unit-testable
// pattern python-stream.ts established for I/O lifecycle (ADR-0010),
// applied here to a UDP socket instead of a child process (ADR-0061).
//
// No unicast subnet sweep, ever: the only two addresses socket.send is
// called with are the fixed BROADCAST_ADDRESS constant and the exact IP a
// caller passes to queryConsoleAtAddress — a prior sweep attempt caused
// macOS to cache reject routes that blocked the real console for the rest
// of the session (#371/#894 spike, ADR-0061).
//
// This module has no callers yet — no IPC handler, no preload bridge entry,
// no renderer UI. #877 (connection lifecycle) and #884 (console panel UI)
// own wiring discoverConsoles/queryConsoleAtAddress to a live consumer.

import * as dgram from 'dgram';
import {
  encodeOscMessage,
  decodeOscMessage,
  replyAddressMatches,
  type DecodedOscMessage,
} from '@sound-buddy/console/dist-cjs/index.js';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';

export const CONSOLE_OSC_PORT = 10023;
export const BROADCAST_ADDRESS = '255.255.255.255';
export const DEFAULT_LISTEN_WINDOW_MS = 4000;
export const DEFAULT_RETRY_INTERVAL_MS = 1000;
export const DEFAULT_QUERY_TIMEOUT_MS = 4000;
// Both /info and /xinfo reply with exactly 4 OSC string args (ssss).
const EXPECTED_REPLY_ARG_COUNT = 4;

export interface ConsoleIdentity {
  ip: string;
  model: string;
  firmware: string;
  /** Present on /xinfo replies only. */
  name?: string;
  /** Present on /info replies only. */
  serverVersion?: string;
  /** Present on /info replies only. */
  oscServer?: string;
}

export interface ConsoleDiscoverySocket {
  bind(callback: () => void): void;
  setBroadcast(flag: boolean): void;
  send(msg: Uint8Array, port: number, address: string): void;
  on(event: 'message', listener: (msg: Buffer, rinfo: { address: string }) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  close(): void;
}

export type CreateConsoleDiscoverySocket = () => ConsoleDiscoverySocket;

export interface ConsoleDiscoveryDeps {
  createSocket?: CreateConsoleDiscoverySocket;
  log: (msg: string) => void;
}

// dgram.createSocket('udp4')'s return type doesn't structurally narrow to
// ConsoleDiscoverySocket without a cast, even though a real dgram.Socket
// satisfies every member of that interface at runtime.
function defaultCreateSocket(): ConsoleDiscoverySocket {
  return dgram.createSocket('udp4') as unknown as ConsoleDiscoverySocket;
}

export function parseInfoReply(sourceIp: string, message: DecodedOscMessage): ConsoleIdentity | null {
  if (!replyAddressMatches('/info', message.address)) return null;
  if (message.args.length !== EXPECTED_REPLY_ARG_COUNT || message.args.some((a) => a.type !== 's')) return null;
  const [serverVersion, oscServer, model, firmware] = message.args.map((a) => (a as { value: string }).value);
  return { ip: sourceIp, model, firmware, serverVersion, oscServer };
}

export function parseXInfoReply(message: DecodedOscMessage): ConsoleIdentity | null {
  if (!replyAddressMatches('/xinfo', message.address)) return null;
  if (message.args.length !== EXPECTED_REPLY_ARG_COUNT || message.args.some((a) => a.type !== 's')) return null;
  const [ip, name, model, firmware] = message.args.map((a) => (a as { value: string }).value);
  return { ip, model, firmware, name };
}

export async function discoverConsoles(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  options?: { listenWindowMs?: number; retryIntervalMs?: number }
): Promise<ConsoleIdentity[]> {
  assertConsoleNetworkConsent(settings);

  const listenWindowMs = options?.listenWindowMs ?? DEFAULT_LISTEN_WINDOW_MS;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const socket = deps.createSocket?.() ?? defaultCreateSocket();
  const found = new Map<string, ConsoleIdentity>();
  const request = encodeOscMessage({ address: '/info', args: [] });

  return new Promise<ConsoleIdentity[]>((resolve, reject) => {
    let settled = false;
    let retryHandle: ReturnType<typeof setInterval> | undefined;
    let windowHandle: ReturnType<typeof setTimeout> | undefined;

    // finish is only ever scheduled once, as windowHandle's own callback, so
    // by the time it runs windowHandle is always already assigned — no
    // settled re-entrancy is possible here (that's the 'error' handler's
    // job, since a real dgram socket can error before bind's callback runs).
    const finish = () => {
      settled = true;
      clearInterval(retryHandle);
      clearTimeout(windowHandle);
      socket.close();
      resolve(Array.from(found.values()));
    };

    socket.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(retryHandle);
      clearTimeout(windowHandle);
      socket.close();
      reject(err);
    });

    socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
      let decoded: DecodedOscMessage;
      try {
        decoded = decodeOscMessage(new Uint8Array(msg));
      } catch (err) {
        deps.log(`console-discovery: ignoring unparsable datagram from ${rinfo.address}: ${String(err)}`);
        return;
      }
      const identity = parseInfoReply(rinfo.address, decoded);
      if (!identity) {
        deps.log(`console-discovery: ignoring unrelated reply from ${rinfo.address} (address ${decoded.address})`);
        return;
      }
      found.set(identity.ip, identity);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(request, CONSOLE_OSC_PORT, BROADCAST_ADDRESS);
      retryHandle = setInterval(() => {
        socket.send(request, CONSOLE_OSC_PORT, BROADCAST_ADDRESS);
      }, retryIntervalMs);
      windowHandle = setTimeout(finish, listenWindowMs);
    });
  });
}

export async function queryConsoleAtAddress(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options?: { timeoutMs?: number; retryIntervalMs?: number }
): Promise<ConsoleIdentity> {
  assertConsoleNetworkConsent(settings);

  const timeoutMs = options?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const socket = deps.createSocket?.() ?? defaultCreateSocket();
  const request = encodeOscMessage({ address: '/xinfo', args: [] });

  return new Promise<ConsoleIdentity>((resolve, reject) => {
    let settled = false;
    let retryHandle: ReturnType<typeof setInterval> | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearInterval(retryHandle);
      clearTimeout(timeoutHandle);
      socket.close();
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
        deps.log(`console-discovery: ignoring unparsable datagram from ${ip}: ${String(err)}`);
        return;
      }
      const identity = parseXInfoReply(decoded);
      if (!identity) {
        deps.log(`console-discovery: ignoring unrelated reply from ${ip} (address ${decoded.address})`);
        return;
      }
      settled = true;
      cleanup();
      resolve(identity);
    });

    socket.bind(() => {
      socket.send(request, CONSOLE_OSC_PORT, ip);
      retryHandle = setInterval(() => {
        socket.send(request, CONSOLE_OSC_PORT, ip);
      }, retryIntervalMs);
      // Only ever scheduled once, as timeoutHandle's own callback: cleanup()
      // (from the 'message' or 'error' handler) clears this timer before it
      // could fire again, so no settled re-entrancy is possible here.
      timeoutHandle = setTimeout(() => {
        settled = true;
        cleanup();
        reject(
          new Error(
            `No reply from a console at ${ip}:${CONSOLE_OSC_PORT} within ${timeoutMs}ms — check the IP is correct and the console is powered on and reachable on the network.`
          )
        );
      }, timeoutMs);
    });
  });
}
