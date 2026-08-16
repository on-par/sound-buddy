import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze } from './e2e-helpers';

// The 3 utility dialogs ported to React in TD-001 slice 6f (#704): feedback,
// grade-own-guide, and phase/doubling checklist. None had e2e coverage before
// that slice (confirmed by grepping app/tests/e2e/*.spec.ts for their ids) —
// this spec is the named gate for each new component's backdrop-click/
// Escape-key close useEffect c8-ignore comment. The skill-tree onboarding
// dialog (#382) was added to this same gate rather than getting its own
// file, since it's IPC-push-opened (no in-page trigger) like the others.
// Onboarding's equivalent coverage already exists at
// app/tests/onboarding.spec.ts.

let electronApp: ElectronApplication;
let window: Page;
const fixturePath = () => path.join(__dirname, '..', 'fixtures', 'silence.wav');

test.describe('Utility dialogs (#704)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await window.locator('.mode-tab[data-mode="reportcard"]').click();
    await loadAndAnalyze(window, fixturePath());
    await expect(window.locator('#rc-content')).toBeVisible();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('feedback dialog opens from the toolbar and closes via Cancel', async () => {
    await window.locator('#reportcard-feedback-btn').click();
    await expect(window.locator('#feedback-dialog')).toBeVisible();

    await window.locator('#feedback-dialog-cancel').click();
    await expect(window.locator('#feedback-dialog')).toBeHidden();
  });

  test('grade-own guide dialog opens from the toolbar and closes via Close', async () => {
    await window.locator('#grade-own-btn').click();
    await expect(window.locator('#guide-dialog')).toBeVisible();

    await window.locator('#guide-dialog-close').click();
    await expect(window.locator('#guide-dialog')).toBeHidden();
  });

  test('phase-doubling dialog opens from the report card, steps forward/back, and closes via Done', async () => {
    await window.locator('#rc-phase-doubling-btn').click();
    await expect(window.locator('#phase-doubling-dialog')).toBeVisible();
    await expect(window.locator('#phase-doubling-back')).toBeDisabled();

    await window.locator('#phase-doubling-next').click();
    await expect(window.locator('#phase-doubling-back')).toBeEnabled();

    await window.locator('#phase-doubling-back').click();
    await expect(window.locator('#phase-doubling-back')).toBeDisabled();
    await expect(window.locator('#phase-doubling-dialog')).toBeVisible();

    await window.locator('#phase-doubling-close').click();
    await expect(window.locator('#phase-doubling-dialog')).toBeHidden();
  });

  // Named gate for SkillTreeDialog.tsx's Escape/backdrop-click close useEffect
  // c8-ignore comments (#382). The dialog has no in-page trigger — Help ▸
  // "Skill Tree…" pushes the renderer open over 'open-skill-tree-dialog', so
  // drive it the same way the menu does, matching the webContents.send push
  // pattern already used in report-card-basics.spec.ts / daw-shell.spec.ts.
  test('skill-tree dialog opens from the Help-menu push and closes via Escape and backdrop click', async () => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-skill-tree-dialog');
    });
    await expect(window.locator('#skill-tree-dialog')).toBeVisible();

    await window.keyboard.press('Escape');
    await expect(window.locator('#skill-tree-dialog')).toBeHidden();

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-skill-tree-dialog');
    });
    await expect(window.locator('#skill-tree-dialog')).toBeVisible();

    // Click the scrim, not the centered card, so it lands on the backdrop's
    // own onClick (target === currentTarget) rather than bubbling from a
    // child.
    await window.locator('#skill-tree-dialog').click({ position: { x: 5, y: 5 } });
    await expect(window.locator('#skill-tree-dialog')).toBeHidden();
  });
});
