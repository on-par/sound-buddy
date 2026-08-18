export interface ChannelPreamp {
  trim: number
  invert: boolean
  hpf: { on: boolean; slope: number; freq: number }
}

export interface ChannelGate {
  on: boolean
  mode: string
  thr: number
  range: number
  attack: number
  hold: number
  release: number
}

export interface ChannelDynamics {
  on: boolean
  mode: string
  thr: number
  ratio: number
  knee: number
  mgain: number
}

export interface ChannelEq {
  on: boolean
  bands: Array<{ type: string; freq: string; gain: number; q: number }>
}

export interface ChannelStrip {
  index: number // 1-based, matches the OSC path number (/ch/01 -> 1)
  name: string
  fader: number // dB, or -Infinity when the source token is "-oo"
  on: boolean // true = channel on/unmuted (raw ON/OFF token)
  pan: number
  preamp: ChannelPreamp
  gate: ChannelGate
  dynamics: ChannelDynamics
  eq: ChannelEq
}

function makeChannelStrip(index: number): ChannelStrip {
  return {
    index,
    name: '',
    fader: 0,
    on: true,
    pan: 0,
    preamp: { trim: 0, invert: false, hpf: { on: false, slope: 0, freq: 0 } },
    gate: { on: false, mode: '', thr: 0, range: 0, attack: 0, hold: 0, release: 0 },
    dynamics: { on: false, mode: '', thr: 0, ratio: 0, knee: 0, mgain: 0 },
    eq: { on: false, bands: [0, 1, 2, 3].map(() => ({ type: '', freq: '0', gain: 0, q: 0 })) },
  }
}

function getOrCreateChannelStrip(strips: ChannelStrip[], index: number): ChannelStrip {
  let strip = strips.find((s) => s.index === index)
  if (!strip) {
    strip = makeChannelStrip(index)
    strips.push(strip)
    strips.sort((a, b) => a.index - b.index)
  }
  return strip
}

function parseFader(token: string): number {
  return token === '-oo' ? -Infinity : parseFloat(token)
}

const NAME_RE = /^\/ch\/(\d+)\/config\s+"([^"]*)"/
const MIX_RE = /^\/ch\/(\d+)\/mix\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)\s+\S+\s+([+-]?\d+)/
const PREAMP_RE = /^\/ch\/(\d+)\/preamp\s+([+-]?[\d.]+)\s+(ON|OFF)\s+(ON|OFF)\s+(\d+)\s+(\d+)/
const GATE_RE =
  /^\/ch\/(\d+)\/gate\s+(ON|OFF)\s+(\S+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/
const DYN_RE =
  /^\/ch\/(\d+)\/dyn\s+(ON|OFF)\s+(\S+)\s+\S+\s+\S+\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/
const EQ_ON_RE = /^\/ch\/(\d+)\/eq\s+(ON|OFF)/
const EQ_BAND_RE = /^\/ch\/(\d+)\/eq\/(\d+)\s+(\S+)\s+(\S+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/

export function parseChannelStrips(captureText: string): ChannelStrip[] {
  const strips: ChannelStrip[] = []
  for (const raw of captureText.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    let m = line.match(NAME_RE)
    if (m) {
      getOrCreateChannelStrip(strips, parseInt(m[1], 10)).name = m[2]
      continue
    }
    m = line.match(MIX_RE)
    if (m) {
      const strip = getOrCreateChannelStrip(strips, parseInt(m[1], 10))
      strip.on = m[2] === 'ON'
      strip.fader = parseFader(m[3])
      strip.pan = parseInt(m[4], 10)
      continue
    }
    m = line.match(PREAMP_RE)
    if (m) {
      const strip = getOrCreateChannelStrip(strips, parseInt(m[1], 10))
      strip.preamp = {
        trim: parseFloat(m[2]),
        invert: m[3] === 'ON',
        hpf: { on: m[4] === 'ON', slope: parseInt(m[5], 10), freq: parseInt(m[6], 10) },
      }
      continue
    }
    m = line.match(GATE_RE)
    if (m) {
      const strip = getOrCreateChannelStrip(strips, parseInt(m[1], 10))
      strip.gate = {
        on: m[2] === 'ON',
        mode: m[3],
        thr: parseFloat(m[4]),
        range: parseFloat(m[5]),
        attack: parseFloat(m[6]),
        hold: parseFloat(m[7]),
        release: parseFloat(m[8]),
      }
      continue
    }
    m = line.match(DYN_RE)
    if (m) {
      const strip = getOrCreateChannelStrip(strips, parseInt(m[1], 10))
      strip.dynamics = {
        on: m[2] === 'ON',
        mode: m[3],
        thr: parseFloat(m[4]),
        ratio: parseFloat(m[5]),
        knee: parseFloat(m[6]),
        mgain: parseFloat(m[7]),
      }
      continue
    }
    m = line.match(EQ_BAND_RE)
    if (m) {
      const strip = getOrCreateChannelStrip(strips, parseInt(m[1], 10))
      const bandIdx = parseInt(m[2], 10) - 1
      strip.eq.bands[bandIdx] = { type: m[3], freq: m[4], gain: parseFloat(m[5]), q: parseFloat(m[6]) }
      continue
    }
    m = line.match(EQ_ON_RE)
    if (m) {
      getOrCreateChannelStrip(strips, parseInt(m[1], 10)).eq.on = m[2] === 'ON'
      continue
    }
  }
  return strips
}

const CHANNEL_INDEX_WIDTH = 2
const HEADAMP_INDEX_WIDTH = 3

function padIndex(index: number, width: number): string {
  return String(index).padStart(width, '0')
}

export function buildChannelFaderPath(index: number): string {
  return `/ch/${padIndex(index, CHANNEL_INDEX_WIDTH)}/mix/fader`
}

export function buildHeadampGainPath(index: number): string {
  return `/headamp/${padIndex(index, HEADAMP_INDEX_WIDTH)}/gain`
}

export function buildDcaFaderPath(index: number): string {
  return `/dca/${index}/fader`
}
