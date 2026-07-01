import type { Scene, SceneDiff, SceneChange } from '@sound-buddy/shared'

export function parseScene(_content: string): Scene {
  throw new Error('Not implemented')
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
