import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';

const MAIN = path.join(__dirname, '..', 'dist', 'electron', 'main.js');

const DESKTOP_WIDTH = 1200;
const COMPACT_WIDTH = 900;
const EPSILON_PX = 0.5;

const ACTION_BUTTON_IDS = [
  'reportcard-clear-btn',
  'reportcard-load-btn',
  'reportcard-feedback-btn',
  'reportcard-share-btn',
  'reportcard-print-btn',
  'grade-own-btn',
];

let app: ElectronApplication;
let win: Page;

async function launch(): Promise<void> {
  app = await electron.launch({ args: [MAIN] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#rc-toolbar')).toBeVisible();
}

async function resizeTo(width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    BrowserWindow.getAllWindows()[0].setSize(w, 760);
  }, width);
  await win.waitForFunction((w) => window.innerWidth <= w, width);
}

// reportcard-load-btn is only shown by the app itself once a live-capture
// card is on screen (ReportCardToolbar.tsx renders style={{display:
// view.loadVisible ? '' : 'none'}}, driven by report-card-chrome.ts's
// reportCardChromeView(analysisStore state)) — this test forces it visible
// directly to check the toolbar's worst-case (all 6 actions shown) layout
// without spinning up a real live session. Boot triggers a handful of
// one-time async store settles (settings hydration, device enumeration)
// that can re-render ReportCardToolbar and reset the inline override back
// to `display:none` before this test gets to use it — reapply right before
// each consumer rather than trusting a single override to survive the whole
// test.
async function forceLoadBtnVisible(): Promise<void> {
  await win.evaluate(() => {
    (document.getElementById('reportcard-load-btn') as HTMLElement).style.display = '';
  });
}

test.describe.serial('report-card toolbar overflow (#478)', () => {
  test.afterEach(async () => {
    await app?.close();
  });

  for (const width of [DESKTOP_WIDTH, COMPACT_WIDTH]) {
    test(`all toolbar actions stay within the panel at ${width}px`, async () => {
      await launch();

      await forceLoadBtnVisible();

      await resizeTo(width);

      const overflow = await win.evaluate((epsilon) => {
        const viewRect = document.getElementById('reportcard-view')!.getBoundingClientRect();
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('#rc-toolbar .rc-toolbar-actions button'),
        ).filter((btn) => btn.offsetParent !== null);

        return buttons.every((btn) => {
          const rect = btn.getBoundingClientRect();
          return rect.right <= viewRect.right + epsilon && rect.left >= viewRect.left - epsilon;
        });
      }, EPSILON_PX);

      expect(overflow).toBe(true);

      await forceLoadBtnVisible();
      for (const id of ACTION_BUTTON_IDS) {
        const visible = await win.evaluate(
          (buttonId) => document.getElementById(buttonId)?.offsetParent !== null,
          id,
        );
        expect(visible, `#${id} should be visible`).toBe(true);
      }

      // Scoped to the report-card panel itself, not the whole app shell: the
      // header's tab bar has its own (pre-existing, out-of-scope-for-#478)
      // overflow at compact widths, unrelated to the rc-toolbar wrap fix.
      const noHorizontalScroll = await win.evaluate((epsilon) => {
        const view = document.getElementById('reportcard-view')!;
        const toolbar = document.getElementById('rc-toolbar')!;
        return (
          view.scrollWidth <= view.clientWidth + epsilon &&
          toolbar.scrollWidth <= toolbar.clientWidth + epsilon
        );
      }, EPSILON_PX);
      expect(noHorizontalScroll).toBe(true);

      await forceLoadBtnVisible();
      for (const id of ACTION_BUTTON_IDS) {
        const isDisabled = await win.evaluate(
          (buttonId) => (document.getElementById(buttonId) as HTMLButtonElement)?.disabled,
          id,
        );
        if (isDisabled) continue;

        await win.locator('#' + id).focus();
        const focusedId = await win.evaluate(() => document.activeElement?.id);
        expect(focusedId).toBe(id);
      }
    });
  }
});
