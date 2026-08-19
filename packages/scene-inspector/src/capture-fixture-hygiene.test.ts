import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Capture-privacy guard (#893). Raw M32R scene dumps carry identifying
// material and this repo is public with permanent history, so an unscrubbed
// capture committed once can never be taken back. Only the scrubbed capture
// under packages/console/src is allowed; local raw dumps are named
// `*.local.scn` and gitignored. This test is the enforcement.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SCRUBBED_FIXTURE = 'packages/console/src/capture-2026-08-16.scn'
const RAW_CAPTURE_PATTERN = '*.local.scn'

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0)
}

describe('console capture fixture hygiene (#893)', () => {
  it('commits no unscrubbed *.local.scn capture', () => {
    const raw = trackedFiles().filter((f) => f.endsWith('.local.scn'))
    expect(
      raw,
      'unscrubbed console captures must never be committed — delete them and rewrite history before pushing',
    ).toEqual([])
  })

  it('ignores *.local.scn so a raw capture cannot be staged by accident', () => {
    const gitignore = readFileSync(`${REPO_ROOT}.gitignore`, 'utf8')
      .split('\n')
      .map((line) => line.trim())
    expect(
      gitignore,
      `.gitignore must contain the pattern "${RAW_CAPTURE_PATTERN}" so a raw console capture cannot be staged by accident`,
    ).toContain(RAW_CAPTURE_PATTERN)
  })

  it('keeps the scrubbed real-console capture committed', () => {
    expect(
      trackedFiles(),
      `expected the scrubbed capture at ${SCRUBBED_FIXTURE} to remain tracked`,
    ).toContain(SCRUBBED_FIXTURE)
  })
})
