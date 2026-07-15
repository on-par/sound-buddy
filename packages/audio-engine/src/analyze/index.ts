import { analyzeAudio as analyzeAudioCore, type AnalyzeAudioOptions } from "./orchestrate.js";
import { DEFAULT_SPECTRUM_SCRIPT } from "./spectrum-script.js";
import type { AudioAnalysis } from "../types.js";

export type { AnalyzeAudioOptions, AnalyzeStage } from "./orchestrate.js";

export async function analyzeAudio(
  filePath: string,
  opts: AnalyzeAudioOptions = {},
): Promise<AudioAnalysis> {
  return analyzeAudioCore(filePath, {
    ...opts,
    spectrum: { scriptPath: DEFAULT_SPECTRUM_SCRIPT, ...opts.spectrum },
  });
}
