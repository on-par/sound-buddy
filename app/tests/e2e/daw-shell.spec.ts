import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// DAW playback + waveform rendering (TD-001 slice 6j, #713): with the
// experimental DAW workspace toggle (#516) on, the Live tab's center pane
// renders the timeline shell whose playhead/waveform canvases are now painted
// by daw-shell-runtime.ts (installed onto window.dawShellRuntime by App.tsx)
// instead of inline-app.js. This is the waveform-render-timing-sensitive
// surface the issue calls out, and the e2e justification for
// LiveCapturePanel's rAF playhead-ticker hook's c8-ignore (no jsdom in the
// unit-test harness — see daw-shell-runtime.test.ts for the painter/scheduling
// unit coverage this spec doesn't re-derive).

let electronApp: ElectronApplication | undefined;
let window: Page;

async function enableDawWorkspace(win: Page): Promise<void> {
  await win.locator('#settings-btn').click();
  await win.locator('#settings-tab-btn-labs').click();
  await win.locator('#daw-workspace-toggle').check();
  await win.locator('#settings-dialog-done').click();
  await expect(win.locator('#settings-dialog')).toBeHidden();
}

// Full-height min/max pairs (level 0 -> -1, level 255 -> +1, ADR-0004
// quantization) so the drawn stroke always crosses the canvas's vertical
// midpoint, regardless of how many buckets/columns land in a lane.
function fullHeightPeaks(buckets: number): string {
  const levels: number[] = [];
  for (let i = 0; i < buckets; i++) levels.push(0, 255);
  return Buffer.from(levels).toString('base64');
}

async function sendPeaks(lanes: Array<{ id: string; data: string }>): Promise<void> {
  if (!electronApp) throw new Error('Electron app was not launched');
  await electronApp.evaluate(({ BrowserWindow }, ls) => {
    BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'peaks', ts: 1, lanes: ls });
  }, lanes);
}

async function canvasPaintedAtMidpoint(win: Page, selector: string): Promise<boolean> {
  return win.locator(selector).evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, Math.floor(canvas.height / 2), 1, 1);
    return data[3] > 0; // alpha channel — non-zero means a stroke was drawn here
  });
}

test.describe('DAW shell playback + waveform rendering (#713)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    await enableDawWorkspace(window);
  });

  test('the shell renders the mix waveform, transport readout, playhead, and one lane per configured strip', async () => {
    await expect(window.locator('.daw-shell')).toBeVisible();
    await expect(window.locator('.daw-mix-waveform')).toBeVisible();
    await expect(window.locator('.daw-transport-time')).toHaveText('0:00');
    await expect(window.locator('.daw-playhead')).toBeVisible();
    // The fake device boots with the 2-strip device default (#188).
    await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
  });

  test('starting a capture advances the transport time and moves the playhead', async () => {
    await window.locator('#record-button').click();
    await expect(window.locator('.daw-transport-time')).not.toHaveText('0:00', { timeout: 5000 });

    const firstTransform = await window.locator('.daw-playhead').evaluate((el) => (el as HTMLElement).style.transform);
    await expect(async () => {
      const transform = await window.locator('.daw-playhead').evaluate((el) => (el as HTMLElement).style.transform);
      expect(transform).not.toBe(firstTransform);
    }).toPass({ timeout: 3000 });

    await window.locator('#record-button').click(); // stop -> monitoring resumes (#776)
  });

  test('pushed peaks frames paint the mix and per-channel waveform canvases', async () => {
    const bucket = fullHeightPeaks(4);
    await sendPeaks([
      { id: 'mix', data: bucket },
      { id: 'strip0', data: bucket },
    ]);

    await expect(async () => {
      expect(await canvasPaintedAtMidpoint(window, '.daw-mix-waveform')).toBe(true);
    }).toPass({ timeout: 3000 });

    await expect(async () => {
      expect(await canvasPaintedAtMidpoint(window, '.daw-channel-lane[data-ch="0"] .daw-channel-waveform')).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('stopping a capture freezes the transport time', async () => {
    await window.locator('#record-button').click();
    await expect(window.locator('.daw-transport-time')).not.toHaveText('0:00', { timeout: 5000 });

    await window.locator('#record-button').click(); // stop -> monitoring resumes (#776)
    const frozen = await window.locator('.daw-transport-time').textContent();
    // Stable across a poll window — a still-running ticker would keep advancing it.
    await window.waitForTimeout(300);
    await expect(window.locator('.daw-transport-time')).toHaveText(frozen ?? '');
  });
});
