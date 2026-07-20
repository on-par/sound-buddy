import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUARANTEE_WINDOW_DAYS, REFUND_PATH } from './guarantee';
import { CORE_OBJECTION_IDS, FAQ_ENTRIES } from './faq';

const indexAstroPath = fileURLToPath(new URL('../pages/index.astro', import.meta.url));
const indexAstroSource = readFileSync(indexAstroPath, 'utf8');

function resolveHref(href: string) {
  if (href.startsWith('#')) return true;
  const pagePath = fileURLToPath(new URL(`../pages${href}.astro`, import.meta.url));
  return existsSync(pagePath);
}

describe('FAQ_ENTRIES', () => {
  it('has exactly 8 entries', () => {
    expect(FAQ_ENTRIES).toHaveLength(8);
  });

  it('every id is unique', () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a non-empty question ending in "?" and at least one non-empty answer paragraph', () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.question.endsWith('?')).toBe(true);
      expect(entry.answer.length).toBeGreaterThan(0);
      for (const paragraph of entry.answer) {
        expect(paragraph.length).toBeGreaterThan(0);
      }
    }
  });

  it('every link.href is an in-page anchor or a page that exists on disk', () => {
    for (const entry of FAQ_ENTRIES) {
      if (!entry.link) continue;
      expect(resolveHref(entry.link.href)).toBe(true);
    }
  });
});

describe('CORE_OBJECTION_IDS', () => {
  it('are the first three entries, in order', () => {
    expect(CORE_OBJECTION_IDS).toEqual(['privacy', 'unsigned-install', 'ai']);
    expect(FAQ_ENTRIES.slice(0, 3).map((e) => e.id)).toEqual([...CORE_OBJECTION_IDS]);
  });
});

describe('refund entry', () => {
  it("derives from GUARANTEE_WINDOW_DAYS and REFUND_PATH, so it can't drift", () => {
    const refund = FAQ_ENTRIES.find((e) => e.id === 'refund');
    expect(refund).toBeDefined();
    expect(refund!.answer.join(' ')).toContain(`${GUARANTEE_WINDOW_DAYS}-day`);
    expect(refund!.link?.href).toBe(REFUND_PATH);
  });
});

describe('unsigned-install entry', () => {
  it('mentions Gatekeeper and Open Anyway, and links to #install-walkthrough', () => {
    const entry = FAQ_ENTRIES.find((e) => e.id === 'unsigned-install');
    expect(entry).toBeDefined();
    const text = entry!.answer.join(' ');
    expect(text).toContain('Gatekeeper');
    expect(text).toContain('Open Anyway');
    expect(entry!.link?.href).toBe('#install-walkthrough');
  });
});

describe('ai entry', () => {
  it('mentions both Ollama and API key', () => {
    const entry = FAQ_ENTRIES.find((e) => e.id === 'ai');
    expect(entry).toBeDefined();
    const text = entry!.answer.join(' ');
    expect(text).toContain('Ollama');
    expect(text).toContain('API key');
  });
});

describe('index.astro anchors referenced by the FAQ', () => {
  it('#pricing, #faq, and #install-walkthrough exist in the source', () => {
    expect(indexAstroSource).toContain('id="pricing"');
    expect(indexAstroSource).toContain('id="faq"');
    expect(indexAstroSource).toContain('id="install-walkthrough"');
  });
});

describe('copy-drift guard', () => {
  it('index.astro imports FAQ content from the lib module instead of hardcoding it', () => {
    expect(indexAstroSource).toContain("from '../lib/faq'");
  });

  it('index.astro does not hardcode FAQ question copy', () => {
    expect(indexAstroSource).not.toContain("Is my church's audio really private?");
    expect(indexAstroSource).not.toContain('The app isn\'t signed by Apple. Is it safe to install?');
  });
});
