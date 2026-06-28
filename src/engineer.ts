import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

const SYSTEM_PROMPT = `You are a professional audio engineer with 20+ years of experience. You are given acoustic measurement data for an audio file. Analyze it deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;

export async function getEngineerRead(report: string): Promise<void> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel("anthropic", "claude-sonnet-4-6");

  const { session } = await createAgentSession({
    model,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  const prompt = `${SYSTEM_PROMPT}\n\nHere is the acoustic measurement data:\n\n${report}`;

  // Stream text deltas to stdout as they arrive
  session.subscribe((event: unknown) => {
    const e = event as Record<string, unknown>;
    if (e["type"] === "text_delta" && typeof e["text"] === "string") {
      process.stdout.write(e["text"]);
    }
  });

  await session.prompt(prompt);

  // Ensure newline at end
  process.stdout.write("\n");
}
