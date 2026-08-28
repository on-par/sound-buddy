// Offline harshness rules engine (#381): symptom-to-frequency advice for the
// offline report card. Rules are pure data over the shared spectral core
// (#376 — bandEnergy on the fine log-grid SpectrumCurve), so the symptom→band
// mapping lives in one table and call sites never hardcode a band. Fired
// rules come back as structured FiredRule[] for #375 / the report card to
// render; no prose, ML, or grading changes live here.

import { bandEnergy } from "./spectral.js";
import type { SpectrumCurve } from "../types.js";

/** Tolerance for the band-energy excess threshold comparison (mirrors
 *  live-adjustments-state.js's SEVERITY_EPSILON convention). */
const EXCESS_EPSILON = 1e-9;

export type RuleMove = "cut" | "boost" | "highpass";

export interface RuleSuggestion {
  /** Plain-language instruction, e.g. "Cut 2–4 kHz". */
  instruction: string;
  /** The EQ move type (for downstream rendering). */
  move: RuleMove;
  /** Suggested band, Hz, half-open [lowHz, highHz) — bandEnergy's convention. */
  band: { lowHz: number; highHz: number };
  /** Center frequency the engineer dials to, Hz. */
  targetHz: number;
}

export interface BandCondition {
  /** Band measured for the symptom, Hz, half-open. */
  band: { lowHz: number; highHz: number };
  /** Reference band the measured band is compared against, Hz, half-open. */
  reference: { lowHz: number; highHz: number };
  /** Minimum dB the measured band must exceed the reference band to fire. */
  minExcessDb: number;
}

export interface HarshnessRule {
  /** Stable id for downstream consumers. */
  id: string;
  /** Symptom this rule detects, e.g. "Quacky/harsh". */
  symptom: string;
  /** Instrument ids this rule applies to; empty [] means every instrument. */
  instruments: string[];
  condition: BandCondition;
  suggestion: RuleSuggestion;
  /** Why the symptom maps to that band (feeds the #375 narrative layer). */
  why: string;
}

export interface FiredRule {
  rule: HarshnessRule;
  /** Mean dB of the measured band (from bandEnergy). */
  measuredDb: number;
  /** Mean dB of the reference band (from bandEnergy). */
  referenceDb: number;
  /** measuredDb - referenceDb. */
  excessDb: number;
}

/**
 * The grade-facing projection of a fired rule (#1246). The report card's
 * grading engine (app/renderer/grading.js) is a classic script with no module
 * loader in the renderer, so it can never import RULE_TABLE. Instead it is
 * handed this small serializable shape and renders `minExcessDb` verbatim —
 * which keeps the band-excess threshold defined exactly once, here in
 * RULE_TABLE, while the dependency still flows app -> packages (ADR-0027).
 */
export interface GradeSymptom {
  /** HarshnessRule.id, e.g. "muddy". */
  ruleId: string;
  /** HarshnessRule.symptom, e.g. "Muddy". */
  symptom: string;
  /** The rule's EQ instruction, e.g. "Highpass below ~100 Hz and cut ~250 Hz". */
  instruction: string;
  /** Measured dB the band exceeded its reference by. */
  excessDb: number;
  /** The rule's own firing threshold — the single definition of the band
   *  threshold, rendered by the grade's deduction target string. */
  minExcessDb: number;
}

/**
 * Static symptom-to-frequency table. Each row is data: the symptom, the
 * instruments it applies to ([] = every instrument), a band-vs-reference
 * condition, and the EQ suggestion (move + target band). Adding a rule is
 * adding a row. The generic three come from the #381 issue verbatim; the
 * drum entries are standard moves pending Lee's drum-build EQ set (#381
 * openQuestions — one-row data edit if his values differ).
 */
export const RULE_TABLE: HarshnessRule[] = [
  {
    id: "harsh",
    symptom: "Quacky/harsh",
    instruments: [],
    condition: {
      band: { lowHz: 2000, highHz: 4000 },
      reference: { lowHz: 500, highHz: 2000 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Cut 2–4 kHz",
      move: "cut",
      band: { lowHz: 2000, highHz: 4000 },
      targetHz: 3000,
    },
    why: "Harshness lives at 2–4 kHz; when the high-mid band sits ≥6 dB above the 500 Hz–2 kHz body, cutting there removes the harsh edge.",
  },
  {
    id: "edgy",
    symptom: "Edgy/piezo",
    instruments: [],
    condition: {
      band: { lowHz: 2500, highHz: 3500 },
      reference: { lowHz: 3500, highHz: 6000 },
      minExcessDb: 8,
    },
    suggestion: {
      instruction: "Cut ~3 kHz",
      move: "cut",
      band: { lowHz: 2500, highHz: 3500 },
      targetHz: 3000,
    },
    why: "Piezo/edgy tone concentrates around 3 kHz; a ≥8 dB bump over the 3.5–6 kHz region reads as a resonant edge to cut.",
  },
  {
    id: "muddy",
    symptom: "Muddy",
    instruments: [],
    condition: {
      band: { lowHz: 60, highHz: 250 },
      reference: { lowHz: 500, highHz: 2000 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Highpass below ~100 Hz and cut ~250 Hz",
      move: "highpass",
      band: { lowHz: 200, highHz: 300 },
      targetHz: 250,
    },
    why: "Mud collects below 250 Hz; when the 60–250 Hz band runs ≥6 dB over the 500 Hz–2 kHz body, highpass the sub and cut ~250 Hz to clear it.",
  },
  {
    id: "kick-boxy",
    symptom: "Boxy kick",
    instruments: ["kick"],
    condition: {
      band: { lowHz: 250, highHz: 500 },
      reference: { lowHz: 60, highHz: 250 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Cut ~300–500 Hz",
      move: "cut",
      band: { lowHz: 300, highHz: 500 },
      targetHz: 400,
    },
    why: "Boxiness lives at 250–500 Hz; a ≥6 dB low-mid bump over the 60–250 Hz fundamental reads as a boxy kick.",
  },
  {
    id: "snare-harsh",
    symptom: "Harsh/ringy snare",
    instruments: ["snare"],
    condition: {
      band: { lowHz: 2000, highHz: 4000 },
      reference: { lowHz: 500, highHz: 2000 },
      minExcessDb: 8,
    },
    suggestion: {
      instruction: "Cut 2–4 kHz",
      move: "cut",
      band: { lowHz: 2000, highHz: 4000 },
      targetHz: 3000,
    },
    why: "Snare harshness/ring lives at 2–4 kHz; a ≥8 dB high-mid bump over the 500 Hz–2 kHz body reads as a harsh, ringy snare.",
  },
  {
    id: "cymbal-brittle",
    symptom: "Brittle cymbals",
    instruments: ["overheads"],
    condition: {
      band: { lowHz: 6000, highHz: 12000 },
      reference: { lowHz: 4000, highHz: 6000 },
      minExcessDb: 6,
    },
    suggestion: {
      instruction: "Cut 6–12 kHz",
      move: "cut",
      band: { lowHz: 6000, highHz: 12000 },
      targetHz: 8000,
    },
    why: "Cymbal brittleness lives at 6–12 kHz; when the brilliance band runs ≥6 dB over the 4–6 kHz presence region, tame it there.",
  },
];

/** Rules applicable to `instrumentId`: every generic rule (instruments: [])
 *  plus the instrument's own rules. undefined/''/unknown id → generic only. */
export function rulesForInstrument(instrumentId?: string): HarshnessRule[] {
  const generic = RULE_TABLE.filter((rule) => rule.instruments.length === 0);
  if (!instrumentId) {
    return generic;
  }
  return [...generic, ...RULE_TABLE.filter((rule) => rule.instruments.includes(instrumentId))];
}

/**
 * Fires the applicable rules against a curve using the shared #376
 * bandEnergy primitive. Returns a new FiredRule[] sorted by excessDb
 * descending. A rule fires iff both its bands are finite on the curve and
 * excessDb >= minExcessDb (within EXCESS_EPSILON); non-finite bands never
 * fire. An undefined curve yields [] directly; mismatched/empty curves yield
 * [] via bandEnergy's own guards.
 */
export function evaluateRules(curve: SpectrumCurve | undefined, instrumentId?: string): FiredRule[] {
  if (!curve) return [];
  const fired: FiredRule[] = [];
  for (const rule of rulesForInstrument(instrumentId)) {
    const measuredDb = bandEnergy(curve, rule.condition.band.lowHz, rule.condition.band.highHz);
    const referenceDb = bandEnergy(curve, rule.condition.reference.lowHz, rule.condition.reference.highHz);
    if (!Number.isFinite(measuredDb) || !Number.isFinite(referenceDb)) continue;
    const excessDb = measuredDb - referenceDb;
    if (excessDb >= rule.condition.minExcessDb - EXCESS_EPSILON) {
      fired.push({ rule, measuredDb, referenceDb, excessDb });
    }
  }
  // Stable sort — ties keep table order, so the most obvious problem leads.
  return fired.sort((a, b) => b.excessDb - a.excessDb);
}

/**
 * Projects evaluateRules' output onto the grade-facing GradeSymptom[] (#1246),
 * preserving evaluateRules' excessDb-descending order so the leading symptom is
 * the most obvious problem. Pure; an empty input yields an empty array.
 */
export function gradeSymptoms(fired: FiredRule[]): GradeSymptom[] {
  return fired.map((hit) => ({
    ruleId: hit.rule.id,
    symptom: hit.rule.symptom,
    instruction: hit.rule.suggestion.instruction,
    excessDb: hit.excessDb,
    minExcessDb: hit.rule.condition.minExcessDb,
  }));
}