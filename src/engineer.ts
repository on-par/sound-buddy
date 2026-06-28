import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AudioAnalysis, ChannelAnalysis, ChannelComparison } from "./types.js";

const SYSTEM_PROMPT = `You are a professional audio engineer with 20+ years of experience. You are given acoustic measurement data for an audio file. Analyze it deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;

const MULTI_CHANNEL_SYSTEM_PROMPT = `You are a professional mixing engineer analyzing a multi-track recording from a Midas M32R console. Given the acoustic measurements of each channel and the full mix, identify: frequency masking between channels, problematic EQ buildups, channels that need low-cut or high-cut filters, channels competing in the same frequency range, and give specific actionable EQ/dynamics recommendations per channel. Reference actual dB values.`;

function fmt(n: number, decimals = 2): string {
  return isFinite(n) ? n.toFixed(decimals) : "-inf";
}

function buildMultiChannelPrompt(
  mix: AudioAnalysis | null,
  channels: ChannelAnalysis[],
  comparison: ChannelComparison
): string {
  const lines: string[] = [];

  if (mix) {
    lines.push("=== FULL MIX ANALYSIS ===");
    lines.push(`Peak: ${fmt(mix.sox.peakDbfs)} dBFS | RMS: ${fmt(mix.sox.rmsDbfs)} dBFS | Dyn Range: ${fmt(mix.sox.dynamicRangeDb)} dB | Clipping: ${mix.sox.clipping ? "YES" : "No"}`);
    lines.push(`Spectral centroid: ${Math.round(mix.spectrum.spectralCentroid)} Hz | Rolloff 85%: ${Math.round(mix.spectrum.spectralRolloff85)} Hz`);
    lines.push(`Bands (dBFS): sub=${fmt(mix.spectrum.bands.subBass)} bass=${fmt(mix.spectrum.bands.bass)} lo-mid=${fmt(mix.spectrum.bands.lowMid)} mid=${fmt(mix.spectrum.bands.mid)} hi-mid=${fmt(mix.spectrum.bands.highMid)} presence=${fmt(mix.spectrum.bands.presence)} brilliance=${fmt(mix.spectrum.bands.brilliance)}`);
    lines.push("");
  }

  lines.push("=== CHANNEL ANALYSES ===");
  for (const { channel, analysis } of channels) {
    const { sox, spectrum } = analysis;
    const b = spectrum.bands;
    lines.push(`--- ${channel.name} (CH${channel.index + 1}) ---`);
    lines.push(`  Peak: ${fmt(sox.peakDbfs)} dBFS | RMS: ${fmt(sox.rmsDbfs)} dBFS | Dyn Range: ${fmt(sox.dynamicRangeDb)} dB | Clipping: ${sox.clipping ? "YES" : "No"}`);
    lines.push(`  Spectral centroid: ${Math.round(spectrum.spectralCentroid)} Hz`);
    lines.push(`  Bands (dBFS): sub=${fmt(b.subBass)} bass=${fmt(b.bass)} lo-mid=${fmt(b.lowMid)} mid=${fmt(b.mid)} hi-mid=${fmt(b.highMid)} presence=${fmt(b.presence)} brilliance=${fmt(b.brilliance)}`);
  }
  lines.push("");

  lines.push("=== COMPARISON & MASKING ANALYSIS ===");

  if (comparison.subBassOffenders.length > 0) {
    lines.push(`Sub-bass offenders (>-20 dBFS in sub-bass band): ${comparison.subBassOffenders.join(", ")}`);
  }

  if (comparison.maskingPairs.length > 0) {
    lines.push(`Masking pairs (within 3 dB of each other in same band):`);
    for (const pair of comparison.maskingPairs) {
      lines.push(`  ${pair.bandName}: ${pair.channelA} vs ${pair.channelB} (diff: ${fmt(pair.energyDiff)} dB)`);
    }
  }

  lines.push("Band rankings (channels sorted by energy, highest first):");
  for (const [band, ranked] of Object.entries(comparison.bandRankings)) {
    lines.push(`  ${band}: ${ranked.join(" > ")}`);
  }

  lines.push("Mix band energy (sum of all channels):");
  for (const [band, energy] of Object.entries(comparison.mixBandEnergy)) {
    lines.push(`  ${band}: ${fmt(energy)} dBFS`);
  }

  return lines.join("\n");
}

async function createSession() {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find("anthropic", "claude-sonnet-4-6");
  if (!model) throw new Error("Model claude-sonnet-4-6 not found in registry");
  return createAgentSession({
    model,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });
}

export async function getEngineerRead(report: string): Promise<void> {
  const { session } = await createSession();

  const prompt = `${SYSTEM_PROMPT}\n\nHere is the acoustic measurement data:\n\n${report}`;

  session.subscribe((event: unknown) => {
    const e = event as Record<string, unknown>;
    if (e["type"] === "text_delta" && typeof e["text"] === "string") {
      process.stdout.write(e["text"]);
    }
  });

  await session.prompt(prompt);
  process.stdout.write("\n");
}

export async function analyzeMultiChannel(
  mix: AudioAnalysis | null,
  channels: ChannelAnalysis[],
  comparison: ChannelComparison
): Promise<void> {
  const { session } = await createSession();

  const prompt = `${MULTI_CHANNEL_SYSTEM_PROMPT}\n\n${buildMultiChannelPrompt(mix, channels, comparison)}`;

  session.subscribe((event: unknown) => {
    const e = event as Record<string, unknown>;
    if (e["type"] === "text_delta" && typeof e["text"] === "string") {
      process.stdout.write(e["text"]);
    }
  });

  await session.prompt(prompt);
  process.stdout.write("\n");
}
