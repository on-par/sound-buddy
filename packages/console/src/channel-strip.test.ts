import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseChannelStrips,
  parseFaderToken,
  buildChannelFaderPath,
  buildHeadampGainPath,
  buildDcaFaderPath,
} from './channel-strip.js'

function assertNoNaN(value: unknown, path: string): void {
  if (typeof value === 'number') {
    expect(Number.isNaN(value), `${path} was NaN`).toBe(false)
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoNaN(item, `${path}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      assertNoNaN(v, `${path}.${key}`)
    }
  }
}

describe('parseChannelStrips', () => {
  it('parses name from a /ch/01/config line', () => {
    const strips = parseChannelStrips('/ch/01/config "Vox 1" 1 MG 1')
    expect(strips[0].name).toBe('Vox 1')
  })

  it('parses on and fader from a /ch/01/mix line', () => {
    const strips = parseChannelStrips('/ch/01/mix ON -7.4 ON +0 OFF -oo')
    expect(strips[0].on).toBe(true)
    expect(strips[0].fader).toBe(-7.4)
  })

  it('maps a -oo fader token to -Infinity, not NaN (AC2)', () => {
    const strips = parseChannelStrips('/ch/01/mix OFF   -oo ON +0 OFF   -oo')
    expect(strips[0].fader).toBe(-Infinity)
    expect(Number.isNaN(strips[0].fader)).toBe(false)
  })

  it('parses pan from the 4th /ch/01/mix token', () => {
    const strips = parseChannelStrips('/ch/01/mix ON -7.4 ON +5 OFF -oo')
    expect(strips[0].pan).toBe(5)
  })

  it('parses preamp trim, invert, and hpf fields from a /ch/01/preamp line', () => {
    const strips = parseChannelStrips('/ch/01/preamp +0.0 OFF ON 24 178')
    expect(strips[0].preamp.trim).toBe(0)
    expect(strips[0].preamp.invert).toBe(false)
    expect(strips[0].preamp.hpf.on).toBe(true)
    expect(strips[0].preamp.hpf.slope).toBe(24)
    expect(strips[0].preamp.hpf.freq).toBe(178)
  })

  it('parses all 7 gate fields from a /ch/01/gate line', () => {
    const strips = parseChannelStrips('/ch/01/gate ON GATE -80.0 60.0 10 50.2  258 0')
    expect(strips[0].gate).toEqual({
      on: true,
      mode: 'GATE',
      thr: -80.0,
      range: 60.0,
      attack: 10,
      hold: 50.2,
      release: 258,
    })
  })

  it('parses all 6 dynamics fields, skipping the detector/envelope tokens, from a /ch/01/dyn line', () => {
    const strips = parseChannelStrips(
      '/ch/01/dyn ON COMP PEAK LOG -23.0 5.0 1 0.00 10 10.0  151 POST 0 100 OFF',
    )
    expect(strips[0].dynamics).toEqual({
      on: true,
      mode: 'COMP',
      thr: -23.0,
      ratio: 5.0,
      knee: 1,
      mgain: 0,
    })
  })

  it('parses eq.on from a /ch/01/eq ON line without being confused by a /ch/01/eq/1 band line', () => {
    const strips = parseChannelStrips(['/ch/01/eq/1 PEQ 328.1 -6.25 2.0', '/ch/01/eq ON'].join('\n'))
    expect(strips[0].eq.on).toBe(true)
  })

  it('parses a 4-band EQ, keeping shorthand frequency tokens as raw strings', () => {
    const strips = parseChannelStrips(
      [
        '/ch/01/eq/1 PEQ 328.1 -6.25 2.0',
        '/ch/01/eq/2 PEQ 1k09 -8.25 2.0',
        '/ch/01/eq/3 PEQ 2k43 -9.50 2.0',
        '/ch/01/eq/4 PEQ 10k74 -6.25 2.9',
      ].join('\n'),
    )
    expect(strips[0].eq.bands).toEqual([
      { type: 'PEQ', freq: '328.1', gain: -6.25, q: 2.0 },
      { type: 'PEQ', freq: '1k09', gain: -8.25, q: 2.0 },
      { type: 'PEQ', freq: '2k43', gain: -9.50, q: 2.0 },
      { type: 'PEQ', freq: '10k74', gain: -6.25, q: 2.9 },
    ])
  })

  it('returns one channel strip per distinct /ch/NN index, ordered ascending, with 1-based index', () => {
    const strips = parseChannelStrips(
      ['/ch/03/config "C" 1 MG 1', '/ch/01/config "A" 1 MG 1', '/ch/02/config "B" 1 MG 1'].join('\n'),
    )
    expect(strips.map((s) => s.index)).toEqual([1, 2, 3])
    expect(strips.map((s) => s.name)).toEqual(['A', 'B', 'C'])
  })

  it('parses the committed capture-2026-08-16.scn fixture into exactly 32 channel strips with no NaN fields (AC1)', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const strips = parseChannelStrips(captureText)
    expect(strips).toHaveLength(32)
    strips.forEach((strip, i) => assertNoNaN(strip, `strips[${i}]`))
  })
})

describe('parseFaderToken', () => {
  it('maps "-oo" to -Infinity', () => {
    expect(parseFaderToken('-oo')).toBe(-Infinity)
  })

  it('parses a negative decimal token', () => {
    expect(parseFaderToken('-7.4')).toBe(-7.4)
  })

  it('parses a positive-signed decimal token', () => {
    expect(parseFaderToken('+0.1')).toBe(0.1)
  })
})

describe('buildChannelFaderPath', () => {
  it('pads the channel index to 2 digits and nests under /mix/fader', () => {
    expect(buildChannelFaderPath(1)).toBe('/ch/01/mix/fader')
    expect(buildChannelFaderPath(32)).toBe('/ch/32/mix/fader')
  })
})

describe('buildHeadampGainPath', () => {
  it('pads the headamp index to 3 digits with no mix segment', () => {
    expect(buildHeadampGainPath(0)).toBe('/headamp/000/gain')
    expect(buildHeadampGainPath(127)).toBe('/headamp/127/gain')
  })
})

describe('buildDcaFaderPath', () => {
  it('does not pad the DCA index and has no mix segment', () => {
    expect(buildDcaFaderPath(1)).toBe('/dca/1/fader')
    expect(buildDcaFaderPath(8)).toBe('/dca/8/fader')
  })
})
