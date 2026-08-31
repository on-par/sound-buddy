// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The live-capture workspace board island (TD-001 slice 6g, #710) — replaces
// the never-mounted props component this file used to be (its props API is
// gone; LiveCapturePanel.test.ts was rewritten to pin the board markup).
// LiveCapturePanel subscribes to liveCaptureStore's DISCRETE board-shape
// fields and rebuilds #live-island's markup via dangerouslySetInnerHTML from
// the pure live-workspace-view builders, reading lastTick/lastLiveChannels
// imperatively at render time (never via subscription — ADR-0005). Per-tick
// meter values (levels, names, clip flags, group summaries, EQ-pane arcs,
// stats row) are patched straight to the DOM by LiveWorkspace.tsx's mounted
// createLiveMeterController, exactly like the pre-6g bridged renderer.
// React only re-assigns the dangerouslySetInnerHTML strings when they change,
// so the imperative per-tick patches persist between re-renders.
//
// The 6g interaction branches (strip select, keyboard strip select, group
// fold, setup-skip dismiss, lap dispositions, lap-focus-select, inline rename)
// are delegated handlers on this wrapper div — the content is
// dangerouslySetInnerHTML, so React-owned handlers must ride an ancestor. The
// 6h branches (TD-001 slice 6h, #711) live here too now: the capture controls
// + channel-group CRUD (add/remove/arm/arm-all/kind/src/group/profile/drag-
// reorder) moved off inline-app.js's #spectrum-body listeners, so the only
// remaining inline-app.js listeners for this surface are the 6i lifecycle
// callbacks. Group CRUD prompts reuse the shared imperative rigDialog (same
// modal RigControls uses); drag-reorder state is a useRef (dragover/drop fire
// on whatever element is under the pointer, not the drag source).

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, MAX_LABEL_LEN, type LapAction } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { useRouteStore, type RouteState, type RouteStoreState } from './stores/routeStore';
import type { SoundcheckState } from './stores/soundcheckStore';
import {
  applyRoutingDrawerChange,
  applyRoutingDrawerMasterMixdownChange,
  routeStateForSession,
  routingDrawerHTML,
} from './routingDrawer';
import { deviceChannelCount } from './live-capture-panel';
import {
  liveAdjustmentsPanelHTML,
  dawShellHTML,
  dawShellPatchView,
  getDawShellRuntime,
  getGroupState,
  liveWorkspaceViewState,
  SESSION_TIMELINE_SCALE,
  MS_PER_SECOND,
} from './live-workspace-view';
import { sessionTabSessionPickerAction, sessionTabSessionPickerView } from './session-tab-session-picker';
import { paintSessionTabWaveformClips, sessionTabWaveformView, sessionTakeDurationSecs } from './session-tab-waveforms';
import { patchTimelineOverview, timelineOverviewDurationSecs, type TimelineOverviewShellLike } from './timeline-overview';
import { sessionTabPlaybackView } from './session-tab-playback';
import { createTimelineTempo, type TimelineTempo } from './timeline-bpm';
import { commitTimelineBpmEntry, timelineBpmControlView, TIMELINE_BPM_INPUT_ID } from './timeline-bpm-control';
import {
  applyTimelineZoom,
  createTimelineZoomModel,
  timelineZoomActionForId,
  timelineZoomControlsView,
  type TimelineZoomContext,
  type TimelineZoomModel,
} from './timeline-zoom-controls';
import { sessionTimelineMarks } from './timeline-state';
import {
  applyTimelineFollowEvent,
  createTimelineFollowModel,
  timelineFollowEventForWheel,
  timelineFollowView,
  TIMELINE_FOLLOW_BUTTON_ID,
  TIMELINE_FOLLOW_SURFACE_SELECTOR,
  type TimelineFollowModel,
} from './timeline-follow-scroll';
import {
  applyTimelineScroll,
  patchTimelineScrollOffset,
  timelineScrollOffsetPx,
} from './timeline-scroll-gesture';
import { applyTimelineZoomGesture } from './timeline-zoom-gesture';
import { beginSessionTimelineScrub } from './session-timeline-scrub';
import { applyLaneBackgroundClick, LANE_TAKE_CLIP_SELECTOR } from './lane-background-click';
import { applyClipClick } from './clip-click';
import { sessionClipSelection } from './clip-selection';
import { sessionTimeSelection } from './time-selection';
import { beginTimeSelectionDrag } from './time-selection-drag';
import { beginLoopBodyDrag, LOOP_BRACE_BODY_SELECTOR } from './loopBrace.bodyDrag';
import { beginLoopEdgeDrag, LOOP_HANDLE_END_SELECTOR, LOOP_HANDLE_START_SELECTOR, type LoopEdge } from './loopBrace.edgeDrag';
import { sessionLoopRegion } from './loopBrace.render';
import { seedLoopRegionOnToggle } from './loopToggle';
import { LOOP_FROM_SELECTION_BUTTON_ID, promoteSelectionToLoop } from './loopFromSelection';
import {
  SESSION_SCRUB_SURFACE_SELECTOR,
  canBeginSessionScrub,
  sessionManifestDurationSecs,
  sessionScrubDurationSecs,
  sessionScrubSurfaceKind,
  type SessionScrubGate,
} from './session-ruler-scrub';
import { createSoundcheckTransportController } from './soundcheck-transport-controller';
import { runtime, recordCapture, stopLiveCapture } from './LiveControls';
import { recordButtonAction } from './record-transport';

// Per-element "original text" snapshot for the delegated inline rename (#39),
// keyed by the DAW track-name element being edited. Survives the element being
// replaced between edits (a re-render destroys the node, so the WeakMap entry
// for it is garbage-collected and a fresh snapshot is taken on focus).
const nameOriginals = new WeakMap<Element, string>();

export interface HeaderChannelActions {
  isCapturing: boolean;
  liveMode: 'monitor' | 'record';
  toggleArm(channelId: number): void;
  hideArmHint(): void;
  removeStrip(channelId: number): void;
  toggleChannelMute(channelId: number): void;
  toggleChannelSolo(channelId: number): void;
}

/** Routes an already-resolved DAW header action without coupling its channel
 * identifier contract to delegated DOM traversal. */
export function routeHeaderChannelAction(
  action: 'arm' | 'mute' | 'solo' | 'remove',
  channelId: number,
  actions: HeaderChannelActions,
): void {
  if (action === 'arm') {
    if (actions.isCapturing && actions.liveMode === 'record') return;
    actions.toggleArm(channelId);
    actions.hideArmHint();
  } else if (action === 'mute') {
    actions.toggleChannelMute(channelId);
  } else if (action === 'solo') {
    actions.toggleChannelSolo(channelId);
  } else {
    actions.removeStrip(channelId);
  }
}

/* c8 ignore start -- DOM-shape helpers for the delegated interaction handlers
   below; no jsdom in this harness (they need real Element/closest/dataset),
   so they ride the handlers' e2e gates — tests/e2e/live-capture.spec.ts's
   inline-rename case exercises nameElOf/stripIndexIn. */
// The DAW track-name element a focused/blurred target belongs to, or null.
function nameElOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const name = target.closest('.daw-track-head-name');
  return name && name.contains(target) ? name : null;
}

function stripIndexIn(nameEl: Element): number {
  const strip = nameEl.closest('.daw-track-head');
  return parseInt((strip as HTMLElement | null)?.dataset.ch ?? '', 10);
}
/* c8 ignore stop */

// Normalize a shared-dialog group-name result (#190) — trim, reject empty
// (cancel/confirm-mode resolve to non-strings or blanks), cap at
// MAX_LABEL_LEN. Ported from inline-app.js's createChannelGroup/
// renameChannelGroup (TD-001 slice 6h, #711); pure so it's unit-testable.
export function normalizeGroupName(raw: string | boolean | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LABEL_LEN);
}

/** Seeds (or retrieves) a session's persisted routes and applies its master
 * setting to playback. The playback store is session-agnostic, so this must
 * run whenever the active session changes. */
export function ensureSessionRouting(
  sessionId: string,
  initial: RouteState,
  routes: Pick<RouteStoreState, 'ensureSession'>,
  soundcheck: Pick<SoundcheckState, 'setMaster'>,
): RouteState {
  const current = routes.ensureSession(sessionId, initial);
  soundcheck.setMaster(current.masterMixdown);
  return current;
}

export default function LiveCapturePanel(): JSX.Element | null {
  const [sessionRoutingDrawerOpen, setSessionRoutingDrawerOpen] = useState(false);
  // Session tempo (#1276). Transient render state, like the routing drawer flag
  // above — persistence across restarts is not in this slice's scope.
  const [timelineTempo, setTimelineTempo] = useState<TimelineTempo>(createTimelineTempo);
  const [bpmMessage, setBpmMessage] = useState('');
  // The Session zoom/fit model (#1284). Local state, not the store: it is view
  // navigation, not capture or session data. It self-heals against a changing
  // duration - applyTimelineZoom normalizes the stored range every call.
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoomModel>(() => createTimelineZoomModel(0));
  // Follow-scroll state (#1286). Local view state like timelineZoom above - it is
  // navigation, not capture or session data, and is not persisted.
  const [timelineFollow, setTimelineFollow] = useState<TimelineFollowModel>(createTimelineFollowModel);
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    channelConfig: st.channelConfig,
    channelGroups: st.channelGroups,
    devices: st.devices,
    selectedDevice: st.selectedDevice,
    isCapturing: st.isCapturing,
    promoting: st.promoting,
    stopping: st.stopping,
    demoting: st.demoting,
    liveMode: st.liveMode,
    appMode: st.appMode,
    selectedChannel: st.selectedChannel,
    measurementSource: st.measurementSource,
    focusedInputIndex: st.focusedInputIndex,
    mutedChannels: st.mutedChannels,
    soloedChannels: st.soloedChannels,
    lapCoaching: st.lapCoaching,
    boardShapeVersion: st.boardShapeVersion,
    liveWindows: st.liveWindows,
  }));
  const settings = useStoreShallow(useSettingsStore, (st) => st.settings);
  // Only discrete Session selection/cache fields are subscribed here. Live
  // waveform frames remain outside this render path (ADR-0005).
  const soundcheck = useStoreShallow(useSoundcheckStore, (st) => ({
    recordedSessions: st.recordedSessions,
    recordedSessionsLoaded: st.recordedSessionsLoaded,
    sessionDir: st.sessionDir,
    manifest: st.manifest,
    playing: st.playing,
    looping: st.looping,
    statusMessage: st.statusMessage,
    peaks: st.peaks,
    peaksStatus: st.peaksStatus,
    routes: st.routes,
    devices: st.devices,
    devicesLoaded: st.devicesLoaded,
    selectedDevice: st.selectedDevice,
    deviceChannels: st.deviceChannels,
    master: st.master,
  }));
  const routesBySession = useStoreShallow(useRouteStore, (st) => st.routesBySession);

  // lastTick/lastLiveChannels are animation-rate values — read imperatively at
  // render time, never via subscription. boardShapeVersion (also subscribed
  // above) is what re-renders the board when a tick's channel count changes.
  const savedBuses = settings?.soundcheckBuses;
  const routeState = soundcheck.sessionDir ? routesBySession[soundcheck.sessionDir] ?? null : null;
  const sessionPicker = sessionTabSessionPickerView(soundcheck.recordedSessions, soundcheck.sessionDir, soundcheck.manifest, soundcheck.statusMessage);
  const sessionWaveforms = sessionTabWaveformView(soundcheck.manifest, soundcheck.peaks, soundcheck.peaksStatus, s.channelConfig);
  const sessionPlayback = sessionTabPlaybackView(soundcheck.manifest, soundcheck.playing, soundcheck.looping);
  // The Session zoom/fit context (#1284). Reuses the two values patchOverview
  // already reads so fit-full and the overview strip agree by construction.
  const elapsedSecs = (getDawShellRuntime()?.playheadElapsedMs?.() ?? 0) / MS_PER_SECOND;
  const takeSecs = sessionTakeDurationSecs(sessionWaveforms);
  const zoomContext: TimelineZoomContext = {
    durationSecs: timelineOverviewDurationSecs(takeSecs, elapsedSecs),
    playheadSecs: elapsedSecs,
    // No time-selection surface exists yet (#1283/#1285), so the loaded take's
    // span is the selection; with no take, applyTimelineZoom falls back to an
    // insert-marker window at the real insert marker (#1301), not the playhead.
    selection: takeSecs > 0 ? { startSecs: 0, endSecs: takeSecs } : null,
    insertMarkerSecs: sessionTimelineMarks.getInsertMarkerSecs(),
  };
  const timelineZoomView = timelineZoomControlsView(timelineZoom, zoomContext);
  const lc = useLiveCaptureStore.getState();
  const capturePhase = window.liveTransitionState.capturePhase({
    liveRunning: s.isCapturing,
    liveMode: s.liveMode,
    promoting: s.promoting,
    stopping: s.stopping,
  });
  const timelineBpm = timelineBpmControlView(timelineTempo, bpmMessage);
  const state = liveWorkspaceViewState(
    lc,
    settings,
    getDawShellRuntime()?.playheadElapsedMs?.() ?? 0,
    sessionPicker,
    sessionWaveforms,
    sessionPlayback,
    capturePhase,
    sessionRoutingDrawerOpen,
    timelineBpm,
    timelineZoomView,
    timelineFollowView(timelineFollow),
  );
  const laneSignature = dawShellPatchView(state).laneSignature;

  // Drag-reorder source (#483): { type:'group'|'strip', index } set on
  // dragstart, cleared on drop/dragend. A ref (not state) because dragover/
  // drop fire on whatever element is under the pointer, not the element that
  // started the drag — no re-render is wanted mid-drag either.
  const liveDragSrc = useRef<{ type: 'group' | 'strip'; index: number } | null>(null);

  // Board root ref + native 'change' listener (TD-001 slice 6h, #711 fix):
  // React's onChange prop never fires for a native change event bubbling from
  // a <select> that isn't part of React's own tree — the board's kind/src/
  // group/profile/lap-focus selects are all raw markup from
  // dangerouslySetInnerHTML, so React's ChangeEventPlugin (which needs a
  // value-tracker it only installs on elements it created) silently drops
  // them. onClick/onKeyDown/onDrag* aren't affected — they don't need that
  // per-element tracking — so only 'change' needs this native listener.
  const boardRootRef = useRef<HTMLDivElement>(null);
  const onBoardChangeRef = useRef<(e: ChangeEvent<HTMLDivElement>) => void>(() => {});

  /* c8 ignore start -- effect wiring + imperative chrome, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts (stats row shows while capturing, spectrum
     panel stays in meters mode), live-capture-workspace.spec.ts, and (the
     rAF playhead-ticker hook below) daw-shell.spec.ts. */

  // The overview strip's visible-range box + total readout (#1282). Patched
  // imperatively from the measured shell, exactly like the playhead
  // (ADR-0005): the box depends on clientWidth and on the still-growing
  // recording time, neither of which belongs in store state.
  const patchOverview = (shell: TimelineOverviewShellLike | null): void => {
    patchTimelineOverview(shell, {
      loadedDurationSecs: sessionTakeDurationSecs(sessionWaveforms),
      recordedElapsedSecs: (getDawShellRuntime()?.playheadElapsedMs?.() ?? 0) / MS_PER_SECOND,
      pxPerSecond: SESSION_TIMELINE_SCALE.pxPerSecond,
    });
  };

  useEffect(() => {
    if (s.appMode !== 'live') return;
    const statsRow = document.getElementById('stats-row');
    if (statsRow) statsRow.style.display = 'none';
    const ipWrap = document.getElementById('ideal-profile-wrap');
    if (ipWrap) ipWrap.style.display = 'none';
    useSpectrumStore.getState().setPanelState('meters'); // hide #spectrum-island's React curve view while the board renders
  }, [s.appMode, s.isCapturing, s.demoting]);

  useEffect(() => {
    if (s.appMode !== 'live') return;
    if (soundcheck.recordedSessionsLoaded) return;
    void useSoundcheckStore.getState().loadRecordedSessions();
  }, [s.appMode, soundcheck.recordedSessionsLoaded]);

  useEffect(() => {
    if (s.appMode !== 'live') return;
    if (soundcheck.devicesLoaded) return;
    void useSoundcheckStore.getState().loadDevices();
  }, [s.appMode, soundcheck.devicesLoaded]);

  // The insert marker's default position (#1301): loading (or switching) a session parks
  // the insert point at the top of the arrangement. Imperative, not store state — the
  // marker rides the shared marks model, never React state (ADR-0005). Loading or
  // switching a session also clears the clip selection (#1303) and the time selection
  // (#1304), and resets the loop region (#1313) to its default range, for the same reason.
  useEffect(() => {
    if (s.appMode !== 'live') return;
    sessionTimelineMarks.resetForSession();
    sessionClipSelection.clearSelection();
    sessionTimeSelection.clearSelection();
    sessionLoopRegion.resetForSession();
    getDawShellRuntime()?.renderInsertMarker?.();
    getDawShellRuntime()?.renderClipSelection?.();
    getDawShellRuntime()?.renderTimeSelection?.();
    getDawShellRuntime()?.renderLoopBrace?.();
  }, [s.appMode, soundcheck.sessionDir]);

  useEffect(() => {
    if (s.appMode !== 'live') return;
    if (!soundcheck.sessionDir || !soundcheck.manifest) return;
    ensureSessionRouting(
      soundcheck.sessionDir,
      routeStateForSession(s.channelConfig, soundcheck.routes, savedBuses ?? []),
      useRouteStore.getState(),
      useSoundcheckStore.getState(),
    );
  }, [s.appMode, soundcheck.sessionDir, soundcheck.manifest, s.channelConfig, soundcheck.routes, savedBuses]);

  useEffect(() => {
    if (s.appMode !== 'live') return;
    const controller = createSoundcheckTransportController({
      subscribe: useSoundcheckStore.subscribe,
      getState: () => ({ lastElapsedTick: useSoundcheckStore.getState().lastElapsedTick }),
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patchElapsed: (tick) => {
        const runtime = getDawShellRuntime();
        runtime?.setPlaybackPosition?.(tick);
      },
      patchPlayhead: () => getDawShellRuntime()?.renderPlayhead?.(),
    });
    controller.start();
    return () => controller.stop();
  }, [s.appMode]);

  useEffect(() => {
    if (s.appMode !== 'live') return;
    const runtime = getDawShellRuntime();
    const playbackPosition = useSoundcheckStore.getState().lastElapsedTick;
    if (soundcheck.manifest && playbackPosition) runtime?.setPlaybackPosition?.(playbackPosition);
    else runtime?.setPlaybackPosition?.(null);
    runtime?.setPlaybackActive?.(soundcheck.playing);
    runtime?.renderPlayhead?.();
  }, [s.appMode, soundcheck.manifest, soundcheck.playing]);

  // DAW shell (#517/#518/#520): stamp the lane fingerprint (the React
  // rebuild-decision key for same-count rig swaps) and hand the
  // daw-shell-runtime.ts painters (TD-001 slice 6j, #713) the shell to paint
  // after every rebuild — the meter controller re-paints them per tick
  // thereafter.
  useEffect(() => {
    if (s.appMode !== 'live') return;
    const shell = document.getElementById('live-island')?.querySelector('.daw-shell');
    if (shell) shell.setAttribute('data-lane-signature', laneSignature);
    getDawShellRuntime()?.renderPlayhead?.();
    getDawShellRuntime()?.renderInsertMarker?.();
    getDawShellRuntime()?.renderClipSelection?.();
    getDawShellRuntime()?.renderTimeSelection?.();
    getDawShellRuntime()?.renderLoopBrace?.();
    getDawShellRuntime()?.renderWaveform?.();
    if (shell && sessionWaveforms) paintSessionTabWaveformClips(shell, sessionWaveforms.clips);
    patchOverview(shell ?? null);
  }, [s.appMode, laneSignature, sessionWaveforms]);

  // The visible range's horizontal pan (#1292): one custom property, read by
  // app.css's shared re-basing translate, so the ruler, labels, gridlines,
  // clips and both playhead segments pan together (see this story's ADR).
  // No dep array: the shell's markup — and with it the element's inline style —
  // is rebuilt on every render.
  useEffect(() => {
    if (s.appMode !== 'live') return;
    const shell = document.getElementById('live-island')?.querySelector<HTMLElement>('.daw-shell') ?? null;
    patchTimelineScrollOffset(shell, timelineScrollOffsetPx(timelineZoom.range, SESSION_TIMELINE_SCALE.pxPerSecond));
    // The shell's markup — and with it the brace's inline left/width (#1313) — is
    // rebuilt on every render, so the brace is repainted on every render for the
    // same reason the scroll offset is.
    getDawShellRuntime()?.renderLoopBrace?.();
  });

  // The playhead ticker (TD-001 slice 6j, #713): a requestAnimationFrame loop
  // driving renderPlayhead every frame while the shell is mounted and
  // capturing — replaces the old 100ms setInterval owned by inline-app.js.
  // Active during "Connecting…" and whenever meter events stall, exactly like
  // the old interval (but at frame rate), so the playhead never freezes early.
  useEffect(() => {
    if (s.appMode !== 'live') return;
    if (!s.isCapturing) return;
    let rafHandle = 0;
    const tick = (): void => {
      getDawShellRuntime()?.renderPlayhead?.();
      patchOverview(document.getElementById('live-island')?.querySelector('.daw-shell') ?? null);
      rafHandle = requestAnimationFrame(tick);
    };
    rafHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafHandle);
    // sessionWaveforms is a dep (not just appMode/isCapturing) so tick's
    // patchOverview closure never goes stale: loading a different recorded
    // session while capturing must not freeze the overview's loaded-duration
    // reading at whatever it was when this effect last (re)started.
  }, [s.appMode, s.isCapturing, sessionWaveforms]);

  // Native 'change' listener (see boardRootRef's comment above) — must stay
  // above the `appMode !== 'live'` early return below (Rules of Hooks: no
  // conditional hook calls), so it guards internally instead. Depends on
  // s.appMode so it re-binds whenever the board div mounts/unmounts (the
  // whole returned tree flips between this div and `null`, so boardRootRef's
  // node is a fresh element each time appMode re-enters 'live'). Reads the
  // always-current onBoardChange via the ref so it never goes stale.
  useEffect(() => {
    if (s.appMode !== 'live') return;
    const el = boardRootRef.current;
    if (!el) return;
    const listener = (e: Event) => onBoardChangeRef.current(e as unknown as ChangeEvent<HTMLDivElement>);
    el.addEventListener('change', listener);
    return () => el.removeEventListener('change', listener);
  }, [s.appMode]);
  /* c8 ignore stop */

  if (s.appMode !== 'live') return null;

  const adjustmentsHtml = liveAdjustmentsPanelHTML(state);
  const routingDrawerContent = soundcheck.sessionDir && soundcheck.manifest && routeState
    ? routingDrawerHTML(
      s.channelConfig,
      routeState,
      deviceChannelCount(s.selectedDevice, s.devices),
      soundcheck.deviceChannels,
      soundcheck.devices,
      soundcheck.selectedDevice,
    )
    : '';
  const board = routingDrawerContent ? dawShellHTML(state, routingDrawerContent) : dawShellHTML(state);
  const body = board + adjustmentsHtml;

  /* c8 ignore start -- delegated interaction handlers, no jsdom in this
     harness (renderToString doesn't dispatch events) — exercised by
     tests/e2e/live-capture.spec.ts (strip select + inline rename),
     named-channel-groups.spec.ts (group fold), and the live-adjustments
     coaching/disposition paths. */
  function onBoardClick(e: MouseEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    const routingOutput = target.closest('.daw-routing-output-cell');
    if (routingOutput) {
      applyRoutingChange('output', routingOutput);
      return;
    }
    if (target.closest('#daw-session-routing-toggle')) {
      setSessionRoutingDrawerOpen((open) => !open);
      return;
    }
    if (target.closest('#daw-session-record')) {
      const action = recordButtonAction(capturePhase);
      if (action === 'record') void recordCapture(runtime());
      else if (action === 'stop') void stopLiveCapture(runtime());
      return;
    }
    if (target.closest('#daw-session-play')) {
      setTimelineFollow((m) => applyTimelineFollowEvent(m, 'play'));
      void useSoundcheckStore.getState().play();
      return;
    }
    if (target.closest('#daw-session-stop')) { void useSoundcheckStore.getState().stop(); return; }
    if (target.closest('#daw-session-loop')) {
      const sc = useSoundcheckStore.getState();
      // #1314: seed the default range on the first switch-on for this session, before the
      // store flips, so the brace always appears somewhere sensible. A range already set is
      // left alone — that is what makes toggling Loop off and on lossless.
      seedLoopRegionOnToggle(sessionLoopRegion, { available: sc.manifest !== null, looping: sc.looping }, takeSecs);
      sc.toggleLoop();
      return;
    }
    // #1317: promote the current time selection to the loop range. A press with no
    // selection is a deliberate no-op (promoteSelectionToLoop returns null and writes
    // nothing). Loop is switched on only when it was off, so the promoted brace is
    // visible without a second press and an already-looping session is not toggled off.
    if (target.closest(`#${LOOP_FROM_SELECTION_BUTTON_ID}`)) {
      const sc = useSoundcheckStore.getState();
      const promoted = promoteSelectionToLoop(
        sessionLoopRegion,
        sessionTimeSelection.getSelection(),
        { available: sc.manifest !== null, looping: sc.looping },
      );
      if (promoted) {
        if (promoted.enableLooping) sc.toggleLoop();
        getDawShellRuntime()?.renderLoopBrace?.();
      }
      return;
    }
    if (target.closest('#daw-session-return')) {
      setTimelineFollow((m) => applyTimelineFollowEvent(m, 'seek'));
      void useSoundcheckStore.getState().returnToStart();
      return;
    }
    // Follow-scroll toggle (#1286): flips the pause/resume state directly. Placed
    // before the .daw-zoom-btn branch as insurance — it intentionally does NOT
    // carry the daw-zoom-btn class, so that branch cannot swallow it either way.
    if (target.closest(`#${TIMELINE_FOLLOW_BUTTON_ID}`)) {
      setTimelineFollow((m) => applyTimelineFollowEvent(m, 'toggle'));
      return;
    }
    // Session zoom/fit controls (#1284): id -> action -> the pure reducer.
    // zoomContext is captured from the current render, which is correct here
    // for the same reason the BPM branch captures timelineTempo: the handler
    // is re-created every render — EXCEPT insertMarkerSecs, which #1302 lets
    // move on a lane press without a render, so it is re-read live here.
    const zoomBtn = target.closest('.daw-zoom-btn');
    if (zoomBtn) {
      const action = timelineZoomActionForId(zoomBtn.id);
      if (action) {
        setTimelineZoom((model) => applyTimelineZoom(model, action, {
          ...zoomContext,
          insertMarkerSecs: sessionTimelineMarks.getInsertMarkerSecs(),
        }));
        setTimelineFollow((m) => applyTimelineFollowEvent(m, 'navigate'));
      }
      return;
    }
    // Live coaching dispositions (#613/#614) — engineer control over the card.
    const lapActionBtn = target.closest('[data-lap-action]');
    if (lapActionBtn) {
      const action = lapActionBtn.getAttribute('data-lap-action') as LapAction;
      useLiveCaptureStore.getState().lapDispose(action);
      return;
    }
    // Group header fold (#483): collapse the whole group to its summary row.
    const gfold = target.closest('.live-group-fold');
    if (gfold) {
      const g = parseInt(gfold.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10);
      if (Number.isInteger(g)) useLiveCaptureStore.getState().toggleGroupCollapse(g);
      return;
    }
    // ── 6h capture controls / channel-group CRUD (moved from inline-app.js's
    // #spectrum-body click listener, TD-001 slice 6h #711) ────────────────────
    // Workspace Add track (#188) + + New group (#190).
    if (target.closest('#live-ws-add')) { useLiveCaptureStore.getState().addStrip(); return; }
    if (target.closest('#live-ws-new-group')) { void createChannelGroup(); return; }
    const headerAction = target.closest('.daw-track-head-arm, .daw-track-head-mute, .daw-track-head-solo, .daw-track-head-remove');
    if (headerAction) {
      const rawChannelId = headerAction.closest('.daw-track-head')?.getAttribute('data-ch');
      const channelId = rawChannelId && rawChannelId.trim() !== '' ? Number(rawChannelId) : Number.NaN;
      if (!Number.isInteger(channelId)) return;
      const action = headerAction.classList.contains('daw-track-head-arm') ? 'arm'
        : headerAction.classList.contains('daw-track-head-mute') ? 'mute'
          : headerAction.classList.contains('daw-track-head-solo') ? 'solo' : 'remove';
      routeHeaderChannelAction(action, channelId, useLiveCaptureStore.getState());
      return;
    }
    // Workspace Arm all / Disarm all (#191).
    if (target.closest('#live-ws-arm-all')) {
      useLiveCaptureStore.getState().setAllArmed(true);
      useLiveCaptureStore.getState().hideArmHint();
      return;
    }
    if (target.closest('#live-ws-disarm-all')) {
      useLiveCaptureStore.getState().setAllArmed(false);
      return;
    }
    // Group header rename / delete (#190): reuse the shared group dialog.
    const gRename = target.closest('.live-group-rename');
    if (gRename) { void renameChannelGroup(parseInt(gRename.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10)); return; }
    const gDel = target.closest('.live-group-del');
    if (gDel) { void deleteChannelGroup(parseInt(gDel.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10)); return; }
    // Strip selection (#668): clicking anywhere on a strip (but not buttons,
    // text edits, or text inputs) inspects it in the docked EQ pane. Header
    // selects can sit near the row's geometric center in the compact DAW head,
    // so selecting through them preserves whole-row click behavior.
    const stripEl = target.closest('.daw-track-head');
    if (stripEl && !target.closest('button, [contenteditable], input')) {
      const idx = parseInt((stripEl as HTMLElement).dataset.ch ?? '', 10);
      if (Number.isInteger(idx)) useLiveCaptureStore.getState().setSelectedChannel(idx);
    }
  }

  function onBoardPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (!(e.target instanceof Element)) return;
    // The loop brace edge resize (#1316): a press on either handle moves ONLY that edge.
    // It must precede the body-drag branch — the handles are children of .daw-loop-brace,
    // so closest(LOOP_BRACE_BODY_SELECTOR) matches a handle press too. Previews imperatively
    // and commits once on release, like the body drag (ADR-0121).
    const loopHandleEl = e.target.closest(`${LOOP_HANDLE_START_SELECTOR}, ${LOOP_HANDLE_END_SELECTOR}`);
    if (loopHandleEl) {
      const edge: LoopEdge = loopHandleEl.matches(LOOP_HANDLE_END_SELECTOR) ? 'end' : 'start';
      beginLoopEdgeDrag(
        {
          button: e.button,
          clientX: e.clientX,
          pxPerSecond: SESSION_TIMELINE_SCALE.pxPerSecond,
          maxSecs: sessionScrubDurationSecs({
            tickDurationSecs: useSoundcheckStore.getState().lastElapsedTick?.duration,
            takeDurationSecs: takeSecs,
            manifestDurationSecs: sessionManifestDurationSecs(useSoundcheckStore.getState().manifest),
          }),
          edge,
        },
        {
          windowTarget: window,
          pointerId: e.pointerId,
          region: sessionLoopRegion.getRegion(),
          previewRegion: (region) => { getDawShellRuntime()?.previewLoopBrace?.(region); },
          commitRegion: (region) => {
            sessionLoopRegion.setRegion(region.startSecs, region.endSecs);
            getDawShellRuntime()?.renderLoopBrace?.();
          },
        },
      );
      return;
    }
    // The loop brace body drag (#1315): a press on the brace moves the loop range and
    // nothing else — it returns before the scrub and the time-selection drag, so a drag
    // that starts on the brace can never seek or draw a selection. The brace lives inside
    // .daw-ruler, so this branch MUST come first: closest(SESSION_SCRUB_SURFACE_SELECTOR)
    // would otherwise resolve a brace press to the ruler. The in-flight range is painted
    // imperatively and committed once on release (this story's ADR).
    if (e.target.closest(LOOP_BRACE_BODY_SELECTOR)) {
      beginLoopBodyDrag(
        {
          button: e.button,
          clientX: e.clientX,
          pxPerSecond: SESSION_TIMELINE_SCALE.pxPerSecond,
          maxSecs: sessionScrubDurationSecs({
            tickDurationSecs: useSoundcheckStore.getState().lastElapsedTick?.duration,
            takeDurationSecs: takeSecs,
            manifestDurationSecs: sessionManifestDurationSecs(useSoundcheckStore.getState().manifest),
          }),
        },
        {
          windowTarget: window,
          pointerId: e.pointerId,
          region: sessionLoopRegion.getRegion(),
          previewRegion: (region) => { getDawShellRuntime()?.previewLoopBrace?.(region); },
          commitRegion: (region) => {
            sessionLoopRegion.setRegion(region.startSecs, region.endSecs);
            getDawShellRuntime()?.renderLoopBrace?.();
          },
        },
      );
      return;
    }
    const surfaceEl = e.target.closest(SESSION_SCRUB_SURFACE_SELECTOR);
    if (!surfaceEl) return;
    const kind = sessionScrubSurfaceKind(surfaceEl);
    const gate = (): SessionScrubGate => {
      const sc = useSoundcheckStore.getState();
      const lcState = useLiveCaptureStore.getState();
      return {
        playing: sc.playing,
        hasSession: sc.manifest !== null,
        recording: lcState.isCapturing && lcState.liveMode === 'record',
      };
    };
    // One press geometry for every route (#1302/#1303/#1304): the pressed surface's own
    // left edge is the arrangement's shared t=0 edge, whether that surface is the ruler
    // or a lane.
    const pressGeometry = {
      button: e.button,
      clientX: e.clientX,
      laneLeftPx: surfaceEl.getBoundingClientRect().left,
      scrollOffsetPx: timelineScrollOffsetPx(timelineZoom.range, SESSION_TIMELINE_SCALE.pxPerSecond),
      pxPerSecond: SESSION_TIMELINE_SCALE.pxPerSecond,
    };
    if (kind === 'lane') {
      const geometry = {
        ...pressGeometry,
        clipRects: Array.from(surfaceEl.querySelectorAll(LANE_TAKE_CLIP_SELECTOR), (clip) => clip.getBoundingClientRect()),
      };
      // Clip press (#1303): selects the clip, leaves the insert marker alone by construction, and
      // seeks only with the Option/Alt override held. A clip press is fully handled here — it
      // reaches neither the background route nor the scrub.
      const clipDecision = applyClipClick(
        {
          ...geometry,
          channelIndex: Number.parseInt(surfaceEl.getAttribute('data-ch') ?? '', 10),
          overrideHeld: e.altKey,
          canSeek: canBeginSessionScrub('ruler', gate()),
        },
        {
          selectClip: (channelIndex) => { sessionClipSelection.selectClip(channelIndex); },
          repaintClipSelection: () => { getDawShellRuntime()?.renderClipSelection?.(); },
          seekTo: (secs) => {
            setTimelineFollow((m) => applyTimelineFollowEvent(m, 'seek'));
            void useSoundcheckStore.getState().seekTo(secs);
          },
        },
      );
      if (clipDecision.kind !== 'none') return;
      // Lane-background press (#1302): places the insert marker at the pressed time and
      // does nothing else. Runs before the scrub gate — an engineer places the edit point
      // whether or not the transport is running. Clips are pointer-events:none, so the
      // hit-test reads their laid-out rects, never the event target (see this story's ADR).
      // Unreachable for a clip press — applyClipClick already returned above.
      applyLaneBackgroundClick(
        geometry,
        {
          setInsertMarkerSecs: (secs) => { sessionTimelineMarks.setInsertMarkerSecs(secs); },
          repaintInsertMarker: () => { getDawShellRuntime()?.renderInsertMarker?.(); },
        },
      );
    }

    // The time-selection drag (#1304): armed on every ruler / lane-background press and
    // upgraded to a real selection only once the pointer clears the 4px threshold, so a
    // click keeps ADR-0110's seek and ADR-0115's insert marker untouched. A click also
    // leaves the time selection and the clip selection untouched (#1305): a scrub/seek
    // moves playback position only, it can never clobber selection state. Armed BEFORE the
    // scrub gate on purpose — a selection must be drawable on a stopped session and on a
    // lane where the scrub's playing-only gate refuses. Its deps carry no selectClip, so
    // the route cannot select a clip (see this story's ADR).
    const timeDrag = beginTimeSelectionDrag(pressGeometry, {
      windowTarget: window,
      pointerId: e.pointerId,
      setSelection: (range) => {
        sessionTimeSelection.setSelection(range.startSecs, range.endSecs);
        sessionClipSelection.clearSelection();
      },
      clearSelection: () => { sessionTimeSelection.clearSelection(); },
      repaint: () => {
        const runtime = getDawShellRuntime();
        runtime?.renderTimeSelection?.();
        runtime?.renderClipSelection?.();
      },
      // A suppressed scrub leaves its playhead preview at the pointer's last x, and the
      // rAF playhead loop only runs while capturing — repaint it back to the truth.
      onDragEnd: (dragged) => { if (dragged) getDawShellRuntime()?.renderPlayhead?.(); },
    });

    if (!canBeginSessionScrub(kind, gate())) return;

    beginSessionTimelineScrub({
      root: e.currentTarget,
      surface: surfaceEl,
      windowTarget: window,
      pointerId: e.pointerId,
      clientX: e.clientX,
      getDurationSecs: () => sessionScrubDurationSecs({
        tickDurationSecs: useSoundcheckStore.getState().lastElapsedTick?.duration,
        takeDurationSecs: takeSecs,
        manifestDurationSecs: sessionManifestDurationSecs(useSoundcheckStore.getState().manifest),
      }),
      canCommitSeek: () => canBeginSessionScrub(kind, gate()) && !(timeDrag?.hasDragged() ?? false),
      previewLeftPx: (leftPx) => {
        document.querySelectorAll<HTMLElement>('.daw-playhead').forEach((playhead) => {
          playhead.style.left = `${leftPx}px`;
        });
      },
      seekTo: (elapsedSecs) => {
        setTimelineFollow((m) => applyTimelineFollowEvent(m, 'seek'));
        return useSoundcheckStore.getState().seekTo(elapsedSecs);
      },
    });
  }

  // Manual time navigation pauses follow-scroll (#1286). Detection only - moving
  // the visible range on a gesture is #1283. Never preventDefault: this handler
  // observes the wheel, it does not consume it.
  function onBoardWheel(e: WheelEvent<HTMLDivElement>): void {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest(TIMELINE_FOLLOW_SURFACE_SELECTOR)) return;
    const event = timelineFollowEventForWheel(e);
    if (event) setTimelineFollow((m) => applyTimelineFollowEvent(m, event));
    // Horizontal pan (#1292): moves the ONE shared visible range React holds.
    // Snapshot the event fields first so the state updater never reads a live
    // synthetic event.
    const wheel = { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    const scrollCtx = { pxPerSecond: SESSION_TIMELINE_SCALE.pxPerSecond, durationSecs: zoomContext.durationSecs };
    // Zoom (#1291) and pan (#1292) both move the ONE shared visible range React
    // holds. The two gesture predicates are exact complements (ctrl/meta =>
    // zoom), so at most one of them ever fires for a given wheel.
    const zoomCtx = { durationSecs: zoomContext.durationSecs, playheadSecs: zoomContext.playheadSecs };
    setTimelineZoom((m) => {
      const zoomed = applyTimelineZoomGesture(m.range, wheel, zoomCtx);
      if (zoomed !== m.range) return { range: zoomed, previousRange: null };
      const next = applyTimelineScroll(m.range, wheel, scrollCtx);
      // Same reference back => not a gesture, or already clamped at a bound:
      // return the model itself so React bails out instead of re-rendering the
      // board.
      return next === m.range ? m : { range: next, previousRange: null };
    });
  }

  function onBoardKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    // Inline rename (#39): Enter commits via blur, Escape restores + blurs.
    const name = nameElOf(target);
    if (name) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') {
          const original = nameOriginals.get(name);
          if (original !== undefined) name.textContent = original;
        }
        (name as HTMLElement).blur();
      }
      return;
    }
    // Keyboard strip select (#668): Enter/Space while the strip itself (not
    // one of its interactive children) has focus.
    if (e.key === 'Enter' || e.key === ' ') {
      const stripEl = target.closest('.daw-track-head');
      if (stripEl && target === stripEl) {
        e.preventDefault();
        const idx = parseInt((stripEl as HTMLElement).dataset.ch ?? '', 10);
        if (Number.isInteger(idx)) useLiveCaptureStore.getState().setSelectedChannel(idx);
      }
    }
    // Keyboard reorder (#483): Arrow Up/Down on a drag handle moves its group
    // or track by one position — an accessible, deterministic alternative to
    // HTML5 drag-and-drop (ported from inline-app.js's #spectrum-body keydown
    // listener, TD-001 slice 6h #711). Frozen while capturing like the drag.
    if (useLiveCaptureStore.getState().isCapturing || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    const groupHandle = target.closest('.live-group-drag');
    if (groupHandle) {
      e.preventDefault();
      const g = parseInt(groupHandle.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10);
      const to = g + dir;
      const groups = useLiveCaptureStore.getState().channelGroups;
      if (to < 0 || to >= groups.length) return;
      useLiveCaptureStore.getState().moveGroup(g, to);
      // React re-renders on the store write; re-focus the moved handle after
      // the sync flush so the next Arrow press stays on it (#483).
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#spectrum-body .live-group-head[data-group="${to}"] .live-group-drag`)?.focus();
      });
      return;
    }
    const stripHandle = target.closest('.daw-track-head-drag');
    if (stripHandle) {
      const idx = parseInt(stripHandle.closest('.daw-track-head')?.getAttribute('data-ch') ?? '', 10);
      const groups = useLiveCaptureStore.getState().channelGroups;
      const g = getGroupState().groupOf(groups, idx);
      if (g === -1) return;
      const members = groups[g].members;
      const from = members.indexOf(idx);
      const to = from + dir;
      if (from === -1 || to < 0 || to >= members.length) return;
      e.preventDefault();
      useLiveCaptureStore.getState().moveChannelInGroup(g, from, to);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#spectrum-body .daw-track-head[data-ch="${idx}"] .daw-track-head-drag`)?.focus();
      });
    }
  }

  function onBoardChange(e: ChangeEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    const bpmInput = target.closest(`#${TIMELINE_BPM_INPUT_ID}`);
    if (bpmInput instanceof HTMLInputElement) {
      // 'change' fires on blur/Enter, never per keystroke — the shell is raw
      // markup under dangerouslySetInnerHTML, so a per-keystroke state write
      // would destroy the element being typed into.
      const entry = commitTimelineBpmEntry(bpmInput.value, timelineTempo);
      setTimelineTempo(entry.tempo);
      setBpmMessage(entry.message);
      return;
    }
    const outputDevice = target.closest('#daw-session-output-device');
    if (outputDevice instanceof HTMLSelectElement) {
      useSoundcheckStore.getState().selectDevice(outputDevice.value);
      return;
    }
    const routingMaster = target.closest('.daw-routing-master-mixdown');
    if (routingMaster instanceof HTMLInputElement) {
      const sessionId = useSoundcheckStore.getState().sessionDir ?? '';
      applyRoutingDrawerMasterMixdownChange(sessionId, routingMaster.checked, {
        routes: useRouteStore.getState(),
        soundcheck: useSoundcheckStore.getState(),
      });
      return;
    }
    const routingSource = target.closest('.daw-routing-source');
    if (routingSource instanceof HTMLSelectElement) {
      applyRoutingChange('input', routingSource);
      return;
    }
    const sessionPickerSelect = target.closest('.daw-session-picker-select');
    if (sessionPickerSelect instanceof HTMLSelectElement) {
      const action = sessionTabSessionPickerAction(sessionPickerSelect.value);
      if (action.type === 'select') {
        void useSoundcheckStore.getState().loadSession(action.sessionDir);
      } else if (action.type === 'open-folder') {
        // Restore the current value before the dialog opens so a cancellation
        // cannot leave the sentinel visibly selected in raw DAW-shell markup.
        sessionPickerSelect.value = useSoundcheckStore.getState().sessionDir ?? '';
        void useSoundcheckStore.getState().chooseSession();
      }
      return;
    }
    // Focused-input selector (#525) — ephemeral, so it just re-renders the
    // adjustments panel from the store.
    const focusSel = target.closest('.lap-focus-select');
    if (focusSel) {
      const value = (e.target as unknown as HTMLSelectElement).value;
      useLiveCaptureStore.getState().setFocusedInputIndex(value === '' ? null : parseInt(value, 10));
      return;
    }
  }
  // Keeps the native listener (declared above, before the appMode early
  // return) calling the current render's onBoardChange instead of a stale
  // closure.
  onBoardChangeRef.current = onBoardChange;

  function applyRoutingChange(kind: 'input' | 'output', control: Element): void {
    const sessionId = soundcheck.sessionDir;
    if (!sessionId) return;
    const trackIndex = Number(control.getAttribute('data-routing-track-index'));
    const rawChannels = kind === 'input' && control instanceof HTMLSelectElement
      ? control.value
      : control.getAttribute('data-routing-channels') ?? '';
    const channels = rawChannels.split(',').map(Number);
    if (!Number.isInteger(trackIndex) || trackIndex < 0 || channels.length === 0
      || !channels.every((channel) => Number.isFinite(channel) && Number.isInteger(channel) && channel >= 0)) return;
    applyRoutingDrawerChange(kind, sessionId, trackIndex, channels, {
      routes: useRouteStore.getState(),
      soundcheck: useSoundcheckStore.getState(),
    });
  }

  function onNameFocus(e: FocusEvent<HTMLDivElement>): void {
    const name = nameElOf(e.target);
    if (name) nameOriginals.set(name, name.textContent ?? '');
  }

  function onNameBlur(e: FocusEvent<HTMLDivElement>): void {
    const name = nameElOf(e.target);
    if (!name) return;
    const strip = useLiveCaptureStore.getState().channelConfig[stripIndexIn(name)];
    const original = nameOriginals.get(name);
    if (!strip || name.textContent === original) return;
    // setStripLabel (#482) trims/caps and persists keyed by device + strip
    // token; the board re-renders from the store, so the resolved name (label
    // falls back to the device name / Ch N) flows through stripViewAt. The
    // measurement badge is MeasurementBadge.tsx now, derived reactively — the
    // old window.renderMeasurementBadge() call is gone (TD-001 slice 6h #711).
    useLiveCaptureStore.getState().setStripLabel(stripIndexIn(name), name.textContent ?? '');
    nameOriginals.set(name, name.textContent ?? '');
  }

  // ── 6h group CRUD (#41, #190) — shared dialog stays imperative (the same
  // rigDialog RigControls uses); the store write re-renders the board. ──────
  async function createChannelGroup(): Promise<void> {
    const name = await window.rigDialog?.({ title: 'New group', value: '', confirmLabel: 'Create', withInput: true });
    const trimmed = normalizeGroupName(name ?? null);
    if (!trimmed) return;
    useLiveCaptureStore.getState().addGroup(trimmed);
  }

  async function renameChannelGroup(g: number): Promise<void> {
    const grp = useLiveCaptureStore.getState().channelGroups[g];
    if (!grp) return;
    const name = await window.rigDialog?.({ title: 'Rename group', value: grp.name, confirmLabel: 'Rename', withInput: true });
    const trimmed = normalizeGroupName(name ?? null);
    if (!trimmed) return;
    useLiveCaptureStore.getState().renameGroup(g, trimmed);
  }

  async function deleteChannelGroup(g: number): Promise<void> {
    const grp = useLiveCaptureStore.getState().channelGroups[g];
    if (!grp) return;
    const ok = await window.rigDialog?.({
      title: 'Delete group',
      msg: `Delete "${grp.name}"? Its tracks move to Ungrouped.`,
      confirmLabel: 'Delete',
      withInput: false,
    });
    if (!ok) return;
    useLiveCaptureStore.getState().removeGroup(g);
  }

  // ── 6h drag-reorder (#483) — ported from inline-app.js's #spectrum-body
  // drag listeners. Whole groups via .live-group-drag, or tracks within a
  // group via .daw-track-head-drag; cross-group moves stay on the group
  // dropdown. Uses getGroupState().groupOf for same-group validation. ──────
  function onDragStart(e: DragEvent<HTMLDivElement>): void {
    if (useLiveCaptureStore.getState().isCapturing) { e.preventDefault(); return; }
    const target = e.target as Element;
    const groupHandle = target.closest('.live-group-drag');
    const stripHandle = target.closest('.daw-track-head-drag');
    if (!groupHandle && !stripHandle) return;
    if (groupHandle) {
      liveDragSrc.current = { type: 'group', index: parseInt(groupHandle.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10) };
    } else if (stripHandle) {
      liveDragSrc.current = { type: 'strip', index: parseInt(stripHandle.closest('.daw-track-head')?.getAttribute('data-ch') ?? '', 10) };
    }
    if (!liveDragSrc.current) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(liveDragSrc.current.index));
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    const src = liveDragSrc.current;
    if (!src) return;
    const target = e.target as Element;
    let dropTarget: Element | null = null;
    if (src.type === 'group') {
      const head = target.closest('.live-group-head[data-group]');
      if (head && parseInt(head.getAttribute('data-group') ?? '', 10) >= 0) dropTarget = head;
    } else {
      const strip = target.closest('.daw-track-head');
      if (strip) {
        const groups = useLiveCaptureStore.getState().channelGroups;
        const srcGroup = getGroupState().groupOf(groups, src.index);
        if (srcGroup !== -1 && getGroupState().groupOf(groups, parseInt(strip.getAttribute('data-ch') ?? '', 10)) === srcGroup) dropTarget = strip;
      }
    }
    document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => { if (el !== dropTarget) el.classList.remove('drag-over'); });
    if (!dropTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropTarget.classList.add('drag-over');
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>): void {
    const el = (e.target as Element).closest('.live-group-head, .daw-track-head');
    if (el) el.classList.remove('drag-over');
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => el.classList.remove('drag-over'));
    const src = liveDragSrc.current;
    liveDragSrc.current = null;
    if (!src) return;
    e.preventDefault();
    const target = e.target as Element;
    const lc = useLiveCaptureStore.getState();
    if (src.type === 'group') {
      const head = target.closest('.live-group-head[data-group]');
      const to = head ? parseInt(head.getAttribute('data-group') ?? '', 10) : -1;
      if (head && to >= 0) lc.moveGroup(src.index, to);
    } else {
      const strip = target.closest('.daw-track-head');
      if (strip) {
        const g = getGroupState().groupOf(lc.channelGroups, src.index);
        const members = (lc.channelGroups[g] && lc.channelGroups[g].members) || [];
        const from = members.indexOf(src.index);
        const to = members.indexOf(parseInt(strip.getAttribute('data-ch') ?? '', 10));
        if (g !== -1 && from !== -1 && to !== -1) lc.moveChannelInGroup(g, from, to);
      }
    }
  }

  function onDragEnd(): void {
    liveDragSrc.current = null;
    document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => el.classList.remove('drag-over'));
  }
  /* c8 ignore stop */

  return (
    <div
      ref={boardRootRef}
      className="live-board-root"
      onClick={onBoardClick}
      onPointerDown={onBoardPointerDown}
      onWheel={onBoardWheel}
      onKeyDown={onBoardKeyDown}
      onFocus={onNameFocus}
      onBlur={onNameBlur}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
