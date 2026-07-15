// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// AI-narrative domain (#225 split of the former monolithic ipc.ts): the
// report builders fed to the LLM, the streaming bridge shared by the
// analyze-file and live-monitoring entry points, and the AI provider
// settings / trigger-llm-analysis IPC handlers.

import { ipcMain } from 'electron';
import { log, logWarn, logError } from '../logger';
import { streamNarrative } from '../llm';
import { probeOllama } from '../ollama-probe';
import { testProvider, listNarrativeModels } from '../narrative-port';
import { getPublicLlmConfig, saveLlmConfig, type LlmConfigPatch } from '../llm-config';
import { isEntitled } from '../license';
import type { AudioAnalysis } from './analysis';

// ─── LLM ──────────────────────────────────────────────────────────────────────

export function buildAnalysisReport(analysis: AudioAnalysis): string {
  const { sox, ffprobe, spectrum } = analysis;
  const { bands } = spectrum;
  // Inline twin of @sound-buddy/audio-engine's canonical fmt (format.ts, #429):
  // electron main must not statically import the audio-engine ESM — the
  // packaged .app bundles no node_modules (see narrative-port.ts header).
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

export function buildLiveReport(windowData: unknown[]): string {
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

// Shared by analyze-file's trigger-llm-analysis and the live-monitoring
// interval timer (live-capture.ts) — both stream deltas back to the same
// renderer window over the same channels.
export async function streamLLM(
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

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

export function registerNarrativeHandlers(): void {
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
      testProvider(opts && typeof opts === 'object' ? opts : { provider: '' }),
  );

  // Model list for the settings screen's provider/model pickers (TD-004
  // slice 3, #427) — sourced from Pi's ModelRegistry instead of a hardcoded
  // hint map.
  ipcMain.handle('llm-list-models', () => listNarrativeModels());

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
