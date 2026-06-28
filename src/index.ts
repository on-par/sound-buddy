import { resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { analyzeAudio } from "./analyze/index.js";
import { extractChannels, loadChannelFiles } from "./analyze/channels.js";
import { compareChannels } from "./analyze/compare.js";
import { buildReport, buildSummaryTable, formatMultiChannelReport } from "./report.js";
import { getEngineerRead, analyzeMultiChannel } from "./engineer.js";
import type { ChannelFile, ChannelAnalysis, AudioAnalysis } from "./types.js";

function parseArgs(argv: string[]): {
  file: string | null;
  dir: string | null;
  names: string[];
  noSpectrum: boolean;
  help: boolean;
} {
  const args = argv.slice(2);
  let file: string | null = null;
  let dir: string | null = null;
  let names: string[] = [];
  let noSpectrum = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      help = true;
    } else if (args[i] === "--dir" && args[i + 1]) {
      dir = args[++i];
    } else if (args[i] === "--names" && args[i + 1]) {
      names = args[++i].split(",").map((n) => n.trim());
    } else if (args[i] === "--no-spectrum") {
      noSpectrum = true;
    } else if (!args[i].startsWith("--")) {
      file = args[i];
    }
  }

  return { file, dir, names, noSpectrum, help };
}

function printHelp(): void {
  console.log(`
sound-buddy — audio analysis tool

Usage:
  sound-buddy <file>              Analyze a single audio file (auto-detects multichannel WAV)
  sound-buddy --dir <directory>   Analyze all audio files in a directory as separate channels

Options:
  --names "CH1,CH2,..."           Custom channel names (comma-separated, mapped by index)
  --no-spectrum                   Skip librosa spectrum analysis (faster, use if Python/librosa not installed)
  --help                          Show this help message

Examples:
  sound-buddy mix.wav
  sound-buddy multitrack_32ch.wav --names "Kick,Snare,HH,OH L,OH R"
  sound-buddy --dir ./session/ --names "Kick,Snare,HH Open"
  sound-buddy --dir ./session/ --no-spectrum
`);
}

function cleanup(channels: ChannelFile[]): void {
  for (const ch of channels) {
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

async function runSingleFile(filePath: string, names: string[]): Promise<void> {
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
      await getEngineerRead(report);
    } catch (err) {
      console.error("\nLLM analysis failed:", err);
      process.exit(1);
    }
    console.log("");
    return;
  }

  // Multi-channel WAV
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
    await analyzeMultiChannel(analysis, channelAnalyses, comparison);
  } catch (err) {
    console.error("\nLLM analysis failed:", err);
  }

  console.log("");
  cleanup(channelFiles);
}

async function runDirectory(dir: string, names: string[]): Promise<void> {
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
    // No mix file available in directory mode — pass null
    await analyzeMultiChannel(null, channelAnalyses, comparison);
  } catch (err) {
    console.error("\nLLM analysis failed:", err);
  }

  console.log("");
}

async function main(): Promise<void> {
  const { file, dir, names, help } = parseArgs(process.argv);

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (!file && !dir) {
    console.error("Usage: sound-buddy <file>  OR  sound-buddy --dir <directory>");
    console.error("Run with --help for more options.");
    process.exit(1);
  }

  if (dir) {
    await runDirectory(dir, names);
    return;
  }

  if (file) {
    const resolved = resolve(file);
    if (!existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      process.exit(1);
    }
    await runSingleFile(resolved, names);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
