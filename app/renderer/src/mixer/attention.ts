// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { DEFAULT_MIXER_ATTENTION_CAP, type MixerAttentionCap } from '../../../electron/ipc/api';

export type MixerSeverity = 'issue' | 'check' | 'info';
export type MixerIssueKind = 'clipping' | 'over-compression' | 'feedback-risk';

export interface MixerIssue {
  key: string;
  kind: MixerIssueKind;
  channel: number | null;
  severity: MixerSeverity;
  magnitude: number;
  activeSince: number;
  diagnosis: string;
}

export interface MixerDismissal {
  until: number;
  severity: MixerSeverity;
}

export type MixerDismissals = Readonly<Record<string, MixerDismissal>>;

export interface AttentionView {
  visible: MixerIssue[];
  queued: MixerIssue[];
  held: MixerIssue[];
  frozen: boolean;
}

export interface AttentionInput {
  issues: readonly MixerIssue[];
  now: number;
  cap?: MixerAttentionCap;
  dismissals?: MixerDismissals;
  sermonQuiet?: boolean;
}

export const DISMISS_MUTE_MS = 10 * 60 * 1000;
export const SERMON_QUIET_KIND: MixerIssueKind = 'feedback-risk';

const SEVERITY_RANK: Readonly<Record<MixerSeverity, number>> = { issue: 3, check: 2, info: 1 };

export function severityRank(severity: MixerSeverity): number {
  return SEVERITY_RANK[severity];
}

export function issueKey(kind: MixerIssueKind, channel: number | null): string {
  return `${kind}:${channel === null ? 'room' : channel}`;
}

export function compareIssues(a: MixerIssue, b: MixerIssue): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    b.magnitude - a.magnitude ||
    a.activeSince - b.activeSince ||
    a.key.localeCompare(b.key)
  );
}

export function isMuted(issue: MixerIssue, dismissals: MixerDismissals, now: number): boolean {
  const d = dismissals[issue.key];
  if (!d || now >= d.until) return false;
  return severityRank(issue.severity) <= severityRank(d.severity);
}

export function dismissIssue(dismissals: MixerDismissals, issue: MixerIssue, now: number): MixerDismissals {
  return { ...dismissals, [issue.key]: { until: now + DISMISS_MUTE_MS, severity: issue.severity } };
}

export function pruneDismissals(dismissals: MixerDismissals, now: number): MixerDismissals {
  return Object.fromEntries(Object.entries(dismissals).filter(([, d]) => now < d.until));
}

export function selectAttention(input: AttentionInput): AttentionView {
  const cap = input.cap ?? DEFAULT_MIXER_ATTENTION_CAP;
  const dismissals = input.dismissals ?? {};
  const live = input.issues.filter((i) => !isMuted(i, dismissals, input.now)).sort(compareIssues);
  const eligible = input.sermonQuiet ? live.filter((i) => i.kind === SERMON_QUIET_KIND) : live;
  const held = input.sermonQuiet ? live.filter((i) => i.kind !== SERMON_QUIET_KIND) : [];
  return { visible: eligible.slice(0, cap), queued: eligible.slice(cap), held, frozen: false };
}

export function attentionForLink(
  offline: boolean,
  live: AttentionView,
  frozen: AttentionView | null
): AttentionView {
  if (!offline) return live;
  return { ...(frozen ?? live), frozen: true };
}
