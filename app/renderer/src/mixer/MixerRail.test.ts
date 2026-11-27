// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerRail, RAIL_TITLE, RAIL_BADGE, RAIL_NO_MOVES, RAIL_NO_MOVES_APPLIED, RAIL_COMPOSER } from './MixerRail';
import type { RailMove, RailView } from './view-model';

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

function render(rail: RailView): string {
  return renderToString(createElement(MixerRail, { rail }));
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
    expect(html).toMatch(/<input type="text" class="mx-composer-input" disabled=""[^>]*placeholder="Rules only in this build"/);
    expect(html).toContain(RAIL_COMPOSER);
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
