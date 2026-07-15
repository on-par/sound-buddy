import type { AudioAnalysis, ChannelAnalysis, ChannelComparison, ContentType } from "./types.js";
import { assessChannelGain, assessGainStructure, gainHealthLabel, GAIN_TARGET_DBFS, GAIN_TOLERANCE_DB } from "./analyze/gain-structure.js";
import { formatChannelTable } from "./bands.js";

/** Human label for a detected content type (PRD 04). */
function contentTypeLabel(ct: ContentType): string {
  switch (ct) {
    case "speech": return "Speech";
    case "music": return "Music";
    case "mixed": return "Mixed (speech + music)";
    case "silence": return "Silence";
  }
}

/** What the content-aware thresholds optimize for a given content type (PRD 04). */
function contentTypeTarget(ct: ContentType): string {
  switch (ct) {
    case "speech": return "intelligibility / presence";
    case "music": return "worship service reference";
    case "mixed": return "worship service reference";
    case "silence": return "n/a";
  }
}

function isDynamicServiceRecording(sox: AudioAnalysis["sox"], contentType: ContentType | undefined): boolean {
  return (
    (contentType === "music" || contentType === "mixed") &&
    sox.peakDbfs > -12 &&
    sox.dynamicRangeDb > 15 &&
    sox.rmsDbfs < -25
  );
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtDb(n: number): string {
  if (!isFinite(n)) return "-inf dBFS";
  return `${fmt(n)} dBFS`;
}

function fmtHz(n: number): string {
  if (n >= 1000) return `${fmt(n / 1000, 1)} kHz`;
  return `${Math.round(n)} Hz`;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtBitrate(bps: number): string {
  return `${Math.round(bps / 1000)} kbps`;
}

export function buildReport(analysis: AudioAnalysis): string {
  const { sox, ffprobe, spectrum } = analysis;
  const { format, stream } = ffprobe;
  const { bands } = spectrum;

  const lines: string[] = [];

  lines.push("=== AUDIO FILE ANALYSIS REPORT ===");
  lines.push("");

  // --- File Info ---
  lines.push("[ FILE INFO ]");
  lines.push(`  File:            ${analysis.filePath}`);
  lines.push(`  Format:          ${format.formatLongName} (${format.formatName})`);
  lines.push(`  Duration:        ${fmtDuration(format.durationSeconds)} (${fmt(format.durationSeconds, 3)} s)`);
  lines.push(`  File size:       ${fmtBytes(format.sizeBytes)}`);
  lines.push(`  Overall bitrate: ${fmtBitrate(format.bitRate)}`);
  if (Object.keys(format.tags).length > 0) {
    lines.push(`  Tags:`);
    for (const [k, v] of Object.entries(format.tags)) {
      lines.push(`    ${k}: ${v}`);
    }
  }
  lines.push("");

  // --- Audio Stream ---
  lines.push("[ AUDIO STREAM ]");
  lines.push(`  Codec:          ${stream.codecLongName} (${stream.codecName})`);
  lines.push(`  Channels:       ${stream.channels} (${stream.channelLayout})`);
  lines.push(`  Sample rate:    ${fmtHz(stream.sampleRate)}`);
  lines.push(`  Bit depth:      ${stream.bitDepth !== null ? `${stream.bitDepth}-bit` : "N/A (lossy)"}`);
  if (stream.bitRate !== null) {
    lines.push(`  Stream bitrate: ${fmtBitrate(stream.bitRate)}`);
  }
  lines.push("");

  // --- Amplitude & Dynamics (sox) ---
  lines.push("[ AMPLITUDE & DYNAMICS (sox stat) ]");
  lines.push(`  Peak amplitude:      ${fmt(Math.max(Math.abs(sox.maximumAmplitude), Math.abs(sox.minimumAmplitude)), 6)}`);
  lines.push(`  Peak level:          ${fmtDb(sox.peakDbfs)}`);
  lines.push(`  RMS amplitude:       ${fmt(sox.rmsAmplitude, 6)}`);
  lines.push(`  RMS level:           ${fmtDb(sox.rmsDbfs)}`);
  lines.push(`  Dynamic range:       ${fmt(sox.dynamicRangeDb)} dB  (peak - RMS)`);
  lines.push(`  Maximum amplitude:   ${fmt(sox.maximumAmplitude, 6)}`);
  lines.push(`  Minimum amplitude:   ${fmt(sox.minimumAmplitude, 6)}`);
  lines.push(`  Midline amplitude:   ${fmt(sox.midlineAmplitude, 6)}`);
  lines.push(`  Mean norm:           ${fmt(sox.meanNorm, 6)}`);
  lines.push(`  Mean amplitude:      ${fmt(sox.meanAmplitude, 6)}`);
  lines.push(`  Maximum delta:       ${fmt(sox.maximumDelta, 6)}`);
  lines.push(`  RMS delta:           ${fmt(sox.rmsDelta, 6)}`);
  lines.push(`  Rough frequency:     ${sox.roughFrequency} Hz`);
  lines.push(`  Volume adjustment:   ${fmt(sox.volumeAdjustment)} dB`);
  lines.push(`  Clipping detected:   ${sox.clipping ? "YES *** WARNING ***" : "No"}`);
  lines.push(`  Samples read:        ${sox.samplesRead.toLocaleString()}`);
  lines.push("");

  // --- Frequency Band Analysis ---
  lines.push("[ FREQUENCY BAND ENERGY (librosa, dB RMS) ]");
  lines.push(`  Sub-bass   (20-60 Hz):      ${fmt(bands.subBass)} dB`);
  lines.push(`  Bass       (60-250 Hz):     ${fmt(bands.bass)} dB`);
  lines.push(`  Low-mid    (250-500 Hz):    ${fmt(bands.lowMid)} dB`);
  lines.push(`  Mid        (500-2000 Hz):   ${fmt(bands.mid)} dB`);
  lines.push(`  High-mid   (2000-4000 Hz):  ${fmt(bands.highMid)} dB`);
  lines.push(`  Presence   (4000-6000 Hz):  ${fmt(bands.presence)} dB`);
  lines.push(`  Brilliance (6000-20000 Hz): ${fmt(bands.brilliance)} dB`);
  lines.push("");

  // --- Spectral Characteristics ---
  lines.push("[ SPECTRAL CHARACTERISTICS ]");
  lines.push(`  Spectral centroid:      ${fmtHz(spectrum.spectralCentroid)} (perceptual brightness center)`);
  lines.push(`  Spectral rolloff (85%): ${fmtHz(spectrum.spectralRolloff85)} (85% of energy below this)`);
  lines.push(`  Spectral dynamic range: ${fmt(spectrum.dynamicRange)} dB`);
  lines.push("");

  // --- Computed Observations ---
  lines.push("[ COMPUTED OBSERVATIONS ]");

  // Content type (PRD 04) — drives the content-aware thresholds below.
  const contentType = spectrum.contentType;
  if (contentType) {
    lines.push(`  . Content type: ${contentTypeLabel(contentType)} -- thresholds tuned for ${contentTypeTarget(contentType)}`);
  }

  // Loudness
  if (sox.rmsDbfs > -6) {
    lines.push(`  ! Loudness: Very hot -- RMS at ${fmtDb(sox.rmsDbfs)}, potential over-compression`);
  } else if (sox.rmsDbfs > -12) {
    lines.push(`  . Loudness: Moderately loud -- RMS at ${fmtDb(sox.rmsDbfs)}`);
  } else if (isDynamicServiceRecording(sox, contentType)) {
    lines.push(`  . Loudness: Dynamic service -- peaks are healthy; quiet sections are lowering whole-file RMS (${fmtDb(sox.rmsDbfs)})`);
  } else if (sox.rmsDbfs < -20) {
    lines.push(`  . Loudness: Quiet mix -- RMS at ${fmtDb(sox.rmsDbfs)}, may need level boost`);
  } else {
    lines.push(`  . Loudness: Normal range -- RMS at ${fmtDb(sox.rmsDbfs)}`);
  }

  // Clipping
  if (sox.clipping) {
    lines.push(`  ! Clipping: Signal hits or exceeds 0 dBFS -- distortion likely present`);
  }

  // Headroom
  const headroom = 0 - sox.peakDbfs;
  lines.push(`  . Headroom: ${fmt(headroom)} dB below 0 dBFS`);

  // Dynamic range interpretation
  if (sox.dynamicRangeDb < 6) {
    lines.push(`  ! Dynamics: Very compressed -- ${fmt(sox.dynamicRangeDb)} dB peak-to-RMS ratio`);
  } else if (sox.dynamicRangeDb < 10) {
    lines.push(`  . Dynamics: Moderately compressed -- ${fmt(sox.dynamicRangeDb)} dB peak-to-RMS ratio`);
  } else {
    lines.push(`  . Dynamics: Good dynamic range -- ${fmt(sox.dynamicRangeDb)} dB peak-to-RMS ratio`);
  }

  // Spectral balance
  const brightnessRatio = bands.brilliance / bands.bass;
  if (brightnessRatio > 0.8) {
    lines.push(`  . Spectral balance: Bright/airy character (brilliance/bass ratio: ${fmt(brightnessRatio)})`);
  } else if (brightnessRatio < 0.4) {
    lines.push(`  ! Spectral balance: Heavy low-end bias (brilliance/bass ratio: ${fmt(brightnessRatio)})`);
  } else {
    lines.push(`  . Spectral balance: Reasonably balanced (brilliance/bass ratio: ${fmt(brightnessRatio)})`);
  }

  // Sub-bass mud check
  if (bands.subBass > bands.bass - 3) {
    lines.push(`  ! Sub-bass: Sub (${fmt(bands.subBass)} dB) nearly equals or exceeds bass (${fmt(bands.bass)} dB) -- possible mud/rumble`);
  } else if (contentType === "speech" && bands.subBass > bands.mid - 12) {
    // Speech carries little useful sub-bass energy — significant sub relative to
    // the voice band usually means rumble / handling / plosive noise.
    lines.push(`  ! Sub-bass (speech): ${fmt(bands.subBass)} dB is high for voice -- consider a high-pass below 80 Hz to clean up rumble`);
  }

  // Presence/air. Speech leans on the presence band for intelligibility, so a
  // dip is flagged sooner (8 dB). Every other content type keeps the original
  // 12 dB threshold — content-awareness only *adds* sensitivity for speech, it
  // never suppresses a dip warning that the content-agnostic report would show.
  const presenceDipThreshold = contentType === "speech" ? 8 : 12;
  if (bands.presence < bands.mid - presenceDipThreshold) {
    const symptom = contentType === "speech" ? "unintelligible/dull" : "recessed/dull";
    lines.push(`  ! Presence dip: ${fmt(bands.presence)} dB vs mid ${fmt(bands.mid)} dB -- may sound ${symptom}`);
  }

  lines.push("");
  lines.push("[ GAIN STRUCTURE ]");
  const gain = assessChannelGain("This file", sox);
  lines.push(`  Target level:   ${GAIN_TARGET_DBFS} dBFS RMS`);
  lines.push(`  Measured RMS:   ${fmtDb(sox.rmsDbfs)} (${gain.status})`);
  if (gain.score !== undefined) {
    lines.push(`  Health score:   ${gain.score} / 100 (${gainHealthLabel(gain.score)})`);
  }
  if (gain.warnings.length === 0 && gain.status === "healthy") {
    lines.push(`  . Gain structure healthy — RMS is within ${GAIN_TOLERANCE_DB} dB of target`);
  }
  for (const w of gain.warnings) lines.push(`  ! ${w}`);

  lines.push("");
  lines.push("=== END OF REPORT ===");

  return lines.join("\n");
}

export function formatMultiChannelReport(channels: ChannelAnalysis[], comparison: ChannelComparison): string {
  const lines: string[] = [];

  lines.push("=== MULTI-CHANNEL SUMMARY ===");
  lines.push("");

  // Per-channel summary table
  for (const line of formatChannelTable(channels)) lines.push(line);

  lines.push("");

  if (comparison.subBassOffenders.length > 0) {
    lines.push(`Sub-bass offenders (>-20 dBFS): ${comparison.subBassOffenders.join(", ")}`);
    lines.push("");
  }

  if (comparison.maskingPairs.length > 0) {
    lines.push("Frequency masking detected:");
    for (const pair of comparison.maskingPairs) {
      lines.push(`  ${pair.bandName}: ${pair.channelA} ↔ ${pair.channelB} (${fmt(pair.energyDiff)} dB apart)`);
    }
    lines.push("");
  }

  lines.push("Mix band energy:");
  for (const [band, energy] of Object.entries(comparison.mixBandEnergy)) {
    const isFiniteEnergy = isFinite(energy);
    lines.push(`  ${band.padEnd(35)} ${isFiniteEnergy ? fmt(energy) : "-inf"} dBFS`);
  }

  lines.push("");
  const gain = assessGainStructure(channels.map((c) => ({ name: c.channel.name, sox: c.analysis.sox })));
  lines.push("Gain structure health:");
  lines.push(`  Overall score: ${gain.overallScore} / 100 (${gainHealthLabel(gain.overallScore)})`);
  const silent = gain.channels.filter((c) => c.status === "silent").map((c) => c.name);
  for (const ch of gain.channels) {
    if (ch.status === "healthy" || ch.status === "silent") continue;
    lines.push(`  ! ${ch.name} (${ch.status}, RMS ${fmtDb(ch.rmsDbfs)}): ${ch.warnings[0]}`);
  }
  if (silent.length > 0) lines.push(`  . Silent channels (no gain read): ${silent.join(", ")}`);

  lines.push("");
  lines.push("=== END MULTI-CHANNEL SUMMARY ===");

  return lines.join("\n");
}

export function buildSummaryTable(analysis: AudioAnalysis): string {
  const { sox, ffprobe, spectrum } = analysis;
  const { stream } = ffprobe;
  const { bands } = spectrum;

  const rows: [string, string][] = [
    ["Format", `${ffprobe.format.formatName} / ${stream.codecName}`],
    ["Duration", `${fmt(ffprobe.format.durationSeconds, 1)} s`],
    ["Sample Rate", fmtHz(stream.sampleRate)],
    ["Channels", `${stream.channels} (${stream.channelLayout})`],
    ["Bit Depth", stream.bitDepth !== null ? `${stream.bitDepth}-bit` : "lossy"],
    ["Bitrate", fmtBitrate(ffprobe.format.bitRate)],
    ["Peak", fmtDb(sox.peakDbfs)],
    ["RMS", fmtDb(sox.rmsDbfs)],
    ["Dyn Range", `${fmt(sox.dynamicRangeDb)} dB`],
    ["Clipping", sox.clipping ? "YES *** WARNING ***" : "No"],
    ["Headroom", `${fmt(0 - sox.peakDbfs)} dB`],
  ];

  const gh = assessChannelGain("This file", sox);
  if (gh.score !== undefined) rows.push(["Gain Health", `${gh.score} / 100`]);

  rows.push(
    ["Sub-bass", `${fmt(bands.subBass)} dB`],
    ["Bass", `${fmt(bands.bass)} dB`],
    ["Low-mid", `${fmt(bands.lowMid)} dB`],
    ["Mid", `${fmt(bands.mid)} dB`],
    ["High-mid", `${fmt(bands.highMid)} dB`],
    ["Presence", `${fmt(bands.presence)} dB`],
    ["Brilliance", `${fmt(bands.brilliance)} dB`],
    ["Spectral Centroid", fmtHz(spectrum.spectralCentroid)],
    ["Rolloff 85%", fmtHz(spectrum.spectralRolloff85)]
  );

  if (spectrum.contentType) {
    rows.push(["Content Type", contentTypeLabel(spectrum.contentType)]);
  }

  const labelWidth = Math.max(...rows.map(([l]) => l.length)) + 2;
  const lines = rows.map(([label, value]) => {
    return `  ${label.padEnd(labelWidth)} ${value}`;
  });

  return lines.join("\n");
}
