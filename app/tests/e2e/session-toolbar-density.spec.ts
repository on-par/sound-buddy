// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// Session toolbar density (#1347): the transport row groups its ~dozen
// controls into named, non-wrapping clusters so it wraps only at group
// boundaries and stays legible at ordinary desktop widths. IPC-stubbed only
// (no sox/ffprobe/python, no packaged .app), so this spec is NOT added to
// MEDIA_SPECS — mirrors app/tests/e2e/loopBrace.alignment.spec.ts.

let electronApp: ElectronApplication;
let window: Page;

const DESKTOP_WIDTH = 1440;
const COMPACT_WIDTH = 1100;
const MAX_ROWS_DESKTOP = 2;
const MAX_ROWS_COMPACT = 3;
const ROW_EPSILON_PX = 2;
const OVERFLOW_EPSILON_PX = 0.5;

async function resizeTo(width: number): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, w) => {
    BrowserWindow.getAllWindows()[0].setSize(w, 900);
  }, width);
  await window.waitForFunction((w) => window.innerWidth <= w, width);
}

test.describe('Session toolbar density and grouping (#1347)', () => {
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
    await expect(window.locator('.daw-transport')).toBeVisible();
  });

  for (const [width, maxRows] of [[DESKTOP_WIDTH, MAX_ROWS_DESKTOP], [COMPACT_WIDTH, MAX_ROWS_COMPACT]] as const) {
    test(`the transport stays within ${maxRows} wrapped rows, keeps groups cohesive, avoids overflow, and names every control at ${width}px`, async () => {
      await resizeTo(width);

      const rowCount = await window.locator('.daw-transport').evaluate((transport, epsilon) => {
        const tops = Array.from(transport.children)
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.getBoundingClientRect().top);
        const rows: number[] = [];
        for (const top of tops) {
          if (!rows.some((r) => Math.abs(r - top) <= epsilon)) rows.push(top);
        }
        return rows.length;
      }, ROW_EPSILON_PX);
      expect(rowCount).toBeLessThanOrEqual(maxRows);

      // Direct children only: a group's own flex-wrap:nowrap already forbids its
      // *items* from splitting across lines; recursing into every nested node would
      // also flag an icon's ordinary vertical centering inside its own button as a
      // "split", which is not what group cohesion means here.
      const groupsCohesive = await window.locator('.daw-transport').evaluate((transport, epsilon) => {
        const groups = Array.from(transport.querySelectorAll('.daw-transport-group'));
        return groups.every((group) => {
          const groupTop = group.getBoundingClientRect().top;
          const children = Array.from(group.children)
            .filter((el) => (el as HTMLElement).offsetParent !== null);
          return children.every((el) => Math.abs(el.getBoundingClientRect().top - groupTop) <= epsilon);
        });
      }, ROW_EPSILON_PX);
      expect(groupsCohesive).toBe(true);

      const noOverflow = await window.locator('.daw-transport').evaluate((transport, epsilon) => {
        return transport.scrollWidth <= transport.clientWidth + epsilon;
      }, OVERFLOW_EPSILON_PX);
      expect(noOverflow).toBe(true);

      // The dual aria-label+title requirement targets icon-only BUTTONS (the
      // #1347 commands: Play/Stop/Loop/Loop Selection/Return, Sel/Back) — the
      // pre-existing BPM <input> and session <select> are untouched by this
      // story and rely on their own associated <label>/aria-label, with no
      // visible text of their own by construction.
      const accessibleNamesOk = await window.locator('.daw-transport').evaluate((transport) => {
        const controls = Array.from(transport.querySelectorAll('button, select, input'))
          .filter((el) => (el as HTMLElement).offsetParent !== null);
        return controls.every((el) => {
          const ariaLabel = el.getAttribute('aria-label');
          const title = el.getAttribute('title');
          const labelText = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : undefined;
          const associatedLabel = el.closest('label')?.textContent?.trim();
          const text = (el.textContent ?? '').trim();
          const accessibleName = ariaLabel ?? title ?? labelText ?? associatedLabel ?? text;
          if (!accessibleName) return false;
          if (el.tagName === 'BUTTON' && text === '') return ariaLabel !== null && title !== null && ariaLabel === title;
          return true;
        });
      });
      expect(accessibleNamesOk).toBe(true);
    });
  }
});
