// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import PhaseDoublingDialog from './PhaseDoublingDialog';
import { usePhaseDoublingStore } from './stores/phaseDoublingStore';

function renderMarkup(): string {
  return renderToString(createElement(PhaseDoublingDialog));
}

const STEPS = [
  { id: 'symptom', title: 'Confirm the symptom', explanation: 'exp0', resolution: 'res0' },
  { id: 'parallel-bus', title: 'Parallel bus', explanation: 'exp1', resolution: 'res1' },
];

let isLastStep: ReturnType<typeof vi.fn>;

beforeEach(() => {
  isLastStep = vi.fn((i: number) => i >= STEPS.length - 1);
  (globalThis as { window?: unknown }).window = {
    phaseDoublingState: {
      getStep: (i: number) => STEPS[i],
      stepCount: () => STEPS.length,
      isLastStep,
      stepHtml: (step: { title: string }) => `<div class="pd-title">${step.title}</div>`,
      progressDotsHtml: (index: number, total: number) => `<span data-index="${index}" data-total="${total}"></span>`,
      contextLineHtml: (ctx: { filename: string; detected: boolean } | null) =>
        ctx ? `<div class="pd-context">${ctx.filename}</div>` : '',
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  usePhaseDoublingStore.setState({ dialogOpen: false, step: 0, context: null });
});

describe('PhaseDoublingDialog', () => {
  it('is hidden (display:none) when the dialog is closed', () => {
    usePhaseDoublingStore.setState({ dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="phase-doubling-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) when open', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
  });

  it('renders the current step body from window.phaseDoublingState.stepHtml', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, step: 1 });

    const html = renderMarkup();

    expect(html).toContain('Parallel bus');
  });

  it('renders the context line when set', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, context: { filename: 'sunday.wav', detected: true } });

    const html = renderMarkup();

    expect(html).toContain('sunday.wav');
  });

  it('disables Back at step 0', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, step: 0 });

    const html = renderMarkup();

    expect(html).toMatch(/id="phase-doubling-back"[^>]*disabled=""/);
  });

  it('enables Back past step 0', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, step: 1 });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="phase-doubling-back"[^>]*disabled=""/);
  });

  it('hides Next on the last step', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, step: 1 });

    const html = renderMarkup();

    expect(isLastStep).toHaveBeenCalledWith(1);
    expect(html).toMatch(/id="phase-doubling-next"[^>]*style="display:none"/);
  });

  it('shows Next before the last step', () => {
    usePhaseDoublingStore.setState({ dialogOpen: true, step: 0 });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="phase-doubling-next"[^>]*style="display:none"/);
  });
});
