// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Presentational counterpart to spectrum-chrome.ts's spectrumStatusView (#695):
// renders the spectrum panel's empty/loading/error placeholder — byte-
// equivalent markup to inline-app.js's former setSpectrumState. The loading
// stage stepper reads spectrumStore's stagesDone directly via SpectrumPanel's
// props so the checklist re-renders reactively instead of a manual
// classList.add per completed stage.
//
// Note: the Cancel button renders its icon inline (dangerouslySetInnerHTML)
// rather than via a `data-icon` attribute, so inline-app.js's document-wide
// hydrateIcons() boot pass can't find and double-insert it.

import { iconSvg } from './report-card';
import { useAnalysisStore } from './stores/analysisStore';
import { ANALYSIS_STAGES, type AnalysisStage } from './stores/spectrumStore';
import type { SpectrumStatusView } from './spectrum-chrome';

export default function SpectrumStatus({ view, stagesDone }: { view: SpectrumStatusView; stagesDone: readonly AnalysisStage[] }) {
  if (view.kind === 'loading') {
    return (
      <div className="spectrum-empty">
        <p>Analyzing audio…</p>
        <div className="stage-stepper">
          {ANALYSIS_STAGES.map(({ stage, label }) => (
            <div className={'stage-row' + (stagesDone.includes(stage) ? ' done' : '')} data-stage={stage} key={stage}>
              <span className="stage-icon">
                <span className="stage-spin" />
                <span className="stage-check" dangerouslySetInnerHTML={{ __html: iconSvg('check', 14) }} />
              </span>
              <span className="stage-label">{label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          id="analysis-cancel-btn"
          className="btn btn-secondary sm"
          /* c8 ignore next -- interaction-only glue; no jsdom in this harness to
             click the button (renderToString doesn't run DOM events). */
          onClick={() => { void useAnalysisStore.getState().cancelAnalysis(); }}
        >
          <span dangerouslySetInnerHTML={{ __html: iconSvg('x', 16) }} />
          Cancel
        </button>
      </div>
    );
  }

  if (view.kind === 'error') {
    return (
      <div className="spectrum-empty" style={{ color: 'var(--issue-text)' }}>
        <span dangerouslySetInnerHTML={{ __html: iconSvg(view.icon, view.iconSize) }} />
        <p>{view.text}</p>
        <p className="sub" style={{ maxWidth: '340px', color: 'var(--text-tertiary)' }}>{view.sub}</p>
      </div>
    );
  }

  return (
    <div className="spectrum-empty">
      <span dangerouslySetInnerHTML={{ __html: iconSvg(view.icon, view.iconSize) }} />
      <p>{view.text}</p>
    </div>
  );
}
