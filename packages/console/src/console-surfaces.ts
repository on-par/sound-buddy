import { parseFaderToken } from './channel-strip.js'

export type MixStripKind = 'bus' | 'mtx' | 'main' | 'auxin' | 'fxrtn'

export interface MixStrip {
  kind: MixStripKind
  /** Path segment as it appears in OSC: '01'..'16' for bus/mtx/auxin/fxrtn, 'st' | 'm' for main. */
  id: string
  /** 1-based numeric index, or null for the mains (which are named, not numbered). */
  index: number | null
  name: string
  /** dB, or -Infinity when the source token is "-oo". */
  fader: number
  on: boolean
  /** -100..+100; 0 when the surface's mix line carries no pan field. */
  pan: number
  /** null when the surface has no /preamp line at all (bus, main, fxrtn). */
  preamp: { trim: number; invert: boolean } | null
  dynamics: { on: boolean; mode: string; thr: number; ratio: number; knee: number; mgain: number }
  /** 6 bands for bus/mtx/main, 4 for auxin/fxrtn — sized from the capture, not hardcoded. */
  eq: { on: boolean; bands: Array<{ type: string; freq: string; gain: number; q: number }> }
}

export interface DcaStrip {
  index: number // 1-based; /dca/1 -> 1
  name: string
  on: boolean
  fader: number
}

export interface FxSlot {
  index: number // 1-based; /fx/1 -> 1
  type: string // 'VRM' | 'PLAT' | 'DLY' | 'GEQ2' | 'ENH' | ... (raw token, not narrowed)
  /** From /fx/N/source; empty for slots that have no source line (5..8 in the capture). */
  source: string[]
  /** 64 raw tokens. Kept as strings: values include 'OFF', 'X' and '7k9'. */
  par: string[]
}

export interface ConsoleSurfaces {
  buses: MixStrip[]
  matrices: MixStrip[]
  mains: MixStrip[]
  dcas: DcaStrip[]
  auxIns: MixStrip[]
  fxReturns: MixStrip[]
  fx: FxSlot[]
}

const SURFACE_INDEX_WIDTH = 2 // /bus/01, /mtx/01, /auxin/01, /fxrtn/01
const FX_PARAM_INDEX_WIDTH = 2 // /fx/1/par/01 .. /par/64

function padIndex(index: number, width: number): string {
  return String(index).padStart(width, '0')
}

const MIX_STRIP_LIST_KEY: Record<
  MixStripKind,
  'buses' | 'matrices' | 'mains' | 'auxIns' | 'fxReturns'
> = {
  bus: 'buses',
  mtx: 'matrices',
  main: 'mains',
  auxin: 'auxIns',
  fxrtn: 'fxReturns',
}

function makeMixStrip(kind: MixStripKind, id: string): MixStrip {
  return {
    kind,
    id,
    index: kind === 'main' ? null : parseInt(id, 10),
    name: '',
    fader: 0,
    on: true,
    pan: 0,
    preamp: null,
    dynamics: { on: false, mode: '', thr: 0, ratio: 0, knee: 0, mgain: 0 },
    eq: { on: false, bands: [] },
  }
}

// Numeric ids (bus/mtx/auxin/fxrtn) sort ascending; non-numeric ids (main's
// 'st'/'m') compare equal so the array keeps the order strips were created in.
function compareMixStripById(a: MixStrip, b: MixStrip): number {
  const an = Number(a.id)
  const bn = Number(b.id)
  if (Number.isNaN(an) || Number.isNaN(bn)) return 0
  return an - bn
}

function getOrCreateMixStrip(surfaces: ConsoleSurfaces, kind: MixStripKind, id: string): MixStrip {
  const list = surfaces[MIX_STRIP_LIST_KEY[kind]]
  let strip = list.find((s) => s.id === id)
  if (!strip) {
    strip = makeMixStrip(kind, id)
    list.push(strip)
    list.sort(compareMixStripById)
  }
  return strip
}

function getOrCreateDcaStrip(dcas: DcaStrip[], index: number): DcaStrip {
  let dca = dcas.find((d) => d.index === index)
  if (!dca) {
    dca = { index, name: '', on: true, fader: 0 }
    dcas.push(dca)
    dcas.sort((a, b) => a.index - b.index)
  }
  return dca
}

function getOrCreateFxSlot(slots: FxSlot[], index: number): FxSlot {
  let slot = slots.find((s) => s.index === index)
  if (!slot) {
    slot = { index, type: '', source: [], par: [] }
    slots.push(slot)
    slots.sort((a, b) => a.index - b.index)
  }
  return slot
}

const MIX_STRIP_KINDS = 'bus|mtx|main|auxin|fxrtn'
const DYN_KINDS = 'bus|mtx|main'
const CONFIG_RE = new RegExp(`^/(${MIX_STRIP_KINDS})/(\\d+|st|m)/config\\s+"([^"]*)"`)
const EQ_ON_RE = new RegExp(`^/(${MIX_STRIP_KINDS})/(\\d+|st|m)/eq\\s+(ON|OFF)`)
const EQ_BAND_RE = new RegExp(
  `^/(${MIX_STRIP_KINDS})/(\\d+|st|m)/eq/(\\d+)\\s+(\\S+)\\s+(\\S+)\\s+([+-]?[\\d.]+)\\s+([+-]?[\\d.]+)`,
)
const DYN_RE = new RegExp(
  `^/(${DYN_KINDS})/(\\d+|st|m)/dyn\\s+(ON|OFF)\\s+(\\S+)\\s+\\S+\\s+\\S+\\s+([+-]?[\\d.]+)\\s+([+-]?[\\d.]+)\\s+([+-]?[\\d.]+)\\s+([+-]?[\\d.]+)`,
)

const MIX_WIDE_RE =
  /^\/(bus|auxin|fxrtn)\/(\d+)\/mix\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)\s+\S+\s+([+-]?\d+)/
const MIX_MAIN_ST_RE = /^\/main\/st\/mix\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)\s+([+-]?\d+)/
const MIX_MTX_RE = /^\/mtx\/(\d+)\/mix\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)/
const MIX_MAIN_M_RE = /^\/main\/m\/mix\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)/

const PREAMP_AUXIN_RE = /^\/auxin\/(\d+)\/preamp\s+([+-]?[\d.]+)\s+(ON|OFF)/
const PREAMP_MTX_RE = /^\/mtx\/(\d+)\/preamp\s+(ON|OFF)/

const DCA_LEVEL_RE = /^\/dca\/(\d)\s+(ON|OFF)\s+(\S+)\s*$/
const DCA_CONFIG_RE = /^\/dca\/(\d)\/config\s+"([^"]*)"/

const FX_TYPE_RE = /^\/fx\/(\d)\s+(\S+)\s*$/
// \S.* (not .+) after the separating \s+ so the two quantifiers can't both
// claim the same whitespace — CodeQL flags \s+(.+) as polynomial-redos
// since ' ' matches both. The rest of the line is always non-empty,
// non-whitespace-led token data (see console-surfaces.test.ts), so this
// doesn't change what matches in practice.
const FX_SOURCE_RE = /^\/fx\/(\d)\/source\s+(\S.*)$/
const FX_PAR_RE = /^\/fx\/(\d)\/par\s+(\S.*)$/

export function parseConsoleSurfaces(captureText: string): ConsoleSurfaces {
  const surfaces: ConsoleSurfaces = {
    buses: [],
    matrices: [],
    mains: [],
    dcas: [],
    auxIns: [],
    fxReturns: [],
    fx: [],
  }

  for (const raw of captureText.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    let m = line.match(CONFIG_RE)
    if (m) {
      getOrCreateMixStrip(surfaces, m[1] as MixStripKind, m[2]).name = m[3]
      continue
    }
    m = line.match(MIX_WIDE_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, m[1] as MixStripKind, m[2])
      strip.on = m[3] === 'ON'
      strip.fader = parseFaderToken(m[4])
      strip.pan = parseInt(m[5], 10)
      continue
    }
    m = line.match(MIX_MAIN_ST_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, 'main', 'st')
      strip.on = m[1] === 'ON'
      strip.fader = parseFaderToken(m[2])
      strip.pan = parseInt(m[3], 10)
      continue
    }
    m = line.match(MIX_MAIN_M_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, 'main', 'm')
      strip.on = m[1] === 'ON'
      strip.fader = parseFaderToken(m[2])
      continue
    }
    m = line.match(MIX_MTX_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, 'mtx', m[1])
      strip.on = m[2] === 'ON'
      strip.fader = parseFaderToken(m[3])
      continue
    }
    m = line.match(PREAMP_AUXIN_RE)
    if (m) {
      getOrCreateMixStrip(surfaces, 'auxin', m[1]).preamp = {
        trim: parseFloat(m[2]),
        invert: m[3] === 'ON',
      }
      continue
    }
    m = line.match(PREAMP_MTX_RE)
    if (m) {
      getOrCreateMixStrip(surfaces, 'mtx', m[1]).preamp = { trim: 0, invert: m[2] === 'ON' }
      continue
    }
    m = line.match(DYN_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, m[1] as MixStripKind, m[2])
      strip.dynamics = {
        on: m[3] === 'ON',
        mode: m[4],
        thr: parseFloat(m[5]),
        ratio: parseFloat(m[6]),
        knee: parseFloat(m[7]),
        mgain: parseFloat(m[8]),
      }
      continue
    }
    m = line.match(EQ_BAND_RE)
    if (m) {
      const strip = getOrCreateMixStrip(surfaces, m[1] as MixStripKind, m[2])
      const bandIdx = parseInt(m[3], 10) - 1
      strip.eq.bands[bandIdx] = { type: m[4], freq: m[5], gain: parseFloat(m[6]), q: parseFloat(m[7]) }
      continue
    }
    m = line.match(EQ_ON_RE)
    if (m) {
      getOrCreateMixStrip(surfaces, m[1] as MixStripKind, m[2]).eq.on = m[3] === 'ON'
      continue
    }
    m = line.match(DCA_LEVEL_RE)
    if (m) {
      const dca = getOrCreateDcaStrip(surfaces.dcas, parseInt(m[1], 10))
      dca.on = m[2] === 'ON'
      dca.fader = parseFaderToken(m[3])
      continue
    }
    m = line.match(DCA_CONFIG_RE)
    if (m) {
      getOrCreateDcaStrip(surfaces.dcas, parseInt(m[1], 10)).name = m[2]
      continue
    }
    m = line.match(FX_TYPE_RE)
    if (m) {
      getOrCreateFxSlot(surfaces.fx, parseInt(m[1], 10)).type = m[2]
      continue
    }
    m = line.match(FX_SOURCE_RE)
    if (m) {
      getOrCreateFxSlot(surfaces.fx, parseInt(m[1], 10)).source = m[2].trim().split(/\s+/)
      continue
    }
    m = line.match(FX_PAR_RE)
    if (m) {
      getOrCreateFxSlot(surfaces.fx, parseInt(m[1], 10)).par = m[2].trim().split(/\s+/)
      continue
    }
  }

  return surfaces
}

export function buildBusFaderPath(index: number): string {
  return `/bus/${padIndex(index, SURFACE_INDEX_WIDTH)}/mix/fader`
}

export function buildMatrixFaderPath(index: number): string {
  return `/mtx/${padIndex(index, SURFACE_INDEX_WIDTH)}/mix/fader`
}

export function buildMainFaderPath(which: 'st' | 'm'): string {
  return `/main/${which}/mix/fader`
}

export function buildAuxInFaderPath(index: number): string {
  return `/auxin/${padIndex(index, SURFACE_INDEX_WIDTH)}/mix/fader`
}

export function buildFxReturnFaderPath(index: number): string {
  return `/fxrtn/${padIndex(index, SURFACE_INDEX_WIDTH)}/mix/fader`
}

export function buildFxParamPath(slot: number, param: number): string {
  return `/fx/${slot}/par/${padIndex(param, FX_PARAM_INDEX_WIDTH)}`
}
