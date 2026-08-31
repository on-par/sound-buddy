import { test, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// The loop brace (#1313): a ruler affordance whose left/right edges must stay
// pixel-aligned with the 0s and 10s ruler ticks (the default seeded loop range)
// through both a horizontal scroll and a zoom-in — proving the brace and the ruler
// share the exact same geometry (dawPlayheadX) at any pan/zoom. #1314 wired the brace
// to the Session toolbar's Loop button: it is absent until Loop is switched on, and a
// second test below proves the range survives a toggle-off/on. IPC-stubbed only (no
// sox/ffprobe/python, no packaged .app), so this spec is NOT added to MEDIA_SPECS.

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');
const ALIGNMENT_TOLERANCE_PX = 1;

async function assertBraceAligned(brace: Locator, ticks: Locator): Promise<void> {
  const braceBox = (await brace.boundingBox())!;
  const tick0Box = (await ticks.nth(0).boundingBox())!;
  const tick2Box = (await ticks.nth(2).boundingBox())!;
  expect(Math.abs(braceBox.x - tick0Box.x)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  expect(Math.abs((braceBox.x + braceBox.width) - tick2Box.x)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
}

test.describe('Loop brace ruler alignment (#1313)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: { bucketsPerSecond: 50, tracks: [] } }));
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
    }, SESSION_DIR);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    await expect(window.locator('#daw-session-play')).toBeEnabled();
  });

  test('the brace and its handles are visible and aligned with the 0s/10s ruler ticks across scroll and zoom', async () => {
    const brace = window.locator('.daw-loop-brace');
    await window.locator('#daw-session-loop').click();
    await expect(brace).toBeVisible();
    await expect(brace.locator('.daw-loop-handle-start')).toHaveCount(1);
    await expect(brace.locator('.daw-loop-handle-end')).toHaveCount(1);

    const ticks = window.locator('.daw-ruler .daw-ruler-tick');
    await assertBraceAligned(brace, ticks);

    const shell = window.locator('.daw-shell');
    await window.locator('.daw-lane-column').hover();
    await window.mouse.wheel(240, 0);
    await expect.poll(() => shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim()))
      .not.toBe('0px');
    await assertBraceAligned(brace, ticks);

    // #daw-zoom-in boots disabled (the zoom model starts pinned at the min-span bound
    // with no session duration to fit yet — see playback-transport.spec.ts's #1291
    // test) — zoom out first via a ctrl-wheel gesture so the click has somewhere to go.
    await window.locator('.daw-timeline').dispatchEvent('wheel', { deltaX: 0, deltaY: 240, ctrlKey: true, bubbles: true });
    await expect(window.locator('#daw-zoom-in')).toBeEnabled();
    await window.locator('#daw-zoom-in').click();
    await assertBraceAligned(brace, ticks);
  });

  test('#1314: toggling Loop off removes the brace and toggling it back on restores the same range', async () => {
    const brace = window.locator('.daw-loop-brace');
    const ticks = window.locator('.daw-ruler .daw-ruler-tick');

    await window.locator('#daw-session-loop').click();
    await expect(brace).toHaveCount(1);

    await window.locator('#daw-session-loop').click();
    await expect(window.locator('.daw-loop-brace')).toHaveCount(0);

    await window.locator('#daw-session-loop').click();
    await expect(brace).toBeVisible();
    await assertBraceAligned(brace, ticks);
  });
});
