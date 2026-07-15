// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PROFILES as AE_PROFILES,
  GRID_FREQS as AE_GRID_FREQS,
  compareToProfile as aeCompareToProfile,
  defaultProfileForContentType as aeDefaultProfileForContentType,
} from '@sound-buddy/audio-engine/dist/profiles/index.js';
import { findSpectralPeaks } from '@sound-buddy/audio-engine/dist/analyze/spectral.js';
import * as spectrumDisplay from './spectrum-display';
import * as reportCard from './report-card';
import * as liveCapturePanel from './live-capture-panel';
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
import buildOrderStateSrc from '../build-order-state.js?raw';
import passModeStateSrc from '../pass-mode-state.js?raw';
import phaseDoublingStateSrc from '../phase-doubling-state.js?raw';
import preflightSrc from '../preflight.js?raw';
import feedbackRingoutSrc from '../feedback-ringout-state.js?raw';
import gradeOwnStateSrc from '../grade-own-state.js?raw';
import inlineAppSrc from './inline-app.js?raw';
import LicensePanel from './LicensePanel';
import SettingsPanel from './SettingsPanel';
import ReportCardIsland from './ReportCardIsland';
import SpectrumPanel from './SpectrumPanel';
import { installStoreBridge } from './stores/bridge';

// Boot scripts in their original document order (#303): the 18 UMD helpers
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
  buildOrderStateSrc,
  passModeStateSrc,
  phaseDoublingStateSrc,
  preflightSrc,
  feedbackRingoutSrc,
  gradeOwnStateSrc,
  inlineAppSrc,
];

export default function App() {
  const bootedOnce = useRef(false);
  // #report-card/#spectrum-island are portal targets that live inside
  // `rootMarkup`, injected via innerHTML below — they don't exist at the
  // very first render (unlike the license/settings islands, which are static
  // index.html nodes). `booted` forces a second render once that innerHTML
  // assignment has run, so ReportCardIsland/SpectrumPanel's portals target
  // real DOM nodes (TD-001 slice 4, #422).
  const [booted, setBooted] = useState(false);

  // useLayoutEffect (not useEffect) so this runs synchronously right after
  // mount, before paint — matching the original synchronous <script>
  // execution order as closely as possible. Guarded by `bootedOnce` since
  // without <StrictMode> this only ever runs once anyway, but the guard
  // makes that explicit and safe if that ever changes.
  //
  // #root is `display:flex; flex-direction:column` and its direct children
  // (the banners, #header, #stage, …) rely on being direct flex items, so
  // the markup is set via imperative innerHTML on #root itself rather than
  // returned as JSX — a JSX-rendered wrapper div would break that layout by
  // inserting an extra flex item. App drives #root imperatively, once; the
  // only JSX it returns are islands portaled onto static or boot-injected
  // nodes (TD-001 slices 3 #421 and 4 #422) — see below.
  useLayoutEffect(() => {
    if (bootedOnce.current) return;
    bootedOnce.current = true;
    document.getElementById('root')!.innerHTML = rootMarkup;
    (window as Window & { audioEngineProfiles?: unknown }).audioEngineProfiles = {
      PROFILES: AE_PROFILES,
      GRID_FREQS: AE_GRID_FREQS,
      compareToProfile: aeCompareToProfile,
      defaultProfileForContentType: aeDefaultProfileForContentType,
    };
    (window as Window & { audioEngineSpectral?: unknown }).audioEngineSpectral = { findSpectralPeaks };
    (window as Window & { spectrumDisplay?: unknown }).spectrumDisplay = spectrumDisplay;
    (window as Window & { reportCard?: unknown }).reportCard = reportCard;
    (window as Window & { liveCapturePanel?: unknown }).liveCapturePanel = liveCapturePanel;
    // Installed before the boot scripts run — inline-app.js reads
    // window.rendererStores at its top level (TD-001 slice 3, #421).
    installStoreBridge();
    for (const src of BOOT_SCRIPTS) {
      const script = document.createElement('script');
      script.textContent = src;
      document.body.appendChild(script);
    }
    // #report-card/#spectrum-island now exist (just injected above) —
    // trigger the second render that portals ReportCardIsland/SpectrumPanel
    // onto them (TD-001 slice 4, #422).
    setBooted(true);
  }, []);

  // #license-island and #settings-island are static nodes in index.html (see
  // its comments), so they exist at this first render — no ready-flag guard
  // needed. The panels' own mount effects (passive useEffect) run after this
  // layout effect commits, i.e. after the boot scripts install their store
  // subscribers — safe either order, since subscribers only fire on a
  // subsequent store change, not on mount.
  return (
    <>
      {createPortal(<LicensePanel />, document.getElementById('license-island')!)}
      {createPortal(<SettingsPanel />, document.getElementById('settings-island')!)}
      {booted && createPortal(<ReportCardIsland />, document.getElementById('report-card')!)}
      {booted && createPortal(<SpectrumPanel />, document.getElementById('spectrum-island')!)}
    </>
  );
}
