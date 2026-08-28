import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildDcaFaderPath } from './channel-strip.js'
import {
  parseConsoleSurfaces,
  buildBusFaderPath,
  buildMatrixFaderPath,
  buildMainFaderPath,
  buildAuxInFaderPath,
  buildFxReturnFaderPath,
  buildFxParamPath,
} from './console-surfaces.js'

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

describe('parseConsoleSurfaces', () => {
  it('parses the committed capture-2026-08-16.scn fixture into the expected surface counts with no NaN anywhere (AC1)', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    expect(surfaces.buses).toHaveLength(16)
    expect(surfaces.matrices).toHaveLength(6)
    expect(surfaces.mains).toHaveLength(2)
    expect(surfaces.dcas).toHaveLength(8)
    expect(surfaces.auxIns).toHaveLength(8)
    expect(surfaces.fxReturns).toHaveLength(8)
    expect(surfaces.fx).toHaveLength(8)
    assertNoNaN(surfaces, 'surfaces')
  })

  it('parses bus 1 fields from the fixture', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const bus1 = surfaces.buses.find((b) => b.id === '01')
    expect(bus1?.name).toBe('IEM1')
    expect(bus1?.on).toBe(true)
    expect(bus1?.fader).toBe(-3.4)
    expect(bus1?.pan).toBe(100)
    expect(bus1?.eq.bands).toHaveLength(6)
    expect(bus1?.eq.bands[0].type).toBe('LShv')
    expect(bus1?.dynamics.mode).toBe('COMP')
    expect(bus1?.preamp).toBeNull()
  })

  it('parses bus 16 (top of the two-digit range) with a positive fader', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const bus16 = surfaces.buses.find((b) => b.id === '16')
    expect(bus16?.name).toBe('Vox Delay')
    expect(bus16?.fader).toBe(0.1)
  })

  it('does not let a /bus/01/mix/01 send line overwrite the /bus/01/mix strip fader', () => {
    const surfaces = parseConsoleSurfaces(
      ['/bus/01/mix ON  -3.4 OFF +100 OFF   -oo', '/bus/01/mix/01 ON   -oo -100 POST 0'].join('\n'),
    )
    expect(surfaces.buses[0].fader).toBe(-3.4)
  })

  it('parses matrix 1 fields, including the narrow 2-token mix form and 1-token preamp form', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const mtx1 = surfaces.matrices.find((m) => m.id === '01')
    expect(mtx1?.name).toBe('')
    expect(mtx1?.fader).toBe(-Infinity)
    expect(Number.isNaN(mtx1?.fader)).toBe(false)
    expect(mtx1?.pan).toBe(0)
    expect(mtx1?.preamp).toEqual({ trim: 0, invert: false })
    expect(mtx1?.eq.bands).toHaveLength(6)
  })

  it('parses /main/st with the 3-token mix form', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const mainSt = surfaces.mains.find((m) => m.id === 'st')
    expect(mainSt?.index).toBeNull()
    expect(mainSt?.fader).toBe(-4.3)
    expect(mainSt?.pan).toBe(-2)
    expect(mainSt?.preamp).toBeNull()
    expect(mainSt?.eq.bands).toHaveLength(6)
  })

  it('parses /main/m with the narrow 2-token mix form', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const mainM = surfaces.mains.find((m) => m.id === 'm')
    expect(mainM?.fader).toBe(-Infinity)
    expect(mainM?.pan).toBe(0)
  })

  it('parses aux in 1 fields, including the 2-token preamp form and 4-band EQ', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const auxIn1 = surfaces.auxIns.find((a) => a.id === '01')
    expect(auxIn1?.name).toBe('ProP L')
    expect(auxIn1?.fader).toBe(-0.2)
    expect(auxIn1?.pan).toBe(-100)
    expect(auxIn1?.preamp).toEqual({ trim: -16.5, invert: false })
    expect(auxIn1?.eq.bands).toHaveLength(4)
    expect(auxIn1?.dynamics.on).toBe(false)
    expect(auxIn1?.dynamics.mode).toBe('')
  })

  it('parses FX return 1 fields with no preamp and a 4-band EQ', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const fxrtn1 = surfaces.fxReturns.find((f) => f.id === '01')
    expect(fxrtn1?.name).toBe('Drum Verb')
    expect(fxrtn1?.fader).toBe(-7.3)
    expect(fxrtn1?.eq.bands).toHaveLength(4)
    expect(fxrtn1?.preamp).toBeNull()
  })

  it('parses all 8 DCAs ascending by index, including the one-digit no-mix-segment shape', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    expect(surfaces.dcas[0]).toEqual({ index: 1, name: 'Vocals', on: false, fader: 0 })
    expect(surfaces.dcas[7]).toEqual({ index: 8, name: 'Jams', on: true, fader: -21.4 })
    expect(surfaces.dcas.map((d) => d.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('parses FX slot 1 with a source list and 64 par tokens', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const fx1 = surfaces.fx.find((f) => f.index === 1)
    expect(fx1?.type).toBe('VRM')
    expect(fx1?.source).toEqual(['MIX13', 'MIX13'])
    expect(fx1?.par).toHaveLength(64)
    expect(fx1?.par[0]).toBe('20')
  })

  it('parses FX slot 5, which has no /source line, without crashing', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const fx5 = surfaces.fx.find((f) => f.index === 5)
    expect(fx5?.type).toBe('GEQ2')
    expect(fx5?.source).toEqual([])
    expect(fx5?.par).toHaveLength(64)
  })

  it('keeps FX slot 4 par tokens as raw strings, including the non-numeric "X" token', () => {
    const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')
    const surfaces = parseConsoleSurfaces(captureText)
    const fx4 = surfaces.fx.find((f) => f.index === 4)
    expect(fx4?.par).toContain('X')
  })

  it('ignores unrecognized/out-of-scope lines and only produces the recognized bus surface', () => {
    const surfaces = parseConsoleSurfaces(
      [
        '/ch/01/mix ON -7.4 ON +0 OFF -oo',
        '/outputs/main/01 ON 0.0',
        '/bus/01/mix ON  -3.4 OFF +100 OFF   -oo',
      ].join('\n'),
    )
    expect(surfaces.buses).toHaveLength(1)
    expect(surfaces.matrices).toHaveLength(0)
    expect(surfaces.mains).toHaveLength(0)
    expect(surfaces.dcas).toHaveLength(0)
    expect(surfaces.auxIns).toHaveLength(0)
    expect(surfaces.fxReturns).toHaveLength(0)
    expect(surfaces.fx).toHaveLength(0)
  })

  it('returns all-empty arrays for empty input', () => {
    const surfaces = parseConsoleSurfaces('')
    expect(surfaces).toEqual({
      buses: [],
      matrices: [],
      mains: [],
      dcas: [],
      auxIns: [],
      fxReturns: [],
      fx: [],
    })
  })
})

describe('buildBusFaderPath', () => {
  it('pads the bus index to 2 digits and nests under /mix/fader', () => {
    expect(buildBusFaderPath(1)).toBe('/bus/01/mix/fader')
    expect(buildBusFaderPath(16)).toBe('/bus/16/mix/fader')
  })
})

describe('buildMatrixFaderPath', () => {
  it('pads the matrix index to 2 digits and nests under /mix/fader', () => {
    expect(buildMatrixFaderPath(1)).toBe('/mtx/01/mix/fader')
    expect(buildMatrixFaderPath(6)).toBe('/mtx/06/mix/fader')
  })
})

describe('buildMainFaderPath', () => {
  it('builds the stereo and mono main fader paths', () => {
    expect(buildMainFaderPath('st')).toBe('/main/st/mix/fader')
    expect(buildMainFaderPath('m')).toBe('/main/m/mix/fader')
  })
})

describe('buildAuxInFaderPath', () => {
  it('pads the aux in index to 2 digits and nests under /mix/fader', () => {
    expect(buildAuxInFaderPath(1)).toBe('/auxin/01/mix/fader')
    expect(buildAuxInFaderPath(8)).toBe('/auxin/08/mix/fader')
  })
})

describe('buildFxReturnFaderPath', () => {
  it('pads the FX return index to 2 digits and nests under /mix/fader', () => {
    expect(buildFxReturnFaderPath(1)).toBe('/fxrtn/01/mix/fader')
    expect(buildFxReturnFaderPath(8)).toBe('/fxrtn/08/mix/fader')
  })
})

describe('buildFxParamPath', () => {
  it('does not pad the slot but pads the param index to 2 digits', () => {
    expect(buildFxParamPath(1, 1)).toBe('/fx/1/par/01')
    expect(buildFxParamPath(8, 64)).toBe('/fx/8/par/64')
  })
})

describe('buildDcaFaderPath (AC2, restated in this suite)', () => {
  it('does not pad the DCA index and has no mix segment', () => {
    expect(buildDcaFaderPath(1)).toBe('/dca/1/fader')
    expect(buildDcaFaderPath(8)).toBe('/dca/8/fader')
  })
})
