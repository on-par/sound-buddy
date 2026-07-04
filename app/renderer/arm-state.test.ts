import { describe, it, expect } from 'vitest';

// arm-state is a plain classic script (window.armState / module.exports) so the
// arm/token rules are exercised without a DOM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stripToken, isArmed, allTokens, armedTokens, armedCount, setAllArmed } = require('./arm-state.js') as {
  stripToken: (s: Strip) => string;
  isArmed: (s: Strip | null) => boolean;
  allTokens: (cfg: Strip[] | null) => string[];
  armedTokens: (cfg: Strip[] | null) => string[];
  armedCount: (cfg: Strip[] | null) => number;
  setAllArmed: (cfg: Strip[] | null, armed: boolean) => Strip[];
};
type Strip = { kind: string; a: number; b: number; armed?: boolean };

const CFG: Strip[] = [
  { kind: 'mono', a: 0, b: 0, armed: true },
  { kind: 'stereo', a: 2, b: 3, armed: false },
  { kind: 'mono', a: 4, b: 4 }, // armed flag absent → default-armed
];

describe('stripToken', () => {
  it('mono → single index', () => expect(stripToken({ kind: 'mono', a: 0, b: 0 })).toBe('0'));
  it('stereo distinct legs → pair', () => expect(stripToken({ kind: 'stereo', a: 2, b: 3 })).toBe('2-3'));
  it('stereo collapsed to one channel → mono token', () => expect(stripToken({ kind: 'stereo', a: 5, b: 5 })).toBe('5'));
});

describe('isArmed (default-armed)', () => {
  it('true when flag absent', () => expect(isArmed({ kind: 'mono', a: 0, b: 0 })).toBe(true));
  it('true when explicitly armed', () => expect(isArmed({ kind: 'mono', a: 0, b: 0, armed: true })).toBe(true));
  it('false only when explicitly disarmed', () => expect(isArmed({ kind: 'mono', a: 0, b: 0, armed: false })).toBe(false));
  it('false for null', () => expect(isArmed(null)).toBe(false));
});

describe('allTokens / armedTokens', () => {
  it('allTokens covers every strip', () => expect(allTokens(CFG)).toEqual(['0', '2-3', '4']));
  it('armedTokens drops the disarmed strip, keeps default-armed', () => expect(armedTokens(CFG)).toEqual(['0', '4']));
  it('empty/null config → no tokens', () => { expect(armedTokens(null)).toEqual([]); expect(allTokens(null)).toEqual([]); });
});

describe('armedCount', () => {
  it('counts armed (incl. default-armed)', () => expect(armedCount(CFG)).toBe(2));
  it('zero for null', () => expect(armedCount(null)).toBe(0));
});

describe('setAllArmed', () => {
  it('arms all', () => expect(setAllArmed(CFG, true).map(isArmed)).toEqual([true, true, true]));
  it('disarms all', () => expect(setAllArmed(CFG, false).map(isArmed)).toEqual([false, false, false]));
  it('does not mutate input', () => { setAllArmed(CFG, false); expect(CFG[0].armed).toBe(true); });
  it('null config → empty array', () => expect(setAllArmed(null, true)).toEqual([]));
});
