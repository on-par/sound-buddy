import { resolve } from "node:path";
import { existsSync, rmSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { analyzeAudio } from "./analyze/index.js";
import { extractChannels, loadChannelFiles } from "./analyze/channels.js";
import { compareChannels } from "./analyze/compare.js";
import { buildReport, buildSummaryTable, formatMultiChannelReport } from "./report.js";
import { getEngineerRead, analyzeMultiChannel, analyzeWithOllama } from "./engineer.js";
import { startLive } from "./stream/index.js";
import type { ChannelFile, ChannelAnalysis, AudioAnalysis } from "./types.js";

// Public library API — consumed by other @sound-buddy packages.
export { analyzeAudio, extractChannels, loadChannelFiles, compareChannels, formatMultiChannelReport };
export { cleanup as cleanupChannelFiles };
export type { AudioAnalysis, ChannelFile, ChannelAnalysis } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STREAM_SCRIPT = resolve(__dirname, "../scripts/stream.py");

function parseArgs(argv: string[]): {
  file: string | null;
  dir: string | null;
  names: string[];
  noSpectrum: boolean;
  help: boolean;
  live: boolean;
  listDevices: boolean;
  device?: string;
  channels?: number[];
  windowSecs: number;
  llmIntervalSecs: number;
  ollama: boolean;
  ollamaModel: string;
  ollamaHost: string;
} {
  const args = argv.slice(2);
  let file: string | null = null;
  let dir: string | null = null;
  let names: string[] = [];
  let noSpectrum = false;
  let help = false;
  let live = false;
  let listDevices = false;
  let device: string | undefined;
  let channels: number[] | undefined;
  let windowSecs = 3;
  let llmIntervalSecs = 60;
  let ollama = false;
  let ollamaModel = "llama3.2";
  let ollamaHost = "http://localhost:11434";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--live") {
      live = true;
    } else if (a === "--list-devices") {
      listDevices = true;
    } else if (a === "--device") {
      device = args[++i];
    } else if (a === "--ch") {
      channels = args[++i].split(",").map((s) => parseInt(s.trim(), 10));
    } else if (a === "--window") {
      windowSecs = parseFloat(args[++i]);
    } else if (a === "--llm-interval") {
      llmIntervalSecs = parseInt(args[++i], 10);
    } else if (a === "--dir" && args[i + 1]) {
      dir = args[++i];
    } else if (a === "--names" && args[i + 1]) {
      names = args[++i].split(",").map((n) => n.trim());
    } else if (a === "--no-spectrum") {
      noSpectrum = true;
    } else if (a === "--ollama") {
      ollama = true;
    } else if (a === "--ollama-model" && args[i + 1]) {
      ollamaModel = args[++i];
    } else if (a === "--ollama-host" && args[i + 1]) {
      ollamaHost = args[++i];
    } else if (!a.startsWith("--")) {
      file = a;
    }
  }

  return { file, dir, names, noSpectrum, help, live, listDevices, device, channels, windowSecs, llmIntervalSecs, ollama, ollamaModel, ollamaHost };
}

function printHelp(): void {
  console.log(`
sound-buddy — audio analysis tool

Usage:
  sound-buddy <file>              Analyze a single audio file (auto-detects multichannel WAV)
  sound-buddy --dir <directory>   Analyze all audio files in a directory as separate channels
  sound-buddy --live              Real-time analysis from audio device
  sound-buddy --list-devices      List available audio input devices

Options:
  --names "CH1,CH2,..."           Custom channel names (comma-separated, mapped by index)
  --no-spectrum                   Skip librosa spectrum analysis (faster, use if Python/librosa not installed)
  --device "NAME"                 Audio device name or index (for --live)
  --ch 0,1,2                      Channel indices to capture (for --live, default: 0,1)
  --window <secs>                 Analysis window in seconds (for --live, default: 3)
  --llm-interval <secs>           Seconds between LLM deep-dives (for --live, default: 60, 0=disable)
  --ollama                        Use Ollama for LLM analysis instead of Pi SDK
  --ollama-model <name>           Ollama model to use (default: llama3.2)
  --ollama-host <url>             Ollama host URL (default: http://localhost:11434)
  --help                          Show this help message

Examples:
  sound-buddy mix.wav
  sound-buddy multitrack_32ch.wav --names "Kick,Snare,HH,OH L,OH R"
  sound-buddy --dir ./session/ --names "Kick,Snare,HH Open"
  sound-buddy --dir ./session/ --no-spectrum
  sound-buddy --live
  sound-buddy --live --device "DANTE Virtual Soundcard" --ch 1,3,5,7 --window 3 --llm-interval 60
  sound-buddy --list-devices
`);
}

function cleanup(chFiles: ChannelFile[]): void {
  for (const ch of chFiles) {
    if (ch.needsCleanup) {
      try {
        rmSync(ch.tmpPath);
      } catch {
        // non-fatal
      }
    }
  }
}

async function analyzeChannelSafe(
  ch: ChannelFile
): Promise<ChannelAnalysis | null> {
  try {
    const analysis = await analyzeAudio(ch.tmpPath);
    return { channel: ch, analysis };
  } catch (err) {
    console.warn(`\nWarning: failed to analyze channel "${ch.name}" (${ch.tmpPath}): ${String(err)}`);
    return null;
  }
}

function printChannelTable(channelAnalyses: ChannelAnalysis[]): void {
  const cols = {
    name: Math.max(10, ...channelAnalyses.map((c) => c.channel.name.length)),
    rms: 10,
    peak: 11,
    dyn: 13,
    dominant: 14,
  };

  const header = [
    "Channel".padEnd(cols.name),
    "RMS dBFS".padEnd(cols.rms),
    "Peak dBFS".padEnd(cols.peak),
    "Dyn Range".padEnd(cols.dyn),
    "Dominant Band",
  ].join("  ");

  const sep = "-".repeat(header.length);

  const domLabels: Record<string, string> = {
    subBass: "Sub-bass",
    bass: "Bass",
    lowMid: "Low-mid",
    mid: "Mid",
    highMid: "High-mid",
    presence: "Presence",
    brilliance: "Brilliance",
  };

  console.log(header);
  console.log(sep);

  for (const { channel, analysis } of channelAnalyses) {
    const { sox, spectrum } = analysis;
    const bandEntries = Object.entries(spectrum.bands) as [string, number][];
    const dominant = bandEntries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const rmsStr = isFinite(sox.rmsDbfs) ? sox.rmsDbfs.toFixed(2) + " dBFS" : "-inf dBFS";
    const peakStr = isFinite(sox.peakDbfs) ? sox.peakDbfs.toFixed(2) + " dBFS" : "-inf dBFS";
    const dynStr = sox.dynamicRangeDb.toFixed(2) + " dB";

    console.log([
      channel.name.padEnd(cols.name),
      rmsStr.padEnd(cols.rms),
      peakStr.padEnd(cols.peak),
      dynStr.padEnd(cols.dyn),
      domLabels[dominant] ?? dominant,
    ].join("  "));
  }
}

async function runListDevices(): Promise<void> {
  return new Promise((res, rej) => {
    const py = spawn("python3", [STREAM_SCRIPT, "--list-devices"], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    let output = "";
    py.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    py.on("close", (code) => {
      if (code !== 0) {
        rej(new Error(`stream.py exited with code ${code}`));
        return;
      }

      let parsed: { devices?: { index: number; name: string; channels: number; default_sr: number }[] };
      try {
        parsed = JSON.parse(output.trim());
      } catch {
        rej(new Error("Failed to parse device list"));
        return;
      }

      const devs = parsed.devices ?? [];
      if (devs.length === 0) {
        console.log("No input devices found.");
        res();
        return;
      }

      const idxW = 5;
      const nameW = Math.max(4, ...devs.map((d) => d.name.length));
      const chW = 8;

      const header =
        "IDX".padEnd(idxW) + "  " + "NAME".padEnd(nameW) + "  " + "CHANNELS".padEnd(chW) + "  " + "SAMPLE RATE";
      console.log(header);
      console.log("─".repeat(header.length));
      for (const d of devs) {
        console.log(
          String(d.index).padEnd(idxW) + "  " + d.name.padEnd(nameW) + "  " + String(d.channels).padEnd(chW) + "  " + `${d.default_sr} Hz`
        );
      }
      res();
    });
  });
}

async function runSingleFile(filePath: string, names: string[], ollama: boolean, ollamaModel: string, ollamaHost: string): Promise<void> {
  console.log(`\nAnalyzing ${filePath}...`);
  console.log("");

  let analysis: AudioAnalysis;
  try {
    analysis = await analyzeAudio(filePath);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("sox") && msg.includes("ENOENT")) {
      console.error("Error: sox not found. Install with: brew install sox");
    } else if (msg.includes("ffprobe") && msg.includes("ENOENT")) {
      console.error("Error: ffprobe not found. Install with: brew install ffmpeg");
    } else if (msg.includes("python3") && msg.includes("ENOENT")) {
      console.error("Error: python3 not found. Install Python 3 and run: pip install librosa numpy");
    } else {
      console.error("Analysis failed:", err);
    }
    process.exit(1);
  }

  const channelCount = analysis.ffprobe.stream.channels;

  if (channelCount <= 2) {
    console.log("=== Raw Measurements ===");
    console.log(buildSummaryTable(analysis));
    console.log("");
    const report = buildReport(analysis);
    console.log("--- Audio Engineer's Read ---");
    console.log("");
    try {
      if (ollama) {
        const SYSTEM_PROMPT = `You are a professional audio engineer with 20+ years of experience. You are given acoustic measurement data for an audio file. Analyze it deeply: identify EQ imbalances, dynamic range issues, potential mastering problems, stereo image concerns, and anything else a trained ear would flag. Be specific, reference the actual numbers, and give actionable recommendations.`;
        await analyzeWithOllama(report, SYSTEM_PROMPT, ollamaModel, ollamaHost);
      } else {
        await getEngineerRead(report);
      }
    } catch (err) {
      console.error("\nLLM analysis failed:", err);
      process.exit(1);
    }
    console.log("");
    return;
  }

  console.log(`Detected ${channelCount} channels — entering multi-channel mode`);
  console.log("");

  let channelFiles: ChannelFile[] = [];
  try {
    channelFiles = await extractChannels(filePath, names);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("ffmpeg") && msg.includes("ENOENT")) {
      console.error("Error: ffmpeg not found. Install with: brew install ffmpeg");
      process.exit(1);
    }
    console.error("Failed to extract channels:", err);
    process.exit(1);
  }

  console.log(`Analyzing ${channelFiles.length} channels in parallel...`);
  const results = await Promise.all(channelFiles.map(analyzeChannelSafe));
  const channelAnalyses = results.filter((r): r is ChannelAnalysis => r !== null);

  if (channelAnalyses.length === 0) {
    console.error("All channel analyses failed.");
    cleanup(channelFiles);
    process.exit(1);
  }

  const comparison = compareChannels(channelAnalyses);

  console.log("\n=== Per-Channel Summary ===");
  printChannelTable(channelAnalyses);
  console.log("");

  console.log(formatMultiChannelReport(channelAnalyses, comparison));

  console.log("--- Multi-Channel Engineer's Read ---");
  console.log("");

  try {
    if (ollama) {
      const MULTI_CHANNEL_SYSTEM_PROMPT = `You are a professional mixing engineer analyzing a multi-track recording from a Midas M32R console. Given the acoustic measurements of each channel and the full mix, identify: frequency masking between channels, problematic EQ buildups, channels that need low-cut or high-cut filters, channels competing in the same frequency range, and give specific actionable EQ/dynamics recommendations per channel. Reference actual dB values.`;
      await analyzeWithOllama(formatMultiChannelReport(channelAnalyses, comparison), MULTI_CHANNEL_SYSTEM_PROMPT, ollamaModel, ollamaHost);
    } else {
      await analyzeMultiChannel(analysis, channelAnalyses, comparison);
    }
  } catch (err) {
    console.error("\nLLM analysis failed:", err);
  }

  console.log("");
  cleanup(channelFiles);
}

async function runDirectory(dir: string, names: string[], ollama: boolean, ollamaModel: string, ollamaHost: string): Promise<void> {
  const resolvedDir = resolve(dir);

  if (!existsSync(resolvedDir)) {
    console.error(`Error: Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  let channelFiles: ChannelFile[];
  try {
    channelFiles = await loadChannelFiles(resolvedDir, names);
  } catch (err) {
    console.error("Failed to read directory:", err);
    process.exit(1);
  }

  if (channelFiles.length === 0) {
    console.error(`No audio files found in: ${resolvedDir}`);
    console.error("Supported formats: .wav, .aif, .aiff, .flac, .mp3");
    process.exit(1);
  }

  console.log(`\nFound ${channelFiles.length} audio files in ${resolvedDir}`);
  console.log("Analyzing channels in parallel...");

  const results = await Promise.all(channelFiles.map(analyzeChannelSafe));
  const channelAnalyses = results.filter((r): r is ChannelAnalysis => r !== null);

  if (channelAnalyses.length === 0) {
    console.error("All channel analyses failed.");
    process.exit(1);
  }

  const comparison = compareChannels(channelAnalyses);

  console.log("\n=== Per-Channel Summary ===");
  printChannelTable(channelAnalyses);
  console.log("");

  console.log(formatMultiChannelReport(channelAnalyses, comparison));

  console.log("--- Multi-Channel Engineer's Read ---");
  console.log("");

  try {
    if (ollama) {
      const MULTI_CHANNEL_SYSTEM_PROMPT = `You are a professional mixing engineer analyzing a multi-track recording from a Midas M32R console. Given the acoustic measurements of each channel and the full mix, identify: frequency masking between channels, problematic EQ buildups, channels that need low-cut or high-cut filters, channels competing in the same frequency range, and give specific actionable EQ/dynamics recommendations per channel. Reference actual dB values.`;
      await analyzeWithOllama(formatMultiChannelReport(channelAnalyses, comparison), MULTI_CHANNEL_SYSTEM_PROMPT, ollamaModel, ollamaHost);
    } else {
      await analyzeMultiChannel(null, channelAnalyses, comparison);
    }
  } catch (err) {
    console.error("\nLLM analysis failed:", err);
  }

  console.log("");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.listDevices) {
    await runListDevices();
    return;
  }

  if (opts.live) {
    await startLive({
      device: opts.device,
      channels: opts.channels,
      windowSecs: opts.windowSecs,
      llmIntervalSecs: opts.llmIntervalSecs,
    });
    return;
  }

  if (!opts.file && !opts.dir) {
    console.error("Usage: sound-buddy <file>  OR  sound-buddy --dir <directory>  OR  sound-buddy --live");
    console.error("Run with --help for more options.");
    process.exit(1);
  }

  if (opts.dir) {
    await runDirectory(opts.dir, opts.names, opts.ollama, opts.ollamaModel, opts.ollamaHost);
    return;
  }

  if (opts.file) {
    const resolved = resolve(opts.file);
    if (!existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      process.exit(1);
    }
    await runSingleFile(resolved, opts.names, opts.ollama, opts.ollamaModel, opts.ollamaHost);
  }
}

// Only run the CLI when this module is executed directly, not when imported
// as a library (e.g. by @sound-buddy/cli). realpathSync resolves symlinks
// (e.g. node_modules/.bin) so the comparison matches the module's real path.
// It runs at import time, so any failure (e.g. a non-resolvable argv[1]) must
// not crash the importing process — fall back to "not the main module".
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
