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
//
// #1490: a single missed `/node` reply defers that path instead of aborting
// the walk — the walk finishes the table, then sweeps the deferred paths
// once (fresh queries, an escalated budget, and a settle pause first) before
// giving up. The consecutive-failure breaker and deferred cap in
// scene-capture-retry.ts still fail fast on a genuinely dead console.
// assembleSceneFile remains the only place a capture becomes text — it is
// only ever called once every path has a line.

import {
  loadConsoleModule,
} from '../console-loader';
import { assertConsoleNetworkConsent } from '../console-network-consent';
import type { AppSettings } from './api';
import type { ConsoleDiscoveryDeps } from './console-discovery';
import { queryConsole, type ConsoleQueryOptions } from './console-connection';
import {
  createSceneCaptureWalkState,
  recordWalkSuccess,
  recordWalkFailure,
  isWalkBreakerTripped,
  buildSceneCaptureFailureMessage,
  WALK_QUERY_TIMEOUT_MS,
  WALK_QUERY_MAX_RETRIES,
  SWEEP_QUERY_TIMEOUT_MS,
  SWEEP_QUERY_MAX_RETRIES,
  SWEEP_SETTLE_PAUSE_MS,
} from './scene-capture-retry';

const {
  SCENE_NODE_PATHS,
  SCENE_NODE_PATH_COUNT,
  buildSceneHeader,
  assembleSceneFile,
  parseNodeReplyLine,
} = loadConsoleModule();

export interface SceneCaptureOptions {
  name: string;
  note: string;
  queryOptions?: ConsoleQueryOptions;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface SceneCaptureWalkDeps extends ConsoleDiscoveryDeps {
  /** Pause before the sweep pass; overridable so tests don't wait a real second. Defaults to a real setTimeout. */
  wait?: (ms: number) => Promise<void>;
}

export interface SceneCaptureDeps extends SceneCaptureWalkDeps {
  writeFile: (filePath: string, contents: string) => Promise<void>;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Scene capture cancelled. Nothing was saved.');
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryNodePath(
  deps: SceneCaptureWalkDeps,
  ip: string,
  path: string,
  budget: ConsoleQueryOptions,
  queryOptions: ConsoleQueryOptions | undefined
): Promise<string> {
  return queryConsole(
    deps,
    ip,
    '/node',
    (message) => parseNodeReplyLine(path, message),
    { ...budget, ...queryOptions, requestArgs: [{ type: 's', value: path }] }
  );
}

// Sequential, not parallel: the measured baseline (350ms / 3 retries, ~250
// q/s, 22.9s total for 2103 queries) is a sequential walk, and parallel
// bursts risk the console's rate limits.
export async function captureSceneFromConsole(
  deps: SceneCaptureWalkDeps,
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>,
  ip: string,
  options: SceneCaptureOptions
): Promise<string> {
  assertConsoleNetworkConsent(settings);

  const lines = new Map<string, string>();
  const walkState = createSceneCaptureWalkState();
  let lastError: unknown;
  let lastFailedPath = '';
  const walkBudget: ConsoleQueryOptions = { timeoutMs: WALK_QUERY_TIMEOUT_MS, maxRetries: WALK_QUERY_MAX_RETRIES };
  const sweepBudget: ConsoleQueryOptions = { timeoutMs: SWEEP_QUERY_TIMEOUT_MS, maxRetries: SWEEP_QUERY_MAX_RETRIES };

  for (const path of SCENE_NODE_PATHS) {
    throwIfAborted(options.signal);
    try {
      const line = await queryNodePath(deps, ip, path, walkBudget, options.queryOptions);
      throwIfAborted(options.signal);
      lines.set(path, line);
      recordWalkSuccess(walkState);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      lastError = err;
      lastFailedPath = path;
      recordWalkFailure(walkState, path);
      if (isWalkBreakerTripped(walkState)) {
        throw new Error(
          buildSceneCaptureFailureMessage(ip, lastFailedPath, lines.size, SCENE_NODE_PATH_COUNT, lastError),
          { cause: err }
        );
      }
    }
    options.onProgress?.(lines.size, SCENE_NODE_PATH_COUNT);
  }

  if (walkState.deferred.length > 0) {
    await (deps.wait ?? defaultWait)(SWEEP_SETTLE_PAUSE_MS);

    for (const path of walkState.deferred) {
      throwIfAborted(options.signal);
      try {
        const line = await queryNodePath(deps, ip, path, sweepBudget, options.queryOptions);
        throwIfAborted(options.signal);
        lines.set(path, line);
      } catch (err) {
        if (options.signal?.aborted) throw err;
        lastError = err;
        lastFailedPath = path;
      }
      options.onProgress?.(lines.size, SCENE_NODE_PATH_COUNT);
    }
  }

  if (lines.size < SCENE_NODE_PATH_COUNT) {
    throw new Error(
      buildSceneCaptureFailureMessage(ip, lastFailedPath, lines.size, SCENE_NODE_PATH_COUNT, lastError),
      { cause: lastError }
    );
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
