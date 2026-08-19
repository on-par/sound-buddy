import { describe, it, expect } from 'vitest'
import {
  oscToOnState,
  oscToPan,
  oscToTrimDb,
  oscToHeadampGainDb,
  oscToGateThresholdDb,
} from './scaling.js'

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

interface TrimFixture {
  label: string // human label, e.g. 'minimum trim'
  raw: number // the normalized OSC value on the channel's preamp trim
  expected: number // the console's displayed trim gain in dB, -18..+18
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const TRIM_FIXTURES: TrimFixture[] = [
  { label: 'minimum trim', raw: 0, expected: -18 },
  { label: 'half cut', raw: 0.25, expected: -9 },
  { label: 'unity', raw: 0.5, expected: 0 },
  { label: 'half boost', raw: 0.75, expected: 9 },
  { label: 'maximum trim', raw: 1, expected: 18 },
]

const TRIM_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToTrimDb -- preamp trim gain conversion', () => {
  for (const f of TRIM_FIXTURES) {
    it(`converts ${f.label} trim raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToTrimDb(f.raw)).toBeCloseTo(f.expected, TRIM_PRECISION)
    })
  }

  it('converts the unity trim value to 0 dB (AC1)', () => {
    expect(oscToTrimDb(0.5)).toBeCloseTo(0, TRIM_PRECISION)
  })

  it('holds the trim range boundaries at -18 and +18 dB (AC2)', () => {
    expect(oscToTrimDb(0)).toBeCloseTo(-18, TRIM_PRECISION)
    expect(oscToTrimDb(1)).toBeCloseTo(18, TRIM_PRECISION)
  })

  it('is monotonically increasing across the trim range', () => {
    const gains = TRIM_FIXTURES.map((f) => oscToTrimDb(f.raw))
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeGreaterThan(gains[i - 1])
    }
  })
})

interface HeadampGainFixture {
  label: string // human label, e.g. 'minimum gain'
  raw: number // the normalized OSC value on /headamp/NNN/gain
  expected: number // the console's displayed headamp gain in dB, -12..+60
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const HEADAMP_GAIN_FIXTURES: HeadampGainFixture[] = [
  { label: 'minimum gain', raw: 0, expected: -12 },
  { label: 'quarter travel', raw: 0.25, expected: 6 },
  { label: 'range midpoint', raw: 0.5, expected: 24 },
  { label: 'three-quarter travel', raw: 0.75, expected: 42 },
  { label: 'maximum gain', raw: 1, expected: 60 },
]

const HEADAMP_GAIN_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToHeadampGainDb -- headamp (mic preamp) gain conversion', () => {
  for (const f of HEADAMP_GAIN_FIXTURES) {
    it(`converts ${f.label} headamp raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToHeadampGainDb(f.raw)).toBeCloseTo(f.expected, HEADAMP_GAIN_PRECISION)
    })
  }

  it('converts the minimum headamp value to -12 dB (AC1)', () => {
    expect(oscToHeadampGainDb(0)).toBeCloseTo(-12, HEADAMP_GAIN_PRECISION)
  })

  it('holds the headamp range boundary at +60 dB (AC2)', () => {
    expect(oscToHeadampGainDb(1)).toBeCloseTo(60, HEADAMP_GAIN_PRECISION)
  })

  it('is monotonically increasing across the headamp range', () => {
    const gains = HEADAMP_GAIN_FIXTURES.map((f) => oscToHeadampGainDb(f.raw))
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeGreaterThan(gains[i - 1])
    }
  })

  it('is a distinct conversion from channel trim -- the hardware preamp is not the digital stage', () => {
    expect(oscToHeadampGainDb(0)).not.toBeCloseTo(oscToTrimDb(0), HEADAMP_GAIN_PRECISION)
    expect(oscToHeadampGainDb(1)).not.toBeCloseTo(oscToTrimDb(1), HEADAMP_GAIN_PRECISION)
  })
})

interface GateThresholdFixture {
  label: string // human label, e.g. 'minimum threshold'
  raw: number // the normalized OSC value on the channel gate's threshold
  expected: number // the console's displayed gate threshold in dB, -80..0
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const GATE_THRESHOLD_FIXTURES: GateThresholdFixture[] = [
  { label: 'minimum threshold', raw: 0, expected: -80 },
  { label: 'quarter travel', raw: 0.25, expected: -60 },
  { label: 'range midpoint', raw: 0.5, expected: -40 },
  { label: 'three-quarter travel', raw: 0.75, expected: -20 },
  { label: 'maximum threshold', raw: 1, expected: 0 },
]

const GATE_THRESHOLD_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToGateThresholdDb -- gate threshold conversion', () => {
  for (const f of GATE_THRESHOLD_FIXTURES) {
    it(`converts ${f.label} gate threshold raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToGateThresholdDb(f.raw)).toBeCloseTo(f.expected, GATE_THRESHOLD_PRECISION)
    })
  }

  it('converts the minimum gate threshold value to -80 dB (AC1)', () => {
    expect(oscToGateThresholdDb(0)).toBeCloseTo(-80, GATE_THRESHOLD_PRECISION)
  })

  it('holds the gate threshold range boundary at 0 dB (AC2)', () => {
    expect(oscToGateThresholdDb(1)).toBeCloseTo(0, GATE_THRESHOLD_PRECISION)
  })

  it('is monotonically increasing across the gate threshold range', () => {
    const thresholds = GATE_THRESHOLD_FIXTURES.map((f) => oscToGateThresholdDb(f.raw))
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeGreaterThan(thresholds[i - 1])
    }
  })

  it('is a distinct conversion from headamp gain -- a threshold is not a preamp gain', () => {
    expect(oscToGateThresholdDb(0)).not.toBeCloseTo(
      oscToHeadampGainDb(0),
      GATE_THRESHOLD_PRECISION,
    )
    expect(oscToGateThresholdDb(1)).not.toBeCloseTo(
      oscToHeadampGainDb(1),
      GATE_THRESHOLD_PRECISION,
    )
  })
})
