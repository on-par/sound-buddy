import { describe, it, expect } from 'vitest';
import { captureGuideUrl } from './capture-guide';

describe('captureGuideUrl', () => {
  it('resolves to an https URL at /record-your-service on soundbuddy.online by default', () => {
    const url = captureGuideUrl({});
    expect(url).toMatch(/^https:\/\//);
    expect(url).toBe('https://soundbuddy.online/record-your-service');
  });

  it('honours the SOUND_BUDDY_GUIDE_URL override', () => {
    const env = { SOUND_BUDDY_GUIDE_URL: 'https://staging.example/guide' };
    expect(captureGuideUrl(env)).toBe('https://staging.example/guide');
  });

  it('ignores a blank/whitespace override and falls back to the default', () => {
    const defaultUrl = captureGuideUrl({});
    expect(captureGuideUrl({ SOUND_BUDDY_GUIDE_URL: '   ' })).toBe(defaultUrl);
  });
});
