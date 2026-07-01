import type { ChannelAnalysis, ChannelComparison, MaskingPair } from "../types.js";

const BAND_KEYS = ["subBass", "bass", "lowMid", "mid", "highMid", "presence", "brilliance"] as const;
type BandKey = typeof BAND_KEYS[number];

const BAND_LABELS: Record<BandKey, string> = {
  subBass: "Sub-bass (20-60 Hz)",
  bass: "Bass (60-250 Hz)",
  lowMid: "Low-mid (250-500 Hz)",
  mid: "Mid (500-2000 Hz)",
  highMid: "High-mid (2000-4000 Hz)",
  presence: "Presence (4000-6000 Hz)",
  brilliance: "Brilliance (6000-20000 Hz)",
};

// dBFS to linear power conversion
function dbToLinear(db: number): number {
  if (!isFinite(db)) return 0;
  return Math.pow(10, db / 20);
}

function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

export function compareChannels(channels: ChannelAnalysis[]): ChannelComparison {
  const bandRankings: Record<string, string[]> = {};
  const maskingPairs: MaskingPair[] = [];
  const subBassOffenders: string[] = [];
  const mixBandEnergy: Record<string, number> = {};

  for (const band of BAND_KEYS) {
    const label = BAND_LABELS[band];

    // Sort channels by band energy descending
    const sorted = [...channels].sort(
      (a, b) => b.analysis.spectrum.bands[band] - a.analysis.spectrum.bands[band]
    );
    bandRankings[label] = sorted.map((c) => c.channel.name);

    // Masking: any pair within 3 dB of each other in this band
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const energyA = sorted[i].analysis.spectrum.bands[band];
        const energyB = sorted[j].analysis.spectrum.bands[band];
        const diff = Math.abs(energyA - energyB);
        if (diff <= 3 && isFinite(energyA) && isFinite(energyB)) {
          maskingPairs.push({
            bandName: label,
            channelA: sorted[i].channel.name,
            channelB: sorted[j].channel.name,
            energyDiff: diff,
          });
        }
      }
    }

    // Mix energy: sum linear values, convert back to dB
    const sumLinear = channels.reduce(
      (acc, c) => acc + dbToLinear(c.analysis.spectrum.bands[band]),
      0
    );
    mixBandEnergy[label] = linearToDb(sumLinear);
  }

  // Sub-bass offenders: >-20 dBFS in subBass band
  for (const ch of channels) {
    if (ch.analysis.spectrum.bands.subBass > -20) {
      subBassOffenders.push(ch.channel.name);
    }
  }

  return { bandRankings, maskingPairs, subBassOffenders, mixBandEnergy };
}
