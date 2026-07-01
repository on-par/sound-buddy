import { readFileSync, existsSync } from 'node:fs'
import { parseScene, diffScenes } from '@sound-buddy/scene-inspector'
import type { SceneDiff, SceneChange } from '@sound-buddy/shared'

interface DiffOptions {
  json?: boolean
}

interface DiffResult {
  stdout: string
  stderr: string
  exitCode: number
}

function formatHumanReadable(diff: SceneDiff): string {
  if (diff.changes.length === 0) {
    return 'No differences found\n'
  }

  const lines: string[] = []

  const renderChanges = (section: string, changes: SceneChange[]) => {
    if (changes.length === 0) return
    lines.push(`${section}:`)
    for (const c of changes) {
      const from = typeof c.from === 'boolean' ? String(c.from) : String(c.from)
      const to = typeof c.to === 'boolean' ? String(c.to) : String(c.to)
      lines.push(`  ${c.label}: ${from} → ${to}`)
    }
    lines.push('')
  }

  renderChanges('Channels', diff.bySection.channels)
  renderChanges('DCAs', diff.bySection.dcas)
  renderChanges('Main', diff.bySection.main)

  return lines.join('\n')
}

export async function runDiff(file1: string, file2: string, opts: DiffOptions): Promise<DiffResult> {
  if (!existsSync(file1)) {
    return { stdout: '', stderr: `Error: file not found: ${file1}`, exitCode: 1 }
  }
  if (!existsSync(file2)) {
    return { stdout: '', stderr: `Error: file not found: ${file2}`, exitCode: 1 }
  }

  let diff: SceneDiff
  try {
    const contentA = readFileSync(file1, 'utf8') as string
    const contentB = readFileSync(file2, 'utf8') as string
    const sceneA = parseScene(contentA)
    const sceneB = parseScene(contentB)
    diff = diffScenes(sceneA, sceneB)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { stdout: '', stderr: `Error: ${message}`, exitCode: 1 }
  }

  if (opts.json) {
    return { stdout: JSON.stringify(diff, null, 2) + '\n', stderr: '', exitCode: 0 }
  }

  return { stdout: formatHumanReadable(diff), stderr: '', exitCode: 0 }
}
