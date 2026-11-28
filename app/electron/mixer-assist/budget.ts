// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { MixerAssistIssueContext, MixerAssistTrigger } from '../ipc/api';

const MINUTE_MS = 60_000;
export const ANOMALY_COOLDOWN_MS = 10 * MINUTE_MS;
export const ANOMALY_WINDOW_MS = 60 * MINUTE_MS;
export const MAX_ANOMALY_CALLS_PER_WINDOW = 6;
export const SERMON_QUIET_TRIGGER_KIND: MixerAssistIssueContext['kind'] = 'feedback-risk';
const ROOM_KEY = 'room';

export interface BudgetState {
  inFlight: { id: number; trigger: MixerAssistTrigger } | null;
  lastAnomalyAt: Readonly<Record<string, number>>;
  anomalyStarts: readonly number[];
}

export const EMPTY_BUDGET: BudgetState = { inFlight: null, lastAnomalyAt: {}, anomalyStarts: [] };

export type BudgetRequest =
  | { trigger: 'question' }
  | {
      trigger: 'anomaly';
      kind: MixerAssistIssueContext['kind'];
      channel: number | null;
      severity: MixerAssistIssueContext['severity'];
      sermonQuiet: boolean;
    };

export type BudgetDecision =
  | { run: true; preempt: number | null }
  | { run: false; reason: 'busy' | 'cooldown' | 'hourly-cap' | 'not-issue' | 'sermon-quiet' };

export function anomalyKey(kind: string, channel: number | null): string {
  return `${kind}:${channel ?? ROOM_KEY}`;
}

function startsInWindow(state: BudgetState, now: number): number[] {
  return state.anomalyStarts.filter((t) => now - t < ANOMALY_WINDOW_MS);
}

export function decideCall(state: BudgetState, request: BudgetRequest, now: number): BudgetDecision {
  if (request.trigger === 'question') {
    if (state.inFlight === null) return { run: true, preempt: null };
    return state.inFlight.trigger === 'anomaly' ? { run: true, preempt: state.inFlight.id } : { run: false, reason: 'busy' };
  }
  if (request.severity !== 'issue') return { run: false, reason: 'not-issue' };
  if (request.sermonQuiet && request.kind !== SERMON_QUIET_TRIGGER_KIND) return { run: false, reason: 'sermon-quiet' };
  if (state.inFlight !== null) return { run: false, reason: 'busy' };
  const last = state.lastAnomalyAt[anomalyKey(request.kind, request.channel)];
  if (last !== undefined && now - last < ANOMALY_COOLDOWN_MS) return { run: false, reason: 'cooldown' };
  if (startsInWindow(state, now).length >= MAX_ANOMALY_CALLS_PER_WINDOW) return { run: false, reason: 'hourly-cap' };
  return { run: true, preempt: null };
}

export function beginCall(state: BudgetState, request: BudgetRequest, id: number, now: number): BudgetState {
  const inFlight = { id, trigger: request.trigger };
  if (request.trigger === 'question') return { ...state, inFlight };
  return {
    inFlight,
    lastAnomalyAt: { ...state.lastAnomalyAt, [anomalyKey(request.kind, request.channel)]: now },
    anomalyStarts: [...startsInWindow(state, now), now],
  };
}

export function endCall(state: BudgetState, id: number): BudgetState {
  return state.inFlight?.id === id ? { ...state, inFlight: null } : state;
}

export function refundCall(state: BudgetState, prior: BudgetState, request: BudgetRequest): BudgetState {
  if (request.trigger === 'question') return state;
  const key = anomalyKey(request.kind, request.channel);
  const lastAnomalyAt = { ...state.lastAnomalyAt };
  const previous = prior.lastAnomalyAt[key];
  if (previous === undefined) delete lastAnomalyAt[key];
  else lastAnomalyAt[key] = previous;
  return { ...state, lastAnomalyAt, anomalyStarts: state.anomalyStarts.slice(0, -1) };
}
