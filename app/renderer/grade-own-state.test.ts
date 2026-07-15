import { describe, it, expect } from 'vitest';

// grade-own-state is a plain classic script (window.gradeOwnState in the
// browser, module.exports under Node) so the pure path/CTA logic is
// exercised without a DOM, mirroring phase-doubling-state.test.ts.
interface CapturePath {
  id: string;
  title: string;
  body: string;
  cta: { label: string; action: string };
}

const { CAPTURE_PATHS, pathsHtml, ctaAction } = require('./grade-own-state.js') as {
  CAPTURE_PATHS: CapturePath[];
  pathsHtml: (escapeHtml: (s: unknown) => string, paths?: CapturePath[]) => string;
  ctaAction: (pathId: unknown) => 'open-guide' | 'choose-file' | null;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

describe('CAPTURE_PATHS integrity', () => {
  it('has exactly 3 paths: usb, daw, livestream', () => {
    expect(CAPTURE_PATHS).toHaveLength(3);
    expect(CAPTURE_PATHS.map((p) => p.id)).toEqual(['usb', 'daw', 'livestream']);
  });

  it('every path has a non-empty title, body, and cta label', () => {
    CAPTURE_PATHS.forEach((p) => {
      expect(p.title).toBeTruthy();
      expect(p.body).toBeTruthy();
      expect(p.cta.label).toBeTruthy();
    });
  });

  it('usb and daw CTAs open the guide; livestream CTA chooses a file', () => {
    const byId = Object.fromEntries(CAPTURE_PATHS.map((p) => [p.id, p]));
    expect(byId.usb.cta.action).toBe('open-guide');
    expect(byId.daw.cta.action).toBe('open-guide');
    expect(byId.livestream.cta.action).toBe('choose-file');
  });

  it('the livestream path copy tells the user Sound Buddy extracts the audio itself', () => {
    const livestream = CAPTURE_PATHS.find((p) => p.id === 'livestream')!;
    expect(livestream.body.toLowerCase()).toContain('extract');
  });
});

describe('pathsHtml', () => {
  it('renders a numbered card for every path with its id, title, and CTA label/action', () => {
    const html = pathsHtml(escapeHtml);
    CAPTURE_PATHS.forEach((p, i) => {
      expect(html).toContain(`data-guide-path="${p.id}"`);
      expect(html).toContain(p.title);
      expect(html).toContain(p.cta.label);
      expect(html).toContain(`class="guide-item-num">${i + 1}<`);
    });
  });

  it('keeps the existing .guide-item / .guide-item-num / .guide-item-text classes so current CSS applies', () => {
    const html = pathsHtml(escapeHtml);
    expect(html).toContain('class="guide-item"');
    expect(html).toContain('class="guide-item-num"');
    expect(html).toContain('class="guide-item-text"');
  });

  it('renders a CTA button per card with the guide-item-cta class and data-guide-path', () => {
    const html = pathsHtml(escapeHtml);
    const buttons = html.match(/<button[^>]*class="btn btn-secondary sm guide-item-cta"[^>]*>/g) || [];
    expect(buttons).toHaveLength(3);
  });

  it('routes title/body/cta label through the injected escapeHtml', () => {
    const sentinelEscape = (s: unknown) => `⟦${String(s)}⟧`;
    const html = pathsHtml(sentinelEscape);
    CAPTURE_PATHS.forEach((p) => {
      expect(html).toContain(`⟦${p.title}⟧`);
      expect(html).toContain(`⟦${p.body}⟧`);
      expect(html).toContain(`⟦${p.cta.label}⟧`);
    });
  });

  it('escapes unsafe characters in a custom path list', () => {
    const evilPaths: CapturePath[] = [
      { id: 'evil', title: '<script>alert(1)</script>', body: 'body & <b>bold</b>', cta: { label: '<x>', action: 'open-guide' } },
    ];
    const html = pathsHtml(escapeHtml, evilPaths);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('body &amp; &lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&lt;x&gt;');
  });

  it('defaults to CAPTURE_PATHS when no paths list is given', () => {
    expect(pathsHtml(escapeHtml)).toBe(pathsHtml(escapeHtml, CAPTURE_PATHS));
  });
});

describe('ctaAction', () => {
  it('maps usb and daw to open-guide', () => {
    expect(ctaAction('usb')).toBe('open-guide');
    expect(ctaAction('daw')).toBe('open-guide');
  });

  it('maps livestream to choose-file', () => {
    expect(ctaAction('livestream')).toBe('choose-file');
  });

  it('returns null for an unknown path id', () => {
    expect(ctaAction('nope')).toBeNull();
    expect(ctaAction(undefined)).toBeNull();
    expect(ctaAction(null)).toBeNull();
  });
});
