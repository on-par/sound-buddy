import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// The Analyze tab's entry point, driven end to end (#1480, updated for
// #1485's inverted default and #1646's unconditional one). #1646: Analyze
// always lands on Live — on the configured room mic, or the system default
// input when none is configured — in both Simple and Advanced mode; there is
// no entry dialog and no bounce to Settings > Audio any more (see
// analyze-live-default.spec.ts for the dedicated Live-default lock). No nav
// click may ever open the native file dialog by itself; file load stays
// available as an explicit second action (the live-EQ island's "Load file…"
// and File-mode dropzone, the Report Card toolbar's load button) that tears
// an active listen down first. This is the named e2e gate ModeTabs.tsx's
// handleClick c8-ignore points at.
//
// Fully IPC-stubbed (start-measurement/stop-measurement here, everything
// else via e2e-helpers' launchApp defaults) — deliberately NOT added to
// playwright.config.ts's MEDIA_SPECS, so it still runs under
// SB_E2E_STUBBED_ONLY=1 CI.
//
// #1590 adds the Session → Analyze → Live round trip below, covering the
// ADR-0141/#1498 isolation between Session's docked LiveEqPane and Analyze's
// live-EQ island after #1595/#1598 changed the shared Analyze entry code.

// Mirrors EQ_PANE_MIN_W (app/renderer/src/live-capture-panel.ts) — the
// docked LiveEqPane never renders narrower than this.
const EQ_PANE_MIN_WIDTH_PX = 260;

async function stubMeasurementIpc(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('start-measurement');
    ipcMain.handle('start-measurement', () => ({ success: true, micAccess: 'granted' }));
    ipcMain.removeHandler('stop-measurement');
    ipcMain.handle('stop-measurement', () => ({ success: true }));
  });
}

// #1524: records every start-measurement payload and every stop-measurement
// call into a globalThis array so a test can assert the stop-before-start
// restart order when switching channels.
type MeasurementCallLog = ({ kind: 'start'; channel?: number } | { kind: 'stop' })[];

async function stubMeasurementIpcWithLog(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls = [];
    ipcMain.removeHandler('start-measurement');
    ipcMain.handle('start-measurement', (_event, opts: { channel?: number }) => {
      (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls.push({
        kind: 'start',
        channel: opts?.channel,
      });
      return { success: true, micAccess: 'granted' };
    });
    ipcMain.removeHandler('stop-measurement');
    ipcMain.handle('stop-measurement', () => {
      (globalThis as unknown as { __measurementCalls: MeasurementCallLog }).__measurementCalls.push({ kind: 'stop' });
      return { success: true };
    });
  });
}

async function measurementCalls(electronApp: ElectronApplication): Promise<MeasurementCallLog> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __measurementCalls?: MeasurementCallLog }).__measurementCalls ?? [],
  );
}

// Tracks open-file-dialog invocations so a test can assert the native picker
// was (or was not) reached, without racing a real dialog.showOpenDialog call.
async function stubOpenFileDialogTracked(electronApp: ElectronApplication, result: string | null): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, r) => {
    ipcMain.removeHandler('open-file-dialog');
    (globalThis as unknown as { __openFileDialogCalls: number }).__openFileDialogCalls = 0;
    ipcMain.handle('open-file-dialog', () => {
      (globalThis as unknown as { __openFileDialogCalls: number }).__openFileDialogCalls += 1;
      return r;
    });
  }, result);
}

async function openFileDialogCallCount(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __openFileDialogCalls?: number }).__openFileDialogCalls ?? 0
  );
}

// #1606: pins the two ADR-0141 surface nodes on globalThis so a later check
// can prove the exact same DOM objects are still in place (never re-parented
// or re-created) after a Session <-> Analyze round trip.
async function captureSurfaceNodes(window: Page): Promise<void> {
  await window.evaluate(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    const pane = document.getElementById('live-eq-pane');
    const island = document.getElementById('analyze-live-island');
    g.__sbSessionPane = pane;
    g.__sbSessionPaneParent = pane?.parentElement ?? null;
    g.__sbAnalyzeIsland = island;
    g.__sbAnalyzeIslandParent = island?.parentElement ?? null;
  });
}

interface SurfaceIsolation {
  paneSameNode: boolean; paneSameParent: boolean;
  islandSameNode: boolean; islandSameParent: boolean;
  islandParentId: string | null;
  paneCount: number; islandCount: number;
  paneContainsIsland: boolean; islandContainsPane: boolean;
  islandHasSessionMarkup: boolean;
}

async function surfaceIsolation(window: Page): Promise<SurfaceIsolation> {
  return window.evaluate(() => {
    const g = globalThis as unknown as Record<string, Element | null>;
    const pane = document.getElementById('live-eq-pane');
    const island = document.getElementById('analyze-live-island');
    return {
      paneSameNode: pane !== null && pane === g.__sbSessionPane,
      paneSameParent: pane?.parentElement === g.__sbSessionPaneParent,
      islandSameNode: island !== null && island === g.__sbAnalyzeIsland,
      islandSameParent: island?.parentElement === g.__sbAnalyzeIslandParent,
      islandParentId: island?.parentElement?.id ?? null,
      paneCount: document.querySelectorAll('#live-eq-pane').length,
      islandCount: document.querySelectorAll('#analyze-live-island').length,
      paneContainsIsland: !!(pane && island && pane.contains(island)),
      islandContainsPane: !!(pane && island && island.contains(pane)),
      islandHasSessionMarkup: !!island?.querySelector('#live-eq-pane-body, .eq-pane-inspector'),
    };
  });
}

// `.eq-pane-inspector` is the Session-pane-only class already used by
// AnalyzeLiveEqPanel.test.ts:117.
const ISOLATED: SurfaceIsolation = {
  paneSameNode: true, paneSameParent: true, islandSameNode: true, islandSameParent: true,
  islandParentId: 'spectrum-body', paneCount: 1, islandCount: 1,
  paneContainsIsland: false, islandContainsPane: false, islandHasSessionMarkup: false,
};

// #1640: Session DAW chrome as rendered on the Session tab, captured before an
// Analyze Live trip and compared after returning, so Analyze Live routing can
// never leave Session's transport/shell changed. Only fields that are static
// while idle (no capture running). `shellParentId` reads 'live-island' via
// closest(), not parentElement.id directly — .daw-shell is dangerouslySetInnerHTML
// two wrapper divs deep inside #live-island (div.live-board-root >
// div.live-board-shell > .daw-shell, see LiveCapturePanel.tsx:1325 and
// live-workspace-view.ts:999), so its direct parentElement never carries an id.
interface DawChromeSnapshot {
  shellCount: number; shellParentId: string | null; shellVisible: boolean;
  recordPresent: boolean; recordDisabled: boolean | null; recordLabel: string | null;
  bpmValue: string | null; transportTime: string | null;
  liveIslandInsideAnalyzeIsland: boolean; analyzeIslandInsideLiveIsland: boolean;
}

async function dawChromeSnapshot(window: Page): Promise<DawChromeSnapshot> {
  return window.evaluate(() => {
    const shells = document.querySelectorAll('.daw-shell');
    const shell = shells[0] ?? null;
    const rec = document.getElementById('daw-session-record');
    const bpm = document.getElementById('daw-session-bpm') as HTMLInputElement | null;
    const transport = document.querySelector('.daw-transport-time');
    const liveIsland = document.getElementById('live-island');
    const analyzeIsland = document.getElementById('analyze-live-island');
    return {
      shellCount: shells.length,
      shellParentId: shell && shell.closest('#live-island') ? 'live-island' : null,
      shellVisible: !!shell && shell.getClientRects().length > 0,
      recordPresent: !!rec,
      recordDisabled: rec ? (rec as HTMLButtonElement).disabled : null,
      recordLabel: rec ? (rec.getAttribute('aria-label') ?? rec.textContent ?? '').trim() : null,
      bpmValue: bpm?.value ?? null,
      transportTime: transport?.textContent ?? null,
      liveIslandInsideAnalyzeIsland: !!(liveIsland && analyzeIsland && analyzeIsland.contains(liveIsland)),
      analyzeIslandInsideLiveIsland: !!(liveIsland && analyzeIsland && liveIsland.contains(analyzeIsland)),
    };
  });
}

test.describe('Analyze tab entry point (#1485), Advanced features on', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await stubMeasurementIpc(electronApp);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC (#1646): no room mic configured — the Analyze tab lands on Live on the system default input, no dialog, no Settings, no file picker', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);

    expect(await openFileDialogCallCount(electronApp)).toBe(0);
  });

  test('AC: room mic selected — goes straight to the live-EQ view, no dialog, no file picker (AC1)', async () => {
    await stubOpenFileDialogTracked(electronApp, null);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);

    // #1496 AC1/AC2: the room-mic EQ is the primary stage — the 260px source
    // panel and the 640px report-card column fold away, so on the 1200px
    // default window the island spans nearly the whole workspace starting at
    // its left edge. Before #1496 it got ~520px (~43%) beside a 640px card.
    await expect(window.locator('#source-panel')).toBeHidden();
    await expect(window.locator('#reportcard-view')).toBeHidden();
    const bodyWidth = await window.evaluate(() => document.body.clientWidth);
    const island = await window.locator('#analyze-live-island').boundingBox();
    expect(island).not.toBeNull();
    expect(island!.width).toBeGreaterThanOrEqual(bodyWidth * 0.75);
    expect(island!.x).toBeLessThanOrEqual(40);

    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    // AC2: Load file… tears the live listen down before the picker opens.
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#analyze-live-eq-choose-file').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();

    // #1487: the grade/pills/recommendations fold directly into Analyze
    // chrome — the file-derived result must still be visible here, without
    // switching to the separate Report Card tab (which stays folded away).
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);
    await expect(window.locator('#reportcard-view')).toBeHidden();
    await expect(window.locator('.analyze-results-rail')).toBeVisible();
    await expect(window.locator('#arc-ring')).toBeVisible();
    await expect(window.locator('#arc-rec-type')).toBeVisible();

    // Switching to another workspace tab closes the Analyze stage.
    await window.locator('.mode-tab[data-mode="console"]').click();
    await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);
  });

  // AC (#1522): Live ↔ File toggle keeps each mode's result — same result
  // shape, no cross-corruption. Live and File are equal-footing modes of one
  // Analyze tab; toggling between them must never clear or overwrite the
  // other mode's result (the bug this issue fixes: a file grade used to
  // permanently shadow a later live listen).
  //
  // Steps 5/6 of the spec plan (emitting a `measurement-event` window so the
  // rail shows a live-derived grade) are intentionally not driven here — the
  // window shape (LiveEvent ticks feeding secondaryWindows/
  // lastMeasurementChannels via liveCaptureStore.bindMeasurementEvents) isn't
  // exercised by any existing e2e spec, and hand-rolling it risks a flaky,
  // hard-to-maintain fixture. AC1 (Live mode reads liveSource only, even with
  // a file analysis present) is already covered directly and thoroughly by
  // analyze-results.test.ts and AnalyzeResultsPanel.test.ts. This e2e instead
  // covers the toggle's own behavior end to end: the File toggle never opens
  // the native picker, the dropzone renders and can trigger a real analysis,
  // switching to Live shows the listening empty state (never the file
  // grade), and switching back to File recovers the exact same file grade.
  test('AC (#1522): Live/File toggle switches mode without opening the file dialog, and File keeps its grade after a Live round trip', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();

    const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#analyze-mode-file').click();
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-file-dropzone')).toBeVisible();
    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await window.locator('#analyze-file-dropzone').click();
    await expect(window.locator('#arc-ring')).toBeVisible();
    await expect(window.locator('#arc-rec-type')).toBeVisible();
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    const fileGrade = await window.locator('#arc-ring').innerText();

    await window.locator('#analyze-mode-live').click();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('#arc-empty')).toBeVisible();
    await expect(window.locator('#arc-empty')).toContainText('Listening');
    await expect(window.locator('#arc-ring')).toBeHidden();

    await window.locator('#analyze-mode-file').click();
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
    await expect(window.locator('#arc-ring')).toBeVisible();
    expect(await window.locator('#arc-ring').innerText()).toBe(fileGrade);
  });

  // AC (#1524): the single-select channel picker. list-devices (stubbed by
  // launchApp) always reports "Fake 8ch Interface" (8 channels), so choosing
  // it as the room-mic device is enough to make the picker appear.
  test('AC (#1524): channel picker lets a Pro user switch which input Analyze listens to', async () => {
    await stubMeasurementIpcWithLog(electronApp);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();

    const picker = window.locator('#analyze-listen-channel');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveCount(8);
    expect(await picker.getAttribute('multiple')).toBeNull();

    await picker.selectOption('2');
    await expect(async () => {
      const calls = await measurementCalls(electronApp);
      expect(calls.slice(-2)).toEqual([{ kind: 'stop' }, { kind: 'start', channel: 2 }]);
    }).toPass();

    await picker.selectOption('5');
    await expect(async () => {
      const calls = await measurementCalls(electronApp);
      expect(calls.slice(-2)).toEqual([{ kind: 'stop' }, { kind: 'start', channel: 5 }]);
    }).toPass();
  });

  // AC (#1637): a configured room mic must start the Analyze live listen
  // right from the toggle (no Settings detour), and the room RTA must paint
  // from the very first meter tick — it must not wait for a window tick
  // (secondaryWindows, DEFAULT_WINDOW_SECS-cadenced), which is what the
  // pre-fix panel's render subscription was keyed on.
  const ROOM_RTA_GRID_LEN = 48;
  const ROOM_CH = {
    index: 0, name: 'Room', rms: -30, peak: -12, clipping: false, centroid: 1000, rolloff: 0,
    bands: { sub_bass: -40, bass: -34, low_mid: -28, mid: -24, high_mid: -32, presence: -44, brilliance: -60 },
    curve: new Array(ROOM_RTA_GRID_LEN).fill(-30),
  };

  test('AC (#1637): with a room mic configured, the Live toggle starts listening on Analyze (no Settings) and the RTA paints from the first meter tick', async () => {
    await stubMeasurementIpc(electronApp);

    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#secondary-measurement-device').selectOption('0');
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await window.locator('#analyze-live-eq-stop').click();
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');

    await window.locator('#analyze-mode-live').click();

    await expect(window.locator('#settings-dialog')).toBeHidden();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);

    await electronApp.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0].webContents.send('measurement-event', { type: 'meter', ts: 0, channels: [ch] });
    }, ROOM_CH);

    await expect(window.locator('#analyze-live-island .eq-pane-primary')).toContainText('Room —');
    await expect(window.locator('#live-eq-pane')).toBeHidden();
  });
});

// #1590: Session → Analyze → Live round trip. The appMode/routing work in
// #1595 (enterAnalyzeFromTab) and #1598 (resumePendingListen) touched the
// Analyze entry code Session shares, so this drives the whole path in the
// real DOM: Session's docked #live-eq-pane (LiveEqPane.tsx, shown only while
// appMode === 'live') and Analyze's #analyze-live-island (AnalyzeLiveEqPanel,
// shown only under body.analyze-listening) must never be on screen together
// (ADR-0141). `listening` is read through DOM that renders strictly from it:
// #analyze-mode-live's aria-pressed (analyzeModeOf) and #analyze-live-eq-stop.
// #1606 adds node-identity/no-re-parenting assertions (surfaceIsolation) and
// an appMode proxy (ModeTabs' `.mode-tab[data-mode="live"]` .active class,
// which renders strictly from appMode — ModeTabs.tsx:83 — plus
// body.live-active) at every step of this round trip.
test.describe('Session → Analyze → Live round trip (#1590)', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let sessionDawChrome: DawChromeSnapshot;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await stubMeasurementIpc(electronApp);
    await stubOpenFileDialogTracked(electronApp, null);
  });
  test.afterAll(async () => { await electronApp.close(); });

  test('AC: Session → Analyze → Live enters the Analyze live RTA with listening on', async () => {
    // Start on Session.
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    await expect(window.locator('#live-eq-pane')).toBeVisible();
    await expect(window.locator('#analyze-live-island')).toBeHidden();
    await captureSurfaceNodes(window);

    // #1640: snapshot Session's DAW chrome before the Analyze Live trip.
    await expect(window.locator('.daw-shell')).toBeVisible();
    sessionDawChrome = await dawChromeSnapshot(window);
    expect(sessionDawChrome.shellCount).toBe(1);
    expect(sessionDawChrome.shellParentId).toBe('live-island');
    expect(sessionDawChrome.recordPresent).toBe(true);

    // Analyze: no room mic configured → straight to Live on the system
    // default input (#1646), never a dialog or Settings.
    await window.locator('#nav-analyze').click();
    await expect(window.locator('#live-eq-pane')).toBeHidden(); // Session chrome cleared (#1595)
    await expect(window.locator('#settings-dialog')).toBeHidden();

    await expect(window.locator('body')).toHaveClass(/analyze-listening/);
    await expect(window.locator('#analyze-live-island')).toBeVisible();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('#live-eq-pane')).toBeHidden();
    expect(await openFileDialogCallCount(electronApp)).toBe(0);

    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();
  });

  test('AC: returning to Session re-hides the Analyze island and restores the docked LiveEqPane', async () => {
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    await expect(window.locator('.mode-tab[data-mode="live"]')).toHaveClass(/\bactive\b/);
    await expect(window.locator('body')).toHaveClass(/live-active/);
    await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);
    await expect(window.locator('#analyze-live-island')).toBeHidden();
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
    const pane = window.locator('#live-eq-pane');
    await expect(pane).toBeVisible();
    const box = await pane.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(EQ_PANE_MIN_WIDTH_PX);
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();

    // Repeat: the Analyze tab goes straight to the live RTA again, and
    // Session still takes the screen back afterwards.
    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-live-island')).toBeVisible();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(pane).toBeHidden();

    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#analyze-live-island')).toBeHidden();
    await expect(pane).toBeVisible();
    await expect(window.locator('.mode-tab[data-mode="live"]')).toHaveClass(/\bactive\b/);
    await expect(window.locator('body')).toHaveClass(/live-active/);
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();
  });

  test('AC (#1640): Session DAW chrome renders unchanged after the Analyze Live round trip', async () => {
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('body')).toHaveClass(/live-active/);
    await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);
    await expect(window.locator('.daw-shell')).toBeVisible();
    await expect(async () => {
      expect(await dawChromeSnapshot(window)).toEqual(sessionDawChrome);
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();
  });
});

// #1606: the #1590 describe above starts every journey on Session. This
// covers the Analyze-first journey instead — boot's default appMode is
// 'analyze' (#1510) — round-tripping Analyze → Session → Analyze → Live and
// back, so the ADR-0141 isolation guard is proven from both starting points.
test.describe('Analyze → Session → Analyze → Live journey (#1606)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await stubMeasurementIpc(electronApp);
    await stubOpenFileDialogTracked(electronApp, null);
  });
  test.afterAll(async () => { await electronApp.close(); });

  test('AC: Analyze-first journey never shows both surfaces and keeps node identity across every step', async () => {
    // 1. Boot lands on Analyze (default appMode) on Live (#1646). No room mic.
    await expect(window.locator('#nav-analyze')).toBeVisible();
    await captureSurfaceNodes(window);

    await window.locator('#nav-analyze').click();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#live-eq-pane')).toBeHidden();

    // 2. Session: the docked pane shows, the island stays hidden.
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    await expect(window.locator('#live-eq-pane')).toBeVisible();
    await expect(window.locator('#analyze-live-island')).toBeHidden();
    await expect(window.locator('body')).toHaveClass(/live-active/);
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();

    // 3. Analyze again: straight back to Live (#1646), no dialog, no Settings.
    await window.locator('#nav-analyze').click();
    await expect(window.locator('#live-eq-pane')).toBeHidden();
    await expect(window.locator('#settings-dialog')).toBeHidden();

    // 4. Live RTA with listening true.
    await expect(window.locator('body')).toHaveClass(/analyze-listening/);
    await expect(window.locator('#analyze-live-island')).toBeVisible();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
    await expect(window.locator('#live-eq-pane')).toBeHidden();
    await expect(window.locator('body')).not.toHaveClass(/live-active/);
    expect(await openFileDialogCallCount(electronApp)).toBe(0);
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();

    // 5. Return to Session.
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('.mode-tab[data-mode="live"]')).toHaveClass(/\bactive\b/);
    await expect(window.locator('body')).toHaveClass(/live-active/);
    await expect(window.locator('body')).not.toHaveClass(/analyze-listening/);
    await expect(window.locator('#analyze-live-island')).toBeHidden();
    await expect(window.locator('#analyze-live-eq-stop')).toBeHidden();
    const pane = window.locator('#live-eq-pane');
    await expect(pane).toBeVisible();
    const box = await pane.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(EQ_PANE_MIN_WIDTH_PX);
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();

    // 6. Session → Analyze: straight to the live RTA again.
    await window.locator('#nav-analyze').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await expect(window.locator('#analyze-live-island')).toBeVisible();
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(pane).toBeHidden();
    await expect(async () => {
      expect(await surfaceIsolation(window)).toEqual(ISOLATED);
    }).toPass();
  });
});

test.describe('Analyze tab entry point (#1485), Advanced features off (Simple mode)', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'silence.wav');

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_ADVANCED_FEATURES: '0' }));
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('AC: never opens the file chooser automatically; Live is the default and Load file… is the explicit file path (#1646)', async () => {
    await stubOpenFileDialogTracked(electronApp, fixturePath);

    await window.locator('#nav-analyze').click();

    expect(await openFileDialogCallCount(electronApp)).toBe(0);
    await expect(window.locator('#analyze-mode-live')).toHaveAttribute('aria-pressed', 'true');

    await window.locator('#analyze-live-eq-choose-file').click();

    await expect(window.locator('#rc-filename')).toHaveText('silence.wav');
    expect(await openFileDialogCallCount(electronApp)).toBe(1);
    await expect(window.locator('#analyze-mode-file')).toHaveAttribute('aria-pressed', 'true');
  });
});
