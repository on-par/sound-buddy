// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AudioAnalysis } from './analysis';

// registerNarrativeHandlers wires every channel into this map so a test can
// invoke a single handler directly without a live ipcMain (same pattern as
// live-capture.test.ts).
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
}));
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

const streamNarrativeMock = vi.fn();
const probeOllamaMock = vi.fn();
const testHostedProviderMock = vi.fn();
vi.mock('../llm', () => ({
  streamNarrative: (...a: unknown[]) => streamNarrativeMock(...a),
  probeOllama: (...a: unknown[]) => probeOllamaMock(...a),
  testHostedProvider: (...a: unknown[]) => testHostedProviderMock(...a),
}));

const getPublicLlmConfigMock = vi.fn();
const saveLlmConfigMock = vi.fn();
vi.mock('../llm-config', () => ({
  getPublicLlmConfig: () => getPublicLlmConfigMock(),
  saveLlmConfig: (...a: unknown[]) => saveLlmConfigMock(...a),
}));

const isEntitledMock = vi.fn();
vi.mock('../license', () => ({ isEntitled: (...a: unknown[]) => isEntitledMock(...a) }));

/** A minimal event-sender (renderer webContents) that records `send` calls with varargs. */
function fakeSender(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    sent: [] as { channel: string; args: unknown[] }[],
    send(channel: string, ...args: unknown[]) {
      this.sent.push({ channel, args });
    },
  };
}

function makeAnalysis(): AudioAnalysis {
  return {
    filePath: '/tmp/mix.wav',
    sox: {
      samplesRead: 480000,
      lengthSeconds: 10,
      scaledBy: 2147483647,
      maximumAmplitude: 0.9,
      minimumAmplitude: -0.9,
      midlineAmplitude: 0,
      meanNorm: 0.2,
      meanAmplitude: 0.01,
      rmsAmplitude: 0.25,
      maximumDelta: 0.5,
      minimumDelta: 0,
      meanDelta: 0.05,
      rmsDelta: 0.07,
      roughFrequency: 440,
      volumeAdjustment: 1.1,
      rmsDbfs: -18.5,
      peakDbfs: -3.2,
      dynamicRangeDb: 15.3,
      clipping: false,
    },
    ffprobe: {
      format: {
        filename: '/tmp/mix.wav',
        formatName: 'wav',
        formatLongName: 'WAV / WAVE',
        durationSeconds: 245.7,
        sizeBytes: 43394844,
        bitRate: 1411200,
        tags: {},
      },
      stream: {
        codecName: 'pcm_s16le',
        codecLongName: 'PCM signed 16-bit little-endian',
        channels: 2,
        channelLayout: 'stereo',
        sampleRate: 44100,
        bitDepth: 16,
        bitRate: 1411200,
        durationSeconds: 245.7,
      },
    },
    spectrum: {
      bands: {
        subBass: -35.1,
        bass: -22.4,
        lowMid: -20.0,
        mid: -18.7,
        highMid: -24.2,
        presence: -28.9,
        brilliance: -33.6,
      },
      spectralCentroid: 1234.6,
      spectralRolloff85: 8765.4,
      dynamicRange: 14.2,
    },
    loudness: null,
  };
}

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;
type NarrativeModule = typeof import('./narrative');
let mod: NarrativeModule;

beforeEach(async () => {
  vi.clearAllMocks();
  handlers.clear();
  vi.resetModules();
  mod = await import('./narrative');
  mod.registerNarrativeHandlers();
  isEntitledMock.mockReturnValue(true);
});

describe('registerNarrativeHandlers', () => {
  it('registers all five IPC channels', () => {
    expect(handlers.has('llm-get-config')).toBe(true);
    expect(handlers.has('llm-save-config')).toBe(true);
    expect(handlers.has('llm-detect-ollama')).toBe(true);
    expect(handlers.has('llm-test-provider')).toBe(true);
    expect(handlers.has('trigger-llm-analysis')).toBe(true);
  });
});

describe('buildAnalysisReport', () => {
  it('renders headline fields from a full analysis', () => {
    const report = mod.buildAnalysisReport(makeAnalysis());

    expect(report).toContain('File: /tmp/mix.wav');
    expect(report).toContain('Format: wav');
    expect(report).toContain('Duration: 245.7s');
    expect(report).toContain('Codec: pcm_s16le | 2ch | 44100Hz | 16bit');
    expect(report).toContain('Peak: -3.20 dBFS');
    expect(report).toContain('RMS: -18.50 dBFS');
    expect(report).toContain('Dyn Range: 15.30 dB');
    expect(report).toContain('Clipping: No');
    expect(report).toContain('Spectral centroid: 1235 Hz | Rolloff 85%: 8765 Hz');
  });

  it('renders all seven frequency band labels and values', () => {
    const report = mod.buildAnalysisReport(makeAnalysis());

    expect(report).toContain('Sub-bass (20-60Hz):');
    expect(report).toContain('-35.10');
    expect(report).toContain('Bass (60-250Hz):');
    expect(report).toContain('-22.40');
    expect(report).toContain('Low-mid (250-500Hz):');
    expect(report).toContain('-20.00');
    expect(report).toContain('Mid (500-2000Hz):');
    expect(report).toContain('-18.70');
    expect(report).toContain('High-mid (2000-4000Hz):');
    expect(report).toContain('-24.20');
    expect(report).toContain('Presence (4000-6000Hz):');
    expect(report).toContain('-28.90');
    expect(report).toContain('Brilliance (6-20kHz):');
    expect(report).toContain('-33.60');
  });

  it('flags clipping when true', () => {
    const analysis = makeAnalysis();
    analysis.sox.clipping = true;

    const report = mod.buildAnalysisReport(analysis);

    expect(report).toContain('Clipping: YES ⚠');
  });

  it('renders -inf for non-finite peak/RMS/band values', () => {
    const analysis = makeAnalysis();
    analysis.sox.peakDbfs = -Infinity;
    analysis.sox.rmsDbfs = -Infinity;
    analysis.spectrum.bands.subBass = -Infinity;

    const report = mod.buildAnalysisReport(analysis);

    expect(report).toContain('Peak: -inf dBFS');
    expect(report).toContain('RMS: -inf dBFS');
    expect(report).toContain('Sub-bass (20-60Hz):    -inf');
  });

  it('renders N/A for a null bit depth', () => {
    const analysis = makeAnalysis();
    analysis.ffprobe.stream.bitDepth = null;

    const report = mod.buildAnalysisReport(analysis);

    expect(report).toContain('N/Abit');
  });

  it('formats a very short duration', () => {
    const analysis = makeAnalysis();
    analysis.ffprobe.format.durationSeconds = 0.1;

    expect(mod.buildAnalysisReport(analysis)).toContain('Duration: 0.1s');
  });

  it('formats a very long duration', () => {
    const analysis = makeAnalysis();
    analysis.ffprobe.format.durationSeconds = 3600;

    expect(mod.buildAnalysisReport(analysis)).toContain('Duration: 3600.0s');
  });
});

describe('buildLiveReport', () => {
  it('renders one window with one channel and no masking', () => {
    const report = mod.buildLiveReport([
      {
        window: 3,
        ts: 12.34,
        channels: [
          { name: 'Vocals', rms: -20.5, peak: -6.1, clipping: false, centroid: 1500.7, bands: { bass: -22.15, mid: -18.05 } },
        ],
      },
    ]);

    expect(report.startsWith('Live monitoring windows:')).toBe(true);
    expect(report).toContain('Window 3 (ts=12.3):');
    expect(report).toContain('Vocals: rms=-20.5dBFS peak=-6.1dBFS clip=false centroid=1501Hz');
    expect(report).toContain('bands: bass:-22.1, mid:-18.1');
  });

  it('renders masking pairs when present', () => {
    const report = mod.buildLiveReport([
      {
        window: 3,
        ts: 12.34,
        channels: [
          { name: 'Vocals', rms: -20.5, peak: -6.1, clipping: false, centroid: 1500.7, bands: { bass: -22.15, mid: -18.05 } },
        ],
        masking: [{ band: 'lowMid', channelA: 'Kick', channelB: 'Bass', diffDb: 2.34 }],
      },
    ]);

    expect(report).toContain('masking: lowMid:Kick↔Bass(2.3dB)');
  });

  it('does not throw for a window with no channels key', () => {
    const report = mod.buildLiveReport([{ window: 1, ts: 0 }]);

    expect(report).toContain('Window 1 (ts=0.0):');
  });
});

describe('streamLLM', () => {
  it('blocks with a Pro-feature message when not entitled', async () => {
    isEntitledMock.mockReturnValue(false);
    const sender = fakeSender();

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(streamNarrativeMock).not.toHaveBeenCalled();
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0].channel).toBe('llm-delta');
    expect(sender.sent[0].args[0]).toContain('Pro feature');
    expect(sender.sent[1]).toEqual({ channel: 'llm-done', args: [] });
  });

  it('streams deltas then llm-done on the happy path', async () => {
    streamNarrativeMock.mockImplementation(async (onDelta: (t: string) => void) => {
      onDelta('chunk1');
      onDelta('chunk2');
      return { ok: true, provider: 'ollama', model: 'llama3' };
    });
    const sender = fakeSender();

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(streamNarrativeMock).toHaveBeenCalledWith(expect.any(Function), 'sys', 'user');
    expect(sender.sent).toEqual([
      { channel: 'llm-delta', args: ['chunk1'] },
      { channel: 'llm-delta', args: ['chunk2'] },
      { channel: 'llm-done', args: [] },
    ]);
  });

  it('sends a "turned off" message for outcome disabled', async () => {
    streamNarrativeMock.mockResolvedValue({ ok: false, reason: 'disabled' });
    const sender = fakeSender();

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(sender.sent[0].channel).toBe('llm-delta');
    expect(sender.sent[0].args[0]).toContain('AI analysis is turned off');
    expect(sender.sent[1]).toEqual({ channel: 'llm-done', args: [] });
  });

  it('sends a "no provider" message for outcome no-provider', async () => {
    streamNarrativeMock.mockResolvedValue({ ok: false, reason: 'no-provider' });
    const sender = fakeSender();

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(sender.sent[0].args[0]).toContain('No AI provider connected');
    expect(sender.sent[1]).toEqual({ channel: 'llm-done', args: [] });
  });

  it('sends a generic error message for any other reason', async () => {
    streamNarrativeMock.mockResolvedValue({ ok: false, reason: 'boom' });
    const sender = fakeSender();

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(sender.sent[0]).toEqual({ channel: 'llm-delta', args: ['\n[AI error: boom]\n'] });
    expect(sender.sent[1]).toEqual({ channel: 'llm-done', args: [] });
  });

  it('still sends llm-done when streamNarrative rejects', async () => {
    streamNarrativeMock.mockRejectedValue(new Error('net down'));
    const sender = fakeSender();

    await expect(
      mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user'),
    ).rejects.toThrow('net down');
    expect(sender.sent).toContainEqual({ channel: 'llm-done', args: [] });
  });

  it('sends nothing to a destroyed webContents', async () => {
    isEntitledMock.mockReturnValue(false);
    const sender = fakeSender(true);

    await mod.streamLLM(sender as unknown as Electron.WebContents, 'sys', 'user');

    expect(sender.sent).toEqual([]);
  });
});

describe('llm-get-config handler', () => {
  it('returns the public config with no key material', () => {
    const publicCfg = {
      provider: 'ollama',
      model: 'llama3',
      ollamaHost: 'http://localhost:11434',
      apiBaseUrl: '',
      hasApiKey: true,
      apiKeyProvider: 'openai',
    };
    getPublicLlmConfigMock.mockReturnValue(publicCfg);

    const handler = handlers.get('llm-get-config') as Handler;
    const result = handler();

    expect(result).toEqual(publicCfg);
    expect(result).not.toHaveProperty('apiKey');
  });
});

describe('llm-save-config handler', () => {
  it('passes a clean patch through and returns ok with the saved config', () => {
    const publicCfg = { provider: 'openai', model: 'gpt-4o' };
    saveLlmConfigMock.mockReturnValue(publicCfg);
    const handler = handlers.get('llm-save-config') as Handler;

    const result = handler({}, {
      provider: 'openai',
      model: 'gpt-4o',
      ollamaHost: 'h',
      apiBaseUrl: 'u',
      apiKey: 'sk-test',
    });

    expect(result).toEqual({ ok: true, config: publicCfg });
    expect(saveLlmConfigMock).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o',
      ollamaHost: 'h',
      apiBaseUrl: 'u',
      apiKey: 'sk-test',
    });
  });

  it('drops non-string and unknown fields', () => {
    saveLlmConfigMock.mockReturnValue({});
    const handler = handlers.get('llm-save-config') as Handler;

    handler({}, { provider: 42, model: 'm', junk: 'x' });

    expect(saveLlmConfigMock).toHaveBeenCalledWith({ model: 'm' });
  });

  it('saves an empty patch for a null body', () => {
    saveLlmConfigMock.mockReturnValue({});
    const handler = handlers.get('llm-save-config') as Handler;

    handler({}, null);

    expect(saveLlmConfigMock).toHaveBeenCalledWith({});
  });

  it('returns ok:false with the message when save throws an Error', () => {
    saveLlmConfigMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    const handler = handlers.get('llm-save-config') as Handler;

    const result = handler({}, { model: 'm' });

    expect(result).toEqual({ ok: false, reason: 'disk full' });
  });

  it('returns ok:false with String(err) when save throws a non-Error', () => {
    saveLlmConfigMock.mockImplementation(() => {
      // Exercises the String(err) fallback branch for non-Error throws.
      throw 'nope';
    });
    const handler = handlers.get('llm-save-config') as Handler;

    const result = handler({}, { model: 'm' });

    expect(result).toEqual({ ok: false, reason: 'nope' });
  });
});

describe('llm-detect-ollama handler', () => {
  it('resolves an online probe result', async () => {
    probeOllamaMock.mockResolvedValue({ ok: true, models: ['llama3', 'qwen'] });
    const handler = handlers.get('llm-detect-ollama') as Handler;

    const result = await handler({}, 'http://host:1234');

    expect(result).toEqual({ ok: true, models: ['llama3', 'qwen'] });
    expect(probeOllamaMock).toHaveBeenCalledWith('http://host:1234');
  });

  it('resolves an offline probe result', async () => {
    probeOllamaMock.mockResolvedValue({ ok: false, reason: 'not-running' });
    const handler = handlers.get('llm-detect-ollama') as Handler;

    const result = await handler({}, undefined);

    expect(result).toEqual({ ok: false, reason: 'not-running' });
  });
});

describe('llm-test-provider handler', () => {
  it('resolves success as-is', async () => {
    testHostedProviderMock.mockResolvedValue({ ok: true, models: ['gpt-4o'] });
    const handler = handlers.get('llm-test-provider') as Handler;
    const opts = { provider: 'openai', apiKey: 'sk-x' };

    const result = await handler({}, opts);

    expect(result).toEqual({ ok: true, models: ['gpt-4o'] });
    expect(testHostedProviderMock).toHaveBeenCalledWith(opts);
  });

  it('resolves failure as-is', async () => {
    testHostedProviderMock.mockResolvedValue({ ok: false, reason: 'HTTP 401' });
    const handler = handlers.get('llm-test-provider') as Handler;

    const result = await handler({}, { provider: 'openai' });

    expect(result).toEqual({ ok: false, reason: 'HTTP 401' });
  });

  it('falls back to an empty provider for non-object opts', async () => {
    testHostedProviderMock.mockResolvedValue({ ok: false, reason: 'missing provider' });
    const handler = handlers.get('llm-test-provider') as Handler;

    await handler({}, null);

    expect(testHostedProviderMock).toHaveBeenCalledWith({ provider: '' });
  });
});

describe('trigger-llm-analysis handler', () => {
  function invoke(sender: ReturnType<typeof fakeSender>, data: Record<string, unknown>) {
    const handler = handlers.get('trigger-llm-analysis') as Handler;
    return handler({ sender }, data);
  }

  it('file mode: feeds buildAnalysisReport output into streamNarrative', async () => {
    streamNarrativeMock.mockResolvedValue({ ok: true });
    const sender = fakeSender();

    const result = await invoke(sender, { analysis: makeAnalysis(), mode: 'file' });

    expect(result).toEqual({ success: true });
    expect(streamNarrativeMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining('professional audio engineer'),
      expect.stringContaining('File: /tmp/mix.wav'),
    );
  });

  it('live mode: feeds buildLiveReport output into streamNarrative', async () => {
    streamNarrativeMock.mockResolvedValue({ ok: true });
    const sender = fakeSender();
    const windows = [{ window: 1, ts: 0 }];

    await invoke(sender, { windows, mode: 'live' });

    expect(streamNarrativeMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      expect.stringMatching(/^Live monitoring windows:/),
    );
  });

  it('no data: returns success:false and sends a "no analysis data" message', async () => {
    const sender = fakeSender();

    const result = await invoke(sender, { mode: 'file' });

    expect(result).toEqual({ success: false });
    expect(sender.sent).toEqual([
      { channel: 'llm-delta', args: ['\n[No analysis data available]\n'] },
      { channel: 'llm-done', args: [] },
    ]);
    expect(streamNarrativeMock).not.toHaveBeenCalled();
  });

  it('catches a streamLLM failure and returns success:false with the error', async () => {
    streamNarrativeMock.mockRejectedValue(new Error('kaput'));
    const sender = fakeSender();

    const result = await invoke(sender, { analysis: makeAnalysis(), mode: 'file' });

    expect(result).toEqual({ success: false, error: 'Error: kaput' });
  });

  it('entitlement gate: streamLLM handles it internally, handler still returns success:true', async () => {
    isEntitledMock.mockReturnValue(false);
    const sender = fakeSender();

    const result = await invoke(sender, { analysis: makeAnalysis(), mode: 'file' });

    expect(result).toEqual({ success: true });
    expect(streamNarrativeMock).not.toHaveBeenCalled();
    expect(sender.sent[0].args[0]).toContain('Pro feature');
    expect(sender.sent[sender.sent.length - 1]).toEqual({ channel: 'llm-done', args: [] });
  });
});
