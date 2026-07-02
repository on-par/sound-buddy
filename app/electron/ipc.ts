import { ipcMain, dialog, BrowserWindow, app, systemPreferences } from 'electron';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from './logger';
import { streamNarrative } from './llm';

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
    path.join(app.getPath('userData'), 'venv', 'bin', 'python3'),
    path.join(REPO_ROOT, '.venv', 'bin', 'python3'),
  ].filter((p): p is string => Boolean(p));
  cachedPython = candidates.find((p) => fs.existsSync(p)) ?? 'python3';
  log(`python interpreter: ${cachedPython}`);
  return cachedPython;
}

let liveProcess: ChildProcess | null = null;
let liveIntervalTimer: NodeJS.Timeout | null = null;

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

async function runSox(filePath: string): Promise<SoxStats> {
  let stderr = '';
  try {
    const result = await execFileAsync('sox', [filePath, '-n', 'stat'], { encoding: 'utf8' });
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

async function runFfprobe(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
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

async function runSpectrum(filePath: string): Promise<SpectrumResult> {
  const { stdout } = await execFileAsync(pythonBin(), [SPECTRUM_SCRIPT, filePath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
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
  };

  return {
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

  // Route through pi so the narrative uses whatever provider the user configured
  // (ChatGPT/Codex sub, Claude sub, Copilot, an API key, or local Ollama).
  const outcome = await streamNarrative((text) => send('llm-delta', text), systemPrompt, userMessage);

  if (!outcome.ok) {
    if (outcome.reason === 'no-provider') {
      logWarn('LLM analysis skipped: no pi provider configured');
      send(
        'llm-delta',
        '\n⚠️  No AI provider configured. Run `pi` then `/login` to connect your own ' +
          'ChatGPT/Codex, Claude, or Copilot subscription — or a local Ollama model (offline). ' +
          'Optionally set SOUND_BUDDY_LLM_PROVIDER / SOUND_BUDDY_LLM_MODEL to pick one.\n',
      );
    } else {
      logError(`LLM narrative error: ${outcome.reason}`);
      send('llm-delta', `\n[AI error: ${outcome.reason}]\n`);
    }
  } else {
    log(`LLM narrative ok via ${outcome.provider ?? '?'}/${outcome.model ?? '?'}`);
  }
  send('llm-done');
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {
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

  // list-devices
  ipcMain.handle('list-devices', async () => {
    // Read (don't prompt for) the Core Audio permission alongside enumeration.
    // Enumeration works without the grant; reporting the status lets the renderer
    // distinguish a blocked mic from genuinely absent input hardware.
    const micAccess = await ensureMicrophoneAccess(false);
    return new Promise<{ success: boolean; devices?: unknown[]; error?: string; micAccess: MicAccess }>((resolve) => {
      let output = '';
      let errOutput = '';
      const py = spawn(pythonBin(), [STREAM_SCRIPT, '--list-devices'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      py.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      // stderr was previously piped but never read (lost errors + risked backpressure).
      py.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

      py.on('close', (code) => {
        if (code !== 0 && !output.trim()) {
          logError(`list-devices: stream.py exited with code ${code}`, errOutput.trim() || undefined);
          resolve({ success: false, error: `stream.py exited with code ${code}`, micAccess });
          return;
        }
        try {
          const parsed = JSON.parse(output.trim()) as { devices?: unknown[] };
          if (errOutput.trim()) logWarn(`list-devices stderr: ${errOutput.trim()}`);
          resolve({ success: true, devices: parsed.devices ?? [], micAccess });
        } catch (err) {
          logError('list-devices: failed to parse device list', errOutput.trim() || err);
          resolve({ success: false, error: 'Failed to parse device list', micAccess });
        }
      });

      py.on('error', (err) => {
        logError(`list-devices: failed to spawn ${pythonBin()}`, err);
        resolve({ success: false, error: err.message, micAccess });
      });
    });
  });

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

  // start-live
  ipcMain.handle('start-live', async (event, opts: {
    device?: string;
    channels?: number[];
    windowSecs: number;
    llmIntervalSecs: number;
  }) => {
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

    const py = spawn(pythonBin(), [STREAM_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log(`start-live: spawned stream.py (device="${opts.device ?? ''}" window=${opts.windowSecs}s llmInterval=${opts.llmIntervalSecs}s)`);

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

    if (opts.llmIntervalSecs > 0) {
      liveIntervalTimer = setInterval(async () => {
        if (windowCollector.length === 0 || wc.isDestroyed()) return;
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
  ipcMain.handle('stop-live', () => {
    if (liveIntervalTimer) {
      clearInterval(liveIntervalTimer);
      liveIntervalTimer = null;
    }
    if (liveProcess) {
      liveProcess.kill();
      liveProcess = null;
    }
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
