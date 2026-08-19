// `/node` answers a stored-scene *metadata* line at
// `/-show/showfile/scene/NNN` — name, note, safes mask, occupied flag — but
// never the scene's parameter contents, which are unreachable over the
// read-only OSC surface (#890 / #848 discovery session). This module knows
// nothing about sockets (ADR-0061, see
// app/electron/ipc/console-scene-inventory.ts for the walk itself), and
// exports no recall/save/store helper by decision: the read-only guard
// refuses `/-action/goscene` and `/-action/gosnippet` at the encoder, and
// this module is not where that boundary would ever be worked around.

import type { DecodedOscMessage } from './index.js'
import { normalizeReplyAddress } from './address.js'
import { parseNodeReplyLine } from './scene-capture.js'

export class SceneInventoryError extends Error {}

export const SCENE_INVENTORY_SLOT_COUNT = 100
export const SCENE_INVENTORY_PATH_PREFIX = '/-show/showfile/scene'
const SLOT_INDEX_DIGITS = 3

export interface StoredSceneEntry {
  /** 0-based slot number, 0..99. */
  index: number
  /** Normalized node path this entry came from, e.g. '/-show/showfile/scene/000'. */
  path: string
  /** Scene name as stored on the desk; '' for an empty slot. May carry personal info — display-local only. */
  name: string
  /** Scene note as stored on the desk; '' when unset. */
  note: string
  /** Raw safes mask token exactly as the console reports it, e.g. '%000000000'. */
  safesMask: string
  /** True when the slot holds a stored scene (trailing flag '1'). */
  occupied: boolean
}

export const SCENE_CONTENTS_UNREADABLE_NOTICE =
  'Sound Buddy reads scene names and notes only. The console does not expose a ' +
  'stored scene’s settings over the read-only connection, and Sound Buddy ' +
  'never recalls, saves or changes scenes on the desk — use the console for that.'

export function buildSceneInventoryPath(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= SCENE_INVENTORY_SLOT_COUNT) {
    throw new SceneInventoryError(
      `scene slot index must be an integer in 0..${SCENE_INVENTORY_SLOT_COUNT - 1} (got ${index})`,
    )
  }
  return `${SCENE_INVENTORY_PATH_PREFIX}/${String(index).padStart(SLOT_INDEX_DIGITS, '0')}`
}

function buildSceneInventoryPaths(): string[] {
  const paths: string[] = []
  for (let i = 0; i < SCENE_INVENTORY_SLOT_COUNT; i++) {
    paths.push(buildSceneInventoryPath(i))
  }
  return paths
}

export const SCENE_INVENTORY_NODE_PATHS: readonly string[] = Object.freeze(buildSceneInventoryPaths())

const STORED_SCENE_LINE = /^(\S+) "([^"]*)" "([^"]*)" (\S+) (\S+)$/

export function parseStoredSceneLine(
  expectedPath: string,
  message: DecodedOscMessage,
): StoredSceneEntry | null {
  const line = parseNodeReplyLine(expectedPath, message)
  if (line === null) return null

  const match = STORED_SCENE_LINE.exec(line)
  if (!match) return null

  const [, rawPath, name, note, safesMask, occupiedToken] = match
  if (!safesMask.startsWith('%')) return null
  if (occupiedToken !== '0' && occupiedToken !== '1') return null

  const lastSlash = expectedPath.lastIndexOf('/')
  const index = Number.parseInt(expectedPath.slice(lastSlash + 1), 10)
  if (!Number.isInteger(index) || index < 0 || index >= SCENE_INVENTORY_SLOT_COUNT) return null

  return {
    index,
    path: normalizeReplyAddress(rawPath),
    name,
    note,
    safesMask,
    occupied: occupiedToken === '1',
  }
}
