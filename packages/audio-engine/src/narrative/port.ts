/** A model available for narrative generation. */
export interface ModelInfo {
  /** Provider id, e.g. "anthropic", "ollama". */
  provider: string;
  /** Model id within the provider, e.g. "claude-sonnet-4-6". */
  id: string;
  /** Human-readable model name. */
  name: string;
}

/** Outcome of a streaming narrative call. Never throws — errors come back as { ok: false }. */
export type NarrativeResult =
  | { ok: true; provider: string; model: string }
  | { ok: false; reason: string };

/** Callback invoked once per streamed text chunk. */
export type NarrativeDeltaHandler = (text: string) => void;

/**
 * Provider-agnostic port for AI narrative generation (TD-004, #398).
 * All AI narrative calls across app/CLI/engine flow through this interface.
 */
export interface NarrativePort {
  streamNarrative(
    systemPrompt: string,
    userMessage: string,
    onDelta: NarrativeDeltaHandler
  ): Promise<NarrativeResult>;
  listModels(): Promise<ModelInfo[]>;
}
