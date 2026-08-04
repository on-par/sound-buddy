// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The spectrogram heatmap strip + playback transport under the analysis
// curve (TD-001 slice 6a, #695) — ported from inline-app.js's
// buildFramesSectionHTML/initSpectrogram/selectFrame/renderScrub plus the
// AW-4 realtime band loop (renderPlaybackBands/startPlaybackBandLoop). Mounts
// only when the populated spectrum actually has frames (SpectrumPanel gates
// on that already; this component also renders null defensively).
//
// The ~60Hz tick listener writes straight to refs/DOM (playhead position,
// elapsed/total readout, per-frame band bars, the highlighted heatmap
// column) instead of flowing through React state, so #spectrum-chart's CSS
// height/value transitions keep animating instead of restarting on every
// repaint — see the ADR in the #695 plan. Only discrete transitions (play,
// pause, ended, a new file, a frame pin/unpin) re-render React.

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { iconSvg } from './report-card';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSpectrumStore } from './stores/spectrumStore';
import {
  spectrumTransport,
  frameIndexFromClick,
  playheadPercent,
  playbackClockText,
  scrubReadoutText,
  playbackReadoutText,
  frameIndexAtTime,
  windowAverageRms,
  PLAYBACK_AVG_WINDOW_SEC,
} from './spectrum-transport';
import {
  heatmapSVG,
  timeAxisHTML,
  patchBarsAndLabels,
  frameBandDb,
  spectrumChartModel,
  type SpectrumData,
  type IdealProfileLike,
} from './spectrum-display';

export interface SpectrogramScrubberProps {
  spectrum: SpectrumData;
  idealProfile: IdealProfileLike | null;
  filePath: string | null;
}

export default function SpectrogramScrubber({ spectrum, idealProfile, filePath }: SpectrogramScrubberProps) {
  const { selectedFrame, fallbackDuration, selectFrame } = useStoreShallow(useSpectrumStore, (s) => ({
    selectedFrame: s.selectedFrame,
    fallbackDuration: s.fallbackDuration,
    selectFrame: s.selectFrame,
  }));
  const frames = spectrum.frames;
  const [playing, setPlaying] = useState(() => spectrumTransport.isPlaying());
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const heatRef = useRef<HTMLDivElement | null>(null);
  // Last frame index actually painted by the tick listener — skips repaint
  // work on ticks where the playhead hasn't crossed into a new frame yet.
  // Reset to -1 whenever a playback session (re)starts (the resting-state
  // effect), so the first tick after resuming always repaints.
  const lastFrameIndexRef = useRef(-1);

  /* c8 ignore start -- DOM-applier / lifecycle effects, no jsdom in this
     harness (renderToString only, and the constitution forbids adding a new
     test framework) — exercised by tests/e2e/playback-transport.spec.ts and
     tests/e2e/report-card-spectrum.spec.ts. Every pure input (playbackClockText,
     playheadPercent, frameIndexAtTime, frameBandDb, playbackReadoutText,
     windowAverageRms, scrubReadoutText, spectrumChartModel,
     frameIndexFromClick) is fully unit-tested in spectrum-transport.test.ts /
     spectrum-display.test.ts. */
  function selColumns(heat: HTMLDivElement | null, isSelected: (i: number) => boolean): void {
    heat?.querySelectorAll('.hm-col').forEach((col) => {
      const i = parseInt((col as HTMLElement).dataset.i ?? '-1', 10);
      col.classList.toggle('sel', isSelected(i));
    });
  }

  // Shared by the discrete-subscribe and tick effects below — both need to
  // paint the elapsed/total readout and the playhead position on every
  // discrete transition and every animation-frame tick alike.
  function applyReadout(): void {
    if (timeRef.current) timeRef.current.textContent = playbackClockText(spectrumTransport.currentTime(), spectrumTransport.duration());
    const playhead = document.getElementById('spectro-playhead');
    if (playhead) {
      playhead.style.left = `${playheadPercent(spectrumTransport.currentTime(), spectrumTransport.duration())}%`;
      playhead.style.display = 'block';
    }
  }

  useEffect(() => {
    if (filePath) void spectrumTransport.ensure(filePath);
  }, [filePath]);

  useEffect(() => {
    spectrumTransport.setFallbackDuration(fallbackDuration);
  }, [fallbackDuration]);

  useEffect(() => {
    return spectrumTransport.subscribe(() => {
      setPlaying(spectrumTransport.isPlaying());
      applyReadout();
    });
  }, []);

  useEffect(() => {
    if (!frames || !frames.length) return undefined;
    return spectrumTransport.onTick((t) => {
      applyReadout();
      const i = frameIndexAtTime(frames, t, spectrumTransport.duration());
      if (i === lastFrameIndexRef.current) return;
      lastFrameIndexRef.current = i;
      const chart = document.getElementById('spectrum-chart');
      if (chart) patchBarsAndLabels(chart, frameBandDb(spectrum, i));
      if (readoutRef.current) {
        readoutRef.current.textContent = playbackReadoutText(frames[i].class, windowAverageRms(frames, t, PLAYBACK_AVG_WINDOW_SEC));
      }
      selColumns(heatRef.current, (col) => col === i);
    });
  }, [spectrum, frames]);

  useEffect(() => {
    lastFrameIndexRef.current = -1;
    if (playing) return;
    const chart = document.getElementById('spectrum-chart');
    if (chart) chart.innerHTML = spectrumChartModel({ spectrum, idealProfile, selectedFrame }).chartHTML;
    const selected = selectedFrame != null ? (frames?.[selectedFrame] ?? null) : null;
    if (readoutRef.current) readoutRef.current.textContent = scrubReadoutText(selected);
    selColumns(heatRef.current, (col) => selectedFrame != null && col === selectedFrame);
  }, [playing, selectedFrame, spectrum, idealProfile]);

  function onHeatClick(e: MouseEvent<HTMLDivElement>): void {
    if (!heatRef.current || !frames) return;
    const box = heatRef.current.getBoundingClientRect();
    const i = frameIndexFromClick(e.clientX, box.left, box.width, frames.length);
    if (i == null) return;
    spectrumTransport.seek(frames[i].t);
    // Only pin a static frame when playback isn't actively driving the bars
    // (AW-4, #179) — while playing, the tick listener already reflects
    // wherever the seek landed on its very next tick.
    if (!spectrumTransport.isPlaying()) selectFrame(i);
  }
  /* c8 ignore stop */

  if (!frames || !frames.length) return null;

  const single = frames.length === 1;
  const selectedFrameObj = selectedFrame != null ? (frames[selectedFrame] ?? null) : null;

  return (
    <div className="spectro-scrub">
      <div className="spectro-head">
        <span className="spectro-title">Spectrogram · time →</span>
        <span id="scrub-readout" className="scrub-readout" ref={readoutRef}>{scrubReadoutText(selectedFrameObj)}</span>
        <span className="spectro-hint">{single ? 'single frame — short file' : 'click a column to scrub'}</span>
        <button
          id="scrub-reset"
          type="button"
          className={'scrub-reset' + (selectedFrame != null ? ' active' : '')}
          /* c8 ignore next -- interaction-only glue; no jsdom in this harness to
             click the button (renderToString doesn't run DOM events). */
          onClick={() => selectFrame(null)}
        >
          <span dangerouslySetInnerHTML={{ __html: iconSvg('play', 11) }} />
          Average
        </button>
      </div>
      <div className="spectro-transport">
        <button
          id="spectro-play-btn"
          type="button"
          className={'spectro-play-btn' + (playing ? ' playing' : '')}
          aria-label={playing ? 'Pause' : 'Play'}
          /* c8 ignore next -- interaction-only glue; no jsdom in this harness to
             click the button (renderToString doesn't run DOM events). */
          onClick={() => spectrumTransport.toggle()}
          dangerouslySetInnerHTML={{ __html: iconSvg(playing ? 'pause' : 'play', 13) }}
        />
        <span id="spectro-time" className="spectro-time" ref={timeRef}>
          {playbackClockText(spectrumTransport.currentTime(), spectrumTransport.duration())}
        </span>
      </div>
      <div
        id="spectrum-heatmap"
        className="spectro-heat"
        ref={heatRef}
        onClick={onHeatClick}
        dangerouslySetInnerHTML={{ __html: heatmapSVG(frames) + '<div id="spectro-playhead" class="spectro-playhead"></div>' }}
      />
      <div dangerouslySetInnerHTML={{ __html: timeAxisHTML(frames) }} />
    </div>
  );
}
