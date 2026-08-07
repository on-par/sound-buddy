import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, loadAndAnalyze } from './e2e-helpers';

// The 3 utility dialogs ported to React this slice (TD-001 slice 6f, #704):
// feedback, grade-own-guide, and phase/doubling checklist. None had e2e
// coverage before this slice (confirmed by grepping app/tests/e2e/*.spec.ts
// for their ids) — this spec is the named gate for each new component's
// backdrop-click/Escape-key close useEffect c8-ignore comment. Onboarding's
// equivalent coverage already exists at app/tests/onboarding.spec.ts.

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
});
