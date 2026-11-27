// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseChannelStrips } from '@sound-buddy/console';
import {
  proposeMove,
  reconcileMoves,
  moveParamLabel,
  adviceText,
  COMP_RATIO_STEPS,
  THRESHOLD_STEP_DB,
  THRESHOLD_WHY,
  UNLISTED_RATIO_WHY,
  type ProposedMove,
} from './proposed-moves';
import { issueKey, type MixerIssue } from './attention';
import type { ConsoleChannelStateDto, ConsoleDynamicsDto } from '../../../electron/ipc/api';

const sceneDynLine = fs
  .readFileSync(fileURLToPath(new URL('../../../../packages/console/src/capture-2026-08-16.scn', import.meta.url)), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('/ch/01/dyn '))!;

function ch(index: number, dynamics: Partial<ConsoleDynamicsDto> = {}): ConsoleChannelStateDto {
  return {
    index, name: 'Bass', faderDb: -3, on: true, icon: 1, color: { base: 'green', inverted: false },
    dynamics: { on: true, mode: 'COMP', thr: -28, ratio: 7, knee: 1, mgain: 0, ...dynamics },
  };
}

function overComp(channel: number): MixerIssue {
  return { key: issueKey('over-compression', channel), kind: 'over-compression', channel, severity: 'check', magnitude: 12, activeSince: 0, diagnosis: 'd' };
}

describe('proposeMove', () => {
  it('turns the scene fixture dyn line into a one-step gentler ratio move with a qualitative expectation', () => {
    const [strip] = parseChannelStrips(sceneDynLine);
    const move = proposeMove(overComp(1), ch(1, strip.dynamics));
    expect(strip.dynamics.ratio).toBe(5);
    expect(move).toMatchObject({ key: 'over-compression:1:comp-ratio', channel: 1, parameter: 'comp-ratio', from: 5, to: 4, status: 'pending' });
    expect(move!.to).toBeLessThan(move!.from);
    expect(COMP_RATIO_STEPS.indexOf(move!.from) - COMP_RATIO_STEPS.indexOf(move!.to)).toBe(1);
    expect(move!.expected).not.toMatch(/\d/);
  });

  it('raises the threshold by at most the step, capped at 0 dB, when the ratio is already at its gentlest step', () => {
    expect(proposeMove(overComp(2), ch(2, { ratio: 1.1, thr: -20 }))).toMatchObject({ parameter: 'comp-threshold', from: -20, to: -20 + THRESHOLD_STEP_DB });
    expect(proposeMove(overComp(2), ch(2, { ratio: 1.1, thr: -1 }))).toMatchObject({ to: 0 });
    expect(proposeMove(overComp(2), ch(2, { ratio: 1.1, thr: 0 }))).toBeNull();
  });

  it('uses the threshold when the reported ratio is not one of the console steps', () => {
    expect(proposeMove(overComp(2), ch(2, { ratio: 3.3, thr: -30 }))?.parameter).toBe('comp-threshold');
  });

  it('says the ratio is at its gentlest step only when it is, and names an unlisted ratio as unlisted', () => {
    const gentlest = proposeMove(overComp(2), ch(2, { ratio: 1.1, thr: -20 }));
    const unlisted = proposeMove(overComp(2), ch(2, { ratio: 3.3, thr: -30 }));
    expect(gentlest?.why).toBe(THRESHOLD_WHY);
    expect(gentlest?.why).toMatch(/gentlest step/);
    expect(unlisted?.why).toBe(UNLISTED_RATIO_WHY);
    expect(unlisted?.why).not.toMatch(/gentlest/);
    expect(unlisted).toMatchObject({ parameter: 'comp-threshold', from: -30, to: -30 + THRESHOLD_STEP_DB });
  });

  it('proposes nothing for clipping, feedback, a room issue, a compressor that is off, or an unread channel', () => {
    const clip: MixerIssue = { ...overComp(1), key: 'clipping:1', kind: 'clipping', severity: 'issue' };
    const room: MixerIssue = { ...overComp(1), key: 'over-compression:room', channel: null };
    expect(proposeMove(clip, ch(1))).toBeNull();
    expect(proposeMove({ ...overComp(1), kind: 'feedback-risk' }, ch(1))).toBeNull();
    expect(proposeMove(room, ch(1))).toBeNull();
    expect(proposeMove(overComp(1), ch(1, { on: false }))).toBeNull();
    expect(proposeMove(overComp(1), undefined)).toBeNull();
  });
});

describe('reconcileMoves', () => {
  const issue = overComp(3);

  it('adds a move for a new over-compression issue', () => {
    const moves = reconcileMoves({}, [issue], [ch(3)], []);
    expect(Object.keys(moves)).toEqual(['over-compression:3:comp-ratio']);
  });

  it('resolves a pending move as changed on desk when the poll shows the operator moved that parameter, and keeps it', () => {
    const moves = reconcileMoves({}, [issue], [ch(3)], []);
    const changed = reconcileMoves(moves, [issue], [ch(3, { ratio: 4 })], []);
    expect(changed['over-compression:3:comp-ratio'].status).toBe('changed-on-desk');
    const later = reconcileMoves(changed, [], [ch(3, { ratio: 2 })], []);
    expect(later['over-compression:3:comp-ratio'].status).toBe('changed-on-desk');
  });

  it('resolves a threshold move as changed on desk when the threshold moves on the desk', () => {
    const moves = reconcileMoves({}, [issue], [ch(3, { ratio: 1.1, thr: -30 })], []);
    expect(Object.values(moves)[0].parameter).toBe('comp-threshold');
    const changed = reconcileMoves(moves, [issue], [ch(3, { ratio: 1.1, thr: -24 })], []);
    expect(Object.values(changed)[0].status).toBe('changed-on-desk');
  });

  it('keeps a pending move while its issue is active and the value is unchanged, or the channel is unread', () => {
    const moves = reconcileMoves({}, [issue], [ch(3)], []);
    expect(reconcileMoves(moves, [issue], [ch(3)], [])).toEqual(moves);
    expect(reconcileMoves(moves, [issue], [], [])).toEqual(moves);
  });

  it('drops a pending move once its issue resolves on its own', () => {
    const moves = reconcileMoves({}, [issue], [ch(3)], []);
    expect(reconcileMoves(moves, [], [ch(3)], [])).toEqual({});
  });

  it('never re-proposes a dismissed move and drops it from the list', () => {
    const moves = reconcileMoves({}, [issue], [ch(3)], []);
    const dismissed = ['over-compression:3:comp-ratio'];
    expect(reconcileMoves(moves, [issue], [ch(3)], dismissed)).toEqual({});
    expect(reconcileMoves({}, [issue], [ch(3)], dismissed)).toEqual({});
  });

  it('does not propose a second move for an issue whose move resolved as changed on desk', () => {
    const moves = reconcileMoves(reconcileMoves({}, [issue], [ch(3)], []), [issue], [ch(3, { ratio: 4 })], []);
    expect(Object.keys(reconcileMoves(moves, [issue], [ch(3, { ratio: 4 })], []))).toEqual(['over-compression:3:comp-ratio']);
  });
});

describe('labels and advice', () => {
  it('labels ratio and threshold moves', () => {
    const base: ProposedMove = { key: 'k', issueKey: 'i', channel: 1, parameter: 'comp-ratio', from: 6, to: 5, why: '', expected: '', status: 'pending' };
    expect(moveParamLabel(base)).toBe('Comp ratio 6.0:1 → 5.0:1');
    expect(moveParamLabel({ ...base, parameter: 'comp-threshold', from: -28, to: -25 })).toBe('Comp threshold -28.0 dB → -25.0 dB');
  });

  it('gives advice text, never a move, for clipping and feedback risk', () => {
    const clip: MixerIssue = { ...overComp(1), kind: 'clipping', severity: 'issue' };
    expect(adviceText(clip, '01 Lead Vox', null)).toMatch(/^01 Lead Vox: lower the input gain or trim/);
    const ring: MixerIssue = { ...overComp(1), kind: 'feedback-risk', channel: null };
    expect(adviceText(ring, 'Room', '2.5 kHz')).toMatch(/^Room ring near 2.5 kHz:/);
    expect(adviceText(ring, 'Room', null)).toMatch(/^Room ring near an unknown frequency:/);
    expect(adviceText(overComp(1), '01', null)).toBeNull();
  });
});
