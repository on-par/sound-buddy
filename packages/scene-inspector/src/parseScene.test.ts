import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseScene } from './index.js'

const VALID_HEADER = '#4.0# "TPC Sunday" "" %000000000 1'

const CAPTURE_PATH = new URL('../../console/src/capture-2026-08-16.scn', import.meta.url)
const CAPTURE = readFileSync(CAPTURE_PATH, 'utf8')

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

describe('parseScene', () => {
  it('parses scene name and version from header', () => {
    const result = parseScene(VALID_HEADER)
    expect(result.name).toBe('TPC Sunday')
    expect(result.version).toBe('4.0')
  })

  it('parses channel mix on state and fader level', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/mix ON -7.4 ON +0 OFF -oo',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].mix.on).toBe(true)
    expect(result.channels[0].mix.fader).toBe(-7.4)
  })

  it('parses channel mix muted (off) state', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/mix OFF -7.4 ON +0 OFF -oo',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].mix.on).toBe(false)
  })

  it('parses preamp gain', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/preamp +0.0 OFF ON 24 132',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].preamp.gain).toBe(0.0)
  })

  it('parses EQ bands', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/eq/1 PEQ 116.4 -0.50 2.0',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].eq.bands[0]).toEqual({
      type: 'PEQ',
      freq: 116.4,
      gain: -0.5,
      q: 2.0,
    })
  })

  it('parses DCA state from two lines', () => {
    const content = [
      VALID_HEADER,
      '/dca/3 ON -5.8',
      '/dca/3/config "Band" 70 BL',
    ].join('\n')
    const result = parseScene(content)
    expect(result.dcas[2]).toEqual({ on: true, level: -5.8, name: 'Band' })
  })

  it('parses channel config name', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/config "Vox 1" 1 RD 1',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].name).toBe('Vox 1')
  })

  it('falls back to the raw token for an unquoted channel config name', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/config Vox1 1 RD 1',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].name).toBe('Vox1')
  })

  it('throws ParseError for invalid file', () => {
    expect(() => parseScene('not a scene file')).toThrow('not a valid M32R scene file')
  })

  it('parses a -oo fader as -Infinity, never NaN (#887)', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/mix OFF   -oo ON +0 OFF   -oo',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].mix.fader).toBe(Number.NEGATIVE_INFINITY)
    expect(Number.isNaN(result.channels[0].mix.fader)).toBe(false)
  })

  it('parses a -oo DCA level as -Infinity (#887)', () => {
    const content = [
      VALID_HEADER,
      '/dca/3 ON   -oo',
    ].join('\n')
    const result = parseScene(content)
    expect(result.dcas[2].level).toBe(Number.NEGATIVE_INFINITY)
  })

  it('floors an unreadable numeric token to 0 instead of NaN (#887)', () => {
    const content = [
      VALID_HEADER,
      '/ch/01/mix ON -',
    ].join('\n')
    const result = parseScene(content)
    expect(result.channels[0].mix.fader).toBe(0)
  })

  it('parses the committed real-console capture with no NaN anywhere (#887)', () => {
    const content = readFileSync(
      new URL('../../console/src/capture-2026-08-16.scn', import.meta.url),
      'utf8',
    )
    const scene = parseScene(content)
    expect(scene.channels).toHaveLength(32)
    scene.channels.forEach((ch, i) => assertNoNaN(ch, `channels[${i}]`))
    scene.dcas.forEach((dca, i) => assertNoNaN(dca, `dcas[${i}]`))
  })

  it('parses the 7 known -oo main-mix faders in the committed capture as -Infinity (#887)', () => {
    const content = readFileSync(
      new URL('../../console/src/capture-2026-08-16.scn', import.meta.url),
      'utf8',
    )
    const scene = parseScene(content)
    const infiniteChannels = scene.channels
      .map((ch, i) => ({ index: i + 1, fader: ch.mix.fader }))
      .filter((c) => c.fader === Number.NEGATIVE_INFINITY)
      .map((c) => c.index)
    expect(infiniteChannels).toEqual([1, 13, 14, 15, 16, 23, 24])
  })

  it('parses the committed real-console capture header as version 2.7 (#893)', () => {
    const scene = parseScene(CAPTURE)
    expect(scene.version).toBe('2.7')
    expect(scene.name).toBe('TPC M32R A capture')
  })

  it('parses all 8 DCAs from the committed real-console capture (#893)', () => {
    const scene = parseScene(CAPTURE)
    expect(scene.dcas).toHaveLength(8)
    expect(scene.dcas.map((d) => d.name)).toEqual([
      'Vocals',
      'Vocal FX',
      'Band',
      'Drums',
      'Tracks',
      'Video',
      'Speaking',
      'Jams',
    ])
    expect(scene.dcas.map((d) => d.on)).toEqual([
      false, false, false, false, false, true, true, true,
    ])
    ;[0, -9.1, -0.4, -0.3, 0.1, 0, -0.2, -21.4].forEach((expected, i) =>
      expect(scene.dcas[i].level).toBeCloseTo(expected, 5),
    )
  })

  it('parses real channel names from the committed capture (#893)', () => {
    const scene = parseScene(CAPTURE)
    expect(scene.channels[0].name).toBe('')
    expect(scene.channels[1].name).toBe('Vox 1')
    expect(scene.channels[24].name).toBe('Kick')
    expect(scene.channels[31].name).toBe('MD 2')
    // Channels 01, 13, 14, 15 are blank in the capture; the remaining 28 are named.
    expect(scene.channels.filter((c) => c.name !== '').length).toBe(28)
  })

  // The M32R writes some EQ frequencies in k-shorthand (`1k09`, `2k43`,
  // `10k74`) alongside plain Hz (`328.1`). parseScene's eq regex only accepts
  // `(-oo|[\d+\-.]+)` for the freq token, so a k-shorthand line never matches
  // and that band is silently skipped — channel 01 parses only 1 of its 4 EQ
  // bands. This is a known gap (#893 follow-up); documented here rather than
  // fixed, since fixing it changes parseScene's output contract.
  it('documents that k-shorthand EQ frequencies from the console are not yet parsed (#893)', () => {
    const scene = parseScene(CAPTURE)
    expect(scene.channels[0].eq.bands).toHaveLength(1)
    expect(scene.channels[0].eq.bands[0]).toMatchObject({ type: 'PEQ', gain: -6.25 })
    expect(scene.channels[0].eq.bands[0].freq).toBeCloseTo(328.1, 5)
    scene.channels.forEach((ch) =>
      ch.eq.bands.forEach((b) => expect(Number.isFinite(b.freq)).toBe(true)),
    )
  })
})
