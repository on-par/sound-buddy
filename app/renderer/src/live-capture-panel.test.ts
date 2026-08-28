// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BAND_META, DB_MIN, DB_MAX, DIM_DB, toPct } from './spectrum-display';
import {
  LIVE_BAND_KEYS,
  VEQ_FREQS,
  VEQ_BANDS,
  ANALYZER_GRID_LOW_HZ,
  ANALYZER_GRID_HIGH_HZ,
  ANALYZER_GRID_POINTS,
  ANALYZER_GRID_FREQS,
  VEQ_GRID_BARS,
  veqLogPos,
  bandColorForFreq,
  liveAnalyzerCurve,
  veqGridBarsHTML,
  DEFAULT_DEVICE_CHANNELS,
  EQ_PANE_MIN_W,
  EQ_PANE_MAX_W,
  EQ_PANE_DEFAULT_W,
  EQ_PANE_RESIZE_STEP,
  clampEqPaneWidth,
  levelPercent,
  eqPaneView,
  eqPaneHTML,
  eqPaneClassificationHTML,
  eqPaneInspectorHTML,
  eqPaneSignature,
  eqPanePatchPlan,
  EQ_PANE_ROOM_OVERRIDE_IDX,
  deviceOptionLabel,
  deviceListView,
  deviceChannelCount,
  deviceNameFor,
  usedChannelCount,
  channelOptions,
  liveBandCurve,  liveReportCardSource,
  liveChannelContributors,  groupSummary,
  groupSummaryText,
  shouldOfferReportCard,
  normalizeMeasurementSource,
  measurementSourceAfterRemove,
  channelFlagsAfterRemove,
  measurementSourceOptionLabel,
  measurementSourceOptionsHTML,
  measurementChannel,
  measurementSourceBadgeText,
  MIN_SESSION_WINDOWS,
  hasEnoughSessionData,
  liveSessionReportCardSource,
  type LiveDevice,
  type ListDevicesResult,
  type StripConfig,
  type ChannelGroup,
  type LiveMeterChannel,
  type LiveEvent,
  type WindowData,
  type EqPaneRoomOverride,
  type EqPaneClassificationView,
  type EqPaneInspectorView,
  type EqPaneLevelTilesView,
} from './live-capture-panel';

const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');

const devices: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 18, default_sr: 48000 },
  { index: 1, name: 'Built-in Microphone', channels: 2, default_sr: 44100 },
];

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

describe('deviceNameFor', () => {
  it('resolves a matching device index to its name', () => {
    expect(deviceNameFor('1', devices)).toBe('Built-in Microphone');
  });

  it('resolves the "" (Default Device) selection to an empty name', () => {
    expect(deviceNameFor('', devices)).toBe('');
  });

  it('resolves an unknown value to an empty name', () => {
    expect(deviceNameFor('99', devices)).toBe('');
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

describe('VEQ_BANDS short labels (#666)', () => {
  it('carries BAND_META.short through for all 7 bands', () => {
    VEQ_BANDS.forEach((b, i) => expect(b.short).toBe(BAND_META[i].short));
  });
});

describe('ANALYZER_GRID_FREQS (#667)', () => {
  it('has 48 points spanning 20 Hz to 20 kHz, log-uniform', () => {
    expect(ANALYZER_GRID_FREQS).toHaveLength(ANALYZER_GRID_POINTS);
    expect(ANALYZER_GRID_POINTS).toBe(48);
    expect(ANALYZER_GRID_FREQS[0]).toBe(ANALYZER_GRID_LOW_HZ);
    expect(ANALYZER_GRID_FREQS[ANALYZER_GRID_FREQS.length - 1]).toBeCloseTo(ANALYZER_GRID_HIGH_HZ);
  });

  it('has a constant ratio between successive points, matching spectrum.py._grid_freqs()', () => {
    const ratio = ANALYZER_GRID_FREQS[1] / ANALYZER_GRID_FREQS[0];
    for (let i = 1; i < ANALYZER_GRID_FREQS.length; i++) {
      expect(ANALYZER_GRID_FREQS[i] / ANALYZER_GRID_FREQS[i - 1]).toBeCloseTo(1.1583233, 6);
    }
    expect(ratio).toBeCloseTo(1.1583233, 6);
  });

  it('pins index 24 to the same value spectrum.py._grid_freqs() produces (cross-language parity)', () => {
    expect(ANALYZER_GRID_FREQS[24]).toBeCloseTo(680.683, 2);
  });
});

describe('VEQ_GRID_BARS (#667)', () => {
  it('has 48 equal-width entries', () => {
    expect(VEQ_GRID_BARS).toHaveLength(48);
    const width = VEQ_GRID_BARS[0].width;
    VEQ_GRID_BARS.forEach((b) => expect(b.width).toBe(width));
  });

  it('centers each bar on its grid frequency\'s true log position (AC scenario 2)', () => {
    VEQ_GRID_BARS.forEach((b, i) => {
      expect(b.center).toBe(veqLogPos(ANALYZER_GRID_FREQS[i]).toFixed(2));
    });
  });

  it('derives left from center - width/2', () => {
    VEQ_GRID_BARS.forEach((b) => {
      // Each field is independently rounded via .toFixed(2), so up to ~0.01
      // combined rounding slop between left and center - width/2 is expected.
      expect(Number(b.left)).toBeCloseTo(Number(b.center) - Number(b.width) / 2, 1);
    });
  });

  it('keeps interior bars within the [0, 100] plot range', () => {
    for (let i = 1; i < VEQ_GRID_BARS.length - 1; i++) {
      expect(Number(VEQ_GRID_BARS[i].center)).toBeGreaterThanOrEqual(0);
      expect(Number(VEQ_GRID_BARS[i].center)).toBeLessThanOrEqual(100);
    }
  });
});

describe('bandColorForFreq (#667)', () => {
  it('maps representative frequencies to their band color', () => {
    expect(bandColorForFreq(30)).toBe(BAND_META[0].color); // sub-bass
    expect(bandColorForFreq(100)).toBe(BAND_META[1].color); // bass
    expect(bandColorForFreq(1000)).toBe(BAND_META[3].color); // mid
    expect(bandColorForFreq(10000)).toBe(BAND_META[6].color); // brilliance
  });

  it('is lo-inclusive at a band boundary', () => {
    expect(bandColorForFreq(60)).toBe(BAND_META[1].color); // bass, not sub-bass
  });

  it('clamps frequencies at/above 20 kHz to brilliance', () => {
    expect(bandColorForFreq(20000)).toBe(BAND_META[6].color);
    expect(bandColorForFreq(25000)).toBe(BAND_META[6].color);
  });

  it('clamps frequencies below 20 Hz to sub-bass', () => {
    expect(bandColorForFreq(10)).toBe(BAND_META[0].color);
  });
});

describe('liveAnalyzerCurve (#667)', () => {
  function chWithCurve(curve: number[]): LiveMeterChannel {
    return { name: 'X', rms: -20, peak: -10, clipping: false, centroid: 1000, bands: {}, curve };
  }

  it('returns { freqs: ANALYZER_GRID_FREQS, db } for a full 48-entry curve', () => {
    const curve = Array.from({ length: 48 }, (_, i) => -i);
    const result = liveAnalyzerCurve(chWithCurve(curve));
    expect(result).not.toBeNull();
    expect(result!.freqs).toBe(ANALYZER_GRID_FREQS);
    expect(result!.db).toEqual(curve);
  });

  it('floors non-finite entries to -120', () => {
    const curve = Array.from({ length: 48 }, () => -30);
    curve[5] = NaN;
    const result = liveAnalyzerCurve(chWithCurve(curve));
    expect(result!.db[5]).toBe(-120);
  });

  it('returns null when curve is missing', () => {
    const ch: LiveMeterChannel = { name: 'X', rms: -20, peak: -10, clipping: false, centroid: 1000, bands: {} };
    expect(liveAnalyzerCurve(ch)).toBeNull();
  });

  it.each([7, 47, 49])('returns null for a malformed length of %i', (len) => {
    const curve = Array.from({ length: len }, () => -30);
    expect(liveAnalyzerCurve(chWithCurve(curve))).toBeNull();
  });
});

describe('veqGridBarsHTML (#667)', () => {
  it('renders exactly 48 .veq-bar divs with no .veq-val and no loud class', () => {
    const gridDb = Array.from({ length: 48 }, () => -20);
    const html = veqGridBarsHTML(gridDb);
    expect((html.match(/class="veq-bar/g) || [])).toHaveLength(48);
    expect(html).not.toContain('veq-val');
    expect(html).not.toContain('loud');
  });

  it('marks bars dim exactly when db <= DIM_DB, and heights follow toPct', () => {
    const gridDb = Array.from({ length: 48 }, (_, i) => (i === 0 ? DIM_DB : -10));
    const html = veqGridBarsHTML(gridDb);
    const bars = html.match(/<div[^>]*><\/div>/g) || [];
    expect(bars).toHaveLength(48);
    expect(bars[0]).toContain('dim');
    expect(bars[0]).toContain(`height:${toPct(DIM_DB).toFixed(2)}%`);
    expect(bars[1]).not.toContain('dim');
    expect(bars[1]).toContain(`height:${toPct(-10).toFixed(2)}%`);
  });
});


describe('eqPaneClassificationHTML', () => {
  const profiles = [{ id: 'bass', label: 'Bass' }, { id: 'vocal', label: 'Vocal' }];
  const groups: ChannelGroup[] = [{ name: 'Drums', members: [0] }, { name: 'Vox', members: [] }];
  function classification(overrides: Partial<EqPaneClassificationView> = {}): EqPaneClassificationView {
    return {
      selectedIndex: 0,
      groupIndex: 0,
      groups,
      profiles,
      effectiveProfileId: 'bass',
      instrumentAuto: true,
      disabled: false,
      ...overrides,
    };
  }

  it('renders selected group and Auto effective profile for a configured channel', () => {
    const html = eqPaneClassificationHTML(classification());
    expect(html).toContain('Classification');
    expect(html).toContain('class="eq-pane-classification-profile"');
    expect(html).toContain('<option value="auto" selected>Auto — Bass</option>');
    expect(html).toContain('class="eq-pane-classification-group"');
    expect(html).toContain('<option value="0" selected>Drums</option>');
  });

  it('renders Ungrouped and selects an explicit profile override', () => {
    const html = eqPaneClassificationHTML(classification({ groupIndex: -1, effectiveProfileId: 'vocal', instrumentAuto: false }));
    expect(html).toContain('<option value="-1" selected>Ungrouped</option>');
    expect(html).toContain('<option value="auto">Auto — Vocal</option>');
    expect(html).toContain('<option value="vocal" selected>Vocal</option>');
  });

  it('disables both selectors during a live-running configuration lock', () => {
    const html = eqPaneClassificationHTML(classification({ disabled: true }));
    expect(html).toContain('eq-pane-classification-profile" aria-label="Instrument profile" disabled');
    expect(html).toContain('eq-pane-classification-group" aria-label="Assign track to group" disabled');
  });

  it('omits the section when there is no selected configured channel', () => {
    expect(eqPaneClassificationHTML(null)).toBe('');
  });

  it('escapes group and profile labels', () => {
    const html = eqPaneClassificationHTML(classification({
      groups: [{ name: '<Drums & Vox>', members: [0] }],
      profiles: [{ id: 'bass', label: '<Bass & "Vocal">' }],
    }));
    expect(html).toContain('&lt;Drums &amp; Vox&gt;');
    expect(html).toContain('&lt;Bass &amp; &quot;Vocal&quot;&gt;');
  });
});

describe('eqPaneInspectorHTML (#1064)', () => {
  function inspector(overrides: Partial<EqPaneInspectorView> = {}): EqPaneInspectorView {
    return {
      selectedIndex: 1,
      strip: { kind: 'stereo', a: 2, b: 3, armed: true, label: 'Keys' },
      deviceChannels: 8,
      disabled: false,
      playbackTrack: { kind: 'stereo' },
      playbackRoute: [4, 5],
      playbackDeviceChannels: 6,
      levelTiles: null,
      ...overrides,
    };
  }

  it('binds a selected stereo strip identity, input, arm state, and matching playback route', () => {
    const html = eqPaneInspectorHTML(inspector());
    expect(html).toContain('Keys');
    expect(html).toContain('Strip 2');
    expect(html).toContain('eq-pane-inspector-swatch band-1');
    expect(html).toContain('<option value="stereo" selected>Stereo</option>');
    expect(html).toContain('<option value="2" selected>3</option>');
    expect(html).toContain('<option value="3" selected>4</option>');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<option value="4" selected>Ch 5-6</option>');
  });

  it('escapes strip labels and falls back to the track label', () => {
    const html = eqPaneInspectorHTML(inspector({
      selectedIndex: 0,
      strip: { kind: 'mono', a: 0, b: 1, label: '<Lead & "Vox">' },
      playbackTrack: { kind: 'mono' },
      playbackRoute: [0],
    }));
    expect(html).toContain('&lt;Lead &amp; &quot;Vox&quot;&gt;');
    expect(eqPaneInspectorHTML(inspector({ strip: { kind: 'mono', a: 0, b: 1 } }))).toContain('Track 2');
  });

  it('renders a disabled route explanation when the session has no matching track', () => {
    const html = eqPaneInspectorHTML(inspector({ playbackTrack: null, playbackRoute: null }));
    expect(html).toContain('eq-pane-inspector-output-notice');
    expect(html).toContain('Load a soundcheck session with a matching track to choose playback output.');
    expect(html).toContain('disabled');
  });

  it('renders nothing for an invalid or absent selection', () => {
    expect(eqPaneInspectorHTML(null)).toBe('');
    expect(eqPaneInspectorHTML(inspector({ selectedIndex: -1 }))).toBe('');
    expect(eqPaneInspectorHTML(inspector({ selectedIndex: 1.5 }))).toBe('');
  });

  it('uses the soundcheck default output when a matching track has no saved route yet', () => {
    const html = eqPaneInspectorHTML(inspector({ playbackRoute: null }));
    expect(html).toContain('class="eq-pane-inspector-output"');
    expect(html).toContain('<option value="0" selected>Ch 1-2</option>');
  });

  it('renders selected-channel RMS, peak, headroom, and clipping level tiles', () => {
    const levelTiles: EqPaneLevelTilesView = {
      rms: '-5.0', rmsTone: 'check',
      peak: '-0.5', peakTone: 'issue',
      headroom: '0.5', headroomTone: 'issue',
      clip: 'CLIP', clipTone: 'issue',
    };
    const html = eqPaneInspectorHTML(inspector({ levelTiles }));
    expect(html).toContain('<div class="eq-pane-header">Level</div>');
    expect(html).toContain('>RMS<');
    expect(html).toContain('>Peak<');
    expect(html).toContain('>Headroom<');
    expect(html).toContain('>Clips<');
    expect(html).toContain('data-eq-pane-level="rms" class="eq-pane-level-value check">-5.0</span>');
    expect(html).toContain('data-eq-pane-level="peak" class="eq-pane-level-value issue">-0.5</span>');
    expect(html).toContain('data-eq-pane-level="headroom" class="eq-pane-level-value issue">0.5</span>');
    expect(html).toContain('data-eq-pane-level="clip" class="eq-pane-level-value issue">CLIP</span>');
  });

  it('renders unavailable level tiles when selected-channel statistics are absent', () => {
    const html = eqPaneInspectorHTML(inspector({ levelTiles: null }));
    expect(html.match(/class="eq-pane-level-value">—<\/span>/g)).toHaveLength(4);
    expect(html).not.toContain('-5.0');
  });

  it('keeps mode, source, group and instrument profile in the selection pane (#849)', () => {
    const html = eqPaneInspectorHTML(inspector());
    expect(html).toContain('eq-pane-inspector-kind');
    expect(html).toContain('eq-pane-inspector-source');
    const classificationHTML = eqPaneClassificationHTML({
      selectedIndex: 0,
      groupIndex: -1,
      groups: [{ name: 'Drums', members: [0] }],
      profiles: [{ id: 'vox', label: 'Vocal' }],
      effectiveProfileId: 'vox',
      instrumentAuto: true,
      disabled: false,
    });
    expect(classificationHTML).toContain('eq-pane-classification-group');
    expect(classificationHTML).toContain('eq-pane-classification-profile');
    const disabledHTML = eqPaneInspectorHTML(inspector({ disabled: true }));
    expect(disabledHTML).toContain('class="eq-pane-inspector-kind" aria-label="Mono or stereo" disabled');
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

describe('shouldOfferReportCard (#488, #757)', () => {
  it('offers after a session that accumulated windows', () => {
    expect(shouldOfferReportCard(1)).toBe(true);
    expect(shouldOfferReportCard(10)).toBe(true);
  });
  it('does not offer when no window tick ever arrived', () => {
    expect(shouldOfferReportCard(0)).toBe(false);
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

describe('channelFlagsAfterRemove', () => {
  it('returns an empty map for an empty map', () => {
    expect(channelFlagsAfterRemove({}, 1)).toEqual({});
  });

  it("drops the removed index's own flag", () => {
    expect(channelFlagsAfterRemove({ 1: true }, 1)).toEqual({});
  });

  it('shifts higher flags down', () => {
    expect(channelFlagsAfterRemove({ 2: true }, 0)).toEqual({ 1: true });
  });

  it('leaves lower flags alone', () => {
    expect(channelFlagsAfterRemove({ 0: true }, 2)).toEqual({ 0: true });
  });

  it('does not mutate its input', () => {
    const input = { 0: true, 2: true };
    channelFlagsAfterRemove(input, 0);
    expect(input).toEqual({ 0: true, 2: true });
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

describe('hasEnoughSessionData', () => {
  function windows(n: number): LiveEvent[] {
    return Array.from({ length: n }, (_, i) => ({
      type: 'window', window: i, ts: i, masking: [],
      channels: [{ index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1000, rolloff: 4000, bands: {} }],
    }));
  }

  it('is false for 0, 1, and 2 windows (below MIN_SESSION_WINDOWS)', () => {
    expect(hasEnoughSessionData(windows(0))).toBe(false);
    expect(hasEnoughSessionData(windows(1))).toBe(false);
    expect(hasEnoughSessionData(windows(2))).toBe(false);
  });

  it('is true at exactly MIN_SESSION_WINDOWS and above', () => {
    expect(MIN_SESSION_WINDOWS).toBe(3);
    expect(hasEnoughSessionData(windows(3))).toBe(true);
    expect(hasEnoughSessionData(windows(10))).toBe(true);
  });
});

describe('liveSessionReportCardSource', () => {
  function win(
    window: number,
    channels: Array<{ index: number; name?: string; rms: number; peak: number; clipping: boolean; centroid?: number; bands: Record<string, number> }>,
  ): LiveEvent {
    return {
      type: 'window', window, ts: window, masking: [],
      channels: channels.map((c) => ({ rolloff: 4000, ...c })),
    } as LiveEvent;
  }

  const fullBands = { sub_bass: -50, bass: -20, low_mid: -22, mid: -14, high_mid: -24, presence: -30, brilliance: -60 };

  function threeWindows(overrides: Partial<{ rms: number[]; peak: number[]; centroid: (number | undefined)[]; clipping: boolean[] }> = {}): LiveEvent[] {
    const rms = overrides.rms || [-20, -18, -16];
    const peak = overrides.peak || [-8, -6, -4];
    const centroid = overrides.centroid || [1000, 1200, 1400];
    const clipping = overrides.clipping || [false, false, false];
    return rms.map((r, i) => win(i + 1, [{ index: 0, name: 'Main', rms: r, peak: peak[i], clipping: clipping[i], centroid: centroid[i], bands: fullBands }]));
  }

  it('is null for 0, 1, and 2 windows', () => {
    expect(liveSessionReportCardSource([])).toBeNull();
    expect(liveSessionReportCardSource(threeWindows().slice(0, 1))).toBeNull();
    expect(liveSessionReportCardSource(threeWindows().slice(0, 2))).toBeNull();
  });

  it('computes mean rms, max peak, mean centroid, and per-band means across 3+ windows', () => {
    const src = liveSessionReportCardSource(threeWindows());
    expect(src).not.toBeNull();
    expect(src!.rms).toBeCloseTo((-20 + -18 + -16) / 3);
    expect(src!.peak).toBeCloseTo(-4); // max of -8, -6, -4
    expect(src!.centroid).toBeCloseTo((1000 + 1200 + 1400) / 3);
    expect(src!.bands.subBass).toBeCloseTo(-50);
    expect(src!.bands.bass).toBeCloseTo(-20);
    expect(src!.bands.brilliance).toBeCloseTo(-60);
    expect(src!.dynamicRange).toBeNull();
  });

  it('is true when any usable window clipped, false when none did', () => {
    const clippedSrc = liveSessionReportCardSource(threeWindows({ clipping: [false, true, false] }));
    expect(clippedSrc!.clipping).toBe(true);
    const cleanSrc = liveSessionReportCardSource(threeWindows({ clipping: [false, false, false] }));
    expect(cleanSrc!.clipping).toBe(false);
  });

  it('builds a filename with the strip label and usable-window count, no window-# suffix', () => {
    const config: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: 'Crowd Mic' }];
    const src = liveSessionReportCardSource(threeWindows(), 0, config);
    expect(src!.filename).toBe('Live capture — Crowd Mic (3 windows)');
    expect(src!.filename).not.toMatch(/window #/);
  });

  it('falls back to the channel name, then "Main", when no strip label is set', () => {
    const src = liveSessionReportCardSource(threeWindows());
    expect(src!.filename).toBe('Live capture — Main (3 windows)');
  });

  it('populates channels from the last usable window via liveChannelContributors', () => {
    const windows = threeWindows();
    const src = liveSessionReportCardSource(windows);
    expect(src!.channels).toEqual(liveChannelContributors((windows[2] as WindowData).channels));
  });

  it('is undefined when every window has an undefined centroid', () => {
    const src = liveSessionReportCardSource(threeWindows({ centroid: [undefined, undefined, undefined] }));
    expect(src!.centroid).toBeUndefined();
  });

  it('skips windows lacking the measurement-source channel, falling index back to 0', () => {
    const withVocals = [
      win(1, [{ index: 0, name: 'Main', rms: -20, peak: -8, clipping: false, centroid: 1000, bands: fullBands }]),
      win(2, [
        { index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1200, bands: fullBands },
        { index: 1, name: 'Vocals', rms: -10, peak: -2, clipping: false, centroid: 2000, bands: fullBands },
      ]),
      win(3, [{ index: 0, name: 'Main', rms: -16, peak: -4, clipping: false, centroid: 1400, bands: fullBands }]),
    ];
    // measurementSource 1 ("Vocals") is absent on windows 1 and 3 — each falls
    // back to channel 0 rather than being dropped, so all three stay usable.
    const src = liveSessionReportCardSource(withVocals, 1);
    expect(src!.rms).toBeCloseTo((-20 + -10 + -16) / 3);
  });

  it('is null when every window lacks channels entirely', () => {
    const noChannels: LiveEvent[] = [
      { type: 'window', window: 1, ts: 1, masking: [], channels: [] },
      { type: 'window', window: 2, ts: 2, masking: [], channels: [] },
      { type: 'window', window: 3, ts: 3, masking: [], channels: [] },
    ];
    expect(liveSessionReportCardSource(noChannels)).toBeNull();
  });

  it('is null when fewer than MIN_SESSION_WINDOWS usable windows survive the channel filter', () => {
    const mixed: LiveEvent[] = [
      { type: 'window', window: 1, ts: 1, masking: [], channels: [] },
      win(2, [{ index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1200, bands: fullBands }]),
      win(3, [{ index: 0, name: 'Main', rms: -16, peak: -4, clipping: false, centroid: 1400, bands: fullBands }]),
    ];
    expect(liveSessionReportCardSource(mixed)).toBeNull();
  });
});


describe('EQ_PANE constants (#668)', () => {
  it('defines the width bounds and the default and keyboard-resize step as named px constants', () => {
    expect(EQ_PANE_MIN_W).toBe(260);
    expect(EQ_PANE_MAX_W).toBe(640);
    expect(EQ_PANE_DEFAULT_W).toBe(360);
    expect(EQ_PANE_RESIZE_STEP).toBe(16);
    expect(EQ_PANE_MIN_W).toBeLessThan(EQ_PANE_DEFAULT_W);
    expect(EQ_PANE_DEFAULT_W).toBeLessThan(EQ_PANE_MAX_W);
  });
});

describe('clampEqPaneWidth', () => {
  it('passes a value already inside the range through unchanged', () => {
    expect(clampEqPaneWidth(400)).toBe(400);
  });

  it('clamps below EQ_PANE_MIN_W up to the minimum', () => {
    expect(clampEqPaneWidth(10)).toBe(EQ_PANE_MIN_W);
  });

  it('clamps above EQ_PANE_MAX_W down to the maximum', () => {
    expect(clampEqPaneWidth(10000)).toBe(EQ_PANE_MAX_W);
  });

  it('falls back to EQ_PANE_DEFAULT_W for non-number input', () => {
    expect(clampEqPaneWidth('400')).toBe(EQ_PANE_DEFAULT_W);
    expect(clampEqPaneWidth(null)).toBe(EQ_PANE_DEFAULT_W);
    expect(clampEqPaneWidth(undefined)).toBe(EQ_PANE_DEFAULT_W);
    expect(clampEqPaneWidth({})).toBe(EQ_PANE_DEFAULT_W);
  });

  it('falls back to EQ_PANE_DEFAULT_W for non-finite numbers', () => {
    expect(clampEqPaneWidth(NaN)).toBe(EQ_PANE_DEFAULT_W);
    expect(clampEqPaneWidth(Infinity)).toBe(EQ_PANE_DEFAULT_W);
    expect(clampEqPaneWidth(-Infinity)).toBe(EQ_PANE_DEFAULT_W);
  });

  it('accepts the exact boundary values', () => {
    expect(clampEqPaneWidth(EQ_PANE_MIN_W)).toBe(EQ_PANE_MIN_W);
    expect(clampEqPaneWidth(EQ_PANE_MAX_W)).toBe(EQ_PANE_MAX_W);
  });
});

describe('levelPercent', () => {
  it('is 0 while idle regardless of rms', () => {
    expect(levelPercent(-6, true)).toBe(0);
  });

  it('is 0 for a non-finite rms', () => {
    expect(levelPercent(NaN, false)).toBe(0);
    expect(levelPercent(Infinity, false)).toBe(0);
  });

  it('maps DB_MIN to 0 and DB_MAX to 100', () => {
    expect(levelPercent(DB_MIN, false)).toBe(0);
    expect(levelPercent(DB_MAX, false)).toBe(100);
  });

  it('clamps a reading below DB_MIN to 0 and above DB_MAX to 100', () => {
    expect(levelPercent(DB_MIN - 20, false)).toBe(0);
    expect(levelPercent(DB_MAX + 20, false)).toBe(100);
  });

  it('is between 0 and 100 for a mid-range reading', () => {
    const pct = levelPercent((DB_MIN + DB_MAX) / 2, false);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });
});

describe('eqPaneView', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2, label: 'Vocals' },
  ];

  it('resolves primary from measurementSource, falling back to channel 0 when null', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, null, null);
    expect(view.primary).toEqual({ idx: 0, label: 'Kick', ch: LIVE_CHANNELS[0] });
  });

  it('resolves primary to the given measurementSource index', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 1, null);
    expect(view.primary).toEqual({ idx: 1, label: 'Vocals', ch: LIVE_CHANNELS[1] });
  });

  it('falls back primary to channel 0 when measurementSource is out of range', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 9, null);
    expect(view.primary?.idx).toBe(0);
  });

  it('primary is null only when channels is empty', () => {
    expect(eqPaneView([], config, null, null).primary).toBeNull();
  });

  it('secondary is null when selectedChannel is null', () => {
    expect(eqPaneView(LIVE_CHANNELS, config, null, null).secondary).toBeNull();
  });

  it('secondary is null when selectedChannel is out of range', () => {
    expect(eqPaneView(LIVE_CHANNELS, config, null, 9).secondary).toBeNull();
    expect(eqPaneView(LIVE_CHANNELS, config, null, -1).secondary).toBeNull();
  });

  it('secondary is null when selectedChannel only exists in stale tick data (#710)', () => {
    // A tick channel set larger than channelConfig (e.g. a stale
    // lastLiveChannels after a config change) must not resurrect a
    // "Selected" section for a strip that no longer exists.
    expect(eqPaneView(LIVE_CHANNELS, [config[0]], null, 1).secondary).toBeNull();
  });

  it('resolves secondary from a valid selectedChannel', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, null, 1);
    expect(view.secondary).toEqual({ idx: 1, label: 'Vocals', ch: LIVE_CHANNELS[1] });
  });

  it('secondaryIsPrimary is true when both resolve to the same index', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 1, 1);
    expect(view.secondaryIsPrimary).toBe(true);
  });

  it('secondaryIsPrimary is false when they differ', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, 1);
    expect(view.secondaryIsPrimary).toBe(false);
  });

  it('secondaryIsPrimary is false when secondary is null', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null);
    expect(view.secondaryIsPrimary).toBe(false);
  });
});

describe('eqPaneView room override (#460)', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2, label: 'Vocals' },
  ];
  const ROOM_MIC_CH: LiveMeterChannel = {
    name: 'Room', rms: -32, peak: -14, clipping: false, centroid: 900,
    bands: { sub_bass: -44, bass: -36, low_mid: -30, mid: -26, high_mid: -34, presence: -46, brilliance: -62 },
  };
  const override: EqPaneRoomOverride = { ch: ROOM_MIC_CH, label: 'MacBook Pro Microphone' };

  it('replaces the primary slot with the secondary room reading + device name', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null, override);
    expect(view.primary).toEqual({
      idx: EQ_PANE_ROOM_OVERRIDE_IDX,
      label: 'MacBook Pro Microphone',
      ch: ROOM_MIC_CH,
    });
  });

  it('still yields a primary when the board has no channels at all', () => {
    const view = eqPaneView([], config, null, null, override);
    expect(view.primary?.ch).toBe(ROOM_MIC_CH);
  });

  it('leaves the Selected slot on the board strip and never marks it as the room source', () => {
    // Selected = the old measurement-source strip: without the override this
    // is secondaryIsPrimary; with the room mic owning the Room it must not be.
    const view = eqPaneView(LIVE_CHANNELS, config, 1, 1, override);
    expect(view.secondary).toEqual({ idx: 1, label: 'Vocals', ch: LIVE_CHANNELS[1] });
    expect(view.secondaryIsPrimary).toBe(false);
  });

  it('an omitted and an explicit-null override are byte-identical to the board view (#602 parity guard)', () => {
    expect(eqPaneView(LIVE_CHANNELS, config, 0, 1, null)).toEqual(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    expect(eqPaneHTML(eqPaneView(LIVE_CHANNELS, config, 0, 1, null)))
      .toBe(eqPaneHTML(eqPaneView(LIVE_CHANNELS, config, 0, 1)));
  });
});

describe('eqPaneHTML', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2, label: 'Vocals' },
  ];

  it('renders the primary section with a "Room — <label>" header and a .veq chart + .veq-bars + .veq-labels', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null);
    const html = eqPaneHTML(view);
    expect(html).toContain('Room — Kick');
    expect(html).toContain('class="veq"');
    expect(html).toContain('veq-chart');
    expect(html).toContain('veq-bars');
    expect(html).toContain('veq-db-scale');
    expect(html).toContain('-60 dB');
    expect(html).toContain('-6 dB');
    expect(html).toContain('veq-labels');
  });

  it('renders the secondary section with a "Selected — <label>" header when a channel is selected', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, 1);
    const html = eqPaneHTML(view);
    expect(html).toContain('Selected — Vocals');
  });

  it('appends " · Measurement source" to the secondary header when secondaryIsPrimary', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 1, 1);
    const html = eqPaneHTML(view);
    expect(html).toContain('Selected — Vocals · Measurement source');
  });

  it('does not append the suffix when secondary differs from primary', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, 1);
    const html = eqPaneHTML(view);
    expect(html).not.toContain('Measurement source');
  });

  it('renders an empty-state hint instead of a chart when no channel is selected', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null);
    const html = eqPaneHTML(view);
    expect(html).toContain('Click a channel to inspect it here');
  });

  it('escapes label text', () => {
    const xssConfig: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: '<b>Kick</b>' }];
    const view = eqPaneView(LIVE_CHANNELS, xssConfig, 0, null);
    const html = eqPaneHTML(view);
    expect(html).toContain('&lt;b&gt;Kick&lt;/b&gt;');
    expect(html).not.toContain('<b>Kick</b>');
  });

  it('renders nothing for a null primary (defensive — empty channels)', () => {
    const view = eqPaneView([], config, null, null);
    const html = eqPaneHTML(view);
    expect(html).not.toContain('Room —');
  });

  it('renders 48 grid bars and still exactly 7 .veq-label spans when the channel carries a curve (#667)', () => {
    const gridChannel: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve: Array.from({ length: 48 }, () => -30) };
    const view = eqPaneView([gridChannel], config, 0, null);
    const html = eqPaneHTML(view);
    expect((html.match(/data-band="/g) || [])).toHaveLength(48);
    expect((html.match(/<span class="veq-label(?: loud)?" /g) || [])).toHaveLength(7);
  });

  it('marks the loudest band label from the band curve, not the grid, when a curve is present (#667)', () => {
    const gridChannel: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve: Array.from({ length: 48 }, () => -30) };
    const view = eqPaneView([gridChannel], config, 0, null);
    const html = eqPaneHTML(view);
    // LIVE_CHANNELS[0]'s loudest band is "mid" (index 3, see eqPanePatchPlan tests).
    const labelMatch = html.match(/<span class="veq-label(?: loud)?" [^>]*>/g) || [];
    expect(labelMatch[3]).toContain('loud');
    expect(labelMatch.filter((l) => l.includes('loud'))).toHaveLength(1);
  });

  it('renders byte-identical 7-band structure when the channel carries no curve (regression guard)', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null);
    const html = eqPaneHTML(view);
    expect((html.match(/data-band="/g) || [])).toHaveLength(7);
  });

  it('renders "Room — <device name>" when the secondary override owns the room (#460)', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: LIVE_CHANNELS[1], label: 'MacBook Pro Microphone' });
    const html = eqPaneHTML(view);
    expect(html).toContain('Room — MacBook Pro Microphone');
    expect(html).not.toContain('Room — Kick');
  });

  it('escapes the override device name (#460)', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: LIVE_CHANNELS[1], label: '<Evil> & "Mic"' });
    const html = eqPaneHTML(view);
    expect(html).toContain('Room — &lt;Evil&gt; &amp; &quot;Mic&quot;');
    expect(html).not.toContain('<Evil>');
  });

  it('feeds the primary section from the override channel, not the board strip (#460)', () => {
    // LIVE_CHANNELS[1]'s loudest band is bass (index 1); the board strip 0's is
    // mid (index 3) — the loud label proves whose data the Room section renders.
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: LIVE_CHANNELS[1], label: 'USB Mic' });
    const html = eqPaneHTML(view);
    const primarySection = html.split('eq-pane-secondary')[0];
    const labelMatch = primarySection.match(/<span class="veq-label(?: loud)?" [^>]*>/g) || [];
    expect(labelMatch[1]).toContain('loud');
    expect(labelMatch[3]).not.toContain('loud');
  });
});

describe('eqPaneSignature', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2, label: 'Vocals' },
  ];

  function inspector(overrides: Partial<EqPaneInspectorView> = {}): EqPaneInspectorView {
    return {
      selectedIndex: 1,
      strip: { kind: 'stereo', a: 2, b: 3, armed: true, label: 'Keys' },
      deviceChannels: 8,
      disabled: false,
      playbackTrack: { kind: 'stereo', label: 'Keys playback' },
      playbackRoute: [4],
      playbackDeviceChannels: 8,
      levelTiles: {
        rms: '-20.0', rmsTone: '', peak: '-4.0', peakTone: '',
        headroom: '4.0', headroomTone: '', clip: 'OK', clipTone: '',
      },
      ...overrides,
    };
  }

  it('keeps inspector-aware consecutive meter ticks eligible for arc, bar, and level-tile patches (#1066)', () => {
    const roomA: LiveMeterChannel = { ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, mid: -24 }, rms: -30 };
    const roomB: LiveMeterChannel = { ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, mid: -8 }, rms: -12 };
    const selectedA: LiveMeterChannel = { ...LIVE_CHANNELS[1], bands: { ...LIVE_CHANNELS[1].bands, bass: -30 }, rms: -28 };
    const selectedB: LiveMeterChannel = { ...LIVE_CHANNELS[1], bands: { ...LIVE_CHANNELS[1].bands, bass: -6 }, rms: -10 };
    const overrideA: EqPaneRoomOverride = { ch: roomA, label: 'Room Mic' };
    const overrideB: EqPaneRoomOverride = { ch: roomB, label: 'Room Mic' };
    const viewA = eqPaneView([roomA, selectedA], config, 0, 1, overrideA, inspector());
    const viewB = eqPaneView([roomB, selectedB], config, 0, 1, overrideB, inspector({ levelTiles: {
      rms: '-10.0', rmsTone: 'issue', peak: '-1.0', peakTone: 'issue',
      headroom: '1.0', headroomTone: 'issue', clip: 'CLIP', clipTone: 'issue',
    } }));

    expect(eqPaneSignature(viewA)).toBe(eqPaneSignature(viewB));
    expect(eqPanePatchPlan(viewA).primary!.curve.db).not.toEqual(eqPanePatchPlan(viewB).primary!.curve.db);
    expect(eqPanePatchPlan(viewA).secondary!.curve.db).not.toEqual(eqPanePatchPlan(viewB).secondary!.curve.db);
    expect(viewA.inspector?.levelTiles).not.toEqual(viewB.inspector?.levelTiles);
    expect(viewA.primary).toMatchObject({ idx: EQ_PANE_ROOM_OVERRIDE_IDX, label: 'Room Mic' });
    expect(viewB.primary).toMatchObject({ idx: EQ_PANE_ROOM_OVERRIDE_IDX, label: 'Room Mic' });
  });

  it('rebuilds inspector markup for selected strip and rendered binding changes (#1066)', () => {
    const base = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector());
    const selected = eqPaneView(LIVE_CHANNELS, config, 0, 0, null, inspector({ selectedIndex: 0 }));
    const strip = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector({ strip: { kind: 'mono', a: 1, b: 2, armed: false, label: 'Lead Vox' } }));
    const deviceChannels = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector({ deviceChannels: 16 }));
    const playback = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector({
      playbackTrack: null, playbackRoute: null, playbackDeviceChannels: 0,
    }));
    const noPlaybackRoute = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector({
      playbackTrack: null, playbackRoute: [6], playbackDeviceChannels: 24,
    }));
    const disabled = eqPaneView(LIVE_CHANNELS, config, 0, 1, null, inspector({ disabled: true }));

    for (const changed of [selected, strip, deviceChannels, playback, disabled]) {
      expect(eqPaneSignature(changed)).not.toBe(eqPaneSignature(base));
    }
    expect(eqPaneSignature(noPlaybackRoute)).toBe(eqPaneSignature(playback));
    expect(eqPaneInspectorHTML(strip.inspector)).toContain('Lead Vox');
    expect(eqPaneInspectorHTML(deviceChannels.inspector)).toContain('<option value="15">16</option>');
    expect(eqPaneInspectorHTML(playback.inspector)).toContain('eq-pane-inspector-output-notice');
    expect(eqPaneInspectorHTML(disabled.inspector)).toContain('Channel name" value="Keys" disabled');
  });

  it('is stable across two views with the same idx/label/flag', () => {
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    expect(a).toBe(b);
  });

  it('changes when the primary idx changes', () => {
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 1, null));
    expect(a).not.toBe(b);
  });

  it('changes when the secondary idx changes', () => {
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    expect(a).not.toBe(b);
  });

  it('changes when secondaryIsPrimary flips even if idx stays put', () => {
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 1, 1));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    expect(a).not.toBe(b);
  });

  it('changes when a label changes for the same idx', () => {
    const relabeled: StripConfig[] = [{ ...config[0], label: 'Kick Drum' }, config[1]];
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, relabeled, 0, null));
    expect(a).not.toBe(b);
  });

  it('does not crash and produces a stable signature when primary/secondary are both null (empty channels)', () => {
    const a = eqPaneSignature(eqPaneView([], config, null, null));
    const b = eqPaneSignature(eqPaneView([], config, null, null));
    expect(a).toBe(b);
    expect(a).toBe(':: ::false:');
  });

  it('changes when a channel gains a curve (idle → first live tick, #667)', () => {
    const withoutCurve = eqPaneView(LIVE_CHANNELS, config, 0, null);
    const gridChannel: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve: Array.from({ length: 48 }, () => -30) };
    const withCurve = eqPaneView([gridChannel, LIVE_CHANNELS[1]], config, 0, null);
    expect(eqPaneSignature(withoutCurve)).not.toBe(eqPaneSignature(withCurve));
  });

  it('is stable across two ticks that both carry curves (#667)', () => {
    const gridChannelA: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve: Array.from({ length: 48 }, () => -30) };
    const gridChannelB: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve: Array.from({ length: 48 }, () => -10) };
    const a = eqPaneSignature(eqPaneView([gridChannelA, LIVE_CHANNELS[1]], config, 0, null));
    const b = eqPaneSignature(eqPaneView([gridChannelB, LIVE_CHANNELS[1]], config, 0, null));
    expect(a).toBe(b);
  });

  it('changes when the room override activates and restores when it deactivates (#460)', () => {
    const override: EqPaneRoomOverride = { ch: LIVE_CHANNELS[1], label: 'MacBook Pro Microphone' };
    const board = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null));
    const active = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, override));
    const restored = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, null));
    expect(active).not.toBe(board);
    expect(restored).toBe(board);
  });

  it('changes when the override device name changes (#460)', () => {
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: LIVE_CHANNELS[1], label: 'USB Mic' }));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: LIVE_CHANNELS[1], label: 'Built-in Mic' }));
    expect(a).not.toBe(b);
  });

  it('is stable across two override ticks with the same device (#460 — patch, not rebuild, mid-stream)', () => {
    const tickA: LiveMeterChannel = { ...LIVE_CHANNELS[1], rms: -30 };
    const tickB: LiveMeterChannel = { ...LIVE_CHANNELS[1], rms: -12 };
    const a = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: tickA, label: 'USB Mic' }));
    const b = eqPaneSignature(eqPaneView(LIVE_CHANNELS, config, 0, null, { ch: tickB, label: 'USB Mic' }));
    expect(a).toBe(b);
  });
});

describe('eqPanePatchPlan', () => {
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 1, label: 'Kick' },
    { kind: 'mono', a: 1, b: 2, label: 'Vocals' },
  ];

  it('produces a primary curve/loudestIdx/arc when primary resolves', () => {
    const view = eqPaneView(LIVE_CHANNELS, config, 0, null);
    const plan = eqPanePatchPlan(view);
    expect(plan.primary).not.toBeNull();
    expect(plan.primary!.curve.db).toHaveLength(7);
    // LIVE_CHANNELS[0] fixture: mid (-12) is the loudest of the 7 bands (index 3).
    expect(plan.primary!.loudestIdx).toBe(3);
    expect(typeof plan.primary!.arc).toBe('object');
  });

  it('primary/secondary are both null when there is nothing to plan', () => {
    const view = eqPaneView([], config, null, null);
    const plan = eqPanePatchPlan(view);
    expect(plan.primary).toBeNull();
    expect(plan.secondary).toBeNull();
  });

  it('secondary is null when no channel is selected, non-null once one is', () => {
    const noSecondary = eqPanePatchPlan(eqPaneView(LIVE_CHANNELS, config, 0, null));
    expect(noSecondary.secondary).toBeNull();

    const withSecondary = eqPanePatchPlan(eqPaneView(LIVE_CHANNELS, config, 0, 1));
    expect(withSecondary.secondary).not.toBeNull();
    expect(withSecondary.secondary!.curve.db).toHaveLength(7);
  });

  it('floors non-finite bands to -120 in the derived curve, same as retired strip patch plan', () => {
    const withNaN = [{ ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, sub_bass: NaN } }, LIVE_CHANNELS[1]];
    const plan = eqPanePatchPlan(eqPaneView(withNaN, config, 0, null));
    expect(plan.primary!.curve.db[0]).toBe(-120);
  });

  it('gridDb is null when the channel carries no curve', () => {
    const plan = eqPanePatchPlan(eqPaneView(LIVE_CHANNELS, config, 0, null));
    expect(plan.primary!.gridDb).toBeNull();
  });

  it('gridDb equals the floored 48-point curve when present; loudestIdx still comes from bands (#667)', () => {
    const curve = Array.from({ length: 48 }, () => -30);
    curve[10] = NaN;
    const gridChannel: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve };
    const plan = eqPanePatchPlan(eqPaneView([gridChannel, LIVE_CHANNELS[1]], config, 0, null));
    expect(plan.primary!.gridDb).toEqual(curve.map((v) => (Number.isFinite(v) ? v : -120)));
    // LIVE_CHANNELS[0]'s loudest band is "mid" (index 3) regardless of the grid curve.
    expect(plan.primary!.loudestIdx).toBe(3);
  });

  it("arc's underlying curve uses grid freqs when a curve is present", () => {
    const curve = Array.from({ length: 48 }, () => -30);
    const gridChannel: LiveMeterChannel = { ...LIVE_CHANNELS[0], curve };
    const plan = eqPanePatchPlan(eqPaneView([gridChannel, LIVE_CHANNELS[1]], config, 0, null));
    expect(plan.primary!.curve.freqs).toBe(ANALYZER_GRID_FREQS);
    expect(plan.primary!.curve.db).toHaveLength(48);
  });
});

describe('app.css: single-row EQ band labels (#666)', () => {
  it('no longer drops alternating labels to a second row', () => {
    expect(css).not.toMatch(/\.veq-label:nth-child/);
  });

  it('makes .veq-labels a size container for the collide-aware breakpoint', () => {
    expect(css).toMatch(/\.veq-labels\s*\{[^}]*container-type:\s*inline-size/);
  });

  it('swaps full labels for short forms below the derived width threshold', () => {
    const containerBlock = css.match(/@container[^{]*\{[^]*?\.veq-label-abbr[^]*?\}\s*\}/);
    expect(containerBlock).not.toBeNull();
    const block = containerBlock ? containerBlock[0] : '';
    expect(block).toContain('.veq-label-full { display:none; }');
    expect(block).toContain('.veq-label-abbr { display:inline; }');
  });
});
