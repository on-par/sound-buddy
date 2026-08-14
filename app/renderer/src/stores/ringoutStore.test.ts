// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRingoutStore, type RingoutApi, type RingoutProfile } from './ringoutStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import type { AnalysisPayloadDto } from '../../../electron/ipc/api';

const feedbackRingout = require('../../feedback-ringout-state.js');

// A complete contract-shaped analyze-file payload (#748) with a configurable
// spectrum curve — the ringout capture path only reads analysis.spectrum.curve.
function makePayload(curve?: { freqs: number[]; db: number[] }): AnalysisPayloadDto {
  return {
    filePath: '/tmp/session-1/ch1.wav',
    sox: {
      samplesRead: 441000,
      lengthSeconds: 10,
      scaledBy: 1,
      maximumAmplitude: 0.9,
      minimumAmplitude: -0.9,
      midlineAmplitude: 0,
      meanNorm: 0.2,
      meanAmplitude: 0.1,
      rmsAmplitude: 0.2,
      maximumDelta: 0.8,
      minimumDelta: 0,
      meanDelta: 0.1,
      rmsDelta: 0.15,
      roughFrequency: 440,
      volumeAdjustment: 0,
      rmsDbfs: -18,
      peakDbfs: -6,
      dynamicRangeDb: 12,
      clipping: false,
    },
    ffprobe: {
      format: {
        filename: '/tmp/session-1/ch1.wav',
        formatName: 'wav',
        formatLongName: 'WAV / WAVE (Waveform Audio)',
        durationSeconds: 10,
        sizeBytes: 441000,
        bitRate: 1411200,
        tags: {},
      },
      stream: {
        codecName: 'pcm_s16le',
        codecLongName: 'PCM signed 16-bit little-endian',
        channels: 1,
        channelLayout: 'mono',
        sampleRate: 44100,
        bitDepth: 16,
        bitRate: 705600,
        durationSeconds: 10,
      },
    },
    spectrum: {
      bands: {
        subBass: -30,
        bass: -22,
        lowMid: -18,
        mid: -16,
        highMid: -18,
        presence: -20,
        brilliance: -24,
      },
      spectralCentroid: 1200,
      spectralRolloff85: 4800,
      dynamicRange: 12,
      ...(curve ? { curve } : {}),
    },
    loudness: { integratedLufs: -20, loudnessRange: 5, truePeakDbtp: -1 },
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    feedbackRingout,
    audioEngineSpectral: { findSpectralPeaks: () => [] },
  };
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// captureFromMic awaits a real RINGOUT_CAPTURE_MS (4s) delay between
// starting and stopping the capture — advance fake time past it so these
// tests run instantly instead of actually waiting 4s each.
async function runCaptureFromMic(store: ReturnType<typeof createRingoutStore>): Promise<void> {
  const promise = store.getState().captureFromMic();
  await vi.advanceTimersByTimeAsync(4000);
  await promise;
}

function makeStore(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createRingoutStore(() => mock.api as unknown as RingoutApi);
  return { store, mock };
}

describe('start', () => {
  it('seeds a cut + jumps to the cut step from a detected frequency', () => {
    const { store } = makeStore();
    store.getState().start(3150);
    expect(store.getState().cut).toEqual(feedbackRingout.suggestCut(3150));
    expect(store.getState().stepIndex).toBe(feedbackRingout.stepIndexById('cut'));
    expect(store.getState().status).toBe(feedbackRingout.handoffStatus(3150));
  });

  it('clears the status without touching cut/step when there is no detected frequency', () => {
    const { store } = makeStore();
    store.setState({ cut: { freq: 1000, gainDb: -6, q: 6 }, stepIndex: 2, status: 'stale' });
    store.getState().start(null);
    expect(store.getState().cut).toEqual({ freq: 1000, gainDb: -6, q: 6 });
    expect(store.getState().stepIndex).toBe(2);
    expect(store.getState().status).toBe('');
  });
});

describe('next / prev', () => {
  it('clamps at the last step', () => {
    const { store } = makeStore();
    store.setState({ stepIndex: feedbackRingout.stepCount() - 1 });
    store.getState().next();
    expect(store.getState().stepIndex).toBe(feedbackRingout.stepCount() - 1);
  });

  it('clamps at the first step', () => {
    const { store } = makeStore();
    store.setState({ stepIndex: 0 });
    store.getState().prev();
    expect(store.getState().stepIndex).toBe(0);
  });

  it('advances/retreats within range', () => {
    const { store } = makeStore();
    store.setState({ stepIndex: 1 });
    store.getState().next();
    expect(store.getState().stepIndex).toBe(2);
    store.getState().prev();
    expect(store.getState().stepIndex).toBe(1);
  });
});

describe('applyManual', () => {
  it('rejects an out-of-range/unparseable frequency with an actionable message', () => {
    const { store } = makeStore();
    store.getState().applyManual('not a number');
    expect(store.getState().status).toBe(
      `Enter a frequency between ${feedbackRingout.MIN_FREQ_HZ} and ${feedbackRingout.MAX_FREQ_HZ} Hz.`
    );
    expect(store.getState().cut).toBeNull();
  });

  it('sets a cut and clears the status for a valid frequency', () => {
    const { store } = makeStore();
    store.getState().applyManual('3150');
    expect(store.getState().cut).toEqual(feedbackRingout.suggestCut(3150));
    expect(store.getState().status).toBe('');
  });
});

describe('captureFromMic', () => {
  it('degrades to manual entry when no devices are found', async () => {
    const { store } = makeStore({ listDevices: () => Promise.resolve({ success: true, devices: [] }) });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('No mic detected — enter the frequency manually.');
    expect(store.getState().capturing).toBe(false);
  });

  it('degrades to manual entry when startLive fails', async () => {
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: false, error: 'no entitlement' }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('no entitlement');
  });

  it('degrades to manual entry when startLive fails with no error message', async () => {
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: false }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('Live capture unavailable — enter the frequency manually.');
  });

  it('degrades to manual entry when stopLive returns no sessionDir', async () => {
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: true }),
      stopLive: () => Promise.resolve({ success: true, sessionDir: null }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('Capture failed — enter the frequency manually.');
  });

  it('degrades to manual entry when the session has no track', async () => {
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: true }),
      stopLive: () => Promise.resolve({ success: true, sessionDir: '/tmp/session-1' }),
      readSession: () => Promise.resolve({ success: true, manifest: { tracks: [] } }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('Capture failed — enter the frequency manually.');
  });

  it('degrades to manual entry when the analysis has no spectrum curve', async () => {
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: true }),
      stopLive: () => Promise.resolve({ success: true, sessionDir: '/tmp/session-1' }),
      readSession: () => Promise.resolve({ success: true, manifest: { tracks: [{ file: 'ch1.wav' }] } }),
      analyzeFile: () => Promise.resolve({ success: true, data: makePayload() }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('Could not analyze the capture — enter the frequency manually.');
  });

  it('degrades to manual entry when no clear ring is found', async () => {
    (globalThis as { window?: unknown }).window = {
      feedbackRingout,
      audioEngineSpectral: { findSpectralPeaks: () => [] }, // no peaks -> identifyRing returns null
    };
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: true }),
      stopLive: () => Promise.resolve({ success: true, sessionDir: '/tmp/session-1' }),
      readSession: () => Promise.resolve({ success: true, manifest: { tracks: [{ file: 'ch1.wav' }] } }),
      analyzeFile: () => Promise.resolve({ success: true, data: makePayload({ freqs: [100], db: [-10] }) }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().status).toBe('No clear ring detected — try again or enter the frequency manually.');
  });

  it('captures a cut end to end on the happy path', async () => {
    (globalThis as { window?: unknown }).window = {
      feedbackRingout,
      audioEngineSpectral: { findSpectralPeaks: () => [{ freq: 3150, db: -4, prominence: 12 }] },
    };
    const { store } = makeStore({
      listDevices: () => Promise.resolve({ success: true, devices: [{ index: 0, name: 'Mic', channels: 1, default_sr: 48000 }] }),
      startLive: () => Promise.resolve({ success: true }),
      stopLive: () => Promise.resolve({ success: true, sessionDir: '/tmp/session-1' }),
      readSession: () => Promise.resolve({ success: true, manifest: { tracks: [{ file: 'ch1.wav' }] } }),
      analyzeFile: () => Promise.resolve({ success: true, data: makePayload({ freqs: [3150], db: [-4] }) }),
    });
    await runCaptureFromMic(store);
    expect(store.getState().cut).toEqual(feedbackRingout.suggestCut(3150));
    expect(store.getState().status).toContain('Captured');
    expect(store.getState().capturing).toBe(false);
  });

  it('resets capturing even when a step throws', async () => {
    const { store } = makeStore({ listDevices: () => Promise.reject(new Error('boom')) });
    await expect(store.getState().captureFromMic()).rejects.toThrow('boom');
    expect(store.getState().capturing).toBe(false);
  });
});

describe('loadProfiles', () => {
  it('reads the saved profile list from storage', () => {
    const profiles: RingoutProfile[] = [{ mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] }];
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'sb-ringout-profiles-v1': JSON.stringify({ profiles }) });
    const { store } = makeStore();
    store.getState().loadProfiles();
    expect(store.getState().profiles).toEqual(profiles);
  });
});

describe('saveProfile / recallProfile / deleteProfile', () => {
  it('does not save with no name or no current cut', () => {
    const { store } = makeStore();
    store.getState().saveProfile('');
    store.getState().saveProfile('  ');
    expect(store.getState().profiles).toEqual([]);
    store.setState({ cut: null });
    store.getState().saveProfile('SM58');
    expect(store.getState().profiles).toEqual([]);
  });

  it('saves the current cut under the trimmed mic name', () => {
    const { store } = makeStore();
    store.setState({ cut: { freq: 3150, gainDb: -6, q: 6 } });
    store.getState().saveProfile('  SM58  ');
    expect(store.getState().profiles).toEqual([{ mic: 'SM58', cuts: [{ freq: 3150, gainDb: -6, q: 6 }] }]);
  });

  it('recalls a saved profile onto the current cut', () => {
    const { store } = makeStore();
    store.setState({ cut: { freq: 3150, gainDb: -6, q: 6 } });
    store.getState().saveProfile('SM58');
    store.setState({ cut: null });
    store.getState().recallProfile('SM58');
    expect(store.getState().cut).toEqual({ freq: 3150, gainDb: -6, q: 6 });
  });

  it('recalling an unknown mic is a no-op', () => {
    const { store } = makeStore();
    store.getState().recallProfile('nope');
    expect(store.getState().cut).toBeNull();
  });

  it('deletes a saved profile', () => {
    const { store } = makeStore();
    store.setState({ cut: { freq: 3150, gainDb: -6, q: 6 } });
    store.getState().saveProfile('SM58');
    store.getState().deleteProfile('SM58');
    expect(store.getState().profiles).toEqual([]);
  });
});
