// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure helpers for the header Record take (#1648): which device + channels
// Main and Measurement record from, the mono/stereo channel choices a device
// offers, and the view model the header RecordButton renders from
// recordTakeStore. Record is two sources only — the board's Main mix (Settings
// ▸ Audio's Input Device) and the Measurement input (the secondary measurement
// device) — never a multitrack rig, and never "whatever the RTA is listening
// to". See ADR-0160.

import type { RecordTakeFiles, RecordTakeSource } from '../../electron/ipc/api';
import type { LiveDevice } from './live-capture-panel';
import { formatRecordElapsed } from './analyze-record';
import { deviceIndexForName, secondaryDeviceLabel } from './measurement-device-state';

export type RecordTakePhase = 'idle' | 'starting' | 'recording' | 'stopping';

export interface RecordTake {
  dir: string;
  files: RecordTakeFiles;
}

export const RECORD_MAIN_NOT_FOUND_ERROR =
  'Main input not found — reconnect the board interface or pick it as Input Device in Settings ▸ Audio, then press Record.';
export const RECORD_MEASUREMENT_NOT_FOUND_ERROR =
  'Measurement input not found — reconnect the room mic or pick it in Settings ▸ Audio, then press Record.';

// A system-default input ('' device) is recorded mono: its real channel count
// isn't known until stream.py opens it.
const SYSTEM_DEFAULT_INPUTS = 1;
const STEREO_WIDTH = 2;

export interface ChannelOption {
  value: string;
  label: string;
}

// Every mono channel, then every odd–even stereo pair (1–2, 3–4, …), as
// stream.py channel tokens ("N" / "N-M", 0-based).
export function channelOptions(inputCount: number): ChannelOption[] {
  const n = Math.max(1, inputCount);
  const options: ChannelOption[] = [];
  for (let i = 0; i < n; i++) options.push({ value: String(i), label: `Ch ${i + 1} (mono)` });
  for (let i = 0; i + 1 < n; i += STEREO_WIDTH) {
    options.push({ value: `${i}-${i + 1}`, label: `Ch ${i + 1}–${i + 2} (stereo)` });
  }
  return options;
}

// "Mono or stereo as the device presents": a one-input device records mono,
// anything wider records its first stereo pair.
export function defaultChannels(inputCount: number): string {
  return inputCount >= STEREO_WIDTH ? '0-1' : '0';
}

export function validChannels(choice: string | null, inputCount: number): string {
  if (choice !== null && channelOptions(inputCount).some((o) => o.value === choice)) return choice;
  return defaultChannels(inputCount);
}

function channelLabel(token: string, inputCount: number): string {
  return channelOptions(inputCount).find((o) => o.value === token)?.label ?? token;
}

export interface RecordSourcesInput {
  devices: LiveDevice[];
  // Settings ▸ Audio's Input Device (index-as-string; '' = system default).
  selectedDevice: string;
  // The secondary measurement device, remembered by NAME ('' = system default).
  measurementDeviceName: string;
  mainChannels: string | null;
  measurementChannels: string | null;
}

export type ResolvedRecordSources =
  | { ok: true; main: RecordTakeSource; measurement: RecordTakeSource; labels: { main: string; measurement: string } }
  | { ok: false; error: string };

interface SourcePick { device: string; name: string; inputs: number }

function mainPick(devices: LiveDevice[], selected: string): SourcePick | null {
  if (selected === '') return { device: '', name: secondaryDeviceLabel(''), inputs: SYSTEM_DEFAULT_INPUTS };
  const dev = devices.find((d) => String(d.index) === selected);
  return dev ? { device: selected, name: dev.name, inputs: dev.channels } : null;
}

function measurementPick(devices: LiveDevice[], name: string): SourcePick | null {
  if (name === '') return { device: '', name: secondaryDeviceLabel(''), inputs: SYSTEM_DEFAULT_INPUTS };
  const device = deviceIndexForName(devices, name);
  const dev = devices.find((d) => d.name === name);
  return device !== null && dev ? { device, name, inputs: dev.channels } : null;
}

export function resolveRecordSources(input: RecordSourcesInput): ResolvedRecordSources {
  const main = mainPick(input.devices, input.selectedDevice);
  if (!main) return { ok: false, error: RECORD_MAIN_NOT_FOUND_ERROR };
  const measurement = measurementPick(input.devices, input.measurementDeviceName);
  if (!measurement) return { ok: false, error: RECORD_MEASUREMENT_NOT_FOUND_ERROR };
  const mainChannels = validChannels(input.mainChannels, main.inputs);
  const measurementChannels = validChannels(input.measurementChannels, measurement.inputs);
  return {
    ok: true,
    main: { device: main.device, channels: mainChannels },
    measurement: { device: measurement.device, channels: measurementChannels },
    labels: {
      main: `${main.name} · ${channelLabel(mainChannels, main.inputs)}`,
      measurement: `${measurement.name} · ${channelLabel(measurementChannels, measurement.inputs)}`,
    },
  };
}

// One Settings ▸ Audio ▸ Record row: where the source comes from and the
// channel choices that device offers.
export interface RecordSourceRow {
  key: 'main' | 'measurement';
  title: string;
  deviceLabel: string;
  options: ChannelOption[];
  value: string;
}

const NOT_CONNECTED_INPUTS = 1;

export function recordSourceRows(input: RecordSourcesInput): RecordSourceRow[] {
  const row = (key: RecordSourceRow['key'], title: string, pick: SourcePick | null, fallbackName: string, choice: string | null): RecordSourceRow => {
    const inputs = pick ? pick.inputs : NOT_CONNECTED_INPUTS;
    return {
      key,
      title,
      deviceLabel: pick ? pick.name : `${fallbackName} (not connected)`,
      options: channelOptions(inputs),
      value: validChannels(choice, inputs),
    };
  };
  return [
    row('main', 'Main input', mainPick(input.devices, input.selectedDevice), 'Input Device', input.mainChannels),
    row('measurement', 'Measurement input', measurementPick(input.devices, input.measurementDeviceName), input.measurementDeviceName, input.measurementChannels),
  ];
}

export interface RecordTakeViewInput {
  phase: RecordTakePhase;
  startedAt: number | null;
  lastTake: RecordTake | null;
  error: string | null;
}

export interface RecordTakeViewModel {
  // Reuses the header button's record-btn--{idle,recording,stopping} looks.
  button: { phase: 'idle' | 'recording' | 'stopping'; disabled: boolean; ariaLabel: string };
  statusText: string | null;
  saved: RecordTake | null;
  error: string | null;
}

export function recordTakeView(input: RecordTakeViewInput, nowMs: number): RecordTakeViewModel {
  const { phase, error } = input;
  if (phase === 'starting') {
    return { button: { phase: 'idle', disabled: true, ariaLabel: 'Starting recording' }, statusText: 'Starting…', saved: null, error };
  }
  if (phase === 'recording') {
    const elapsed = input.startedAt === null ? 0 : nowMs - input.startedAt;
    return {
      button: { phase: 'recording', disabled: false, ariaLabel: 'Recording Main + Measurement — press to stop' },
      statusText: `Recording · ${formatRecordElapsed(elapsed)}`,
      saved: null,
      error,
    };
  }
  if (phase === 'stopping') {
    return { button: { phase: 'stopping', disabled: true, ariaLabel: 'Stopping recording' }, statusText: 'Saving…', saved: null, error };
  }
  return {
    button: { phase: 'idle', disabled: false, ariaLabel: 'Record Main + Measurement — press to start' },
    statusText: null,
    saved: input.lastTake,
    error,
  };
}

// The take folder's own name — the header has no room for the full path,
// which goes in a title attribute.
export function takeName(dir: string): string {
  const parts = dir.split('/').filter((p) => p !== '');
  return parts.length > 0 ? parts[parts.length - 1] : dir;
}

function savedFiles(take: RecordTake): string[] {
  return [take.files.main, take.files.measurement].filter((f): f is string => f !== null);
}

// The saved stems' file names, Main first — short enough for the header.
export function savedFileNames(take: RecordTake): string {
  return savedFiles(take).map(takeName).join(' · ');
}

// The saved stems' full paths, one per line (the header line's title).
export function savedFilePaths(take: RecordTake): string {
  return savedFiles(take).join('\n');
}
