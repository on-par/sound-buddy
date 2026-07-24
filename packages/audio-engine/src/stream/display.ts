import type { LiveState, ChannelWindowData } from "./types.js";

const BANDS_ORDER = [
  ["sub_bass", "Sub-bass", "20-60Hz"],
  ["bass", "Bass", "60-250Hz"],
  ["low_mid", "Low-mid", "250-500Hz"],
  ["mid", "Mid", "500-2kHz"],
  ["high_mid", "High-mid", "2-4kHz"],
  ["presence", "Presence", "4-6kHz"],
  ["brilliance", "Brilliance", "6-20kHz"],
] as const;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bgRed: "\x1b[41m",
  clearLine: "\x1b[2K",
  cursorUp: (n: number) => `\x1b[${n}A`,
  col1: "\x1b[G",
};

let lastLineCount = 0;

function dbToBar(db: number): string {
  // Scale: -60dBFS = 0 filled, -6dBFS = 16 filled
  const clampedDb = Math.max(-60, Math.min(-6, db));
  const filled = Math.round(((clampedDb + 60) / 54) * 16);
  const empty = 16 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function colorBar(db: number, bar: string): string {
  if (db > -24) return `${ANSI.green}${bar}${ANSI.reset}`;
  if (db > -36) return `${ANSI.yellow}${bar}${ANSI.reset}`;
  return `${ANSI.dim}${bar}${ANSI.reset}`;
}

function clipStr(clipping: boolean): string {
  if (clipping) return `${ANSI.bgRed}${ANSI.bold} CLIP: YES ${ANSI.reset}`;
  return "CLIP: NO";
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;
}

function formatDbfs(db: number): string {
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dBFS`;
}

function loudestBand(ch: ChannelWindowData): string {
  let maxBand = "sub_bass";
  let maxDb = -Infinity;
  for (const [key] of BANDS_ORDER) {
    const v = ch.bands[key] ?? -Infinity;
    if (v > maxDb) {
      maxDb = v;
      maxBand = key;
    }
  }
  const found = BANDS_ORDER.find(([k]) => k === maxBand);
  return found ? found[1] : maxBand;
}

function buildLines(
  state: LiveState,
  deviceName: string,
  windowNum: number,
  windowSecs: number
): string[] {
  const lines: string[] = [];
  const cur = state.currentWindow;

  const header = `${ANSI.bold}SOUND BUDDY — LIVE${ANSI.reset}  |  ${deviceName}  |  Window ${windowNum}  |  ${windowSecs.toFixed(1)}s/win`;
  lines.push(header);
  lines.push("─".repeat(76));

  if (!cur || cur.channels.length === 0) {
    lines.push("Waiting for audio...");
    return lines;
  }

  const isMulti = cur.channels.length > 1;

  if (!isMulti) {
    const ch = cur.channels[0];
    const dr = ch.peak - ch.rms;
    lines.push(
      `RMS: ${formatDbfs(ch.rms)}   Peak: ${formatDbfs(ch.peak)}   DR: ${dr.toFixed(1)} dB   ${clipStr(ch.clipping)}`
    );
    lines.push("");
    lines.push(`${ANSI.bold}Frequency Balance${ANSI.reset}`);

    let loudestDb = -Infinity;
    let loudestLabel = "";
    for (const [key, label] of BANDS_ORDER) {
      const db = ch.bands[key] ?? -60;
      if (db > loudestDb) {
        loudestDb = db;
        loudestLabel = label;
      }
    }

    for (const [key, label, range] of BANDS_ORDER) {
      const db = ch.bands[key] ?? -60;
      const bar = colorBar(db, dbToBar(db));
      const isLoudest = label === loudestLabel;
      const marker = isLoudest ? "  ◀ loudest" : "";
      const labelPad = label.padEnd(10);
      const rangePad = `[${range}]`.padEnd(12);
      lines.push(`${labelPad} ${rangePad} ${bar}  ${db.toFixed(1)} dB${marker}`);
    }

    lines.push("");
    lines.push(`Centroid: ${formatHz(ch.centroid)}   Rolloff: ${formatHz(ch.rolloff)}`);
  } else {
    lines.push(`${ANSI.bold}CHANNEL OVERVIEW${ANSI.reset}  (sorted by RMS)`);
    lines.push(
      `  ${"CH".padEnd(4)} ${"NAME".padEnd(10)} ${"RMS".padEnd(9)} ${"PEAK".padEnd(9)} ${"DOM BAND".padEnd(14)} CLIP`
    );

    const sorted = [...cur.channels].sort((a, b) => b.rms - a.rms);
    for (const ch of sorted) {
      const chNum = String(ch.index + 1).padStart(2, "0");
      const name = ch.name.padEnd(10);
      const rms = formatDbfs(ch.rms).padEnd(9);
      const peak = formatDbfs(ch.peak).padEnd(9);
      const dom = loudestBand(ch).padEnd(14);
      const clip = ch.clipping ? `${ANSI.bgRed}YES${ANSI.reset}` : "NO";
      lines.push(`  ${chNum}  ${name} ${rms} ${peak} ${dom} ${clip}`);
    }

    if (cur.masking.length > 0) {
      lines.push("");
      lines.push(`${ANSI.bold}MASKING ALERTS${ANSI.reset}`);
      for (const m of cur.masking) {
        lines.push(
          `  ${ANSI.yellow}⚠${ANSI.reset} ${m.band}: ${m.channelA} ↔ ${m.channelB} (${m.diffDb.toFixed(1)} dB diff)`
        );
      }
    } else {
      lines.push("");
      lines.push("No masking conflicts detected.");
    }
  }

  lines.push("");
  lines.push(`${ANSI.dim}Press Q = quit${ANSI.reset}`);

  return lines;
}

export function render(
  state: LiveState,
  deviceName: string,
  windowNum: number,
  windowSecs: number
): void {
  const lines = buildLines(state, deviceName, windowNum, windowSecs);

  // Erase exactly the number of lines drawn last time
  if (lastLineCount > 0) {
    process.stdout.write(ANSI.cursorUp(lastLineCount));
  }

  for (const line of lines) {
    process.stdout.write(`${ANSI.clearLine}${ANSI.col1}${line}\n`);
  }

  // If we drew fewer lines than before, erase leftover lines
  const extra = lastLineCount - lines.length;
  for (let i = 0; i < extra; i++) {
    process.stdout.write(`${ANSI.clearLine}${ANSI.col1}\n`);
  }
  if (extra > 0) {
    process.stdout.write(ANSI.cursorUp(extra));
  }

  lastLineCount = lines.length;
}
