import { describe, it, expect } from 'vitest'
import { OscError, decodeOscMessage, encodeOscMessage, replyAddressMatches } from './index.js'

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function pad4(len: number): number {
  return (4 - (len % 4)) % 4
}

describe('encodeOscMessage — AC1 byte-exact vector', () => {
  it('serializes `/meters ,si /meters/6 16` to the pinned hex exactly', () => {
    const bytes = encodeOscMessage({
      address: '/meters',
      args: [
        { type: 's', value: '/meters/6' },
        { type: 'i', value: 16 },
      ],
    })
    expect(toHex(bytes)).toBe('2f6d6574657273002c7369002f6d65746572732f3600000000000010')
  })
})

describe('encodeOscMessage — AC2 no over-padding', () => {
  it('does not append stray padding nulls when the string is already aligned', () => {
    const bytes = encodeOscMessage({ address: '/meters', args: [{ type: 's', value: 'abc' }] })
    expect(bytes.length).toBe(16)
    expect(toHex(bytes.slice(-4))).toBe('61626300')
  })

  it('pads with exactly one NUL plus 3 pad bytes, never 4 stray nulls', () => {
    const bytes = encodeOscMessage({ address: '/node', args: [{ type: 's', value: 'abcd' }] })
    expect(bytes.length).toBe(20)
    expect(toHex(bytes.slice(-8))).toBe('6162636400000000')
  })
})

describe('encodeOscMessage — padding-remainder coverage', () => {
  it('encodes string args of every pad4(len+1) remainder to the exact wire size', () => {
    for (const value of ['abc', 'ab', '/meters/6', 'abcd']) {
      const bytes = encodeOscMessage({ address: '/node', args: [{ type: 's', value }] })
      const segmentLen = value.length + 1 + pad4(value.length + 1)
      expect(bytes.length).toBe(8 + 4 + segmentLen)
      const segment = bytes.slice(-segmentLen)
      const nonNulChars = [...segment].filter((b) => b !== 0).length
      expect(nonNulChars).toBe(value.length)
    }
  })
})

describe('round-trip', () => {
  it('round-trips f/i/s/b payloads exactly', () => {
    const message = {
      address: '/node',
      args: [
        { type: 'f' as const, value: 1.5 },
        { type: 'i' as const, value: -42 },
        { type: 's' as const, value: 'hello' },
        { type: 'b' as const, value: new Uint8Array([1, 2, 3, 4, 5]) },
      ],
    }
    const decoded = decodeOscMessage(encodeOscMessage(message))
    expect(decoded.address).toBe('/node')
    expect(decoded.typeTags).toBe(',fisb')
    expect(decoded.args).toEqual([
      { type: 'f', value: 1.5 },
      { type: 'i', value: -42 },
      { type: 's', value: 'hello' },
      { type: 'b', value: new Uint8Array([1, 2, 3, 4, 5]) },
    ])
  })

  it('respects float32 precision (0.1 within epsilon after round-trip)', () => {
    const decoded = decodeOscMessage(
      encodeOscMessage({ address: '/meters', args: [{ type: 'f', value: 0.1 }] }),
    )
    const value = (decoded.args[0] as { type: 'f'; value: number }).value
    expect(Math.abs(value - 0.1)).toBeLessThan(1e-7)
  })

  it('round-trips an empty arg list to a bare `,` type-tag string', () => {
    const decoded = decodeOscMessage(encodeOscMessage({ address: '/x', args: [] }))
    expect(decoded.typeTags).toBe(',')
    expect(decoded.args).toHaveLength(0)
  })
})

describe('decodeOscMessage', () => {
  it('decodes the AC1 hex vector to address, tags, and args', () => {
    const packet = new Uint8Array(
      '2f6d6574657273002c7369002f6d65746572732f3600000000000010'
        .match(/.{2}/g)!
        .map((pair) => parseInt(pair, 16)),
    )
    const decoded = decodeOscMessage(packet)
    expect(decoded.address).toBe('/meters')
    expect(decoded.typeTags).toBe(',si')
    expect(decoded.args).toEqual([
      { type: 's', value: '/meters/6' },
      { type: 'i', value: 16 },
    ])
  })

  it('parses a bare reply address with no leading slash (AC4)', () => {
    const packet = new Uint8Array([0x6e, 0x6f, 0x64, 0x65, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00])
    const decoded = decodeOscMessage(packet)
    expect(decoded.address).toBe('node')
    expect(replyAddressMatches('/node', decoded.address)).toBe(true)
  })
})

describe('encodeOscMessage error paths', () => {
  it('rejects an address without a leading slash, naming the offending address', () => {
    expect(() => encodeOscMessage({ address: 'meters', args: [] })).toThrow(
      /must start with '\/'.*meters/,
    )
  })

  it('rejects an int above int32 range, naming the value', () => {
    expect(() =>
      encodeOscMessage({ address: '/node', args: [{ type: 'i', value: 2 ** 31 }] }),
    ).toThrow(/int32 range.*2147483648/)
  })

  it('rejects an int below int32 range, naming the value', () => {
    expect(() =>
      encodeOscMessage({ address: '/node', args: [{ type: 'i', value: -(2 ** 31) - 1 }] }),
    ).toThrow(/int32 range.*-2147483649/)
  })

  it('rejects a non-integer int, naming the value', () => {
    expect(() =>
      encodeOscMessage({ address: '/node', args: [{ type: 'i', value: 1.5 }] }),
    ).toThrow(/integer.*1\.5/)
  })
})

describe('encodeOscMessage — read-only guardrail', () => {
  it('throws for a deny-listed write address', () => {
    expect(() => encodeOscMessage({ address: '/save', args: [] })).toThrow(OscError)
  })

  it('throws for /node with a string argument targeting a deny-listed namespace', () => {
    expect(() =>
      encodeOscMessage({ address: '/node', args: [{ type: 's', value: '-libs/x' }] }),
    ).toThrow(OscError)
  })

  it('still returns bytes for an argument-less message on a non-denied address', () => {
    const bytes = encodeOscMessage({ address: '/xremote', args: [] })
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('still returns the exact AC1 hex vector unchanged for an allowlisted message with args', () => {
    const bytes = encodeOscMessage({
      address: '/meters',
      args: [
        { type: 's', value: '/meters/6' },
        { type: 'i', value: 16 },
      ],
    })
    expect(toHex(bytes)).toBe('2f6d6574657273002c7369002f6d65746572732f3600000000000010')
  })
})

describe('decodeOscMessage error paths', () => {
  it('throws naming the unknown tag and the message address', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x71, 0x00, 0x00])
    expect(() => decodeOscMessage(packet)).toThrow(OscError)
    expect(() => decodeOscMessage(packet)).toThrow(/unknown OSC type tag 'q'.*\/x/)
  })

  it('throws when the type-tag string does not start with a comma', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x73, 0x69, 0x00, 0x00])
    expect(() => decodeOscMessage(packet)).toThrow(/must start with ','.*si/)
  })

  it('throws on a truncated int arg', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x69, 0x00, 0x00, 0x00, 0x01])
    expect(() => decodeOscMessage(packet)).toThrow(/truncated OSC message/)
  })

  it('throws on a truncated float arg', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x66, 0x00, 0x00, 0x3f, 0x80])
    expect(() => decodeOscMessage(packet)).toThrow(/truncated OSC message/)
  })

  it('throws when the blob size field itself is truncated', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00, 0x00, 0x01])
    expect(() => decodeOscMessage(packet)).toThrow(/truncated OSC message/)
  })

  it('throws when the declared blob size overruns the buffer', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10])
    expect(() => decodeOscMessage(packet)).toThrow(/truncated OSC message/)
  })

  it('throws when the address string has no NUL terminator before the buffer end', () => {
    const packet = new Uint8Array([0x2f, 0x6d, 0x65])
    expect(() => decodeOscMessage(packet)).toThrow(/NUL terminator/)
  })

  it('throws when a string arg has no NUL terminator before the buffer end', () => {
    const packet = new Uint8Array([0x2f, 0x78, 0x00, 0x00, 0x2c, 0x73, 0x00, 0x00, 0x61, 0x62, 0x63])
    expect(() => decodeOscMessage(packet)).toThrow(/NUL terminator/)
  })
})