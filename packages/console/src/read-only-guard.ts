import { OscError } from './index.js'
import type { OscMessage } from './index.js'

const DENY_ADDRESS_PREFIXES = [
  '/save',
  '/load',
  '/copy',
  '/paste',
  '/delete',
  '/add',
  '/undo',
  '/scene',
  '/snapshot',
  '/cue',
  '/-action',
  '/-libs',
] as const

const ALLOWED_WITH_ARGS_ADDRESSES: string[] = [
  '/node',
  '/meters',
  '/xremote',
  '/renew',
  '/unsubscribe',
  '/info',
  '/xinfo',
]

function isDeniedAddress(address: string): boolean {
  return DENY_ADDRESS_PREFIXES.some(
    (prefix) => address === prefix || address.startsWith(`${prefix}/`),
  )
}

export function assertReadOnlyOscMessage(message: OscMessage): void {
  if (isDeniedAddress(message.address)) {
    throw new OscError(
      `OSC address "${message.address}" is a write/mutation address and is refused by the read-only guardrail`,
    )
  }

  if (message.args.length === 0) {
    return
  }

  if (!ALLOWED_WITH_ARGS_ADDRESSES.includes(message.address)) {
    throw new OscError(
      `OSC address "${message.address}" is not on the read-only allowlist for messages with arguments`,
    )
  }

  if (message.address === '/node') {
    const firstArg = message.args[0]
    if (firstArg && firstArg.type === 's') {
      const normalized = `/${firstArg.value.replace(/^\/+/, '')}`
      if (isDeniedAddress(normalized)) {
        throw new OscError(
          `OSC /node argument "${firstArg.value}" references a write/mutation namespace and is refused by the read-only guardrail`,
        )
      }
    }
  }
}
