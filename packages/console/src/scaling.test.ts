import { describe, it, expect } from 'vitest'
import {
  oscToOnState,
  oscToPan,
  oscToTrimDb,
  oscToHeadampGainDb,
  oscToGateThresholdDb,
  oscToGateRangeDb,
  oscToDynamicsThresholdDb,
  oscToHpfHz,
  oscToEqFreqHz,
  oscToEqGainDb,
  oscToEqQ,
  oscToLevelDb,
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

interface GateRangeFixture {
  label: string // human label, e.g. 'minimum range'
  raw: number // the normalized OSC value on the channel gate's range parameter
  expected: number // the console's displayed gate range in dB, 3..60
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const GATE_RANGE_FIXTURES: GateRangeFixture[] = [
  { label: 'minimum range', raw: 0, expected: 3 },
  { label: 'quarter travel', raw: 0.25, expected: 17.25 },
  { label: 'range midpoint', raw: 0.5, expected: 31.5 },
  { label: 'three-quarter travel', raw: 0.75, expected: 45.75 },
  { label: 'maximum range', raw: 1, expected: 60 },
]

const GATE_RANGE_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToGateRangeDb -- gate range conversion', () => {
  for (const f of GATE_RANGE_FIXTURES) {
    it(`converts ${f.label} gate range raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToGateRangeDb(f.raw)).toBeCloseTo(f.expected, GATE_RANGE_PRECISION)
    })
  }

  it('converts the minimum gate range value to 3 dB (AC1)', () => {
    expect(oscToGateRangeDb(0)).toBeCloseTo(3, GATE_RANGE_PRECISION)
  })

  it('holds the gate range boundary at 60 dB (AC2)', () => {
    expect(oscToGateRangeDb(1)).toBeCloseTo(60, GATE_RANGE_PRECISION)
  })

  it('is monotonically increasing across the gate range', () => {
    const ranges = GATE_RANGE_FIXTURES.map((f) => oscToGateRangeDb(f.raw))
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]).toBeGreaterThan(ranges[i - 1])
    }
  })

  it('is a distinct conversion from gate threshold -- range is attenuation depth, not a trigger level', () => {
    expect(oscToGateRangeDb(0)).not.toBeCloseTo(
      oscToGateThresholdDb(0),
      GATE_RANGE_PRECISION,
    )
    expect(oscToGateRangeDb(1)).not.toBeCloseTo(
      oscToGateThresholdDb(1),
      GATE_RANGE_PRECISION,
    )
  })
})

interface DynamicsThresholdFixture {
  label: string // human label for the point on the range
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed dynamics threshold in dB, -60..0
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const DYNAMICS_THRESHOLD_FIXTURES: DynamicsThresholdFixture[] = [
  { label: 'minimum threshold', raw: 0, expected: -60 },
  { label: 'quarter travel', raw: 0.25, expected: -45 },
  { label: 'range midpoint', raw: 0.5, expected: -30 },
  { label: 'three-quarter travel', raw: 0.75, expected: -15 },
  { label: 'maximum threshold', raw: 1, expected: 0 },
]

const DYNAMICS_THRESHOLD_PRECISION = 10 // decimal places for toBeCloseTo

describe('oscToDynamicsThresholdDb -- dynamics threshold conversion', () => {
  for (const f of DYNAMICS_THRESHOLD_FIXTURES) {
    it(`converts ${f.label} dynamics threshold raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToDynamicsThresholdDb(f.raw)).toBeCloseTo(
        f.expected,
        DYNAMICS_THRESHOLD_PRECISION,
      )
    })
  }

  it('converts the minimum dynamics threshold value to -60 dB (AC1)', () => {
    expect(oscToDynamicsThresholdDb(0)).toBeCloseTo(-60, DYNAMICS_THRESHOLD_PRECISION)
  })

  it('holds the dynamics threshold boundary at 0 dB (AC2)', () => {
    expect(oscToDynamicsThresholdDb(1)).toBeCloseTo(0, DYNAMICS_THRESHOLD_PRECISION)
  })

  it('is monotonically increasing across the dynamics threshold range', () => {
    const thresholds = DYNAMICS_THRESHOLD_FIXTURES.map((f) =>
      oscToDynamicsThresholdDb(f.raw),
    )
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeGreaterThan(thresholds[i - 1])
    }
  })

  it('is a distinct conversion from gate threshold -- the dynamics floor is -60, the gate floor is -80', () => {
    expect(oscToDynamicsThresholdDb(0)).not.toBeCloseTo(
      oscToGateThresholdDb(0),
      DYNAMICS_THRESHOLD_PRECISION,
    )
  })
})

interface HpfFixture {
  label: string // human label for the point on the sweep
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed HPF cutoff in Hz, 20..400
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold. The interior expectations are
// irrational (20 * 20 ** 0.25 and friends), so they are written to more
// digits than HPF_PRECISION asserts.
const HPF_FIXTURES: HpfFixture[] = [
  { label: 'minimum cutoff', raw: 0, expected: 20 },
  { label: 'quarter travel', raw: 0.25, expected: 42.294850537622565 },
  { label: 'sweep midpoint', raw: 0.5, expected: 89.44271909999159 },
  { label: 'three-quarter travel', raw: 0.75, expected: 189.14832180063516 },
  { label: 'maximum cutoff', raw: 1, expected: 400 },
]

const HPF_PRECISION = 8 // decimal places for toBeCloseTo

// The arithmetic midpoint of 20..400 Hz -- what a linear sweep would return at
// f = 0.5, and what this logarithmic conversion must NOT return.
const HPF_LINEAR_MIDPOINT_HZ = 210

describe('oscToHpfHz -- channel HPF cutoff conversion', () => {
  for (const f of HPF_FIXTURES) {
    it(`converts ${f.label} hpf raw ${f.raw} to ${f.expected} Hz`, () => {
      expect(oscToHpfHz(f.raw)).toBeCloseTo(f.expected, HPF_PRECISION)
    })
  }

  it('converts the minimum hpf value to 20 Hz (AC1)', () => {
    expect(oscToHpfHz(0)).toBeCloseTo(20, HPF_PRECISION)
  })

  it('holds the hpf range boundary at 400 Hz (AC2)', () => {
    expect(oscToHpfHz(1)).toBeCloseTo(400, HPF_PRECISION)
  })

  it('is monotonically increasing across the hpf sweep', () => {
    const cutoffs = HPF_FIXTURES.map((f) => oscToHpfHz(f.raw))
    for (let i = 1; i < cutoffs.length; i++) {
      expect(cutoffs[i]).toBeGreaterThan(cutoffs[i - 1])
    }
  })

  it('sweeps logarithmically, not linearly -- the midpoint is well below the arithmetic mean', () => {
    expect(oscToHpfHz(0.5)).toBeLessThan(HPF_LINEAR_MIDPOINT_HZ)
  })

  it('spans a constant ratio per unit of travel -- equal steps multiply, not add', () => {
    const quarterStepRatio = oscToHpfHz(0.5) / oscToHpfHz(0.25)
    const nextStepRatio = oscToHpfHz(0.75) / oscToHpfHz(0.5)
    expect(quarterStepRatio).toBeCloseTo(nextStepRatio, HPF_PRECISION)
  })
})

interface EqFreqFixture {
  label: string // human label for the point on the sweep
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed band centre in Hz, 20..20000
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold. The interior expectations are
// irrational (20 * 1000 ** 0.25 and friends), so they are written to more
// digits than EQ_FREQ_PRECISION asserts.
const EQ_FREQ_FIXTURES: EqFreqFixture[] = [
  { label: 'minimum centre', raw: 0, expected: 20 },
  { label: 'quarter travel', raw: 0.25, expected: 112.46826503806983 },
  { label: 'sweep midpoint', raw: 0.5, expected: 632.4555320336758 },
  { label: 'three-quarter travel', raw: 0.75, expected: 3556.5588200778457 },
  { label: 'maximum centre', raw: 1, expected: 20000 },
]

const EQ_FREQ_PRECISION = 6 // decimal places for toBeCloseTo

// The arithmetic midpoint of 20..20000 Hz -- what a linear sweep would return
// at f = 0.5, and what this logarithmic conversion must NOT return.
const EQ_FREQ_LINEAR_MIDPOINT_HZ = 10010

describe('oscToEqFreqHz -- EQ band centre frequency conversion', () => {
  for (const f of EQ_FREQ_FIXTURES) {
    it(`converts ${f.label} eq freq raw ${f.raw} to ${f.expected} Hz`, () => {
      expect(oscToEqFreqHz(f.raw)).toBeCloseTo(f.expected, EQ_FREQ_PRECISION)
    })
  }

  it('converts the minimum eq freq value to 20 Hz (AC1)', () => {
    expect(oscToEqFreqHz(0)).toBeCloseTo(20, EQ_FREQ_PRECISION)
  })

  it('holds the eq freq range boundary at 20000 Hz (AC2)', () => {
    expect(oscToEqFreqHz(1)).toBeCloseTo(20000, EQ_FREQ_PRECISION)
  })

  it('is monotonically increasing across the eq freq sweep', () => {
    const centres = EQ_FREQ_FIXTURES.map((f) => oscToEqFreqHz(f.raw))
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i]).toBeGreaterThan(centres[i - 1])
    }
  })

  it('sweeps logarithmically, not linearly -- the midpoint is well below the arithmetic mean', () => {
    expect(oscToEqFreqHz(0.5)).toBeLessThan(EQ_FREQ_LINEAR_MIDPOINT_HZ)
  })

  it('spans a constant ratio per unit of travel -- equal steps multiply, not add', () => {
    const quarterStepRatio = oscToEqFreqHz(0.5) / oscToEqFreqHz(0.25)
    const nextStepRatio = oscToEqFreqHz(0.75) / oscToEqFreqHz(0.5)
    expect(quarterStepRatio).toBeCloseTo(nextStepRatio, EQ_FREQ_PRECISION)
  })
})

interface EqGainFixture {
  label: string // human label for the point on the range
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed band gain in dB, -15..+15
}

// Boundary + representative interior points. Asserted with toBeCloseTo, not
// toBe: the constitution forbids floating-point comparison without epsilon
// tolerance, so one rule applies uniformly to every row rather than only the
// rows where exactness happens to hold.
const EQ_GAIN_FIXTURES: EqGainFixture[] = [
  { label: 'maximum cut', raw: 0, expected: -15 },
  { label: 'quarter travel', raw: 0.25, expected: -7.5 },
  { label: 'flat', raw: 0.5, expected: 0 },
  { label: 'three-quarter travel', raw: 0.75, expected: 7.5 },
  { label: 'maximum boost', raw: 1, expected: 15 },
]

const EQ_GAIN_PRECISION = 6 // decimal places for toBeCloseTo

describe('oscToEqGainDb -- EQ band gain conversion', () => {
  for (const f of EQ_GAIN_FIXTURES) {
    it(`converts ${f.label} eq gain raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToEqGainDb(f.raw)).toBeCloseTo(f.expected, EQ_GAIN_PRECISION)
    })
  }

  it('converts the eq gain centre to 0 dB -- flat (AC1)', () => {
    expect(oscToEqGainDb(0.5)).toBeCloseTo(0, EQ_GAIN_PRECISION)
  })

  it('holds the eq gain range boundaries at -15 and +15 dB (AC2)', () => {
    expect(oscToEqGainDb(0)).toBeCloseTo(-15, EQ_GAIN_PRECISION)
    expect(oscToEqGainDb(1)).toBeCloseTo(15, EQ_GAIN_PRECISION)
  })

  it('is monotonically increasing across the eq gain range', () => {
    const gains = EQ_GAIN_FIXTURES.map((f) => oscToEqGainDb(f.raw))
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeGreaterThan(gains[i - 1])
    }
  })

  it('is linear -- equal steps of travel add equal dB, unlike the frequency sweeps', () => {
    const firstStep = oscToEqGainDb(0.5) - oscToEqGainDb(0.25)
    const nextStep = oscToEqGainDb(0.75) - oscToEqGainDb(0.5)
    expect(firstStep).toBeCloseTo(nextStep, EQ_GAIN_PRECISION)
  })

  it('is symmetric about the flat centre -- equal cut and boost at mirrored inputs', () => {
    expect(oscToEqGainDb(0.25)).toBeCloseTo(-oscToEqGainDb(0.75), EQ_GAIN_PRECISION)
  })
})

interface EqQFixture {
  label: string // human label for the point on the range
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed band Q, 10..0.3 (unitless)
}

// Boundary + representative interior points. Interior values are the formula's
// own output at quarter-travel steps, carried to enough places for the
// toBeCloseTo tolerance below. Asserted with toBeCloseTo, not toBe: the
// constitution forbids floating-point comparison without epsilon tolerance, so
// one rule applies uniformly to every row rather than only the rows where
// exactness happens to hold.
const EQ_Q_FIXTURES: EqQFixture[] = [
  { label: 'widest bandwidth', raw: 0, expected: 10 },
  { label: 'quarter travel', raw: 0.25, expected: 4.161791 },
  { label: 'sweep midpoint', raw: 0.5, expected: 1.732051 },
  { label: 'three-quarter travel', raw: 0.75, expected: 0.720843 },
  { label: 'narrowest bandwidth', raw: 1, expected: 0.3 },
]

const EQ_Q_PRECISION = 5 // decimal places for toBeCloseTo

// The arithmetic midpoint of the 10..0.3 range -- what a linear sweep would
// return at f = 0.5, and what this exponential conversion must NOT return.
const EQ_Q_LINEAR_MIDPOINT = 5.15

describe('oscToEqQ -- EQ band eq q conversion', () => {
  for (const f of EQ_Q_FIXTURES) {
    it(`converts ${f.label} eq q raw ${f.raw} to Q ${f.expected}`, () => {
      expect(oscToEqQ(f.raw)).toBeCloseTo(f.expected, EQ_Q_PRECISION)
    })
  }

  it('converts the minimum eq q value to Q 10 (AC1)', () => {
    expect(oscToEqQ(0)).toBeCloseTo(10, EQ_Q_PRECISION)
  })

  it('holds the eq q range boundary at Q 0.3 (AC2)', () => {
    expect(oscToEqQ(1)).toBeCloseTo(0.3, EQ_Q_PRECISION)
  })

  it('is monotonically decreasing across the eq q sweep -- more travel means narrower', () => {
    const qs = EQ_Q_FIXTURES.map((f) => oscToEqQ(f.raw))
    for (let i = 1; i < qs.length; i++) {
      expect(qs[i]).toBeLessThan(qs[i - 1])
    }
  })

  it('sweeps exponentially, not linearly -- the eq q midpoint is well below the arithmetic mean', () => {
    expect(oscToEqQ(0.5)).toBeLessThan(EQ_Q_LINEAR_MIDPOINT)
  })

  it('divides by a constant ratio per unit of eq q travel -- equal steps multiply, not subtract', () => {
    const quarterStepRatio = oscToEqQ(0.5) / oscToEqQ(0.25)
    const nextStepRatio = oscToEqQ(0.75) / oscToEqQ(0.5)
    expect(quarterStepRatio).toBeCloseTo(nextStepRatio, EQ_Q_PRECISION)
  })
})

interface LevelFixture {
  label: string // human label for the point on the taper
  raw: number // the raw OSC float, 0..1
  expected: number // the console's displayed level in dB
}

// Measured console readings from the #848 discovery session -- real float/dB
// pairs read off the desk, not formula output. These are the story's acceptance
// criteria and are asserted to the 0.05 dB tolerance the issue specifies.
const LEVEL_MEASURED_FIXTURES: LevelFixture[] = [
  { label: 'near-unity level', raw: 0.522972, expected: -9.1 },
  { label: 'low-mid level', raw: 0.357771, expected: -21.4 },
  { label: 'near top of range', raw: 0.642229, expected: -4.3 },
]

// toBeCloseTo(expected, 1) passes when |actual - expected| < 0.05 -- exactly
// the tolerance the issue specifies for the measured breakpoints, expressed in
// the same form the sibling conversions above use.
const LEVEL_MEASURED_PRECISION = 1

// Segment boundaries and representative interior points. Values here are the
// formula's own output, carried to enough places for the tolerance below.
// Asserted with toBeCloseTo, not toBe: the constitution forbids
// floating-point comparison without epsilon tolerance, so one rule applies
// uniformly to every row rather than only the rows where exactness happens to
// hold.
const LEVEL_SEGMENT_FIXTURES: LevelFixture[] = [
  { label: 'bottom of the in-scope range', raw: 0.0625, expected: -60 },
  { label: 'lower segment interior', raw: 0.15, expected: -46 },
  { label: 'lower/mid segment boundary', raw: 0.25, expected: -30 },
  { label: 'mid segment interior', raw: 0.375, expected: -20 },
  { label: 'mid/upper segment boundary', raw: 0.5, expected: -10 },
  { label: 'upper segment interior', raw: 0.75, expected: 0 },
  { label: 'maximum level', raw: 1, expected: 10 },
]

const LEVEL_PRECISION = 6 // decimal places for toBeCloseTo

// The floor segment, below the lowest measured breakpoint. Expected values are
// the formula's own output; the 0.0625 row is carried over deliberately, since
// its -60 dB is the continuity check against the segment above.
const LEVEL_FLOOR_SEGMENT_FIXTURES: LevelFixture[] = [
  { label: 'just above the floor', raw: 0.0001, expected: -89.952 },
  { label: 'floor segment interior', raw: 0.03, expected: -75.6 },
  { label: 'floor/lower segment boundary', raw: 0.0625, expected: -60 },
]

describe('oscToLevelDb -- fader and send level conversion', () => {
  for (const f of LEVEL_MEASURED_FIXTURES) {
    it(`converts measured fader reading raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToLevelDb(f.raw)).toBeCloseTo(f.expected, LEVEL_MEASURED_PRECISION)
    })
  }

  it('matches the measured fader breakpoint for near-unity level (AC1)', () => {
    expect(oscToLevelDb(0.522972)).toBeCloseTo(-9.1, LEVEL_MEASURED_PRECISION)
  })

  it('matches the measured fader breakpoint for low-mid level (AC2)', () => {
    expect(oscToLevelDb(0.357771)).toBeCloseTo(-21.4, LEVEL_MEASURED_PRECISION)
  })

  it('matches the measured fader breakpoint near top of range (AC3)', () => {
    expect(oscToLevelDb(0.642229)).toBeCloseTo(-4.3, LEVEL_MEASURED_PRECISION)
  })

  for (const f of LEVEL_SEGMENT_FIXTURES) {
    it(`converts ${f.label} fader raw ${f.raw} to ${f.expected} dB`, () => {
      expect(oscToLevelDb(f.raw)).toBeCloseTo(f.expected, LEVEL_PRECISION)
    })
  }

  it('holds the fader range top at +10 dB', () => {
    expect(oscToLevelDb(1)).toBeCloseTo(10, LEVEL_PRECISION)
  })

  it('is monotonically increasing across the in-scope fader taper', () => {
    const levels = LEVEL_SEGMENT_FIXTURES.map((f) => oscToLevelDb(f.raw))
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1])
    }
  })

  it('is linear within the upper fader segment -- equal steps of travel add equal dB', () => {
    const firstStep = oscToLevelDb(0.75) - oscToLevelDb(0.625)
    const nextStep = oscToLevelDb(0.875) - oscToLevelDb(0.75)
    expect(firstStep).toBeCloseTo(nextStep, LEVEL_PRECISION)
  })

  it('steepens toward the bottom of the fader taper -- the lower segment adds more dB per unit than the upper', () => {
    const upperSlope = oscToLevelDb(0.75) - oscToLevelDb(0.5)
    const lowerSlope = oscToLevelDb(0.25) - oscToLevelDb(0.0625)
    expect(lowerSlope / (0.25 - 0.0625)).toBeGreaterThan(upperSlope / (0.75 - 0.5))
  })

  it('resolves a NaN fader value to NaN rather than throwing', () => {
    expect(oscToLevelDb(NaN)).toBeNaN()
  })

  for (const f of LEVEL_FLOOR_SEGMENT_FIXTURES) {
    it(`applies the floor segment formula to ${f.label} fader raw ${f.raw} -> ${f.expected} dB`, () => {
      expect(oscToLevelDb(f.raw)).toBeCloseTo(f.expected, LEVEL_PRECISION)
    })
  }

  it('floors a fully-down fader to -Infinity rather than a misleading number (AC1)', () => {
    expect(oscToLevelDb(0)).toBe(-Infinity)
    expect(oscToLevelDb(0)).not.toBeNaN()
  })

  it('floors a negative fader value to -Infinity', () => {
    expect(oscToLevelDb(-0.5)).toBe(-Infinity)
  })

  it('floors -Infinity itself to -Infinity', () => {
    expect(oscToLevelDb(-Infinity)).toBe(-Infinity)
  })

  it('applies the steep floor-segment slope between the stop and 0.0625 (AC2)', () => {
    expect(oscToLevelDb(0.03)).toBeCloseTo(0.03 * 480 - 90, LEVEL_PRECISION)
  })

  it('meets the segment above it exactly at the floor breakpoint', () => {
    expect(oscToLevelDb(0.0625)).toBeCloseTo(-60, LEVEL_PRECISION)
    expect(oscToLevelDb(0.0624)).toBeLessThan(oscToLevelDb(0.0625))
  })

  it('returns no NaN for any finite fader input, floor included', () => {
    const raws = [-1, -0.5, 0, 0.0001, 0.03, 0.0625, 0.15, 0.25, 0.5, 0.75, 1]
    for (const raw of raws) {
      expect(oscToLevelDb(raw)).not.toBeNaN()
    }
  })

  it('steepens below the floor breakpoint -- the floor segment adds more dB per unit than the segment above', () => {
    const floorSlope = (oscToLevelDb(0.0625) - oscToLevelDb(0.03)) / (0.0625 - 0.03)
    const lowerSlope = (oscToLevelDb(0.25) - oscToLevelDb(0.0625)) / (0.25 - 0.0625)
    expect(floorSlope).toBeGreaterThan(lowerSlope)
  })
})
