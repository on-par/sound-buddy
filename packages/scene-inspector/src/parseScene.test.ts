import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseScene } from './index.js'

const VALID_HEADER = '#4.0# "TPC Sunday" "" %000000000 1'

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
})
