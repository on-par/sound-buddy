import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseChannelSends, parseChannelSendLine, isActiveSend } from './channel-sends.js'

const fixture = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')

describe('parseChannelSendLine', () => {
  it('reads on and level from an odd send line that also carries pan and tap tokens', () => {
    expect(parseChannelSendLine('/ch/01/mix/01 ON  -9.8 +0 PRE 0')).toEqual({ channel: 1, bus: 1, on: true, level: -9.8 })
  })

  it('reads on and level from an even send line that carries only those two tokens', () => {
    expect(parseChannelSendLine('/ch/02/mix/04 ON  +2.3')).toEqual({ channel: 2, bus: 4, on: true, level: 2.3 })
  })

  it('maps -oo to -Infinity and OFF to off', () => {
    expect(parseChannelSendLine('/ch/03/mix/07 OFF   -oo +0 PRE 0')).toEqual({ channel: 3, bus: 7, on: false, level: -Infinity })
  })

  it('ignores the channel mix line itself and unrelated lines', () => {
    expect(parseChannelSendLine('/ch/01/mix OFF   -oo ON +0 OFF   -oo')).toBeNull()
    expect(parseChannelSendLine('/bus/01/mix/01 ON   -oo -100 POST 0')).toBeNull()
    expect(parseChannelSendLine('/ch/01/mix/01 ON -9.8x')).toBeNull()
  })
})

describe('parseChannelSends on the 2026-08-16 capture', () => {
  const sends = parseChannelSends(fixture)

  it('yields sixteen sends for each of the 32 input channels', () => {
    expect(sends).toHaveLength(32 * 16)
    expect(sends.filter((s) => s.channel === 32)).toHaveLength(16)
  })

  it('reads channel 1 and channel 2 sends exactly as the scene file has them', () => {
    expect(sends.slice(0, 3)).toEqual([
      { channel: 1, bus: 1, on: true, level: -9.8 },
      { channel: 1, bus: 2, on: true, level: -9.8 },
      { channel: 1, bus: 3, on: true, level: -29.0 },
    ])
    expect(sends.find((s) => s.channel === 2 && s.bus === 3)).toEqual({ channel: 2, bus: 3, on: true, level: 2.3 })
    expect(sends.find((s) => s.channel === 1 && s.bus === 7)?.level).toBe(-Infinity)
  })

  it('sorts by channel then bus even when the input is out of order', () => {
    const out = parseChannelSends('/ch/02/mix/01 ON -1.0\n/ch/01/mix/02 ON -2.0\n/ch/01/mix/01 ON -3.0')
    expect(out.map((s) => [s.channel, s.bus])).toEqual([[1, 1], [1, 2], [2, 1]])
  })
})

describe('isActiveSend', () => {
  it('is true only for an on send with a finite level', () => {
    expect(isActiveSend({ channel: 1, bus: 1, on: true, level: -9.8 })).toBe(true)
    expect(isActiveSend({ channel: 1, bus: 1, on: true, level: -Infinity })).toBe(false)
    expect(isActiveSend({ channel: 1, bus: 1, on: false, level: 0 })).toBe(false)
  })
})
