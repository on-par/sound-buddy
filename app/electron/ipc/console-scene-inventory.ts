// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Metadata-only read of the show file's stored-scene slots (#890): walks
// the fixed 100-path SCENE_INVENTORY_NODE_PATHS table over `/node` — the
// walk sends nothing but `/node`. Consent is asserted per ADR-0006/0013
// before any socket is opened, and socket lifecycle is reused from
// console-connection.ts's queryConsole primitive (ADR-0061). This module
// has no callers yet — no IPC handler, no preload bridge, no UI — C1b owns
// wiring an inventory panel to it. There is deliberately no recall/save/
// store function here: scene contents are not readable read-only, and
// recall is a write the encodeOscMessage guard refuses at the encoder.

import {
  SCENE_INVENTORY_NODE_PATHS,
  SCENE_INVENTORY_SLOT_COUNT,
  parseStoredSceneLine,
  type StoredSceneEntry,
} from '@sound-buddy/console/dist-cjs/index.js';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import type { ConsoleDiscoveryDeps } from './console-discovery';
import { queryConsole, type ConsoleQueryOptions } from './console-connection';

export interface SceneInventoryOptions {
  queryOptions?: ConsoleQueryOptions;
  onProgress?: (done: number, total: number) => void;
}

// Sequential, not parallel: same rationale as captureSceneFromConsole
// (#888) — parallel bursts risk the console's rate limits.
export async function fetchSceneInventory(
  deps: ConsoleDiscoveryDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options?: SceneInventoryOptions
): Promise<StoredSceneEntry[]> {
  assertConsoleNetworkConsent(settings);

  const entries: StoredSceneEntry[] = [];
  for (const path of SCENE_INVENTORY_NODE_PATHS) {
    try {
      const entry = await queryConsole(
        deps,
        ip,
        '/node',
        (message) => parseStoredSceneLine(path, message),
        { ...options?.queryOptions, requestArgs: [{ type: 's', value: path }] }
      );
      entries.push(entry);
    } catch (err) {
      throw new Error(
        `Scene inventory failed: the console at ${ip} did not answer "${path}" ` +
          `(${entries.length} of ${SCENE_INVENTORY_SLOT_COUNT} slots read). Nothing was returned — ` +
          `check the console is still powered on and reachable, then retry. ` +
          `(${String(err)})`,
        { cause: err }
      );
    }
    options?.onProgress?.(entries.length, SCENE_INVENTORY_SLOT_COUNT);
  }

  return entries;
}
