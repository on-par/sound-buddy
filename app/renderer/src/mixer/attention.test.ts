// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  selectAttention,
  dismissIssue,
  pruneDismissals,
  isMuted,
  issueKey,
  compareIssues,
  attentionForLink,
  DISMISS_MUTE_MS,
  type MixerIssue,
  type MixerIssueKind,
  type MixerSeverity,
} from './attention';

const NOW = 1_000_000;

function issue(kind: MixerIssueKind, channel: number | null, severity: MixerSeverity, magnitude = 1, activeSince = NOW - 1000): MixerIssue {
  return { key: issueKey(kind, channel), kind, channel, severity, magnitude, activeSince, diagnosis: `${kind} ${channel}` };
}

const keys = (list: MixerIssue[]) => list.map((i) => i.key);

describe('selectAttention ordering', () => {
  it('orders Issue > Check > Info, then by magnitude, then by longest active', () => {
    const view = selectAttention({
      now: NOW,
      cap: 3,
      issues: [
        issue('over-compression', 4, 'check', 5),
        issue('clipping', 2, 'issue', 1),
        issue('over-compression', 3, 'check', 9),
        issue('clipping', 1, 'issue', 1, NOW - 9000),
        issue('over-compression', 9, 'info', 99),
      ],
    });
    expect(keys(view.visible)).toEqual(['clipping:1', 'clipping:2', 'over-compression:3']);
    expect(keys(view.queued)).toEqual(['over-compression:4', 'over-compression:9']);
    expect(view.held).toEqual([]);
    expect(view.frozen).toBe(false);
  });

  it('breaks a full tie on the issue key so the order is stable', () => {
    const a = issue('clipping', 1, 'issue');
    const b = issue('clipping', 2, 'issue');
    expect(compareIssues(a, b)).toBeLessThan(0);
    expect(compareIssues(b, a)).toBeGreaterThan(0);
  });
});

describe('selectAttention cap and queue', () => {
  const five = [1, 2, 3, 4, 5].map((ch) => issue('clipping', ch, 'issue', 10 - ch));

  it('shows 3 cards by default and queues the rest with a +N count', () => {
    const view = selectAttention({ now: NOW, issues: five });
    expect(view.visible).toHaveLength(3);
    expect(view.queued).toHaveLength(2);
  });

  it('shows 2 cards with cap 2', () => {
    const view = selectAttention({ now: NOW, issues: five, cap: 2 });
    expect(keys(view.visible)).toEqual(['clipping:1', 'clipping:2']);
    expect(view.queued).toHaveLength(3);
  });

  it('promotes the first queued card when a visible one resolves', () => {
    const view = selectAttention({ now: NOW, issues: five.filter((i) => i.channel !== 2) });
    expect(keys(view.visible)).toEqual(['clipping:1', 'clipping:3', 'clipping:4']);
  });

  it('promotes the first queued card when a visible one is dismissed', () => {
    const dismissals = dismissIssue({}, five[0], NOW);
    const view = selectAttention({ now: NOW, issues: five, dismissals });
    expect(keys(view.visible)).toEqual(['clipping:2', 'clipping:3', 'clipping:4']);
    expect(keys(view.queued)).toEqual(['clipping:5']);
  });
});

describe('dismissal mute', () => {
  const clip = issue('over-compression', 7, 'check');

  it('mutes channel+kind for 10 minutes', () => {
    const dismissals = dismissIssue({}, clip, NOW);
    expect(dismissals[clip.key]).toEqual({ until: NOW + DISMISS_MUTE_MS, severity: 'check' });
    expect(isMuted(clip, dismissals, NOW + DISMISS_MUTE_MS - 1)).toBe(true);
    expect(isMuted(clip, dismissals, NOW + DISMISS_MUTE_MS)).toBe(false);
  });

  it('lifts the mute early when the same channel+kind comes back at a worse severity', () => {
    const dismissals = dismissIssue({}, clip, NOW);
    const worse = { ...clip, severity: 'issue' as const };
    expect(isMuted(worse, dismissals, NOW + 1000)).toBe(false);
    expect(keys(selectAttention({ now: NOW + 1000, issues: [worse], dismissals }).visible)).toEqual([clip.key]);
  });

  it('does not mute another channel or another kind', () => {
    const dismissals = dismissIssue({}, clip, NOW);
    expect(isMuted(issue('over-compression', 8, 'check'), dismissals, NOW)).toBe(false);
    expect(isMuted(issue('clipping', 7, 'check'), dismissals, NOW)).toBe(false);
  });

  it('prunes expired dismissals only', () => {
    const a = dismissIssue({}, clip, NOW);
    const b = dismissIssue(a, issue('clipping', 1, 'issue'), NOW + DISMISS_MUTE_MS);
    expect(Object.keys(pruneDismissals(b, NOW + DISMISS_MUTE_MS))).toEqual(['clipping:1']);
  });
});

describe('Sermon Quiet', () => {
  const mixed = [
    issue('clipping', 1, 'issue', 5),
    issue('feedback-risk', null, 'issue', 3),
    issue('over-compression', 2, 'check', 4),
    issue('clipping', 3, 'issue', 2),
  ];

  it('shows only feedback-risk and holds everything else, in order, with a count', () => {
    const view = selectAttention({ now: NOW, issues: mixed, sermonQuiet: true });
    expect(keys(view.visible)).toEqual(['feedback-risk:room']);
    expect(view.queued).toEqual([]);
    expect(keys(view.held)).toEqual(['clipping:1', 'clipping:3', 'over-compression:2']);
  });

  it('returns the held items in order, capped, once Sermon Quiet is off', () => {
    const view = selectAttention({ now: NOW, issues: mixed, sermonQuiet: false });
    expect(keys(view.visible)).toEqual(['clipping:1', 'feedback-risk:room', 'clipping:3']);
    expect(keys(view.queued)).toEqual(['over-compression:2']);
    expect(view.held).toEqual([]);
  });
});

describe('attentionForLink', () => {
  const live = selectAttention({ now: NOW, issues: [issue('clipping', 1, 'issue')] });
  const frozen = selectAttention({ now: NOW, issues: [issue('clipping', 9, 'issue')] });

  it('passes the live view through while the link is up', () => {
    expect(attentionForLink(false, live, frozen)).toBe(live);
  });

  it('shows the frozen snapshot, marked frozen, while offline', () => {
    const view = attentionForLink(true, live, frozen);
    expect(keys(view.visible)).toEqual(['clipping:9']);
    expect(view.frozen).toBe(true);
  });

  it('freezes the current view when no snapshot was taken yet', () => {
    const view = attentionForLink(true, live, null);
    expect(keys(view.visible)).toEqual(['clipping:1']);
    expect(view.frozen).toBe(true);
  });
});
