// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  ANOMALY_COOLDOWN_MS,
  ANOMALY_WINDOW_MS,
  MAX_ANOMALY_CALLS_PER_WINDOW,
  EMPTY_BUDGET,
  anomalyKey,
  beginCall,
  decideCall,
  endCall,
  refundCall,
  type BudgetRequest,
} from './budget';

const MIN = 60_000;
const T0 = 1_000_000;

function anomaly(channel: number | null, over: Partial<Extract<BudgetRequest, { trigger: 'anomaly' }>> = {}): BudgetRequest {
  return { trigger: 'anomaly', kind: 'clipping', channel, severity: 'issue', sermonQuiet: false, ...over };
}

const QUESTION: BudgetRequest = { trigger: 'question' };

describe('budget', () => {
  it('pins the limits: 10-minute cooldown, 6 per rolling hour', () => {
    expect([ANOMALY_COOLDOWN_MS, ANOMALY_WINDOW_MS, MAX_ANOMALY_CALLS_PER_WINDOW]).toEqual([10 * MIN, 60 * MIN, 6]);
  });

  it('runs a newly visible Issue card when idle', () => {
    expect(decideCall(EMPTY_BUDGET, anomaly(2), T0)).toEqual({ run: true, preempt: null });
  });

  it('never runs an anomaly call for a Check or Info card', () => {
    expect(decideCall(EMPTY_BUDGET, anomaly(2, { severity: 'check' }), T0)).toEqual({ run: false, reason: 'not-issue' });
    expect(decideCall(EMPTY_BUDGET, anomaly(2, { severity: 'info' }), T0)).toEqual({ run: false, reason: 'not-issue' });
  });

  it('during Sermon Quiet only feedback-risk may trigger an anomaly call', () => {
    expect(decideCall(EMPTY_BUDGET, anomaly(2, { sermonQuiet: true }), T0)).toEqual({ run: false, reason: 'sermon-quiet' });
    expect(decideCall(EMPTY_BUDGET, anomaly(null, { sermonQuiet: true, kind: 'feedback-risk' }), T0)).toEqual({ run: true, preempt: null });
  });

  it('holds a 10-minute cooldown per (channel, kind), independent of other channels and kinds', () => {
    const s = endCall(beginCall(EMPTY_BUDGET, anomaly(2), 1, T0), 1);
    expect(decideCall(s, anomaly(2), T0 + 10 * MIN - 1)).toEqual({ run: false, reason: 'cooldown' });
    expect(decideCall(s, anomaly(2), T0 + 10 * MIN)).toEqual({ run: true, preempt: null });
    expect(decideCall(s, anomaly(3), T0 + 1)).toEqual({ run: true, preempt: null });
    expect(decideCall(s, anomaly(2, { kind: 'over-compression' }), T0 + 1)).toEqual({ run: true, preempt: null });
  });

  it('allows at most 6 anomaly calls in any rolling hour', () => {
    let s = EMPTY_BUDGET;
    for (let i = 0; i < MAX_ANOMALY_CALLS_PER_WINDOW; i++) s = endCall(beginCall(s, anomaly(i + 1), i + 1, T0 + i * MIN), i + 1);
    expect(decideCall(s, anomaly(20), T0 + 30 * MIN)).toEqual({ run: false, reason: 'hourly-cap' });
    expect(decideCall(s, anomaly(20), T0 + 60 * MIN)).toEqual({ run: true, preempt: null });
    expect(beginCall(s, anomaly(20), 99, T0 + 61 * MIN).anomalyStarts).toHaveLength(MAX_ANOMALY_CALLS_PER_WINDOW - 1);
  });

  it('questions are never budgeted by cooldown or the hourly cap', () => {
    let s = EMPTY_BUDGET;
    for (let i = 0; i < MAX_ANOMALY_CALLS_PER_WINDOW; i++) s = endCall(beginCall(s, anomaly(i + 1), i + 1, T0), i + 1);
    expect(decideCall(s, QUESTION, T0 + 1)).toEqual({ run: true, preempt: null });
  });

  it('one call in flight: a question cancels an in-flight anomaly call, a second question is busy, an anomaly behind anything is busy', () => {
    const anomalyInFlight = beginCall(EMPTY_BUDGET, anomaly(2), 7, T0);
    expect(decideCall(anomalyInFlight, QUESTION, T0)).toEqual({ run: true, preempt: 7 });
    expect(decideCall(anomalyInFlight, anomaly(3), T0)).toEqual({ run: false, reason: 'busy' });
    const questionInFlight = beginCall(EMPTY_BUDGET, QUESTION, 8, T0);
    expect(decideCall(questionInFlight, QUESTION, T0)).toEqual({ run: false, reason: 'busy' });
    expect(decideCall(questionInFlight, anomaly(3), T0)).toEqual({ run: false, reason: 'busy' });
  });

  it('endCall clears only the matching call, so a preempted call ending late does not clear its successor', () => {
    const s = beginCall(beginCall(EMPTY_BUDGET, anomaly(2), 1, T0), QUESTION, 2, T0);
    expect(endCall(s, 1).inFlight).toEqual({ id: 2, trigger: 'question' });
    expect(endCall(s, 2).inFlight).toBeNull();
  });

  it('a question does not start a cooldown', () => {
    expect(beginCall(EMPTY_BUDGET, QUESTION, 1, T0).lastAnomalyAt).toEqual({});
  });

  it('keys cooldowns by kind and channel, with room-level issues under "room"', () => {
    expect(anomalyKey('clipping', 2)).toBe('clipping:2');
    expect(anomalyKey('feedback-risk', null)).toBe('feedback-risk:room');
  });
});

describe('refundCall', () => {
  it('gives back an anomaly spend: the cooldown key returns to its prior value and the hourly slot is freed', () => {
    const first = beginCall(EMPTY_BUDGET, anomaly(4), 1, T0);
    const settled = endCall(first, 1);
    const later = T0 + ANOMALY_COOLDOWN_MS;
    const spent = beginCall(settled, anomaly(4), 2, later);
    const refunded = refundCall(spent, settled, anomaly(4));
    expect(refunded.lastAnomalyAt).toEqual({ [anomalyKey('clipping', 4)]: T0 });
    expect(refunded.anomalyStarts).toEqual([T0]);
    expect(refunded.inFlight).toEqual({ id: 2, trigger: 'anomaly' });
  });

  it('drops a cooldown key that did not exist before the spend', () => {
    const spent = beginCall(EMPTY_BUDGET, anomaly(null), 1, T0);
    const refunded = refundCall(spent, EMPTY_BUDGET, anomaly(null));
    expect(refunded.lastAnomalyAt).toEqual({});
    expect(refunded.anomalyStarts).toEqual([]);
    expect(decideCall(endCall(refunded, 1), anomaly(null), T0 + 1)).toEqual({ run: true, preempt: null });
  });

  it('leaves a question untouched, since questions never spend', () => {
    const spent = beginCall(EMPTY_BUDGET, QUESTION, 1, T0);
    expect(refundCall(spent, EMPTY_BUDGET, QUESTION)).toBe(spent);
  });

  it('six refunded anomaly calls in an hour leave the hourly cap unspent', () => {
    let state = EMPTY_BUDGET;
    for (let i = 0; i < MAX_ANOMALY_CALLS_PER_WINDOW; i += 1) {
      const prior = state;
      state = endCall(refundCall(beginCall(prior, anomaly(i + 1), i + 1, T0 + i), prior, anomaly(i + 1)), i + 1);
    }
    expect(state).toEqual(EMPTY_BUDGET);
    expect(decideCall(state, anomaly(99), T0 + MAX_ANOMALY_CALLS_PER_WINDOW)).toEqual({ run: true, preempt: null });
  });
});
