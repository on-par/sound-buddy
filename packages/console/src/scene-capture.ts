// A `.scn` file is a synthesized one-line header followed by the plain-text
// OSC node lines `/node` returns verbatim (#888 / #848 discovery session).
// This module owns the fixed node-path table, the header, and assembly of
// captured lines into scene text — it knows nothing about sockets (ADR-0061,
// see app/electron/ipc/console-scene-capture.ts for the walk itself).

import type { DecodedOscMessage } from './index.js'
import { normalizeReplyAddress, replyAddressMatches } from './address.js'

export class SceneCaptureError extends Error {}

export const SCENE_FILE_VERSION = '#2.7#'
export const SCENE_NODE_PATH_COUNT = 2103

const MAX_MISSING_PATHS_IN_ERROR = 3 // named constant, no magic number

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}

// Channel/bus family subpath lists, in X32-Edit's own emission order
// (verified against packages/console/src/capture-2026-08-16.scn).
const CHANNEL_SUBPATHS = [
  '/config',
  '/delay',
  '/preamp',
  '/gate',
  '/gate/filter',
  '/dyn',
  '/dyn/filter',
  '/insert',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/mix',
  ...range(1, 16).map((n) => `/mix/${pad(n, 2)}`),
  '/grp',
  '/automix',
]

const AUXIN_SUBPATHS = [
  '/config',
  '/preamp',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/mix',
  ...range(1, 16).map((n) => `/mix/${pad(n, 2)}`),
  '/grp',
]

const FXRTN_SUBPATHS = [
  '/config',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/mix',
  ...range(1, 16).map((n) => `/mix/${pad(n, 2)}`),
  '/grp',
]

const BUS_SUBPATHS = [
  '/config',
  '/dyn',
  '/dyn/filter',
  '/insert',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/eq/5',
  '/eq/6',
  '/mix',
  ...range(1, 6).map((n) => `/mix/${pad(n, 2)}`),
  '/grp',
]

const MTX_SUBPATHS = [
  '/config',
  '/preamp',
  '/dyn',
  '/dyn/filter',
  '/insert',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/eq/5',
  '/eq/6',
  '/mix',
]

const MAIN_SUBPATHS = [
  '/config',
  '/dyn',
  '/dyn/filter',
  '/insert',
  '/eq',
  '/eq/1',
  '/eq/2',
  '/eq/3',
  '/eq/4',
  '/eq/5',
  '/eq/6',
  '/mix',
  ...range(1, 6).map((n) => `/mix/${pad(n, 2)}`),
]

const CONFIG_PATHS = [
  '/config/chlink',
  '/config/auxlink',
  '/config/fxlink',
  '/config/buslink',
  '/config/mtxlink',
  '/config/mute',
  '/config/linkcfg',
  '/config/mono',
  '/config/solo',
  '/config/talk',
  '/config/talk/A',
  '/config/talk/B',
  '/config/osc',
  '/config/routing/IN',
  '/config/routing/AES50A',
  '/config/routing/AES50B',
  '/config/routing/CARD',
  '/config/routing/OUT',
  '/config/routing/PLAY',
  '/config/routing',
  '/config/userctrl/A',
  '/config/userctrl/A/enc',
  '/config/userctrl/A/btn',
  '/config/userctrl/B',
  '/config/userctrl/B/enc',
  '/config/userctrl/B/btn',
  '/config/userctrl/C',
  '/config/userctrl/C/enc',
  '/config/userctrl/C/btn',
  '/config/tape',
  '/config/amixenable',
]

function buildSceneNodePaths(): string[] {
  const paths: string[] = [...CONFIG_PATHS]

  for (const n of range(1, 32)) {
    for (const sub of CHANNEL_SUBPATHS) paths.push(`/ch/${pad(n, 2)}${sub}`)
  }
  for (const n of range(1, 8)) {
    for (const sub of AUXIN_SUBPATHS) paths.push(`/auxin/${pad(n, 2)}${sub}`)
  }
  for (const n of range(1, 8)) {
    for (const sub of FXRTN_SUBPATHS) paths.push(`/fxrtn/${pad(n, 2)}${sub}`)
  }
  for (const n of range(1, 16)) {
    for (const sub of BUS_SUBPATHS) paths.push(`/bus/${pad(n, 2)}${sub}`)
  }
  for (const n of range(1, 6)) {
    for (const sub of MTX_SUBPATHS) paths.push(`/mtx/${pad(n, 2)}${sub}`)
  }
  for (const base of ['/main/st', '/main/m']) {
    for (const sub of MAIN_SUBPATHS) paths.push(`${base}${sub}`)
  }
  for (const n of range(1, 8)) {
    paths.push(`/dca/${n}`)
    paths.push(`/dca/${n}/config`)
  }
  for (const n of range(1, 8)) {
    paths.push(`/fx/${n}`)
    if (n <= 4) paths.push(`/fx/${n}/source`)
    paths.push(`/fx/${n}/par`)
  }
  for (const n of range(1, 16)) {
    paths.push(`/outputs/main/${pad(n, 2)}`)
    paths.push(`/outputs/main/${pad(n, 2)}/delay`)
  }
  for (const n of range(1, 6)) {
    paths.push(`/outputs/aux/${pad(n, 2)}`)
  }
  for (const n of range(1, 16)) {
    paths.push(`/outputs/p16/${pad(n, 2)}`)
    paths.push(`/outputs/p16/${pad(n, 2)}/iQ`)
  }
  paths.push('/outputs/aes/01', '/outputs/aes/02')
  paths.push('/outputs/rec/01', '/outputs/rec/02')
  for (const n of range(0, 127)) {
    paths.push(`/headamp/${pad(n, 3)}`)
  }

  return paths
}

export const SCENE_NODE_PATHS: readonly string[] = Object.freeze(buildSceneNodePaths())

// A quote or newline inside the user's scene name would break the `"([^"]*)"`
// match parseScene() uses to read the header, so strip both rather than emit a
// header the repo's own parser can't read.
function sanitizeHeaderField(value: string): string {
  return value.replace(/["\r\n]/g, '')
}

export function buildSceneHeader(name: string, note: string): string {
  return `${SCENE_FILE_VERSION} "${sanitizeHeaderField(name)}" "${sanitizeHeaderField(note)}" %000000000 1`
}

export function assembleSceneFile(header: string, lines: ReadonlyMap<string, string>): string {
  const missing = SCENE_NODE_PATHS.filter((p) => !lines.has(p))
  if (missing.length > 0) {
    throw new SceneCaptureError(
      `Scene capture is incomplete: ${missing.length} of ${SCENE_NODE_PATH_COUNT} console ` +
        `node paths had no reply (${missing.slice(0, MAX_MISSING_PATHS_IN_ERROR).join(', ')}` +
        `${missing.length > MAX_MISSING_PATHS_IN_ERROR ? ', …' : ''}). Nothing was saved — ` +
        `check the console is still powered on and reachable, then run the capture again.`,
    )
  }
  return [header, ...SCENE_NODE_PATHS.map((p) => lines.get(p) as string)].join('\n') + '\n'
}

export function parseNodeReplyLine(expectedPath: string, message: DecodedOscMessage): string | null {
  if (!replyAddressMatches('/node', message.address)) return null
  if (message.args.length !== 1 || message.args[0].type !== 's') return null
  const line = message.args[0].value.trimEnd()
  const firstToken = line.split(/\s/, 1)[0]
  if (normalizeReplyAddress(firstToken) !== normalizeReplyAddress(expectedPath)) return null
  return line
}
