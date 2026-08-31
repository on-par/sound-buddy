import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// #1294: the Session timeline scale test hook (window.__soundBuddyTimelineScale)
// gives an automated spec a deterministic, programmatic way to place the shared
// Session timeline scale into 'fit' / 'default' / 'zoomed-in' / 'zoomed-out' and
// read it back, without driving the #1284 toolbar zoom buttons. It is exposed only
// when the app is launched with SOUND_BUDDY_TEST_HOOKS=1 (mirroring the existing
// SOUND_BUDDY_DISABLE_ONBOARDING switch) — this spec proves both that the hook
// works when enabled AND that it is entirely absent on a normal launch. IPC-stubbed
// only (no sox/ffprobe/python, no packaged .app), so it is deliberately NOT added to
// playwright.config.ts's MEDIA_SPECS.

const TIMELINE_SCALE_STATES = ['fit', 'default', 'zoomed-in', 'zoomed-out'] as const;

interface TimelineScaleSnapshot {
  state: string;
  pxPerSecond: number;
  fit: { durationSecs: number; viewportWidthPx: number } | null;
}

declare global {
  interface Window {
    __soundBuddyTimelineScale?: {
      setState(state: string, fit?: { durationSecs: number; viewportWidthPx: number }): TimelineScaleSnapshot;
      getState(): TimelineScaleSnapshot;
      reset(): TimelineScaleSnapshot;
    };
  }
}

test.describe('Timeline scale test hook — enabled (#1294)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_TEST_HOOKS: '1' }));
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
  });

  test('setState followed by getState reports back the requested state for all four states', async () => {
    for (const state of TIMELINE_SCALE_STATES) {
      const fit = state === 'fit' ? { durationSecs: 120, viewportWidthPx: 960 } : undefined;
      await window.evaluate(
        ({ state, fit }) => window.__soundBuddyTimelineScale!.setState(state, fit),
        { state, fit },
      );
      const snapshot = await window.evaluate(() => window.__soundBuddyTimelineScale!.getState());
      expect(snapshot.state).toBe(state);
      expect(Number.isFinite(snapshot.pxPerSecond)).toBe(true);
      expect(snapshot.pxPerSecond).toBeGreaterThan(0);
    }
  });

  test('zoomed-in, default and zoomed-out resolve to distinguishable pixels-per-second, in that order', async () => {
    const pxPerSecondFor = async (state: string): Promise<number> => {
      const snapshot = await window.evaluate(
        (s) => window.__soundBuddyTimelineScale!.setState(s),
        state,
      );
      return snapshot.pxPerSecond;
    };

    const zoomedIn = await pxPerSecondFor('zoomed-in');
    const defaultScale = await pxPerSecondFor('default');
    const zoomedOut = await pxPerSecondFor('zoomed-out');

    expect(zoomedIn).toBeGreaterThan(defaultScale);
    expect(defaultScale).toBeGreaterThan(zoomedOut);
  });

  test('does not add a new end-user zoom control — the toolbar still has exactly the five #1284 zoom buttons', async () => {
    const zoomButtons = window.locator('.daw-zoom-btn');
    await expect(zoomButtons).toHaveCount(5);
    for (const id of ['daw-zoom-fit', 'daw-zoom-out', 'daw-zoom-in', 'daw-zoom-selection', 'daw-zoom-back']) {
      await expect(window.locator(`#${id}`)).toHaveCount(1);
    }
  });
});

test.describe('Timeline scale test hook — absent by default (#1294)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('a normal launch (no SOUND_BUDDY_TEST_HOOKS) never exposes the hook on window', async () => {
    await expect.poll(() => window.evaluate(() => '__soundBuddyTimelineScale' in window)).toBe(false);
  });
});
