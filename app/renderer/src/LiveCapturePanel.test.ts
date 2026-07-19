// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import LiveCapturePanel, { type LiveCapturePanelProps } from './LiveCapturePanel';
import {
  deviceOptionLabel,
  deviceChannelCount,
  liveMetersHTML,
  measurementSourceOptionLabel,
  type LiveDevice,
  type StripConfig,
  type StripView,
  type PanelView,
  type ChannelWindowData,
  type MeterData,
} from './live-capture-panel';

const devices: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 18, default_sr: 48000 },
  { index: 1, name: 'Built-in Microphone', channels: 2, default_sr: 44100 },
];

// Shaped like the e2e LIVE_CHANNELS fixture (live-capture.spec.ts:79-84).
const FIXTURE_CHANNELS: ChannelWindowData[] = [
  { index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 8000,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

const meterEvent: MeterData = { type: 'meter', ts: 0, channels: FIXTURE_CHANNELS };

const channelsConfig: StripConfig[] = [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }];

function baseProps(overrides: Partial<LiveCapturePanelProps> = {}): LiveCapturePanelProps {
  return {
    devices,
    selectedDevice: '',
    channels: channelsConfig,
    isLive: false,
    onStart: () => {},
    onStop: () => {},
    meterEvents: [meterEvent],
    ...overrides,
  };
}

function renderMarkup(props: LiveCapturePanelProps): string {
  return renderToString(createElement(LiveCapturePanel, props));
}

function findById(node: ReactNode, id: string): ReactElement<{ id?: string; onClick?: () => void }> | null {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactElement<{ id?: string; children?: ReactNode }>;
  if (el.props?.id === id) return el as ReactElement<{ id?: string; onClick?: () => void }>;
  return findById(el.props?.children ?? null, id);
}

describe('LiveCapturePanel', () => {
  it('renders the exact liveMetersHTML output for the equivalent StripView/PanelView inputs (markup identity)', () => {
    const props = baseProps();
    const panel: PanelView = { deviceChannels: deviceChannelCount(props.selectedDevice, devices), liveRunning: props.isLive, liveMode: 'monitor', groups: [] };
    const stripViews: StripView[] = FIXTURE_CHANNELS.map((ch, idx) => ({
      strip: channelsConfig[idx] ?? null,
      displayName: ch.name,
      collapsed: false,
      armed: !!channelsConfig[idx] && channelsConfig[idx].armed !== false,
      groupIndex: -1,
      groupCollapsed: false,
      instrumentProfileId: 'generic',
      instrumentAuto: true,
    }));
    const expectedMeters = liveMetersHTML(FIXTURE_CHANNELS, stripViews, panel);

    const html = renderMarkup(props);

    expect(html).toContain(expectedMeters);
    expect(html).toContain('Default Device');
    expect(html).toContain(deviceOptionLabel(devices[0]));
    expect(html).toContain(deviceOptionLabel(devices[1]));
  });

  it('shows the start button and hides stop when not live', () => {
    const html = renderMarkup(baseProps({ isLive: false }));
    expect(html).toMatch(/id="live-start-btn"[^>]*>/);
    expect(html).not.toMatch(/id="live-start-btn"[^>]*style="display:none"/);
    expect(html).toMatch(/id="live-stop-btn"[^>]*style="display:none"/);
  });

  it('hides the start button and shows stop when live', () => {
    const html = renderMarkup(baseProps({ isLive: true }));
    expect(html).toMatch(/id="live-start-btn"[^>]*style="display:none"/);
    expect(html).toMatch(/id="live-stop-btn"[^>]*style="display:inline-flex"/);
  });

  it('shows the waiting placeholder and no meters when there are no meter events', () => {
    const html = renderMarkup(baseProps({ meterEvents: [] }));
    expect(html).toContain('Waiting for live audio…');
    expect(html).not.toContain('sb-live-meters');
  });

  it('shows the waiting placeholder when every event has an empty channel list', () => {
    const html = renderMarkup(baseProps({ meterEvents: [{ type: 'meter', ts: 0, channels: [] }] }));
    expect(html).toContain('Waiting for live audio…');
  });

  it('treats a strip with no armed field as armed by default (mirrors window.armState.isArmed)', () => {
    const html = renderMarkup(baseProps({ liveMode: 'record' }));
    // channelsConfig entries carry no `armed` field; default-armed means both
    // render as pressed/"Disarm", not unarmed/"Arm".
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-pressed="false"');
  });

  it('honors an explicit armed:false strip as disarmed', () => {
    const html = renderMarkup(baseProps({ liveMode: 'record', channels: [{ kind: 'mono', a: 0, b: 1, armed: false }, channelsConfig[1]] }));
    expect(html).toContain('aria-pressed="false"');
  });

  it('resolves each strip\'s groupIndex from the groups prop', () => {
    const html = renderMarkup(baseProps({ groups: [{ name: 'Drums', members: [1] }] }));
    expect(html).toContain('<option value="0" selected>Drums</option>');
  });

  it('resolves each strip\'s groupCollapsed from the owning group (#483)', () => {
    const html = renderMarkup(baseProps({ groups: [{ name: 'Drums', members: [1], collapsed: true }] }));
    expect(html).toMatch(/class="live-ch[^"]*\bgroup-collapsed\b[^"]*" data-ch="1"/);
    expect(html).not.toMatch(/class="live-ch[^"]*\bgroup-collapsed\b[^"]*" data-ch="0"/);
  });

  it('picks the last event with a non-empty channel list as the latest tick', () => {
    const html = renderMarkup(baseProps({
      meterEvents: [meterEvent, { type: 'meter', ts: 1, channels: [] }],
    }));
    // Trailing empty-channel event is skipped; the real tick's strip names still render.
    expect(html).toContain('Vocals');
  });

  it('falls back to a null strip when a tick channel has no matching config entry', () => {
    const html = renderMarkup(baseProps({ channels: [] }));
    // No strip configured for either channel -> both default to mono, channel 0.
    expect((html.match(/<option value="0" selected>Ch 1<\/option>/g) || []).length).toBe(2);
  });

  it('falls back to "Ch N" when a tick channel carries no name', () => {
    const nameless = { ...FIXTURE_CHANNELS[0], name: undefined as unknown as string };
    const html = renderMarkup(baseProps({ meterEvents: [{ type: 'meter', ts: 0, channels: [nameless, FIXTURE_CHANNELS[1]] }] }));
    expect(html).toContain('title="Click to rename">Ch 1</span>');
  });

  it('wires #live-start-btn/#live-stop-btn onClick to onStart/onStop without touching the DOM', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const element = LiveCapturePanel(baseProps({ onStart, onStop }));

    const startBtn = findById(element, 'live-start-btn');
    const stopBtn = findById(element, 'live-stop-btn');

    expect(startBtn?.props.onClick).toBe(onStart);
    expect(stopBtn?.props.onClick).toBe(onStop);
  });

  describe('measurement source select', () => {
    it('renders the default option plus one option per configured strip', () => {
      const html = renderMarkup(baseProps());
      expect(html).toContain('id="measurement-source"');
      expect(html).toContain('First track (default)');
      channelsConfig.forEach((strip, i) => {
        expect(html).toContain(`>${measurementSourceOptionLabel(strip, i)}<`);
      });
    });

    it('marks the option matching measurementSource as selected', () => {
      const html = renderMarkup(baseProps({ measurementSource: 1 }));
      expect(html).toMatch(/<option value="1"[^>]*selected[^>]*>/);
    });

    it('defaults to the "First track (default)" option when measurementSource is null', () => {
      const html = renderMarkup(baseProps({ measurementSource: null }));
      expect(html).toMatch(/<option value=""[^>]*selected[^>]*>First track \(default\)<\/option>/);
    });

    it('is not disabled while live (mid-capture source switching, #457)', () => {
      const html = renderMarkup(baseProps({ isLive: true }));
      expect(html).not.toMatch(/id="measurement-source"[^>]*disabled/);
    });

    it('is not disabled when not live', () => {
      const html = renderMarkup(baseProps({ isLive: false }));
      expect(html).not.toMatch(/id="measurement-source"[^>]*disabled/);
    });

    it('option values carry no device indices or names', () => {
      const html = renderMarkup(baseProps());
      const selectMatch = html.match(/<select id="measurement-source"[^>]*>([\s\S]*?)<\/select>/);
      expect(selectMatch).toBeTruthy();
      expect(selectMatch![1]).not.toContain('Scarlett');
      expect(selectMatch![1]).not.toContain('Built-in Microphone');
    });

    it('wires onChange to onSelectMeasurementSource, mapping "" to null and a digit string to a number', () => {
      const onSelectMeasurementSource = vi.fn();
      const element = LiveCapturePanel(baseProps({ onSelectMeasurementSource }));
      const select = findById(element, 'measurement-source') as ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | null;
      expect(select).toBeTruthy();
      select!.props.onChange!({ target: { value: '1' } });
      expect(onSelectMeasurementSource).toHaveBeenCalledWith(1);
      select!.props.onChange!({ target: { value: '' } });
      expect(onSelectMeasurementSource).toHaveBeenCalledWith(null);
    });
  });
});
