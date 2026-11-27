// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { ConsoleChannelStateDto } from '../../../electron/ipc/api';
import type { MixerIssue } from './attention';

export const COMP_RATIO_STEPS: readonly number[] = [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100];
export const THRESHOLD_STEP_DB = 3;
export const THRESHOLD_CEILING_DB = 0;
export const MOVE_VALUE_EPSILON = 0.01;
export const LOCKED_WRITES_COPY = 'Console writes are locked in this build';
const DECIMALS = 1;

export type MoveParameter = 'comp-ratio' | 'comp-threshold';
export type MoveStatus = 'pending' | 'changed-on-desk';

export interface ProposedMove {
  key: string;
  issueKey: string;
  channel: number;
  parameter: MoveParameter;
  from: number;
  to: number;
  why: string;
  expected: string;
  status: MoveStatus;
}

export type ProposedMoves = Readonly<Record<string, ProposedMove>>;

const RATIO_WHY = 'The compressor has been holding heavy gain reduction. One ratio step gentler lets loud passages through with less squeeze.';
const THRESHOLD_WHY = 'The compressor has been holding heavy gain reduction and the ratio is already at its gentlest step. A slightly higher threshold engages it less often.';
const EXPECTED = 'Less gain reduction on loud passages; the channel should sound less squashed.';

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < MOVE_VALUE_EPSILON;
}

function moveKey(issueKey: string, parameter: MoveParameter): string {
  return `${issueKey}:${parameter}`;
}

export function proposeMove(issue: MixerIssue, channel: ConsoleChannelStateDto | undefined): ProposedMove | null {
  if (issue.kind !== 'over-compression' || issue.channel === null || !channel?.dynamics.on) return null;
  const { ratio, thr } = channel.dynamics;
  const step = COMP_RATIO_STEPS.findIndex((r) => sameValue(r, ratio));
  if (step > 0) {
    return {
      key: moveKey(issue.key, 'comp-ratio'),
      issueKey: issue.key,
      channel: issue.channel,
      parameter: 'comp-ratio',
      from: ratio,
      to: COMP_RATIO_STEPS[step - 1],
      why: RATIO_WHY,
      expected: EXPECTED,
      status: 'pending',
    };
  }
  const to = Math.min(thr + THRESHOLD_STEP_DB, THRESHOLD_CEILING_DB);
  if (to <= thr) return null;
  return {
    key: moveKey(issue.key, 'comp-threshold'),
    issueKey: issue.key,
    channel: issue.channel,
    parameter: 'comp-threshold',
    from: thr,
    to,
    why: THRESHOLD_WHY,
    expected: EXPECTED,
    status: 'pending',
  };
}

function currentValue(move: ProposedMove, channel: ConsoleChannelStateDto | undefined): number | null {
  if (!channel) return null;
  return move.parameter === 'comp-ratio' ? channel.dynamics.ratio : channel.dynamics.thr;
}

export function reconcileMoves(
  moves: ProposedMoves,
  issues: readonly MixerIssue[],
  channels: readonly ConsoleChannelStateDto[],
  dismissed: readonly string[]
): ProposedMoves {
  const next: Record<string, ProposedMove> = {};
  const activeIssues = new Set(issues.map((i) => i.key));
  for (const move of Object.values(moves)) {
    if (dismissed.includes(move.key)) continue;
    const value = currentValue(move, channels.find((c) => c.index === move.channel));
    if (move.status === 'pending' && value !== null && !sameValue(value, move.from)) {
      next[move.key] = { ...move, status: 'changed-on-desk' };
    } else if (move.status === 'changed-on-desk' || activeIssues.has(move.issueKey)) {
      next[move.key] = move;
    }
  }
  for (const issue of issues) {
    if (Object.values(next).some((m) => m.issueKey === issue.key)) continue;
    const move = proposeMove(issue, channels.find((c) => c.index === issue.channel));
    if (move && !dismissed.includes(move.key)) next[move.key] = move;
  }
  return next;
}

export function moveParamLabel(move: ProposedMove): string {
  if (move.parameter === 'comp-ratio') {
    return `Comp ratio ${move.from.toFixed(DECIMALS)}:1 → ${move.to.toFixed(DECIMALS)}:1`;
  }
  return `Comp threshold ${move.from.toFixed(DECIMALS)} dB → ${move.to.toFixed(DECIMALS)} dB`;
}

export function adviceText(issue: MixerIssue, who: string, ringFreq: string | null): string | null {
  if (issue.kind === 'clipping') {
    return `${who}: lower the input gain or trim on the desk until the peak stays under full scale. Pulling the fader down will not fix clipping at the input.`;
  }
  if (issue.kind === 'feedback-risk') {
    return `Room ring near ${ringFreq ?? 'an unknown frequency'}: bring down the open mic nearest a speaker first. The candidate list comes from open faders, not a confirmed source.`;
  }
  return null;
}
