// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// LLM narrative provider for the optional "AI Engineer" panel.
//
// Two backends, chosen by the configured provider:
//
//   • "ollama"  → direct HTTP to a local Ollama server (POST /api/chat). Fully
//     offline, no account, no external CLI. Works inside Electron's bundled Node
//     (plain http, no undici). This is the recommended path for a no-cloud machine.
//
//   • anything else ("anthropic", "openai"/Codex, "copilot", …) → the pi CLI
//     (@earendil-works/pi-coding-agent), which lets users power the narrative with
//     their OWN subscription or API key via `pi` + /login (creds in
//     ~/.pi/agent/auth.json, auto-refreshed). pi runs as a SUBPROCESS because it
//     needs Node >=22.19 / undici v8 and can't load inside Electron 31 (Node 20).
//
// Config comes from env vars (handy in dev) or a small JSON file in the app's
// user-data dir — the way a Finder-launched app (no shell env) is configured:
//   ~/Library/Application Support/SoundBuddy/llm.json
//   { "provider": "ollama", "model": "llama3.2" }
//   { "provider": "anthropic", "model": "claude-sonnet-4-6" }

import { spawn } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { logWarn } from './logger';
import { isAiEnabled } from './settings';

export interface NarrativeOutcome {
  ok: boolean;
  provider?: string;
  model?: string;
  /**
   * 'disabled' when AI is turned off in settings (default), 'no-provider' when
   * AI is enabled but nothing is configured; otherwise an error string.
   */
  reason?: string;
}

interface LlmConfig {
  provider?: string;
  model?: string;
  ollamaHost?: string;
  piBin?: string;
}

function readConfig(): LlmConfig {
  let file: LlmConfig = {};
  try {
    const p = path.join(app.getPath('userData'), 'llm.json');
    if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, 'utf8')) as LlmConfig;
  } catch (err) {
    logWarn(`could not read llm.json: ${String(err)}`);
  }
  return {
    provider: process.env.SOUND_BUDDY_LLM_PROVIDER?.trim() || file.provider,
    model: process.env.SOUND_BUDDY_LLM_MODEL?.trim() || file.model,
    ollamaHost: process.env.SOUND_BUDDY_OLLAMA_HOST?.trim() || file.ollamaHost,
    piBin: process.env.SOUND_BUDDY_PI_BIN?.trim() || file.piBin,
  };
}

export async function streamNarrative(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
): Promise<NarrativeOutcome> {
  // Master AI switch (off by default). Keeps every provider path wired in but
  // short-circuits before any subprocess/network call when AI is disabled.
  if (!isAiEnabled()) return { ok: false, reason: 'disabled' };

  const cfg = readConfig();
  if (!cfg.provider) return { ok: false, reason: 'no-provider' };

  if (cfg.provider === 'ollama') {
    return streamOllama(
      onDelta,
      systemPrompt,
      userMessage,
      cfg.model || 'llama3.2',
      cfg.ollamaHost || 'http://localhost:11434',
    );
  }
  return streamPi(onDelta, systemPrompt, userMessage, cfg.provider, cfg.model, cfg.piBin || 'pi');
}

// ─── Ollama (direct HTTP, offline) ──────────────────────────────────────────────
// Mirrors packages/audio-engine/src/engineer.ts:analyzeWithOllama — NDJSON stream
// from /api/chat, one JSON object per line: { message: { content }, done }.
function streamOllama(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
  model: string,
  host: string,
): Promise<NarrativeOutcome> {
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: true,
  });
  const url = new URL('/api/chat', host);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<NarrativeOutcome>((resolve) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buffer = '';
        let settled = false;
        const consume = (line: string): void => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const json = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };
            if (json.error && !settled) {
              settled = true;
              resolve({ ok: false, reason: json.error });
              return;
            }
            if (json.message?.content) onDelta(json.message.content);
          } catch {
            // ignore malformed lines
          }
        };
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) consume(line);
        });
        res.on('end', () => {
          if (buffer) consume(buffer);
          if (!settled) resolve({ ok: true, provider: 'ollama', model });
        });
        res.on('error', (err: Error) => {
          if (!settled) { settled = true; resolve({ ok: false, reason: err.message }); }
        });
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        reason: err.code === 'ECONNREFUSED'
          ? `Ollama not reachable at ${host} — start it with \`ollama serve\` (or install a model with \`ollama pull ${model}\`)`
          : err.message,
      });
    });
    req.write(body);
    req.end();
  });
}

// ─── pi CLI (subscriptions / API keys) ─────────────────────────────────────────
function streamPi(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
  provider: string,
  model: string | undefined,
  piBin: string,
): Promise<NarrativeOutcome> {
  const args = [
    '--print',
    '--no-tools',
    '--no-session',
    '--mode', 'text',
    '--provider', provider,
    '--system-prompt', systemPrompt,
  ];
  if (model) args.push('--model', model);
  args.push(userMessage);

  return new Promise<NarrativeOutcome>((resolve) => {
    let child;
    try {
      child = spawn(piBin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: app.getPath('userData') });
    } catch (err) {
      resolve({ ok: false, reason: `failed to spawn ${piBin}: ${String(err)}` });
      return;
    }
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => onDelta(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        reason: err.code === 'ENOENT'
          ? 'pi not found — install it (npm i -g @earendil-works/pi-coding-agent, needs Node 22+) and run `pi` then /login'
          : `failed to run ${piBin}: ${err.message}`,
      });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, provider, model });
      else resolve({ ok: false, reason: stderr.trim() || `pi exited with code ${code}` });
    });
  });
}
