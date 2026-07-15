import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelInfo, NarrativeDeltaHandler, NarrativePort, NarrativeResult } from "./port.js";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export interface PiNarrativeAdapterOptions {
  /** Pi provider id (default "anthropic"). */
  provider?: string;
  /** Model id within the provider (default "claude-sonnet-4-6"). */
  modelId?: string;
}

/** NarrativePort implementation backed by the Pi SDK (@earendil-works/pi-coding-agent). */
export class PiNarrativeAdapter implements NarrativePort {
  private readonly provider: string;
  private readonly modelId: string;

  constructor(options: PiNarrativeAdapterOptions = {}) {
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
  }

  async streamNarrative(
    systemPrompt: string,
    userMessage: string,
    onDelta: NarrativeDeltaHandler
  ): Promise<NarrativeResult> {
    try {
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      const model = modelRegistry.find(this.provider, this.modelId);
      if (!model) {
        return {
          ok: false,
          reason: `Model ${this.provider}/${this.modelId} not found in the Pi model registry. Run \`pi\` to configure the provider, or pass a valid provider/modelId to PiNarrativeAdapter.`,
        };
      }
      const { session } = await createAgentSession({
        model,
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
      });
      session.subscribe((event: unknown) => {
        const e = event as Record<string, unknown>;
        if (e["type"] === "text_delta" && typeof e["text"] === "string") {
          onDelta(e["text"]);
        }
      });
      await session.prompt(`${systemPrompt}\n\n${userMessage}`);
      return { ok: true, provider: this.provider, model: this.modelId };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    return modelRegistry
      .getAvailable()
      .map((m) => ({ provider: m.provider, id: m.id, name: m.name }));
  }
}
