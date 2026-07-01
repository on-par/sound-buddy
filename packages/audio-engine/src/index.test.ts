import { describe, it, expect } from 'vitest'
import { analyzeFile } from './index.js'

describe('audio-engine exports', () => {
  it('exports analyzeFile as a function', () => {
    expect(typeof analyzeFile).toBe('function')
  })

  it('analyzeFile returns a promise', () => {
    // We just verify the shape — calling it with a real file would require sox/ffprobe/python
    const result = analyzeFile('/dev/null')
    expect(result).toBeInstanceOf(Promise)
    // Swallow the rejection (no real file tools available in test env)
    result.catch(() => {})
  })
})
