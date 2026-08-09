// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  deviceIndexForName,
  applyStartResult,
  applyStreamEnded,
  reconnectDecision,
  secondaryDeviceOptionsHTML,
  secondaryStatusHTML,
  alignmentWarningHTML,
  roomFeed,
  roomPaneOverride,
  parseCaptureOpts,
  type SecondaryMeasurementState,
} from './measurement-device-state';
import type { LiveDevice, LiveEvent, StripConfig, ChannelWindowData } from './live-capture-panel';

function dev(index: number, name: string, channels = 2): LiveDevice {
  return { index, name, channels, default_sr: 48000 };
}

const DEVICES: LiveDevice[] = [dev(0, 'Built-in Microphone'), dev(2, 'USB Measurement Mic')];

function state(over: Partial<SecondaryMeasurementState> = {}): SecondaryMeasurementState {
  return { status: 'off', deviceName: '', ...over };
}

describe('deviceIndexForName', () => {
  it('resolves a present device name to its index string', () => {
    expect(deviceIndexForName(DEVICES, 'USB Measurement Mic')).toBe('2');
  });

  it('returns null for an absent device (no fallback)', () => {
    expect(deviceIndexForName(DEVICES, 'Ghost Interface')).toBeNull();
  });

  it('returns null for an empty preferred name', () => {
    expect(deviceIndexForName(DEVICES, '')).toBeNull();
  });
});

describe('applyStartResult', () => {
  it('moves to active on success, preserving the device name', () => {
    const next = applyStartResult(state({ status: 'starting', deviceName: 'USB Measurement Mic' }), {
      success: true,
    });
    expect(next).toEqual({ status: 'active', deviceName: 'USB Measurement Mic' });
  });

  it('moves to blocked with the micAccess when the grant is missing', () => {
    const next = applyStartResult(state({ status: 'starting', deviceName: 'USB Measurement Mic' }), {
      success: false,
      micAccess: 'denied',
      error: 'Microphone access is not granted.',
    });
    expect(next).toEqual({ status: 'blocked', deviceName: 'USB Measurement Mic', micAccess: 'denied' });
  });

  it('moves to disconnected with the error text on any other failure', () => {
    const next = applyStartResult(state({ status: 'starting', deviceName: 'USB Measurement Mic' }), {
      success: false,
      error: 'stream.py exited with code 1',
    });
    expect(next).toEqual({
      status: 'disconnected',
      deviceName: 'USB Measurement Mic',
      error: 'stream.py exited with code 1',
    });
  });
});

describe('applyStreamEnded', () => {
  it('an expected stop moves to off', () => {
    expect(applyStreamEnded(state({ status: 'active', deviceName: 'Mic' }), true)).toEqual({
      status: 'off',
      deviceName: 'Mic',
    });
  });

  it('an unexpected end while active moves to disconnected', () => {
    expect(applyStreamEnded(state({ status: 'active', deviceName: 'Mic' }), false)).toEqual({
      status: 'disconnected',
      deviceName: 'Mic',
    });
  });

  it('an unexpected end while starting moves to disconnected', () => {
    expect(applyStreamEnded(state({ status: 'starting', deviceName: 'Mic' }), false)).toEqual({
      status: 'disconnected',
      deviceName: 'Mic',
    });
  });

  it('leaves an already-off/blocked state unchanged on an unexpected end', () => {
    const blocked = state({ status: 'blocked', deviceName: 'Mic', micAccess: 'denied' });
    expect(applyStreamEnded(blocked, false)).toBe(blocked);
  });
});

describe('reconnectDecision', () => {
  it('restarts and moves to starting when the remembered device reappears', () => {
    const result = reconnectDecision(
      state({ status: 'disconnected', deviceName: 'USB Measurement Mic' }),
      DEVICES,
    );
    expect(result).toEqual({
      state: { status: 'starting', deviceName: 'USB Measurement Mic' },
      shouldRestart: true,
    });
  });

  it('does not restart while the device is still absent', () => {
    const s = state({ status: 'disconnected', deviceName: 'USB Measurement Mic' });
    const result = reconnectDecision(s, [dev(0, 'Built-in Microphone')]);
    expect(result).toEqual({ state: s, shouldRestart: false });
  });

  it('does not act when not disconnected', () => {
    const s = state({ status: 'active', deviceName: 'USB Measurement Mic' });
    expect(reconnectDecision(s, DEVICES)).toEqual({ state: s, shouldRestart: false });
  });

  it('does not act when no device is remembered', () => {
    const s = state({ status: 'disconnected', deviceName: '' });
    expect(reconnectDecision(s, DEVICES)).toEqual({ state: s, shouldRestart: false });
  });
});

describe('secondaryDeviceOptionsHTML', () => {
  it('emits a None sentinel plus one option per device', () => {
    const html = secondaryDeviceOptionsHTML(DEVICES, '');
    expect(html).toContain('<option value="" selected>None (use board channel)</option>');
    expect(html).toContain('<option value="0">Built-in Microphone</option>');
    expect(html).toContain('<option value="2">USB Measurement Mic</option>');
  });

  it('marks the preferred device selected by name', () => {
    const html = secondaryDeviceOptionsHTML(DEVICES, 'USB Measurement Mic');
    expect(html).toContain('<option value="2" selected>USB Measurement Mic</option>');
    expect(html).not.toContain('value=""  selected');
    expect(html).toContain('<option value="">None (use board channel)</option>');
  });

  it('escapes device names', () => {
    const html = secondaryDeviceOptionsHTML([dev(1, '<Evil> & "Mic"')], '');
    expect(html).toContain('&lt;Evil&gt; &amp; &quot;Mic&quot;');
    expect(html).not.toContain('<Evil>');
  });
});

describe('secondaryStatusHTML', () => {
  it('blocked names the System Settings fix', () => {
    const html = secondaryStatusHTML(state({ status: 'blocked', deviceName: 'Mic', micAccess: 'denied' }));
    expect(html).toContain('System Settings');
    expect(html).toContain('Microphone');
  });

  it('disconnected names the device and tells the user to reconnect', () => {
    const html = secondaryStatusHTML(state({ status: 'disconnected', deviceName: 'USB Mic' }));
    expect(html).toContain('USB Mic');
    expect(html).toContain('reconnect the device to resume');
  });

  it('active names the room device', () => {
    expect(secondaryStatusHTML(state({ status: 'active', deviceName: 'USB Mic' }))).toContain(
      'Measuring room via ‘USB Mic’',
    );
  });

  it('escapes the device name in status text', () => {
    const html = secondaryStatusHTML(state({ status: 'active', deviceName: '<x>' }));
    expect(html).toContain('&lt;x&gt;');
  });

  it('returns an empty line when off', () => {
    expect(secondaryStatusHTML(state({ status: 'off', deviceName: '' }))).toBe('');
  });

  it('returns a neutral starting line', () => {
    expect(secondaryStatusHTML(state({ status: 'starting', deviceName: 'Mic' }))).toContain('Starting');
  });
});

describe('alignmentWarningHTML', () => {
  it('warns about time alignment and points at the Aggregate Device', () => {
    const html = alignmentWarningHTML();
    expect(html).toContain('not be time-aligned');
    expect(html).toContain('Aggregate Device');
    expect(html).toContain('Audio MIDI Setup');
  });
});

describe('roomFeed', () => {
  const board: LiveEvent[] = [{ window: 1 } as unknown as LiveEvent];
  const secondary: LiveEvent[] = [{ window: 9 } as unknown as LiveEvent];
  const config: StripConfig[] = [
    { kind: 'mono', a: 0, b: 0, label: 'Kick' },
    { kind: 'mono', a: 1, b: 1, label: 'Vox' },
  ];

  it('returns the board feed when the secondary source is inactive', () => {
    const feed = roomFeed(false, secondary, 'USB Mic', board, 1, config);
    expect(feed.windows).toBe(board);
    expect(feed.source).toBe(1);
    expect(feed.config).toBe(config);
    expect(feed.badge).toContain('Measuring:');
  });

  it('switches to the secondary channel-0 mono feed when active', () => {
    const feed = roomFeed(true, secondary, 'USB Mic', board, 1, config);
    expect(feed.windows).toBe(secondary);
    expect(feed.source).toBe(0);
    expect(feed.config).toEqual([{ kind: 'mono', a: 0, b: 0 }]);
    expect(feed.badge).toBe('Measuring: USB Mic (secondary — not time-aligned)');
  });
});

describe('roomPaneOverride (#460 EQ-pane visual swap)', () => {
  function ch(rms: number): ChannelWindowData {
    return {
      index: 0, name: 'Room', kind: 'mono', rms, peak: rms + 6, clipping: false,
      centroid: 900, rolloff: 8000,
      bands: { sub_bass: -44, bass: -36, low_mid: -30, mid: -26, high_mid: -34, presence: -46, brilliance: -62 },
    };
  }
  const windowTick = { window: 1, ts: 1, channels: [ch(-40)], masking: [] } as unknown as LiveEvent;

  it('returns null while the secondary source is inactive (board pane byte-identical)', () => {
    expect(roomPaneOverride(false, [windowTick], [ch(-20)], 'USB Mic')).toBeNull();
  });

  it('serves the latest meter-tick channel 0 with the device-name label when active', () => {
    const meter = [ch(-20)];
    expect(roomPaneOverride(true, [windowTick], meter, 'USB Mic')).toEqual({
      ch: meter[0],
      label: 'USB Mic',
    });
  });

  it('falls back to the last window tick before the first meter tick lands', () => {
    const override = roomPaneOverride(true, [windowTick], null, 'USB Mic');
    expect(override?.ch).toBe((windowTick as { channels: ChannelWindowData[] }).channels[0]);
    expect(override?.label).toBe('USB Mic');
  });

  it('returns null when active but no reading exists yet (defensive)', () => {
    expect(roomPaneOverride(true, [], null, 'USB Mic')).toBeNull();
  });
});

describe('parseCaptureOpts (#724 code review)', () => {
  it('parses given windowSecs/meterInterval string values', () => {
    expect(parseCaptureOpts('5', '200')).toEqual({ windowSecs: 5, intervalSecs: 0.2 });
  });

  it('falls back to windowSecs 3 / meterInterval 100ms when values are undefined', () => {
    expect(parseCaptureOpts(undefined, undefined)).toEqual({ windowSecs: 3, intervalSecs: 0.1 });
  });
});
