import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({ args: [MAIN] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#header')).toBeVisible();
}

test.describe.serial('macOS titlebar safe area (#362)', () => {
  test.afterEach(async () => {
    await app?.close();
  });

  test('header and top banners share the same left inset', async () => {
    await launch();

    const paddings = await win.evaluate(() => {
      const ids = ['header', 'update-banner', 'license-banner', 'trial-banner'];
      for (const id of ids.slice(1)) {
        document.getElementById(id)?.classList.add('show');
      }

      return Object.fromEntries(
        ids.map((id) => {
          const node = document.getElementById(id);
          return [id, node ? getComputedStyle(node).paddingLeft : null];
        }),
      );
    });

    expect(paddings.header).toBeTruthy();
    expect(paddings['update-banner']).toBe(paddings.header);
    expect(paddings['license-banner']).toBe(paddings.header);
    expect(paddings['trial-banner']).toBe(paddings.header);
  });
});
