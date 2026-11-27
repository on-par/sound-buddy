// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerCard, MixerScribble } from './MixerCard';
import type { CardView } from './view-model';

const BASE: CardView = {
  key: 'clipping:1',
  kind: 'clipping',
  channel: 1,
  scribble: { number: '01', name: 'Lead Vox', colorClass: 'mx-c-yellow', inverted: false, icon: 1 },
  severity: 'issue',
  pillLabel: 'Issue · Clipping',
  age: '0:40',
  diagnosis: 'Input is hitting digital full scale (peak +2.9 dBFS)',
  fader: { label: '-6.5 dB', percent: 62 },
  level: { available: true, percent: 80, label: '-1.0 dBFS' },
  grLabel: 'GR unavailable',
  facts: [
    { label: 'Peak level', value: '+2.9 dBFS', tone: 'issue' },
    { label: 'Comp', value: 'Off', tone: null },
    { label: 'Fader trend', value: 'Steady over 0:10', tone: null },
  ],
  sends: 'Sends to: Vox Bus · read 12 s ago',
  share: 'Share of mix unavailable',
  candidates: [],
  inspected: true,
};

function render(card: CardView, frozen = false): string {
  return renderToString(createElement(MixerCard, { card, frozen }));
}

describe('MixerScribble', () => {
  it('renders number, name, colour class and desk icon', () => {
    const html = renderToString(createElement(MixerScribble, { scribble: BASE.scribble! }));
    expect(html).toContain('class="mx-scrib mx-c-yellow"');
    expect(html).toContain('>01<');
    expect(html).toContain('>Lead Vox<');
    expect(html).toContain('title="Desk icon 1"');
  });

  it('marks inverted and small strips and omits a missing icon', () => {
    const html = renderToString(createElement(MixerScribble, { scribble: { ...BASE.scribble!, inverted: true, icon: null }, small: true }));
    expect(html).toContain('class="mx-scrib mx-c-yellow mx-inv mx-scrib-sm"');
    expect(html).not.toContain('Desk icon');
  });
});

describe('MixerCard', () => {
  it('renders the scribble strip, severity pill, time active, diagnosis, meters, facts, sends and the share slot', () => {
    const html = render(BASE);
    expect(html).toContain('INSPECTING');
    expect(html).toContain('mx-card-sel');
    expect(html).toContain('pill sm issue');
    expect(html).toContain('Issue · Clipping');
    expect(html).toContain('>0:40<');
    expect(html).toContain('Input is hitting digital full scale (peak +2.9 dBFS)');
    expect(html).toContain('bottom:62%');
    expect(html).toContain('height:80%');
    expect(html).toContain('GR unavailable');
    expect(html).toContain('mx-fact-v mx-tone-issue');
    expect(html).toContain('Sends to: Vox Bus · read 12 s ago');
    expect(html).toContain('Share of mix unavailable');
    expect(html).not.toContain('candidates, not confirmed');
  });

  it('shows the unavailable meter label and no level bar when meters are degraded, and a dash fader when unread', () => {
    const html = render({ ...BASE, fader: null, level: { available: false, percent: 0, label: 'Meters unavailable' }, inspected: false });
    expect(html).toContain('Meters unavailable');
    expect(html).toContain('Fader not read yet');
    expect(html).not.toContain('mx-fdr-cap');
    expect(html).not.toContain('INSPECTING');
    expect(html).toContain('mx-lv mx-na');
  });

  it('renders a room card with no scribble or meters, the candidate mics, and no sends line', () => {
    const html = render({ ...BASE, key: 'feedback-risk:room', kind: 'feedback-risk', channel: null, scribble: null, sends: '', share: '', candidates: ['01 Lead Vox', '05 Pastor'], inspected: false });
    expect(html).toContain('mx-c-room');
    expect(html).not.toContain('Share of mix unavailable');
    expect(html).not.toContain('mx-unavailable');
    expect(html).not.toContain('mx-meters');
    expect(html).toContain('Open channels (candidates, not confirmed): 01 Lead Vox, 05 Pastor');
    expect(html).not.toContain('mx-card-sends');
  });

  it('disables Dismiss while the card is frozen', () => {
    expect(render(BASE, true)).toMatch(/<button type="button" class="btn btn-ghost mx-card-dismiss" disabled="">Dismiss<\/button>/);
    expect(render(BASE, false)).toMatch(/<button type="button" class="btn btn-ghost mx-card-dismiss">Dismiss<\/button>/);
  });
});
