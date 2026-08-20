/**
 * Before/after capture assembly for #891. A "capture" is the .scn text
 * captureSceneFromConsole returns (or the same text read from disk) — this
 * module does no I/O by decision (see the ADR in this PR); path validation
 * and file reading stay in app/electron/scene-diff.ts.
 */
import type { Scene, SceneDiff } from '@sound-buddy/shared'
import { parseScene } from './parseScene.js'
import { diffScenes } from './diffScenes.js'

/** One side of a before/after capture pair. `source` is a caller-supplied label
 *  (file path, saved-capture name, timestamp) used only in messages and in the
 *  returned identity — this module never opens it. */
export interface CaptureRef {
  source: string
  content: string
}

/** Which capture a side of the diff came from, so a caller can label before/after
 *  without re-parsing the scene text. */
export interface CaptureIdentity {
  source: string
  sceneName: string
  version: string
}

export interface CaptureDiff {
  before: CaptureIdentity
  after: CaptureIdentity
  /** Exactly what diffScenes() returned — changes, summary, bySection. */
  diff: SceneDiff
}

export class CaptureDiffError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CaptureDiffError'
  }
}

type CaptureSide = 'before' | 'after'

function parseSide(side: CaptureSide, ref: CaptureRef): Scene {
  try {
    return parseScene(ref.content)
  } catch (err) {
    throw new CaptureDiffError(
      `The "${side}" capture (${ref.source}) is not a valid M32R scene file. ` +
        `Capture the console again with Sound Buddy, or pick a .scn file exported ` +
        `from the desk (Setup → Scenes → Export), then run the diff again.`,
      { cause: err },
    )
  }
}

export function diffCaptures(before: CaptureRef, after: CaptureRef): CaptureDiff {
  const sceneBefore = parseSide('before', before)
  const sceneAfter = parseSide('after', after)
  return {
    before: { source: before.source, sceneName: sceneBefore.name, version: sceneBefore.version },
    after: { source: after.source, sceneName: sceneAfter.name, version: sceneAfter.version },
    diff: diffScenes(sceneBefore, sceneAfter),
  }
}
