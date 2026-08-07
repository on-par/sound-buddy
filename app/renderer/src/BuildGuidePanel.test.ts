// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import BuildGuidePanel from './BuildGuidePanel';
import { escapeHtml } from './spectrum-display';
const passModeState = require('../pass-mode-state.js');
const buildOrderState = require('../build-order-state.js');

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

function renderMarkup(): string {
  return renderToString(createElement(BuildGuidePanel));
}

beforeEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
  (globalThis as { window?: unknown }).window = {
    passModeState,
    buildOrderState,
    hydrateIcons: () => {},
  };
});

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

describe('BuildGuidePanel', () => {
  it('renders the Rough Pass toggle active by default', () => {
    const html = renderMarkup();
    expect(html).toContain('id="pass-mode-toggle"');
    expect(html).toContain('data-phase="rough"');
    expect(html).toContain('pass-seg active" data-phase="rough"');
  });

  it('renders the persisted phase as active', () => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeStorage({ 'sb-pass-mode-v1': 'contextual' });
    const html = renderMarkup();
    expect(html).toContain('pass-seg active" data-phase="contextual"');
  });

  it('renders the reminder banner for the active phase', () => {
    const html = renderMarkup();
    expect(html).toContain('pass-tagline');
    expect(html).toContain(escapeHtml(passModeState.getPhase('rough').tagline));
  });

  it('renders every build-order step as a checklist row', () => {
    const html = renderMarkup();
    for (const step of buildOrderState.STEPS) {
      expect(html).toContain(`data-step-id="${step.id}"`);
      expect(html).toContain(escapeHtml(step.label));
    }
  });

  it('shows 0/total done with no progress', () => {
    const html = renderMarkup();
    expect(html).toContain(`0/${buildOrderState.STEPS.length} done`);
  });

  it('reflects persisted completed steps in the progress count', () => {
    const firstId = buildOrderState.STEPS[0].id;
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'sb-build-order-v1': JSON.stringify({ completed: [firstId] }),
    });
    const html = renderMarkup();
    expect(html).toContain(`1/${buildOrderState.STEPS.length} done`);
    expect(html).toMatch(new RegExp(`data-step-id="${firstId}"[^>]*class="bg-row bg-done"|class="bg-row bg-done"[^>]*data-step-id="${firstId}"`));
  });

  it('hides the Build Complete moment until every step is done', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="build-complete"[^>]*hidden=""/);
  });

  it('shows the Build Complete moment once every step is done', () => {
    const allIds = buildOrderState.STEPS.map((s: { id: string }) => s.id);
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'sb-build-order-v1': JSON.stringify({ completed: allIds }),
    });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="build-complete"[^>]*hidden=""/);
    expect(html).toContain('build-complete-share');
  });

  it('renders the Reset and Review buttons', () => {
    const html = renderMarkup();
    expect(html).toContain('id="build-guide-reset"');
    expect(html).toContain('Reset');
    expect(html).toContain('id="build-guide-review"');
    expect(html).toContain('Review in Report Card');
  });
});
