import { describe, expect, it } from 'vitest';
import { buildReleaseNotes, INSTALL_INTRO, UNSIGNED_STEPS } from './install-instructions.js';

describe('buildReleaseNotes', () => {
  it('unsigned build includes the macOS 26 Privacy & Security flow and xattr fallback, not right-click', () => {
    const notes = buildReleaseNotes({ version: '0.4.2', signed: false });
    expect(notes).toContain('Privacy & Security');
    expect(notes).toContain('Open Anyway');
    expect(notes).toContain('xattr -dr com.apple.quarantine "/Applications/Sound Buddy.app"');
    expect(notes).not.toContain('right-click');
  });

  it('signed build omits the entire unsigned-workaround block', () => {
    const notes = buildReleaseNotes({ version: '0.4.2', signed: true });
    expect(notes).not.toContain('Open Anyway');
    expect(notes).not.toContain('Privacy & Security');
    expect(notes).not.toContain('right-click');
    expect(notes).not.toContain('xattr');
  });

  it('interpolates the version into the zip filename for both variants', () => {
    const unsigned = buildReleaseNotes({ version: '0.4.2', signed: false });
    const signed = buildReleaseNotes({ version: '0.4.2', signed: true });
    expect(unsigned).toContain('Sound.Buddy-0.4.2-arm64-mac.zip');
    expect(signed).toContain('Sound.Buddy-0.4.2-arm64-mac.zip');
    expect(unsigned).not.toContain('${version}');
    expect(signed).not.toContain('${version}');
  });

  it('preserves the Apple Silicon / macOS 26 requirements in both variants', () => {
    const unsigned = buildReleaseNotes({ version: '0.4.2', signed: false });
    const signed = buildReleaseNotes({ version: '0.4.2', signed: true });
    for (const notes of [unsigned, signed]) {
      expect(notes).toContain('Apple Silicon');
      expect(notes).toContain('macOS 26');
    }
  });

  it('exports non-empty shared copy constants free of the right-click phrasing', () => {
    expect(INSTALL_INTRO.length).toBeGreaterThan(0);
    expect(UNSIGNED_STEPS.length).toBeGreaterThan(0);
    expect(INSTALL_INTRO).not.toContain('right-click');
    expect(UNSIGNED_STEPS).not.toContain('right-click');
  });

  it('renders a What\'s new section above install steps when highlights are provided', () => {
    const notes = buildReleaseNotes({
      version: '0.9.0',
      signed: false,
      highlights: '- **Opt-in crash reporting** — off by default.',
    });
    expect(notes).toContain("## What's new in 0.9.0");
    expect(notes).toContain('- **Opt-in crash reporting** — off by default.');
    expect(notes.indexOf("## What's new in 0.9.0")).toBeLessThan(notes.indexOf('## Download & install'));
  });

  it('omits the What\'s new section when highlights are absent or empty', () => {
    const withoutHighlights = buildReleaseNotes({ version: '0.9.0', signed: false });
    const emptyHighlights = buildReleaseNotes({ version: '0.9.0', signed: false, highlights: '   ' });
    for (const notes of [withoutHighlights, emptyHighlights]) {
      expect(notes).not.toContain("What's new");
      expect(notes).toContain('## Download & install');
    }
  });
});
