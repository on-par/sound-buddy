import { describe, it, expect } from 'vitest';

// playback-routing is a plain classic script (window.playbackRouting / module.exports).
const { defaultRoutes, routeSpec, requiredChannels, needsMixdown } = require('./playback-routing.js') as {
  defaultRoutes: (tracks: Array<{ kind?: string }> | null) => number[][];
  routeSpec: (routes: number[][] | null) => string;
  requiredChannels: (routes: number[][] | null) => number;
  needsMixdown: (routes: number[][] | null, deviceChannels: number, master: boolean) => boolean;
};

const TRACKS = [{ kind: 'mono' }, { kind: 'stereo' }, { kind: 'mono' }];

describe('defaultRoutes', () => {
  it('packs mono→1ch, stereo→pair sequentially', () => {
    expect(defaultRoutes(TRACKS)).toEqual([[0], [1, 2], [3]]);
  });
  it('handles null tracks', () => expect(defaultRoutes(null)).toEqual([]));
});

describe('routeSpec', () => {
  it('builds idx:chan / idx:l-r tokens', () => {
    expect(routeSpec([[0], [1, 2], [3]])).toBe('0:0,1:1-2,2:3');
  });
  it('empty routes → empty string', () => expect(routeSpec([])).toBe(''));
  it('null-safe on a malformed route entry', () => expect(routeSpec([[]])).toBe('0:0'));
});

describe('requiredChannels', () => {
  it('is the highest channel + 1', () => expect(requiredChannels([[0], [1, 2], [3]])).toBe(4));
  it('is 0 for no routes', () => expect(requiredChannels([])).toBe(0));
});

describe('needsMixdown', () => {
  it('true when routing exceeds device channels', () => expect(needsMixdown([[0], [1, 2], [3]], 2, false)).toBe(true));
  it('false when device is big enough', () => expect(needsMixdown([[0], [1, 2], [3]], 4, false)).toBe(false));
  it('true when master forced even on a big device', () => expect(needsMixdown([[0]], 8, true)).toBe(true));
  it('true when deviceChannels missing/zero', () => expect(needsMixdown([[0]], 0, false)).toBe(true));
});
