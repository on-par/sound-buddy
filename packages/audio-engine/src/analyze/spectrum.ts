import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type {
  SpectrumResult,
  SpectrumFrame,
  SpectrumSegment,
  ContentClass,
  ContentType,
} from "../types.js";

const CONTENT_CLASSES: ContentClass[] = ["speech", "music", "silence", "unknown"];
const CONTENT_TYPES: ContentType[] = ["speech", "music", "mixed", "silence"];

function asContentClass(v: string | undefined): ContentClass {
  return CONTENT_CLASSES.includes(v as ContentClass) ? (v as ContentClass) : "unknown";
}
function asContentType(v: string | undefined): ContentType | undefined {
  return CONTENT_TYPES.includes(v as ContentType) ? (v as ContentType) : undefined;
}

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
  // Additive fields (PRD 02–04). Older spectrum.py builds omit them.
  curve?: { freqs: number[]; db: number[] };
  frames?: Array<{ t: number; db: number[]; rms: number; class: string }>;
  segments?: Array<{ class: string; start: number; end: number }>;
  content_type?: string;
}

export async function runSpectrum(filePath: string): Promise<SpectrumResult> {
  const { stdout } = await execFileAsync("python3", [SPECTRUM_SCRIPT, filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const raw: RawSpectrumOutput = JSON.parse(stdout);

  const result: SpectrumResult = {
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

  if (raw.curve) result.curve = { freqs: raw.curve.freqs, db: raw.curve.db };
  if (raw.frames) {
    result.frames = raw.frames.map(
      (f): SpectrumFrame => ({ t: f.t, db: f.db, rms: f.rms, class: asContentClass(f.class) }),
    );
  }
  if (raw.segments) {
    result.segments = raw.segments.map(
      (s): SpectrumSegment => ({ class: asContentClass(s.class), start: s.start, end: s.end }),
    );
  }
  const ct = asContentType(raw.content_type);
  if (ct) result.contentType = ct;

  return result;
}
