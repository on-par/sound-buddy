import { assertReadOnlyOscMessage } from './read-only-guard.js'

export type OscType = 'f' | 'i' | 's' | 'b'

export type OscArg =
  | { type: 'f'; value: number } // 32-bit big-endian float
  | { type: 'i'; value: number } // 32-bit big-endian int
  | { type: 's'; value: string } // null-terminated, 4-byte aligned
  | { type: 'b'; value: Uint8Array } // 4-byte length prefix, then padded bytes

export interface OscMessage {
  address: string
  args: OscArg[]
}

export interface DecodedOscMessage extends OscMessage {
  typeTags: string
}

export class OscError extends Error {}

const PAD = 4
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// 4-byte alignment — the (4 - (len % 4)) % 4 formula the discovery session's
// hand-written encoder got wrong (a stray pad null silently corrupted /meters).
function pad4(len: number): number {
  return (PAD - (len % PAD)) % PAD
}

function encodeFloat32BE(value: number): number[] {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setFloat32(0, value, false)
  return Array.from(new Uint8Array(buffer))
}

function encodeInt32BE(value: number): number[] {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setInt32(0, value, false)
  return Array.from(new Uint8Array(buffer))
}

function readPaddedString(
  packet: Uint8Array,
  offset: number,
): { value: string; nextOffset: number } {
  let end = offset
  while (end < packet.length && packet[end] !== 0) {
    end++
  }
  if (end >= packet.length) {
    throw new OscError(
      `truncated OSC string: no NUL terminator found before end of packet (offset ${offset}, packet length ${packet.length})`,
    )
  }
  const bytes = packet.subarray(offset, end)
  const value = new TextDecoder('utf-8').decode(bytes)
  const segmentLen = end - offset + 1
  return { value, nextOffset: offset + segmentLen + pad4(segmentLen) }
}

function writeOscArg(out: number[], arg: OscArg): void {
  switch (arg.type) {
    case 'f':
      out.push(...encodeFloat32BE(arg.value))
      break
    case 'i':
      if (!Number.isInteger(arg.value)) {
        throw new OscError(
          `OSC int argument must be an integer (fractional values are not representable in int32): got ${arg.value}`,
        )
      }
      if (arg.value < INT32_MIN || arg.value > INT32_MAX) {
        throw new OscError(
          `OSC int argument out of int32 range [${INT32_MIN}, ${INT32_MAX}]: got ${arg.value}`,
        )
      }
      out.push(...encodeInt32BE(arg.value))
      break
    case 's': {
      const bytes = Array.from(new TextEncoder().encode(arg.value))
      out.push(...bytes, 0)
      for (let i = 0; i < pad4(bytes.length + 1); i++) {
        out.push(0)
      }
      break
    }
    case 'b':
      out.push(...encodeInt32BE(arg.value.length))
      out.push(...arg.value)
      for (let i = 0; i < pad4(arg.value.length); i++) {
        out.push(0)
      }
      break
  }
}

export function encodeOscMessage(message: OscMessage): Uint8Array {
  if (!message.address.startsWith('/')) {
    throw new OscError(`OSC message address must start with '/': got "${message.address}"`)
  }
  assertReadOnlyOscMessage(message)
  const out: number[] = []

  const addressBytes = Array.from(new TextEncoder().encode(message.address))
  out.push(...addressBytes, 0)
  for (let i = 0; i < pad4(addressBytes.length + 1); i++) {
    out.push(0)
  }

  const typeTags = `,${message.args.map((a) => a.type).join('')}`
  const tagBytes = Array.from(new TextEncoder().encode(typeTags))
  out.push(...tagBytes, 0)
  for (let i = 0; i < pad4(tagBytes.length + 1); i++) {
    out.push(0)
  }

  for (const arg of message.args) {
    writeOscArg(out, arg)
  }

  return new Uint8Array(out)
}

export function decodeOscMessage(packet: Uint8Array): DecodedOscMessage {
  const addressResult = readPaddedString(packet, 0)
  const address = addressResult.value

  const tagResult = readPaddedString(packet, addressResult.nextOffset)
  const tagString = tagResult.value
  if (!tagString.startsWith(',')) {
    throw new OscError(`OSC type-tag string must start with ',': got "${tagString}"`)
  }
  const tags = tagString.slice(1)
  const args: OscArg[] = []
  let offset = tagResult.nextOffset
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)

  for (const tag of tags) {
    switch (tag) {
      case 'f': {
        if (offset + 4 > packet.length) {
          throw new OscError(
            `truncated OSC message: float arg for ${address} needs 4 bytes at offset ${offset}, packet is ${packet.length} bytes`,
          )
        }
        args.push({ type: 'f', value: view.getFloat32(offset, false) })
        offset += 4
        break
      }
      case 'i': {
        if (offset + 4 > packet.length) {
          throw new OscError(
            `truncated OSC message: int arg for ${address} needs 4 bytes at offset ${offset}, packet is ${packet.length} bytes`,
          )
        }
        args.push({ type: 'i', value: view.getInt32(offset, false) })
        offset += 4
        break
      }
      case 's': {
        const str = readPaddedString(packet, offset)
        args.push({ type: 's', value: str.value })
        offset = str.nextOffset
        break
      }
      case 'b': {
        if (offset + 4 > packet.length) {
          throw new OscError(
            `truncated OSC message: blob size for ${address} needs 4 bytes at offset ${offset}, packet is ${packet.length} bytes`,
          )
        }
        const size = view.getInt32(offset, false)
        offset += 4
        if (offset + size > packet.length) {
          throw new OscError(
            `truncated OSC message: blob for ${address} declares ${size} bytes at offset ${offset}, packet is only ${packet.length} bytes`,
          )
        }
        args.push({ type: 'b', value: new Uint8Array(packet.subarray(offset, offset + size)) })
        offset += size + pad4(size)
        break
      }
      default:
        throw new OscError(
          `unknown OSC type tag '${tag}' in message ${address}; supported tags are f, i, s, b`,
        )
    }
  }

  return { address, typeTags: `,${tags}`, args }
}

export { normalizeReplyAddress, replyAddressMatches } from './address.js'
export { assertReadOnlyOscMessage } from './read-only-guard.js'
export type {
  ChannelStrip,
  ChannelPreamp,
  ChannelGate,
  ChannelDynamics,
  ChannelEq,
} from './channel-strip.js'
export {
  parseChannelStrips,
  buildChannelFaderPath,
  buildHeadampGainPath,
  buildDcaFaderPath,
} from './channel-strip.js'
export { oscToOnState } from './scaling.js'