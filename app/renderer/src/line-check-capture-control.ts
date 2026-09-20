// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure "capture this channel" control derivation for the line-check
// calibration epic (#1467, epic #1462). Enablement routes through lc-01's
// soleSoloedChannelIndex (line-check-indicator.ts, #1464) — the exact same
// signal the "Currently checking" status-line indicator reads — so the
// control and the indicator can never disagree about which channel (if any)
// is the line-check subject (ADR-0139). `averageCaptureCurve` reduces a
// capture's per-tick sample buffer to one curve using the same power-domain
// mean convention ADR-0138's bandTargetsFromProfile uses for band reduction.

import { soleSoloedChannelIndex } from './line-check-indicator';
import type { ChannelFlagMap } from './live-capture-panel';
import type { SpectrumCurve } from './spectrum-display';

/** The index of the channel the capture control targets, or null when the
 *  flag is off or lc-01 reports no unambiguous "currently checking" channel
 *  — the same rule the status-line indicator uses (ADR-0139). */
export function lineCheckCaptureTarget(enabled: boolean, soloedChannels: ChannelFlagMap): number | null {
  return enabled ? soleSoloedChannelIndex(soloedChannels) : null;
}

export interface LineCheckCaptureControlView {
  enabled: boolean;
  buttonLabel: string;
  hint: string;
}

const IDLE_HINT = 'Solo exactly one channel to enable capture.';

/** Button/hint text for the capture control. `capturing` keeps the control
 *  enabled (as a Stop affordance) even if the solo state changes mid-capture
 *  — an engineer-triggered stop must always be reachable once a capture has
 *  started (no implicit auto-capture or auto-stop, ADR-0140). */
export function lineCheckCaptureControlView(
  target: number | null,
  capturing: boolean,
  labelAt: (index: number) => string,
): LineCheckCaptureControlView {
  const enabled = capturing || target !== null;
  if (capturing) {
    const label = target !== null ? labelAt(target) : null;
    return { enabled, buttonLabel: 'Stop capture', hint: label ? `Capturing ${label}…` : 'Capturing…' };
  }
  if (target === null) return { enabled, buttonLabel: 'Capture this channel', hint: IDLE_HINT };
  return { enabled, buttonLabel: 'Capture this channel', hint: `Ready to capture ${labelAt(target)}.` };
}

// Silence floor for a bin with no finite sample — mirrors live-capture-panel.ts's
// liveAnalyzerCurve floor, so an all-silent capture reduces the same way a
// live tick's missing curve value does.
const SILENCE_FLOOR_DB = -120;

/** Reduces a capture's buffered per-tick curves to one curve: each frequency
 *  bin is the power-domain mean of that bin across every sample (ADR-0138's
 *  reduction convention) rather than a plain dB average, so louder ticks
 *  aren't washed out the way a linear-dB mean would wash them out. Assumes
 *  every sample shares the same freq grid (all callers sample on
 *  ANALYZER_GRID_FREQS/GRID_FREQS, which are numerically identical). Null
 *  for an empty buffer. */
export function averageCaptureCurve(samples: SpectrumCurve[]): SpectrumCurve | null {
  if (samples.length === 0) return null;
  const freqs = samples[0].freqs;
  const db = freqs.map((_, i) => {
    let powerSum = 0;
    let n = 0;
    for (const sample of samples) {
      const value = sample.db[i];
      if (!Number.isFinite(value)) continue;
      powerSum += Math.pow(10, value / 10);
      n += 1;
    }
    return n > 0 ? 10 * Math.log10(powerSum / n) : SILENCE_FLOOR_DB;
  });
  return { freqs, db };
}
