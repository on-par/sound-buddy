import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { encodeOscMessage, type DecodedOscMessage } from './index.js'
import {
  SceneCaptureError,
  SCENE_FILE_VERSION,
  SCENE_NODE_PATHS,
  SCENE_NODE_PATH_COUNT,
  buildSceneHeader,
  assembleSceneFile,
  parseNodeReplyLine,
} from './scene-capture.js'

const captureText = readFileSync(new URL('./capture-2026-08-16.scn', import.meta.url), 'utf8')

function fixtureLines(): string[] {
  const lines = captureText.split('\n')
  // drop the header line and any trailing empty line from the final newline
  return lines.slice(1).filter((l) => l.length > 0)
}

function fixturePathToLineMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of fixtureLines()) {
    const firstToken = line.split(/\s/, 1)[0]
    map.set(firstToken, line)
  }
  return map
}

describe('SCENE_NODE_PATHS', () => {
  it('matches the real-console capture fixture exactly, in order', () => {
    const fixturePaths = fixtureLines().map((line) => line.split(/\s/, 1)[0])
    expect(SCENE_NODE_PATHS).toEqual(fixturePaths)
  })

  it('has exactly SCENE_NODE_PATH_COUNT entries', () => {
    expect(SCENE_NODE_PATHS.length).toBe(SCENE_NODE_PATH_COUNT)
  })

  it('has no duplicate paths', () => {
    expect(new Set(SCENE_NODE_PATHS).size).toBe(SCENE_NODE_PATH_COUNT)
  })

  it('every path encodes as a read-only-safe /node request', () => {
    for (const path of SCENE_NODE_PATHS) {
      expect(() => encodeOscMessage({ address: '/node', args: [{ type: 's', value: path }] })).not.toThrow()
    }
  })
})

describe('buildSceneHeader', () => {
  it('formats name and note into the exact scene header shape', () => {
    expect(buildSceneHeader('Sunday AM', 'pre-service')).toBe(
      `${SCENE_FILE_VERSION} "Sunday AM" "pre-service" %000000000 1`,
    )
  })

  it('strips quote and newline characters from name and note', () => {
    expect(buildSceneHeader('a"b\nc', 'd"e\rf')).toBe(`${SCENE_FILE_VERSION} "abc" "def" %000000000 1`)
  })

  it('produces empty quoted fields for empty strings', () => {
    expect(buildSceneHeader('', '')).toBe(`${SCENE_FILE_VERSION} "" "" %000000000 1`)
  })
})

describe('assembleSceneFile', () => {
  it('byte-exact round trip: fixture lines through assembleSceneFile reproduce the fixture', () => {
    const header = buildSceneHeader('TPC M32R A capture', 'read-only OSC capture, issue 848')
    const map = fixturePathToLineMap()
    expect(assembleSceneFile(header, map)).toBe(captureText)
  })

  it('throws SceneCaptureError naming the missing path when one path is absent', () => {
    const map = fixturePathToLineMap()
    const missingPath = SCENE_NODE_PATHS[100]
    map.delete(missingPath)
    expect(() => assembleSceneFile(buildSceneHeader('n', 'note'), map)).toThrow(SceneCaptureError)
    try {
      assembleSceneFile(buildSceneHeader('n', 'note'), map)
      expect.fail('expected assembleSceneFile to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SceneCaptureError)
      expect((err as Error).message).toContain(missingPath)
      expect((err as Error).message).toContain('Nothing was saved')
    }
  })

  it('truncates the missing-path list with an ellipsis when more than 3 paths are missing', () => {
    const map = fixturePathToLineMap()
    const missingPaths = SCENE_NODE_PATHS.slice(200, 204)
    for (const p of missingPaths) map.delete(p)
    expect(missingPaths.length).toBe(4)
    try {
      assembleSceneFile(buildSceneHeader('n', 'note'), map)
      expect.fail('expected assembleSceneFile to throw')
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain('4 of')
      expect(message).toContain(missingPaths[0])
      expect(message).toContain(missingPaths[1])
      expect(message).toContain(missingPaths[2])
      expect(message).not.toContain(missingPaths[3])
      expect(message).toContain('…')
    }
  })
})

describe('parseNodeReplyLine', () => {
  function messageFor(address: string, args: DecodedOscMessage['args']): DecodedOscMessage {
    return { address, typeTags: `,${args.map((a) => a.type).join('')}`, args }
  }

  it('accepts a /node reply and strips the trailing newline', () => {
    const line = '/ch/01/config "Kick" 1 RD 1\n'
    const message = messageFor('/node', [{ type: 's', value: line }])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBe('/ch/01/config "Kick" 1 RD 1')
  })

  it('accepts an unnormalized "node" address', () => {
    const line = '/ch/01/config "Kick" 1 RD 1'
    const message = messageFor('node', [{ type: 's', value: line }])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBe(line)
  })

  it('returns null for a reply with the wrong address', () => {
    const message = messageFor('/xinfo', [{ type: 's', value: '/ch/01/config "Kick" 1 RD 1' }])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBeNull()
  })

  it('returns null for a reply with 0 args', () => {
    const message = messageFor('/node', [])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBeNull()
  })

  it('returns null for a reply with 2 args', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/ch/01/config' },
      { type: 's', value: 'extra' },
    ])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBeNull()
  })

  it('returns null for a non-string arg', () => {
    const message = messageFor('/node', [{ type: 'i', value: 1 }])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBeNull()
  })

  it('returns null when the line first token is a different path', () => {
    const message = messageFor('/node', [{ type: 's', value: '/ch/02/config "Kick" 1 RD 1' }])
    expect(parseNodeReplyLine('/ch/01/config', message)).toBeNull()
  })
})
