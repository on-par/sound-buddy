import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('renders all live checkout links and only shipped features', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const outDir = 'dist-live-render-test';
  try {
    execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build', '--outDir', outDir], {
      cwd: root,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PUBLIC_'))),
      stdio: 'pipe',
    });
    const html = readFileSync(`${root}/${outDir}/index.html`, 'utf8');
    expect(html).toMatch(/<a\b[^>]*href="https:\/\/buy\.stripe\.com\/eVq28refH1f46VadbYawo00"[^>]*>\s*Become a Founding Member/);
    expect(html).toMatch(/<a\b[^>]*href="https:\/\/buy\.stripe\.com\/28EcN52wZ2j86Vab3Qawo02"[^>]*>\s*Buy Pro Monthly/);
    expect(html).toMatch(/<a\b[^>]*href="https:\/\/buy\.stripe\.com\/8x24gz6Nfe1Q1AQdbYawo01"[^>]*>\s*Buy Pro Annual/);
    expect(html).not.toMatch(/multitrack|8 to 32 channels|32-channel capture|per-strip stems|virtual soundcheck|AI analyst|channel groups|\brigs\b/i);
  } finally {
    rmSync(`${root}/${outDir}`, { recursive: true, force: true });
  }
}, 60000);
