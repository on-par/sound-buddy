// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Read-only `.scn` capture (#888): walks the fixed 2103-path table over
// `/node`, assembles the file, and only then writes it — the walk sends
// nothing but `/node`, and a partial capture is rejected rather than
// written. Socket lifecycle is reused from console-connection.ts's
// queryConsole primitive (ADR-0061); consent is asserted per ADR-0006/0013
// before any socket is opened. This module has no callers yet — no IPC
// handler, no preload bridge, no UI — mirroring console-discovery.ts's own
// "no callers yet" shape; C1b owns wiring a capture UI to it.

import {
  SCENE_NODE_PATHS,
  SCENE_NODE_PATH_COUNT,
  buildSceneHeader,
  assembleSceneFile,
  parseNodeReplyLine,
} from '@sound-buddy/console/dist-cjs/index.js';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import type { ConsoleDiscoveryDeps } from './console-discovery';
import { queryConsole, type ConsoleQueryOptions } from './console-connection';

export interface SceneCaptureOptions {
  name: string;
  note: string;
  queryOptions?: ConsoleQueryOptions;
  onProgress?: (done: number, total: number) => void;
}

export interface SceneCaptureDeps extends ConsoleDiscoveryDeps {
  writeFile: (filePath: string, contents: string) => Promise<void>;
}

// Sequential, not parallel: the measured baseline (350ms / 3 retries, ~250
// q/s, 22.9s total for 2103 queries) is a sequential walk, and parallel
// bursts risk the console's rate limits.
export async function captureSceneFromConsole(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options: SceneCaptureOptions
): Promise<string> {
  assertConsoleNetworkConsent(settings);

  const lines = new Map<string, string>();
  for (const path of SCENE_NODE_PATHS) {
    try {
      const line = await queryConsole(
        deps,
        ip,
        '/node',
        (message) => parseNodeReplyLine(path, message),
        { ...options.queryOptions, requestArgs: [{ type: 's', value: path }] }
      );
      lines.set(path, line);
    } catch (err) {
      throw new Error(
        `Scene capture failed: the console at ${ip} did not answer "${path}" ` +
          `(${lines.size} of ${SCENE_NODE_PATH_COUNT} paths captured). Nothing was saved — ` +
          `check the console is still powered on and reachable, then run the capture again. ` +
          `(${String(err)})`,
        { cause: err }
      );
    }
    options.onProgress?.(lines.size, SCENE_NODE_PATH_COUNT);
  }

  return assembleSceneFile(buildSceneHeader(options.name, options.note), lines);
}

export async function captureSceneToFile(
  deps: SceneCaptureDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  filePath: string,
  options: SceneCaptureOptions
): Promise<string> {
  const contents = await captureSceneFromConsole(deps, settings, ip, options);
  await deps.writeFile(filePath, contents);
  return contents;
}
