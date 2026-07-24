import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, renameHeader } from './e2e-helpers';

// Live capture (PRD 06) — split out of e2e.spec.ts as its own file (#225).
// Covers the rail, channel picker, per-strip meters, and Record-mode capture
// flow. The "Workspace arm controls (#191)" and "Persistent track workspace
// (#188)" describes moved to live-capture-workspace.spec.ts: every test here
// shares one beforeEach that clicks #device-refresh-btn, which resets the
// workspace to its 2-strip device default before each test runs — so despite
// reading like a chain, each test (here and in the workspace file) starts
// from the same clean baseline and the two files are safe to run as separate
// Electron sessions.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Live capture (PRD 06)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.beforeEach(async () => {
    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(window.locator('#tab-live')).toHaveClass(/active/);
    // Re-enumerate against the stubbed 8-channel device (the boot-time scan
    // ran before the stub was installed).
    await window.locator('#device-refresh-btn').click();
    await expect(window.locator('#spectrum-body .live-ch')).toHaveCount(2);
  });

  // The rail's channel list/add/group/arm controls now live solely in the
  // workspace (#192) — the rail keeps only capture setup + transport.
  test('the left rail is slimmed to capture setup + transport', async () => {
    await expect(window.locator('#chcfg')).toHaveCount(0);
    await expect(window.locator('#arm-all-btn')).toHaveCount(0);
    await expect(window.locator('#rig-bar')).toBeVisible();
    await expect(window.locator('#device-select')).toBeVisible();
    await expect(window.locator('#live-mode')).toBeVisible();
    await expect(window.locator('#meter-interval')).toBeVisible();
    await expect(window.locator('#live-start-btn')).toBeVisible();
  });

  test('Monitor/Record toggle reveals the recording folder', async () => {
    const folderRow = window.locator('#record-folder-row');
    await expect(folderRow).toBeHidden();

    await window.locator('#live-mode button[data-mode="record"]').click();
    await expect(folderRow).toBeVisible();

    await window.locator('#live-mode button[data-mode="monitor"]').click();
    await expect(folderRow).toBeHidden();
  });

  test('channel picker adds up to the device channel count, with mono/stereo', async () => {
    const rows = window.locator('#spectrum-body .live-ch');
    await expect(rows).toHaveCount(2);
    await expect(window.locator('#live-ws-cap')).toHaveText('2 / 8 used');

    // Add a third mono strip.
    await window.locator('#live-ws-add').click();
    await expect(rows).toHaveCount(3);

    // Make the first strip stereo — a second channel select appears in the row.
    await rows.first().locator('.live-ch-kind').selectOption('stereo');
    await expect(rows.first().locator('.live-ch-src[data-field="b"]')).toBeVisible();
    await expect(window.locator('#live-ws-cap')).toHaveText('4 / 8 used');

    // Remove a strip.
    await rows.nth(2).locator('.live-ch-x').click();
    await expect(rows).toHaveCount(2);
  });

  // Two live channels with distinct spectral shapes: Vocals is mid-heavy,
  // Band is bass-heavy. Band keys are snake_case (LIVE_BAND_KEYS).
  const LIVE_CHANNELS = [
    { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
      bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
    { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
      bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
  ];

  // Live meter ticks arrive over the 'live-event' channel from the main
  // process; push one directly so the meters render without a real capture.
  async function sendLiveTick(channels: unknown) {
    await electronApp.evaluate(({ BrowserWindow }, chs) => {
      BrowserWindow.getAllWindows()[0].webContents.send('live-event', { type: 'meter', channels: chs });
    }, channels);
  }

  test('live channels render as vertical-bar EQs with the shared analyzer arc', async () => {
    await sendLiveTick(LIVE_CHANNELS);

    await expect(window.locator('#spectrum-title')).toHaveText('Spectrum · Live EQ');
    const channels = window.locator('.sb-live-meters .live-ch');
    await expect(channels).toHaveCount(2);
    await expect(channels.first().locator('.live-ch-name')).toHaveText('Vocals');
    await expect(channels.nth(1).locator('.live-ch-name')).toHaveText('Band');

    // 7 upright bars per channel, ordered low→high left→right.
    const bars = channels.first().locator('.veq-bar');
    await expect(bars).toHaveCount(7);
    await expect(bars.first()).toHaveAttribute('data-band', 'subBass');
    await expect(bars.last()).toHaveAttribute('data-band', 'brilliance');
    const lefts = await bars.evaluateAll(els => els.map(el => parseFloat((el as HTMLElement).style.left)));
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThan(lefts[i - 1]);

    // The arc is the same component as the whole-mix quality view
    // (spectrumCurveSVG → .sb-spectrum-curve), one per channel, and its SVG
    // carries the dB reference scale; band labels sit under the bars.
    await expect(window.locator('.live-ch .sb-spectrum-curve')).toHaveCount(2);
    await expect(channels.first().locator('.sb-y-label').first()).toBeAttached();
    await expect(channels.first().locator('.veq-label')).toHaveCount(7);
    await expect(channels.first().locator('.veq-label .veq-label-full').first()).toHaveText('Sub Bass');

    // All 7 labels sit on a single row (#666) — no alternating second row.
    const boxes = await channels.first().locator('.veq-label').evaluateAll(
      els => els.map(el => el.getBoundingClientRect().y));
    for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i] - boxes[0])).toBeLessThanOrEqual(1);
  });

  // Per-strip collapse / fold (#40).
  test('collapse a single strip hides its bands; others stay expanded', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    await window.locator('#live-expand-all').click(); // normalize from any prior test
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    const ch1 = window.locator('.live-ch[data-ch="1"]');
    await expect(ch0.locator('.veq')).toBeVisible();

    await ch0.locator('.live-ch-fold').click();
    await expect(ch0).toHaveClass(/collapsed/);
    await expect(ch0.locator('.veq')).toBeHidden();
    await expect(ch0.locator('.veq-labels')).toBeHidden();
    // The header summary (name + RMS/peak) stays visible when collapsed.
    await expect(ch0.locator('.live-ch-name')).toBeVisible();
    await expect(ch0.locator('.live-ch-meta')).toBeVisible();
    // The other strip is untouched.
    await expect(ch1).not.toHaveClass(/collapsed/);
    await expect(ch1.locator('.veq')).toBeVisible();

    await ch0.locator('.live-ch-fold').click(); // toggles back open
    await expect(ch0).not.toHaveClass(/collapsed/);
    await expect(ch0.locator('.veq')).toBeVisible();
  });

  test('Collapse all then expand one leaves the rest collapsed', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    await window.locator('#live-collapse-all').click();
    await expect(window.locator('.sb-live-meters .live-ch.collapsed')).toHaveCount(2);

    await window.locator('.live-ch[data-ch="0"] .live-ch-fold').click();
    await expect(window.locator('.live-ch[data-ch="0"]')).not.toHaveClass(/collapsed/);
    await expect(window.locator('.live-ch[data-ch="1"]')).toHaveClass(/collapsed/);

    await window.locator('#live-expand-all').click();
    await expect(window.locator('.sb-live-meters .live-ch.collapsed')).toHaveCount(0);
  });

  test('collapsed strip still reflects clipping, and stays collapsed across repaints', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    await window.locator('#live-expand-all').click();
    const ch0 = window.locator('.live-ch[data-ch="0"]');
    await ch0.locator('.live-ch-fold').click();
    await expect(ch0).toHaveClass(/collapsed/);

    // A new window reporting clipping on channel 0 must light the clip dot
    // without re-expanding the strip.
    const clipping = LIVE_CHANNELS.map((c, i) => (i === 0 ? { ...c, clipping: true } : c));
    await sendLiveTick(clipping);
    await expect(ch0.locator('.live-ch-name')).toHaveClass(/clip/);
    await expect(ch0.locator('.live-ch-clip')).toBeVisible();
    await expect(ch0).toHaveClass(/collapsed/);
    await expect(ch0.locator('.veq')).toBeHidden();
    // The CLIP badge appearing on a later tick must land in the same spot as
    // one present from the first tick — just before the remove control (#188).
    const headChildren = await ch0.locator('.live-ch-head > *').evaluateAll((els) => els.map((e) => e.className));
    expect(headChildren.indexOf('live-ch-clip')).toBeLessThan(headChildren.indexOf('live-ch-x'));

    // Several more repaints — still collapsed.
    await sendLiveTick(LIVE_CHANNELS);
    await sendLiveTick(LIVE_CHANNELS);
    await expect(ch0).toHaveClass(/collapsed/);
    await window.locator('#live-expand-all').click(); // leave clean for later tests
  });

  test('bar height tracks level; loudest band is emphasized; silent bands dim', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    // The persistent workspace (#188) already shows 7 idle-placeholder bars
    // before this tick lands, so a bare bar-count check wouldn't wait for the
    // real data — wait on the name (idle placeholders read "Ch 1") first.
    await expect(window.locator('.live-ch[data-ch="0"] .live-ch-name')).toHaveText('Vocals');
    await expect(window.locator('.live-ch[data-ch="0"] .veq-bar')).toHaveCount(7);

    const heightOf = async (band: string) =>
      parseFloat(await window.locator(`.live-ch[data-ch="0"] .veq-bar[data-band="${band}"]`).evaluate(el => (el as HTMLElement).style.height));
    const mid = await heightOf('mid'), bass = await heightOf('bass'), sub = await heightOf('subBass'), brill = await heightOf('brilliance');
    expect(mid).toBeGreaterThan(bass);       // -12 dB taller than -30 dB
    expect(bass).toBeGreaterThan(sub);       // -30 dB taller than -58 dB
    expect(brill).toBe(0);                   // ≤ DB_MIN clamps to the floor (min-height keeps it visible)

    const loud = window.locator('.live-ch[data-ch="0"] .veq-bar.loud');
    await expect(loud).toHaveCount(1);
    await expect(loud).toHaveAttribute('data-band', 'mid');
    await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.dim')).toHaveAttribute('data-band', 'brilliance');

    // Numeric per-band readouts ride the bars; > -24 dBFS is emphasized hot.
    const vals = window.locator('.live-ch[data-ch="0"] .veq-val');
    await expect(vals).toHaveCount(7);
    await expect(vals.nth(3)).toHaveText('-12.0');
    await expect(vals.nth(3)).toHaveClass(/hot/);
    await expect(vals.nth(1)).not.toHaveClass(/hot/); // bass at -30
    await expect(vals.nth(6)).toHaveClass(/dim/);     // brilliance at the floor
  });

  test('silence gets no loudest-band emphasis', async () => {
    const silent = LIVE_CHANNELS.map(ch => ({
      ...ch,
      bands: Object.fromEntries(Object.keys(ch.bands).map(k => [k, -120])),
    }));
    await sendLiveTick(silent);
    await expect(window.locator('.veq-bar.dim')).toHaveCount(14); // all bands idle...
    await expect(window.locator('.veq-bar.loud')).toHaveCount(0); // ...none "loudest"
    await expect(window.locator('.veq-label.loud')).toHaveCount(0);

    // Signal returns → emphasis comes back.
    await sendLiveTick(LIVE_CHANNELS);
    await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.loud')).toHaveAttribute('data-band', 'mid');
  });

  test('each channel has its own independent arc and loudest band', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    // Bass-heavy channel emphasizes bass, not mid.
    await expect(window.locator('.live-ch[data-ch="1"] .veq-bar.loud')).toHaveAttribute('data-band', 'bass');
    // The two arcs are drawn from their own band values → different paths.
    const paths = await window.locator('.live-ch .sb-curve-line').evaluateAll(els => els.map(e => e.getAttribute('d')));
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toBe(paths[1]);
  });

  test('per-channel labels: workspace inline rename and fallback (#39)', async () => {
    // A running capture keeps the tick-rendered board live-patched rather than
    // resynced to idle placeholders (which carry no device name) on every
    // renderChannelConfig() triggered by a label commit.
    await window.locator('#live-start-btn').click();
    await expect(window.locator('#live-stop-btn')).toBeVisible();

    // Two backend channels that carry device names → the fallback path.
    const named = [
      { ...LIVE_CHANNELS[0], name: 'USB Audio 1' },
      { ...LIVE_CHANNELS[1], name: 'USB Audio 2' },
    ];
    await sendLiveTick(named);
    const heads = window.locator('.sb-live-meters .live-ch-name');

    // With no label set, the header falls back to the backend device name.
    await expect(heads.first()).toHaveText('USB Audio 1');

    // Inline-edit the header (contenteditable) → the strip's label is set
    // immediately.
    await renameHeader(window, heads.first(), 'Kick');
    await expect(heads.first()).toHaveText('Kick');

    // Clearing the label falls back to the backend device name again.
    await heads.first().click();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Delete');
    await window.keyboard.press('Enter');
    await expect(heads.first()).toHaveText('USB Audio 1');

    // Inline-edit the second strip's header.
    await renameHeader(window, heads.nth(1), 'SL Vox');
    await expect(heads.nth(1)).toHaveText('SL Vox');

    // A fresh tick keeps the committed label (patch must not clobber it).
    await sendLiveTick(named);
    await expect(heads.nth(1)).toHaveText('SL Vox');
    await expect(heads.first()).toHaveText('USB Audio 1');

    // Focusing an unlabeled header and blurring without typing must NOT pin the
    // resolved fallback as an explicit label — a later device-name change still
    // flows through.
    await heads.first().click();
    await heads.nth(1).click(); // blur strip 0 by focusing elsewhere
    const renamed = [{ ...named[0], name: 'USB Audio 1 (renamed)' }, named[1]];
    await sendLiveTick(renamed);
    await expect(heads.first()).toHaveText('USB Audio 1 (renamed)');

    // Escape cancels an in-progress inline rename (label stays unset).
    await heads.first().click();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.type('Discarded');
    await window.keyboard.press('Escape');
    await expect(heads.first()).toHaveText('USB Audio 1 (renamed)');

    // Labels are display-only: the stream.py channel tokens never carry them.
    const clean = [{ ...LIVE_CHANNELS[0], name: 'Ch 1' }, { ...LIVE_CHANNELS[1], name: 'Ch 2' }];
    await sendLiveTick(clean);

    await window.locator('#live-stop-btn').click();
    await expect(window.locator('#live-start-btn')).toBeVisible();
  });

  test('a new tick updates bars and arc in place', async () => {
    await sendLiveTick(LIVE_CHANNELS);
    const midBar = window.locator('.live-ch[data-ch="0"] .veq-bar[data-band="mid"]');
    await expect(midBar).toHaveClass(/loud/);
    const before = parseFloat(await midBar.evaluate(el => (el as HTMLElement).style.height));
    const arcLine = window.locator('.live-ch[data-ch="0"] .sb-curve-line');
    const arcBefore = await arcLine.getAttribute('d');
    // Mark the SVG node so we can prove the tick patches it rather than
    // rebuilding it (bars/arc keep their nodes → CSS transitions run).
    await window.locator('.live-ch[data-ch="0"] .sb-spectrum-curve').evaluate(el => el.setAttribute('data-marker', 'kept'));

    // Vocals goes bass-heavy: the mid bar shrinks and emphasis moves to bass.
    const next = [
      { ...LIVE_CHANNELS[0], bands: { ...LIVE_CHANNELS[0].bands, mid: -40, bass: -8 } },
      LIVE_CHANNELS[1],
    ];
    await sendLiveTick(next);
    await expect(window.locator('.live-ch[data-ch="0"] .veq-bar.loud')).toHaveAttribute('data-band', 'bass');
    const after = parseFloat(await midBar.evaluate(el => (el as HTMLElement).style.height));
    expect(after).toBeLessThan(before);
    // Arc re-shaped with the bars, on the same SVG node.
    await expect(arcLine).not.toHaveAttribute('d', arcBefore as string);
    await expect(window.locator('.live-ch[data-ch="0"] .sb-spectrum-curve')).toHaveAttribute('data-marker', 'kept');
  });

  test('record mode captures a session and offers to reveal the folder (#43)', async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('reveal-path');
      ipcMain.handle('reveal-path', (_e, p) => {
        (globalThis as Record<string, unknown>).__revealed = p; return { success: true };
      });
    });
    await window.locator('#live-mode button[data-mode="record"]').click();
    await window.locator('#live-ws-arm-all').click(); // normalize armed state
    await window.locator('#live-start-btn').click();
    await expect(window.locator('#live-stop-btn')).toBeVisible();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');

    await window.locator('#live-stop-btn').click();
    await expect(window.locator('#live-start-btn')).toBeVisible();
    // stop-live returns a sessionDir (stubbed) → the session offer appears and
    // "Open folder" reveals that dir via reveal-path.
    await expect(window.locator('#rec-offer')).toBeVisible();
    await expect(window.locator('#rec-offer-text')).toContainText('Session saved');
    await window.locator('#rec-offer-btn').click();
    const revealed = await electronApp.evaluate(() => (globalThis as Record<string, unknown>).__revealed);
    expect(revealed).toBe('/tmp/sound-buddy-20260702-101500');
    await expect(window.locator('#rec-offer')).toBeHidden();
  });

  test('Record mode with nothing armed blocks Start with a hint (#43)', async () => {
    await window.locator('#live-mode button[data-mode="record"]').click();
    await window.locator('#live-ws-disarm-all').click();
    await expect(window.locator('#live-ws-arm-count')).toContainText('0 /');
    await window.locator('#live-start-btn').click();
    // No capture spawned: hint shown, Start still visible, Stop hidden.
    await expect(window.locator('#arm-hint')).toBeVisible();
    await expect(window.locator('#arm-hint')).toContainText('Arm at least one strip');
    await expect(window.locator('#live-start-btn')).toBeVisible();
    await expect(window.locator('#live-stop-btn')).toBeHidden();
    // Re-arm → Start works and the hint clears.
    await window.locator('#live-ws-arm-all').click();
    await window.locator('#live-start-btn').click();
    await expect(window.locator('#live-stop-btn')).toBeVisible();
    await expect(window.locator('#arm-hint')).toBeHidden();
    await window.locator('#live-stop-btn').click();
  });

  test('Record passes only the armed strips as arm tokens (#43)', async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', (_e, opts) => {
        (globalThis as Record<string, unknown>).__start = opts; return { success: true };
      });
    });
    await window.locator('#live-mode button[data-mode="record"]').click();
    await window.locator('#live-ws-arm-all').click();
    const arms = window.locator('#spectrum-body .live-ch-arm');
    const total = await arms.count();
    await arms.first().click(); // disarm strip 0
    await expect(arms.first()).toHaveAttribute('aria-pressed', 'false');

    await window.locator('#live-start-btn').click();
    await expect(window.locator('#live-stop-btn')).toBeVisible();
    const opts = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__start,
    )) as { arm?: string[] };
    expect(opts.arm).toBeDefined();
    expect(opts.arm!.length).toBe(total - 1); // exactly one strip disarmed
    await window.locator('#live-stop-btn').click();
    // Restore the plain success stub for any later tests.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('start-live');
      ipcMain.handle('start-live', () => ({ success: true }));
    });
  });
});
