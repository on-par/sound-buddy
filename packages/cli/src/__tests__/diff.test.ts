import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SceneDiff, Scene } from '@sound-buddy/shared'

vi.mock('@sound-buddy/scene-inspector', () => ({
  parseScene: vi.fn(),
  diffScenes: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))

import { readFileSync, existsSync } from 'node:fs'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import { runDiff } from '../diff.js'

const mockReadFileSync = vi.mocked(readFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockParseScene = vi.mocked(parseScene)
const mockDiffScenes = vi.mocked(diffScenes)

const mockSceneA: Scene = {
  name: 'Scene A',
  version: '4.0',
  channels: [
    { name: 'Vox 1', mix: { on: true, fader: -7.4 }, preamp: { gain: 0 }, eq: { bands: [] } },
    { name: 'Keys L', mix: { on: true, fader: 1.2 }, preamp: { gain: 0 }, eq: { bands: [] } },
  ],
  dcas: [{ on: true, level: -5.0, name: 'Band' }],
}

const mockSceneB: Scene = {
  name: 'Scene B',
  version: '4.0',
  channels: [
    { name: 'Vox 1', mix: { on: false, fader: -7.4 }, preamp: { gain: 0 }, eq: { bands: [] } },
    { name: 'Keys L', mix: { on: true, fader: -3.8 }, preamp: { gain: 0 }, eq: { bands: [] } },
  ],
  dcas: [{ on: true, level: -5.0, name: 'Band' }],
}

const mockDiff: SceneDiff = {
  summary: '2 changes detected',
  changes: [
    { path: 'channels[0].mix.on', label: 'Vox 1 — mute', from: true, to: false },
    { path: 'channels[1].mix.fader', label: 'Keys L — fader', from: 1.2, to: -3.8 },
  ],
  bySection: {
    channels: [
      { path: 'channels[0].mix.on', label: 'Vox 1 — mute', from: true, to: false },
      { path: 'channels[1].mix.fader', label: 'Keys L — fader', from: 1.2, to: -3.8 },
    ],
    dcas: [],
    main: [],
  },
}

const emptyDiff: SceneDiff = {
  summary: 'No differences found',
  changes: [],
  bySection: { channels: [], dcas: [], main: [] },
}

beforeEach(() => {
  vi.resetAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockReadFileSync.mockReturnValue('#4.0# "Scene" "" %000000000 1\n')
})

describe('runDiff', () => {
  it('shows human-readable grouped changes', async () => {
    mockParseScene.mockReturnValueOnce(mockSceneA).mockReturnValueOnce(mockSceneB)
    mockDiffScenes.mockReturnValue(mockDiff)

    const { stdout, stderr, exitCode } = await runDiff('scene-a.scn', 'scene-b.scn', {})

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('Channels')
    expect(stdout).toContain('Vox 1 — mute')
    expect(stdout).toContain('true')
    expect(stdout).toContain('false')
    expect(stdout).toContain('Keys L — fader')
    expect(stdout).toContain('1.2')
    expect(stdout).toContain('-3.8')
  })

  it('shows "No differences found" when files are identical', async () => {
    mockParseScene.mockReturnValueOnce(mockSceneA).mockReturnValueOnce(mockSceneA)
    mockDiffScenes.mockReturnValue(emptyDiff)

    const { stdout, stderr, exitCode } = await runDiff('scene-a.scn', 'scene-b.scn', {})

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('No differences found')
  })

  it('outputs valid JSON matching SceneDiff when --json flag is set', async () => {
    mockParseScene.mockReturnValueOnce(mockSceneA).mockReturnValueOnce(mockSceneB)
    mockDiffScenes.mockReturnValue(mockDiff)

    const { stdout, stderr, exitCode } = await runDiff('scene-a.scn', 'scene-b.scn', { json: true })

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('changes')
    expect(parsed).toHaveProperty('summary')
    expect(parsed).toHaveProperty('bySection')
    expect(parsed.changes).toHaveLength(2)
  })

  it('returns error when file does not exist', async () => {
    mockExistsSync.mockImplementation((p) => p !== 'missing.scn')

    const { stdout, stderr, exitCode } = await runDiff('missing.scn', 'scene-b.scn', {})

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe('Error: file not found: missing.scn')
  })

  it('returns error when file is not a valid .scn file', async () => {
    mockParseScene.mockImplementation(() => {
      throw new Error('not a valid M32R scene file')
    })

    const { stdout, stderr, exitCode } = await runDiff('invalid.txt', 'scene-b.scn', {})

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe('Error: not a valid M32R scene file')
  })
})
