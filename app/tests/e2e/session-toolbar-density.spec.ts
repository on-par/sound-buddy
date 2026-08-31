import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// Session toolbar density + label clarity (#1347). The Session transport row
// packs transport readout, tempo, five zoom buttons, follow, track tools, the
// session picker, playback, record, and routing into one wrapping flex line.
// This spec loads a recorded session so the WHOLE control set is on screen
// (playback + picker only render with a take loaded), then asserts at a desktop
// and a compact width that:
//   1. no control spills outside the toolbar (no awkward horizontal sprawl),
//   2. every command exposes a non-empty accessible name (icons/compact labels
//      included) so keyboard/AT users still hear what each does, and
//   3. the zoom and playback clusters are exposed as named groups, which is the
//      scannability win the issue asks for.
// It reuses session-tab-playback.e2e.spec.ts's stubbed session-load path, so it
// runs under the tool-free CI e2e job (it is not in playwright.config's
// MEDIA_SPECS).

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');
const DESKTOP_WIDTH = 1200;
const COMPACT_WIDTH = 900;
const WINDOW_HEIGHT = 820;
const EPSILON_PX = 0.5;

async function resizeTo(width: number): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, [w, h]) => {
    BrowserWindow.getAllWindows()[0].setSize(w, h);
  }, [width, WINDOW_HEIGHT] as [number, number]);
  await window.waitForFunction((w) => window.innerWidth <= w, width);
}

test.describe('Session toolbar density (#1347)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    // Stub the session-load path so the picker's "open session folder…" resolves
    // to the checked-in fixture without a native dialog or real peak generation.
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
    // A loaded take enables playback — the signal the full toolbar is rendered.
    await expect(window.locator('#daw-session-play')).toBeEnabled();
  });

  for (const width of [DESKTOP_WIDTH, COMPACT_WIDTH]) {
    test(`every command stays in the toolbar and keeps an accessible name at ${width}px`, async () => {
      await resizeTo(width);

      // 1. No control spills past the transport row's own box, and the toolbar
      //    never drives a horizontal scrollbar — it wraps within its width.
      const contained = await window.evaluate((epsilon) => {
        const toolbar = document.querySelector<HTMLElement>('.daw-transport');
        if (!toolbar) return { ok: false, reason: 'no .daw-transport' };
        const bar = toolbar.getBoundingClientRect();
        const controls = Array.from(
          toolbar.querySelectorAll<HTMLElement>('button, select, input'),
        ).filter((el) => el.offsetParent !== null);
        for (const el of controls) {
          const r = el.getBoundingClientRect();
          if (r.right > bar.right + epsilon || r.left < bar.left - epsilon) {
            return { ok: false, reason: `${el.id || el.className} spills the toolbar` };
          }
        }
        const noScroll = toolbar.scrollWidth <= toolbar.clientWidth + epsilon;
        return { ok: noScroll, reason: noScroll ? '' : 'toolbar scrolls horizontally', count: controls.length };
      }, EPSILON_PX);
      expect(contained.ok, contained.reason).toBe(true);
      expect(contained.count ?? 0).toBeGreaterThan(0);

      // 2. Every interactive control exposes a non-empty accessible name.
      //    Compute it pragmatically: aria-label, then a wrapping/associated
      //    <label>, then title, then visible text. This is the "preserve
      //    keyboard/accessibility names for every command" acceptance criterion,
      //    and the guard on the newly-compacted zoom/playback labels.
      const nameless = await window.evaluate(() => {
        const toolbar = document.querySelector<HTMLElement>('.daw-transport')!;
        const controls = Array.from(
          toolbar.querySelectorAll<HTMLElement>('button, select, input'),
        ).filter((el) => el.offsetParent !== null);
        const accessibleName = (el: HTMLElement): string => {
          const aria = el.getAttribute('aria-label');
          if (aria && aria.trim()) return aria.trim();
          const wrapLabel = el.closest('label');
          if (wrapLabel && (wrapLabel.textContent ?? '').trim()) return (wrapLabel.textContent ?? '').trim();
          const id = el.id;
          if (id) {
            const forLabel = document.querySelector(`label[for="${id}"]`);
            if (forLabel && (forLabel.textContent ?? '').trim()) return (forLabel.textContent ?? '').trim();
          }
          const title = el.getAttribute('title');
          if (title && title.trim()) return title.trim();
          return (el.textContent ?? '').trim();
        };
        return controls
          .filter((el) => accessibleName(el) === '')
          .map((el) => el.id || el.className);
      });
      expect(nameless, `controls missing an accessible name: ${nameless.join(', ')}`).toEqual([]);

      // 3. The zoom and playback clusters are exposed as named groups — the
      //    scannability change. Their group labels ride with them at every width.
      await expect(window.locator('[role="group"][aria-label="Timeline zoom"]')).toBeVisible();
      await expect(window.locator('[role="group"][aria-label="Session playback"]')).toBeVisible();

      // The two relabelled, previously-cryptic commands keep their full
      // descriptive accessible names even though their visible text is compact.
      await expect(window.locator('#daw-zoom-selection')).toHaveAttribute('aria-label', 'Zoom to the selected time range');
      await expect(window.locator('#daw-session-return')).toHaveAttribute('aria-label', 'Return recorded session playback to start');
    });
  }
});
