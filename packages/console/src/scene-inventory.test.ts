import { describe, it, expect } from 'vitest'
import { encodeOscMessage, OscError, type DecodedOscMessage } from './index.js'
import {
  SceneInventoryError,
  SCENE_INVENTORY_SLOT_COUNT,
  SCENE_INVENTORY_PATH_PREFIX,
  SCENE_INVENTORY_NODE_PATHS,
  SCENE_CONTENTS_UNREADABLE_NOTICE,
  buildSceneInventoryPath,
  parseStoredSceneLine,
} from './scene-inventory.js'

function messageFor(address: string, args: DecodedOscMessage['args']): DecodedOscMessage {
  return { address, typeTags: `,${args.map((a) => a.type).join('')}`, args }
}

describe('buildSceneInventoryPath', () => {
  it('returns the zero-padded path for slot 0', () => {
    expect(buildSceneInventoryPath(0)).toBe('/-show/showfile/scene/000')
  })

  it('returns the zero-padded path for slot 7', () => {
    expect(buildSceneInventoryPath(7)).toBe('/-show/showfile/scene/007')
  })

  it('returns the zero-padded path for slot 99', () => {
    expect(buildSceneInventoryPath(99)).toBe('/-show/showfile/scene/099')
  })

  it.each([-1, 100, 1.5, NaN])('throws SceneInventoryError naming the 0..99 range for %s', (index) => {
    expect(() => buildSceneInventoryPath(index)).toThrow(SceneInventoryError)
    try {
      buildSceneInventoryPath(index)
      expect.fail('expected buildSceneInventoryPath to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SceneInventoryError)
      expect((err as Error).message).toContain('0..99')
    }
  })
})

describe('SCENE_INVENTORY_NODE_PATHS', () => {
  it('has exactly SCENE_INVENTORY_SLOT_COUNT entries', () => {
    expect(SCENE_INVENTORY_NODE_PATHS.length).toBe(SCENE_INVENTORY_SLOT_COUNT)
  })

  it('starts with the slot 000 path and ends with the slot 099 path', () => {
    expect(SCENE_INVENTORY_NODE_PATHS[0]).toBe('/-show/showfile/scene/000')
    expect(SCENE_INVENTORY_NODE_PATHS[SCENE_INVENTORY_NODE_PATHS.length - 1]).toBe(
      '/-show/showfile/scene/099',
    )
  })

  it('has no duplicate paths', () => {
    expect(new Set(SCENE_INVENTORY_NODE_PATHS).size).toBe(SCENE_INVENTORY_SLOT_COUNT)
  })

  it('every entry starts with SCENE_INVENTORY_PATH_PREFIX', () => {
    for (const path of SCENE_INVENTORY_NODE_PATHS) {
      expect(path.startsWith(SCENE_INVENTORY_PATH_PREFIX)).toBe(true)
    }
  })
})

describe('parseStoredSceneLine', () => {
  it('parses the issue example line into a StoredSceneEntry', () => {
    const line = '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 1'
    const message = messageFor('/node', [{ type: 's', value: line }])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toEqual({
      index: 0,
      path: '/-show/showfile/scene/000',
      name: 'TPC Sunday',
      note: '',
      safesMask: '%000000000',
      occupied: true,
    })
  })

  it('parses a non-empty note field', () => {
    const line = '/-show/showfile/scene/003 "Sunday AM" "pre-service" %000000000 1'
    const message = messageFor('/node', [{ type: 's', value: line }])
    const entry = parseStoredSceneLine('/-show/showfile/scene/003', message)
    expect(entry?.note).toBe('pre-service')
  })

  it('parses an empty slot as unoccupied with empty name and note, not dropped', () => {
    const line = '/-show/showfile/scene/007 "" "" %000000000 0'
    const message = messageFor('/node', [{ type: 's', value: line }])
    expect(parseStoredSceneLine('/-show/showfile/scene/007', message)).toEqual({
      index: 7,
      path: '/-show/showfile/scene/007',
      name: '',
      note: '',
      safesMask: '%000000000',
      occupied: false,
    })
  })

  it('parses a reply whose address arrives unnormalized as "node"', () => {
    const line = '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 1'
    const message = messageFor('node', [{ type: 's', value: line }])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)?.index).toBe(0)
  })

  it('tolerates a trailing newline on the line', () => {
    const line = '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 1\n'
    const message = messageFor('/node', [{ type: 's', value: line }])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)?.name).toBe('TPC Sunday')
  })

  it('returns null for a reply with the wrong address', () => {
    const message = messageFor('/xinfo', [
      { type: 's', value: '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 1' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null when the line names a different slot than expectedPath', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/001 "TPC Sunday" "" %000000000 1' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a reply with zero args', () => {
    const message = messageFor('/node', [])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a reply with two args', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 1' },
      { type: 's', value: 'extra' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a non-string arg', () => {
    const message = messageFor('/node', [{ type: 'i', value: 1 }])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a line missing the second quoted field', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/000 "TPC Sunday" %000000000 1' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a safes-mask token without the leading %', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/000 "TPC Sunday" "" 000000000 1' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null for a trailing token that is neither 0 nor 1', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/000 "TPC Sunday" "" %000000000 2' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/000', message)).toBeNull()
  })

  it('returns null when expectedPath\'s last segment is not a number', () => {
    const message = messageFor('/node', [
      { type: 's', value: '/-show/showfile/scene/abc "TPC Sunday" "" %000000000 1' },
    ])
    expect(parseStoredSceneLine('/-show/showfile/scene/abc', message)).toBeNull()
  })
})

describe('SCENE_CONTENTS_UNREADABLE_NOTICE', () => {
  it('is non-empty and states both the read-only limit and the no-recall boundary', () => {
    expect(SCENE_CONTENTS_UNREADABLE_NOTICE.length).toBeGreaterThan(0)
    expect(SCENE_CONTENTS_UNREADABLE_NOTICE.toLowerCase()).toMatch(/read-only|does not expose/)
    expect(SCENE_CONTENTS_UNREADABLE_NOTICE.toLowerCase()).toMatch(/recall/)
  })
})

describe('no recall path (AC2, protocol layer)', () => {
  it('refuses /-action/goscene', () => {
    expect(() =>
      encodeOscMessage({ address: '/-action/goscene', args: [{ type: 'i', value: 3 }] }),
    ).toThrow(OscError)
  })

  it('refuses /-action/gosnippet', () => {
    expect(() =>
      encodeOscMessage({ address: '/-action/gosnippet', args: [{ type: 'i', value: 3 }] }),
    ).toThrow(OscError)
  })

  it('allows the inventory read itself', () => {
    expect(() =>
      encodeOscMessage({
        address: '/node',
        args: [{ type: 's', value: '/-show/showfile/scene/000' }],
      }),
    ).not.toThrow()
  })
})
