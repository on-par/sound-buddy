import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch-electron';
import * as path from 'path';

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await launchElectron({ args: [MAIN] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#header')).toBeVisible();
}

test.describe.serial('macOS titlebar safe area (#362)', () => {
  test.afterEach(async () => {
    await app?.close();
  });

  test('header and remaining top banners share the same left inset', async () => {
    await launch();

    // #1650: the header's inset is split between #header's own symmetric
    // padding and #header-left's traffic-light clearance (so the center slot
    // is the window's middle) — measure where the header content actually
    // starts, the logo's left edge, against each banner's padding.
    const insets = await win.evaluate(() => {
      const ids = ['license-banner', 'trial-banner'];
      for (const id of ids) {
        document.getElementById(id)?.classList.add('show');
      }
      const logo = document.getElementById('logo');
      return {
        header: logo ? `${logo.getBoundingClientRect().left}px` : null,
        ...Object.fromEntries(
          ids.map((id) => {
            const node = document.getElementById(id);
            return [id, node ? getComputedStyle(node).paddingLeft : null];
          }),
        ),
      };
    });

    expect(insets.header).toBeTruthy();
    expect(insets['license-banner']).toBe(insets.header);
    expect(insets['trial-banner']).toBe(insets.header);
  });
});
