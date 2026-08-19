import { describe, it, expect } from 'vitest'
import { decodeOscMessage, encodeOscMessage, OscError } from './index.js'
import type { DecodedOscMessage } from './index.js'
import { decodeMeterBlob, decodeMeters1Blob, decodeMeters1Message } from './meters.js'

const METERS_1_VALUE_COUNT = 96
const METERS_1_BLOB_BYTES = 4 + METERS_1_VALUE_COUNT * 4

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function buildMeterBlob(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(4 + values.length * 4)
  const view = new DataView(buffer)
  view.setInt32(0, values.length, true)
  values.forEach((v, i) => view.setFloat32(4 + i * 4, v, true))
  return new Uint8Array(buffer)
}

describe('decodeMeters1Blob — AC: real blob decodes', () => {
  it('splits a 388-byte little-endian /meters/1 blob into 32/32/32 bands in order', () => {
    const values = Array.from({ length: METERS_1_VALUE_COUNT }, (_, i) => i / 100)
    const blob = buildMeterBlob(values)
    expect(blob.byteLength).toBe(METERS_1_BLOB_BYTES)

    const snapshot = decodeMeters1Blob(blob)

    expect(snapshot.inputs).toHaveLength(32)
    expect(snapshot.gateGainReduction).toHaveLength(32)
    expect(snapshot.dynamicsGainReduction).toHaveLength(32)
    expect(snapshot.inputs[0]).toBeCloseTo(values[0], 5)
    expect(snapshot.gateGainReduction[0]).toBeCloseTo(values[32], 5)
    expect(snapshot.dynamicsGainReduction[31]).toBeCloseTo(values[95], 5)

    const flat = [
      ...snapshot.inputs,
      ...snapshot.gateGainReduction,
      ...snapshot.dynamicsGainReduction,
    ]
    expect(flat).toEqual(decodeMeterBlob(blob))
  })
})

describe('decodeMeterBlob — AC: little-endian is honored (hex-pinned)', () => {
  it('decodes a hand-computed little-endian vector to 1.0 and 0.5', () => {
    const blob = fromHex('020000000000803f0000003f')
    const values = decodeMeterBlob(blob)
    expect(values).toHaveLength(2)
    expect(values[0]).toBeCloseTo(1.0, 5)
    expect(values[1]).toBeCloseTo(0.5, 5)
  })

  it('regression guard: the same bytes read big-endian do not produce 1.0', () => {
    const blob = fromHex('020000000000803f0000003f')
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    const bigEndianFirstValue = view.getFloat32(4, false)
    expect(bigEndianFirstValue).not.toBeCloseTo(1.0, 5)
  })

  it('decodes a headroom sample of 8.0 unclamped', () => {
    const values = decodeMeterBlob(fromHex('0100000000000041'))
    expect(values).toHaveLength(1)
    expect(values[0]).toBeCloseTo(8.0, 5)
  })
})

describe('decodeMeterBlob — AC: malformed blob fails loudly', () => {
  it('throws when the blob is shorter than the 4-byte count field', () => {
    expect(() => decodeMeterBlob(fromHex('010203'))).toThrow(OscError)
    expect(() => decodeMeterBlob(fromHex('010203'))).toThrow(/count/i)
  })

  it('throws when the declared count does not match the byte length', () => {
    const buffer = new ArrayBuffer(100)
    new DataView(buffer).setInt32(0, 96, true)
    const blob = new Uint8Array(buffer)
    expect(() => decodeMeterBlob(blob)).toThrow(OscError)
    expect(() => decodeMeterBlob(blob)).toThrow(/388/)
    expect(() => decodeMeterBlob(blob)).toThrow(/100/)
  })

  it('throws when the count field is negative', () => {
    const blob = fromHex('ffffffff')
    expect(() => decodeMeterBlob(blob)).toThrow(OscError)
    expect(() => decodeMeterBlob(blob)).toThrow(/negative|-1/i)
  })

  it('throws when a /meters/1 blob does not carry exactly 96 values', () => {
    const blob = buildMeterBlob([1, 2, 3])
    expect(() => decodeMeters1Blob(blob)).toThrow(OscError)
    expect(() => decodeMeters1Blob(blob)).toThrow(/meters\/1/)
    expect(() => decodeMeters1Blob(blob)).toThrow(/96/)
  })

  it('rejects a structurally valid but empty (count 0) blob as not a /meters/1 frame', () => {
    const blob = buildMeterBlob([])
    expect(blob.byteLength).toBe(4)
    expect(() => decodeMeters1Blob(blob)).toThrow(OscError)
    expect(() => decodeMeters1Blob(blob)).toThrow(/meters\/1/)
    expect(() => decodeMeters1Blob(blob)).toThrow(/96/)
  })
})

describe('decodeMeters1Message', () => {
  const fixtureBlob = buildMeterBlob(Array.from({ length: METERS_1_VALUE_COUNT }, (_, i) => i))

  it('normalizes a leading-slash-free address and decodes the blob', () => {
    const message: DecodedOscMessage = {
      address: 'meters/1',
      typeTags: ',b',
      args: [{ type: 'b', value: fixtureBlob }],
    }
    const snapshot = decodeMeters1Message(message)
    expect(snapshot.inputs).toHaveLength(32)
    expect(snapshot.inputs[0]).toBeCloseTo(0, 5)
  })

  it('throws when the reply address is not /meters/1', () => {
    const message: DecodedOscMessage = {
      address: '/meters/2',
      typeTags: ',b',
      args: [{ type: 'b', value: fixtureBlob }],
    }
    expect(() => decodeMeters1Message(message)).toThrow(OscError)
    expect(() => decodeMeters1Message(message)).toThrow(/meters\/1/)
  })

  it('throws when the message carries no arguments', () => {
    const message: DecodedOscMessage = { address: '/meters/1', typeTags: ',', args: [] }
    expect(() => decodeMeters1Message(message)).toThrow(OscError)
    expect(() => decodeMeters1Message(message)).toThrow(/blob/i)
  })

  it('throws when the first argument is not a blob', () => {
    const message: DecodedOscMessage = {
      address: '/meters/1',
      typeTags: ',f',
      args: [{ type: 'f', value: 1.0 }],
    }
    expect(() => decodeMeters1Message(message)).toThrow(OscError)
    expect(() => decodeMeters1Message(message)).toThrow(/blob/i)
  })
})

describe('end-to-end through the existing OSC codec', () => {
  it('decodes a /meters/1 blob round-tripped through encodeOscMessage/decodeOscMessage', () => {
    // The read-only guard's allowlist only exact-matches '/meters' (not
    // '/meters/1') for messages carrying args, so encode on '/meters' — a
    // real /meters/1 push never goes through encodeOscMessage anyway, it
    // arrives as a raw incoming UDP packet decoded straight by
    // decodeOscMessage. This still proves the envelope decoder's blob
    // payload plugs into decodeMeters1Message at the correct byte offsets.
    const values = Array.from({ length: METERS_1_VALUE_COUNT }, (_, i) => (i + 1) / 10)
    const blob = buildMeterBlob(values)
    const packet = encodeOscMessage({ address: '/meters', args: [{ type: 'b', value: blob }] })
    const decoded = decodeOscMessage(packet)
    const snapshot = decodeMeters1Message({ ...decoded, address: '/meters/1' })
    expect(snapshot.inputs[0]).toBeCloseTo(values[0], 5)
    expect(snapshot.dynamicsGainReduction[31]).toBeCloseTo(values[95], 5)
  })
})
