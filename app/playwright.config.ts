import { defineConfig } from '@playwright/test';

// Specs that launch the REAL app end-to-end (no IPC stubs) and therefore need
// real media tools (sox/ffprobe/python) or a packaged .app on the box. CI runs
// only the stubbed, tool-free specs (SB_E2E_STUBBED_ONLY=1) and skips these;
// they still run locally via scripts/verify.sh when the tools are present.
// onboarding.spec.ts drives the bundled demo.wav through the real analyze
// pipeline (electron/ipc/shared.ts), so it needs sox/ffprobe/python+numpy/scipy
// same as smoke/packaged — it is not IPC-stubbed despite living alongside the
// stubbed specs.
const MEDIA_SPECS = [
  '**/smoke.spec.ts',
  '**/packaged.spec.ts',
  '**/packaged-onboarding.spec.ts',
  '**/onboarding.spec.ts',
];

export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.SB_E2E_STUBBED_ONLY ? MEDIA_SPECS : [],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // Bounded workers on CI (constitution E2e Test Settings). Electron e2e is
  // stateful (each spec launches its own instance), so keep it single-worker.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
});
