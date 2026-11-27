// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INITIAL_SLOW_TIER_CURSOR,
  MAX_NODE_QUERIES_PER_TICK,
  SLOW_DETAIL_CHANNELS_PER_TICK,
  SLOW_SURFACE_PATHS_PER_TICK,
  planSlowTier,
  stripDetailPaths,
  stripSendPaths,
  surfacePaths,
  emptyStripDetail,
  emptySurfaces,
  applyDetailLines,
  applySendLines,
  applySurfaceLine,
} from './console-strip-detail';

const scene = fs.readFileSync(
  fileURLToPath(new URL('../../../packages/console/src/capture-2026-08-16.scn', import.meta.url)),
  'utf8'
);
const sceneLines = scene.split('\n').map((l) => l.trim());

function lineFor(path: string): string | null {
  return sceneLines.find((l) => l.startsWith(`${path} `)) ?? null;
}

describe('slow-tier path builders', () => {
  it('reads preamp, gate, eq and four eq bands for a strip', () => {
    expect(stripDetailPaths(3)).toEqual([
      '/ch/03/preamp', '/ch/03/gate', '/ch/03/eq', '/ch/03/eq/1', '/ch/03/eq/2', '/ch/03/eq/3', '/ch/03/eq/4',
    ]);
  });

  it('reads all sixteen mix-bus sends for a strip', () => {
    const paths = stripSendPaths(12);
    expect(paths).toHaveLength(16);
    expect(paths[0]).toBe('/ch/12/mix/01');
    expect(paths[15]).toBe('/ch/12/mix/16');
  });

  it('reads config and mix for sixteen buses then Main LR', () => {
    const paths = surfacePaths();
    expect(paths).toHaveLength(34);
    expect(paths.slice(0, 2)).toEqual(['/bus/01/config', '/bus/01/mix']);
    expect(paths.slice(-2)).toEqual(['/main/st/config', '/main/st/mix']);
  });
});

describe('planSlowTier', () => {
  it('plans 4 strips of detail, 1 strip of sends and 5 surface paths: 49 queries, inside the per-tick cap with the 96-query fast tier', () => {
    const plan = planSlowTier(INITIAL_SLOW_TIER_CURSOR, 32);
    expect(plan.requests.filter((r) => r.kind === 'detail').map((r) => (r.kind === 'detail' ? r.channel : 0))).toEqual([1, 2, 3, 4]);
    expect(plan.requests.filter((r) => r.kind === 'sends').map((r) => (r.kind === 'sends' ? r.channel : 0))).toEqual([1]);
    expect(plan.requests.filter((r) => r.kind === 'surface')).toHaveLength(SLOW_SURFACE_PATHS_PER_TICK);
    expect(plan.queryCount).toBe(SLOW_DETAIL_CHANNELS_PER_TICK * 7 + 16 + SLOW_SURFACE_PATHS_PER_TICK);
    expect(96 + plan.queryCount).toBeLessThanOrEqual(MAX_NODE_QUERIES_PER_TICK);
    expect(plan.next).toEqual({ detail: 4, sends: 1, surface: 5 });
  });

  it('wraps every cursor so the walk covers each strip and surface again', () => {
    const plan = planSlowTier({ detail: 30, sends: 31, surface: 32 }, 32);
    const detail = plan.requests.filter((r) => r.kind === 'detail').map((r) => (r.kind === 'detail' ? r.channel : 0));
    const surface = plan.requests.filter((r) => r.kind === 'surface').map((r) => (r.kind === 'surface' ? r.path : ''));
    expect(detail).toEqual([31, 32, 1, 2]);
    expect(plan.requests.find((r) => r.kind === 'sends')).toMatchObject({ channel: 32 });
    expect(surface).toEqual(['/main/st/config', '/main/st/mix', '/bus/01/config', '/bus/01/mix', '/bus/02/config']);
    expect(plan.next).toEqual({ detail: 2, sends: 0, surface: 3 });
  });

  it('never plans more strips than the console has', () => {
    const plan = planSlowTier(INITIAL_SLOW_TIER_CURSOR, 2);
    expect(plan.requests.filter((r) => r.kind === 'detail')).toHaveLength(2);
    expect(plan.next.detail).toBe(0);
  });
});

describe('applyDetailLines', () => {
  const paths = stripDetailPaths(1);

  it('stores preamp, gate and eq from the scene lines with their read time', () => {
    const detail = applyDetailLines(emptyStripDetail(1), paths.map(lineFor), 5000);
    expect(detail.preamp).toEqual({ value: { trim: 0, invert: false, hpf: { on: true, slope: 24, freq: 178 } }, readAt: 5000 });
    expect(detail.gate).toEqual({
      value: { on: true, mode: 'GATE', thr: -80, range: 60, attack: 10, hold: 50.2, release: 258 },
      readAt: 5000,
    });
    expect(detail.eq?.readAt).toBe(5000);
    expect(detail.eq?.value.on).toBe(true);
    expect(detail.eq?.value.bands[1]).toEqual({ type: 'PEQ', freq: '1k09', gain: -8.25, q: 2 });
  });

  it('keeps the previous value and its older read time for every section whose read failed', () => {
    const first = applyDetailLines(emptyStripDetail(1), paths.map(lineFor), 5000);
    const lines = paths.map(lineFor);
    lines[0] = null;
    lines[4] = null;
    const second = applyDetailLines(first, lines, 9000);
    expect(second.preamp?.readAt).toBe(5000);
    expect(second.eq?.readAt).toBe(5000);
    expect(second.gate?.readAt).toBe(9000);
  });

  it('treats an unparsable reply as a failed read', () => {
    const lines = paths.map(lineFor);
    lines[1] = '/ch/01/gate ???';
    expect(applyDetailLines(emptyStripDetail(1), lines, 1).gate).toBeNull();
  });
});

describe('applySendLines', () => {
  const lines = stripSendPaths(1).map(lineFor);

  it('stores all sixteen sends with their read time', () => {
    const detail = applySendLines(emptyStripDetail(1), lines, 7000);
    expect(detail.sends?.readAt).toBe(7000);
    expect(detail.sends?.value).toHaveLength(16);
    expect(detail.sends?.value[0]).toEqual({ bus: 1, on: true, level: -9.8 });
    expect(detail.sends?.value[6]).toEqual({ bus: 7, on: true, level: -Infinity });
  });

  it('keeps the last sends when any one send read failed', () => {
    const first = applySendLines(emptyStripDetail(1), lines, 7000);
    const broken = [...lines];
    broken[9] = null;
    expect(applySendLines(first, broken, 9000).sends?.readAt).toBe(7000);
  });

  it('ignores a reply for another channel', () => {
    expect(applySendLines(emptyStripDetail(2), lines, 7000).sends).toBeNull();
  });

  it('ignores a short batch', () => {
    expect(applySendLines(emptyStripDetail(1), lines.slice(0, 3), 7000).sends).toBeNull();
  });
});

describe('applySurfaceLine', () => {
  it('stores a bus name and a bus mix separately, each with its read time', () => {
    let surfaces = applySurfaceLine(emptySurfaces(), '/bus/02/config', lineFor('/bus/02/config'), 100);
    surfaces = applySurfaceLine(surfaces, '/bus/02/mix', lineFor('/bus/02/mix'), 200);
    expect(surfaces.buses[1]).toEqual({
      kind: 'bus',
      index: 2,
      name: { value: 'IEM1', readAt: 100 },
      mix: { value: { on: true, faderDb: -3.4 }, readAt: 200 },
    });
    expect(surfaces.buses[0].name).toBeNull();
  });

  it('stores Main LR config and mix', () => {
    let surfaces = applySurfaceLine(emptySurfaces(), '/main/st/config', lineFor('/main/st/config'), 1);
    surfaces = applySurfaceLine(surfaces, '/main/st/mix', lineFor('/main/st/mix'), 2);
    expect(surfaces.main.name).toEqual({ value: '', readAt: 1 });
    expect(surfaces.main.mix).toEqual({ value: { on: true, faderDb: -4.3 }, readAt: 2 });
  });

  it('leaves surfaces untouched for a failed read, an unknown path, an unparsable line or a reply for another bus', () => {
    const start = emptySurfaces();
    expect(applySurfaceLine(start, '/bus/01/mix', null, 1)).toBe(start);
    expect(applySurfaceLine(start, '/dca/1/config', '/dca/1/config "X"', 1)).toBe(start);
    expect(applySurfaceLine(start, '/bus/01/mix', 'garbage', 1)).toBe(start);
    expect(applySurfaceLine(start, '/bus/01/config', lineFor('/bus/02/config'), 1)).toBe(start);
  });
});
