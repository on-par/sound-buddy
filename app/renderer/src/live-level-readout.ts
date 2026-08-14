// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Header live-level readout (#767): a pure view deriving the top-right
// #live-level-readout element's content from the shared LiveMeterSnapshot,
// plus a small c8-ignored DOM applier (same ADR-0005 split as
// spectrum-display.ts's patchBarsAndLabels — the store snapshot is read by
// LiveWorkspace's single createLiveMeterController and patched straight to the
// DOM at animation rate, never through React). The readout measures the same
// "room" the app already treats as the measurement input: the measurement-
// source strip (measurementChannel, falling back to channel 0), or the
// secondary measurement device's channel 0 when it is active (ADR-0003
// precedence, matching the stats row and the live report-card source). It is
// deliberately honest about being relative dBFS — it reuses report-card.ts's
// fmt/levelColor rather than re-deriving a level, and true calibrated SPL is a
// documented follow-on that needs a reference measurement mic.

import { fmt, levelColor } from './report-card';
import { measurementChannel } from './live-capture-panel';
import type { LiveMeterSnapshot } from './live-meter-controller';

export interface LiveLevelReadoutView {
  visible: boolean;
  rmsText: string;   // fmt(rms) or '—' when no channel / idle
  peakText: string;  // `pk ${fmt(peak)}` or 'pk —'
  color: string;     // levelColor(rms) CSS var, or 'var(--issue-text)' when clipping
  clipping: boolean;
}

const NO_DATA = '—';

export function liveLevelReadout(snap: LiveMeterSnapshot): LiveLevelReadoutView {
  const active = snap.isCapturing || snap.secondaryActive;
  if (!active) return { visible: false, rmsText: NO_DATA, peakText: `pk ${NO_DATA}`, color: 'var(--meter-idle)', clipping: false };
  const ch = snap.secondaryActive
    ? (snap.lastMeasurementChannels?.[0] ?? null)
    : measurementChannel(snap.lastTick?.channels, snap.measurementSource);
  if (!ch) return { visible: true, rmsText: NO_DATA, peakText: `pk ${NO_DATA}`, color: 'var(--meter-idle)', clipping: false };
  const clipping = !!ch.clipping;
  return {
    visible: true,
    rmsText: fmt(ch.rms),
    peakText: `pk ${fmt(ch.peak)}`,
    color: clipping ? 'var(--issue-text)' : levelColor(ch.rms),
    clipping,
  };
}

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness (same
   precedent as live-capture-panel.ts's patchLiveChannel and spectrum-display.ts's
   patchBarsAndLabels); exercised by the live-capture e2e spec (#767). */
export function patchLevelReadout(el: Element, view: LiveLevelReadoutView): void {
  el.classList.toggle('clip', view.clipping);
  const rms = el.querySelector('.live-level-rms');
  if (rms instanceof HTMLElement) { rms.textContent = view.rmsText; rms.style.color = view.color; }
  const peak = el.querySelector('.live-level-peak');
  if (peak) peak.textContent = view.peakText;
  const meter = el as HTMLElement;
  meter.style.display = view.visible ? 'flex' : 'none';
  const parsed = parseFloat(view.rmsText);
  meter.setAttribute('aria-valuenow', String(Number.isFinite(parsed) ? parsed : -120));
  meter.setAttribute('aria-valuetext', `${view.rmsText} dBFS, relative`);
}
/* c8 ignore stop */
