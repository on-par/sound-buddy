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

import {
  spectrumChartModel,
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
  /** Pinned spectrogram frame; null/undefined → whole-file average bars. */
  selectedFrame?: number | null;
}

export default function SpectrumDisplay({
  spectrum,
  idealProfile,
  isAutoProfile = false,
  contentClass,
  isLive = false,
  selectedFrame = null,
}: SpectrumDisplayProps) {
  const { chartHTML, legendHTML, centroidHTML } = spectrumChartModel({
    spectrum, idealProfile, isAutoProfile, isLive, selectedFrame,
  });

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
