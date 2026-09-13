// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Dev-only frame-time probe for `applyLiveTick` (#1414, parent #1406 — the Live
// tab monitoring performance epic). Mirrors timeline-scale-harness.ts's shape —
// injected deps -> factory -> module singleton -> installHook(target, enabled) —
// so a reader familiar with that module recognizes this one's pattern. Disabled
// at module load: `beginTick`/`noteBoardHtml` are a single boolean check until
// something calls `start()`, which is only reachable through the
// SOUND_BUDDY_TEST_HOOKS-gated window hook (App.tsx), never an AppSettings field
// (see ADR-0137) — this is measurement instrumentation, not a product feature.

export const LIVE_FRAME_PROBE_HOOK_KEY = '__soundBuddyFrameProbe';

/** Ring-buffer cap — bounds memory for a probe left running across a long
 *  monitoring session; the release-verification workflow only needs the most
 *  recent window of ticks, not the session's full history. */
export const LIVE_FRAME_PROBE_MAX_SAMPLES = 500;

/** The queryable value: plain data only (no functions), so it survives
 *  Playwright's/DevTools' page.evaluate structured-clone boundary. */
export interface LiveFrameProbeSummary {
  readonly enabled: boolean;
  readonly sampleCount: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly boardRebuildCount: number;
}

export interface LiveFrameProbeModel {
  isEnabled(): boolean;
  start(): void;
  stop(): void;
  /** Call first in `applyLiveTick`. Returns a clock reading to hand back to
   *  `endTick`, or null while disabled — an early return in between (a no-op
   *  tick) then records no sample, since `endTick` never runs for it. */
  beginTick(): number | null;
  endTick(started: number | null): void;
  /** Call with the board's freshly-built markup string on every render —
   *  a changed string IS the `dangerouslySetInnerHTML` rebuild. */
  noteBoardHtml(html: string): void;
  summary(): LiveFrameProbeSummary;
}

/** The surface installed on window — a validated subset of LiveFrameProbeModel
 *  suitable for an untyped page.evaluate()/DevTools console caller. */
export interface LiveFrameProbeTestHook {
  start(): void;
  stop(): void;
  summary(): LiveFrameProbeSummary;
}

export interface LiveFrameProbeDeps {
  now: () => number;
  maxSamples?: number;
}

/** Percentile over `samples` via linear interpolation between the two nearest
 *  ranks (the "R-7" method — matches what most percentile libraries default
 *  to). Pure — does not mutate `samples`. Null for an empty set. */
export function percentileMs(samples: readonly number[], percentile: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (percentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const weight = rank - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
}

/** Renders a summary into the one-line string the release-verification step
 *  (AC4) copies into release notes or a PR body. */
export function formatLiveFrameProbeSummary(summary: LiveFrameProbeSummary): string {
  if (!summary.enabled) return 'live frame probe: disabled';
  if (summary.sampleCount === 0) return 'live frame probe: enabled, no samples yet';
  return `live frame probe: p50=${summary.p50Ms!.toFixed(2)}ms p95=${summary.p95Ms!.toFixed(2)}ms samples=${summary.sampleCount} boardRebuilds=${summary.boardRebuildCount}`;
}

export function createLiveFrameProbeModel(
  deps: LiveFrameProbeDeps = { now: () => performance.now() },
): LiveFrameProbeModel {
  const maxSamples = deps.maxSamples ?? LIVE_FRAME_PROBE_MAX_SAMPLES;
  let enabled = false;
  let samples: number[] = [];
  let boardRebuildCount = 0;
  let lastBoardHtml: string | null = null;

  return {
    isEnabled: () => enabled,
    start() {
      enabled = true;
      samples = [];
      boardRebuildCount = 0;
      lastBoardHtml = null;
    },
    stop() {
      // Disables further sampling but leaves the accumulated summary
      // readable — the release-verification workflow calls stop() then
      // reads summary(), and a wipe-on-stop would zero it out first.
      enabled = false;
    },
    beginTick() {
      if (!enabled) return null;
      return deps.now();
    },
    endTick(started) {
      if (!enabled || started === null) return;
      samples.push(deps.now() - started);
      if (samples.length > maxSamples) samples.shift();
    },
    noteBoardHtml(html) {
      if (!enabled) return;
      if (lastBoardHtml !== null && lastBoardHtml !== html) boardRebuildCount += 1;
      lastBoardHtml = html;
    },
    summary() {
      return Object.freeze({
        enabled,
        sampleCount: samples.length,
        p50Ms: percentileMs(samples, 50),
        p95Ms: percentileMs(samples, 95),
        boardRebuildCount,
      });
    },
  };
}

/** The one shared instance — same "one owner" convention as
 *  sessionTimelineScaleModel in timeline-scale-harness.ts. */
export const liveFrameProbe: LiveFrameProbeModel = createLiveFrameProbeModel();

export function createLiveFrameProbeTestHook(model: LiveFrameProbeModel): LiveFrameProbeTestHook {
  return {
    start: () => model.start(),
    stop: () => model.stop(),
    summary: () => model.summary(),
  };
}

/** Installs (enabled) or removes (disabled) the test hook at
 *  target[LIVE_FRAME_PROBE_HOOK_KEY]. Returns an uninstall closure when
 *  installed, or null when the key was left/made absent. */
export function installLiveFrameProbeTestHook(
  target: Record<string, unknown>,
  enabled: boolean,
  model: LiveFrameProbeModel = liveFrameProbe,
): (() => void) | null {
  if (!enabled) {
    delete target[LIVE_FRAME_PROBE_HOOK_KEY];
    return null;
  }
  target[LIVE_FRAME_PROBE_HOOK_KEY] = createLiveFrameProbeTestHook(model);
  return () => { delete target[LIVE_FRAME_PROBE_HOOK_KEY]; };
}
