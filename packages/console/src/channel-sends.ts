import { parseFaderToken } from './channel-strip.js'

export interface ChannelSend {
  channel: number
  bus: number
  on: boolean
  level: number
}

const SEND_RE = /^\/ch\/(\d+)\/mix\/(\d+)\s+(ON|OFF)\s+(-oo|[+-]?[\d.]+)(?:\s|$)/

export function parseChannelSendLine(line: string): ChannelSend | null {
  const m = line.trim().match(SEND_RE)
  if (!m) return null
  return { channel: parseInt(m[1], 10), bus: parseInt(m[2], 10), on: m[3] === 'ON', level: parseFaderToken(m[4]) }
}

export function parseChannelSends(captureText: string): ChannelSend[] {
  const sends: ChannelSend[] = []
  for (const raw of captureText.split('\n')) {
    const send = parseChannelSendLine(raw)
    if (send) sends.push(send)
  }
  return sends.sort((a, b) => a.channel - b.channel || a.bus - b.bus)
}

export function isActiveSend(send: ChannelSend): boolean {
  return send.on && Number.isFinite(send.level)
}
