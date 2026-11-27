// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { issueKey, type MixerIssue } from './attention';

export const CLIP_LINEAR_FULL_SCALE = 1.0;
export const CLIP_HOLD_MS = 10_000;
export const OVER_COMP_GR_DB_THRESHOLD = 10;
export const OVER_COMP_SUSTAIN_MS = 5_000;
export const GR_DIRECTION_ESTABLISHED = false;
export const GR_UNAVAILABLE_LABEL = 'GR unavailable';
export const METERS_UNAVAILABLE_LABEL = 'Meters unavailable';
const DB_PER_AMPLITUDE_DECADE = 20;
const DB_DECIMALS = 1;

export interface RuleHistory {
  lastClipAt: Readonly<Record<number, number>>;
  clipPeak: Readonly<Record<number, number>>;
  overCompSince: Readonly<Record<number, number>>;
  overCompGrDb: Readonly<Record<number, number>>;
  activeSince: Readonly<Record<string, number>>;
}

export const EMPTY_RULE_HISTORY: RuleHistory = Object.freeze({
  lastClipAt: {},
  clipPeak: {},
  overCompSince: {},
  overCompGrDb: {},
  activeSince: {},
});

export function linearToDbfs(linear: number): number {
  if (!(linear > 0)) return -Infinity;
  return DB_PER_AMPLITUDE_DECADE * Math.log10(linear);
}

export function formatDbfs(linear: number): string {
  const db = linearToDbfs(linear);
  if (!Number.isFinite(db)) return '-∞ dBFS';
  return `${db > 0 ? '+' : ''}${db.toFixed(DB_DECIMALS)} dBFS`;
}

export function grDbFromMeters(raw: readonly number[]): Array<number | null> {
  return raw.map(() => null);
}

export function ingestMeterFrame(
  history: RuleHistory,
  inputs: readonly number[],
  grDb: ReadonlyArray<number | null>,
  now: number
): RuleHistory {
  const lastClipAt = { ...history.lastClipAt };
  const clipPeak = { ...history.clipPeak };
  inputs.forEach((level, i) => {
    const channel = i + 1;
    const stillHeld = lastClipAt[channel] !== undefined && now - lastClipAt[channel] <= CLIP_HOLD_MS;
    if (level >= CLIP_LINEAR_FULL_SCALE) {
      lastClipAt[channel] = now;
      clipPeak[channel] = stillHeld ? Math.max(clipPeak[channel], level) : level;
    } else if (!stillHeld) {
      delete lastClipAt[channel];
      delete clipPeak[channel];
    }
  });
  const overCompSince: Record<number, number> = {};
  const overCompGrDb: Record<number, number> = {};
  grDb.forEach((db, i) => {
    const channel = i + 1;
    if (db === null || db < OVER_COMP_GR_DB_THRESHOLD) return;
    overCompSince[channel] = history.overCompSince[channel] ?? now;
    overCompGrDb[channel] = db;
  });
  return { ...history, lastClipAt, clipPeak, overCompSince, overCompGrDb };
}

export function ruleIssues(history: RuleHistory, now: number): Array<Omit<MixerIssue, 'activeSince'>> {
  const issues: Array<Omit<MixerIssue, 'activeSince'>> = [];
  for (const [ch, peak] of Object.entries(history.clipPeak)) {
    const channel = Number(ch);
    if (now - history.lastClipAt[channel] > CLIP_HOLD_MS) continue;
    const db = linearToDbfs(peak);
    issues.push({
      key: issueKey('clipping', channel),
      kind: 'clipping',
      channel,
      severity: 'issue',
      magnitude: db,
      diagnosis: `Input is hitting digital full scale (peak ${formatDbfs(peak)})`,
    });
  }
  for (const [ch, since] of Object.entries(history.overCompSince)) {
    if (now - since < OVER_COMP_SUSTAIN_MS) continue;
    const channel = Number(ch);
    const grDb = history.overCompGrDb[channel];
    issues.push({
      key: issueKey('over-compression', channel),
      kind: 'over-compression',
      channel,
      severity: 'check',
      magnitude: grDb,
      diagnosis: 'Compressor is holding heavy gain reduction',
    });
  }
  return issues;
}

export function trackActive(
  history: RuleHistory,
  issues: ReadonlyArray<Omit<MixerIssue, 'activeSince'>>,
  now: number
): { history: RuleHistory; issues: MixerIssue[] } {
  const activeSince: Record<string, number> = {};
  const tracked = issues.map((issue) => {
    const since = history.activeSince[issue.key] ?? now;
    activeSince[issue.key] = since;
    return { ...issue, activeSince: since };
  });
  return { history: { ...history, activeSince }, issues: tracked };
}
