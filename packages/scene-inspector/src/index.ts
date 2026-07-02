import type { Scene, SceneDiff, Channel, DCA, EQBand } from '@sound-buddy/shared'

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

function makeChannel(): Channel {
  return {
    name: '',
    mix: { on: true, fader: 0 },
    preamp: { gain: 0 },
    eq: { bands: [] },
  }
}

function getOrCreateChannel(channels: Channel[], idx: number): Channel {
  while (channels.length <= idx) channels.push(makeChannel())
  return channels[idx]
}

function getOrCreateDCA(dcas: DCA[], idx: number): DCA {
  while (dcas.length <= idx) dcas.push({ on: true, level: 0, name: '' })
  return dcas[idx]
}

function parseQuotedString(s: string): string {
  const m = s.match(/^"([^"]*)"/)
  return m ? m[1] : s
}

function parseFloat2(s: string): number {
  return parseFloat(s.replace('+', ''))
}

export function parseScene(content: string): Scene {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const header = lines[0]

  const headerMatch = header.match(/^#([\d.]+)#\s+"([^"]*)"/)
  if (!headerMatch) {
    throw new ParseError('not a valid M32R scene file')
  }

  const scene: Scene = {
    version: headerMatch[1],
    name: headerMatch[2],
    channels: [],
    dcas: [],
  }

  for (const line of lines.slice(1)) {
    // /ch/NN/mix ON|OFF fader ...
    const mixMatch = line.match(/^\/ch\/(\d+)\/mix\s+(ON|OFF)\s+([\d+\-.]+)/)
    if (mixMatch) {
      const ch = getOrCreateChannel(scene.channels, parseInt(mixMatch[1], 10) - 1)
      ch.mix.on = mixMatch[2] === 'ON'
      ch.mix.fader = parseFloat2(mixMatch[3])
      continue
    }

    // /ch/NN/preamp gain ...
    const preampMatch = line.match(/^\/ch\/(\d+)\/preamp\s+([\d+\-.]+)/)
    if (preampMatch) {
      const ch = getOrCreateChannel(scene.channels, parseInt(preampMatch[1], 10) - 1)
      ch.preamp.gain = parseFloat2(preampMatch[2])
      continue
    }

    // /ch/NN/eq/B type freq gain q
    const eqMatch = line.match(/^\/ch\/(\d+)\/eq\/(\d+)\s+(\w+)\s+([\d+\-.]+)\s+([\d+\-.]+)\s+([\d+\-.]+)/)
    if (eqMatch) {
      const ch = getOrCreateChannel(scene.channels, parseInt(eqMatch[1], 10) - 1)
      const band: EQBand = {
        type: eqMatch[3],
        freq: parseFloat2(eqMatch[4]),
        gain: parseFloat2(eqMatch[5]),
        q: parseFloat2(eqMatch[6]),
      }
      const bandIdx = parseInt(eqMatch[2], 10) - 1
      while (ch.eq.bands.length <= bandIdx) ch.eq.bands.push({ type: '', freq: 0, gain: 0, q: 0 })
      ch.eq.bands[bandIdx] = band
      continue
    }

    // /ch/NN/config "name" ...
    const chConfigMatch = line.match(/^\/ch\/(\d+)\/config\s+("([^"]*)"|\S+)/)
    if (chConfigMatch) {
      const ch = getOrCreateChannel(scene.channels, parseInt(chConfigMatch[1], 10) - 1)
      ch.name = parseQuotedString(chConfigMatch[2])
      continue
    }

    // /dca/N ON|OFF level
    const dcaMatch = line.match(/^\/dca\/(\d+)\s+(ON|OFF)\s+([\d+\-.]+)/)
    if (dcaMatch) {
      const dca = getOrCreateDCA(scene.dcas, parseInt(dcaMatch[1], 10) - 1)
      dca.on = dcaMatch[2] === 'ON'
      dca.level = parseFloat2(dcaMatch[3])
      continue
    }

    // /dca/N/config "name" ...
    const dcaConfigMatch = line.match(/^\/dca\/(\d+)\/config\s+("([^"]*)"|\S+)/)
    if (dcaConfigMatch) {
      const dca = getOrCreateDCA(scene.dcas, parseInt(dcaConfigMatch[1], 10) - 1)
      dca.name = parseQuotedString(dcaConfigMatch[2])
      continue
    }
  }

  return scene
}

export function diffScenes(_a: Scene, _b: Scene): SceneDiff {
  throw new Error('Not implemented')
}
