import { describe, it, expect } from 'vitest'
import { normalizeReplyAddress, replyAddressMatches } from './address.js'

describe('normalizeReplyAddress', () => {
  it('prepends a slash to a bare address', () => {
    expect(normalizeReplyAddress('node')).toBe('/node')
  })

  it('leaves an already-slash-prefixed address unchanged', () => {
    expect(normalizeReplyAddress('/node')).toBe('/node')
  })

  it('normalizes the empty string to a bare slash', () => {
    expect(normalizeReplyAddress('')).toBe('/')
  })
})

describe('replyAddressMatches', () => {
  it('matches a bare reply address against its slash-prefixed request (AC4)', () => {
    expect(replyAddressMatches('/node', 'node')).toBe(true)
  })

  it('matches when both sides are slash-prefixed', () => {
    expect(replyAddressMatches('/node', '/node')).toBe(true)
  })

  it('rejects a reply for a different node', () => {
    expect(replyAddressMatches('/node', '/other')).toBe(false)
  })

  it('rejects a bare reply that differs from the request', () => {
    expect(replyAddressMatches('/node', 'meters')).toBe(false)
  })
})