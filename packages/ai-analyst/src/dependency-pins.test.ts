import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for #403 (TD-009): dependencies must be pinned to exact
// versions, never "latest" — a floating spec breaks install reproducibility
// and can silently pull a breaking upstream release.
const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
) as {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

describe('ai-analyst dependency pins', () => {
  it('pins @anthropic-ai/sdk to an exact version', () => {
    expect(pkg.dependencies['@anthropic-ai/sdk']).toMatch(EXACT_VERSION);
  });

  it('declares no "latest" dependency specifiers', () => {
    const specs = Object.values({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    expect(specs).not.toContain('latest');
  });
});
