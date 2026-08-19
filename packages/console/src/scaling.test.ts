import { describe, it, expect } from 'vitest'
import { oscToOnState } from './scaling.js'

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
