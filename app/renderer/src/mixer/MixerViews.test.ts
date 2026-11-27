// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerToolbar, MixerBoard, MixerBuses, MixerRouting, MixerCalm, SermonQuietPill, MixerSermonBanner } from './MixerViews';
import type { DockTile, ToolbarView } from './view-model';
import type { RoutingView } from './routing';

const TOOLBAR: ToolbarView = {
  chipState: 'connected',
  chipText: 'Connected: X32 · 32 ch',
  showStart: false,
  showReconnect: false,
  counts: { attention: 4, all: 32, buses: 6 },
};

const TILE: DockTile = {
  channel: 5,
  scribble: { number: '05', name: 'Pastor HH', colorClass: 'mx-c-white', inverted: false, icon: 1 },
  queuedSeverity: null,
  level: { available: true, percent: 50, label: '-30.0 dBFS' },
  watched: false,
  dimmed: false,
};

const ROUTING: RoutingView = {
  buses: [
    { index: 1, name: 'IEM1', label: 'Bus 1 · IEM1', ranges: '2 channels · 01–02', read: true, fader: '-3.4 dB', on: true, age: 'read 5 s ago', channels: ['01 Lead Vox', '02 Vox 1'] },
    { index: 2, name: 'Bus 2', label: 'Bus 2', ranges: '0 channels', read: false, fader: '-∞ dB', on: false, age: 'read 1 s ago', channels: [] },
    { index: 3, name: 'Bus 3', label: 'Bus 3', ranges: '0 channels', read: false, fader: null, on: null, age: 'not read yet', channels: [] },
  ],
  sendsRead: 2,
  channelCount: 32,
  coverage: 'Sends read for 2 of 32 channels; the rest arrive on the slow poll.',
};

describe('MixerToolbar', () => {
  it('shows the connection chip and the filter group with real counts', () => {
    const html = renderToString(createElement(MixerToolbar, { toolbar: TOOLBAR, view: 'attention' }));
    expect(html).toContain('mx-conn mx-conn-connected');
    expect(html).toContain('Connected: X32 · 32 ch');
    expect(html).toMatch(/aria-pressed="true" data-view="attention">Needs Attention<span class="mx-seg-n">4<\/span>/);
    expect(html).toContain('All Channels<span class="mx-seg-n">32</span>');
    expect(html).toContain('Buses<span class="mx-seg-n">6</span>');
    expect(html).not.toContain('mixer-reconnect');
    expect(html).not.toContain('mixer-start-watching');
    expect(html).not.toMatch(/kHz|Scene|Section/);
  });

  it('shows Reconnect when offline and Start watching when idle, and slots in extra controls', () => {
    const offline = renderToString(createElement(MixerToolbar, { toolbar: { ...TOOLBAR, chipState: 'offline', chipText: 'Offline: X32', showReconnect: true }, view: 'all' }));
    expect(offline).toContain('mx-conn mx-conn-offline');
    expect(offline).toContain('id="mixer-reconnect"');
    const idle = renderToString(
      createElement(MixerToolbar, { toolbar: { ...TOOLBAR, chipState: 'idle', showStart: true }, view: 'buses' }, createElement('span', { id: 'extra' }))
    );
    expect(idle).toContain('id="mixer-start-watching"');
    expect(idle).toContain('id="extra"');
  });
});

describe('MixerBoard', () => {
  it('renders every tile under its title', () => {
    const html = renderToString(createElement(MixerBoard, { tiles: [TILE, { ...TILE, channel: 6 }], sermonQuiet: false, title: 'All channels · 2' }));
    expect(html).toContain('All channels · 2');
    expect(html.match(/<button type="button" class="mx-tile/g)).toHaveLength(2);
  });
});

describe('MixerBuses and routing', () => {
  it('lists every bus with name, fader, on state, age and the channels sending to it', () => {
    const html = renderToString(createElement(MixerBuses, { routing: ROUTING }));
    expect(html).toContain('IEM1');
    expect(html).toContain('-3.4 dB');
    expect(html).toContain('off · -∞ dB');
    expect(html).toContain('not read yet');
    expect(html).toContain('01 Lead Vox, 02 Vox 1');
    expect(html).toContain('No channels sending');
    expect(html).toContain('Bus meters unavailable');
    expect(html).toContain('class="mx-bus-row mx-bus-off"');
  });

  it('draws the routing overview only for buses with active sends, with the sends coverage', () => {
    const html = renderToString(createElement(MixerRouting, { routing: ROUTING }));
    expect(html.match(/class="mx-route"/g)).toHaveLength(1);
    expect(html).toContain('2 channels · 01–02');
    expect(html).toContain('Bus 1 · IEM1');
    expect(html).toContain('Sends read for 2 of 32 channels');
    const offBus = renderToString(createElement(MixerRouting, { routing: { ...ROUTING, buses: [{ ...ROUTING.buses[0], on: false }] } }));
    expect(offBus).toContain('mx-route-bus mx-bus-off');
  });

  it('says so when no active sends have been read yet', () => {
    expect(renderToString(createElement(MixerRouting, { routing: { ...ROUTING, buses: [] } }))).toContain('No active sends read yet.');
  });
});

describe('MixerCalm', () => {
  it('says no urgent issues detected and lists the running checks', () => {
    const html = renderToString(createElement(MixerCalm, { checks: ['Clipping: watching 32 inputs on the console meters'] }));
    expect(html).toContain('No urgent issues detected');
    expect(html).toContain('<li>Clipping: watching 32 inputs on the console meters</li>');
    expect(html).not.toMatch(/channels clean/i);
  });
});

describe('Sermon Quiet controls', () => {
  it('renders the toolbar pill off and on', () => {
    const off = renderToString(createElement(SermonQuietPill, { on: false }));
    expect(off).toContain('class="mx-sq"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('Sermon Quiet<span');
    const on = renderToString(createElement(SermonQuietPill, { on: true }));
    expect(on).toContain('class="mx-sq mx-sq-on"');
    expect(on).toContain('Sermon Quiet · Feedback only');
  });

  it('renders the gold banner, and its unavailable variant', () => {
    const live = renderToString(createElement(MixerSermonBanner, { banner: { live: true, title: 'Sermon Quiet active — feedback watch only', body: 'b', held: '3 alerts held for later' } }));
    expect(live).toContain('class="mx-sermon"');
    expect(live).toContain('Sermon Quiet active — feedback watch only');
    expect(live).toContain('3 alerts held for later');
    const na = renderToString(createElement(MixerSermonBanner, { banner: { live: false, title: 't', body: 'b', held: 'h' } }));
    expect(na).toContain('class="mx-sermon mx-sermon-na"');
  });
});
