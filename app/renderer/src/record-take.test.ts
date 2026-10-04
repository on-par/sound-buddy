// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  channelOptions,
  defaultChannels,
  validChannels,
  resolveRecordSources,
  recordSourceRows,
  recordTakeView,
  savedFileNames,
  savedFilePaths,
  takeName,
  RECORD_MAIN_NOT_FOUND_ERROR,
  RECORD_MEASUREMENT_NOT_FOUND_ERROR,
} from './record-take';

const BOARD = { index: 3, name: 'X32 USB', channels: 32, default_sr: 48000 };
const ROOM = { index: 5, name: 'UMIK-1', channels: 1, default_sr: 48000 };
const STEREO_MIC = { index: 6, name: 'Zoom H2n', channels: 2, default_sr: 48000 };
const DEVICES = [BOARD, ROOM, STEREO_MIC];

describe('channelOptions (#1648)', () => {
  it('offers only mono channel 1 for a one-input device', () => {
    expect(channelOptions(1)).toEqual([{ value: '0', label: 'Ch 1 (mono)' }]);
  });

  it('offers every mono channel then every odd-even stereo pair', () => {
    expect(channelOptions(4)).toEqual([
      { value: '0', label: 'Ch 1 (mono)' },
      { value: '1', label: 'Ch 2 (mono)' },
      { value: '2', label: 'Ch 3 (mono)' },
      { value: '3', label: 'Ch 4 (mono)' },
      { value: '0-1', label: 'Ch 1–2 (stereo)' },
      { value: '2-3', label: 'Ch 3–4 (stereo)' },
    ]);
  });

  it('leaves the odd last channel mono-only', () => {
    expect(channelOptions(3).map((o) => o.value)).toEqual(['0', '1', '2', '0-1']);
  });

  it('treats a zero/unknown input count as one input', () => {
    expect(channelOptions(0)).toEqual([{ value: '0', label: 'Ch 1 (mono)' }]);
  });
});

describe('defaultChannels / validChannels (#1648)', () => {
  it('defaults to mono for one input and the first stereo pair otherwise ("as the device presents")', () => {
    expect(defaultChannels(1)).toBe('0');
    expect(defaultChannels(2)).toBe('0-1');
    expect(defaultChannels(32)).toBe('0-1');
  });

  it('keeps a choice the device offers', () => {
    expect(validChannels('16-17', 32)).toBe('16-17');
  });

  it('falls back to the default for no choice or one the device cannot offer', () => {
    expect(validChannels(null, 2)).toBe('0-1');
    expect(validChannels('16-17', 2)).toBe('0-1');
  });
});

describe('resolveRecordSources (#1648)', () => {
  it('records Main from the Input Device and Measurement from the measurement device, with their channel choices', () => {
    expect(resolveRecordSources({
      devices: DEVICES,
      selectedDevice: '3',
      measurementDeviceName: 'UMIK-1',
      mainChannels: '16-17',
      measurementChannels: null,
    })).toEqual({
      ok: true,
      main: { device: '3', channels: '16-17' },
      measurement: { device: '5', channels: '0' },
      labels: { main: 'X32 USB · Ch 17–18 (stereo)', measurement: 'UMIK-1 · Ch 1 (mono)' },
    });
  });

  it('records a stereo measurement device as stereo by default', () => {
    const result = resolveRecordSources({
      devices: DEVICES, selectedDevice: '3', measurementDeviceName: 'Zoom H2n', mainChannels: null, measurementChannels: null,
    });
    expect(result).toMatchObject({ ok: true, main: { channels: '0-1' }, measurement: { device: '6', channels: '0-1' } });
  });

  it('uses the system default input (mono) for an unset device', () => {
    expect(resolveRecordSources({
      devices: DEVICES, selectedDevice: '', measurementDeviceName: '', mainChannels: '0-1', measurementChannels: null,
    })).toEqual({
      ok: true,
      main: { device: '', channels: '0' },
      measurement: { device: '', channels: '0' },
      labels: { main: 'System default input · Ch 1 (mono)', measurement: 'System default input · Ch 1 (mono)' },
    });
  });

  it('refuses when the chosen Input Device is no longer connected', () => {
    expect(resolveRecordSources({
      devices: [ROOM], selectedDevice: '3', measurementDeviceName: 'UMIK-1', mainChannels: null, measurementChannels: null,
    })).toEqual({ ok: false, error: RECORD_MAIN_NOT_FOUND_ERROR });
  });

  it('refuses when the remembered measurement device is not connected', () => {
    expect(resolveRecordSources({
      devices: [BOARD], selectedDevice: '3', measurementDeviceName: 'UMIK-1', mainChannels: null, measurementChannels: null,
    })).toEqual({ ok: false, error: RECORD_MEASUREMENT_NOT_FOUND_ERROR });
  });

  it('says where to fix a missing device', () => {
    expect(RECORD_MAIN_NOT_FOUND_ERROR).toMatch(/Settings ▸ Audio/);
    expect(RECORD_MEASUREMENT_NOT_FOUND_ERROR).toMatch(/Settings ▸ Audio/);
  });
});

describe('recordTakeView (#1648)', () => {
  const idle = { phase: 'idle' as const, startedAt: null, lastTake: null, error: null };

  it('is an enabled idle Record for Main + Measurement', () => {
    expect(recordTakeView(idle, 0)).toEqual({
      button: { phase: 'idle', disabled: false, ariaLabel: 'Record Main + Measurement — press to start' },
      statusText: null,
      saved: null,
      error: null,
    });
  });

  it('is disabled while starting', () => {
    expect(recordTakeView({ ...idle, phase: 'starting' }, 0)).toMatchObject({
      button: { phase: 'idle', disabled: true, ariaLabel: 'Starting recording' },
      statusText: 'Starting…',
    });
  });

  it('shows elapsed time while recording, with an enabled Stop', () => {
    expect(recordTakeView({ ...idle, phase: 'recording', startedAt: 1_000 }, 66_000)).toMatchObject({
      button: { phase: 'recording', disabled: false, ariaLabel: 'Recording Main + Measurement — press to stop' },
      statusText: 'Recording · 1:05',
    });
  });

  it('counts from zero when the start time is unknown', () => {
    expect(recordTakeView({ ...idle, phase: 'recording' }, 66_000).statusText).toBe('Recording · 0:00');
  });

  it('is a disabled stopping button while the files finalize', () => {
    expect(recordTakeView({ ...idle, phase: 'stopping' }, 0)).toMatchObject({
      button: { phase: 'stopping', disabled: true, ariaLabel: 'Stopping recording' },
      statusText: 'Saving…',
    });
  });

  it('offers the last take once idle again, and hides it while a new take runs', () => {
    const lastTake = { dir: '/m/sound-buddy-20261004-101500-000', files: { main: '/m/sound-buddy-20261004-101500-000/main/01-main.wav', measurement: null } };
    expect(recordTakeView({ ...idle, lastTake }, 0).saved).toEqual(lastTake);
    expect(recordTakeView({ ...idle, phase: 'recording', lastTake }, 0).saved).toBeNull();
  });

  it('carries the error through in every phase', () => {
    expect(recordTakeView({ ...idle, error: 'boom' }, 0).error).toBe('boom');
    expect(recordTakeView({ ...idle, phase: 'recording', error: 'boom' }, 0).error).toBe('boom');
  });
});

describe('takeName / savedFileNames (#1648)', () => {
  it('names the take by its folder', () => {
    expect(takeName('/Music/Sound Buddy/sound-buddy-20261004-101500-000')).toBe('sound-buddy-20261004-101500-000');
    expect(takeName('/a/b/')).toBe('b');
    expect(takeName('/')).toBe('/');
  });

  it('names the saved stems, Main first, and lists their full paths for the tooltip', () => {
    const dir = '/m/take';
    const both = { dir, files: { main: '/m/take/main/01-main.wav', measurement: '/m/take/measurement/01-measurement.wav' } };
    expect(savedFileNames(both)).toBe('01-main.wav · 01-measurement.wav');
    expect(savedFilePaths(both)).toBe('/m/take/main/01-main.wav\n/m/take/measurement/01-measurement.wav');
    expect(savedFileNames({ dir, files: { main: null, measurement: '/m/take/measurement/01-measurement.wav' } }))
      .toBe('01-measurement.wav');
  });
});

describe('recordSourceRows (#1648)', () => {
  it('describes Main and Measurement with their devices, channel options and current choice', () => {
    const rows = recordSourceRows({
      devices: DEVICES, selectedDevice: '3', measurementDeviceName: 'Zoom H2n', mainChannels: '16-17', measurementChannels: null,
    });
    expect(rows.map((r) => [r.key, r.title, r.deviceLabel, r.value, r.options.length])).toEqual([
      ['main', 'Main input', 'X32 USB', '16-17', 48],
      ['measurement', 'Measurement input', 'Zoom H2n', '0-1', 3],
    ]);
  });

  it('marks a device that is not connected and offers mono only', () => {
    const rows = recordSourceRows({
      devices: [], selectedDevice: '3', measurementDeviceName: 'UMIK-1', mainChannels: '16-17', measurementChannels: null,
    });
    expect(rows[0]).toMatchObject({ deviceLabel: 'Input Device (not connected)', value: '0', options: [{ value: '0', label: 'Ch 1 (mono)' }] });
    expect(rows[1]).toMatchObject({ deviceLabel: 'UMIK-1 (not connected)', value: '0' });
  });

  it('labels unset devices as the system default input', () => {
    const rows = recordSourceRows({ devices: [], selectedDevice: '', measurementDeviceName: '', mainChannels: null, measurementChannels: null });
    expect(rows.map((r) => r.deviceLabel)).toEqual(['System default input', 'System default input']);
  });
});
