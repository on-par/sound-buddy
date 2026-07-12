// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Presentational counterpart to spectrum-display.ts (#305, epic #302): renders
// the same markup renderSpectrum/renderBandMeters build imperatively in
// inline-app.js, from the shared module's functions, so there is one source
// of truth for the spectrum panel's HTML. NOT mounted into the running app
// yet — inline-app.js still drives #spectrum-body at runtime via the
// window.spectrumDisplay bridge (see App.tsx). Wiring this component into the
// live tree is a later epic slice, once the scrubber/playback transport
// (which imperatively rewrites #spectrum-chart innerHTML) is also
// componentized — a React mount here would fight that today. The spectrogram
// heatmap strip and scrubber (spectrum.frames) are out of scope for this
// component; they stay with the imperative playback transport.
//
// Assumes a single instance per page, same as today's single #spectrum-body
// panel.

import { compareToProfile } from '../../../packages/audio-engine/src/profiles/index.js';
import type { IdealProfile } from '../../../packages/audio-engine/src/profiles/index.js';
import {
  bandDbFromSpectrum,
  bandLevelsFromCurve,
  levelMatchedTarget,
  eqBarsHTML,
  spectrumLegendHTML,
  eqCentroidHTML,
  type SpectrumData,
  type IdealProfileLike,
} from './spectrum-display';

export interface SpectrumDisplayProps {
  /** Analysis payload: bands, curve, frames, spectralCentroid. */
  spectrum: SpectrumData;
  /** Resolved target profile; null/undefined → no overlay. */
  idealProfile?: IdealProfileLike | null;
  /** Legend shows the " (auto)" suffix. */
  isAutoProfile?: boolean;
  /** Extra class(es) on the root element. */
  contentClass?: string;
  /** Live mode: bars only, no target overlay/legend (mirrors updateIdealProfileVisibility's currentMode !== 'live' gate). */
  isLive?: boolean;
}

export default function SpectrumDisplay({
  spectrum,
  idealProfile,
  isAutoProfile = false,
  contentClass,
  isLive = false,
}: SpectrumDisplayProps) {
  const curve = spectrum.curve;
  const curveOk = !!(
    curve &&
    Array.isArray(curve.freqs) &&
    Array.isArray(curve.db) &&
    curve.freqs.length === curve.db.length &&
    curve.db.length >= 2
  );
  const showTarget = curveOk && !!idealProfile && !isLive;

  let chartHTML: string;
  let legendHTML = '';
  if (showTarget && curve && idealProfile) {
    const bandDb = bandDbFromSpectrum(spectrum);
    const target = levelMatchedTarget(curve, idealProfile);
    const targetBandDb = bandLevelsFromCurve({ freqs: curve.freqs, db: target });
    // compareToProfile only reads profile.dbOffsets at runtime; IdealProfileLike
    // intentionally narrows the audio-engine IdealProfile shape to the fields
    // levelMatchedTarget/spectrumLegendHTML actually need.
    const cmp = compareToProfile(curve, idealProfile as IdealProfile);
    chartHTML = eqBarsHTML(bandDb, targetBandDb);
    legendHTML = spectrumLegendHTML(idealProfile, cmp, isAutoProfile);
  } else {
    chartHTML = eqBarsHTML(bandDbFromSpectrum(spectrum));
  }
  const centroidHTML = eqCentroidHTML(spectrum);

  return (
    <div className={contentClass}>
      <div
        className="spectrum-chart"
        id="spectrum-chart"
        role="img"
        aria-label="Frequency band levels"
        dangerouslySetInnerHTML={{ __html: chartHTML }}
      />
      {legendHTML && <div dangerouslySetInnerHTML={{ __html: legendHTML }} />}
      {centroidHTML && <div dangerouslySetInnerHTML={{ __html: centroidHTML }} />}
    </div>
  );
}
