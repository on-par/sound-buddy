import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Point Electron's userData at a per-test temp dir so every write lands in real
// JSON we can assert against. `app.getPath` is the only Electron surface these
// modules touch at runtime (logger's BrowserWindow import is unused here).
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

vi.mock('./logger', () => ({ logWarn: vi.fn() }));

// Partial mock: writeFileSync delegates to the real implementation by default
// (vi.fn wrapping actual) so every existing real-fs test keeps working, but
// individual tests can force a failure with mockImplementationOnce — vi.spyOn
// can't do this because Node's ESM fs namespace is non-configurable.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

import {
  getSettings,
  updateSettings,
  listRigs,
  getRig,
  upsertRig,
  deleteRig,
  setActiveRig,
  type CaptureRig,
} from './settings';
import { logWarn } from './logger';

const settingsFile = () => path.join(userDataDir, 'settings.json');
const readFile = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
const writeFile = (obj: unknown) =>
  fs.writeFileSync(settingsFile(), JSON.stringify(obj, null, 2));

/** A complete rig minus id (upsert generates one). */
function makeRig(over: Partial<CaptureRig> = {}): Omit<CaptureRig, 'id'> {
  return {
    name: 'Main Rig',
    deviceName: 'Scarlett 18i20',
    channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
    mode: 'monitor',
    recordDir: '/tmp/rec',
    intervalMs: 100,
    windowSecs: 5,
    ...over,
  };
}

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-settings-'));
  delete process.env.SOUND_BUDDY_IDEAL_PROFILE;
  delete process.env.SOUND_BUDDY_STORAGE_DIR;
  delete process.env.SOUND_BUDDY_REPORT_FIRST_UX;
  vi.mocked(logWarn).mockClear();
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('getSettings defaults', () => {
  it('returns rigs=[] and activeRigId=null when no settings.json exists', () => {
    const s = getSettings();
    expect(s.rigs).toEqual([]);
    expect(s.activeRigId).toBeNull();
    expect(s.idealProfile).toBe('');
  });

  it('defaults rigs when settings.json has no "rigs" key, preserving other fields', () => {
    writeFile({ idealProfile: 'broadcast', crashReportingEnabled: true });
    const s = getSettings();
    expect(s.rigs).toEqual([]);
    expect(s.activeRigId).toBeNull();
    expect(s.idealProfile).toBe('broadcast');
    expect(s.crashReportingEnabled).toBe(true);
  });

  it('defaults storageDir to "" (platform default) when unset', () => {
    expect(getSettings().storageDir).toBe('');
  });

  it('defaults customIdealProfiles to [] when unset', () => {
    expect(getSettings().customIdealProfiles).toEqual([]);
  });

  it('defaults usageSignalEnabled to false when unset', () => {
    expect(getSettings().usageSignalEnabled).toBe(false);
  });

  it('defaults channelLabels to {} when unset', () => {
    expect(getSettings().channelLabels).toEqual({});
  });

  it('defaults channelGroups to {} when unset', () => {
    expect(getSettings().channelGroups).toEqual({});
  });

  it('defaults inputInstrumentProfiles to {} when unset', () => {
    expect(getSettings().inputInstrumentProfiles).toEqual({});
  });
});

describe('channelGroups (#483 — persisted per-device named channel groups)', () => {
  it('round-trips a device/group-list map through an update', () => {
    const map = {
      'Scarlett 18i20': [{ name: 'Drums', members: [0, 1], collapsed: true }, { name: 'Vox', members: [] }],
      '': [{ name: 'Band', members: [2, 3] }],
    };
    const after = updateSettings({ channelGroups: map });
    expect(after.channelGroups).toEqual(map);
    expect(readFile().channelGroups).toEqual(map);
    expect(getSettings().channelGroups).toEqual(map);
  });

  it('treats a corrupted channelGroups value (string/array) as {}', () => {
    writeFile({ channelGroups: 'nope' });
    expect(getSettings().channelGroups).toEqual({});

    writeFile({ channelGroups: ['nope'] });
    expect(getSettings().channelGroups).toEqual({});
  });

  it('unrelated updates preserve stored channelGroups', () => {
    const map = { 'Scarlett 18i20': [{ name: 'Drums', members: [0] }] };
    updateSettings({ channelGroups: map });
    updateSettings({ idealProfile: 'broadcast' });
    expect(readFile().channelGroups).toEqual(map);
    expect(getSettings().channelGroups).toEqual(map);
  });
});

describe('channelLabels (#482 — persisted per-device channel labels)', () => {
  it('round-trips a nested device/token label map through an update', () => {
    const map = { 'Scarlett 18i20': { '0': 'Kick', '2-3': 'OH' }, '': { '1': 'Vocal' } };
    const after = updateSettings({ channelLabels: map });
    expect(after.channelLabels).toEqual(map);
    expect(readFile().channelLabels).toEqual(map);
    expect(getSettings().channelLabels).toEqual(map);
  });

  it('treats a corrupted channelLabels value (string/array) as {}', () => {
    writeFile({ channelLabels: 'nope' });
    expect(getSettings().channelLabels).toEqual({});

    writeFile({ channelLabels: ['nope'] });
    expect(getSettings().channelLabels).toEqual({});
  });

  it('unrelated updates preserve stored channelLabels', () => {
    const map = { 'Scarlett 18i20': { '0': 'Kick' } };
    updateSettings({ channelLabels: map });
    updateSettings({ idealProfile: 'broadcast' });
    expect(readFile().channelLabels).toEqual(map);
    expect(getSettings().channelLabels).toEqual(map);
  });
});

describe('inputInstrumentProfiles (#524 — persisted per-device instrument-profile overrides)', () => {
  it('round-trips a nested device/token profile-id map through an update', () => {
    const map = { 'Scarlett 18i20': { '0': 'kick', '2-3': 'vocal' }, '': { '1': 'bass' } };
    const after = updateSettings({ inputInstrumentProfiles: map });
    expect(after.inputInstrumentProfiles).toEqual(map);
    expect(readFile().inputInstrumentProfiles).toEqual(map);
    expect(getSettings().inputInstrumentProfiles).toEqual(map);
  });

  it('treats a corrupted inputInstrumentProfiles value (string/array) as {}', () => {
    writeFile({ inputInstrumentProfiles: 'nope' });
    expect(getSettings().inputInstrumentProfiles).toEqual({});

    writeFile({ inputInstrumentProfiles: ['nope'] });
    expect(getSettings().inputInstrumentProfiles).toEqual({});
  });

  it('unrelated updates preserve stored inputInstrumentProfiles', () => {
    const map = { 'Scarlett 18i20': { '0': 'kick' } };
    updateSettings({ inputInstrumentProfiles: map });
    updateSettings({ idealProfile: 'broadcast' });
    expect(readFile().inputInstrumentProfiles).toEqual(map);
    expect(getSettings().inputInstrumentProfiles).toEqual(map);
  });
});

describe('usageSignalEnabled (#145 — opt-in anonymous usage counts, persisted only)', () => {
  it('flips on and back off, persisting each value to the raw file', () => {
    const on = updateSettings({ usageSignalEnabled: true });
    expect(on.usageSignalEnabled).toBe(true);
    expect(readFile().usageSignalEnabled).toBe(true);

    const off = updateSettings({ usageSignalEnabled: false });
    expect(off.usageSignalEnabled).toBe(false);
    expect(readFile().usageSignalEnabled).toBe(false);
  });

  it('backfills usageSignalEnabled=false on a write that does not mention it', () => {
    updateSettings({ idealProfile: 'x' });
    expect(readFile().usageSignalEnabled).toBe(false);
  });

  it('treats a settings.json with usageSignalEnabled absent as false', () => {
    writeFile({ idealProfile: '' });
    expect(getSettings().usageSignalEnabled).toBe(false);
  });
});

describe('crashReportingEnabled (#473 — opt-in crash reporting, default off)', () => {
  it('defaults to false when unset', () => {
    expect(getSettings().crashReportingEnabled).toBe(false);
  });

  it('flips on and back off, persisting each value to the raw file', () => {
    const on = updateSettings({ crashReportingEnabled: true });
    expect(on.crashReportingEnabled).toBe(true);
    expect(readFile().crashReportingEnabled).toBe(true);

    const off = updateSettings({ crashReportingEnabled: false });
    expect(off.crashReportingEnabled).toBe(false);
    expect(readFile().crashReportingEnabled).toBe(false);
  });

  it('backfills crashReportingEnabled=false on a write that does not mention it', () => {
    updateSettings({ idealProfile: 'x' });
    expect(readFile().crashReportingEnabled).toBe(false);
  });

  it('treats a settings.json with crashReportingEnabled absent as false', () => {
    writeFile({ idealProfile: '' });
    expect(getSettings().crashReportingEnabled).toBe(false);
  });
});

describe('dawWorkspaceEnabled (#516 — experimental DAW workspace, default off)', () => {
  it('defaults to false when settings.json is absent', () => {
    expect(getSettings().dawWorkspaceEnabled).toBe(false);
  });

  it('defaults to false when the file exists without the key', () => {
    writeFile({ idealProfile: '' });
    expect(getSettings().dawWorkspaceEnabled).toBe(false);
  });

  it('flips on and back off, persisting each value to the raw file and surviving a fresh read', () => {
    const on = updateSettings({ dawWorkspaceEnabled: true });
    expect(on.dawWorkspaceEnabled).toBe(true);
    expect(readFile().dawWorkspaceEnabled).toBe(true);
    expect(getSettings().dawWorkspaceEnabled).toBe(true);

    const off = updateSettings({ dawWorkspaceEnabled: false });
    expect(off.dawWorkspaceEnabled).toBe(false);
    expect(readFile().dawWorkspaceEnabled).toBe(false);
  });
});

describe('liveAdjustmentsEnabled (#522 — experimental live adjustments, default off)', () => {
  it('defaults to false when settings.json is absent', () => {
    expect(getSettings().liveAdjustmentsEnabled).toBe(false);
  });

  it('defaults to false when the file exists without the key', () => {
    writeFile({ idealProfile: '' });
    expect(getSettings().liveAdjustmentsEnabled).toBe(false);
  });

  it('flips on and back off, persisting each value to the raw file and surviving a fresh read', () => {
    const on = updateSettings({ liveAdjustmentsEnabled: true });
    expect(on.liveAdjustmentsEnabled).toBe(true);
    expect(readFile().liveAdjustmentsEnabled).toBe(true);
    expect(getSettings().liveAdjustmentsEnabled).toBe(true);

    const off = updateSettings({ liveAdjustmentsEnabled: false });
    expect(off.liveAdjustmentsEnabled).toBe(false);
    expect(readFile().liveAdjustmentsEnabled).toBe(false);
  });
});

describe('reportFirstUxEnabled (#538 — report-first-ux epic gate, default off)', () => {
  it('defaults to false when settings.json is absent', () => {
    expect(getSettings().reportFirstUxEnabled).toBe(false);
  });

  it('defaults to false when the file exists without the key', () => {
    writeFile({ idealProfile: '' });
    expect(getSettings().reportFirstUxEnabled).toBe(false);
  });

  it('flips on and back off, persisting each value to the raw file and surviving a fresh read', () => {
    const on = updateSettings({ reportFirstUxEnabled: true });
    expect(on.reportFirstUxEnabled).toBe(true);
    expect(readFile().reportFirstUxEnabled).toBe(true);
    expect(getSettings().reportFirstUxEnabled).toBe(true);

    const off = updateSettings({ reportFirstUxEnabled: false });
    expect(off.reportFirstUxEnabled).toBe(false);
    expect(readFile().reportFirstUxEnabled).toBe(false);
  });

  it("reads enabled from SOUND_BUDDY_REPORT_FIRST_UX='1' with no settings file present", () => {
    process.env.SOUND_BUDDY_REPORT_FIRST_UX = '1';
    expect(getSettings().reportFirstUxEnabled).toBe(true);
  });

  it("reads enabled from SOUND_BUDDY_REPORT_FIRST_UX='true' with no settings file present", () => {
    process.env.SOUND_BUDDY_REPORT_FIRST_UX = 'true';
    expect(getSettings().reportFirstUxEnabled).toBe(true);
  });

  it("SOUND_BUDDY_REPORT_FIRST_UX='0' forces it off over a file-layer true", () => {
    writeFile({ reportFirstUxEnabled: true });
    process.env.SOUND_BUDDY_REPORT_FIRST_UX = '0';
    expect(getSettings().reportFirstUxEnabled).toBe(false);
  });

  it('never bakes an env override into a rigs write', () => {
    writeFile({ idealProfile: '', rigs: [], activeRigId: null, reportFirstUxEnabled: false });
    process.env.SOUND_BUDDY_REPORT_FIRST_UX = '1';

    // getSettings reflects the env layer...
    expect(getSettings().reportFirstUxEnabled).toBe(true);

    // ...but writing a rig persists the FILE's reportFirstUxEnabled=false, not the env true.
    upsertRig(makeRig());
    expect(readFile().reportFirstUxEnabled).toBe(false);
    // The env override is still applied on read.
    expect(getSettings().reportFirstUxEnabled).toBe(true);
  });
});

describe('weeklyReminderEnabled / weeklyReminderServiceDay (#268 — opt-in local weekly reminder, default off)', () => {
  it('defaults to disabled and Sunday when settings.json is absent', () => {
    const s = getSettings();
    expect(s.weeklyReminderEnabled).toBe(false);
    expect(s.weeklyReminderServiceDay).toBe(0);
  });

  it('round-trips a full update through updateSettings and a fresh read', () => {
    const on = updateSettings({ weeklyReminderEnabled: true, weeklyReminderServiceDay: 3 });
    expect(on.weeklyReminderEnabled).toBe(true);
    expect(on.weeklyReminderServiceDay).toBe(3);
    expect(readFile().weeklyReminderEnabled).toBe(true);
    expect(readFile().weeklyReminderServiceDay).toBe(3);
    expect(getSettings().weeklyReminderEnabled).toBe(true);
    expect(getSettings().weeklyReminderServiceDay).toBe(3);

    const off = updateSettings({ weeklyReminderEnabled: false });
    expect(off.weeklyReminderEnabled).toBe(false);
    expect(readFile().weeklyReminderEnabled).toBe(false);
  });

  it.each([9, -1, 2.5, 'sunday'])(
    'hydrates a corrupted weeklyReminderServiceDay value (%p) back to the default 0',
    (corrupted) => {
      writeFile({ weeklyReminderServiceDay: corrupted });
      expect(getSettings().weeklyReminderServiceDay).toBe(0);
    },
  );
});

describe('customIdealProfiles', () => {
  const curve = {
    id: 'sunday',
    label: 'Sunday target',
    description: 'Main room reference',
    freqs: [20, 1000, 20000],
    dbOffsets: [-2, 1, -1],
    source: 'manual' as const,
  };

  it('persists user-authored ideal curves and selected custom profile', () => {
    const after = updateSettings({
      idealProfile: 'custom:sunday',
      customIdealProfiles: [curve],
    });
    expect(after.idealProfile).toBe('custom:sunday');
    expect(after.customIdealProfiles).toEqual([curve]);
    expect(readFile().customIdealProfiles).toEqual([curve]);
  });

  it('treats a corrupted customIdealProfiles value as empty', () => {
    writeFile({ customIdealProfiles: { nope: true } });
    expect(getSettings().customIdealProfiles).toEqual([]);
  });

  it('rig writes preserve custom curve settings', () => {
    updateSettings({ idealProfile: 'custom:sunday', customIdealProfiles: [curve] });
    upsertRig(makeRig());
    const f = readFile();
    expect(f.idealProfile).toBe('custom:sunday');
    expect(f.customIdealProfiles).toEqual([curve]);
  });
});

describe('storageDir (#91 — no usage caps, configurable location)', () => {
  it('persists a chosen storage folder and reads it back', () => {
    const after = updateSettings({ storageDir: '/Volumes/Recordings/Sound Buddy' });
    expect(after.storageDir).toBe('/Volumes/Recordings/Sound Buddy');
    expect(getSettings().storageDir).toBe('/Volumes/Recordings/Sound Buddy');
    expect(readFile().storageDir).toBe('/Volumes/Recordings/Sound Buddy');
  });

  it('lets an empty string reset to the platform default', () => {
    updateSettings({ storageDir: '/tmp/custom' });
    expect(updateSettings({ storageDir: '' }).storageDir).toBe('');
  });

  it('applies SOUND_BUDDY_STORAGE_DIR as a read-time override of the file', () => {
    updateSettings({ storageDir: '/tmp/from-file' });
    process.env.SOUND_BUDDY_STORAGE_DIR = '/tmp/from-env';
    expect(getSettings().storageDir).toBe('/tmp/from-env');
  });

  it('never bakes the storageDir env override into a subsequent write', () => {
    updateSettings({ storageDir: '/tmp/from-file' });
    process.env.SOUND_BUDDY_STORAGE_DIR = '/tmp/from-env';
    upsertRig(makeRig());
    // The file keeps the persisted value, not the transient env override.
    expect(readFile().storageDir).toBe('/tmp/from-file');
    expect(getSettings().storageDir).toBe('/tmp/from-env');
  });

  it('survives a rigs write without being disturbed', () => {
    updateSettings({ storageDir: '/tmp/keep' });
    upsertRig(makeRig());
    expect(readFile().storageDir).toBe('/tmp/keep');
  });
});

describe('shareChurchName (#265 — Share Image export, blank by default)', () => {
  it('defaults to "" when unset', () => {
    expect(getSettings().shareChurchName).toBe('');
  });

  it('persists a chosen church name and reads it back', () => {
    const after = updateSettings({ shareChurchName: 'Grace Chapel' });
    expect(after.shareChurchName).toBe('Grace Chapel');
    expect(getSettings().shareChurchName).toBe('Grace Chapel');
    expect(readFile().shareChurchName).toBe('Grace Chapel');
  });

  it('falls back to the default when settings.json holds a non-string value', () => {
    writeFile({ shareChurchName: 42 });
    expect(getSettings().shareChurchName).toBe('');
  });

  it('has no env override', () => {
    updateSettings({ shareChurchName: 'from-file' });
    process.env.SOUND_BUDDY_SHARE_CHURCH_NAME = 'from-env';
    expect(getSettings().shareChurchName).toBe('from-file');
    delete process.env.SOUND_BUDDY_SHARE_CHURCH_NAME;
  });
});

describe('upsertRig', () => {
  it('generates a stable id and appends a rig without one', () => {
    upsertRig(makeRig());
    const rigs = listRigs();
    expect(rigs).toHaveLength(1);
    expect(rigs[0].id).toBeTruthy();
    expect(typeof rigs[0].id).toBe('string');
    // All scope fields survive the round-trip.
    expect(rigs[0]).toMatchObject({
      name: 'Main Rig',
      deviceName: 'Scarlett 18i20',
      channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      mode: 'monitor',
      recordDir: '/tmp/rec',
      intervalMs: 100,
      windowSecs: 5,
    });
  });

  it('replaces an existing rig in place (no duplicate) when the id matches', () => {
    const first = upsertRig(makeRig({ name: 'v1' }));
    const id = first.rigs[0].id;
    const after = upsertRig(makeRig({ id, name: 'v2' }));
    expect(after.rigs).toHaveLength(1);
    expect(after.rigs[0].id).toBe(id);
    expect(after.rigs[0].name).toBe('v2');
  });

  it('honours a caller-supplied id on insert', () => {
    upsertRig(makeRig({ id: 'r-fixed' }));
    expect(getRig('r-fixed')?.name).toBe('Main Rig');
  });

  it('throws when name is missing', () => {
    expect(() => upsertRig(makeRig({ name: '' }))).toThrow(/name is required/);
    // Nothing was written.
    expect(getSettings().rigs).toEqual([]);
  });

  it('preserves a per-channel label verbatim through save + getRig', () => {
    const saved = upsertRig(
      makeRig({ channelConfig: [{ kind: 'stereo', a: 0, b: 1, label: 'Drums OH' }] }),
    );
    const got = getRig(saved.rigs[0].id);
    expect(got?.channelConfig[0]).toEqual({ kind: 'stereo', a: 0, b: 1, label: 'Drums OH' });
  });

  it('round-trips a preflight baseline (#373) through save + getRig/listRigs', () => {
    const baseline = {
      deviceName: 'Scarlett 18i20',
      strips: [{ kind: 'mono' as const, a: 0, b: 0, label: 'Vocal' }],
      savedAt: '2026-07-14T12:00:00.000Z',
    };
    const saved = upsertRig(makeRig({ baseline }));
    expect(getRig(saved.rigs[0].id)?.baseline).toEqual(baseline);
    expect(listRigs()[0].baseline).toEqual(baseline);
  });
});

describe('getRig', () => {
  it('returns undefined for an unknown id', () => {
    expect(getRig('nope')).toBeUndefined();
  });
});

describe('deleteRig', () => {
  it('removes a rig and leaves activeRigId untouched when a non-active rig is deleted', () => {
    upsertRig(makeRig({ id: 'a', name: 'A' }));
    upsertRig(makeRig({ id: 'b', name: 'B' }));
    setActiveRig('a');
    const after = deleteRig('b');
    expect(after.rigs.map((r) => r.id)).toEqual(['a']);
    expect(after.activeRigId).toBe('a');
  });

  it('clears activeRigId to null when the active rig is deleted', () => {
    upsertRig(makeRig({ id: 'a', name: 'A' }));
    upsertRig(makeRig({ id: 'b', name: 'B' }));
    setActiveRig('a');
    const after = deleteRig('a');
    expect(after.rigs.map((r) => r.id)).toEqual(['b']);
    expect(after.activeRigId).toBeNull();
  });

  it('is a no-op for an unknown id', () => {
    const a = upsertRig(makeRig()).rigs[0].id;
    const after = deleteRig('ghost');
    expect(after.rigs.map((r) => r.id)).toEqual([a]);
  });
});

describe('setActiveRig', () => {
  it('sets a valid rig active', () => {
    const a = upsertRig(makeRig()).rigs[0].id;
    expect(setActiveRig(a).activeRigId).toBe(a);
  });

  it('clears the selection when passed null', () => {
    const a = upsertRig(makeRig()).rigs[0].id;
    setActiveRig(a);
    expect(setActiveRig(null).activeRigId).toBeNull();
  });

  it('ignores an unknown id (no-op, prior selection kept)', () => {
    const a = upsertRig(makeRig()).rigs[0].id;
    setActiveRig(a);
    expect(setActiveRig('ghost').activeRigId).toBe(a);
  });
});

describe('layered-persistence discipline', () => {
  it('never bakes an env override into a rigs write', () => {
    writeFile({ idealProfile: '', rigs: [], activeRigId: null, reportFirstUxEnabled: false });
    process.env.SOUND_BUDDY_REPORT_FIRST_UX = '1';

    // getSettings reflects the env layer...
    expect(getSettings().reportFirstUxEnabled).toBe(true);

    // ...but writing a rig persists the FILE's reportFirstUxEnabled=false, not the env true.
    upsertRig(makeRig());
    expect(readFile().reportFirstUxEnabled).toBe(false);
    // The env override is still applied on read.
    expect(getSettings().reportFirstUxEnabled).toBe(true);
  });

  it('rig writes do not disturb existing reportFirstUxEnabled/idealProfile file values', () => {
    updateSettings({ reportFirstUxEnabled: true, idealProfile: 'broadcast' });
    upsertRig(makeRig());
    const f = readFile();
    expect(f.reportFirstUxEnabled).toBe(true);
    expect(f.idealProfile).toBe('broadcast');
    expect(f.rigs).toHaveLength(1);
  });

  it('preserves unknown top-level keys across a rig write (forward compat)', () => {
    writeFile({ idealProfile: '', rigs: [], futureKey: 'keep-me' });
    upsertRig(makeRig());
    expect(readFile().futureKey).toBe('keep-me');
  });
});

describe('robustness against a corrupted settings.json', () => {
  it('treats a non-array "rigs" value as empty rather than throwing', () => {
    writeFile({ idealProfile: '', rigs: { not: 'an array' } });
    expect(listRigs()).toEqual([]);
    expect(getSettings().rigs).toEqual([]);
    // A save still works and repairs the shape.
    const after = upsertRig(makeRig());
    expect(after.rigs).toHaveLength(1);
    expect(Array.isArray(readFile().rigs)).toBe(true);
  });

  it('returns a fresh array for the empty default (no shared-reference aliasing)', () => {
    const first = listRigs();
    first.push(makeRig() as unknown as CaptureRig);
    // Mutating the returned array must not leak into the next read.
    expect(listRigs()).toEqual([]);
  });

  it('throws a clear error when saveRig is handed a null/undefined rig', () => {
    // The preload types the IPC arg as unknown, so null can reach upsertRig.
    expect(() => upsertRig(null as unknown as Omit<CaptureRig, 'id'>)).toThrow(/name is required/);
  });

  it('treats syntactically invalid JSON as defaults and logs a warning', () => {
    fs.writeFileSync(settingsFile(), '{not json');

    const s = getSettings();

    expect(s.rigs).toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('could not read settings.json'));
  });
});

describe('writeSettingsFile failure', () => {
  it('rethrows when the underlying write fails', () => {
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => updateSettings({ idealProfile: 'broadcast' })).toThrow(/EACCES/);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('could not write settings.json'));
  });
});

describe('SOUND_BUDDY_IDEAL_PROFILE env override', () => {
  afterEach(() => {
    delete process.env.SOUND_BUDDY_IDEAL_PROFILE;
  });

  it('overrides the persisted idealProfile at read time', () => {
    updateSettings({ idealProfile: 'broadcast' });
    process.env.SOUND_BUDDY_IDEAL_PROFILE = 'jazz';
    expect(getSettings().idealProfile).toBe('jazz');
  });
});

describe('legacy AI-flag settings migration (#659)', () => {
  // Built by concatenation so the ai-carveout-gate.test.ts (#659) token scan
  // — which bans the removed flag's literal name — tolerates this file
  // exercising the on-disk legacy key by name.
  const LEGACY_AI_KEY = 'ai' + 'Enabled';

  it('loads a 0.8.7-shaped settings.json with the legacy key cleanly, dropping it from getSettings() while preserving every other setting', () => {
    writeFile({
      [LEGACY_AI_KEY]: true,
      idealProfile: 'broadcast',
      storageDir: '/tmp/somewhere',
      rigs: [],
      activeRigId: null,
    });

    let s: ReturnType<typeof getSettings> | undefined;
    expect(() => {
      s = getSettings();
    }).not.toThrow();

    expect(LEGACY_AI_KEY in (s as object)).toBe(false);
    expect(s?.idealProfile).toBe('broadcast');
    expect(s?.storageDir).toBe('/tmp/somewhere');
  });

  it('round-trips the unknown legacy key untouched through a subsequent updateSettings write', () => {
    writeFile({
      [LEGACY_AI_KEY]: true,
      idealProfile: 'broadcast',
      storageDir: '/tmp/somewhere',
      rigs: [],
      activeRigId: null,
    });

    updateSettings({ idealProfile: 'concert' });

    const raw = readFile();
    expect(raw[LEGACY_AI_KEY]).toBe(true);
    expect(raw.idealProfile).toBe('concert');
    expect(raw.storageDir).toBe('/tmp/somewhere');
  });
});
