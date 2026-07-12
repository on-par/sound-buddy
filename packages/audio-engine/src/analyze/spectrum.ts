import type {
  SpectrumResult,
  SpectrumFrame,
  SpectrumSegment,
  ContentClass,
  ContentType,
} from "../types.js";
import { execFileWithTimeout, SPECTRUM_TIMEOUT_MS } from "./timeout.js";

const CONTENT_CLASSES: ContentClass[] = ["speech", "music", "silence", "unknown"];
const CONTENT_TYPES: ContentType[] = ["speech", "music", "mixed", "silence"];

function asContentClass(v: string | undefined): ContentClass {
  return CONTENT_CLASSES.includes(v as ContentClass) ? (v as ContentClass) : "unknown";
}
function asContentType(v: string | undefined): ContentType | undefined {
  return CONTENT_TYPES.includes(v as ContentType) ? (v as ContentType) : undefined;
}

export interface RunSpectrumOptions {
  /** Path to spectrum.py — each host (CLI, packaged app) resolves this differently. */
  scriptPath: string;
  python?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

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

export async function runSpectrum(filePath: string, opts: RunSpectrumOptions): Promise<SpectrumResult> {
  const { scriptPath, python = "python3", env, signal } = opts;
  const { stdout } = await execFileWithTimeout(
    python,
    [scriptPath, filePath],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env,
      signal,
    },
    "spectrum analysis",
    SPECTRUM_TIMEOUT_MS,
  );

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
