import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { diffCaptures, CaptureDiffError } from './captureDiff.js'
import type { SceneChange } from '@sound-buddy/shared'

const BEFORE_PATH = new URL('../../console/src/capture-2026-08-16.scn', import.meta.url)
const AFTER_PATH = new URL('../../console/src/capture-2026-08-16-after.scn', import.meta.url)
const BEFORE_CONTENT = readFileSync(BEFORE_PATH, 'utf8')
const AFTER_CONTENT = readFileSync(AFTER_PATH, 'utf8')

const EXPECTED_CHANGES = [
  { path: 'channels[10].mix.on', label: 'AG — mute', from: false, to: true },
  { path: 'channels[4].mix.fader', label: 'MC — fader', from: -5.3, to: -8.3 },
  { path: 'channels[11].preamp.gain', label: 'Bass — gain', from: 0, to: 6 },
  { path: 'dcas[7].level', label: 'Jams — level', from: -21.4, to: -18.4 },
]

function findChange(changes: SceneChange[], path: string): SceneChange {
  const change = changes.find((c) => c.path === path)
  if (!change) throw new Error(`expected a change at ${path}`)
  return change
}

describe('diffCaptures', () => {
  it('reports zero changes when a capture is diffed against itself (#891, #887)', () => {
    const result = diffCaptures(
      { source: 'before', content: BEFORE_CONTENT },
      { source: 'before-again', content: BEFORE_CONTENT },
    )
    expect(result.diff.changes).toEqual([])
    expect(result.diff.summary).toBe('No differences found')
    expect(result.diff.bySection.channels).toEqual([])
    expect(result.diff.bySection.dcas).toEqual([])
    expect(result.diff.bySection.main).toEqual([])
  })

  it('carries the source label and parsed identity for a self-diff', () => {
    const result = diffCaptures(
      { source: 'console-a', content: BEFORE_CONTENT },
      { source: 'console-b', content: BEFORE_CONTENT },
    )
    expect(result.before).toEqual({ source: 'console-a', sceneName: 'TPC M32R A capture', version: '2.7' })
    expect(result.after).toEqual({ source: 'console-b', sceneName: 'TPC M32R A capture', version: '2.7' })
  })

  it('carries the after identity for the before/after fixture pair', () => {
    const result = diffCaptures(
      { source: 'before.scn', content: BEFORE_CONTENT },
      { source: 'after.scn', content: AFTER_CONTENT },
    )
    expect(result.after.sceneName).toBe('TPC M32R A after rehearsal')
  })

  it('reports exactly the four seeded changes for the before/after fixture pair (#891)', () => {
    const result = diffCaptures(
      { source: 'before.scn', content: BEFORE_CONTENT },
      { source: 'after.scn', content: AFTER_CONTENT },
    )
    expect(result.diff.changes).toHaveLength(4)

    for (const expected of EXPECTED_CHANGES) {
      const change = findChange(result.diff.changes, expected.path)
      expect(change.label).toBe(expected.label)
      if (typeof expected.from === 'number' && typeof expected.to === 'number') {
        expect(change.from as number).toBeCloseTo(expected.from, 5)
        expect(change.to as number).toBeCloseTo(expected.to, 5)
      } else {
        expect(change.from).toBe(expected.from)
        expect(change.to).toBe(expected.to)
      }
    }
  })

  it('groups the seeded changes by section with the expected summary', () => {
    const result = diffCaptures(
      { source: 'before.scn', content: BEFORE_CONTENT },
      { source: 'after.scn', content: AFTER_CONTENT },
    )
    expect(result.diff.bySection.channels).toHaveLength(3)
    expect(result.diff.bySection.dcas).toHaveLength(1)
    expect(result.diff.bySection.main).toEqual([])
    expect(result.diff.summary).toBe('4 changes found')
  })

  it('fabricates no change for channel 01, which reads -oo on both sides (#887)', () => {
    const result = diffCaptures(
      { source: 'before.scn', content: BEFORE_CONTENT },
      { source: 'after.scn', content: AFTER_CONTENT },
    )
    expect(result.diff.changes.some((c) => c.path.startsWith('channels[0].'))).toBe(false)
  })

  it('reverses from/to when the before and after arguments are swapped', () => {
    const forward = diffCaptures(
      { source: 'before.scn', content: BEFORE_CONTENT },
      { source: 'after.scn', content: AFTER_CONTENT },
    )
    const reversed = diffCaptures(
      { source: 'after.scn', content: AFTER_CONTENT },
      { source: 'before.scn', content: BEFORE_CONTENT },
    )
    expect(reversed.diff.changes.map((c) => c.path).sort()).toEqual(
      forward.diff.changes.map((c) => c.path).sort(),
    )
    for (const expected of forward.diff.changes) {
      const swapped = findChange(reversed.diff.changes, expected.path)
      expect(swapped.from).toEqual(expected.to)
      expect(swapped.to).toEqual(expected.from)
    }
  })

  it('throws a CaptureDiffError naming the before side when it fails to parse', () => {
    expect(() =>
      diffCaptures(
        { source: 'notes.txt', content: 'hello' },
        { source: 'after.scn', content: AFTER_CONTENT },
      ),
    ).toThrow(CaptureDiffError)
    try {
      diffCaptures({ source: 'notes.txt', content: 'hello' }, { source: 'after.scn', content: AFTER_CONTENT })
      throw new Error('expected diffCaptures to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CaptureDiffError)
      const message = (err as CaptureDiffError).message
      expect(message).toContain('before')
      expect(message).toContain('notes.txt')
      expect(message).toContain('.scn')
    }
  })

  it('throws a CaptureDiffError naming the after side when it fails to parse', () => {
    try {
      diffCaptures({ source: 'before.scn', content: BEFORE_CONTENT }, { source: 'notes.txt', content: 'hello' })
      throw new Error('expected diffCaptures to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CaptureDiffError)
      const message = (err as CaptureDiffError).message
      expect(message).toContain('after')
      expect(message).toContain('notes.txt')
      expect(message).toContain('.scn')
    }
  })

  it('wraps an empty capture as a CaptureDiffError, not a raw TypeError, and sets cause', () => {
    try {
      diffCaptures({ source: 'empty.scn', content: '' }, { source: 'after.scn', content: AFTER_CONTENT })
      throw new Error('expected diffCaptures to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CaptureDiffError)
      expect((err as CaptureDiffError).cause).toBeDefined()
    }
  })
})
