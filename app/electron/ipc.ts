// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { ipcMain, dialog, BrowserWindow, app, systemPreferences, shell } from 'electron';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { log, logWarn, logError } from './logger';
import { probeOllama, streamNarrative, testHostedProvider } from './llm';
import { getPublicLlmConfig, saveLlmConfig, type LlmConfigPatch } from './llm-config';
import {
  getSettings,
  updateSettings,
  listRigs,
  upsertRig,
  deleteRig,
  setActiveRig,
  type CaptureRig,
} from './settings';
import { getLicenseState, activateLicense, removeLicense, isEntitled } from './license';
import { dirSizeBytes, formatBytes } from './storage';

const execFileAsync = promisify(execFile);

// Dev repo root (three levels up from app/dist/electron/). Only meaningful when
// running from a checkout — inside a packaged .app this points into the bundle.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// The Python scripts ship as extraResources (Contents/Resources/scripts) in a
// packaged .app; in dev they live in the monorepo.
const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(REPO_ROOT, 'packages', 'audio-engine', 'scripts');
const SPECTRUM_SCRIPT = path.join(SCRIPTS_DIR, 'spectrum.py');
const STREAM_SCRIPT = path.join(SCRIPTS_DIR, 'stream.py');
const PLAYBACK_SCRIPT = path.join(SCRIPTS_DIR, 'playback.py');

// Bundled demo recording for the first-run onboarding flow (#69). Like the
// Python scripts it must live OUTSIDE the asar archive so the external
// sox/ffprobe processes can read it — it ships as extraResources
// (Contents/Resources/assets) in a packaged .app; in dev it lives under app/assets.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const DEMO_AUDIO = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'demo.wav')
  : path.join(APP_ROOT, 'assets', 'demo.wav');

// Native helpers (sox, ffprobe) are bundled at Contents/Resources/bin in a
// packaged .app (see build/afterPack.js). In dev they come from PATH. Resolving
// to the bundled copy means the app never depends on a Homebrew install.
const BUNDLED_BIN_DIR = app.isPackaged ? path.join(process.resourcesPath, 'bin') : null;
function toolBin(name: string): string {
  if (BUNDLED_BIN_DIR) {
    const bundled = path.join(BUNDLED_BIN_DIR, name);
    if (fs.existsSync(bundled)) return bundled;
  }
  return name; // fall back to PATH (dev / unbundled)
}

// Env for spawned Python: prepend the bundled bin dir so librosa/audioread can
// find the bundled ffmpeg (m4a/aac decode) without a system install.
function childEnv(): NodeJS.ProcessEnv {
  if (!BUNDLED_BIN_DIR) return process.env;
  return { ...process.env, PATH: `${BUNDLED_BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}` };
}

// The audio-engine scripts need librosa/soundfile/sounddevice/scipy, which the
// system `python3` usually lacks (and Homebrew's is externally-managed). Prefer,
// in order: an explicit override, the per-user venv created by
// scripts/setup-macos.sh, the dev repo .venv, then bare `python3`. Resolved
// lazily so app.setName()/userData is applied before we read it.
let cachedPython: string | undefined;
function pythonBin(): string {
  if (cachedPython) return cachedPython;
  const candidates = [
    process.env.SOUND_BUDDY_PYTHON,
    // Bundled relocatable interpreter (Contents/Resources/python) — packaged apps.
    app.isPackaged ? path.join(process.resourcesPath, 'python', 'bin', 'python3') : undefined,
    path.join(app.getPath('userData'), 'venv', 'bin', 'python3'),
    path.join(REPO_ROOT, '.venv', 'bin', 'python3'),
  ].filter((p): p is string => Boolean(p));
  cachedPython = candidates.find((p) => fs.existsSync(p)) ?? 'python3';
  log(`python interpreter: ${cachedPython}`);
  return cachedPython;
}

let liveProcess: ChildProcess | null = null;
let liveIntervalTimer: NodeJS.Timeout | null = null;
// The current virtual-soundcheck playback child (playback.py). Held at module
// scope — like liveProcess — so stop-playback can SIGTERM it for a clean close.
let playbackProcess: ChildProcess | null = null;
// Directory of the current/last multitrack session (Record mode) — per-strip
// stems + session.json — so stop-live can hand it back to the renderer. null in
// Monitor mode.
let liveSessionDir: string | null = null;

// The built-in fallback storage folder — used when the user has not chosen one
// (settings.storageDir === '') and as the label default in the UI.
function platformDefaultStorageDir(): string {
  return path.join(app.getPath('music'), 'Sound Buddy');
}

// Default folder for Record-mode captures when the renderer doesn't pass one:
// the user-configured storage folder (#91), falling back to ~/Music/Sound Buddy.
// Created on demand by buildSessionDir. There is no cap on how much this folder
// holds — storage is the user's own disk.
function defaultRecordDir(): string {
  return getSettings().storageDir?.trim() || platformDefaultStorageDir();
}

// A timestamp like 20260703-143207-512, stable within one capture. Milliseconds
// keep two captures started in the same second from colliding on one folder.
function captureStamp(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}` +
    `-${String(now.getMilliseconds()).padStart(3, '0')}`
  );
}

// Compute a timestamped session *folder* path inside the chosen (or default)
// record folder — stream.py fills it with one stem WAV per armed strip and a
// session.json, and creates the folder itself when capture actually starts.
// Only the shared parent is created here (so a bad recordDir surfaces a friendly
// error up front); the per-capture child is left to stream.py so a failed or
// aborted start never leaves an empty session folder behind. The main process
// owns the path so stop-live can hand the folder back once session.json exists.
function buildSessionDir(dir?: string): string {
  const target = dir && dir.trim() ? dir : defaultRecordDir();
  fs.mkdirSync(target, { recursive: true });
  return path.join(target, `sound-buddy-${captureStamp()}`);
}

// ─── Microphone (Core Audio) permission ─────────────────────────────────────
type MicAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

// macOS gates Core Audio microphone capture behind TCC. Device *enumeration*
// works without it, but capture (start-live) yields silence unless the app holds
// the grant — and the Python child that actually records is attributed to this
// app as the responsible process.
//
// `prompt` controls whether an undecided ('not-determined') state triggers the
// system permission dialog. Listing devices only *reads* the status (no dialog,
// so opening the Live tab never surprises the user or blocks automation); the
// dialog is requested lazily from start-live, when the user actively records.
async function ensureMicrophoneAccess(prompt: boolean): Promise<MicAccess> {
  if (process.platform !== 'darwin') return 'granted';
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return 'granted';
  if (status === 'not-determined') {
    if (!prompt) return 'not-determined';
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      log(`microphone access ${granted ? 'granted' : 'denied'} by user`);
      return granted ? 'granted' : 'denied';
    } catch (err) {
      logWarn(`microphone access request failed: ${String(err)}`);
      return 'unknown';
    }
  }
  return status as MicAccess; // 'denied' | 'restricted'
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SoxStats {
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

interface FfprobeResult {
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

interface SpectrumCurve {
  freqs: number[];
  db: number[];
}
interface SpectrumFrame {
  t: number;
  db: number[];
  rms: number;
  class: string;
}
interface SpectrumSegment {
  class: string;
  start: number;
  end: number;
}
interface SpectrumResult {
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

interface AudioAnalysis {
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
export async function runSox(filePath: string): Promise<SoxStats> {
  let stderr = '';
  try {
    const result = await execFileAsync(toolBin('sox'), [filePath, '-n', 'stat'], { encoding: 'utf8' });
    stderr = result.stderr ?? '';
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    stderr = e.stderr ?? '';
    if (!stderr) throw new Error(`sox failed: ${String(err)}`);
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

export async function runFfprobe(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync(toolBin('ffprobe'), [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { encoding: 'utf8' });

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

export async function runSpectrum(filePath: string): Promise<SpectrumResult> {
  const { stdout } = await execFileAsync(pythonBin(), [SPECTRUM_SCRIPT, filePath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: childEnv(),
  });

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

// ─── LLM ──────────────────────────────────────────────────────────────────────

function buildAnalysisReport(analysis: AudioAnalysis): string {
  const { sox, ffprobe, spectrum } = analysis;
  const { bands } = spectrum;
  const fmt = (n: number, d = 2) => isFinite(n) ? n.toFixed(d) : '-inf';

  return [
    `File: ${analysis.filePath}`,
    `Format: ${ffprobe.format.formatName} | Duration: ${ffprobe.format.durationSeconds.toFixed(1)}s`,
    `Codec: ${ffprobe.stream.codecName} | ${ffprobe.stream.channels}ch | ${ffprobe.stream.sampleRate}Hz | ${ffprobe.stream.bitDepth ?? 'N/A'}bit`,
    `Peak: ${fmt(sox.peakDbfs)} dBFS | RMS: ${fmt(sox.rmsDbfs)} dBFS | Dyn Range: ${fmt(sox.dynamicRangeDb)} dB | Clipping: ${sox.clipping ? 'YES ⚠' : 'No'}`,
    `Frequency Bands (dB RMS):`,
    `  Sub-bass (20-60Hz):    ${fmt(bands.subBass)}`,
    `  Bass (60-250Hz):       ${fmt(bands.bass)}`,
    `  Low-mid (250-500Hz):   ${fmt(bands.lowMid)}`,
    `  Mid (500-2000Hz):      ${fmt(bands.mid)}`,
    `  High-mid (2000-4000Hz):${fmt(bands.highMid)}`,
    `  Presence (4000-6000Hz):${fmt(bands.presence)}`,
    `  Brilliance (6-20kHz):  ${fmt(bands.brilliance)}`,
    `Spectral centroid: ${Math.round(spectrum.spectralCentroid)} Hz | Rolloff 85%: ${Math.round(spectrum.spectralRolloff85)} Hz`,
  ].join('\n');
}

function buildLiveReport(windowData: unknown[]): string {
  const lines: string[] = ['Live monitoring windows:'];
  for (const w of windowData as Array<Record<string, unknown>>) {
    const channels = (w['channels'] as Array<Record<string, unknown>>) ?? [];
    lines.push(`\nWindow ${w['window']} (ts=${(w['ts'] as number).toFixed(1)}):`);
    for (const ch of channels) {
      const bands = ch['bands'] as Record<string, number>;
      const bandStr = Object.entries(bands)
        .map(([k, v]) => `${k}:${(v as number).toFixed(1)}`)
        .join(', ');
      lines.push(`  ${ch['name']}: rms=${(ch['rms'] as number).toFixed(1)}dBFS peak=${(ch['peak'] as number).toFixed(1)}dBFS clip=${ch['clipping']} centroid=${Math.round(ch['centroid'] as number)}Hz`);
      lines.push(`    bands: ${bandStr}`);
    }
    const masking = (w['masking'] as Array<Record<string, unknown>>) ?? [];
    if (masking.length > 0) {
      lines.push(`  masking: ${masking.map((m) => `${m['band']}:${m['channelA']}↔${m['channelB']}(${(m['diffDb'] as number).toFixed(1)}dB)`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

async function streamLLM(
  webContents: Electron.WebContents,
  systemPrompt: string,
  userMessage: string
): Promise<void> {
  const send = (channel: string, ...args: unknown[]): void => {
    if (!webContents.isDestroyed()) webContents.send(channel, ...args);
  };

  // The AI narrative is a Pro feature (#54). The gate lives here (main process)
  // so both entry points — the analyze button and the live LLM timer — are
  // covered even if the renderer's UI gating is bypassed.
  if (!isEntitled('ai-narrative')) {
    logWarn('LLM analysis skipped: AI narrative requires a Pro license');
    send(
      'llm-delta',
      '\n🔒 The AI Engineer is a Pro feature. Enter your license key (Help ▸ License…) to unlock it.\n',
    );
    send('llm-done');
    return;
  }

  // Stream via whatever the user connected in AI settings (#76): local Ollama,
  // a pasted API key (direct HTTPS), or a pi subscription login.
  try {
    const outcome = await streamNarrative((text) => send('llm-delta', text), systemPrompt, userMessage);

    if (!outcome.ok) {
      if (outcome.reason === 'disabled') {
        logWarn('LLM analysis skipped: AI is disabled in settings');
        send(
          'llm-delta',
          '\n⚠️  AI analysis is turned off. Open AI settings (the gear icon) and ' +
            'check "Enable AI analysis" to use the AI Engineer.\n',
        );
      } else if (outcome.reason === 'no-provider') {
        logWarn('LLM analysis skipped: no provider configured');
        send(
          'llm-delta',
          '\n⚠️  No AI provider connected. Open AI settings (the gear icon) to use ' +
            'your local Ollama or paste an API key.\n',
        );
      } else {
        logError(`LLM narrative error: ${outcome.reason}`);
        send('llm-delta', `\n[AI error: ${outcome.reason}]\n`);
      }
    } else {
      log(`LLM narrative ok via ${outcome.provider ?? '?'}/${outcome.model ?? '?'}`);
    }
  } finally {
    // Always release the renderer's "Analyzing…" state — a missed 'llm-done'
    // wedges the AI button until app restart.
    send('llm-done');
  }
}

// ─── Device enumeration ─────────────────────────────────────────────────────

export interface DeviceListResult {
  success: boolean;
  devices?: unknown[];
  error?: string;
}

// Spawn stream.py with an enumeration flag and resolve the parsed device list.
// Shared by list-devices and list-output-devices: same stdout/stderr collection,
// close/error handling, and JSON-parse guard. Callers layer on any extra fields
// (e.g. list-devices' micAccess). Never rejects — enumeration failures surface as
// { success: false, error } so the renderer can degrade gracefully. `label`
// prefixes log lines so the two callers stay distinguishable.
export function enumerateDevices(
  flag: '--list-devices' | '--list-output-devices',
  label: string,
): Promise<DeviceListResult> {
  return new Promise<DeviceListResult>((resolve) => {
    let output = '';
    let errOutput = '';
    const py = spawn(pythonBin(), [STREAM_SCRIPT, flag], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });

    py.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    // stderr was previously piped but never read (lost errors + risked backpressure).
    py.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

    py.on('close', (code, signal) => {
      if (code !== 0 && !output.trim()) {
        // A signal kill (OOM, SIGTERM on app quit) reports code === null; name the
        // signal instead of surfacing a bare "exited with code null" to the picker.
        const reason = code === null ? `terminated by signal ${signal}` : `exited with code ${code}`;
        logError(`${label}: stream.py ${reason}`, errOutput.trim() || undefined);
        resolve({ success: false, error: `stream.py ${reason}` });
        return;
      }
      try {
        const parsed = JSON.parse(output.trim()) as { devices?: unknown[] };
        if (errOutput.trim()) logWarn(`${label} stderr: ${errOutput.trim()}`);
        resolve({ success: true, devices: parsed.devices ?? [] });
      } catch (err) {
        logError(`${label}: failed to parse device list`, errOutput.trim() || err);
        resolve({ success: false, error: 'Failed to parse device list' });
      }
    });

    py.on('error', (err) => {
      logError(`${label}: failed to spawn ${pythonBin()}`, err);
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {
  // get-app-version — the installed app version (from package.json / the
  // packaged .app's Info.plist), shown in the AI Engineer dialog (#202).
  ipcMain.handle('get-app-version', () => app.getVersion());

  // get-settings — read app-behavior flags (AI on/off, ideal profile). The
  // renderer reads this at boot to hide AI affordances when disabled.
  ipcMain.handle('get-settings', () => getSettings());

  // update-settings — persist a partial settings patch (e.g. the ideal EQ
  // profile the user picks in the spectrum header, PRD 05). Only known,
  // type-checked keys are accepted so a stray patch can't pollute settings.json.
  // Returns the merged settings so the renderer stays in sync.
  ipcMain.handle('update-settings', (_event, patch: Record<string, unknown>) => {
    const clean: Partial<ReturnType<typeof getSettings>> = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.aiEnabled === 'boolean') clean.aiEnabled = patch.aiEnabled;
      if (typeof patch.idealProfile === 'string') clean.idealProfile = patch.idealProfile;
      // Storage location (#91). Trimmed; an empty string resets to the platform
      // default (~/Music/Sound Buddy). No size/count limit is ever applied.
      if (typeof patch.storageDir === 'string') clean.storageDir = patch.storageDir.trim();
    }
    return updateSettings(clean);
  });

  // get-storage-usage — where recordings live and how much disk they use (#91).
  // Purely informational: the byte count is shown in Settings, never compared
  // against a quota or used to gate recording. Reports the effective folder
  // (configured storageDir or the ~/Music/Sound Buddy default) so the UI can
  // show the real path even before the user has chosen one.
  ipcMain.handle('get-storage-usage', async () => {
    const dir = defaultRecordDir();
    const isDefault = !getSettings().storageDir?.trim();
    let bytes = 0;
    try {
      bytes = await dirSizeBytes(dir);
    } catch (err) {
      logWarn(`get-storage-usage: ${String(err)}`);
    }
    return {
      path: dir,
      isDefault,
      defaultPath: platformDefaultStorageDir(),
      bytes,
      human: formatBytes(bytes),
      exists: fs.existsSync(dir),
    };
  });

  // AI provider settings (#76). The renderer only ever sees the public view —
  // the API key crosses the bridge once (renderer → main, on save/test) and the
  // stored ciphertext never crosses back.
  ipcMain.handle('llm-get-config', () => getPublicLlmConfig());

  ipcMain.handle('llm-save-config', (_event, patch: LlmConfigPatch) => {
    const clean: LlmConfigPatch = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.provider === 'string') clean.provider = patch.provider;
      if (typeof patch.model === 'string') clean.model = patch.model;
      if (typeof patch.ollamaHost === 'string') clean.ollamaHost = patch.ollamaHost;
      if (typeof patch.apiBaseUrl === 'string') clean.apiBaseUrl = patch.apiBaseUrl;
      if (typeof patch.apiKey === 'string') clean.apiKey = patch.apiKey;
    }
    try {
      return { ok: true, config: saveLlmConfig(clean) };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  // Auto-detect a local Ollama and list its models (settings screen, #76).
  ipcMain.handle('llm-detect-ollama', (_event, host?: string) => probeOllama(host));

  // "Test connection" for the API-key tab (#76).
  ipcMain.handle(
    'llm-test-provider',
    (_event, opts: { provider: string; apiKey?: string; apiBaseUrl?: string }) =>
      testHostedProvider(opts && typeof opts === 'object' ? opts : { provider: '' }),
  );

  // License (#54) — offline validation only; none of these touch the network.
  // get-license re-verifies the stored key on every call, so expiry/grace roll
  // over naturally without a restart.
  ipcMain.handle('get-license', () => getLicenseState());
  ipcMain.handle('activate-license', (_event, key: string) => activateLicense(String(key ?? '')));
  ipcMain.handle('remove-license', () => removeLicense());

  // Capture rigs (#36) — thin wrappers over the pure CRUD helpers in settings.ts,
  // which own validation and the layered-persistence discipline. Reads stay
  // ungated so a lapsed license keeps saved rigs accessible (#54: user data is
  // never locked); writes are Pro, matching the renderer's gate.
  ipcMain.handle('list-rigs', () => listRigs());
  ipcMain.handle('save-rig', (_event, rig: CaptureRig) => {
    if (!isEntitled('saved-rigs')) throw new Error('Saving rigs requires a Pro license');
    return upsertRig(rig);
  });
  ipcMain.handle('delete-rig', (_event, id: string) => {
    if (!isEntitled('saved-rigs')) throw new Error('Editing rigs requires a Pro license');
    return deleteRig(id);
  });
  ipcMain.handle('set-active-rig', (_event, id: string | null) => setActiveRig(id));

  // analyze-file
  ipcMain.handle('analyze-file', async (event, opts: { filePath: string; noSpectrum?: boolean }) => {
    const { filePath, noSpectrum } = opts;
    const wc = event.sender;

    try {
      const [sox, ffprobe, spectrum] = await Promise.all([
        runSox(filePath),
        runFfprobe(filePath),
        noSpectrum
          ? Promise.resolve<SpectrumResult>({
              bands: { subBass: -120, bass: -120, lowMid: -120, mid: -120, highMid: -120, presence: -120, brilliance: -120 },
              spectralCentroid: 0,
              spectralRolloff85: 0,
              dynamicRange: 0,
            })
          : runSpectrum(filePath),
      ]);

      const analysis: AudioAnalysis = { filePath, sox, ffprobe, spectrum };
      wc.send('analysis-result', { type: 'stats', data: analysis });
      log(`analyze-file ok: ${filePath}`);
      return { success: true, data: analysis };
    } catch (err) {
      const message = String(err);
      logError(`analyze-file failed for ${filePath}`, err);
      return { success: false, error: message };
    }
  });

  // get-demo-audio — path to the bundled demo recording the first-run onboarding
  // flow (#69) analyzes with one click. Returns null if the asset is missing so
  // the renderer can fall back to the file picker rather than erroring.
  ipcMain.handle('get-demo-audio', () => {
    return fs.existsSync(DEMO_AUDIO) ? DEMO_AUDIO : null;
  });

  // onboarding-disabled — dev/e2e switch (SOUND_BUDDY_DISABLE_ONBOARDING) that
  // suppresses the first-run welcome overlay (#69) so the e2e harness can drive a
  // deterministic UI without the modal scrim intercepting clicks. Mirrors the
  // SOUND_BUDDY_DISABLE_TRIAL switch honored by license.ts. The overlay stays
  // hidden until this resolves at boot, so there's no scrim flash either way.
  ipcMain.handle('onboarding-disabled', () => process.env.SOUND_BUDDY_DISABLE_ONBOARDING === '1');

  // list-devices
  ipcMain.handle('list-devices', async () => {
    // Read (don't prompt for) the Core Audio permission alongside enumeration.
    // Enumeration works without the grant; reporting the status lets the renderer
    // distinguish a blocked mic from genuinely absent input hardware.
    const micAccess = await ensureMicrophoneAccess(false);
    const result = await enumerateDevices('--list-devices', 'list-devices');
    return { ...result, micAccess };
  });

  // list-output-devices — playback devices for the virtual-soundcheck output
  // picker (#44). Mirrors list-devices but carries no micAccess: choosing an
  // output interface doesn't touch the microphone grant.
  ipcMain.handle('list-output-devices', () =>
    enumerateDevices('--list-output-devices', 'list-output-devices'));

  // open-file-dialog
  ipcMain.handle('open-file-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const { filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return filePaths[0] ?? null;
  });

  // open-dir-dialog
  ipcMain.handle('open-dir-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const { filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    return filePaths[0] ?? null;
  });

  // Playback transport (#180) — a file:// URL an <audio> element can load
  // directly. The sandboxed preload's `url` polyfill lacks pathToFileURL, so
  // this goes through the main process (which has the real Node module). Null
  // when the file is gone (moved/deleted since analysis) so the renderer never
  // points <audio> at a dead path and logs a resource-load error.
  ipcMain.handle('to-file-url', (_event, filePath: string) =>
    fs.existsSync(filePath) ? pathToFileURL(filePath).href : null);

  // start-live
  ipcMain.handle('start-live', async (event, opts: {
    device?: string;
    // Channel-config tokens: "N" (mono) or "N-M" (stereo pair), e.g. ["0","1-2"].
    channels?: string[];
    windowSecs: number;
    // Real-time meter cadence in seconds (default 0.1 in stream.py).
    intervalSecs?: number;
    llmIntervalSecs: number;
    // "monitor" (default) = live view only; "record" = also capture a session.
    mode?: 'monitor' | 'record';
    // Optional output folder for Record mode (defaults to ~/Music/Sound Buddy).
    recordDir?: string;
    // Record mode: which strips to arm as session stems, as channel-config
    // tokens (e.g. ['0', '2-3']). Omitted ⇒ stream.py arms all configured strips.
    arm?: string[];
  }) => {
    // Live monitoring is a Pro feature (#54) — enforce in the main process so
    // the gate holds even if the renderer's CSS gating is bypassed.
    if (!isEntitled('live-monitoring')) {
      return { success: false, error: 'Live monitoring requires a Pro license.' };
    }

    // Clear any stale session dir up front so a failed/aborted start (e.g. mic
    // denied below) can't leave a prior capture's folder to be offered on stop.
    liveSessionDir = null;

    // Refuse to "record" silence: a denied Core Audio grant means stream.py
    // captures nothing. This is the user-initiated moment, so prompt if the
    // permission hasn't been decided yet, then block if it isn't granted.
    const micAccess = await ensureMicrophoneAccess(true);
    if (micAccess !== 'granted') {
      logWarn(`start-live blocked: microphone access is "${micAccess}"`);
      return {
        success: false,
        micAccess,
        error:
          'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.',
      };
    }

    if (liveProcess) {
      liveProcess.kill();
      liveProcess = null;
    }

    const args: string[] = [];
    if (opts.device) args.push(opts.device);
    else args.push('');
    args.push(String(opts.windowSecs));
    if (opts.channels && opts.channels.length > 0) {
      args.push(opts.channels.join(','));
    } else {
      args.push('');
    }

    if (opts.intervalSecs && opts.intervalSecs > 0) {
      args.push('--interval', String(opts.intervalSecs));
    }

    // Record mode: derive a session folder and tell stream.py to capture one
    // stem per armed strip into it (plus session.json). Arm tokens select which
    // strips; omitted ⇒ stream.py arms all configured strips.
    if (opts.mode === 'record') {
      try {
        liveSessionDir = buildSessionDir(opts.recordDir);
        args.push('--session-dir', liveSessionDir);
        if (opts.arm && opts.arm.length > 0) {
          args.push('--arm', opts.arm.join(','));
        }
      } catch (err) {
        logError('start-live: could not prepare recording folder', err);
        return { success: false, error: `Could not prepare recording folder: ${String(err)}` };
      }
    }

    const py = spawn(pythonBin(), [STREAM_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });
    log(`start-live: spawned stream.py (device="${opts.device ?? ''}" window=${opts.windowSecs}s interval=${opts.intervalSecs ?? 0.1}s mode=${opts.mode ?? 'monitor'} llmInterval=${opts.llmIntervalSecs}s)`);

    liveProcess = py;
    const wc = event.sender;
    const windowCollector: unknown[] = [];

    // stderr was previously piped but never read (lost errors + risked backpressure).
    py.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logWarn(`start-live stderr: ${text}`);
    });

    let lineBuffer = '';
    py.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as Record<string, unknown>;
          // Forward to renderer
          if (!wc.isDestroyed()) {
            wc.send('live-event', data);
          }
          // Collect for LLM
          if ('window' in data) {
            windowCollector.push(data);
            if (windowCollector.length > 10) windowCollector.shift();
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    py.on('error', (err: Error) => {
      logError('start-live: stream.py process error', err);
      if (!wc.isDestroyed()) {
        wc.send('live-event', { error: err.message });
      }
    });

    py.on('close', (code: number | null) => {
      liveProcess = null;
      if (code !== 0 && code !== null) {
        logError(`start-live: stream.py exited with code ${code}`);
        if (!wc.isDestroyed()) {
          wc.send('live-event', { error: `stream.py exited with code ${code}` });
        }
      } else {
        log('start-live: stream.py closed cleanly');
      }
    });

    // LLM interval timer
    if (liveIntervalTimer) {
      clearInterval(liveIntervalTimer);
      liveIntervalTimer = null;
    }

    if (opts.llmIntervalSecs > 0 && getSettings().aiEnabled) {
      liveIntervalTimer = setInterval(async () => {
        if (windowCollector.length === 0 || wc.isDestroyed()) return;
        // Entitlement can lapse mid-capture (grace period ending). Skip the
        // tick silently — streamLLM's lock message is for explicit requests;
        // repeating it every interval would spam the AI panel.
        if (!isEntitled('ai-narrative')) return;
        const snapshot = [...windowCollector];

        const systemPrompt = `You are a professional audio engineer monitoring a live mix. You are given consecutive analysis windows. Identify trends, flag developing problems (frequency buildup, approaching clipping, dynamic issues), and give real-time mixing recommendations. Be concise — this is live monitoring.`;
        const userMessage = buildLiveReport(snapshot);

        try {
          await streamLLM(wc, systemPrompt, userMessage);
        } catch {
          // non-fatal
        }
      }, opts.llmIntervalSecs * 1000);
    }

    return { success: true };
  });

  // stop-live
  ipcMain.handle('stop-live', async () => {
    if (liveIntervalTimer) {
      clearInterval(liveIntervalTimer);
      liveIntervalTimer = null;
    }
    const proc = liveProcess;
    liveProcess = null;
    const sessionDirPath = liveSessionDir;
    liveSessionDir = null;

    let closedCleanly = false;
    if (proc) {
      // SIGTERM triggers stream.py's signal handler, which closes every stem
      // header and writes session.json. Wait for the child to actually exit
      // before we inspect the folder, so we never offer a half-written session.
      // If it doesn't exit in time, force-kill it (so the mic is released and the
      // process isn't orphaned) and don't offer the possibly-incomplete session.
      closedCleanly = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
        proc.once('close', () => settle(true));
        proc.kill(); // SIGTERM
        setTimeout(() => {
          if (!settled) {
            logWarn('stop-live: stream.py did not exit in time; sending SIGKILL');
            try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          }
          settle(false);
        }, 2000);
      });
    }

    // Only offer the session if the child finalized cleanly and actually wrote a
    // manifest — session.json is the completion marker (stream.py writes it last,
    // after every stem header is closed), so its presence means the folder holds
    // a coherent, movable session.
    let sessionDir: string | null = null;
    if (sessionDirPath && closedCleanly) {
      try {
        if (fs.statSync(path.join(sessionDirPath, 'session.json')).isFile()) {
          sessionDir = sessionDirPath;
        }
      } catch {
        // no manifest written (record failed to start, or captured nothing)
      }
    }
    return { success: true, sessionDir };
  });

  // reveal-path — open a captured session folder in the OS file manager (#43).
  // openPath opens the folder itself; returns '' on success or an error string.
  ipcMain.handle('reveal-path', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return { success: false, error: 'no path' };
    const err = await shell.openPath(targetPath);
    if (err) {
      logWarn(`reveal-path: ${err}`);
      return { success: false, error: err };
    }
    return { success: true };
  });

  // read-session — load a captured session's session.json manifest so the
  // Virtual Soundcheck UI (#46) can list its tracks. Read-only, renderer-driven.
  ipcMain.handle('read-session', async (_event, sessionDir: string) => {
    if (!sessionDir || typeof sessionDir !== 'string') return { success: false, error: 'No session directory provided.' };
    try {
      const raw = fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf8');
      const manifest = JSON.parse(raw);
      if (!manifest || !Array.isArray(manifest.tracks)) return { success: false, error: 'session.json has no tracks.' };
      return { success: true, manifest };
    } catch (err) {
      logWarn(`read-session: ${(err as Error).message}`);
      return { success: false, error: `Could not read session.json: ${(err as Error).message}` };
    }
  });

  // start-playback — virtual soundcheck (#45). Spawn playback.py to play a
  // captured session's stems through the chosen output device with per-track
  // routing (or a stereo master fold when the device is too small / master is
  // set), forwarding its JSON-line events to the renderer as `playback-event`.
  // Modeled on start-live: a module-level process handle, line-buffered stdout,
  // SIGTERM on stop. No microphone grant (output only) and no LLM path.
  ipcMain.handle('start-playback', async (event, opts: {
    // Session folder holding session.json + stem WAVs (from a Record capture).
    sessionDir: string;
    // Output device index or name; omitted ⇒ playback.py uses the default output.
    device?: string;
    // Routing spec mapping track → output channel(s), e.g. "0:0,1:2-3".
    route?: string;
    // Progress/level cadence in seconds (default 0.1 in playback.py).
    intervalSecs?: number;
    // Force the stereo master mixdown fold even on a big-enough device.
    master?: boolean;
  }) => {
    // Virtual soundcheck is a Pro feature (#54) — enforced here as well as in
    // the renderer. Reading a session manifest stays free (data never locks).
    if (!isEntitled('virtual-soundcheck')) {
      return { success: false, error: 'Virtual soundcheck requires a Pro license.' };
    }
    if (!opts.sessionDir) {
      return { success: false, error: 'No session directory provided.' };
    }

    // A new playback replaces any in-flight one — SIGTERM the old child so its
    // finalize() closes the stream before we open a second one on the device.
    if (playbackProcess) {
      playbackProcess.kill();
      playbackProcess = null;
    }

    const args: string[] = [opts.sessionDir];
    if (opts.device) args.push('--device', opts.device);
    if (opts.route) args.push('--route', opts.route);
    if (opts.intervalSecs && opts.intervalSecs > 0) {
      args.push('--interval', String(opts.intervalSecs));
    }
    if (opts.master) args.push('--master');

    const py = spawn(pythonBin(), [PLAYBACK_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });
    log(`start-playback: spawned playback.py (session="${opts.sessionDir}" device="${opts.device ?? ''}" route="${opts.route ?? ''}" master=${opts.master ?? false})`);

    playbackProcess = py;
    const wc = event.sender;

    py.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logWarn(`start-playback stderr: ${text}`);
    });

    let lineBuffer = '';
    py.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as Record<string, unknown>;
          if (!wc.isDestroyed()) {
            wc.send('playback-event', data);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    py.on('error', (err: Error) => {
      logError('start-playback: playback.py process error', err);
      if (!wc.isDestroyed()) {
        wc.send('playback-event', { error: err.message });
      }
    });

    py.on('close', (code: number | null) => {
      // Only clear the handle if this child is still the current one — a rapid
      // restart may have already replaced it.
      if (playbackProcess === py) playbackProcess = null;
      if (code !== 0 && code !== null) {
        logError(`start-playback: playback.py exited with code ${code}`);
        if (!wc.isDestroyed()) {
          wc.send('playback-event', { error: `playback.py exited with code ${code}` });
        }
      } else {
        log('start-playback: playback.py closed cleanly');
      }
    });

    return { success: true };
  });

  // stop-playback — SIGTERM the playback child so playback.py's signal handler
  // closes the output stream cleanly; SIGKILL as a fallback if it doesn't exit.
  ipcMain.handle('stop-playback', async () => {
    const proc = playbackProcess;
    playbackProcess = null;
    if (!proc) return { success: true };

    await new Promise<void>((resolveStop) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolveStop(); } };
      proc.once('close', settle);
      proc.kill(); // SIGTERM
      setTimeout(() => {
        if (!settled) {
          logWarn('stop-playback: playback.py did not exit in time; sending SIGKILL');
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        }
        settle();
      }, 2000);
    });
    return { success: true };
  });

  // trigger-llm-analysis
  ipcMain.handle('trigger-llm-analysis', async (event, data: { analysis?: AudioAnalysis; windows?: unknown[]; mode: string }) => {
    const wc = event.sender;

    const systemPrompt = `You are a professional audio engineer with 20+ years of experience. Analyze the given acoustic measurement data deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;

    let userMessage: string;
    if (data.mode === 'live' && data.windows) {
      userMessage = buildLiveReport(data.windows);
    } else if (data.analysis) {
      userMessage = buildAnalysisReport(data.analysis);
    } else {
      wc.send('llm-delta', '\n[No analysis data available]\n');
      wc.send('llm-done');
      return { success: false };
    }

    try {
      await streamLLM(wc, systemPrompt, userMessage);
      return { success: true };
    } catch (err) {
      logError(`trigger-llm-analysis failed (mode=${data.mode})`, err);
      return { success: false, error: String(err) };
    }
  });
}
