import { OscError } from './index.js'
import type { DecodedOscMessage, OscMessage } from './index.js'
import { normalizeReplyAddress } from './address.js'

// The M32R's meter blob interior is little-endian, unlike every other value
// in this protocol (which is big-endian throughout — see decodeOscMessage in
// ./index.ts). This is the one place in the package that reads little-endian
// bytes. Layout and scale per the #848 discovery session's findings document
// (docs/discovery/m32r-discovery-findings.md §3 "Meter mechanism", commit
// bb813fa): a little-endian int32 count followed by that many little-endian
// float32 values, linear 0.0..1.0 (1.0 = digital full scale) with headroom to
// about 8.0 (~+18 dBFS).
const LITTLE_ENDIAN = true

const COUNT_FIELD_BYTES = 4
const FLOAT32_BYTES = 4

export const METERS_1_ADDRESS = '/meters/1'
const METERS_1_BAND_SIZE = 32 // channels per band
const METERS_1_BANDS = 3 // input level, gate GR, dynamics GR
const METERS_1_VALUE_COUNT = METERS_1_BAND_SIZE * METERS_1_BANDS // 96
const METERS_1_BLOB_BYTES = COUNT_FIELD_BYTES + METERS_1_VALUE_COUNT * FLOAT32_BYTES // 388

/**
 * One decoded /meters/1 frame. Values are linear and unscaled, exactly as the
 * console reports them: 0.0..1.0 where 1.0 is digital full scale, rising to
 * about 8.0 (~ +18 dBFS) with headroom. Conversion to dB is the caller's job.
 */
export interface Meters1Snapshot {
  /** 32 input levels, channels 1..32 in order. */
  inputs: number[]
  /** 32 gate gain-reduction values, channels 1..32 in order. */
  gateGainReduction: number[]
  /** 32 dynamics (compressor) gain-reduction values, channels 1..32 in order. */
  dynamicsGainReduction: number[]
}

/**
 * Generic little-endian meter blob reader: a 4-byte little-endian int32
 * count followed by `count` little-endian float32 values. Usable for any
 * meter set, not just /meters/1.
 */
export function decodeMeterBlob(blob: Uint8Array): number[] {
  if (blob.byteLength < COUNT_FIELD_BYTES) {
    throw new OscError(
      `meter blob is ${blob.byteLength} bytes, too short for the 4-byte little-endian count field a meter blob must start with`,
    )
  }

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const count = view.getInt32(0, LITTLE_ENDIAN)

  if (count < 0) {
    throw new OscError(
      `meter blob declares a negative count (${count}); this usually means the count field was read big-endian instead of the little-endian this console's meter blobs use`,
    )
  }

  const expectedBytes = COUNT_FIELD_BYTES + count * FLOAT32_BYTES
  if (blob.byteLength !== expectedBytes) {
    throw new OscError(
      `meter blob declares count ${count} (expects ${expectedBytes} little-endian bytes) but is ${blob.byteLength} bytes; check for a truncated frame or a little-endian/big-endian mismatch`,
    )
  }

  const values: number[] = []
  for (let i = 0; i < count; i++) {
    values.push(view.getFloat32(COUNT_FIELD_BYTES + i * FLOAT32_BYTES, LITTLE_ENDIAN))
  }
  return values
}

/**
 * Decodes a /meters/1 blob into its typed 32/32/32 band snapshot.
 */
export function decodeMeters1Blob(blob: Uint8Array): Meters1Snapshot {
  const values = decodeMeterBlob(blob)

  if (values.length !== METERS_1_VALUE_COUNT) {
    throw new OscError(
      `${METERS_1_ADDRESS} frame must decode to exactly ${METERS_1_VALUE_COUNT} values (${METERS_1_BLOB_BYTES} bytes); got ${values.length} values (${blob.byteLength} bytes) — this does not look like a ${METERS_1_ADDRESS} frame`,
    )
  }

  return {
    inputs: values.slice(0, METERS_1_BAND_SIZE),
    gateGainReduction: values.slice(METERS_1_BAND_SIZE, METERS_1_BAND_SIZE * 2),
    dynamicsGainReduction: values.slice(METERS_1_BAND_SIZE * 2, METERS_1_BAND_SIZE * 3),
  }
}

/**
 * Extracts and decodes a /meters/1 snapshot from an already-decoded OSC
 * push message, after normalizing the reply address (replies may or may not
 * carry a leading slash) and validating the blob argument.
 */
export function decodeMeters1Message(message: DecodedOscMessage): Meters1Snapshot {
  const address = normalizeReplyAddress(message.address)
  if (address !== METERS_1_ADDRESS) {
    throw new OscError(
      `expected a ${METERS_1_ADDRESS} reply but got "${message.address}" (normalized: "${address}")`,
    )
  }

  const first = message.args[0]
  if (!first || first.type !== 'b') {
    throw new OscError(
      `a ${METERS_1_ADDRESS} push must carry a single blob ('b') argument; got type tags "${message.typeTags}"`,
    )
  }

  return decodeMeters1Blob(first.value)
}

// Throttle grammar (#883, per the #848 discovery session). The console
// answers a bare `,s` subscribe at ~20 Hz. Throttling requires the FULL
// four-argument form — `/meters ,siii "<block>" 0 0 <tf>` — where the LAST
// int is the time factor and the frame interval is 50ms x tf. The `,si`
// form does NOT throttle: its single int is read as chn_meter_id and the
// stream stays at ~20 Hz, so this module never emits it.
const METERS_SUBSCRIBE_ADDRESS = '/meters'
const METERS_SUBSCRIBE_RESERVED_ARG = 0 // the two leading ints are unused positional filler
export const METER_TIME_FACTOR_INTERVAL_MS = 50
export const METER_TIME_FACTOR_MIN = 1
export const METER_TIME_FACTOR_MAX = 99

function assertTimeFactor(timeFactor: number): void {
  if (!Number.isInteger(timeFactor) || timeFactor < METER_TIME_FACTOR_MIN || timeFactor > METER_TIME_FACTOR_MAX) {
    throw new OscError(
      `meter time factor must be an integer in ${METER_TIME_FACTOR_MIN}..${METER_TIME_FACTOR_MAX} (frame interval = ${METER_TIME_FACTOR_INTERVAL_MS}ms x factor); got ${timeFactor}. Omit the time factor entirely for the console's ~20 Hz default — do not send the single-int ",si" form, which is read as chn_meter_id and does not throttle.`,
    )
  }
}

/**
 * Builds the /meters subscribe message for one meter block. Omit timeFactor
 * for the console's default ~20 Hz stream (the `,s` form); supply it for the
 * `,siii` throttle form, whose last int is the time factor.
 */
export function buildMetersSubscribeMessage(meterBlock: string, timeFactor?: number): OscMessage {
  if (!meterBlock.startsWith('/meters/')) {
    throw new OscError(
      `meter block must name a meter set such as "/meters/1" (got "${meterBlock}"); a typo'd block subscribes to nothing with no error from the console`,
    )
  }

  if (timeFactor === undefined) {
    return { address: METERS_SUBSCRIBE_ADDRESS, args: [{ type: 's', value: meterBlock }] }
  }

  assertTimeFactor(timeFactor)
  return {
    address: METERS_SUBSCRIBE_ADDRESS,
    args: [
      { type: 's', value: meterBlock },
      { type: 'i', value: METERS_SUBSCRIBE_RESERVED_ARG },
      { type: 'i', value: METERS_SUBSCRIBE_RESERVED_ARG },
      { type: 'i', value: timeFactor },
    ],
  }
}

/** Expected interval between pushes, in ms, for a given time factor (default ~20 Hz). */
export function meterFrameIntervalMs(timeFactor?: number): number {
  if (timeFactor === undefined) {
    return METER_TIME_FACTOR_INTERVAL_MS
  }
  assertTimeFactor(timeFactor)
  return METER_TIME_FACTOR_INTERVAL_MS * timeFactor
}
