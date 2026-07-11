import { describe, it, expect, vi } from 'vitest';
import { FEEDBACK_EMAIL, feedbackMailtoUrl } from './feedback';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  shell: { openExternal: vi.fn() },
}));

describe('feedbackMailtoUrl', () => {
  it('returns a mailto URL addressed to support', () => {
    expect(feedbackMailtoUrl('0.7.0', '14.5.0')).toMatch(
      new RegExp(`^mailto:${FEEDBACK_EMAIL}\\?`)
    );
  });

  it('encodes the feedback subject', () => {
    const url = new URL(feedbackMailtoUrl('0.7.0', '14.5.0'));
    expect(url.searchParams.get('subject')).toBe('Sound Buddy Feedback');
    expect(feedbackMailtoUrl('0.7.0', '14.5.0')).toContain('subject=Sound%20Buddy%20Feedback');
  });

  it('includes the app and macOS versions in the decoded body', () => {
    const url = new URL(feedbackMailtoUrl('0.7.0-beta 1', '14.5.0 (23F79)'));
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('App version: 0.7.0-beta 1');
    expect(body).toContain('macOS: 14.5.0 (23F79)');
  });

  it('URL-encodes the body', () => {
    const raw = feedbackMailtoUrl('0.7.0 beta', '14.5.0 test');
    expect(raw).toContain('body=%0A%0A---%0AApp%20version%3A%200.7.0%20beta%0AmacOS%3A%2014.5.0%20test');
  });
});
