// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SpectrumStatus from './SpectrumStatus';
import { spectrumStatusView } from './spectrum-chrome';
import type { AnalysisStage } from './stores/spectrumStore';

function renderMarkup(view: NonNullable<ReturnType<typeof spectrumStatusView>>, stagesDone: readonly AnalysisStage[] = []): string {
  return renderToString(createElement(SpectrumStatus, { view, stagesDone }));
}

describe('SpectrumStatus', () => {
  it('empty: shows the waveform icon and the empty-state copy', () => {
    const view = spectrumStatusView('empty', '')!;
    const html = renderMarkup(view);
    expect(html).toContain('spectrum-empty');
    expect(html).toContain('<p>Load a file to see the spectrum</p>');
  });

  it('empty: reflects a custom panelText (per-mode empty copy)', () => {
    const view = spectrumStatusView('empty', 'Waiting for live audio…')!;
    expect(renderMarkup(view)).toContain('<p>Waiting for live audio…</p>');
  });

  it('error: shows the alert icon, fixed heading, and the sub copy', () => {
    const view = spectrumStatusView('error', 'Disk read failed')!;
    const html = renderMarkup(view);
    expect(html).toContain('Analysis failed');
    expect(html).toContain('Disk read failed');
    expect(html).toContain('color:var(--issue-text)');
  });

  it('loading: shows the analyzing copy, a stage row per ANALYSIS_STAGES entry, and the cancel button', () => {
    const view = spectrumStatusView('loading', '')!;
    const html = renderMarkup(view);
    expect(html).toContain('Analyzing audio…');
    expect(html).toContain('data-stage="reading"');
    expect(html).toContain('data-stage="levels"');
    expect(html).toContain('data-stage="spectrum"');
    expect(html).toContain('Reading file');
    expect(html).toContain('Measuring levels');
    expect(html).toContain('Analyzing spectrum');
    expect(html).toContain('id="analysis-cancel-btn"');
    expect(html).not.toContain('data-icon="x"');
  });

  it('loading: marks only the stages present in stagesDone with the done class', () => {
    const view = spectrumStatusView('loading', '')!;
    const html = renderMarkup(view, ['reading']);
    expect(html).toMatch(/class="stage-row done" data-stage="reading"/);
    expect(html).toMatch(/class="stage-row" data-stage="levels"/);
    expect(html).toMatch(/class="stage-row" data-stage="spectrum"/);
  });
});
