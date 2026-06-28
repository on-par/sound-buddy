import { runSox } from "./sox.js";
import { runFfprobe } from "./ffprobe.js";
import { runSpectrum } from "./spectrum.js";
import type { AudioAnalysis } from "../types.js";

export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  const [sox, ffprobe, spectrum] = await Promise.all([
    runSox(filePath),
    runFfprobe(filePath),
    runSpectrum(filePath),
  ]);

  return {
    filePath,
    sox,
    ffprobe,
    spectrum,
  };
}
