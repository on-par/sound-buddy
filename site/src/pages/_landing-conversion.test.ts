import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOUNDING_CAP } from '../lib/founding-urgency';

const indexSrc = readFileSync(fileURLToPath(new URL('./index.astro', import.meta.url)), 'utf8');

describe('Hero sells the church-audio buyer on the first win (#193 AC1)', () => {
  it('targets church FOH volunteers and worship engineers in the eyebrow', () => {
    expect(indexSrc).toContain('For church FOH volunteers');
    expect(indexSrc).toContain('worship engineers');
  });

  it('leads with the first-win headline', () => {
    expect(indexSrc).toContain("Get a clear answer from last Sunday's mix.");
  });

  it('states the promised first win in plain language', () => {
    expect(indexSrc).toContain('names exactly what to fix before next Sunday');
  });
});

describe('Real app proof shows three product surfaces, captioned (#193 AC2)', () => {
  it('imports all three product-surface screenshots', () => {
    expect(indexSrc).toContain("import liveCaptureScreenshot from '../assets/screenshots/live-capture.png'");
    expect(indexSrc).toContain("import reportCardShot from '../assets/screenshots/report-card.png'");
    expect(indexSrc).toContain("import momentumShot from '../assets/screenshots/momentum.png'");
  });

  it('renders a captioned proof section', () => {
    expect(indexSrc).toContain('id="proof"');
    expect(indexSrc).toContain('Real app proof');
    expect(indexSrc).toContain('This is a real workflow, not a single-card demo.');
  });

  it('wires live-capture and momentum screenshots into proofCards, and surfaces the report card', () => {
    expect(indexSrc).toContain('image: liveCaptureScreenshot');
    expect(indexSrc).toContain('image: momentumShot');
    expect(indexSrc).toContain('src={reportCardShot.src}');
  });

  it('captions the momentum/upgrade moment as the follow-up workflow', () => {
    expect(indexSrc).toContain('Virtual soundcheck, the follow-up');
  });
});

describe('Website-vs-app narrative break is explicit (#193 AC3)', () => {
  it('names the Browser Lite vs. desktop app comparison section', () => {
    expect(indexSrc).toContain('Browser Lite vs. desktop app');
    expect(indexSrc).toContain('A browser tool worth opening.');
  });

  it('splits the browser-side fast answer from the app-side deep workflow', () => {
    expect(indexSrc).toContain('Fast answer');
    expect(indexSrc).toContain('Deep rehearsal workflow');
  });
});

describe('CTA hierarchy is first-win primary + lower-commitment secondary (#193 AC4)', () => {
  it('pairs the hero primary CTA with a lower-commitment secondary CTA', () => {
    expect(indexSrc).toContain("Grade last Sunday's mix");
    expect(indexSrc).toContain('Try Browser Lite free');
  });

  it('repeats the first-win primary CTA in the header', () => {
    expect(indexSrc.match(/Grade last Sunday's mix/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('pairs the lower-page primary CTA with a lower-commitment secondary CTA', () => {
    expect(indexSrc).toContain("Grade this Sunday's mix");
    expect(indexSrc).toContain('See how it works');
  });
});

describe('No pricing change and dark/gold system preserved (#193 AC5)', () => {
  it('pins the four published price points unchanged', () => {
    expect(indexSrc).toContain("price: '$199'");
    expect(indexSrc).toContain("price: '$9'");
    expect(indexSrc).toContain("price: '$79'");
    expect(indexSrc).toContain("price: '$0'");
  });

  it('pins the founding cap at 300 licenses', () => {
    expect(FOUNDING_CAP).toBe(300);
    expect(indexSrc).toContain('300');
  });

  it('preserves the gold accent token', () => {
    expect(indexSrc).toContain('--gold-500');
  });
});
