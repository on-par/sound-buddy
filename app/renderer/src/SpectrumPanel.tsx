// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Container island mounted into `#spectrum-island` (TD-001 slice 4, #422):
// renders the analysis-view spectrum (curve-with-target or the no-curve bar
// fallback — <SpectrumDisplay> already degrades gracefully when `curve` is
// absent, reproducing today's renderSpectrum()/renderBandMeters()) driven by
// spectrumStore. Renders null when there is no spectrum data — inline-app.js
// keeps driving `#spectrum-imperative` for the empty/loading/error/live-tab
// states, and keeps `#spectrum-title`, `#stats-row`, `#ideal-profile-wrap`,
// and the `#spectrum-island` vs `#spectrum-imperative` visibility toggle in
// sync with store changes (still-inline "panel chrome", see inline-app.js's
// syncReportCardChrome/syncSpectrumForMode). The spectrogram scrubber +
// playback transport are out of scope here too — they imperatively patch DOM
// this component hosts (see the effect below and SpectrumDisplay.tsx's
// design notes).

import { useEffect } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSpectrumStore } from './stores/spectrumStore';
import SpectrumDisplay from './SpectrumDisplay';

interface InlineSpectrumBridge {
  renderFrames(spectrum: unknown): void;
}

function getInlineSpectrum(): InlineSpectrumBridge | undefined {
  return (window as unknown as { inlineSpectrum?: InlineSpectrumBridge }).inlineSpectrum;
}

export default function SpectrumPanel() {
  const { spectrumData, idealProfile, isAutoProfile } = useStoreShallow(useSpectrumStore, (s) => ({
    spectrumData: s.spectrumData,
    idealProfile: s.idealProfile,
    isAutoProfile: s.isAutoProfile,
  }));

  /* c8 ignore start -- passive DOM-bridging effect; no jsdom in this harness
     (renderToString doesn't run effects, and the constitution forbids adding
     a new test framework) — exercised by report-card-spectrum/playback-
     transport e2e, which drive the real scrubber this fills in. Keyed on
     spectrumData so it only reruns for a genuinely new analysis (an
     unrelated re-render recomputes the same reference-unstable-but-value-
     identical object only when spectrumStore itself changes, which only
     happens via a new/cleared analysis).
     Invariant: initSpectrogram's renderScrub() rewrites #spectrum-chart's
     innerHTML directly (imperatively) while scrubbing. React tolerates this
     because <SpectrumDisplay>'s dangerouslySetInnerHTML only reassigns that
     DOM node's innerHTML when the `__html` string itself changes between
     renders — an unrelated re-render recomputing the SAME chart HTML is a
     no-op, so the scrubber's imperative writes survive until the next real
     analysis actually changes the rendered HTML. */
  useEffect(() => {
    if (spectrumData) getInlineSpectrum()?.renderFrames(spectrumData);
  }, [spectrumData]);
  /* c8 ignore stop */

  if (!spectrumData) return null;

  return (
    <>
      <SpectrumDisplay spectrum={spectrumData} idealProfile={idealProfile} isAutoProfile={isAutoProfile} />
      <div id="spectrum-frames-host" />
    </>
  );
}
