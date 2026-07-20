import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChannelFile } from './types.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, rmSync: vi.fn() }
})

import { rmSync } from 'node:fs'
import { analyzeAudio, cleanupChannelFiles } from './index.js'

function chFile(i: number, name: string, needsCleanup = true): ChannelFile {
  return { index: i, name, tmpPath: `/tmp/ch${i}.wav`, needsCleanup }
}

beforeEach(() => {
  vi.mocked(rmSync).mockReset()
})

describe('audio-engine exports', () => {
  it('exports analyzeAudio as a function', () => {
    expect(typeof analyzeAudio).toBe('function')
  })

  it('analyzeAudio returns a promise', () => {
    // We just verify the shape — calling it with a real file would require sox/ffprobe/python
    const result = analyzeAudio('/dev/null')
    expect(result).toBeInstanceOf(Promise)
    // Swallow the rejection (no real file tools available in test env)
    result.catch(() => {})
  })
})

describe('cleanupChannelFiles', () => {
  it('removes only files that need cleanup', () => {
    const files = [chFile(0, 'A', true), chFile(1, 'B', false), chFile(2, 'C', true)]
    cleanupChannelFiles(files)
    expect(rmSync).toHaveBeenCalledTimes(2)
    expect(rmSync).toHaveBeenCalledWith('/tmp/ch0.wav')
    expect(rmSync).toHaveBeenCalledWith('/tmp/ch2.wav')
    expect(rmSync).not.toHaveBeenCalledWith('/tmp/ch1.wav')
  })

  it('does not throw when rmSync throws, and still attempts every needsCleanup file', () => {
    vi.mocked(rmSync).mockImplementation(() => {
      throw new Error('EPERM')
    })
    const files = [chFile(0, 'A', true), chFile(1, 'B', true)]
    expect(() => cleanupChannelFiles(files)).not.toThrow()
    expect(rmSync).toHaveBeenCalledTimes(2)
  })
})
