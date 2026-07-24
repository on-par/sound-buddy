import { describe, expect, it } from 'vitest';
import {
  EMBED_BODY,
  EMBED_HEADING,
  DEMO_VIDEO_EYEBROW,
  PLACEHOLDER_BODY,
  PLACEHOLDER_HEADING,
  VIMEO_EMBED_BASE,
  YOUTUBE_EMBED_BASE,
  demoVideoState,
  demoVideoUrl,
  vimeoVideoId,
  youtubeVideoId,
} from './demo-video';

describe('demoVideoUrl', () => {
  it('returns undefined for an unset env', () => {
    expect(demoVideoUrl({})).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(demoVideoUrl({ PUBLIC_DEMO_VIDEO_URL: '' })).toBeUndefined();
  });

  it('returns undefined for a whitespace-only value', () => {
    expect(demoVideoUrl({ PUBLIC_DEMO_VIDEO_URL: '   ' })).toBeUndefined();
  });

  it('returns the trimmed value when set', () => {
    expect(demoVideoUrl({ PUBLIC_DEMO_VIDEO_URL: '  https://cdn.example.com/demo.mp4  ' })).toBe(
      'https://cdn.example.com/demo.mp4',
    );
  });
});

describe('youtubeVideoId', () => {
  it('extracts the id from a watch?v= URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a youtu.be short URL', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from an /embed/ URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from a /shorts/ URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(youtubeVideoId('https://vimeo.com/123456789')).toBeNull();
  });

  it('returns null for a non-URL string', () => {
    expect(youtubeVideoId('not a url')).toBeNull();
  });

  it('returns null when the watch URL has no v param', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch')).toBeNull();
  });

  it('returns null for a youtu.be URL with an empty path', () => {
    expect(youtubeVideoId('https://youtu.be/')).toBeNull();
  });

  it('returns null for an /embed/ URL with no id segment', () => {
    expect(youtubeVideoId('https://www.youtube.com/embed/')).toBeNull();
  });
});

describe('vimeoVideoId', () => {
  it('extracts the numeric id from a vimeo URL', () => {
    expect(vimeoVideoId('https://vimeo.com/123456789')).toBe('123456789');
  });

  it('returns null for a non-numeric first path segment', () => {
    expect(vimeoVideoId('https://vimeo.com/channels/staff')).toBeNull();
  });

  it('returns null for a non-Vimeo URL', () => {
    expect(vimeoVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null for a non-URL string', () => {
    expect(vimeoVideoId('not a url')).toBeNull();
  });
});

describe('demoVideoState', () => {
  it('returns placeholder when the env var is unset', () => {
    expect(demoVideoState({})).toEqual({ mode: 'placeholder' });
  });

  it('returns placeholder when the env var is empty', () => {
    expect(demoVideoState({ PUBLIC_DEMO_VIDEO_URL: '' })).toEqual({ mode: 'placeholder' });
  });

  it('returns an iframe embed for a YouTube URL', () => {
    expect(demoVideoState({ PUBLIC_DEMO_VIDEO_URL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toEqual({
      mode: 'iframe',
      embedUrl: `${YOUTUBE_EMBED_BASE}dQw4w9WgXcQ`,
    });
  });

  it('returns the same embed for a youtu.be URL', () => {
    expect(demoVideoState({ PUBLIC_DEMO_VIDEO_URL: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({
      mode: 'iframe',
      embedUrl: `${YOUTUBE_EMBED_BASE}dQw4w9WgXcQ`,
    });
  });

  it('returns an iframe embed for a Vimeo URL', () => {
    expect(demoVideoState({ PUBLIC_DEMO_VIDEO_URL: 'https://vimeo.com/123456789' })).toEqual({
      mode: 'iframe',
      embedUrl: `${VIMEO_EMBED_BASE}123456789`,
    });
  });

  it('returns a file state for a direct video URL', () => {
    expect(demoVideoState({ PUBLIC_DEMO_VIDEO_URL: 'https://cdn.example.com/demo.mp4' })).toEqual({
      mode: 'file',
      src: 'https://cdn.example.com/demo.mp4',
    });
  });
});

describe('copy constants', () => {
  it('match the issue-specified wording', () => {
    expect(DEMO_VIDEO_EYEBROW).toBe('See it in action');
    expect(PLACEHOLDER_HEADING).toBe('Demo video coming soon');
    expect(PLACEHOLDER_BODY).toBe(
      "We're recording a walkthrough of Sound Buddy grading a real Sunday service. Join the waitlist and we'll send it to you first.",
    );
    expect(EMBED_HEADING).toBe('Watch Sound Buddy grade a real Sunday service');
    expect(EMBED_BODY).toBe('This is the actual report card workflow, on an unedited recording.');
  });
});
