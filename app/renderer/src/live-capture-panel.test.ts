// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  LIVE_BAND_KEYS,
  VEQ_FREQS,
  DEFAULT_DEVICE_CHANNELS,
  deviceOptionLabel,
  deviceListView,
  deviceChannelCount,
  usedChannelCount,
  channelOptions,
  liveBandCurve,
  veqChannelHTML,
  liveMetersHTML,
  type LiveDevice,
  type ListDevicesResult,
  type StripConfig,
  type ChannelGroup,
  type LiveMeterChannel,
  type StripView,
  type PanelView,
} from './live-capture-panel';

const devices: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 18, default_sr: 48000 },
  { index: 1, name: 'Built-in Microphone', channels: 2, default_sr: 44100 },
];

function stripView(overrides: Partial<StripView> = {}): StripView {
  return {
    strip: { kind: 'mono', a: 0, b: 1 },
    displayName: 'Ch 1',
    collapsed: false,
    armed: false,
    groupIndex: -1,
    ...overrides,
  };
}

function panelView(overrides: Partial<PanelView> = {}): PanelView {
  return {
    deviceChannels: 8,
    liveRunning: false,
    liveMode: 'monitor',
    groups: [],
    ...overrides,
  };
}

const LIVE_CHANNELS: LiveMeterChannel[] = [
  { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

describe('deviceOptionLabel', () => {
  it('formats index, name, channel count, and sample rate', () => {
    expect(deviceOptionLabel({ index: 0, name: 'Scarlett 18i20', channels: 18, default_sr: 48000 }))
      .toBe('0: Scarlett 18i20 (18ch, 48000Hz)');
  });
});

describe('deviceListView', () => {
  it('blocks with a System Settings hint when mic access is denied', () => {
    const result: ListDevicesResult = { success: true, micAccess: 'denied', devices };
    const view = deviceListView(result);
    expect(view.devices).toEqual([]);
    expect(view.options).toEqual([{ value: '', label: 'Microphone access blocked' }]);
    expect(view.hint).toEqual({ text: expect.stringContaining('System Settings'), isError: true });
  });

  it('blocks the same way when mic access is restricted', () => {
    const view = deviceListView({ success: true, micAccess: 'restricted' });
    expect(view.options[0].label).toBe('Microphone access blocked');
    expect(view.hint?.isError).toBe(true);
  });

  it('surfaces the backend error when enumeration fails', () => {
    const view = deviceListView({ success: false, error: 'boom' });
    expect(view.options).toEqual([{ value: '', label: 'Could not list devices' }]);
    expect(view.hint).toEqual({ text: 'boom', isError: true });
  });

  it('falls back to a generic message when success:false carries no error', () => {
    const view = deviceListView({ success: false });
    expect(view.hint?.text).toBe('Failed to enumerate input devices.');
  });

  it('shows a non-error hint when the device list is empty', () => {
    const view = deviceListView({ success: true, devices: [] });
    expect(view.options).toEqual([{ value: '', label: 'No input devices found' }]);
    expect(view.hint?.isError).toBe(false);
  });

  it('lists Default Device first, then a labeled option per device, on the happy path', () => {
    const view = deviceListView({ success: true, micAccess: 'granted', devices });
    expect(view.devices).toBe(devices);
    expect(view.options).toEqual([
      { value: '', label: 'Default Device' },
      { value: '0', label: '0: Scarlett 18i20 (18ch, 48000Hz)' },
      { value: '1', label: '1: Built-in Microphone (2ch, 44100Hz)' },
    ]);
    expect(view.hint).toBeNull();
  });

  it('hints at the macOS permission prompt when access is not-determined', () => {
    const view = deviceListView({ success: true, micAccess: 'not-determined', devices });
    expect(view.hint).toEqual({ text: expect.stringContaining('macOS will ask'), isError: false });
  });
});

describe('deviceChannelCount', () => {
  it('resolves the default device to the max channel count across devices', () => {
    expect(deviceChannelCount('', devices)).toBe(18);
  });

  it('falls back to DEFAULT_DEVICE_CHANNELS for the default device with no devices', () => {
    expect(deviceChannelCount('', [])).toBe(DEFAULT_DEVICE_CHANNELS);
  });

  it('falls back to DEFAULT_DEVICE_CHANNELS for the default device when every device reports 0 channels', () => {
    expect(deviceChannelCount('', [{ index: 0, name: 'Weird', channels: 0, default_sr: 48000 }])).toBe(DEFAULT_DEVICE_CHANNELS);
  });

  it('resolves a matching device index to its channel count', () => {
    expect(deviceChannelCount('1', devices)).toBe(2);
  });

  it('falls back to DEFAULT_DEVICE_CHANNELS for an unknown value', () => {
    expect(deviceChannelCount('99', devices)).toBe(DEFAULT_DEVICE_CHANNELS);
  });
});

describe('usedChannelCount', () => {
  it('sums mono strips as 1 and stereo strips as 2', () => {
    const config: StripConfig[] = [{ kind: 'mono', a: 0, b: 1 }, { kind: 'stereo', a: 2, b: 3 }, { kind: 'mono', a: 4, b: 5 }];
    expect(usedChannelCount(config)).toBe(4);
  });

  it('is 0 for an empty config', () => {
    expect(usedChannelCount([])).toBe(0);
  });
});

describe('channelOptions', () => {
  it('renders "Ch N" labels bounded by max, with the selected option marked', () => {
    const html = channelOptions(1, 3);
    expect(html).toBe(
      '<option value="0">Ch 1</option>'
      + '<option value="1" selected>Ch 2</option>'
      + '<option value="2">Ch 3</option>',
    );
  });

  it('renders compact numeric labels when compact is true', () => {
    const html = channelOptions(0, 2, true);
    expect(html).toBe('<option value="0" selected>1</option><option value="1">2</option>');
  });
});

describe('liveBandCurve', () => {
  it('maps the 7 snake_case band keys in order onto VEQ_FREQS', () => {
    const bands: Record<string, number> = {
      sub_bass: -10, bass: -20, low_mid: -30, mid: -40, high_mid: -50, presence: -60, brilliance: -70,
    };
    const curve = liveBandCurve(bands);
    expect(curve.freqs).toBe(VEQ_FREQS);
    expect(curve.db).toEqual(LIVE_BAND_KEYS.map((k) => bands[k]));
  });

  it('floors a missing or non-finite band to -120', () => {
    const curve = liveBandCurve({ sub_bass: NaN, bass: -20, low_mid: -30, mid: -40, high_mid: -50, presence: -60 });
    expect(curve.db[0]).toBe(-120); // NaN
    expect(curve.db[6]).toBe(-120); // missing (brilliance)
  });
});

describe('veqChannelHTML', () => {
  it('renders one source select (no leg selects) for a mono strip', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ strip: { kind: 'mono', a: 2, b: 3 } }), panelView());
    expect((html.match(/live-ch-src/g) || []).length).toBe(1);
    expect(html).not.toContain('live-ch-src leg');
    expect(html).toContain('data-ch="0"');
  });

  it('defaults the source select to channel 0 when the strip is unconfigured', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ strip: null }), panelView());
    expect(html).toContain('<option value="0" selected>Ch 1</option>');
  });

  it('renders a stereo kind select and two leg selects for a stereo strip', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ strip: { kind: 'stereo', a: 2, b: 3 } }), panelView());
    expect(html).toContain('<option value="stereo" selected>Stereo</option>');
    expect((html.match(/live-ch-src leg/g) || []).length).toBe(2);
  });

  it('disables kind/src/remove controls when the panel is live-running', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView({ liveRunning: true }));
    expect(html).toContain('live-ch-kind" data-idx="0" aria-label="Mono or stereo" disabled');
    expect(html).toContain('live-ch-x" title="Remove track" aria-label="Remove track" disabled');
  });

  it('renders an arm button with correct aria-pressed/label in record mode, none in monitor mode', () => {
    const armed = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ armed: true }), panelView({ liveMode: 'record' }));
    expect(armed).toContain('live-ch-arm');
    expect(armed).toContain('aria-pressed="true"');
    expect(armed).toContain('Disarm track for recording');

    const disarmed = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ armed: false }), panelView({ liveMode: 'record' }));
    expect(disarmed).toContain('aria-pressed="false"');
    expect(disarmed).toContain('Arm track for recording');

    const armedRunning = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ armed: true }), panelView({ liveMode: 'record', liveRunning: true }));
    expect(armedRunning).toContain('live-ch-arm" data-idx="0" aria-pressed="true" aria-label="Disarm track for recording" title="Armed for recording — click to disarm" disabled');

    const monitor = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView({ liveMode: 'monitor' }));
    expect(monitor).not.toContain('live-ch-arm');
  });

  it('adds a clip class and CLIP badge when the channel is clipping', () => {
    const html = veqChannelHTML({ ...LIVE_CHANNELS[0], clipping: true }, 0, stripView(), panelView());
    expect(html).toContain('live-ch-name clip');
    expect(html).toContain('<span class="live-ch-clip">CLIP</span>');
  });

  it('shows Idle meta for idle channels, RMS/Peak otherwise', () => {
    const idle = veqChannelHTML({ ...LIVE_CHANNELS[0], idle: true }, 0, stripView(), panelView());
    expect(idle).toContain('live-ch idle');
    expect(idle).toContain('<span class="live-ch-meta">Idle</span>');

    const live = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView());
    expect(live).toContain('RMS -18.0 · Peak -6.0 dBFS');
  });

  it('adds the collapsed class and aria-expanded=false when collapsed', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ collapsed: true }), panelView());
    expect(html).toContain('live-ch collapsed');
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders a group select with the strip\'s group selected when groups exist, omits it otherwise', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0] }, { name: 'Vox', members: [] }];
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: 0 }), panelView({ groups }));
    expect(html).toContain('live-ch-group');
    expect(html).toContain('<option value="0" selected>Drums</option>');

    const noGroups = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView());
    expect(noGroups).not.toContain('live-ch-group');
  });

  it('stamps data-ch with the channel index', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[1], 3, stripView(), panelView());
    expect(html).toContain('data-ch="3"');
  });
});

describe('liveMetersHTML', () => {
  it('renders strips in order with no group headers when there are no groups', () => {
    const stripViews = LIVE_CHANNELS.map(() => stripView());
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView());
    expect(html).not.toContain('live-group-head');
    expect(html.indexOf('data-ch="0"')).toBeLessThan(html.indexOf('data-ch="1"'));
  });

  it('renders a header per group with escaped names, members under it, and leftovers as Ungrouped', () => {
    const groups: ChannelGroup[] = [{ name: '<b>Drums</b>', members: [1] }, { name: 'Empty', members: [] }];
    const stripViews = LIVE_CHANNELS.map((_, i) => stripView({ groupIndex: i === 1 ? 0 : -1 }));
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups }));

    expect(html).toContain('&lt;b&gt;Drums&lt;/b&gt;');
    expect(html).not.toContain('<b>Drums</b>');
    expect(html).toContain('No strips assigned');
    expect(html).toContain('Ungrouped');
    // Group member (idx 1) renders before the trailing ungrouped strip (idx 0).
    expect(html.indexOf('data-ch="1"')).toBeLessThan(html.indexOf('data-ch="0"'));
  });

  it('disables group rename/delete when liveRunning', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0] }];
    const stripViews = LIVE_CHANNELS.map(() => stripView());
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups, liveRunning: true }));
    expect(html).toContain('live-group-rename" aria-label="Rename group" title="Rename group" disabled');
    expect(html).toContain('live-group-del" aria-label="Delete group" title="Delete group" disabled');
  });

  it('is composed of the exact veqChannelHTML output for each channel (markup-identity guard)', () => {
    const stripViews = LIVE_CHANNELS.map((ch) => stripView({ displayName: ch.name }));
    const panel = panelView();
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panel);
    LIVE_CHANNELS.forEach((ch, i) => {
      expect(html).toContain(veqChannelHTML(ch, i, stripViews[i], panel));
    });
  });
});
