import { ipcMain, dialog, BrowserWindow } from 'electron';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as https from 'https';

const execFileAsync = promisify(execFile);

// Resolve paths relative to the repo root (three levels up from app/dist/electron/)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SPECTRUM_SCRIPT = path.join(REPO_ROOT, 'scripts', 'spectrum.py');
const STREAM_SCRIPT = path.join(REPO_ROOT, 'scripts', 'stream.py');

let liveProcess: ChildProcess | null = null;
let liveIntervalTimer: NodeJS.Timeout | null = null;

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
  const volumeAdjustment = parseField(stderr, 'Volume adjustment:');

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
  const { stdout } = await execFileAsync('python3', [SPECTRUM_SCRIPT, filePath], {
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    webContents.send('llm-delta', '\n⚠️  Set ANTHROPIC_API_KEY environment variable to enable AI analysis\n');
    webContents.send('llm-done');
    return;
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    stream: true,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res: import('http').IncomingMessage) => {
      let buffer = '';

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
              if (json['type'] === 'content_block_delta') {
                const delta = json['delta'] as Record<string, unknown>;
                if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
                  if (!webContents.isDestroyed()) {
                    webContents.send('llm-delta', delta['text']);
                  }
                }
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      });

      res.on('end', () => {
        if (!webContents.isDestroyed()) {
          webContents.send('llm-done');
        }
        resolve();
      });

      res.on('error', (err: Error) => {
        if (!webContents.isDestroyed()) {
          webContents.send('llm-delta', `\n[API error: ${err.message}]\n`);
          webContents.send('llm-done');
        }
        reject(err);
      });
    });

    req.on('error', (err: Error) => {
      if (!webContents.isDestroyed()) {
        webContents.send('llm-delta', `\n[Network error: ${err.message}]\n`);
        webContents.send('llm-done');
      }
      reject(err);
    });

    req.write(body);
    req.end();
  });
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
      return { success: true, data: analysis };
    } catch (err) {
      const message = String(err);
      return { success: false, error: message };
    }
  });

  // list-devices
  ipcMain.handle('list-devices', async () => {
    return new Promise<{ success: boolean; devices?: unknown[]; error?: string }>((resolve) => {
      let output = '';
      const py = spawn('python3', [STREAM_SCRIPT, '--list-devices'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      py.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });

      py.on('close', (code) => {
        if (code !== 0 && !output.trim()) {
          resolve({ success: false, error: `stream.py exited with code ${code}` });
          return;
        }
        try {
          const parsed = JSON.parse(output.trim()) as { devices?: unknown[] };
          resolve({ success: true, devices: parsed.devices ?? [] });
        } catch {
          resolve({ success: false, error: 'Failed to parse device list' });
        }
      });

      py.on('error', (err) => {
        resolve({ success: false, error: err.message });
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

    const py = spawn('python3', [STREAM_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    liveProcess = py;
    const wc = event.sender;
    const windowCollector: unknown[] = [];

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
      if (!wc.isDestroyed()) {
        wc.send('live-event', { error: err.message });
      }
    });

    py.on('close', (code: number | null) => {
      liveProcess = null;
      if (!wc.isDestroyed() && code !== 0 && code !== null) {
        wc.send('live-event', { error: `stream.py exited with code ${code}` });
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
      return { success: false, error: String(err) };
    }
  });
}
