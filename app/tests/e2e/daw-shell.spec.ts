import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// DAW playback + waveform rendering (TD-001 slice 6j, #713): the Live tab's
// center pane renders the timeline shell whose playhead/waveform canvases are now painted
// by daw-shell-runtime.ts (installed onto window.dawShellRuntime by App.tsx)
// instead of inline-app.js. This is the waveform-render-timing-sensitive
// surface the issue calls out, and the e2e justification for
// LiveCapturePanel's rAF playhead-ticker hook's c8-ignore (no jsdom in the
// unit-test harness — see daw-shell-runtime.test.ts for the painter/scheduling
// unit coverage this spec doesn't re-derive).

let electronApp: ElectronApplication | undefined;
let window: Page;

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
  });

  test('the shell renders the mix waveform, transport readout, playhead, and one lane per configured strip', async () => {
    await expect(window.locator('.daw-shell')).toBeVisible();
    await expect(window.locator('.daw-mix-waveform')).toHaveCount(0);
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await expect(window.locator('.daw-mix-waveform')).toBeVisible();
    await expect(window.locator('.daw-transport-time')).toHaveText('0:00');
    await expect(window.locator('.daw-playhead-ruler')).toBeVisible();
    await expect(window.locator('.daw-playhead-lanes')).toBeVisible();
    // The fake device boots with the 2-strip device default (#188).
    await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
    await window.locator('#daw-session-record').click(); // stop -> monitoring resumes (#776)
  });

  test('solo dims non-soloed lanes and clearing the final solo restores them (#1056)', async () => {
    const firstLane = window.locator('.daw-channel-lane[data-ch="0"]');
    const secondLane = window.locator('.daw-channel-lane[data-ch="1"]');
    const secondSolo = window.locator('.daw-track-head[data-ch="1"] .daw-track-head-solo');

    await secondSolo.click();
    await expect(secondLane).not.toHaveClass(/daw-channel-lane--dimmed/);
    await expect(firstLane).toHaveClass(/daw-channel-lane--dimmed/);

    await secondSolo.click();
    await expect(firstLane).not.toHaveClass(/daw-channel-lane--dimmed/);
    await expect(secondLane).not.toHaveClass(/daw-channel-lane--dimmed/);
  });

  test('a muted armed lane still writes its record stem (#1056)', async () => {
    const app = electronApp;
    if (!app) throw new Error('Electron app was not launched; unable to verify record stems');
    const sessionDir = await mkdtemp(join(tmpdir(), 'sound-buddy-daw-shell-'));
    try {
      await app.evaluate(({ ipcMain }, directory) => {
        // This callback is serialized into Electron's main process, so the
        // test-local fake loads its Node dependency inside that process.
        const fs = (process.mainModule?.require('node:fs') ?? process.getBuiltinModule('node:fs')) as {
          writeFileSync(path: string, data: string): void;
        };
        ipcMain.removeHandler('start-live');
        ipcMain.handle('start-live', (_event, opts: { mode?: string; arm?: string[] }) => {
          if (opts.mode === 'record') {
            for (const token of opts.arm ?? []) fs.writeFileSync(`${directory}/${token}.wav`, 'fake stem');
            (globalThis as Record<string, unknown>).__recordStart = opts;
          }
          return { success: true };
        });
        ipcMain.removeHandler('stop-live');
        ipcMain.handle('stop-live', () => ({ success: true, sessionDir: directory }));
      }, sessionDir);

      await window.locator('.daw-track-head[data-ch="0"] .daw-track-head-mute').click();
      await expect(window.locator('.daw-channel-lane[data-ch="0"]')).toHaveClass(/daw-channel-lane--dimmed/);
      await window.locator('#daw-session-record').click();
      await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
      await window.locator('#daw-session-record').click();
      await expect(window.locator('#daw-session-record')).toBeEnabled();

      const recordStart = (await app.evaluate(
        () => (globalThis as Record<string, unknown>).__recordStart,
      )) as { arm?: string[] };
      expect(recordStart.arm).toContain('0');
      await expect(readFile(join(sessionDir, '0.wav'), 'utf8')).resolves.toBe('fake stem');
    } finally {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('start-live');
        ipcMain.handle('start-live', () => ({ success: true }));
        ipcMain.removeHandler('stop-live');
        ipcMain.handle('stop-live', () => ({ success: true, sessionDir: '/tmp/sound-buddy-20260702-101500' }));
        delete (globalThis as Record<string, unknown>).__recordStart;
      });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test('starting a capture advances the transport time and moves the playhead', async () => {
    await window.locator('#daw-session-record').click();
    await expect(window.locator('.daw-transport-time')).not.toHaveText('0:00', { timeout: 5000 });

    const firstLeft = await window.locator('.daw-playhead-lanes').evaluate((el) => (el as HTMLElement).style.left);
    await expect(async () => {
      const left = await window.locator('.daw-playhead-lanes').evaluate((el) => (el as HTMLElement).style.left);
      expect(left).not.toBe(firstLeft);
    }).toPass({ timeout: 3000 });

    await window.locator('#daw-session-record').click(); // stop -> monitoring resumes (#776)
  });

  test('pushed peaks frames paint the mix and per-channel waveform canvases', async () => {
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');

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

    await window.locator('#daw-session-record').click(); // stop -> monitoring resumes (#776)
  });

  test('stopping a capture freezes the transport time', async () => {
    await window.locator('#daw-session-record').click();
    await expect(window.locator('.daw-transport-time')).not.toHaveText('0:00', { timeout: 5000 });

    await window.locator('#daw-session-record').click(); // stop -> monitoring resumes (#776)
    const frozen = await window.locator('.daw-transport-time').textContent();
    // Stable across a poll window — a still-running ticker would keep advancing it.
    await window.waitForTimeout(300);
    await expect(window.locator('.daw-transport-time')).toHaveText(frozen ?? '');
  });
});
