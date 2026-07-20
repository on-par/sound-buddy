// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import appConfig, { UI_COVERAGE_EXCLUSIONS } from './vitest.config';
import rootConfig from '../vitest.config';

// Guards TD-007 (#401): the coverage floors must stay ratcheted to just under
// the measured actuals (not the old, loose 52/55/45/52 baseline), and the UI
// exclusion allowlist must stay a governed, tested list rather than a set of
// unaudited strings that can silently grow. See app/vitest.config.ts for the
// measurement/margin rule these floors were derived from.
const STATEMENTS_FLOOR = 94;
const BRANCHES_FLOOR = 88;
const FUNCTIONS_FLOOR = 91;
const LINES_FLOOR = 95;

const MIN_REASON_LENGTH = 30;

const EXPECTED_EXCLUSION_PATHS = [
  'renderer/src/main.tsx',
  'renderer/src/App.tsx',
  'renderer/src/inline-app.js',
  'renderer/src/mock-sound-buddy.ts',
];

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

describe('app/vitest.config.ts coverage thresholds', () => {
  it('is ratcheted at or above the measured-minus-margin floors', () => {
    const thresholds = appConfig.test?.coverage?.thresholds;
    expect(thresholds?.statements).toBeGreaterThanOrEqual(STATEMENTS_FLOOR);
    expect(thresholds?.branches).toBeGreaterThanOrEqual(BRANCHES_FLOOR);
    expect(thresholds?.functions).toBeGreaterThanOrEqual(FUNCTIONS_FLOOR);
    expect(thresholds?.lines).toBeGreaterThanOrEqual(LINES_FLOOR);
  });

  it('does not include the Playwright e2e suite in the Vitest run', () => {
    const include = appConfig.test?.include ?? [];
    expect(include.some((pattern) => pattern.includes('tests/'))).toBe(false);
  });
});

describe('UI_COVERAGE_EXCLUSIONS', () => {
  it('has not silently grown or shrunk', () => {
    expect(UI_COVERAGE_EXCLUSIONS.length).toBe(4);
    const paths = UI_COVERAGE_EXCLUSIONS.map((entry) => entry.path).sort();
    expect(paths).toEqual([...EXPECTED_EXCLUSION_PATHS].sort());
  });

  it('carries a real justification and an existing gate file for every entry', () => {
    for (const entry of UI_COVERAGE_EXCLUSIONS) {
      expect(entry.reason.length).toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
      const gatePath = path.join(appRoot, entry.gate);
      expect(fs.existsSync(gatePath), `gate file missing for ${entry.path}: ${entry.gate}`).toBe(
        true
      );
    }
  });

  it('is mirrored into the root config exclude list, re-rooted under app/', () => {
    const rootExclude = rootConfig.test?.coverage?.exclude ?? [];
    for (const entry of UI_COVERAGE_EXCLUSIONS) {
      expect(rootExclude).toContain(`app/${entry.path}`);
    }
  });
});
