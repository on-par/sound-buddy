import { runSox, type RunSoxOptions } from "./sox.js";
import { runFfprobe, type RunFfprobeOptions } from "./ffprobe.js";
import { runSpectrum, type RunSpectrumOptions } from "./spectrum.js";
import { runEbur128, type RunEbur128Options } from "./ebur128.js";
import { isAbortError } from "./timeout.js";
import type { AudioAnalysis, SpectrumResult } from "../types.js";

export type AnalyzeStage = "sox" | "ffprobe" | "spectrum" | "ebur128";

export interface AnalyzeAudioOptions {
  sox?: RunSoxOptions;
  ffprobe?: RunFfprobeOptions;
  spectrum?: RunSpectrumOptions;
  ebur128?: RunEbur128Options;
  signal?: AbortSignal;
  noSpectrum?: boolean;
  onProgress?: (stage: AnalyzeStage) => void;
  onEbur128Error?: (err: unknown) => void;
}

/** dBFS floor used for every band when spectral analysis is skipped (noSpectrum). */
const SILENT_BAND_DBFS = -120;

const SILENT_SPECTRUM: SpectrumResult = {
  bands: {
    subBass: SILENT_BAND_DBFS,
    bass: SILENT_BAND_DBFS,
    lowMid: SILENT_BAND_DBFS,
    mid: SILENT_BAND_DBFS,
    highMid: SILENT_BAND_DBFS,
    presence: SILENT_BAND_DBFS,
    brilliance: SILENT_BAND_DBFS,
  },
  spectralCentroid: 0,
  spectralRolloff85: 0,
  dynamicRange: 0,
};

export async function analyzeAudio(
  filePath: string,
  opts: AnalyzeAudioOptions = {},
): Promise<AudioAnalysis> {
  const track = async <T>(stage: AnalyzeStage, p: Promise<T>): Promise<T> => {
    const r = await p;
    opts.onProgress?.(stage);
    return r;
  };

  const soxOpts: RunSoxOptions = { ...opts.sox, signal: opts.signal ?? opts.sox?.signal };
  const ffprobeOpts: RunFfprobeOptions = { ...opts.ffprobe, signal: opts.signal ?? opts.ffprobe?.signal };
  const spectrumOpts: RunSpectrumOptions = {
    ...(opts.spectrum as RunSpectrumOptions),
    signal: opts.signal ?? opts.spectrum?.signal,
  };
  const ebur128Opts: RunEbur128Options = { ...opts.ebur128, signal: opts.signal ?? opts.ebur128?.signal };

  const [sox, ffprobe, spectrum, loudness] = await Promise.all([
    track("sox", runSox(filePath, soxOpts)),
    track("ffprobe", runFfprobe(filePath, ffprobeOpts)),
    opts.noSpectrum
      ? track("spectrum", Promise.resolve(SILENT_SPECTRUM))
      : track("spectrum", runSpectrum(filePath, spectrumOpts)),
    track("ebur128", runEbur128(filePath, ebur128Opts)).catch((err) => {
      if (isAbortError(err)) throw err;
      opts.onEbur128Error?.(err);
      return null;
    }),
  ]);

  return {
    filePath,
    sox,
    ffprobe,
    spectrum,
    loudness,
  };
}
