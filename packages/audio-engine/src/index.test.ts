import { describe, it, expect } from 'vitest'
import { analyzeAudio } from './index.js'

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
