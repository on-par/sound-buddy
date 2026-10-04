import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// #1648: Record on the Analyze-first shell records TWO sources only — Main
// (the board's mix out, Settings ▸ Audio's Input Device) and Measurement (the
// room mic, the secondary measurement device), each mono or stereo — with no
// Session tab, no DAW and no multitrack grid. Multitrack is deferred.
// Recording runs on its own start-record-take/stop-record-take processes, so
// the Live RTA (start-measurement) keeps listening and painting throughout.
//
// Launched with SOUND_BUDDY_FEATURES='' (every #1520 flag off, the shipping
// default) so the Session tab really is absent. IPC-stubbed at the main
// process boundary: list-devices reports a board + a room mic,
// start-record-take logs its payload, and stop-record-take writes the two
// stem files to a temp take folder (what stream.py leaves behind) and returns
// their paths. start-live/stop-live are counted to prove Record never touches
// Session's capture slot. Runs under SB_E2E_STUBBED_ONLY=1 CI.
//
// SB_PROOF_DIR=<dir> additionally screenshots the key frames for a human
// proof video; it changes no assertion.

const TAKE_DIR = path.join(__dirname, '..', '..', 'test-results', `record-take-${process.pid}`, 'sound-buddy-20261004-101500-000');
const PROOF_DIR = process.env.SB_PROOF_DIR;

interface RecordIpcLog {
  takeStarts: { main: { device?: string; channels: string }; measurement: { device?: string; channels: string } }[];
  takeStops: number;
  startLive: number;
  stopLive: number;
}

type MeasurementCall = { kind: 'start'; device?: string; channel?: number } | { kind: 'stop' };

async function proof(window: Page, name: string): Promise<void> {
  if (!PROOF_DIR) return;
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  await window.screenshot({ path: path.join(PROOF_DIR, `${name}.png`) });
}

async function stubRecordIpc(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, takeDir) => {
    const g = globalThis as unknown as { __recordIpc: RecordIpcLog };
    g.__recordIpc = { takeStarts: [], takeStops: 0, startLive: 0, stopLive: 0 };
    ipcMain.removeHandler('list-devices');
    ipcMain.handle('list-devices', () => ({
      success: true,
      micAccess: 'granted',
      devices: [
        { index: 0, name: 'Board USB', channels: 8, default_sr: 48000 },
        { index: 1, name: 'UMIK-1', channels: 1, default_sr: 48000 },
      ],
    }));
    ipcMain.removeHandler('start-record-take');
    ipcMain.handle('start-record-take', (_e, opts: RecordIpcLog['takeStarts'][number]) => {
      g.__recordIpc.takeStarts.push(opts);
      return { success: true };
    });
    ipcMain.removeHandler('stop-record-take');
    ipcMain.handle('stop-record-take', () => {
      g.__recordIpc.takeStops += 1;
      // What the two stream.py record processes leave on disk.
      const nodeFs = process.getBuiltinModule('fs');
      const nodePath = process.getBuiltinModule('path');
      const files: Record<string, string> = {};
      for (const [key, stem] of [['main', '01-main.wav'], ['measurement', '01-measurement.wav']]) {
        const dir = nodePath.join(takeDir, key);
        nodeFs.mkdirSync(dir, { recursive: true });
        files[key] = nodePath.join(dir, stem);
        nodeFs.writeFileSync(files[key], 'RIFF');
        nodeFs.writeFileSync(nodePath.join(dir, 'session.json'), JSON.stringify({ tracks: [{ file: stem }] }));
      }
      return { success: true, takeDir, files };
    });
    ipcMain.removeHandler('start-live');
    ipcMain.handle('start-live', () => { g.__recordIpc.startLive += 1; return { success: true }; });
    ipcMain.removeHandler('stop-live');
    ipcMain.handle('stop-live', () => { g.__recordIpc.stopLive += 1; return { success: true, sessionDir: null }; });
  }, TAKE_DIR);
}

async function recordIpc(electronApp: ElectronApplication): Promise<RecordIpcLog> {
  return electronApp.evaluate(() => (globalThis as unknown as { __recordIpc: RecordIpcLog }).__recordIpc);
}

async function measurementCalls(electronApp: ElectronApplication): Promise<MeasurementCall[]> {
  return electronApp.evaluate(
    () => (globalThis as unknown as { __sbMeasurementCalls?: MeasurementCall[] }).__sbMeasurementCalls ?? [],
  );
}

// A room-mic meter tick on the RTA's 48-point grid, at a given level.
const RTA_GRID_LEN = 48;
async function sendRoomMeterTick(electronApp: ElectronApplication, rms: number): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, { level, gridLen }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('measurement-event', {
      type: 'meter', ts: 0, channels: [{
        index: 0, name: 'Room', rms: level, peak: level + 18, clipping: false, centroid: 1000, rolloff: 0,
        bands: { sub_bass: -40, bass: -34, low_mid: -28, mid: -24, high_mid: -32, presence: -44, brilliance: -60 },
        curve: new Array(gridLen).fill(level),
      }],
    });
  }, { level: rms, gridLen: RTA_GRID_LEN });
}

// The Live RTA is listening and paints the latest room tick.
async function expectRtaLive(electronApp: ElectronApplication, window: Page, rms: number): Promise<void> {
  await expect(window.locator('body')).toHaveClass(/analyze-listening/);
  await expect(window.locator('#analyze-live-island')).toBeVisible();
  await expect(window.locator('#analyze-live-eq-stop')).toBeVisible();
  await sendRoomMeterTick(electronApp, rms);
  await expect(window.locator('#analyze-live-island .eq-pane-primary')).toContainText('Room —');
  await expect(window.locator('#analyze-live-island .veq-chart svg')).toBeVisible();
}

async function sessionAbsent(window: Page): Promise<void> {
  await expect(window.locator('.mode-tab[data-mode="live"]:visible')).toHaveCount(0);
  await expect(window.locator('#tab-live')).toBeHidden();
  const appMode = await window.evaluate(() => {
    const w = window as unknown as { rendererStores: { liveCapture: { getState(): { appMode: string } } } };
    return w.rendererStores.liveCapture.getState().appMode;
  });
  expect(appMode).not.toBe('live');
}

test.describe('Record Main + Measurement without the Session tab (#1648)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    fs.rmSync(path.dirname(TAKE_DIR), { recursive: true, force: true });
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_FEATURES: '' }));
    await stubRecordIpc(electronApp);
    await window.evaluate(async () => {
      const w = window as unknown as { rendererStores: { liveCapture: { getState(): { loadDevices(): Promise<void> } } } };
      await w.rendererStores.liveCapture.getState().loadDevices();
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('Record is visible on the Analyze-first shell with no Session tab, beside the live RTA', async () => {
    await expect(window.locator('#nav-analyze')).toHaveClass(/\bactive\b/);
    await sessionAbsent(window);
    await expectRtaLive(electronApp, window, -30);
    await proof(window, '01-analyze-shell-no-session-tab');

    const record = window.locator('#record-button');
    await expect(record).toBeVisible();
    await expect(record).toBeEnabled();
    await expect(record).toHaveAttribute('aria-label', 'Record Main + Measurement — press to start');
    await record.hover();
    await proof(window, '02-record-visible');
  });

  test('Settings ▸ Audio ▸ Record offers a mono/stereo picker for Main and Measurement only', async () => {
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await expect(window.locator('#settings-pane-audio')).toBeVisible();
    await window.locator('#device-select').selectOption('0');
    await window.locator('#secondary-measurement-device').selectOption('1');

    const pickers = window.locator('#settings-pane-audio select[id^="record-"]');
    await expect(pickers).toHaveCount(2);
    await expect(window.locator('#settings-pane-audio')).toContainText('Main input · Board USB');
    await expect(window.locator('#settings-pane-audio')).toContainText('Measurement input · UMIK-1');
    // Defaults follow the device: the 8-in board offers stereo, the 1-in mic is mono.
    await expect(window.locator('#record-main-channels')).toHaveValue('0-1');
    await expect(window.locator('#record-measurement-channels')).toHaveValue('0');
    await expect(window.locator('#record-measurement-channels option')).toHaveCount(1);
    // The board's mix out sits on its last pair.
    await window.locator('#record-main-channels').selectOption('6-7');
    await window.locator('#record-main-channels').scrollIntoViewIfNeeded();
    await proof(window, '02b-settings-main-and-measurement-sources');

    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('#settings-dialog')).toBeHidden();
    await window.locator('#nav-analyze').click();
    await expectRtaLive(electronApp, window, -30);
  });

  test('start records Main + Measurement (not a multitrack grid) while the RTA keeps listening; stop saves both files', async () => {
    const listenBefore = await measurementCalls(electronApp);

    await window.locator('#record-button').click();

    await expect(window.locator('#record-status')).toHaveText(/^Recording · \d+:\d\d$/);
    await expect(window.locator('#record-button')).toHaveAttribute('aria-pressed', 'true');
    const started = await recordIpc(electronApp);
    expect(started.takeStarts).toHaveLength(1);
    // Exactly two sources, one channel token each — never a track list.
    expect(started.takeStarts[0]).toMatchObject({
      main: { device: '0', channels: '6-7' },
      measurement: { device: '1', channels: '0' },
    });
    expect(started.takeStarts[0]).not.toHaveProperty('channels');
    expect(started.takeStarts[0]).not.toHaveProperty('arm');
    await expect(window.locator('#record-status')).toHaveAttribute('title', 'Main: Board USB · Ch 7–8 (stereo)\nMeasurement: UMIK-1 · Ch 1 (mono)');
    // Still the Analyze shell: no Session tab, no DAW, no channel grid.
    await sessionAbsent(window);
    await expect(window.locator('#live-island')).toBeHidden();

    // Listen is untouched: the RTA keeps painting new room ticks, and the
    // measurement stream was neither stopped nor restarted by Record.
    await expectRtaLive(electronApp, window, -18);
    expect(await measurementCalls(electronApp)).toEqual(listenBefore);
    await expect(window.locator('#record-status')).toHaveText(/^Recording · 0:0[1-9]$/, { timeout: 4_000 });
    await proof(window, '03-recording-in-progress');

    await window.locator('#record-button').click();

    await expect(window.locator('#record-saved')).toHaveText('Saved · sound-buddy-20261004-101500-000');
    await expect(window.locator('#record-saved')).toHaveAttribute('title', TAKE_DIR);
    await expect(window.locator('#record-saved-files')).toHaveText('01-main.wav · 01-measurement.wav');
    await expect(window.locator('#record-saved-files')).toHaveAttribute(
      'title', `${path.join(TAKE_DIR, 'main', '01-main.wav')}\n${path.join(TAKE_DIR, 'measurement', '01-measurement.wav')}`);
    await expect(window.locator('#record-status')).toHaveCount(0);
    await expect(window.locator('#record-error')).toHaveCount(0);
    await expect(window.locator('#record-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(window.locator('#record-button')).toBeEnabled();
    await proof(window, '04-stopped-files-saved');

    // Both stems are on disk where the UI says.
    expect(fs.existsSync(path.join(TAKE_DIR, 'main', '01-main.wav'))).toBe(true);
    expect(fs.existsSync(path.join(TAKE_DIR, 'measurement', '01-measurement.wav'))).toBe(true);

    const stopped = await recordIpc(electronApp);
    expect(stopped.takeStops).toBe(1);
    // Session's capture slot was never used.
    expect(stopped.startLive).toBe(0);
    expect(stopped.stopLive).toBe(0);

    // And the RTA is still live after the take.
    await expectRtaLive(electronApp, window, -24);
    expect(await measurementCalls(electronApp)).toEqual(listenBefore);
  });

  test('a missing Measurement device refuses to start with an actionable error and leaves Listen alone', async () => {
    const listenBefore = await measurementCalls(electronApp);
    await window.evaluate(() => {
      const w = window as unknown as { rendererStores: { liveCapture: { setState(s: unknown): void; getState(): { secondaryMeasurement: object } } } };
      const s = w.rendererStores.liveCapture.getState();
      w.rendererStores.liveCapture.setState({ secondaryMeasurement: { ...s.secondaryMeasurement, deviceName: 'Unplugged Mic' } });
    });

    await window.locator('#record-button').click();

    await expect(window.locator('#record-error')).toHaveText(/^Measurement input not found — .*Settings ▸ Audio/);
    await expect(window.locator('#record-button')).toHaveAttribute('aria-pressed', 'false');
    expect((await recordIpc(electronApp)).takeStarts).toHaveLength(1);
    expect(await measurementCalls(electronApp)).toEqual(listenBefore);
  });
});
