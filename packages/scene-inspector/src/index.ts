import type { Scene, SceneDiff, SceneChange, Channel, DCA, EQBand } from '@sound-buddy/shared'

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

export function diffScenes(a: Scene, b: Scene): SceneDiff {
  const changes: SceneChange[] = []

  for (let i = 0; i < Math.max(a.channels.length, b.channels.length); i++) {
    const chA = a.channels[i]
    const chB = b.channels[i]
    if (!chA || !chB) continue
    const name = chA.name

    if (chA.mix.on !== chB.mix.on) {
      changes.push({ path: `channels[${i}].mix.on`, label: `${name} — mute`, from: chA.mix.on, to: chB.mix.on })
    }
    if (chA.mix.fader !== chB.mix.fader) {
      changes.push({ path: `channels[${i}].mix.fader`, label: `${name} — fader`, from: chA.mix.fader, to: chB.mix.fader })
    }
    if (chA.preamp.gain !== chB.preamp.gain) {
      changes.push({ path: `channels[${i}].preamp.gain`, label: `${name} — gain`, from: chA.preamp.gain, to: chB.preamp.gain })
    }
  }

  for (let i = 0; i < Math.max(a.dcas.length, b.dcas.length); i++) {
    const dA = a.dcas[i]
    const dB = b.dcas[i]
    if (!dA || !dB) continue
    const name = dA.name

    if (dA.on !== dB.on) {
      changes.push({ path: `dcas[${i}].on`, label: `${name} — on`, from: dA.on, to: dB.on })
    }
    if (dA.level !== dB.level) {
      changes.push({ path: `dcas[${i}].level`, label: `${name} — level`, from: dA.level, to: dB.level })
    }
  }

  const bySection = {
    channels: changes.filter(c => c.path.startsWith('channels')),
    dcas: changes.filter(c => c.path.startsWith('dcas')),
    main: changes.filter(c => c.path.startsWith('main')),
  }

  const summary = changes.length === 0 ? 'No differences found' : `${changes.length} change${changes.length === 1 ? '' : 's'} found`

  return { changes, summary, bySection }
}
