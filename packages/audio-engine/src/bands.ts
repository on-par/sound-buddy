import type { ChannelAnalysis } from "./types.js";

export type BandKey =
  | "subBass" | "bass" | "lowMid" | "mid" | "highMid" | "presence" | "brilliance";

export interface BandMeta {
  key: BandKey;
  label: string;     // human label used in tables/dominant-band output
  freqLabel: string; // compact frequency range, e.g. "20-60 Hz"
  lo: number;        // low bound Hz
  hi: number;        // high bound Hz
}

/**
 * Canonical 7-band spectrum metadata for Node-side consumers (audio-engine,
 * cli). Add a band here and nowhere else *on the Node side* — app/renderer's
 * grading.js and spectrum-display.ts keep their own copies deliberately (see
 * TD-005 spec Non-goals: one can't import an MIT package across the
 * proprietary boundary, the other uses different presentation strings for a
 * future mobile port), so a new band still needs manual updates there too.
 */
export const BAND_METADATA: BandMeta[] = [
  { key: "subBass",    label: "Sub-bass",   freqLabel: "20-60 Hz",      lo: 20,   hi: 60    },
  { key: "bass",       label: "Bass",       freqLabel: "60-250 Hz",     lo: 60,   hi: 250   },
  { key: "lowMid",     label: "Low-mid",    freqLabel: "250-500 Hz",    lo: 250,  hi: 500   },
  { key: "mid",        label: "Mid",        freqLabel: "500-2000 Hz",   lo: 500,  hi: 2000  },
  { key: "highMid",    label: "High-mid",   freqLabel: "2000-4000 Hz",  lo: 2000, hi: 4000  },
  { key: "presence",   label: "Presence",   freqLabel: "4000-6000 Hz",  lo: 4000, hi: 6000  },
  { key: "brilliance", label: "Brilliance", freqLabel: "6000-20000 Hz", lo: 6000, hi: 20000 },
];

/** key -> human label, derived from BAND_METADATA. */
export const BAND_LABELS: Record<string, string> = Object.fromEntries(
  BAND_METADATA.map((b) => [b.key, b.label])
);

/** Pick the loudest band and return its human label. Empty input -> "Mid". */
export function dominantBandLabel(bands: Partial<Record<BandKey, number>>): string {
  const entries = Object.entries(bands) as [string, number][];
  if (entries.length === 0) return BAND_LABELS.mid;
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  return BAND_LABELS[top] ?? top;
}

/**
 * Build the per-channel summary table as an array of lines (header, separator,
 * one row per channel). Callers print each line or splice the array into a
 * larger report. Columns: Channel | RMS dBFS | Peak dBFS | Dyn Range | Dominant Band.
 */
export function formatChannelTable(channels: ChannelAnalysis[]): string[] {
  const cols = {
    name: Math.max(12, ...channels.map((c) => c.channel.name.length)),
    rms: 12,
    peak: 13,
    dyn: 13,
  };
  const header = [
    "Channel".padEnd(cols.name),
    "RMS dBFS".padEnd(cols.rms),
    "Peak dBFS".padEnd(cols.peak),
    "Dyn Range".padEnd(cols.dyn),
    "Dominant Band",
  ].join("  ");
  const lines = [header, "-".repeat(header.length)];
  for (const { channel, analysis } of channels) {
    const { sox, spectrum } = analysis;
    const rmsStr = isFinite(sox.rmsDbfs) ? sox.rmsDbfs.toFixed(2) + " dBFS" : "-inf dBFS";
    const peakStr = isFinite(sox.peakDbfs) ? sox.peakDbfs.toFixed(2) + " dBFS" : "-inf dBFS";
    const dynStr = sox.dynamicRangeDb.toFixed(2) + " dB";
    lines.push([
      channel.name.padEnd(cols.name),
      rmsStr.padEnd(cols.rms),
      peakStr.padEnd(cols.peak),
      dynStr.padEnd(cols.dyn),
      dominantBandLabel(spectrum.bands),
    ].join("  "));
  }
  return lines;
}
