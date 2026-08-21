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
import * as spectrumChrome from './spectrum-chrome';
import * as reportCard from './report-card';
import * as reportExport from './report-export';
import * as shareCard from './share-card';
import * as liveCapturePanel from './live-capture-panel';
import * as measurementDeviceState from './measurement-device-state';
import * as crashHooks from './crash-hooks';
import { stopCaptureIfRunning as stopLiveCaptureIfRunning } from './LiveControls';
import rootMarkup from './root-markup.html?raw';
import rigReconcileSrc from '../rig-reconcile.js?raw';
import armStateSrc from '../arm-state.js?raw';
import channelLabelsSrc from '../channel-labels.js?raw';
import instrumentProfilesSrc from '../instrument-profiles.js?raw';
import rigKindSrc from '../rig-kind.js?raw';
import groupStateSrc from '../group-state.js?raw';
import trackWorkspaceSrc from '../track-workspace.js?raw';
import playbackRoutingSrc from '../playback-routing.js?raw';
import licenseStateSrc from '../license-state.js?raw';
import upgradeMomentumSrc from '../upgrade-momentum.js?raw';
import onboardingStateSrc from '../onboarding-state.js?raw';
import whatsNewStateSrc from '../whats-new-state.js?raw';
import liveSetupStateSrc from '../live-setup-state.js?raw';
import liveTransitionStateSrc from '../live-transition-state.js?raw';
import idealCurvesSrc from '../ideal-curves.js?raw';
import gradingSrc from '../grading.js?raw';
import buildOrderStateSrc from '../build-order-state.js?raw';
import passModeStateSrc from '../pass-mode-state.js?raw';
import phaseDoublingStateSrc from '../phase-doubling-state.js?raw';
import preflightSrc from '../preflight.js?raw';
import feedbackRingoutSrc from '../feedback-ringout-state.js?raw';
import gradeOwnStateSrc from '../grade-own-state.js?raw';
import feedbackFormSrc from '../feedback-form-state.js?raw';
import updateDownloadStateSrc from '../update-download-state.js?raw';
import dawWorkspaceStateSrc from '../daw-workspace-state.js?raw';
import dawPlayheadStateSrc from '../daw-playhead-state.js?raw';
import dawWaveformStateSrc from '../daw-waveform-state.js?raw';
import liveAdjustmentsStateSrc from '../live-adjustments-state.js?raw';
import reportFirstUxStateSrc from '../report-first-ux-state.js?raw';
import singleColumnStateSrc from '../single-column-state.js?raw';
import analyzeSourceStateSrc from '../analyze-source-state.js?raw';
import batchAnalysisSrc from '../batch-analysis.js?raw';
import skillTreeStateSrc from '../skill-tree-state.js?raw';
import inlineAppSrc from './inline-app.js?raw';
import LicensePanel from './LicensePanel';
import SettingsPanel from './SettingsPanel';
import ReportCardIsland from './ReportCardIsland';
import SpectrumPanel from './SpectrumPanel';
import IdealProfileSelect from './IdealProfileSelect';
import CurveEditorDialog from './CurveEditorDialog';
import RecordButton from './RecordButton';
import LiveWorkspace from './LiveWorkspace';
import LiveEqPane from './LiveEqPane';
import SoundcheckPanel from './SoundcheckPanel';
import ModeTabs from './ModeTabs';
import * as modeSwitch from './mode-switch';
import * as reportCardChrome from './report-card-chrome';
import ReportCardToolbar from './ReportCardToolbar';
import UpgradeMomentum from './UpgradeMomentum';
import RecentServicesPanel from './RecentServicesPanel';
import BuildGuidePanel from './BuildGuidePanel';
import RingoutPanel from './RingoutPanel';
import DirectoryPanel from './DirectoryPanel';
import LicenseChrome from './LicenseChrome';
import ConsoleNetworkConsentDialog from './ConsoleNetworkConsentDialog';
import ConsolePanel from './ConsolePanel';
import UpdateBanner from './UpdateBanner';
import WhatsNewBanner from './WhatsNewBanner';
import OnboardingDialog from './OnboardingDialog';
import SkillTreeDialog from './SkillTreeDialog';
import { useOnboardingStore } from './stores/onboardingStore';
import { useSkillTreeStore } from './stores/skillTreeStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useRigStore } from './stores/rigStore';
import { getSoundBuddy } from './useElectron';
import FeedbackDialog from './FeedbackDialog';
import GradeOwnGuideDialog from './GradeOwnGuideDialog';
import PhaseDoublingDialog from './PhaseDoublingDialog';
import AnalyzeSourcePicker from './AnalyzeSourcePicker';
import LiveArmHint from './LiveArmHint';
import MeasurementBadge from './MeasurementBadge';
import { installStoreBridge } from './stores/bridge';
import { createCaptureLifecycle, type DawShellSeam, type PreflightApi, type RigReconcileApi, type ArmStateApi } from './capture-lifecycle';
import { createDawShellRuntime, type DawShellRuntime, type DawPlayheadStateApi, type DawWaveformStateApi } from './daw-shell-runtime';
import LiveStatusLine from './LiveStatusLine';
import LiveSessionOffers from './LiveSessionOffers';
import WindowBadge from './WindowBadge';
import RigDialog from './RigDialog';
import type { LiveCaptureRuntime, LiveTransitionState } from './LiveControls';
import type { LiveSetupStepsApi } from './live-workspace-view';

// Boot scripts in their original document order (#303): the 33 UMD helpers
// (each attaches to `window`, see the classic-script comment above their old
// <script src> tags in index.html), then the inline app script that wires up
// the UI and reads those globals. Ported verbatim — see the source files.
//
// UMD helper audit (#424, TD-001 slice 6f, #704): none of the 33 are dead.
// onboarding-state.js, feedback-form-state.js, grade-own-state.js, and
// phase-doubling-state.js — the 4 helpers whose DOM wiring moved out of
// inline-app.js this slice — are now read by the new
// stores/onboardingStore.ts, stores/feedbackDialogStore.ts,
// stores/gradeOwnGuideStore.ts, and stores/phaseDoublingStore.ts (+ their
// dialog components) instead of by inline-app.js. phase-doubling-state.js
// was already a cross-component dependency via ReportCardIsland.tsx's
// getPhaseDoublingState().detectPhaseSignal() before this slice, so it was
// never a removal candidate regardless. skill-tree-state.js is the 33rd
// helper (#382) — read by stores/skillTreeStore.ts + SkillTreeDialog.tsx.
// No BOOT_SCRIPTS entry is removed and no app/renderer/*.js classic script
// is deleted.
const BOOT_SCRIPTS = [
  rigReconcileSrc,
  armStateSrc,
  channelLabelsSrc,
  instrumentProfilesSrc,
  rigKindSrc,
  groupStateSrc,
  trackWorkspaceSrc,
  playbackRoutingSrc,
  licenseStateSrc,
  upgradeMomentumSrc,
  onboardingStateSrc,
  whatsNewStateSrc,
  liveSetupStateSrc,
  liveTransitionStateSrc,
  idealCurvesSrc,
  gradingSrc,
  buildOrderStateSrc,
  passModeStateSrc,
  phaseDoublingStateSrc,
  preflightSrc,
  feedbackRingoutSrc,
  gradeOwnStateSrc,
  feedbackFormSrc,
  updateDownloadStateSrc,
  dawWorkspaceStateSrc,
  dawPlayheadStateSrc,
  dawWaveformStateSrc,
  liveAdjustmentsStateSrc,
  reportFirstUxStateSrc,
  singleColumnStateSrc,
  analyzeSourceStateSrc,
  batchAnalysisSrc,
  skillTreeStateSrc,
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
    // spectrumChrome's SPECTRUM_TITLE is the single source of truth for the
    // panel's title strings — inline-app.js still writes #spectrum-title
    // directly for the not-yet-migrated live/soundcheck meter modes (TD-001
    // slice 6a, #695).
    (window as Window & { spectrumChrome?: unknown }).spectrumChrome = spectrumChrome;
    (window as Window & { reportCard?: unknown }).reportCard = reportCard;
    // Share Image export (#265) + Export PNG's metadata-stripping guard
    // (#368) — both pure modules, bridged the same way as reportCard so
    // inline-app.js's classic-script glue can call them by name.
    (window as Window & { reportExport?: unknown }).reportExport = reportExport;
    (window as Window & { shareCard?: unknown }).shareCard = shareCard;
    (window as Window & { liveCapturePanel?: unknown }).liveCapturePanel = liveCapturePanel;
    // Secondary measurement-device source (#460) — pure state/view helpers,
    // bridged like liveCapturePanel so inline-app.js's classic-script glue can
    // call them by name.
    (window as Window & { measurementDeviceState?: unknown }).measurementDeviceState = measurementDeviceState;
    (window as Window & { crashHooks?: unknown }).crashHooks = crashHooks;
    // #776: bridges the single production "stop ceremony" (LiveControls.tsx's
    // stopCaptureIfRunning, built on the same runStopCeremony stopLiveCapture
    // uses) onto window so Playwright specs can drive a genuinely idle board
    // without re-implementing the setStopping/stopCapture/hook ordering
    // themselves — see e2e-helpers.ts's stopCaptureIfRunning and
    // rigs.spec.ts's afterEach cleanup, the two callers.
    (window as Window & { stopLiveCaptureIfRunning?: typeof stopLiveCaptureIfRunning }).stopLiveCaptureIfRunning =
      stopLiveCaptureIfRunning;
    // inline-app.js still needs applySpectrumForMode/applySingleColumnSync
    // for the 2 remaining call sites outside ModeTabs.tsx's click handler
    // (TD-001 slice 6e, #703).
    (window as Window & { modeSwitch?: unknown }).modeSwitch = modeSwitch;
    // inline-app.js still needs getReportCardSource/persistSummary for
    // saveMixAsTarget and the live-capture session persist call (TD-001
    // slice 6e, #703).
    (window as Window & { reportCardChrome?: unknown }).reportCardChrome = reportCardChrome;
    // Installed before the boot scripts run — inline-app.js reads
    // window.rendererStores at its top level (TD-001 slice 3, #421).
    installStoreBridge();
    for (const src of BOOT_SCRIPTS) {
      const script = document.createElement('script');
      script.textContent = src;
      document.body.appendChild(script);
    }
    // TD-001 slice 6j (#713): install the DAW shell's animation-rate runtime
    // onto window.dawShellRuntime — the same seam name/API capture-lifecycle's
    // dawShell() dep and live-workspace-view.ts's getDawShellRuntime()
    // consumers already read, now backed by daw-shell-runtime.ts instead of
    // inline-app.js's module vars. bindLiveEvents() registers the runtime's
    // own 'peaks' listener — inline-app.js's onLiveEvent no longer owns it.
    const dawShellRuntime = createDawShellRuntime({
      doc: document,
      now: Date.now,
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      subscribeLiveEvent: (cb) => getSoundBuddy().onLiveEvent(cb),
      getCaptureState: () => {
        const lc = useLiveCaptureStore.getState();
        return { isCapturing: lc.isCapturing, liveMode: lc.liveMode };
      },
      dawPlayheadState: (window as unknown as { dawPlayheadState: DawPlayheadStateApi }).dawPlayheadState,
      dawWaveformState: (window as unknown as { dawWaveformState: DawWaveformStateApi }).dawWaveformState,
    });
    (window as unknown as { dawShellRuntime?: DawShellRuntime }).dawShellRuntime = dawShellRuntime;
    dawShellRuntime.bindLiveEvents();
    // TD-001 slice 6i (#712): install the capture-lifecycle module's runtime
    // onto window.liveCaptureRuntime (the identical LiveCaptureRuntime bridge
    // LiveControls.tsx's startLiveCapture/stopLiveCapture/recordCapture and
    // mode-switch.ts's maybeAutoStartLive already call) and its onWindowTick
    // onto window.captureLifecycle (inline-app.js's onLiveEvent window-tick
    // branch) — replacing the deleted inline-app.js runtime assignment. The
    // accessor deps are lazy so they resolve the boot-injected classic scripts
    // only when a callback actually runs.
    const lifecycle = createCaptureLifecycle({
      getLc: () => useLiveCaptureStore.getState(),
      getAna: () => useAnalysisStore.getState(),
      getSpec: () => useSpectrumStore.getState(),
      getRig: () => useRigStore.getState(),
      sb: getSoundBuddy(),
      liveTransition: () => (window as unknown as { liveTransitionState: LiveTransitionState }).liveTransitionState,
      preflight: () => (window as unknown as { preflight: PreflightApi }).preflight,
      rigReconcile: () => (window as unknown as { rigReconcile: RigReconcileApi }).rigReconcile,
      armState: () => (window as unknown as { armState: ArmStateApi }).armState,
      liveSetupState: () => (window as unknown as { liveSetupState: LiveSetupStepsApi }).liveSetupState,
      storage: window.localStorage,
      liveCapturePanelApi: liveCapturePanel,
      reportCardChrome,
      dawShell: () => (window as unknown as { dawShellRuntime?: DawShellSeam }).dawShellRuntime ?? null,
      doc: document,
    });
    (window as unknown as { liveCaptureRuntime?: LiveCaptureRuntime }).liveCaptureRuntime = lifecycle.runtime;
    window.captureLifecycle = { onWindowTick: lifecycle.onWindowTick };
    // First-run onboarding (#69, TD-001 slice 6f, #704): fires once
    // BOOT_SCRIPTS have synchronously executed above, so window.onboardingState
    // (onboarding-state.js, one of the 32 helpers) is guaranteed defined —
    // same ordering guarantee the old `void initOnboarding()` tail call in
    // inline-app.js relied on.
    void useOnboardingStore.getState().init();
    // Skill-tree onboarding (#382): hydrates progress after BOOT_SCRIPTS so
    // window.skillTreeState exists — same ordering guarantee as onboarding.
    useSkillTreeStore.getState().init();
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
      {createPortal(<SettingsPanel booted={booted} />, document.getElementById('settings-island')!)}
      {createPortal(<CurveEditorDialog />, document.getElementById('curve-editor-island')!)}
      {/* FeedbackDialog/GradeOwnGuideDialog/PhaseDoublingDialog read
          window.feedbackForm/gradeOwnState/phaseDoublingState (BOOT_SCRIPTS
          helpers) during render, so — like OnboardingDialog — they can't
          render before `booted`: on the very first render those globals
          don't exist yet, throwing and taking down the whole tree (#704
          post-merge fix). Their portal targets are static index.html nodes
          (unlike onboarding-island), but that only covers the DOM-target
          half of the ordering requirement, not this one. */}
      {booted && createPortal(<FeedbackDialog />, document.getElementById('feedback-dialog-island')!)}
      {booted && createPortal(<GradeOwnGuideDialog />, document.getElementById('guide-dialog-island')!)}
      {booted && createPortal(<PhaseDoublingDialog />, document.getElementById('phase-doubling-dialog-island')!)}
      {booted && createPortal(<OnboardingDialog />, document.getElementById('onboarding-island')!)}
      {/* #382: the skill-tree dialog reads window.skillTreeState (a
          BOOT_SCRIPTS helper) during render, so it's booted-gated like the
          other classic-script-reading dialogs above. */}
      {booted && createPortal(<SkillTreeDialog />, document.getElementById('skill-tree-island')!)}
      {booted && createPortal(<ReportCardIsland />, document.getElementById('report-card')!)}
      {booted && createPortal(<SpectrumPanel />, document.getElementById('spectrum-island')!)}
      {booted && createPortal(<IdealProfileSelect />, document.getElementById('ideal-profile-island')!)}
      {booted && createPortal(<LiveWorkspace />, document.getElementById('live-island')!)}
      {/* #710: the docked EQ pane is its own island portaled onto the static
          #live-eq-pane-body root-markup node — it owns its own visibility/
          width/resize, so mode-switch.ts no longer writes the pane. */}
      {booted && createPortal(<LiveEqPane />, document.getElementById('live-eq-pane-body')!)}
      {/* #757: the Live tab's in-tab controls are gone — no portals to
          LiveControls / LiveTransportControls / PreflightPanel. The top-bar
          RecordButton portal below is the sole Live-capture surface. */}
      {booted && createPortal(<RecordButton />, document.getElementById('record-button-island')!)}
      {booted && createPortal(<SoundcheckPanel />, document.getElementById('soundcheck-island')!)}
      {booted && createPortal(<ModeTabs />, document.getElementById('mode-tabs')!)}
      {booted && createPortal(<ReportCardToolbar />, document.getElementById('rc-toolbar')!)}
      {booted && createPortal(<UpgradeMomentum />, document.getElementById('rc-upgrade-island')!)}
      {booted && createPortal(<RecentServicesPanel />, document.getElementById('tab-recent')!)}
      {booted && createPortal(<BuildGuidePanel />, document.getElementById('tab-guide')!)}
      {booted && createPortal(<RingoutPanel />, document.getElementById('tab-ringout')!)}
      {/* TD-001 slice 6h (#711): the Directory tab's batch panel, portaled
          onto the now-empty #tab-dir node. */}
      {booted && createPortal(<DirectoryPanel />, document.getElementById('tab-dir')!)}
      {/* TD-001 slice 6h (#711): the Live tab's arm hint + header measurement
          badge, portaled onto their root-markup islands. */}
      {booted && createPortal(<LiveArmHint />, document.getElementById('arm-hint-island')!)}
      {booted && createPortal(<MeasurementBadge />, document.getElementById('measurement-badge-island')!)}
      {/* TD-001 slice 6i (#712): the post-stop session chrome + shared status
          line, rendered from liveCaptureStore (sessionOffers/liveCueVisible/
          liveStatusText) by these islands; the header #window-badge span inside
          the static #live-indicator pill derives from liveWindows. RigDialog
          replaces inline-app.js's rigDialog() modal with the same promise API. */}
      {booted && createPortal(<LiveStatusLine />, document.getElementById('live-status-island')!)}
      {booted && createPortal(<LiveSessionOffers />, document.getElementById('live-session-offers-island')!)}
      {/* #989: the Console panel moved to its own workspace, away from Live. */}
      {booted && createPortal(<ConsolePanel />, document.getElementById('tab-console')!)}
      {booted && createPortal(<WindowBadge />, document.getElementById('window-badge-island')!)}
      {booted && createPortal(<RigDialog />, document.getElementById('rig-dialog-island')!)}
      {booted && <LicenseChrome />}
      {booted && <ConsoleNetworkConsentDialog />}
      {booted && <AnalyzeSourcePicker />}
      {booted && createPortal(<UpdateBanner />, document.getElementById('update-surface-island')!)}
      {booted && createPortal(<WhatsNewBanner />, document.getElementById('whats-new-banner-island')!)}
    </>
  );
}
