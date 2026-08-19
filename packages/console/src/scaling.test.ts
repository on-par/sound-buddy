import { describe, it, expect } from 'vitest'
import { oscToOnState, oscToPan } from './scaling.js'

interface OnStateFixture {
  useSite: string // human label, e.g. 'channel on/mute'
  address: string // the OSC address the value would arrive on
  raw: number
  expected: boolean
}

const ON_STATE_FIXTURES: OnStateFixture[] = [
  // channel on/mute use site
  { useSite: 'channel on/mute', address: '/ch/01/mix/on', raw: 1, expected: true },
  { useSite: 'channel on/mute', address: '/ch/01/mix/on', raw: 0, expected: false },
  { useSite: 'channel on/mute', address: '/ch/01/mix/on', raw: 1.0, expected: true },
  { useSite: 'channel on/mute', address: '/ch/01/mix/on', raw: 0.0, expected: false },
  // phantom power use site -- per headamp, not per channel; same semantics
  { useSite: 'phantom power', address: '/headamp/000/phantom', raw: 1, expected: true },
  { useSite: 'phantom power', address: '/headamp/000/phantom', raw: 0, expected: false },
]

describe('oscToOnState -- on state conversion', () => {
  for (const f of ON_STATE_FIXTURES) {
    it(`resolves ${f.useSite} (${f.address}) raw ${f.raw} to ${f.expected}`, () => {
      expect(oscToOnState(f.raw)).toBe(f.expected)
    })
  }

  it('returns true for the on value (AC1)', () => {
    expect(oscToOnState(1)).toBe(true)
  })

  it('returns false for the off value (AC2)', () => {
    expect(oscToOnState(0)).toBe(false)
  })

  it('resolves phantom power identically to channel on/mute, with no special-casing (AC3)', () => {
    const channelFixtures = ON_STATE_FIXTURES.filter((f) => f.useSite === 'channel on/mute')
    const phantomFixtures = ON_STATE_FIXTURES.filter((f) => f.useSite === 'phantom power')

    for (const phantom of phantomFixtures) {
      const matchingChannel = channelFixtures.find((f) => f.raw === phantom.raw)
      if (!matchingChannel) continue
      expect(phantom.expected).toBe(matchingChannel.expected)
      expect(oscToOnState(phantom.raw)).toBe(phantom.expected)
    }
  })

  it('treats a value below the threshold as off', () => {
    expect(oscToOnState(0.49)).toBe(false)
  })

  it('treats a value at the threshold as on', () => {
    expect(oscToOnState(0.5)).toBe(true)
  })

  it('treats a negative value as off rather than throwing', () => {
    expect(oscToOnState(-1)).toBe(false)
  })

  it('treats NaN as off rather than throwing', () => {
    expect(oscToOnState(NaN)).toBe(false)
  })
})

interface PanFixture {
  label: string // human label, e.g. 'hard left'
  raw: number // the normalized OSC value on /ch/NN/mix/pan
  expected: number // the console's displayed position, -100..+100
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const PAN_FIXTURES: PanFixture[] = [
  { label: 'hard left', raw: 0, expected: -100 },
  { label: 'half left', raw: 0.25, expected: -50 },
  { label: 'center', raw: 0.5, expected: 0 },
  { label: 'half right', raw: 0.75, expected: 50 },
  { label: 'hard right', raw: 1, expected: 100 },
]

const PAN_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToPan -- pan position conversion', () => {
  for (const f of PAN_FIXTURES) {
    it(`converts ${f.label} pan raw ${f.raw} to ${f.expected}`, () => {
      expect(oscToPan(f.raw)).toBeCloseTo(f.expected, PAN_PRECISION)
    })
  }

  it('converts the center pan value to 0 (AC1)', () => {
    expect(oscToPan(0.5)).toBeCloseTo(0, PAN_PRECISION)
  })

  it('holds the pan range boundaries at -100 and +100 (AC2)', () => {
    expect(oscToPan(0)).toBeCloseTo(-100, PAN_PRECISION)
    expect(oscToPan(1)).toBeCloseTo(100, PAN_PRECISION)
  })

  it('is monotonically increasing across the pan range', () => {
    const positions = PAN_FIXTURES.map((f) => oscToPan(f.raw))
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })
})
