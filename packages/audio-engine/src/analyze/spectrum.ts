import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { SpectrumResult } from "../types.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the spectrum.py path relative to this file:
// src/analyze/spectrum.ts -> ../../scripts/spectrum.py
const SPECTRUM_SCRIPT = join(__dirname, "..", "..", "scripts", "spectrum.py");

interface RawSpectrumOutput {
  bands: {
    sub_bass: number;
    bass: number;
    low_mid: number;
    mid: number;
    high_mid: number;
    presence: number;
    brilliance: number;
  };
  spectral_centroid: number;
  spectral_rolloff_85: number;
  dynamic_range: number;
}

export async function runSpectrum(filePath: string): Promise<SpectrumResult> {
  const { stdout } = await execFileAsync("python3", [SPECTRUM_SCRIPT, filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const raw: RawSpectrumOutput = JSON.parse(stdout);

  return {
    bands: {
      subBass: raw.bands.sub_bass,
      bass: raw.bands.bass,
      lowMid: raw.bands.low_mid,
      mid: raw.bands.mid,
      highMid: raw.bands.high_mid,
      presence: raw.bands.presence,
      brilliance: raw.bands.brilliance,
    },
    spectralCentroid: raw.spectral_centroid,
    spectralRolloff85: raw.spectral_rolloff_85,
    dynamicRange: raw.dynamic_range,
  };
}
