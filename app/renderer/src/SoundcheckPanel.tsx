// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-soundcheck Virtual Soundcheck playback controls (TD-001 slice 6d,
// #702) — session picker, output device, per-track routing, master mixdown,
// and the Play/Stop transport — portaled by App.tsx onto
// #soundcheck-island, replacing inline-app.js's scLoadDevices/scChooseSession/
// scRenderTracks/scUpdateMixdownNotice/scPlay/scStop DOM-writers for this
// region. Structural twin of LiveWorkspace.tsx/LiveControls.tsx: state lives
// in soundcheckStore, and per-tick elapsed/meter values (ADR-0005) bypass
// React entirely via the mounted soundcheck-transport-controller, which
// patches #sc-elapsed/#spectrum-imperative directly — see that file's header.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { createSoundcheckTransportController } from './soundcheck-transport-controller';
import { soundcheckTrackListView, playGuardOk, type SoundcheckMeterTrack } from './soundcheck-panel';
import { iconSvg, fmt } from './report-card';
import { escapeHtml, formatClock } from './spectrum-display';

/* c8 ignore start -- real DOM-patching wiring, no jsdom in this harness
   (renderToString doesn't run effects) — exercised by
   tests/e2e/virtual-soundcheck.spec.ts. createSoundcheckTransportController's
   own coalescing logic is exhaustively unit-tested in
   soundcheck-transport-controller.test.ts against fake deps. */
function patchElapsedDom(tick: { elapsed: number; duration: number }): void {
  const el = document.getElementById('sc-elapsed');
  if (el) el.textContent = `${formatClock(tick.elapsed)} / ${formatClock(tick.duration)}`;
}

// Verbatim port of inline-app.js's scRenderMeters markup/RMS-to-percent math.
function patchMetersDom(tracks: SoundcheckMeterTrack[]): void {
  useSpectrumStore.getState().setPanelState('meters'); // hands #spectrum-imperative back to this renderer
  const body = document.getElementById('spectrum-imperative');
  if (!body) return;
  body.innerHTML = '<div class="meter-card sb-live-meters">' + tracks.map((t) => {
    const rms = Number.isFinite(t.rms) ? t.rms : -120;
    const pct = Math.max(0, Math.min(100, (rms + 60) / 60 * 100));
    return `<div class="sc-meter${t.clipping ? ' clip' : ''}">
      <div class="sc-meter-head">
        <span class="sc-meter-name">${escapeHtml(t.label || 'Track')}</span>
        <span class="sc-meter-val">RMS ${fmt(t.rms)} · Peak ${fmt(t.peak)} dBFS</span>
        ${t.clipping ? '<span class="sc-meter-clip">CLIP</span>' : ''}
      </div>
      <div class="sc-meter-bar"><div class="sc-meter-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
  }).join('') + '</div>';
}
/* c8 ignore stop */

export default function SoundcheckPanel(): JSX.Element {
  const {
    manifest, sessionDir, devices, selectedDevice, deviceChannels, devicesLoaded,
    master, playing, elapsedText, mixdownNotice, statusMessage, routes,
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
  }));

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness — see the module-header note above. */
  useEffect(() => {
    const controller = createSoundcheckTransportController({
      subscribe: useSoundcheckStore.subscribe,
      getState: () => ({
        lastElapsedTick: useSoundcheckStore.getState().lastElapsedTick,
        lastMeterTick: useSoundcheckStore.getState().lastMeterTick,
      }),
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patchElapsed: patchElapsedDom,
      patchMeters: patchMetersDom,
    });
    controller.start();
    return () => controller.stop();
  }, []);
  /* c8 ignore stop */

  const tracks = soundcheckTrackListView(manifest, routes, deviceChannels, playing);
  const playOk = playGuardOk(manifest, devicesLoaded, playing);

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
                disabled={t.disabled}
                value={t.routeBase}
                onChange={(e) => useSoundcheckStore.getState().setRoute(t.index, parseInt(e.target.value, 10))}
              >
                {t.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
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
