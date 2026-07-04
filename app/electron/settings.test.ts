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
  delete process.env.SOUND_BUDDY_AI_ENABLED;
  delete process.env.SOUND_BUDDY_IDEAL_PROFILE;
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('getSettings defaults', () => {
  it('returns rigs=[] and activeRigId=null when no settings.json exists', () => {
    const s = getSettings();
    expect(s.rigs).toEqual([]);
    expect(s.activeRigId).toBeNull();
    expect(s.aiEnabled).toBe(false);
    expect(s.idealProfile).toBe('');
  });

  it('defaults rigs when settings.json has no "rigs" key, preserving other fields', () => {
    writeFile({ aiEnabled: true, idealProfile: 'broadcast' });
    const s = getSettings();
    expect(s.rigs).toEqual([]);
    expect(s.activeRigId).toBeNull();
    expect(s.aiEnabled).toBe(true);
    expect(s.idealProfile).toBe('broadcast');
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
    writeFile({ aiEnabled: false, idealProfile: '', rigs: [], activeRigId: null });
    process.env.SOUND_BUDDY_AI_ENABLED = '1';

    // getSettings reflects the env layer...
    expect(getSettings().aiEnabled).toBe(true);

    // ...but writing a rig persists the FILE's aiEnabled=false, not the env true.
    upsertRig(makeRig());
    expect(readFile().aiEnabled).toBe(false);
    // The env override is still applied on read.
    expect(getSettings().aiEnabled).toBe(true);
  });

  it('rig writes do not disturb existing aiEnabled/idealProfile file values', () => {
    updateSettings({ aiEnabled: true, idealProfile: 'broadcast' });
    upsertRig(makeRig());
    const f = readFile();
    expect(f.aiEnabled).toBe(true);
    expect(f.idealProfile).toBe('broadcast');
    expect(f.rigs).toHaveLength(1);
  });

  it('preserves unknown top-level keys across a rig write (forward compat)', () => {
    writeFile({ aiEnabled: false, idealProfile: '', rigs: [], futureKey: 'keep-me' });
    upsertRig(makeRig());
    expect(readFile().futureKey).toBe('keep-me');
  });
});

describe('robustness against a corrupted settings.json', () => {
  it('treats a non-array "rigs" value as empty rather than throwing', () => {
    writeFile({ aiEnabled: false, idealProfile: '', rigs: { not: 'an array' } });
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
});
