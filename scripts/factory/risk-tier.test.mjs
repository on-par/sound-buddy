import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RISK_RULES, classifyRiskTier } from './risk-tier.mjs';

describe('classifyRiskTier', () => {
  it('denies by default: an empty path list is high', () => {
    expect(classifyRiskTier([])).toBe('high');
  });

  it('denies by default: a path matching no rule is high', () => {
    expect(classifyRiskTier(['some/totally/unknown/path.txt'])).toBe('high');
  });

  it('is low when every path matches a low rule', () => {
    expect(classifyRiskTier(['docs/adr/0144-foo.md', 'README.md'])).toBe('low');
  });

  it('is low for a test-only change', () => {
    expect(classifyRiskTier(['packages/shared/src/index.test.ts'])).toBe('low');
  });

  it('is low for renderer CSS UI polish', () => {
    expect(classifyRiskTier(['app/renderer/src/styles/theme.css'])).toBe('low');
  });

  it('is high when any single path matches a high rule, even alongside low paths', () => {
    expect(classifyRiskTier(['docs/README.md', 'package.json'])).toBe('high');
  });

  it('is high for package.json / package-lock.json changes (dependencies)', () => {
    expect(classifyRiskTier(['package.json'])).toBe('high');
    expect(classifyRiskTier(['app/package-lock.json'])).toBe('high');
  });

  it('is high for scene-inspector / console (mixer-console)', () => {
    expect(classifyRiskTier(['packages/scene-inspector/src/parse.ts'])).toBe('high');
    expect(classifyRiskTier(['packages/console/src/scene-capture.ts'])).toBe('high');
  });

  it('is high for audio-engine and live capture IPC (live-audio)', () => {
    expect(classifyRiskTier(['packages/audio-engine/src/spectrum.py'])).toBe('high');
    expect(classifyRiskTier(['app/electron/ipc/console-scene-capture.ts'])).toBe('high');
  });

  it('is high for release/packaging paths (release-packaging)', () => {
    expect(classifyRiskTier(['scripts/release.sh'])).toBe('high');
    expect(classifyRiskTier(['.github/workflows/release.yml'])).toBe('high');
    expect(classifyRiskTier(['app/build/afterPack.js'])).toBe('high');
  });

  it('is high for licensing and worker paths (licensing)', () => {
    expect(classifyRiskTier(['app/electron/license.ts'])).toBe('high');
    expect(classifyRiskTier(['worker/src/webhook.ts'])).toBe('high');
  });

  it('is high for the merge-aisle automation itself (factory-automation)', () => {
    expect(classifyRiskTier(['scripts/factory/merge-aisle.mjs'])).toBe('high');
  });

  it('rejects a non-array input as high', () => {
    expect(classifyRiskTier(undefined)).toBe('high');
  });
});

describe('RISK_RULES / README drift', () => {
  it('documents every rule id in scripts/factory/README.md', async () => {
    const readmePath = fileURLToPath(new URL('./README.md', import.meta.url));
    const readme = await readFile(readmePath, 'utf8');
    for (const rule of RISK_RULES) {
      expect(readme, `expected README.md to mention rule id "${rule.id}"`).toContain(rule.id);
    }
  });

  it('lists all high rules before all low rules', () => {
    const tiers = RISK_RULES.map((rule) => rule.tier);
    const firstLow = tiers.indexOf('low');
    const lastHigh = tiers.lastIndexOf('high');
    expect(firstLow).toBeGreaterThan(lastHigh);
  });
});
