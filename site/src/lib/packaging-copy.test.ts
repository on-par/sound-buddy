import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FREE_MONTHLY_UPLOADS,
  FREE_TIER_FEATURES,
  PRO_TIER_FEATURES,
  findGlobalPrivacyClaims,
} from './packaging-copy';
import { FAQ_ENTRIES, WAITLIST_FAQ_ENTRIES } from './faq';
import { resolveSiteMode } from './site-mode';

const indexAstroSource = readFileSync(fileURLToPath(new URL('../pages/index.astro', import.meta.url)), 'utf8');
const waitlistHomeSource = readFileSync(
  fileURLToPath(new URL('../components/WaitlistHome.astro', import.meta.url)),
  'utf8',
);
const layoutSource = readFileSync(fileURLToPath(new URL('../layouts/Layout.astro', import.meta.url)), 'utf8');

describe('findGlobalPrivacyClaims', () => {
  it('returns [] for clean, Pro-scoped or positive-account copy', () => {
    expect(findGlobalPrivacyClaims('Pro analysis runs on your Mac.')).toEqual([]);
    expect(findGlobalPrivacyClaims('Free account — sign in with your email')).toEqual([]);
  });

  it('flags "Your audio never leaves your machine"', () => {
    expect(findGlobalPrivacyClaims('Your audio never leaves your machine')).toEqual([
      'never leaves your machine',
    ]);
  });

  it('flags "No account required"', () => {
    expect(findGlobalPrivacyClaims('No account required')).toEqual(['No account']);
  });

  it('flags "No accounts."', () => {
    expect(findGlobalPrivacyClaims('No accounts.')).toEqual(['No accounts']);
  });

  it('flags "No cloud uploads"', () => {
    expect(findGlobalPrivacyClaims('No cloud uploads')).toEqual(['No cloud']);
  });

  it('flags "Local-only stereo"', () => {
    expect(findGlobalPrivacyClaims('Local-only stereo')).toEqual(['Local-only']);
  });

  it('flags "Local-first"', () => {
    expect(findGlobalPrivacyClaims('Local-first')).toEqual(['Local-first']);
  });

  it('flags "no sign-up"', () => {
    expect(findGlobalPrivacyClaims('no sign-up')).toEqual(['no sign-up']);
  });

  it('flags "fully on your own machine"', () => {
    expect(findGlobalPrivacyClaims('fully on your own machine')).toEqual(['fully on your own machine']);
  });

  it('is case-insensitive', () => {
    expect(findGlobalPrivacyClaims('YOUR AUDIO NEVER LEAVES YOUR MACHINE')).toEqual([
      'YOUR AUDIO NEVER LEAVES YOUR MACHINE'.match(/never leaves your machine/i)![0],
    ]);
  });

  it('returns several matches, in pattern order, for text with several banned phrases', () => {
    const text = 'No cloud uploads. Local-first. Your audio never leaves your machine.';
    expect(findGlobalPrivacyClaims(text)).toEqual(['never leaves your machine', 'No cloud', 'Local-first']);
  });
});

describe('AC1: Free tier', () => {
  it('caps Free at 5 uploads a month', () => {
    expect(FREE_MONTHLY_UPLOADS).toBe(5);
  });

  it('FREE_TIER_FEATURES mentions account and the upload cap', () => {
    const joined = FREE_TIER_FEATURES.join(' ');
    expect(joined).toContain('account');
    expect(joined).toContain('5 uploads a month');
  });

  it('index.astro spreads FREE_TIER_FEATURES into the Free tier and its CTA points to BROWSER_URL', () => {
    expect(indexAstroSource).toContain('features: [...FREE_TIER_FEATURES]');
    expect(indexAstroSource).toMatch(/name: 'Free'[\s\S]*?ctaHref: BROWSER_URL/);
  });

  it('the FAQ free-tier entry mentions account and the upload cap', () => {
    const entry = FAQ_ENTRIES.find((e) => e.id === 'free-tier');
    expect(entry).toBeDefined();
    const text = entry!.answer.join(' ');
    expect(text).toContain('account');
    expect(text).toContain('5');
  });
});

describe('AC2: Pro tier', () => {
  it('PRO_TIER_FEATURES mentions Mac, live, EQ and channel', () => {
    const joined = PRO_TIER_FEATURES.join(' ');
    expect(joined).toMatch(/Mac/);
    expect(joined).toMatch(/live/i);
    expect(joined).toMatch(/EQ/);
    expect(joined).toMatch(/channel/i);
  });

  it('keeps the locked "Unlimited recordings. Stored on your machine." line', () => {
    expect(PRO_TIER_FEATURES).toContain('Unlimited recordings. Stored on your machine.');
  });

  it('has no global privacy claim hits', () => {
    expect(findGlobalPrivacyClaims(PRO_TIER_FEATURES.join(' '))).toEqual([]);
  });

  it('index.astro spreads PRO_TIER_FEATURES into the Pro Monthly tier', () => {
    expect(indexAstroSource).toContain('features: [...PRO_TIER_FEATURES]');
  });
});

describe('AC3: no global privacy claims on any landing/FAQ surface', () => {
  it('index.astro is clean', () => {
    expect(findGlobalPrivacyClaims(indexAstroSource)).toEqual([]);
  });

  it('WaitlistHome.astro is clean', () => {
    expect(findGlobalPrivacyClaims(waitlistHomeSource)).toEqual([]);
  });

  it('Layout.astro is clean', () => {
    expect(findGlobalPrivacyClaims(layoutSource)).toEqual([]);
  });

  it('every FAQ_ENTRIES question and answer paragraph is clean', () => {
    for (const entry of FAQ_ENTRIES) {
      expect(findGlobalPrivacyClaims(entry.question)).toEqual([]);
      for (const paragraph of entry.answer) {
        expect(findGlobalPrivacyClaims(paragraph)).toEqual([]);
      }
    }
  });

  it('every WAITLIST_FAQ_ENTRIES question and answer paragraph is clean', () => {
    for (const entry of WAITLIST_FAQ_ENTRIES) {
      expect(findGlobalPrivacyClaims(entry.question)).toEqual([]);
      for (const paragraph of entry.answer) {
        expect(findGlobalPrivacyClaims(paragraph)).toEqual([]);
      }
    }
  });

  it('index.astro no longer has the privacy callout section', () => {
    expect(indexAstroSource).not.toContain('class="section privacy"');
  });
});

describe('AC4: waitlist mode still works', () => {
  it('WaitlistHome.astro still contains data-waitlist-form', () => {
    expect(waitlistHomeSource).toContain('data-waitlist-form');
  });

  it('resolveSiteMode({}) is still "waitlist" — the PR does not flip the default', () => {
    expect(resolveSiteMode({})).toBe('waitlist');
  });
});
