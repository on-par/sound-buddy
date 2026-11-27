// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerDock, MixerTile } from './MixerDock';
import type { DockTile, DockView } from './view-model';

const TILE: DockTile = {
  channel: 14,
  scribble: { number: '14', name: 'Ac Gtr', colorClass: 'mx-c-cyan', inverted: false, icon: 1 },
  queuedSeverity: 'info',
  level: { available: true, percent: 35, label: '-21.0 dBFS' },
  watched: false,
  dimmed: false,
};

const DOCK: DockView = {
  header: '19 channels · 1 queued',
  tiles: [TILE, { ...TILE, channel: 2, queuedSeverity: null, level: { available: false, percent: 0, label: 'Meters unavailable' } }],
  buses: [
    { index: 1, name: 'Vox Bus', label: 'Bus 1 · Vox Bus', fader: '-2.0 dB', on: true, age: 'read 4 s ago' },
    { index: 2, name: 'Band', label: 'Bus 2 · Band', fader: '-1.0 dB', on: false, age: 'read 1 s ago' },
  ],
  busMeters: 'Bus meters unavailable',
  mainLufs: 'Main LUFS unavailable',
};

describe('MixerDock', () => {
  it('renders the header, queued tile tinted by severity first, buses from /node and the unavailable meter slots', () => {
    const html = renderToString(createElement(MixerDock, { dock: DOCK, sermonQuiet: false }));
    expect(html).toContain('19 channels · 1 queued');
    expect(html.indexOf('data-channel="14"')).toBeLessThan(html.indexOf('data-channel="2"'));
    expect(html).toContain('mx-tile mx-tile-q mx-sev-info');
    expect(html).toContain('width:35%');
    expect(html).toContain('Bus 1 · Vox Bus <b>-2.0 dB</b> <span class="mx-bus-age">read 4 s ago</span>');
    expect(html).toContain('class="mx-bus mx-bus-off"');
    expect(html).toContain('Bus 2 · Band <b>off</b> <span class="mx-bus-age">read 1 s ago</span>');
    expect(html).not.toContain('title="read');
    expect(html).toContain('Bus meters unavailable');
    expect(html).toContain('Main LUFS unavailable');
    expect(html).toContain('title="Inspect this channel"');
  });
});

describe('MixerTile in Sermon Quiet', () => {
  it('marks the watched mic and dims the others, as a watch picker', () => {
    const watched = renderToString(createElement(MixerTile, { tile: { ...TILE, queuedSeverity: null, watched: true }, sermonQuiet: true }));
    expect(watched).toContain('mx-tile-watch');
    expect(watched).toContain('WATCH');
    expect(watched).toContain('aria-pressed="true"');
    expect(watched).toContain('title="Watch this mic for feedback"');
    const dimmed = renderToString(createElement(MixerTile, { tile: { ...TILE, queuedSeverity: null, dimmed: true }, sermonQuiet: true }));
    expect(dimmed).toContain('class="mx-tile mx-tile-dim"');
    expect(dimmed).toContain('aria-pressed="false"');
  });
});
