// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { useLayoutEffect, useRef } from 'react';
import {
  PROFILES as AE_PROFILES,
  GRID_FREQS as AE_GRID_FREQS,
  compareToProfile as aeCompareToProfile,
  defaultProfileForContentType as aeDefaultProfileForContentType,
} from '../../../packages/audio-engine/src/profiles/index.js';
import * as spectrumDisplay from './spectrum-display';
import rootMarkup from './root-markup.html?raw';
import rigReconcileSrc from '../rig-reconcile.js?raw';
import collapseStateSrc from '../collapse-state.js?raw';
import armStateSrc from '../arm-state.js?raw';
import rigKindSrc from '../rig-kind.js?raw';
import groupStateSrc from '../group-state.js?raw';
import trackWorkspaceSrc from '../track-workspace.js?raw';
import playbackRoutingSrc from '../playback-routing.js?raw';
import licenseStateSrc from '../license-state.js?raw';
import upgradeMomentumSrc from '../upgrade-momentum.js?raw';
import onboardingStateSrc from '../onboarding-state.js?raw';
import idealCurvesSrc from '../ideal-curves.js?raw';
import gradingSrc from '../grading.js?raw';
import inlineAppSrc from './inline-app.js?raw';

// Boot scripts in their original document order (#303): the 12 UMD helpers
// (each attaches to `window`, see the classic-script comment above their old
// <script src> tags in index.html), then the inline app script that wires up
// the UI and reads those globals. Ported verbatim — see the source files.
const BOOT_SCRIPTS = [
  rigReconcileSrc,
  collapseStateSrc,
  armStateSrc,
  rigKindSrc,
  groupStateSrc,
  trackWorkspaceSrc,
  playbackRoutingSrc,
  licenseStateSrc,
  upgradeMomentumSrc,
  onboardingStateSrc,
  idealCurvesSrc,
  gradingSrc,
  inlineAppSrc,
];

export default function App() {
  const booted = useRef(false);

  // useLayoutEffect (not useEffect) so this runs synchronously right after
  // mount, before paint — matching the original synchronous <script>
  // execution order as closely as possible. Guarded by `booted` since
  // without <StrictMode> this only ever runs once anyway, but the guard
  // makes that explicit and safe if that ever changes.
  //
  // #root is `display:flex; flex-direction:column` and its direct children
  // (the banners, #header, #stage, …) rely on being direct flex items, so
  // the markup is set via imperative innerHTML on #root itself rather than
  // returned as JSX — a JSX-rendered wrapper div would break that layout by
  // inserting an extra flex item. App renders nothing through React; it only
  // drives #root imperatively, once.
  useLayoutEffect(() => {
    if (booted.current) return;
    booted.current = true;
    document.getElementById('root')!.innerHTML = rootMarkup;
    (window as Window & { audioEngineProfiles?: unknown }).audioEngineProfiles = {
      PROFILES: AE_PROFILES,
      GRID_FREQS: AE_GRID_FREQS,
      compareToProfile: aeCompareToProfile,
      defaultProfileForContentType: aeDefaultProfileForContentType,
    };
    (window as Window & { spectrumDisplay?: unknown }).spectrumDisplay = spectrumDisplay;
    for (const src of BOOT_SCRIPTS) {
      const script = document.createElement('script');
      script.textContent = src;
      document.body.appendChild(script);
    }
  }, []);

  return null;
}
