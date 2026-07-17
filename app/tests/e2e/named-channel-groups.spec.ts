import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './e2e-helpers';

// Named channel groups (#41) — split out of e2e.spec.ts as its own file
// (#225). Own reload-driven beforeEach resets in-memory groups between tests,
// independent of the other Live-capture describes.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Named channel groups (#41)', () => {
  const CH = [
    { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
      bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
    { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
      bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
  ];

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  async function tick() {
    await electronApp.evaluate(({ BrowserWindow }, chs) => {
      BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
    }, CH);
  }
  async function makeGroup(name: string) {
    await window.locator('#live-ws-new-group').click();
    await window.locator('#rig-dialog-input').fill(name);
    await window.locator('#rig-dialog-ok').click();
  }

  test.beforeEach(async () => {
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.mode-tab[data-mode="live"]').click();
    // Groups now persist per-device across reloads (#483, mirroring #482's
    // channelLabels), so a plain reload no longer resets them the way it used
    // to (#41). Delete every leftover group through the UI so each test still
    // starts from a clean board.
    while (await window.locator('.live-group-del').count() > 0) {
      await window.locator('.live-group-del').first().click();
      await window.locator('#rig-dialog-ok').click();
    }
  });

  test('create a group, assign a strip, and it renders grouped in the live board', async () => {
    await makeGroup('Drums');
    await window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await tick();
    const board = window.locator('#spectrum-body .sb-live-meters');
    await expect(board.locator('.live-group-head')).toHaveCount(2); // Drums + Ungrouped
    await expect(board.locator('.live-group-head').first().locator('.live-group-name')).toHaveText('Drums');
    await expect(board.locator('.live-group-head.ungrouped .live-group-name')).toHaveText('Ungrouped');
    // The assigned strip (idx 0) sits before the Ungrouped header; idx 1 after.
    await expect(board.locator('.live-ch')).toHaveCount(2);
  });

  test('collapsing a group hides all its members entirely, leaving others alone (#483)', async () => {
    await makeGroup('Drums');
    await window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await tick();
    const header = window.locator('.live-group-head').first();
    await header.locator('.live-group-fold').click();

    await expect(header).toHaveClass(/collapsed/);
    await expect(header.locator('.live-group-fold')).toHaveAttribute('aria-expanded', 'false');
    await expect(header.locator('.live-group-summary')).toBeVisible();
    await expect(window.locator('#spectrum-body .live-ch[data-ch="0"]')).toHaveClass(/group-collapsed/);
    await expect(window.locator('#spectrum-body .live-ch[data-ch="0"]')).not.toBeVisible();
    // The other (ungrouped) strip is untouched — still visible, no group-collapsed class.
    await expect(window.locator('#spectrum-body .live-ch[data-ch="1"]')).toBeVisible();
    await expect(window.locator('#spectrum-body .live-ch[data-ch="1"]')).not.toHaveClass(/group-collapsed/);

    // Clicking again restores visibility.
    await header.locator('.live-group-fold').click();
    await expect(header).not.toHaveClass(/collapsed/);
    await expect(window.locator('#spectrum-body .live-ch[data-ch="0"]')).toBeVisible();
  });

  test('keyboard Arrow Up reorders groups, and the order persists across reload (#483)', async () => {
    await makeGroup('Drums');
    await makeGroup('Vox');
    await expect(window.locator('.live-group-name')).toHaveText(['Drums', 'Vox', 'Ungrouped']);

    await window.locator('.live-group-head').nth(1).locator('.live-group-drag').focus();
    await window.keyboard.press('ArrowUp');
    await expect(window.locator('.live-group-name')).toHaveText(['Vox', 'Drums', 'Ungrouped']);

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('.live-group-name')).toHaveText(['Vox', 'Drums', 'Ungrouped']);
  });

  test('keyboard Arrow Up reorders tracks within a group (#483)', async () => {
    await makeGroup('Drums');
    await window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await window.locator('#spectrum-body .live-ch').nth(1).locator('.live-ch-group').selectOption({ label: 'Drums' });
    const chOrder = () => window.locator('#spectrum-body .live-ch').evaluateAll((els) => els.map((el) => el.getAttribute('data-ch')));
    await expect.poll(chOrder).toEqual(['0', '1']);

    await window.locator('#spectrum-body .live-ch[data-ch="1"] .live-ch-drag').focus();
    await window.keyboard.press('ArrowUp');
    await expect.poll(chOrder).toEqual(['1', '0']);
  });

  test('removing a strip from config drops it from its group (no dangling ref)', async () => {
    await makeGroup('Drums');
    await window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await window.locator('#spectrum-body .live-ch').nth(1).locator('.live-ch-group').selectOption({ label: 'Drums' });
    await window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-x').click(); // remove strip 0
    // One strip remains; former strip 1 remapped to index 0 and is STILL in
    // Drums (value "0" = group index of Drums) — no dangling ref to strip 0.
    await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(1);
    await expect(window.locator('#spectrum-body .live-ch').nth(0).locator('.live-ch-group')).toHaveValue('0');
    // Live board (one channel now) renders the survivor under Drums, no Ungrouped.
    await electronApp.evaluate(({ BrowserWindow }, chs) => {
      BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
    }, [CH[0]]);
    const board = window.locator('#spectrum-body .sb-live-meters');
    await expect(board.locator('.live-ch')).toHaveCount(1);
    await expect(board.locator('.live-group-head.ungrouped')).toHaveCount(0);
  });
});
