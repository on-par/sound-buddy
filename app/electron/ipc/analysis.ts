// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// File-analysis domain (#225 split of the former monolithic ipc.ts): the
// sox/ffprobe/spectrum parsers, the analyze-file IPC handler, and the bundled
// demo-audio lookup used by the first-run onboarding flow (#69).

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from '../logger';
import { saveAnalysisSummary, listAnalysisSummaries, type AnalysisSummary } from '../storage';
import { toolBin, pythonBin, childEnv, SPECTRUM_SCRIPT, DEMO_AUDIO, defaultRecordDir } from './shared';
import {
  execFileWithTimeout,
  SubprocessTimeoutError,
  isAbortError,
  SOX_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  SPECTRUM_TIMEOUT_MS,
} from './timeout';

export interface SoxStats {
  samplesRead: number;
  lengthSeconds: number;
  scaledBy: number;
  maximumAmplitude: number;
  minimumAmplitude: number;
  midlineAmplitude: number;
  meanNorm: number;
  meanAmplitude: number;
  rmsAmplitude: number;
  maximumDelta: number;
  minimumDelta: number;
  meanDelta: number;
  rmsDelta: number;
  roughFrequency: number;
  volumeAdjustment: number;
  rmsDbfs: number;
  peakDbfs: number;
  dynamicRangeDb: number;
  clipping: boolean;
}

export interface FfprobeResult {
  format: {
    filename: string;
    formatName: string;
    formatLongName: string;
    durationSeconds: number;
    sizeBytes: number;
    bitRate: number;
    tags: Record<string, string>;
  };
  stream: {
    codecName: string;
    codecLongName: string;
    channels: number;
    channelLayout: string;
    sampleRate: number;
    bitDepth: number | null;
    bitRate: number | null;
    durationSeconds: number | null;
  };
}

export interface SpectrumCurve {
  freqs: number[];
  db: number[];
}
export interface SpectrumFrame {
  t: number;
  db: number[];
  rms: number;
  class: string;
}
export interface SpectrumSegment {
  class: string;
  start: number;
  end: number;
}
export interface SpectrumResult {
  bands: {
    subBass: number;
    bass: number;
    lowMid: number;
    mid: number;
    highMid: number;
    presence: number;
    brilliance: number;
  };
  spectralCentroid: number;
  spectralRolloff85: number;
  dynamicRange: number;
  // Additive fields (PRD 02–04); carried through to the renderer.
  curve?: SpectrumCurve;
  frames?: SpectrumFrame[];
  segments?: SpectrumSegment[];
  contentType?: string;
}

export interface AudioAnalysis {
  filePath: string;
  sox: SoxStats;
  ffprobe: FfprobeResult;
  spectrum: SpectrumResult;
}

// ─── SOX ──────────────────────────────────────────────────────────────────────

function parseField(output: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(new RegExp(`${escaped}\\s+([\\-\\d.]+)`));
  if (!match) throw new Error(`sox stat: could not find field "${label}"`);
  return parseFloat(match[1]);
}

// Some sox stat fields are omitted for degenerate input — e.g. pure silence
// (all-zero amplitude) prints no "Volume adjustment:" line. Fall back instead
// of crashing the whole analysis.
function parseFieldOptional(output: string, label: string, fallback: number): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(new RegExp(`${escaped}\\s+([\\-\\d.]+)`));
  return match ? parseFloat(match[1]) : fallback;
}

function amplitudeToDbfs(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

// Exported for the parser drift-guard test (#150), which asserts these copies
// stay equivalent to the @sound-buddy/audio-engine parsers until the
// duplication is removed (#151). Not part of the app's runtime surface.
export async function runSox(filePath: string, signal?: AbortSignal): Promise<SoxStats> {
  let stderr: string;
  try {
    const result = await execFileWithTimeout(
      toolBin('sox'),
      [filePath, '-n', 'stat'],
      { encoding: 'utf8', signal },
      'sox stat',
      SOX_TIMEOUT_MS,
    );
    stderr = result.stderr ?? '';
  } catch (err: unknown) {
    if (err instanceof SubprocessTimeoutError) throw err;
    if (isAbortError(err)) throw err;
    const e = err as { stderr?: string };
    stderr = e.stderr ?? '';
    if (!stderr) throw new Error(`sox failed: ${String(err)}`, { cause: err });
  }

  const samplesRead = parseField(stderr, 'Samples read:');
  const lengthSeconds = parseField(stderr, 'Length (seconds):');
  const scaledBy = parseField(stderr, 'Scaled by:');
  const maximumAmplitude = parseField(stderr, 'Maximum amplitude:');
  const minimumAmplitude = parseField(stderr, 'Minimum amplitude:');
  const midlineAmplitude = parseField(stderr, 'Midline amplitude:');
  const meanNorm = parseField(stderr, 'Mean    norm:');
  const meanAmplitude = parseField(stderr, 'Mean    amplitude:');
  const rmsAmplitude = parseField(stderr, 'RMS     amplitude:');
  const maximumDelta = parseField(stderr, 'Maximum delta:');
  const minimumDelta = parseField(stderr, 'Minimum delta:');
  const meanDelta = parseField(stderr, 'Mean    delta:');
  const rmsDelta = parseField(stderr, 'RMS     delta:');
  const roughFrequency = parseField(stderr, 'Rough   frequency:');
  // Omitted by sox for silent/all-zero audio; there is no meaningful gain to
  // normalise to, so fall back to 1.0 (no adjustment).
  const volumeAdjustment = parseFieldOptional(stderr, 'Volume adjustment:', 1.0);

  const peakAmplitude = Math.max(Math.abs(maximumAmplitude), Math.abs(minimumAmplitude));
  const rmsDbfs = amplitudeToDbfs(rmsAmplitude);
  const peakDbfs = amplitudeToDbfs(peakAmplitude);
  const dynamicRangeDb = peakDbfs - rmsDbfs;
  const clipping = peakAmplitude >= 1.0;

  return {
    samplesRead, lengthSeconds, scaledBy, maximumAmplitude, minimumAmplitude,
    midlineAmplitude, meanNorm, meanAmplitude, rmsAmplitude, maximumDelta,
    minimumDelta, meanDelta, rmsDelta, roughFrequency, volumeAdjustment,
    rmsDbfs, peakDbfs, dynamicRangeDb, clipping,
  };
}

// ─── FFPROBE ──────────────────────────────────────────────────────────────────

export async function runFfprobe(filePath: string, signal?: AbortSignal): Promise<FfprobeResult> {
  const { stdout } = await execFileWithTimeout(toolBin('ffprobe'), [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { encoding: 'utf8', signal }, 'ffprobe', FFPROBE_TIMEOUT_MS);

  const raw = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      codec_long_name?: string;
      channels?: number;
      channel_layout?: string;
      sample_rate?: string;
      bits_per_raw_sample?: string;
      bits_per_sample?: number;
      bit_rate?: string;
      duration?: string;
    }>;
    format?: {
      filename?: string;
      format_name?: string;
      format_long_name?: string;
      duration?: string;
      size?: string;
      bit_rate?: string;
      tags?: Record<string, string>;
    };
  };

  const rawFormat = raw.format ?? {};
  const audioStream = (raw.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!audioStream) throw new Error(`ffprobe: no audio stream in "${filePath}"`);

  let bitDepth: number | null = null;
  if (audioStream.bits_per_raw_sample) {
    const v = parseInt(audioStream.bits_per_raw_sample, 10);
    if (!isNaN(v) && v > 0) bitDepth = v;
  }
  if (bitDepth === null && audioStream.bits_per_sample !== undefined && audioStream.bits_per_sample > 0) {
    bitDepth = audioStream.bits_per_sample;
  }

  return {
    format: {
      filename: rawFormat.filename ?? filePath,
      formatName: rawFormat.format_name ?? 'unknown',
      formatLongName: rawFormat.format_long_name ?? 'unknown',
      durationSeconds: rawFormat.duration ? parseFloat(rawFormat.duration) : 0,
      sizeBytes: rawFormat.size ? parseInt(rawFormat.size, 10) : 0,
      bitRate: rawFormat.bit_rate ? parseInt(rawFormat.bit_rate, 10) : 0,
      tags: rawFormat.tags ?? {},
    },
    stream: {
      codecName: audioStream.codec_name ?? 'unknown',
      codecLongName: audioStream.codec_long_name ?? 'unknown',
      channels: audioStream.channels ?? 0,
      channelLayout: audioStream.channel_layout ?? (audioStream.channels === 1 ? 'mono' : 'unknown'),
      sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0,
      bitDepth,
      bitRate: audioStream.bit_rate ? parseInt(audioStream.bit_rate, 10) : null,
      durationSeconds: audioStream.duration ? parseFloat(audioStream.duration) : null,
    },
  };
}

// ─── SPECTRUM ─────────────────────────────────────────────────────────────────

export async function runSpectrum(filePath: string, signal?: AbortSignal): Promise<SpectrumResult> {
  const { stdout } = await execFileWithTimeout(
    pythonBin(),
    [SPECTRUM_SCRIPT, filePath],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: childEnv(),
      signal,
    },
    'spectrum analysis',
    SPECTRUM_TIMEOUT_MS,
  );

  const raw = JSON.parse(stdout) as {
    bands: {
      sub_bass: number;
      bass: number;
      low_mid: number;
      mid: number;
      high_mid: number;
      presence: number;
      brilliance: number;
    };
    spectral_centroid: number;
    spectral_rolloff_85: number;
    dynamic_range: number;
    curve?: SpectrumCurve;
    frames?: SpectrumFrame[];
    segments?: SpectrumSegment[];
    content_type?: string;
  };

  const result: SpectrumResult = {
    bands: {
      subBass: raw.bands.sub_bass,
      bass: raw.bands.bass,
      lowMid: raw.bands.low_mid,
      mid: raw.bands.mid,
      highMid: raw.bands.high_mid,
      presence: raw.bands.presence,
      brilliance: raw.bands.brilliance,
    },
    spectralCentroid: raw.spectral_centroid,
    spectralRolloff85: raw.spectral_rolloff_85,
    dynamicRange: raw.dynamic_range,
  };
  if (raw.curve) result.curve = raw.curve;
  if (raw.frames) result.frames = raw.frames;
  if (raw.segments) result.segments = raw.segments;
  if (raw.content_type) result.contentType = raw.content_type;
  return result;
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

// One in-flight run per renderer (webContents id), so a Cancel click aborts
// the run started by that same renderer.
const inFlight = new Map<number, AbortController>();

// The single folder save-analysis-summary writes to and list-analysis-summaries
// reads from — factored out so the two handlers can never drift onto different
// paths.
function historyDir(): string {
  return path.join(defaultRecordDir(), 'history');
}

export function registerAnalysisHandlers(): void {
  // analyze-file
  ipcMain.handle('analyze-file', async (event, opts: { filePath: string; noSpectrum?: boolean }) => {
    const { filePath, noSpectrum } = opts;
    const wc = event.sender;
    // Supersede any run still in flight for this renderer (e.g. a second
    // analyze-file triggered via File > Open while one is running) instead of
    // silently overwriting its AbortController and orphaning it — the
    // superseded run's own catch block below sees the abort and resolves
    // cleanly as `cancelled`.
    inFlight.get(wc.id)?.abort();
    const controller = new AbortController();
    inFlight.set(wc.id, controller);
    const { signal } = controller;

    // Stage progress (#125): all three stages genuinely run in parallel
    // (Promise.all below), so report them starting together and check each
    // off independently as its subprocess returns — no fake 1→2→3 march.
    const send = (data: { stage?: string; status: string }) => {
      if (!wc.isDestroyed()) wc.send('analysis-progress', data);
    };
    send({ stage: 'reading', status: 'start' });
    send({ stage: 'levels', status: 'start' });
    send({ stage: 'spectrum', status: 'start' });

    const track = async <T>(stage: string, p: Promise<T>): Promise<T> => {
      const result = await p;
      send({ stage, status: 'done' });
      return result;
    };

    try {
      const [sox, ffprobe, spectrum] = await Promise.all([
        track('levels', runSox(filePath, signal)),
        track('reading', runFfprobe(filePath, signal)),
        noSpectrum
          ? track(
              'spectrum',
              Promise.resolve<SpectrumResult>({
                bands: { subBass: -120, bass: -120, lowMid: -120, mid: -120, highMid: -120, presence: -120, brilliance: -120 },
                spectralCentroid: 0,
                spectralRolloff85: 0,
                dynamicRange: 0,
              }),
            )
          : track('spectrum', runSpectrum(filePath, signal)),
      ]);

      const analysis: AudioAnalysis = { filePath, sox, ffprobe, spectrum };
      wc.send('analysis-result', { type: 'stats', data: analysis });
      log(`analyze-file ok: ${filePath}`);
      return { success: true, data: analysis };
    } catch (err) {
      if (isAbortError(err)) {
        // No terminal progress event here: the renderer that started this
        // specific run already learns of the cancellation from this
        // invoke()'s own resolution (`result.cancelled`) — a stage-keyed
        // 'done'/'start' event has nowhere to attach without a stage.
        log(`analyze-file cancelled: ${filePath}`);
        return { success: false, cancelled: true };
      }
      const message = String(err);
      logError(`analyze-file failed for ${filePath}`, err);
      return { success: false, error: message };
    } finally {
      // Only clear this run's own entry — a supersede above may already have
      // replaced it with a newer run's controller.
      if (inFlight.get(wc.id) === controller) inFlight.delete(wc.id);
    }
  });

  // cancel-analysis — aborts the in-flight run started by this renderer, if any.
  ipcMain.handle('cancel-analysis', (event) => {
    const controller = inFlight.get(event.sender.id);
    if (!controller) return { success: false };
    controller.abort();
    return { success: true };
  });

  // get-demo-audio — path to the bundled demo recording the first-run onboarding
  // flow (#69) analyzes with one click. Returns null if the asset is missing so
  // the renderer can fall back to the file picker rather than erroring.
  ipcMain.handle('get-demo-audio', () => {
    return fs.existsSync(DEMO_AUDIO) ? DEMO_AUDIO : null;
  });

  // save-analysis-summary (#146) — persist a small report-card summary under the
  // configured storage folder so the recent-services list (#147) has a history to
  // read. Write-only; the renderer computes grade/score, main stamps the ISO date
  // and writes. A failure (permissions, full disk) is logged and swallowed: the
  // report card must still display, so this never throws back to the renderer.
  ipcMain.handle('save-analysis-summary', async (_event, payload: Omit<AnalysisSummary, 'date'>) => {
    try {
      const summary: AnalysisSummary = {
        date: new Date().toISOString(),
        sourceFilename: String(payload?.sourceFilename ?? ''),
        gradeLetter: String(payload?.gradeLetter ?? ''),
        score: Number(payload?.score ?? 0),
        recordingType: String(payload?.recordingType ?? ''),
        topFixes: Array.isArray(payload?.topFixes) ? payload.topFixes.map(String) : [],
      };
      const file = await saveAnalysisSummary(historyDir(), summary);
      log(`saved analysis summary: ${file}`);
      return { success: true };
    } catch (err) {
      logError('save-analysis-summary failed', err);
      return { success: false, error: String(err) };
    }
  });

  // list-analysis-summaries (#147) — the last 10 persisted report-card summaries,
  // newest-first, for the Recent Services list. A failure (permissions, corrupt
  // folder) is logged and returned as an empty list rather than thrown, so the
  // Recent tab always has an empty state to fall back to instead of an error.
  ipcMain.handle('list-analysis-summaries', async () => {
    try {
      return { success: true, summaries: await listAnalysisSummaries(historyDir(), 10) };
    } catch (err) {
      logError('list-analysis-summaries failed', err);
      return { success: false, error: String(err), summaries: [] };
    }
  });
}
