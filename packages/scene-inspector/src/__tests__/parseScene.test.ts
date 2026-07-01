import { describe, it, expect } from 'vitest'
import { parseScene } from '../index.js'

const VALID_HEADER = '#4.0# "TPC Sunday" "" %000000000 1'

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

  it('throws ParseError for invalid file', () => {
    expect(() => parseScene('not a scene file')).toThrow('not a valid M32R scene file')
  })
})
