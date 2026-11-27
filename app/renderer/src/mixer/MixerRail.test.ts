// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerRail, RAIL_TITLE, RAIL_BADGE, RAIL_NO_MOVES, RAIL_NO_MOVES_APPLIED, askFromComposer } from './MixerRail';
import type { RailMove, RailView } from './view-model';
import {
  ASSIST_CHIPS,
  BUSY_LINE,
  COMPOSER_OFF_PLACEHOLDER,
  COMPOSER_READY_PLACEHOLDER,
  COMPOSER_UNAVAILABLE_PLACEHOLDER,
  FALLBACK_COPY,
  RULES_FALLBACK_LINE,
  type RailAssistView,
} from './assist-view';
import { createMixerAssistStore } from '../stores/mixerAssistStore';
import { useMixerStore } from '../stores/mixerStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

const MOVE: RailMove = {
  key: 'over-compression:13:comp-ratio',
  scribble: { number: '13', name: 'Bass DI', colorClass: 'mx-c-green', inverted: false, icon: 1 },
  label: 'Over-compression',
  position: '1 of 1',
  param: 'Comp ratio 7.0:1 → 5.0:1',
  why: 'One ratio step gentler.',
  expected: 'Less squeeze.',
  changedOnDesk: false,
};

const RAIL: RailView = { context: 'Reading: X32 channel poll · input meters · room mic not listening', sermonLine: null, advice: [], moves: [], frozen: false };

const ASSIST_OFF: RailAssistView = {
  mode: 'off',
  composerEnabled: false,
  composerPlaceholder: COMPOSER_OFF_PLACEHOLDER,
  chips: [],
  pending: null,
  fallbackLines: [],
  busyLine: null,
  answers: [],
};

const ASSIST_READY: RailAssistView = { ...ASSIST_OFF, mode: 'ready', composerEnabled: true, composerPlaceholder: COMPOSER_READY_PLACEHOLDER, chips: ASSIST_CHIPS };

function composerInput(html: string): string {
  return html.match(/<input type="text" class="mx-composer-input"[^>]*>/)?.[0] ?? '';
}

function render(rail: RailView, assist: RailAssistView = ASSIST_OFF): string {
  return renderToString(createElement(MixerRail, { rail, assist }));
}

describe('MixerRail', () => {
  it('renders the title, a static Suggest & Approve badge with no switch, and the real sources line', () => {
    const html = render(RAIL);
    expect(html).toContain(RAIL_TITLE);
    expect(html).toContain(RAIL_BADGE.replaceAll('&', '&amp;'));
    expect(html).not.toMatch(/role="switch"|type="checkbox"/);
    expect(html).toContain('Reading: X32 channel poll · input meters · room mic not listening');
    expect(html).not.toMatch(/Cloud|Local|coming soon/i);
  });

  it('shows the empty state, the move log with a disabled Undo, and a disabled composer with no quick-prompt chips', () => {
    const html = render(RAIL);
    expect(html).toContain(RAIL_NO_MOVES);
    expect(html).toContain(RAIL_NO_MOVES_APPLIED);
    expect(html).toMatch(/<button type="button" class="btn btn-secondary mx-undo" disabled=""[^>]*>Undo<\/button>/);
    expect(composerInput(html)).toContain('disabled=""');
    expect(composerInput(html)).toContain(`placeholder="${COMPOSER_OFF_PLACEHOLDER}"`);
    expect(html).toMatch(/<button type="submit" class="btn btn-primary mx-composer-ask" disabled="">Ask<\/button>/);
    expect(html).not.toContain('mx-chip');
  });

  it('renders a proposed move with a locked, disabled Apply to Board and a working Dismiss', () => {
    const html = render({ ...RAIL, moves: [MOVE] });
    expect(html).toContain('Comp ratio 7.0:1 → 5.0:1');
    expect(html).toContain('1 of 1');
    expect(html).toMatch(/<button type="button" class="btn btn-primary mx-apply" disabled="" title="Console writes are locked in this build">Apply to Board<\/button>/);
    expect(html).toContain('<span class="mx-locked">Console writes are locked in this build</span>');
    expect(html).toMatch(/<button type="button" class="btn btn-secondary mx-move-dismiss">Dismiss<\/button>/);
    expect(html).not.toContain(RAIL_NO_MOVES);
  });

  it('shows a move the operator changed on the desk as resolved, with no Apply button', () => {
    const html = render({ ...RAIL, moves: [{ ...MOVE, changedOnDesk: true }] });
    expect(html).toContain('Changed on desk');
    expect(html).toContain('mx-move mx-move-done');
    expect(html).not.toContain('mx-apply');
  });

  it('disables move Dismiss while the link is frozen', () => {
    expect(render({ ...RAIL, frozen: true, moves: [MOVE] })).toContain('mx-move-dismiss" disabled=""');
    expect(render({ ...RAIL, frozen: true, moves: [{ ...MOVE, changedOnDesk: true }] })).toContain('mx-move-dismiss" disabled=""');
  });

  it('renders advice entries and the Sermon Quiet line', () => {
    const html = render({ ...RAIL, sermonLine: 'Only feedback risk will interrupt · 3 held', advice: [{ key: 'clipping:1', severity: 'issue', text: '01 Lead Vox: lower the input gain' }] });
    expect(html).toContain('Only feedback risk will interrupt · 3 held');
    expect(html).toContain('class="mx-advice mx-sev-issue"');
    expect(html).toContain('01 Lead Vox: lower the input gain');
  });
});

describe('MixerRail assist', () => {
  it('healthy: the composer and Ask are enabled and the quick chips appear', () => {
    const html = render(RAIL, ASSIST_READY);
    expect(composerInput(html)).not.toContain('disabled');
    expect(composerInput(html)).toContain('placeholder="Ask about the mix…"');
    expect(html).toMatch(/<button type="submit" class="btn btn-primary mx-composer-ask">Ask<\/button>/);
    for (const chip of ASSIST_CHIPS) expect(html).toContain(`>${chip}</button>`);
    expect(html.match(/class="mx-chip"/g)).toHaveLength(ASSIST_CHIPS.length);
  });

  it('answers render as plain text labelled with their source', () => {
    const html = render(RAIL, {
      ...ASSIST_READY,
      answers: [{ id: 1, sourceLabel: 'Cloud · Claude Code', text: '<script>x</script> Lower 02.', about: 'About 02 Vox 1' }],
    });
    expect(html).toContain('<span class="pill sm mx-answer-src">Cloud · Claude Code</span>');
    expect(html).toContain('About 02 Vox 1');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; Lower 02.');
    expect(html).not.toContain('<script>');
  });

  it('in flight: the pending line and a Cancel button', () => {
    const html = render(RAIL, { ...ASSIST_READY, pending: 'Asking: What next?' });
    expect(html).toContain('Asking: What next?');
    expect(html).toContain('id="mixer-assist-cancel"');
    expect(render(RAIL, ASSIST_READY)).not.toContain('mixer-assist-cancel');
  });

  it('each fallback reason has its own line, with Check again', () => {
    const html = render(RAIL, {
      ...ASSIST_OFF,
      mode: 'unavailable',
      composerPlaceholder: COMPOSER_UNAVAILABLE_PLACEHOLDER,
      fallbackLines: [
        { key: 'cloud:no-binary', text: FALLBACK_COPY.cloud['no-binary'] as string },
        { key: 'rules', text: RULES_FALLBACK_LINE },
      ],
    });
    expect(html).toContain('data-reason="cloud:no-binary"');
    expect(html).toContain('data-reason="rules"');
    expect(html).toContain('id="mixer-assist-recheck"');
    expect(composerInput(html)).toContain('disabled=""');
    expect(render(RAIL, ASSIST_OFF)).not.toContain('mixer-assist-recheck');
  });

  it('busy gets its own line', () => {
    expect(render(RAIL, { ...ASSIST_READY, busyLine: BUSY_LINE })).toContain(`id="mixer-assist-busy" role="status">${BUSY_LINE}</p>`);
  });

  it('assist answers never appear as or inside a proposed move', () => {
    const html = render({ ...RAIL, moves: [MOVE] }, { ...ASSIST_READY, answers: [{ id: 1, sourceLabel: 'Local · m', text: 'Set the ratio to 2:1.', about: 'q' }] });
    const moveBlock = html.slice(html.indexOf('data-move-key'), html.indexOf('</div></div>', html.indexOf('data-move-key')));
    expect(moveBlock).not.toContain('Set the ratio to 2:1.');
    expect(html.match(/data-move-key/g)).toHaveLength(1);
  });
});

describe('askFromComposer', () => {
  afterEach(() => {
    useMixerStore.setState({ moves: {} });
  });

  function event(value: string | null) {
    const input = value === null ? null : { value };
    let prevented = 0;
    return {
      input,
      prevented: () => prevented,
      e: { preventDefault: () => (prevented += 1), currentTarget: { closest: () => ({ querySelector: () => input }) } },
    };
  }

  it('stops the form submit, sends the typed question, clears the input, and never touches proposed moves', async () => {
    const bridge = createMockSoundBuddy();
    const store = createMixerAssistStore({ getApi: () => bridge.api, context: () => ({ channels: [], meters: [], visible: [], issues: [], inspected: null, sermonQuiet: false }), labelFor: () => '' });
    const ev = event('  What is loudest?  ');
    const movesBefore = useMixerStore.getState().moves;
    await askFromComposer(ev.e, store);
    expect(ev.prevented()).toBe(1);
    expect(ev.input?.value).toBe('');
    expect(bridge.calls.filter((c) => c.method === 'askMixerAssist').map((c) => (c.args[0] as { question: string }).question)).toEqual(['What is loudest?']);
    expect(useMixerStore.getState().moves).toBe(movesBefore);
  });

  it('does nothing without an input', async () => {
    const bridge = createMockSoundBuddy();
    const store = createMixerAssistStore({ getApi: () => bridge.api, context: () => ({ channels: [], meters: [], visible: [], issues: [], inspected: null, sermonQuiet: false }), labelFor: () => '' });
    const ev = event(null);
    await askFromComposer(ev.e, store);
    expect(ev.prevented()).toBe(1);
    expect(bridge.calls.filter((c) => c.method === 'askMixerAssist')).toEqual([]);
  });
});
