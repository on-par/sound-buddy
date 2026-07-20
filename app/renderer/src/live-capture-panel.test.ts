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
  liveReportCardSource,
  liveChannelContributors,
  patchLiveChannelPlan,
  groupSummary,
  groupSummaryText,
  shouldOfferReportCard,
  normalizeMeasurementSource,
  measurementSourceAfterRemove,
  measurementSourceOptionLabel,
  measurementSourceOptionsHTML,
  measurementChannel,
  measurementSourceBadgeText,
  type LiveDevice,
  type ListDevicesResult,
  type StripConfig,
  type ChannelGroup,
  type LiveMeterChannel,
  type StripView,
  type PanelView,
  type LiveEvent,
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
    groupCollapsed: false,
    instrumentProfileId: 'generic',
    instrumentAuto: true,
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

  it('adds the group-collapsed class when the owning group is collapsed', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: 0, groupCollapsed: true }), panelView());
    expect(/class="live-ch[^"]*\bgroup-collapsed\b[^"]*"/.test(html)).toBe(true);
  });

  it('omits the group-collapsed class when not in a collapsed group', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: 0, groupCollapsed: false }), panelView());
    expect(html).not.toContain('group-collapsed');
  });

  it('renders a drag handle for a grouped strip, absent for an ungrouped one', () => {
    const grouped = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: 0 }), panelView());
    expect(grouped).toContain('live-ch-drag');
    expect(grouped).toContain('draggable="true"');
    expect(grouped).toContain('Reorder track within group');

    const ungrouped = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: -1 }), panelView());
    expect(ungrouped).not.toContain('live-ch-drag');
  });

  it('disables the strip drag handle when liveRunning', () => {
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ groupIndex: 0 }), panelView({ liveRunning: true }));
    expect(html).toContain('live-ch-drag" draggable="true" aria-label="Reorder track within group — drag, or press Arrow Up/Down" title="Drag to reorder track" disabled');
  });

  it('renders an instrument-profile select with an Auto option selected when instrumentAuto is true', () => {
    const profiles = [{ id: 'bass', label: 'Bass' }, { id: 'vocal', label: 'Vocal' }];
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ instrumentProfileId: 'bass', instrumentAuto: true }), panelView({ instrumentProfiles: profiles }));
    expect(html).toContain('class="live-ch-profile"');
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('<option value="auto" selected>Auto — Bass</option>');
    expect(html).toContain('<option value="bass">Bass</option>');
    expect(html).toContain('<option value="vocal">Vocal</option>');
  });

  it('selects the override option instead of Auto when instrumentAuto is false', () => {
    const profiles = [{ id: 'bass', label: 'Bass' }, { id: 'vocal', label: 'Vocal' }];
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView({ instrumentProfileId: 'vocal', instrumentAuto: false }), panelView({ instrumentProfiles: profiles }));
    expect(html).toContain('<option value="auto">Auto — Vocal</option>');
    expect(html).toContain('<option value="vocal" selected>Vocal</option>');
    expect(html).toContain('<option value="bass">Bass</option>');
  });

  it('disables the instrument-profile select when liveRunning', () => {
    const profiles = [{ id: 'bass', label: 'Bass' }];
    const html = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView({ instrumentProfiles: profiles, liveRunning: true }));
    expect(html).toContain('live-ch-profile" data-idx="0" aria-label="Instrument profile" title="Instrument profile" disabled');
  });

  it('omits the instrument-profile select when panel.instrumentProfiles is absent or empty', () => {
    const absent = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView());
    expect(absent).not.toContain('live-ch-profile');

    const empty = veqChannelHTML(LIVE_CHANNELS[0], 0, stripView(), panelView({ instrumentProfiles: [] }));
    expect(empty).not.toContain('live-ch-profile');
  });
});

describe('groupSummary', () => {
  it('counts present members, finds max peak, and flags clipping', () => {
    const s = groupSummary(LIVE_CHANNELS, [0, 1]);
    expect(s.count).toBe(2);
    expect(s.peak).toBe(-6); // max of -6, -9
    expect(s.clipping).toBe(false);
    expect(s.idle).toBe(false);
  });

  it('flags clipping when any member is clipping', () => {
    const channels = [{ ...LIVE_CHANNELS[0], clipping: true }, LIVE_CHANNELS[1]];
    expect(groupSummary(channels, [0, 1]).clipping).toBe(true);
  });

  it('is idle only when every present member is idle', () => {
    const channels = [{ ...LIVE_CHANNELS[0], idle: true }, { ...LIVE_CHANNELS[1], idle: true }];
    expect(groupSummary(channels, [0, 1]).idle).toBe(true);
    const mixed = [{ ...LIVE_CHANNELS[0], idle: true }, LIVE_CHANNELS[1]];
    expect(groupSummary(mixed, [0, 1]).idle).toBe(false);
  });

  it('excludes out-of-range members from the count', () => {
    const s = groupSummary(LIVE_CHANNELS, [0, 99]);
    expect(s.count).toBe(1);
  });

  it('is idle with a null peak for an empty member list', () => {
    const s = groupSummary(LIVE_CHANNELS, []);
    expect(s.count).toBe(0);
    expect(s.peak).toBeNull();
    expect(s.idle).toBe(true);
  });

  it('floors non-finite peaks to null (no crash on NaN)', () => {
    const channels = [{ ...LIVE_CHANNELS[0], peak: NaN }];
    const s = groupSummary(channels, [0]);
    expect(s.peak).toBeNull();
  });
});

describe('groupSummaryText', () => {
  it('uses singular "track" for a count of 1', () => {
    expect(groupSummaryText({ count: 1, peak: null, clipping: false, idle: true })).toBe('1 track');
  });

  it('uses plural "tracks" otherwise', () => {
    expect(groupSummaryText({ count: 3, peak: null, clipping: false, idle: true })).toBe('3 tracks');
    expect(groupSummaryText({ count: 0, peak: null, clipping: false, idle: true })).toBe('0 tracks');
  });

  it('appends the peak when not idle', () => {
    expect(groupSummaryText({ count: 3, peak: -6.2, clipping: false, idle: false })).toBe('3 tracks · Peak -6.2 dBFS');
  });

  it('omits the peak while idle even if a peak value is present', () => {
    expect(groupSummaryText({ count: 3, peak: -6.2, clipping: false, idle: true })).toBe('3 tracks');
  });
});

describe('shouldOfferReportCard (#488)', () => {
  it('offers after a monitor session that accumulated windows', () => {
    expect(shouldOfferReportCard('monitor', 1)).toBe(true);
    expect(shouldOfferReportCard('monitor', 10)).toBe(true);
  });
  it('does not offer when no window tick ever arrived', () => {
    expect(shouldOfferReportCard('monitor', 0)).toBe(false);
  });
  it('does not offer for record mode (it has its own session-saved offer)', () => {
    expect(shouldOfferReportCard('record', 5)).toBe(false);
    expect(shouldOfferReportCard('record', 0)).toBe(false);
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

  it('marks a collapsed group header with .collapsed, aria-expanded=false, and a visible summary', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0, 1], collapsed: true }];
    const stripViews = LIVE_CHANNELS.map(() => stripView({ groupIndex: 0, groupCollapsed: true }));
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups }));
    expect(html).toMatch(/<div class="live-group-head collapsed" data-group="0">/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('live-group-summary');
    expect(html).toContain('2 tracks');
  });

  it('does not mark an expanded group header collapsed, and aria-expanded is true', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0] }];
    const stripViews = LIVE_CHANNELS.map(() => stripView({ groupIndex: 0, groupCollapsed: false }));
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups }));
    expect(html).toMatch(/<div class="live-group-head" data-group="0">/);
    expect(html).toContain('aria-expanded="true"');
  });

  it('renders a group drag handle, disabled while liveRunning', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0] }];
    const stripViews = LIVE_CHANNELS.map(() => stripView({ groupIndex: 0 }));
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups, liveRunning: true }));
    expect(html).toContain('live-group-drag" draggable="true" aria-label="Reorder group — drag, or press Arrow Up/Down" title="Drag to reorder group" disabled');
  });

  it('shows a CLIP badge on the group summary when a member is clipping', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0, 1] }];
    const stripViews = LIVE_CHANNELS.map(() => stripView({ groupIndex: 0 }));
    const channels = [{ ...LIVE_CHANNELS[0], clipping: true }, LIVE_CHANNELS[1]];
    const html = liveMetersHTML(channels, stripViews, panelView({ groups }));
    expect(html).toContain('live-group-summary');
    expect(html).toMatch(/live-group-summary">[^<]*<span class="live-ch-clip">CLIP<\/span>/);
  });

  it('excludes out-of-range members from the summary count', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [0, 1, 99] }];
    const stripViews = LIVE_CHANNELS.map(() => stripView({ groupIndex: 0 }));
    const html = liveMetersHTML(LIVE_CHANNELS, stripViews, panelView({ groups }));
    expect(html).toContain('2 tracks');
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

describe('normalizeMeasurementSource', () => {
  it('passes through a valid index', () => {
    expect(normalizeMeasurementSource(1, 3)).toBe(1);
  });

  it('normalizes null to null', () => {
    expect(normalizeMeasurementSource(null, 3)).toBeNull();
  });

  it('normalizes undefined to null', () => {
    expect(normalizeMeasurementSource(undefined, 3)).toBeNull();
  });

  it('normalizes a negative index to null', () => {
    expect(normalizeMeasurementSource(-1, 3)).toBeNull();
  });

  it('normalizes an index equal to stripCount to null', () => {
    expect(normalizeMeasurementSource(3, 3)).toBeNull();
  });

  it('normalizes a non-integer index to null', () => {
    expect(normalizeMeasurementSource(1.5, 3)).toBeNull();
  });

  it('normalizes NaN to null', () => {
    expect(normalizeMeasurementSource(NaN, 3)).toBeNull();
  });

  it('normalizes 0 with a stripCount of 0 to null', () => {
    expect(normalizeMeasurementSource(0, 0)).toBeNull();
  });
});

describe('measurementSourceAfterRemove', () => {
  it('leaves a null selection as null', () => {
    expect(measurementSourceAfterRemove(null, 1)).toBeNull();
  });

  it('resets the selection to null when the selected strip is removed', () => {
    expect(measurementSourceAfterRemove(2, 2)).toBeNull();
  });

  it('shifts the selection down by 1 when a lower strip is removed', () => {
    expect(measurementSourceAfterRemove(2, 0)).toBe(1);
  });

  it('leaves the selection unchanged when a higher strip is removed', () => {
    expect(measurementSourceAfterRemove(1, 2)).toBe(1);
  });
});

describe('measurementSourceOptionLabel', () => {
  it('uses the trimmed strip label when present', () => {
    expect(measurementSourceOptionLabel({ kind: 'mono', a: 0, b: 1, label: '  Kick  ' }, 0)).toBe('Kick');
  });

  it('falls back to "Track N" when the label is missing', () => {
    expect(measurementSourceOptionLabel({ kind: 'mono', a: 0, b: 1 }, 2)).toBe('Track 3');
  });

  it('falls back to "Track N" when the label is blank', () => {
    expect(measurementSourceOptionLabel({ kind: 'mono', a: 0, b: 1, label: '   ' }, 0)).toBe('Track 1');
  });

  it('falls back to "Track N" for a null strip', () => {
    expect(measurementSourceOptionLabel(null, 4)).toBe('Track 5');
  });
});

describe('measurementSourceOptionsHTML', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2 },
  ];

  it('renders the default option first, selected when source is null', () => {
    const html = measurementSourceOptionsHTML(config, null);
    expect(html.startsWith('<option value="" selected>First track (default)</option>')).toBe(true);
  });

  it('renders one option per strip with the correct value, label, and selected state', () => {
    const html = measurementSourceOptionsHTML(config, 1);
    expect(html).toContain('<option value="0">Kick</option>');
    expect(html).toContain('<option value="1" selected>Track 2</option>');
  });

  it('does not mark the default option selected when a strip is selected', () => {
    const html = measurementSourceOptionsHTML(config, 0);
    expect(html).toContain('<option value="">First track (default)</option>');
  });

  it('HTML-escapes strip labels', () => {
    const html = measurementSourceOptionsHTML([{ kind: 'mono', a: 0, b: 1, label: '<b>Kick</b>' }], null);
    expect(html).toContain('&lt;b&gt;Kick&lt;/b&gt;');
    expect(html).not.toContain('<b>Kick</b>');
  });

  it('options come only from the strip config — value set is exactly "" plus strip indices', () => {
    const html = measurementSourceOptionsHTML(config, null);
    const values = [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(['', '0', '1']);
  });

  it('is empty apart from the default option when config is empty', () => {
    const html = measurementSourceOptionsHTML([], null);
    expect(html).toBe('<option value="" selected>First track (default)</option>');
  });
});

describe('measurementChannel', () => {
  const channels = ['ch0', 'ch1', 'ch2'];

  it('returns channels[source] for a valid index', () => {
    expect(measurementChannel(channels, 1)).toBe('ch1');
  });

  it('returns channels[0] when source is null', () => {
    expect(measurementChannel(channels, null)).toBe('ch0');
  });

  it('falls back to channels[0] when source is out of range', () => {
    expect(measurementChannel(channels, 9)).toBe('ch0');
  });

  it('returns null for undefined channels', () => {
    expect(measurementChannel(undefined, 0)).toBeNull();
  });

  it('returns null for empty channels', () => {
    expect(measurementChannel([], 0)).toBeNull();
  });
});

describe('measurementSourceBadgeText', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Crowd Mic' },
    { kind: 'mono', a: 1, b: 2 },
  ];

  it('shows the labeled strip', () => {
    expect(measurementSourceBadgeText(config, 0)).toBe('Measuring: Crowd Mic');
  });

  it('shows "Track N" for an unlabeled strip', () => {
    expect(measurementSourceBadgeText(config, 1)).toBe('Measuring: Track 2');
  });

  it('shows the first strip when source is null', () => {
    expect(measurementSourceBadgeText(config, null)).toBe('Measuring: Crowd Mic');
  });

  it('falls back to the first strip when source is out of range (stale label never shown)', () => {
    expect(measurementSourceBadgeText(config, 9)).toBe('Measuring: Crowd Mic');
  });

  it('shows "First track" when config is empty', () => {
    expect(measurementSourceBadgeText([], null)).toBe('Measuring: First track');
  });
});

describe('liveReportCardSource', () => {
  it('is null when there are no accumulated windows', () => {
    expect(liveReportCardSource([])).toBeNull();
  });

  it('is null when the latest window carries no channels', () => {
    const win: LiveEvent = { type: 'window', window: 1, ts: 0, channels: [], masking: [] };
    expect(liveReportCardSource([win])).toBeNull();
  });

  it('builds a report-card source from the first channel of the latest window', () => {
    const win: LiveEvent = {
      type: 'window',
      window: 3,
      ts: 0,
      masking: [],
      channels: [
        {
          index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1800, rolloff: 8000,
          bands: { sub_bass: -50, bass: -20, low_mid: -22, mid: -14, high_mid: -24, presence: -30, brilliance: -60 },
        },
      ],
    };
    const src = liveReportCardSource([win]);
    expect(src).toEqual({
      filename: 'Live capture — Main (window #3)',
      rms: -18, peak: -6, dynamicRange: null, clipping: false, centroid: 1800,
      bands: { subBass: -50, bass: -20, lowMid: -22, mid: -14, highMid: -24, presence: -30, brilliance: -60 },
      channels: [
        {
          label: undefined,
          name: 'Main',
          bands: { subBass: -50, bass: -20, lowMid: -22, mid: -14, highMid: -24, presence: -30, brilliance: -60 },
        },
      ],
    });
  });

  it('falls back to "Main" when the channel carries no name and uses only the LAST accumulated window', () => {
    const first: LiveEvent = {
      type: 'window', window: 1, ts: 0, masking: [],
      channels: [{ index: 0, name: 'First', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    const last: LiveEvent = {
      type: 'window', window: 2, ts: 1, masking: [],
      channels: [{ index: 0, name: undefined as unknown as string, rms: -18, peak: -6, clipping: true, centroid: 1800, rolloff: 8000, bands: {} }],
    };
    const src = liveReportCardSource([first, last]);
    expect(src?.filename).toBe('Live capture — Main (window #2)');
    expect(src?.clipping).toBe(true);
  });

  it('picks channels[measurementSource] when a source index is given', () => {
    const win: LiveEvent = {
      type: 'window', window: 1, ts: 0, masking: [],
      channels: [
        { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
        { index: 1, name: 'Vocals', rms: -18, peak: -6, clipping: true, centroid: 1800, rolloff: 8000, bands: { sub_bass: -50, bass: -20, low_mid: -22, mid: -14, high_mid: -24, presence: -30, brilliance: -60 } },
      ],
    };
    const src = liveReportCardSource([win], 1);
    expect(src?.filename).toBe('Live capture — Vocals (window #1)');
    expect(src?.rms).toBe(-18);
  });

  it('falls back to channels[0] when the measurement source index is out of range for this tick', () => {
    const win: LiveEvent = {
      type: 'window', window: 1, ts: 0, masking: [],
      channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    const src = liveReportCardSource([win], 5);
    expect(src?.filename).toBe('Live capture — Main (window #1)');
  });

  it('keeps channels[0] when the measurement source is null', () => {
    const win: LiveEvent = {
      type: 'window', window: 1, ts: 0, masking: [],
      channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    const src = liveReportCardSource([win], null);
    expect(src?.filename).toBe('Live capture — Main (window #1)');
  });

  it('uses the selected strip\'s trimmed label from config, not the tick name', () => {
    const win: LiveEvent = {
      type: 'window', window: 7, ts: 0, masking: [],
      channels: [
        { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
        { index: 1, name: 'Vocals', rms: -18, peak: -6, clipping: true, centroid: 1800, rolloff: 8000, bands: {} },
      ],
    };
    const config: StripConfig[] = [
      { kind: 'mono', a: 0, b: 1 },
      { kind: 'mono', a: 1, b: 2, label: '  Crowd Mic  ' },
    ];
    const src = liveReportCardSource([win], 1, config);
    expect(src?.filename).toBe('Live capture — Crowd Mic (window #7)');
  });

  it('falls back to the tick channel name when the selected strip has no label', () => {
    const win: LiveEvent = {
      type: 'window', window: 4, ts: 0, masking: [],
      channels: [{ index: 0, name: 'Board Mix', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    const config: StripConfig[] = [{ kind: 'mono', a: 0, b: 1 }];
    const src = liveReportCardSource([win], 0, config);
    expect(src?.filename).toBe('Live capture — Board Mix (window #4)');
  });

  it('labels strip 0 (not the stale selection) when the selected channel is missing from the tick', () => {
    const win: LiveEvent = {
      type: 'window', window: 2, ts: 0, masking: [],
      channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    const config: StripConfig[] = [
      { kind: 'mono', a: 0, b: 1, label: 'Kick' },
      { kind: 'mono', a: 1, b: 2, label: 'Stale Selection' },
    ];
    const src = liveReportCardSource([win], 5, config);
    expect(src?.filename).toBe('Live capture — Kick (window #2)');
  });

  it('matches the config-omitted default when config is not passed', () => {
    const win: LiveEvent = {
      type: 'window', window: 1, ts: 0, masking: [],
      channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
    };
    expect(liveReportCardSource([win], null)?.filename).toBe('Live capture — Main (window #1)');
  });

  it('returns a channels array the same length as win.channels with byte-identical top-level bands', () => {
    const win: LiveEvent = {
      type: 'window', window: 5, ts: 0, masking: [],
      channels: [
        { index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1800, rolloff: 8000, bands: { sub_bass: -50, bass: -20, low_mid: -22, mid: -14, high_mid: -24, presence: -30, brilliance: -60 } },
        { index: 1, name: 'Vocals', rms: -20, peak: -8, clipping: false, centroid: 1500, rolloff: 7000, bands: { sub_bass: -55, bass: -25, low_mid: -27, mid: -19, high_mid: -29, presence: -35, brilliance: -65 } },
      ],
    };
    const src = liveReportCardSource([win]);
    expect(src?.channels).toHaveLength(2);
    expect(src?.bands).toEqual({ subBass: -50, bass: -20, lowMid: -22, mid: -14, highMid: -24, presence: -30, brilliance: -60 });
  });
});

describe('liveChannelContributors', () => {
  it('returns [] for undefined channels', () => {
    expect(liveChannelContributors(undefined)).toEqual([]);
  });

  it('returns [] for an empty channels array', () => {
    expect(liveChannelContributors([])).toEqual([]);
  });

  it('maps snake_case bands to the seven camelCase keys for every channel', () => {
    const channels = [
      { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: { sub_bass: -50, bass: -20, low_mid: -22, mid: -14, high_mid: -24, presence: -30, brilliance: -60 } },
    ];
    expect(liveChannelContributors(channels)).toEqual([
      {
        label: undefined,
        name: 'Main',
        bands: { subBass: -50, bass: -20, lowMid: -22, mid: -14, highMid: -24, presence: -30, brilliance: -60 },
      },
    ]);
  });

  it('overlays the saved config label when present', () => {
    const channels = [
      { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
    ];
    const config: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: 'Crowd Mic' }];
    expect(liveChannelContributors(channels, config)[0].label).toBe('Crowd Mic');
  });

  it('leaves label undefined when the saved label is empty or whitespace-only', () => {
    const channels = [
      { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
    ];
    const config: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: '   ' }];
    expect(liveChannelContributors(channels, config)[0].label).toBeUndefined();
  });

  it('defaults config to [] when not passed', () => {
    const channels = [
      { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
    ];
    expect(liveChannelContributors(channels)[0].label).toBeUndefined();
  });
});

describe('patchLiveChannelPlan', () => {
  function sv(overrides: Partial<StripView> = {}): StripView {
    return { strip: { kind: 'mono', a: 0, b: 1 }, displayName: 'Ch 1', collapsed: false, armed: false, groupIndex: -1, groupCollapsed: false, instrumentProfileId: 'generic', instrumentAuto: true, ...overrides };
  }

  it('carries collapsed/displayName/meta through from the strip view and channel', () => {
    const plan = patchLiveChannelPlan(LIVE_CHANNELS[0], 0, sv({ displayName: 'Vocals', collapsed: true }), false);
    expect(plan.collapsed).toBe(true);
    expect(plan.displayName).toBe('Vocals');
    expect(plan.idle).toBe(false);
    expect(plan.meta).toBe('RMS -18.0 · Peak -6.0 dBFS');
    expect(plan.removeDisabled).toBe(false);
  });

  it('shows Idle meta for idle channels', () => {
    const plan = patchLiveChannelPlan({ ...LIVE_CHANNELS[0], idle: true }, 0, sv(), false);
    expect(plan.idle).toBe(true);
    expect(plan.meta).toBe('Idle');
  });

  it('reflects clipping', () => {
    const plan = patchLiveChannelPlan({ ...LIVE_CHANNELS[0], clipping: true }, 0, sv(), false);
    expect(plan.clipping).toBe(true);
  });

  it('sets removeDisabled while capturing', () => {
    const plan = patchLiveChannelPlan(LIVE_CHANNELS[0], 0, sv(), true);
    expect(plan.removeDisabled).toBe(true);
  });

  it('floors non-finite bands to -120 in the derived curve', () => {
    const plan = patchLiveChannelPlan({ ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, sub_bass: NaN } }, 0, sv(), false);
    expect(plan.curve.db[0]).toBe(-120);
  });

  it('picks the loudest band index matching veqLoudestIdx semantics', () => {
    const plan = patchLiveChannelPlan(LIVE_CHANNELS[0], 0, sv(), false);
    // Vocals fixture: mid (-12) is the loudest of the 7 bands.
    expect(plan.loudestIdx).toBe(3);
  });

  it('produces a truthy arc for a channel with real band data', () => {
    const plan = patchLiveChannelPlan(LIVE_CHANNELS[0], 0, sv(), false);
    expect(plan.arc).toBeTruthy();
    expect(typeof plan.arc).toBe('object');
  });
});
