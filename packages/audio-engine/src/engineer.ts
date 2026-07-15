import * as http from "http";
import type { AudioAnalysis, ChannelAnalysis, ChannelComparison } from "./types.js";
import type { WindowData } from "./stream/types.js";
import { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT } from "./prompts/index.js";
import { fmt } from "./format.js";
import type { NarrativePort } from "./narrative/port.js";
import { PiNarrativeAdapter } from "./narrative/pi-adapter.js";

export function buildMultiChannelPrompt(
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

/** Stream a narrative to stdout via the port; throws on failure so the CLI's
 *  existing catch/exit-1 paths (cli.ts, stream/index.ts) keep working. */
async function streamToStdout(
  port: NarrativePort,
  systemPrompt: string,
  userMessage: string
): Promise<void> {
  const result = await port.streamNarrative(systemPrompt, userMessage, (text) => {
    process.stdout.write(text);
  });
  if (!result.ok) throw new Error(result.reason);
  process.stdout.write("\n");
}

export async function analyzeStream(
  windows: WindowData[],
  _channelNames: string[],
  port: NarrativePort = new PiNarrativeAdapter()
): Promise<void> {
  const windowSecs = windows.length > 1
    ? (windows[windows.length - 1].ts - windows[0].ts) / (windows.length - 1)
    : 3;

  const systemPrompt = `You are a professional audio engineer monitoring a live mix from a Midas M32R console. You are given ${windows.length} consecutive ${windowSecs.toFixed(1)}-second analysis windows. Identify trends, flag developing problems (frequency buildup, approaching clipping, dynamic issues), and give real-time mixing recommendations. Be concise — this is live monitoring, not a post-session report.`;

  const summary = windows.map((w) => {
    const chSummary = w.channels.map((ch) => {
      const bandStr = Object.entries(ch.bands)
        .map(([k, v]) => `${k}:${v.toFixed(1)}dB`)
        .join(", ");
      return `    ${ch.name}: rms=${ch.rms.toFixed(1)}dBFS peak=${ch.peak.toFixed(1)}dBFS clip=${ch.clipping} centroid=${Math.round(ch.centroid)}Hz [${bandStr}]`;
    }).join("\n");
    const maskStr = w.masking.map((m) => `${m.band}:${m.channelA}↔${m.channelB}(${m.diffDb.toFixed(1)}dB)`).join(", ");
    return `Window ${w.window} (t=${new Date(w.ts * 1000).toISOString()}):\n${chSummary}${maskStr ? `\n    masking: ${maskStr}` : ""}`;
  }).join("\n\n");

  await streamToStdout(port, systemPrompt, `Live mix data:\n\n${summary}`);
}

export async function getEngineerRead(
  report: string,
  port: NarrativePort = new PiNarrativeAdapter()
): Promise<void> {
  await streamToStdout(port, SYSTEM_PROMPT, `Here is the acoustic measurement data:\n\n${report}`);
}

export async function analyzeMultiChannel(
  mix: AudioAnalysis | null,
  channels: ChannelAnalysis[],
  comparison: ChannelComparison,
  port: NarrativePort = new PiNarrativeAdapter()
): Promise<void> {
  await streamToStdout(port, MULTI_CHANNEL_SYSTEM_PROMPT, buildMultiChannelPrompt(mix, channels, comparison));
}

// Deliberate parallel path, not routed through NarrativePort: the CLI's
// --ollama flag targets an arbitrary user-specified host/model directly,
// while PiNarrativeAdapter can only reach Ollama through a pi models.json
// (ModelRegistry). Folding this in would change the wire protocol and CLI
// flags — a feature change, out of scope for TD-004 slice 5 (#429).
export async function analyzeWithOllama(
  report: string,
  systemPrompt: string,
  model: string = "llama3.2",
  host: string = "http://localhost:11434"
): Promise<void> {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: report },
    ],
    stream: true,
  });

  const url = new URL("/api/chat", host);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port) || 11434,
      path: url.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed) as { message?: { content: string }; done: boolean };
            if (!json.done && json.message?.content) {
              process.stdout.write(json.message.content);
            }
            if (json.done) {
              process.stdout.write("\n");
              resolve();
            }
          } catch {
            // ignore malformed lines
          }
        }
      });

      res.on("end", () => {
        process.stdout.write("\n");
        resolve();
      });

      res.on("error", (err: Error) => reject(err));
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        console.error("\n⚠️  Ollama not running. Start it with: ollama serve");
      }
      reject(err);
    });

    req.write(body);
    req.end();
  });
}
