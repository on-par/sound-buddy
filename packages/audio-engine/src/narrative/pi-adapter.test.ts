import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelInfo, NarrativePort, NarrativeResult } from "./port.js";

const {
  promptMock,
  subscribeMock,
  findMock,
  getAvailableMock,
  authCreateMock,
  modelRegistryCreateMock,
  sessionManagerInMemoryMock,
  createAgentSessionMock,
} = vi.hoisted(() => {
  const promptMock = vi.fn().mockResolvedValue(undefined);
  const subscribeMock = vi.fn();
  const findMock = vi.fn((): { id: string } | undefined => ({ id: "claude-sonnet-4-6" }));
  const getAvailableMock = vi.fn(
    (): Array<{ provider: string; id: string; name: string; [key: string]: unknown }> => []
  );
  const authCreateMock = vi.fn(() => ({}));
  const modelRegistryCreateMock = vi.fn(() => ({ find: findMock, getAvailable: getAvailableMock }));
  const sessionManagerInMemoryMock = vi.fn(() => ({}));
  const createAgentSessionMock = vi.fn(async () => ({
    session: { subscribe: subscribeMock, prompt: promptMock },
  }));
  return {
    promptMock,
    subscribeMock,
    findMock,
    getAvailableMock,
    authCreateMock,
    modelRegistryCreateMock,
    sessionManagerInMemoryMock,
    createAgentSessionMock,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: createAgentSessionMock,
  AuthStorage: { create: authCreateMock },
  ModelRegistry: { create: modelRegistryCreateMock },
  SessionManager: { inMemory: sessionManagerInMemoryMock },
}));

import { PiNarrativeAdapter } from "./pi-adapter.js";

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockImplementation(() => ({ id: "claude-sonnet-4-6" }));
  createAgentSessionMock.mockImplementation(async () => ({
    session: { subscribe: subscribeMock, prompt: promptMock },
  }));
  promptMock.mockResolvedValue(undefined);
});

describe("PiNarrativeAdapter", () => {
  it("satisfies the NarrativePort interface", async () => {
    const port: NarrativePort = new PiNarrativeAdapter();
    const result: NarrativeResult = await port.streamNarrative("sys", "user", vi.fn());
    expect(result.ok).toBe(true);
    const models: ModelInfo[] = await port.listModels();
    expect(models).toEqual([]);
  });

  it("wires Pi session dependencies when streaming a narrative", async () => {
    const adapter = new PiNarrativeAdapter();
    await adapter.streamNarrative("sys", "user", vi.fn());

    expect(authCreateMock).toHaveBeenCalled();
    expect(modelRegistryCreateMock).toHaveBeenCalledWith(authCreateMock.mock.results[0]?.value);
    expect(sessionManagerInMemoryMock).toHaveBeenCalled();
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: findMock.mock.results[0]?.value })
    );
  });

  it("defaults to the anthropic claude-sonnet-4-6 model", async () => {
    const adapter = new PiNarrativeAdapter();
    await adapter.streamNarrative("sys", "user", vi.fn());

    expect(findMock).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
  });

  it("honors constructor options for provider and model", async () => {
    const adapter = new PiNarrativeAdapter({ provider: "ollama", modelId: "llama3.2" });
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(findMock).toHaveBeenCalledWith("ollama", "llama3.2");
    expect(result).toEqual({ ok: true, provider: "ollama", model: "llama3.2" });
  });

  it("builds the prompt from the system prompt and user message", async () => {
    const adapter = new PiNarrativeAdapter();
    await adapter.streamNarrative("sys", "user", vi.fn());

    expect(promptMock.mock.calls[0][0]).toContain("sys");
    expect(promptMock.mock.calls[0][0]).toContain("user");
  });

  it("streams only text_delta events with string text via onDelta", async () => {
    const adapter = new PiNarrativeAdapter();
    const onDelta = vi.fn();
    await adapter.streamNarrative("sys", "user", onDelta);

    const handler = subscribeMock.mock.calls[0][0];
    handler({ type: "text_delta", text: "hello" });
    handler({ type: "text_delta", text: " world" });
    handler({ type: "other", text: "x" });
    handler({ type: "text_delta", text: 42 });

    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, "hello");
    expect(onDelta).toHaveBeenNthCalledWith(2, " world");
  });

  it("returns an ok result on success", async () => {
    const adapter = new PiNarrativeAdapter();
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(result).toEqual({ ok: true, provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("returns an actionable failure when the model is not found", async () => {
    findMock.mockReturnValueOnce(undefined);
    const adapter = new PiNarrativeAdapter();
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("anthropic/claude-sonnet-4-6"),
    });
    expect((result as { reason: string }).reason).toContain("pi");
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it("returns a failure instead of throwing when createAgentSession rejects", async () => {
    createAgentSessionMock.mockRejectedValueOnce(new Error("boom"));
    const adapter = new PiNarrativeAdapter();
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(result).toEqual({ ok: false, reason: "boom" });
  });

  it("returns a failure instead of throwing when session.prompt rejects", async () => {
    promptMock.mockRejectedValueOnce(new Error("stream died"));
    const adapter = new PiNarrativeAdapter();
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(result).toEqual({ ok: false, reason: "stream died" });
  });

  it("stringifies non-Error throws", async () => {
    createAgentSessionMock.mockImplementationOnce(() => {
      throw "string failure";
    });
    const adapter = new PiNarrativeAdapter();
    const result = await adapter.streamNarrative("sys", "user", vi.fn());

    expect(result).toEqual({ ok: false, reason: "string failure" });
  });

  it("maps registry models to ModelInfo", async () => {
    getAvailableMock.mockReturnValueOnce([
      { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200000 },
      { provider: "ollama", id: "llama3.2", name: "Llama 3.2", contextWindow: 128000 },
    ]);
    const adapter = new PiNarrativeAdapter();
    const models = await adapter.listModels();

    expect(models).toEqual([
      { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { provider: "ollama", id: "llama3.2", name: "Llama 3.2" },
    ]);
  });

  it("returns an empty list when no models are available", async () => {
    const adapter = new PiNarrativeAdapter();
    const models = await adapter.listModels();

    expect(models).toEqual([]);
  });
});
