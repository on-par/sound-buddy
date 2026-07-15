// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// LLM narrative entry point for the optional "AI Engineer" panel. A thin
// wrapper (TD-004 slice 3, #427): local Ollama, a pasted hosted-provider key,
// and pi subscription logins all flow through narrative-port.ts's Pi SDK
// bridge — this module owns only the gates that must run before a port ever
// loads, and preserves the historic NarrativeOutcome shape/reasons ('disabled',
// 'no-provider') that ipc/narrative.ts and the renderer already branch on.

import { isAiEnabled } from './settings';
import { getLlmConfig, HOSTED_PROVIDER_IDS } from './llm-config';
import { getNarrativePort } from './narrative-port';

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

export async function streamNarrative(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
): Promise<NarrativeOutcome> {
  // Master AI switch (off by default) — short-circuits before any port load.
  if (!isAiEnabled()) return { ok: false, reason: 'disabled' };

  const cfg = getLlmConfig();
  if (!cfg.provider) return { ok: false, reason: 'no-provider' };

  // Direct hosted providers hard-require a model (no server-side default);
  // ollama and pi pass-through providers supply their own.
  if (HOSTED_PROVIDER_IDS.has(cfg.provider) && !cfg.model) {
    return { ok: false, reason: 'No model configured — pick one in AI settings.' };
  }

  const result = await getNarrativePort();
  if ('error' in result) return { ok: false, reason: result.error };

  return result.port.streamNarrative(systemPrompt, userMessage, onDelta);
}
