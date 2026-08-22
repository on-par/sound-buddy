// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The legacy standalone Virtual Soundcheck playback controls (TD-001 slice 6d,
// #702) — session picker, output device, per-track routing, master mixdown,
// and the Play/Stop transport — portaled by App.tsx onto
// #soundcheck-island, replacing inline-app.js's scLoadDevices/scChooseSession/
// scRenderTracks/scUpdateMixdownNotice/scPlay/scStop DOM-writers for this
// region. Structural twin of LiveWorkspace.tsx/LiveControls.tsx: state lives
// in soundcheckStore, and per-tick elapsed values (ADR-0005) bypass React
// entirely via the mounted soundcheck-transport-controller, which patches
// #sc-elapsed/#sc-playhead directly — see that file's header. The per-track
// meter cards were removed (#760): playback shows only the track list, the
// waveform lanes, and the seeking playhead.

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { useSettingsStore } from './stores/settingsStore';
import { createSoundcheckTransportController } from './soundcheck-transport-controller';
import { soundcheckPlayheadLeftPx, soundcheckSeekTargetFromClick } from './soundcheck-playhead';
import { soundcheckTrackListView, soundcheckChannelOptions, playGuardOk } from './soundcheck-panel';
import { iconSvg } from './report-card';
import { formatClock } from './spectrum-display';
import {
  sessionPeakTimeline,
  drawSoundcheckWaveform,
  type WaveformCanvasLike,
} from './soundcheck-waveform';

/* c8 ignore start -- real DOM-patching wiring, no jsdom in this harness
   (renderToString doesn't run effects) — exercised by
   tests/e2e/virtual-soundcheck.spec.ts. createSoundcheckTransportController's
   own coalescing logic is exhaustively unit-tested in
   soundcheck-transport-controller.test.ts against fake deps. */
function patchElapsedDom(tick: { elapsed: number; duration: number }): void {
  const el = document.getElementById('sc-elapsed');
  if (el) el.textContent = `${formatClock(tick.elapsed)} / ${formatClock(tick.duration)}`;
}

// #736 playhead applier: positions the #sc-playhead overlay over the lane
// block from the same coalesced elapsed tick the readout rides. Measures the
// name/canvas widths from the DOM each tick — cheap at the 0.1s progress
// cadence and always correct on resize (no cached geometry to go stale).
function patchPlayheadDom(tick: { elapsed: number; duration: number }): void {
  const playhead = document.getElementById('sc-playhead');
  const container = document.getElementById('sc-waveforms');
  if (!playhead || !container) return;
  const name = container.querySelector('.sc-waveform-name');
  const canvas = container.querySelector('.sc-waveform-canvas');
  if (!name || !canvas) return;
  const left = soundcheckPlayheadLeftPx(tick.elapsed, tick.duration, name.clientWidth, canvas.clientWidth);
  if (left == null) return;
  playhead.style.left = `${left}px`;
  playhead.style.display = 'block';
}

/* c8 ignore stop */

export default function SoundcheckPanel(): JSX.Element {
  const {
    manifest, sessionDir, devices, selectedDevice, deviceChannels, devicesLoaded,
    master, playing, elapsedText, mixdownNotice, statusMessage, routes,
    peaks, peaksStatus,
  } = useStoreShallow(useSoundcheckStore, (s) => ({
    manifest: s.manifest,
    sessionDir: s.sessionDir,
    devices: s.devices,
    selectedDevice: s.selectedDevice,
    deviceChannels: s.deviceChannels,
    devicesLoaded: s.devicesLoaded,
    master: s.master,
    playing: s.playing,
    elapsedText: s.elapsedText,
    mixdownNotice: s.mixdownNotice,
    statusMessage: s.statusMessage,
    routes: s.routes,
    peaks: s.peaks,
    peaksStatus: s.peaksStatus,
  }));

  // Saved buses (#756): the persisted label-pattern → output-channel list,
  // read straight off the settings store. Add/delete/retune below persist the
  // FULL next array through the generic update-settings IPC (whitelist derived
  // from SETTING_SPECS.soundcheckBuses).
  const buses = useStoreShallow(useSettingsStore, (s) => s.settings?.soundcheckBuses);

  // Add-bus form fields (local state — the persisted array lives in settings).
  const [busName, setBusName] = useState('');
  const [busPattern, setBusPattern] = useState('');
  const [busChannel, setBusChannel] = useState(0);

  // The shared-timeline lane model (#735): decode runs once per peaks object
  // (one per session load), never per render — a full-length session's ~180k
  // buckets stay out of every re-render.
  const timeline = useMemo(() => sessionPeakTimeline(peaks), [peaks]);

  /* c8 ignore start -- #736 click/drag-to-seek interaction glue: no jsdom in
     this renderToString harness to fire pointer events, so the geometry math
     (soundcheckPlayheadLeftPx / soundcheckSeekTargetFromClick) is unit-tested
     in soundcheck-playhead.test.ts and the DOM+event wiring is gated by
     tests/e2e/virtual-soundcheck.spec.ts. */
  const waveformsRef = useRef<HTMLDivElement | null>(null);
  const lastClientXRef = useRef(0);

  // Measures the seekable canvas column [containerLeft + nameWidthPx, +
  // canvasWidthPx] from the live DOM and maps clientX → a continuous seek
  // time, or null for the track-name column / invalid geometry / duration.
  function measuredSeek(clientX: number): { t: number; durationSecs: number; nameWidthPx: number; canvasWidthPx: number } | null {
    const container = waveformsRef.current;
    if (!container || !timeline) return null;
    const rect = container.getBoundingClientRect();
    const name = container.querySelector('.sc-waveform-name');
    const canvas = container.querySelector('.sc-waveform-canvas');
    if (!name || !canvas) return null;
    const t = soundcheckSeekTargetFromClick(clientX, rect.left, name.clientWidth, canvas.clientWidth, timeline.sessionDurationSecs);
    if (t == null) return null;
    return { t, durationSecs: timeline.sessionDurationSecs, nameWidthPx: name.clientWidth, canvasWidthPx: canvas.clientWidth };
  }

  // Visual scrub only — the playhead follows the pointer via imperative
  // style.left writes (no React re-render, no backend call). ADR-0013's seek
  // is a full child restart, so the backend commit happens exactly once, on
  // pointerup, never per move.
  function scrubPlayheadTo(clientX: number): void {
    lastClientXRef.current = clientX;
    const m = measuredSeek(clientX);
    if (!m) return;
    const playhead = document.getElementById('sc-playhead');
    if (!playhead) return;
    const left = soundcheckPlayheadLeftPx(m.t, m.durationSecs, m.nameWidthPx, m.canvasWidthPx);
    if (left != null) playhead.style.left = `${left}px`;
  }

  function onWaveformPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (!playing) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubPlayheadTo(e.clientX); // instant visual feedback, no backend call
    const move = (ev: globalThis.PointerEvent) => scrubPlayheadTo(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // The playing re-check guards against a stop landing mid-drag.
      if (!useSoundcheckStore.getState().playing) return;
      // Commit the backend seek exactly once, on release (ADR-0013 restart
      // seek). A click is down+up with no movement → the single
      // release-commit is the click-seek.
      const m = measuredSeek(lastClientXRef.current);
      if (!m) return;
      void useSoundcheckStore.getState().seekTo(m.t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  /* c8 ignore stop */

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness — see the module-header note above. */
  useEffect(() => {
    const controller = createSoundcheckTransportController({
      subscribe: useSoundcheckStore.subscribe,
      getState: () => ({
        lastElapsedTick: useSoundcheckStore.getState().lastElapsedTick,
      }),
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patchElapsed: patchElapsedDom,
      patchPlayhead: patchPlayheadDom,
    });
    controller.start();
    return () => controller.stop();
  }, []);
  /* c8 ignore stop */

  /* c8 ignore start -- real canvas-DOM wiring, no jsdom in this harness
     (renderToString doesn't run effects); the decode/column/draw geometry is
     exhaustively unit-tested in soundcheck-waveform.test.ts and this wiring
     is gated by tests/e2e/virtual-soundcheck.spec.ts — including the #735
     window-resize re-paint, whose backing-store-follows-clientWidth assertion
     the spec's "re-paints waveform lane canvases when the window is resized"
     test drives. */
  // The shared draw body, stable per timeline: measures the first canvas,
  // derives the shared pxPerSecond, sizes every lane canvas from its current
  // clientWidth/clientHeight, and paints. Ran once per peaks document (the
  // [timeline] effect below) and again on every window 'resize' so a flexible
  // .sc-waveform-canvas re-measures instead of going stale at the pre-resize
  // width (the #735 defect this fixes).
  const paintLanes = useCallback(() => {
    if (!timeline) return;
    const container = document.getElementById('sc-waveforms');
    const firstCanvas = container?.querySelector<HTMLCanvasElement>('.sc-waveform-canvas');
    const firstWidth = firstCanvas?.clientWidth ?? 0;
    // The shared-scale invariant (story 3 #735): one pxPerSecond derived from
    // the FIRST canvas's width and the LONGEST track's duration, applied to
    // every lane so they all share one time axis aligned at x=0.
    const pxPerSecond = timeline.sessionDurationSecs > 0 ? firstWidth / timeline.sessionDurationSecs : 0;
    if (pxPerSecond <= 0) return;
    for (const lane of timeline.lanes) {
      const canvas = container?.querySelector<HTMLCanvasElement>(`.sc-waveform-canvas[data-idx="${lane.index}"]`);
      if (!canvas) continue;
      const canvasWidth = canvas.clientWidth;
      const canvasHeight = canvas.clientHeight;
      if (canvasWidth <= 0 || canvasHeight <= 0) continue;
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      drawSoundcheckWaveform(
        ctx as unknown as WaveformCanvasLike,
        lane.pairs,
        timeline.bucketsPerSecond,
        pxPerSecond,
        canvasWidth,
        canvasHeight,
      );
    }
  }, [timeline]);

  // The peaks-change path: re-paint once per timeline, exactly as shipped.
  useEffect(() => {
    paintLanes();
  }, [paintLanes]);

  // The #735 resize re-paint: a resizable window can change the flexible
  // lane canvases' CSS width after the one-shot paint above, so re-paint on
  // every window resize; cleanup removes the listener on unmount/re-paint
  // identity change so none accumulates.
  useEffect(() => {
    window.addEventListener('resize', paintLanes);
    return () => window.removeEventListener('resize', paintLanes);
  }, [paintLanes]);
  /* c8 ignore stop */

  // #759: routing stays editable during playback now (soundcheckTrackListView
  // carries no `disabled` field) — no `playing` arg to pass here anymore.
  const tracks = soundcheckTrackListView(manifest, routes, deviceChannels);
  const playOk = playGuardOk(manifest, devicesLoaded, playing);

  /* c8 ignore start -- saved-bus add/delete/retune handlers: pure IPC dispatch
     invoked only from the DOM onChange/onClick wiring below; this renderToString
     harness has no jsdom to fire those events, so the wiring is excluded per the
     file's established pattern (see patchElapsedDom / scrubPlayheadTo above) and
     the sanitizer/persistence logic they rely on is unit-tested in
     settings.test.ts + soundcheckStore.test.ts. */
  function addBus(): void {
    const name = busName.trim();
    const pattern = busPattern.trim();
    if (name === '' || pattern === '') return;
    const next = [...(buses ?? []), { id: crypto.randomUUID(), name, pattern, outputChannel: busChannel }];
    void useSettingsStore.getState().updateSettings({ soundcheckBuses: next });
    setBusName('');
    setBusPattern('');
    setBusChannel(0);
  }

  function deleteBus(id: string): void {
    void useSettingsStore.getState().updateSettings({ soundcheckBuses: (buses ?? []).filter((b) => b.id !== id) });
  }

  function setBusOutput(id: string, base: number): void {
    void useSettingsStore.getState().updateSettings({
      soundcheckBuses: (buses ?? []).map((b) => (b.id === id ? { ...b, outputChannel: base } : b)),
    });
  }
  /* c8 ignore stop */

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary full"
        id="sc-choose-btn"
        onClick={() => { void useSoundcheckStore.getState().chooseSession(); }}
        dangerouslySetInnerHTML={{ __html: iconSvg('folder', 16) + 'Choose session folder…' }}
      />
      {sessionDir && (
        <div id="sc-session-name" className="sc-session-name">{sessionDir.split('/').pop()}</div>
      )}
      <div className="hairline" />

      <label className="select-label">
        <span>Output Device</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="sc-device-select"
              value={selectedDevice}
              onChange={(e) => useSoundcheckStore.getState().selectDevice(e.target.value)}
            >
              <option value="">Default output</option>
              {devices.map((d) => <option key={d.index} value={String(d.index)}>{`${d.name} (${d.channels}ch)`}</option>)}
            </select>
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
        </div>
      </label>

      <div className="chcfg-head"><span className="lbl">Tracks &amp; routing</span></div>
      <div id="sc-tracks" className="sc-tracks">
        {tracks.length === 0
          ? <div className="sc-empty">Choose a session folder to load its tracks.</div>
          : tracks.map((t) => (
            <div className="sc-track" data-idx={t.index} key={t.index}>
              <span className="sc-track-name" title={t.label}>{t.label}</span>
              <span className="sc-badge">{t.stereo ? 'Stereo' : 'Mono'}</span>
              <select
                className="sc-route"
                data-idx={t.index}
                data-kind={t.stereo ? 'stereo' : 'mono'}
                value={t.routeBase}
                onChange={(e) => useSoundcheckStore.getState().setRoute(t.index, parseInt(e.target.value, 10))}
              >
                {t.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
      </div>
      {timeline != null ? (
        <div id="sc-waveforms" className="sc-waveforms" ref={waveformsRef} onPointerDown={onWaveformPointerDown}>
          {timeline.lanes.map((lane) => (
            <div className="sc-waveform-lane" data-idx={lane.index} key={lane.index}>
              <span className="sc-waveform-name" title={lane.label}>{lane.label}</span>
              <canvas className="sc-waveform-canvas" data-idx={lane.index} />
            </div>
          ))}
          {playing && <div id="sc-playhead" className="sc-playhead" />}
        </div>
      ) : peaksStatus === 'generating' ? (
        <div id="sc-waveforms" className="sc-waveforms">
          <div className="sc-waveforms-hint">Generating waveforms…</div>
        </div>
      ) : null}
      {/* Saved buses (#756) — persisted label-pattern → output-channel routing.
          A bus applies on the next session import/reseed, never retroactively to
          an already-loaded session (ADR-0012). */}
      <div className="chcfg-head"><span className="lbl">Saved buses</span></div>
      <div id="sc-buses" className="sc-buses">
        {buses != null && buses.length > 0 && buses.map((bus) => (
          <div className="sc-bus" data-bus-id={bus.id} key={bus.id}>
            <span className="sc-bus-name" title={bus.name}>{bus.name}</span>
            <span className="sc-bus-pattern sc-badge">{bus.pattern}</span>
            <select
              className="sc-bus-route"
              aria-label={`${bus.name} output channel`}
              value={bus.outputChannel}
              /* c8 ignore next -- select onChange, no jsdom in this harness */
              onChange={(e) => setBusOutput(bus.id, parseInt(e.target.value, 10))}
            >
              {soundcheckChannelOptions(bus.outputChannel, false, deviceChannels).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary sm sc-bus-delete"
              id={`sc-bus-delete-${bus.id}`}
              /* c8 ignore next -- click dispatch, no jsdom */
              onClick={() => deleteBus(bus.id)}
            >
              Delete
            </button>
          </div>
        ))}
        {buses != null && buses.length === 0 && (
          <div className="sc-empty">No saved buses yet.</div>
        )}
        <div className="sc-bus-add">
          <input
            id="sc-bus-name"
            className="sc-bus-name-input"
            placeholder="Bus name"
            value={busName}
            /* c8 ignore next -- input onChange, no jsdom in this harness */
            onChange={(e) => setBusName(e.target.value)}
          />
          <input
            id="sc-bus-pattern"
            className="sc-bus-pattern-input"
            placeholder="Pattern (e.g. ag)"
            value={busPattern}
            /* c8 ignore next -- input onChange, no jsdom in this harness */
            onChange={(e) => setBusPattern(e.target.value)}
          />
          <select
            id="sc-bus-add-channel"
            className="sc-bus-add-channel"
            value={busChannel}
            /* c8 ignore next -- select onChange, no jsdom in this harness */
            onChange={(e) => setBusChannel(parseInt(e.target.value, 10))}
          >
            {soundcheckChannelOptions(busChannel, false, deviceChannels).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary sm"
            id="sc-bus-add"
            disabled={busName.trim() === '' || busPattern.trim() === ''}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => addBus()}
          >
            Add
          </button>
        </div>
      </div>
      <label className="sc-master">
        <input
          type="checkbox"
          id="sc-master-toggle"
          checked={master}
          onChange={(e) => useSoundcheckStore.getState().setMaster(e.target.checked)}
        />
        <span>Master mixdown (stereo)</span>
      </label>
      {mixdownNotice != null && <div id="sc-mixdown-notice" className="sc-notice">{mixdownNotice}</div>}
      <div className="hairline" />

      <button
        className="btn btn-primary full"
        id="sc-play-btn"
        disabled={!playOk}
        style={{ display: playing ? 'none' : 'inline-flex' }}
        onClick={() => { void useSoundcheckStore.getState().play(); }}
        dangerouslySetInnerHTML={{ __html: iconSvg('play', 16) + 'Play' }}
      />
      <button
        className="btn btn-danger full"
        id="sc-stop-btn"
        style={{ display: playing ? 'inline-flex' : 'none' }}
        onClick={() => { void useSoundcheckStore.getState().stop(); }}
        dangerouslySetInnerHTML={{ __html: iconSvg('square', 16) + 'Stop' }}
      />
      {elapsedText != null && <div id="sc-elapsed" className="sc-elapsed">{elapsedText}</div>}
      {statusMessage != null && <div id="sc-status" className="sc-status" role="alert">{statusMessage}</div>}
    </>
  );
}
