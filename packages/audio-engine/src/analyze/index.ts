import { runSox } from "./sox.js";
import { runFfprobe } from "./ffprobe.js";
import { runSpectrum } from "./spectrum.js";
import { runEbur128 } from "./ebur128.js";
import type { AudioAnalysis } from "../types.js";

export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  const [sox, ffprobe, spectrum, loudness] = await Promise.all([
    runSox(filePath),
    runFfprobe(filePath),
    runSpectrum(filePath),
    runEbur128(filePath).catch(() => null),
  ]);

  return {
    filePath,
    sox,
    ffprobe,
    spectrum,
    loudness,
  };
}
