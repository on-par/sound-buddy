import { describe, it, expect } from 'vitest'
import { diffScenes } from './index.js'
import type { Scene, SceneChange } from '@sound-buddy/shared'

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    name: 'Test Scene',
    version: '1.0',
    channels: [
      { name: 'Vox 1', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Vox 2', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Vox 3', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Vox 4', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Guitar L', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Guitar R', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Keys L', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
      { name: 'Keys R', mix: { on: true, fader: 0 }, preamp: { gain: 0 }, eq: { bands: [] } },
    ],
    dcas: [
      { name: 'DCA 1', on: true, level: 0 },
      { name: 'DCA 2', on: true, level: 0 },
      { name: 'DCA 3', on: true, level: 0 },
      { name: 'DCA 4', on: true, level: 0 },
      { name: 'DCA 5', on: true, level: 0 },
      { name: 'Video DCA', on: false, level: 0 },
    ],
    ...overrides,
  }
}

describe('diffScenes', () => {
  it('returns no changes for identical scenes', () => {
    const sceneA = makeScene()
    const sceneB = makeScene()
    const result = diffScenes(sceneA, sceneB)
    expect(result.changes).toEqual([])
    expect(result.summary).toBe('No differences found')
  })

  it('detects channel mute change', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({
      channels: makeScene().channels.map((ch, i) =>
        i === 0 ? { ...ch, mix: { ...ch.mix, on: false } } : ch
      ),
    })
    const result = diffScenes(sceneA, sceneB)
    const change = result.changes.find((c: SceneChange) => c.path === 'channels[0].mix.on')
    expect(change).toBeDefined()
    expect(change).toMatchObject({
      path: 'channels[0].mix.on',
      label: 'Vox 1 — mute',
      from: true,
      to: false,
    })
  })

  it('detects fader level change', () => {
    const sceneA = makeScene({
      channels: makeScene().channels.map((ch, i) =>
        i === 6 ? { ...ch, mix: { ...ch.mix, fader: 1.2 } } : ch
      ),
    })
    const sceneB = makeScene({
      channels: makeScene().channels.map((ch, i) =>
        i === 6 ? { ...ch, mix: { ...ch.mix, fader: -3.8 } } : ch
      ),
    })
    const result = diffScenes(sceneA, sceneB)
    const change = result.changes.find((c: SceneChange) => c.path === 'channels[6].mix.fader')
    expect(change).toBeDefined()
    expect(change).toMatchObject({
      path: 'channels[6].mix.fader',
      label: 'Keys L — fader',
      from: 1.2,
      to: -3.8,
    })
  })

  it('detects DCA on/off change', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({
      dcas: makeScene().dcas.map((dca, i) =>
        i === 5 ? { ...dca, on: true } : dca
      ),
    })
    const result = diffScenes(sceneA, sceneB)
    const change = result.changes.find((c: SceneChange) => c.path === 'dcas[5].on')
    expect(change).toBeDefined()
    expect(change).toMatchObject({
      path: 'dcas[5].on',
      label: 'Video DCA — on',
      from: false,
      to: true,
    })
  })

  it('detects a preamp gain change', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({
      channels: makeScene().channels.map((ch, i) =>
        i === 2 ? { ...ch, preamp: { gain: 4.5 } } : ch
      ),
    })
    const result = diffScenes(sceneA, sceneB)
    const change = result.changes.find((c: SceneChange) => c.path === 'channels[2].preamp.gain')
    expect(change).toMatchObject({
      path: 'channels[2].preamp.gain',
      label: 'Vox 3 — gain',
      from: 0,
      to: 4.5,
    })
  })

  it('detects a DCA level change', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({
      dcas: makeScene().dcas.map((dca, i) => (i === 1 ? { ...dca, level: -3.2 } : dca)),
    })
    const result = diffScenes(sceneA, sceneB)
    const change = result.changes.find((c: SceneChange) => c.path === 'dcas[1].level')
    expect(change).toMatchObject({
      path: 'dcas[1].level',
      label: 'DCA 2 — level',
      from: 0,
      to: -3.2,
    })
  })

  it('skips extra channels without throwing when channel counts differ', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({ channels: makeScene().channels.slice(0, 3) })
    expect(() => diffScenes(sceneA, sceneB)).not.toThrow()
    const result = diffScenes(sceneA, sceneB)
    expect(result.changes.some((c) => c.path.startsWith('channels[3]'))).toBe(false)
    expect(result.changes.some((c) => c.path.startsWith('channels[7]'))).toBe(false)
  })

  it('skips extra DCAs without throwing when DCA counts differ', () => {
    const sceneA = makeScene()
    const sceneB = makeScene({ dcas: makeScene().dcas.slice(0, 2) })
    expect(() => diffScenes(sceneA, sceneB)).not.toThrow()
    const result = diffScenes(sceneA, sceneB)
    expect(result.changes.some((c) => c.path.startsWith('dcas[2]'))).toBe(false)
    expect(result.changes.some((c) => c.path.startsWith('dcas[5]'))).toBe(false)
  })

  it('groups changes by section', () => {
    const sceneA = makeScene({
      channels: makeScene().channels.map((ch, i) =>
        i === 0 ? { ...ch, mix: { ...ch.mix, on: false } } : ch
      ),
      dcas: makeScene().dcas.map((dca, i) =>
        i === 5 ? { ...dca, on: true } : dca
      ),
    })
    const sceneB = makeScene()

    const result = diffScenes(sceneA, sceneB)
    expect(result.bySection.channels.length).toBeGreaterThan(0)
    expect(result.bySection.dcas.length).toBeGreaterThan(0)
    expect(result.bySection.main).toEqual([])
  })
})
