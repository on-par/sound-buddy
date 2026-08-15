// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The unified "Analyze" source picker (#543, epic e17) — TD-001 slice 6h
// (#711): a direct child of App (like LicenseChrome), rendered only while
// useAnalyzeSourceStore.isOpen. Verbatim port of inline-app.js's static
// #analyze-source-picker block + its open/close/route listeners: same ids,
// classes, and data-analyze-source attributes, same targetModeFor routing
// (null → chooseAndAnalyzeFile, undefined → loud error, else switchMode).
// The app.css rule `body:not(.report-first-ux) #analyze-source-picker { … }`
// keeps gating the flag-off case even if the store is ever opened.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalyzeSourceStore } from './stores/analyzeSourceStore';
import { switchMode } from './mode-switch';
import { iconSvg } from './report-card';

interface AnalyzeSourceStateApi {
  targetModeFor(id: string): string | null | undefined;
}
function getAnalyzeSourceState(): AnalyzeSourceStateApi {
  return (window as unknown as { analyzeSourceState: AnalyzeSourceStateApi }).analyzeSourceState;
}
function getChooseAndAnalyzeFile(): (() => Promise<void>) | undefined {
  return (window as unknown as { chooseAndAnalyzeFile?: () => Promise<void> }).chooseAndAnalyzeFile;
}

// The three answers to "where's the audio coming from?" (#543) — mirrors
// analyze-source-state.js's ANALYZE_SOURCES labels/hints/icons verbatim.
const SOURCES = [
  { id: 'file', icon: 'file-audio', label: 'Analyze a file', hint: 'Drop in a recording you already have.' },
  { id: 'live', icon: 'radio', label: 'Start live listening', hint: 'Monitor multi-channel audio from the console right now.' },
  { id: 'soundcheck', icon: 'sliders', label: 'Load a soundcheck session', hint: 'Play back a captured session and mix without the band.' },
];

export default function AnalyzeSourcePicker(): JSX.Element | null {
  // useStoreShallow (not the bound hook) so renderToString reads the LIVE
  // store — see useStoreShallow.ts's header for why zustand's own hook can't.
  const isOpen = useStoreShallow(useAnalyzeSourceStore, (s) => s.isOpen);
  if (!isOpen) return null;

  /* c8 ignore start -- click/Escape dispatch, no jsdom in this harness
     (renderToString doesn't dispatch events) — the routing itself is
     analyzeSourceState.targetModeFor (unit-tested in analyze-source-state.js's
     suite) and the open/close transitions are analyzeSourceStore.test.ts;
     exercised end-to-end by the report-first-ux / momentum e2e specs. */
  function choose(id: string): void {
    const mode = getAnalyzeSourceState().targetModeFor(id);
    useAnalyzeSourceStore.getState().close();
    if (mode === null) { getChooseAndAnalyzeFile()?.(); return; }
    if (mode === undefined) { console.error(`analyze-source-picker: unrecognized source "${id}"`); return; }
    switchMode(mode);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') useAnalyzeSourceStore.getState().close();
  }
  /* c8 ignore stop */

  return (
    <div
      className="source-picker"
      id="analyze-source-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-picker-title"
      onKeyDown={onKeyDown}
    >
      <div className="sp-panel">
        <h2 className="sp-title" id="source-picker-title">Where&rsquo;s the audio coming from?</h2>
        {SOURCES.map((s) => (
          <button
            type="button"
            className="sp-choice"
            data-analyze-source={s.id}
            key={s.id}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => choose(s.id)}
          >
            <span className="sp-label" dangerouslySetInnerHTML={{ __html: iconSvg(s.icon, 16) + s.label }} />
            <span className="sp-hint">{s.hint}</span>
          </button>
        ))}
        <button
          type="button"
          className="sp-cancel"
          id="source-picker-cancel"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => useAnalyzeSourceStore.getState().close()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
