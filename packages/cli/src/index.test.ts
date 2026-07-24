import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./analyze.js', () => ({ runAnalyze: vi.fn() }))
vi.mock('./diff.js', () => ({ runDiff: vi.fn() }))

import { runAnalyze } from './analyze.js'
import { runDiff } from './diff.js'

const mockRunAnalyze = vi.mocked(runAnalyze)
const mockRunDiff = vi.mocked(runDiff)

class ExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

const originalArgv = process.argv
let stdout: string
let stderr: string
let exitCalls: (number | undefined)[]
let exitSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  stdout = ''
  stderr = ''
  exitCalls = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // `as never` sidesteps strict-mode friction between the mocked module
  // shape and vitest's inferred mock-return types.
  mockRunAnalyze.mockResolvedValue(undefined as never)
  mockRunDiff.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as never)
})

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
})

/**
 * Load the CLI with the given argv.
 * throwOnExit=true  — for paths where Commander itself exits SYNCHRONOUSLY
 *   during parse (--version, --help, unknown command/option, missing arg,
 *   the record command). process.exit throws ExitError so Commander halts
 *   exactly like a real exit; the module-eval error rejects the import and
 *   is swallowed here.
 * throwOnExit=false — for paths where process.exit is reached inside an
 *   ASYNC action callback (diff action, analyze .catch). Throwing there
 *   would be an unhandled promise rejection (parse() does not await the
 *   action), which fails the vitest run. Instead exit records and returns;
 *   exit is the last statement in those callbacks, so returning is safe.
 */
async function runCli(args: string[], { throwOnExit = true } = {}) {
  process.argv = ['node', 'buddy', ...args]
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code)
    if (throwOnExit) throw new ExitError(code)
    return undefined as never
  }) as never)
  try {
    await import('./index.js')
  } catch (e) {
    if (!(e instanceof ExitError)) throw e
  }
}

describe('buddy CLI', () => {
  describe('version / help', () => {
    it('--version prints the version and exits 0', async () => {
      await runCli(['--version'])

      expect(stdout).toContain('0.1.0')
      expect(exitCalls[0]).toBe(0)
    })

    it('--help prints program help and exits 0', async () => {
      await runCli(['--help'])

      expect(stdout).toContain('buddy')
      expect(stdout).toContain('diff')
      expect(stdout).toContain('analyze')
      expect(stdout).toContain('record')
      expect(stdout).toContain('M32R audio analysis CLI')
      expect(exitCalls[0]).toBe(0)
    })

    it('diff --help prints diff command help and exits 0', async () => {
      await runCli(['diff', '--help'])

      expect(stdout).toContain('Diff two M32R .scn scene files')
      expect(stdout).toContain('--json')
      expect(exitCalls[0]).toBe(0)
    })

    it('analyze --help prints analyze command help and exits 0', async () => {
      await runCli(['analyze', '--help'])

      expect(stdout).toContain('--dir')
      expect(stdout).toContain('--scene')
      expect(stdout).toContain('--json')
      expect(exitCalls[0]).toBe(0)
    })
  })

  describe('diff dispatch', () => {
    it('forwards args and writes stdout on success', async () => {
      mockRunDiff.mockResolvedValue({ stdout: 'the diff\n', stderr: '', exitCode: 0 } as never)

      await runCli(['diff', 'a.scn', 'b.scn'], { throwOnExit: false })
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled())

      expect(mockRunDiff).toHaveBeenCalledTimes(1)
      expect(mockRunDiff.mock.calls[0][0]).toBe('a.scn')
      expect(mockRunDiff.mock.calls[0][1]).toBe('b.scn')
      expect(mockRunDiff.mock.calls[0][2].json).toBeUndefined()
      expect(stdout).toContain('the diff')
      expect(exitCalls).toContain(0)
    })

    it('forwards --json flag', async () => {
      mockRunDiff.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as never)

      await runCli(['diff', 'a.scn', 'b.scn', '--json'], { throwOnExit: false })
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled())

      expect(mockRunDiff.mock.calls[0][2].json).toBe(true)
    })

    it('propagates non-zero exit code and writes stderr', async () => {
      mockRunDiff.mockResolvedValue({
        stdout: '',
        stderr: 'Error: file not found: a.scn',
        exitCode: 1,
      } as never)

      await runCli(['diff', 'a.scn', 'b.scn'], { throwOnExit: false })
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled())

      expect(stderr).toContain('Error: file not found: a.scn')
      expect(stderr.endsWith('\n')).toBe(true)
      expect(exitCalls).toContain(1)
      expect(stdout).toBe('')
    })

    it('missing file2 arg exits 1 without calling runDiff', async () => {
      await runCli(['diff', 'a.scn'])

      expect(stderr).toContain('missing required argument')
      expect(stderr).toContain('file2')
      expect(exitCalls[0]).toBe(1)
      expect(mockRunDiff).not.toHaveBeenCalled()
    })
  })

  describe('analyze dispatch', () => {
    it('calls runAnalyze with the file and default opts', async () => {
      await runCli(['analyze', 'song.wav'])

      expect(mockRunAnalyze).toHaveBeenCalledWith('song.wav', {
        scenes: [],
        dir: undefined,
        json: undefined,
      })
    })

    it('forwards --dir', async () => {
      await runCli(['analyze', '--dir', './stems'])

      expect(mockRunAnalyze).toHaveBeenCalledWith(undefined, {
        scenes: [],
        dir: './stems',
        json: undefined,
      })
    })

    it('forwards a single --scene', async () => {
      await runCli(['analyze', 'song.wav', '--scene', 'a.scn'])

      expect(mockRunAnalyze).toHaveBeenCalledWith('song.wav', {
        scenes: ['a.scn'],
        dir: undefined,
        json: undefined,
      })
    })

    it('accumulates multiple --scene flags in order', async () => {
      await runCli(['analyze', 'song.wav', '--scene', 'a.scn', '--scene', 'b.scn'])

      expect(mockRunAnalyze).toHaveBeenCalledWith('song.wav', {
        scenes: ['a.scn', 'b.scn'],
        dir: undefined,
        json: undefined,
      })
    })

    it('forwards --json', async () => {
      await runCli(['analyze', 'song.wav', '--json'])

      expect(mockRunAnalyze).toHaveBeenCalledWith('song.wav', {
        scenes: [],
        dir: undefined,
        json: true,
      })
    })

    it('delegates the no-file default to runAnalyze', async () => {
      await runCli(['analyze'])

      expect(mockRunAnalyze).toHaveBeenCalledWith(undefined, {
        scenes: [],
        dir: undefined,
        json: undefined,
      })
    })

    it('logs the message and exits 1 on Error rejection', async () => {
      mockRunAnalyze.mockRejectedValue(new Error('analysis failed'))

      await runCli(['analyze', 'song.wav'], { throwOnExit: false })
      await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('analysis failed'))

      expect(exitCalls).toContain(1)
    })

    it('logs the stringified value and exits 1 on non-Error rejection', async () => {
      mockRunAnalyze.mockRejectedValue('boom')

      await runCli(['analyze', 'song.wav'], { throwOnExit: false })
      await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('boom'))

      expect(exitCalls).toContain(1)
    })
  })

  describe('record stub', () => {
    it('prints not-yet-implemented and exits 1', async () => {
      await runCli(['record'])

      expect(console.error).toHaveBeenCalledWith('buddy record: not yet implemented')
      expect(exitCalls[0]).toBe(1)
    })
  })

  describe('error handling', () => {
    it('unknown command exits 1', async () => {
      await runCli(['frobnicate'])

      expect(stderr).toContain('unknown command')
      expect(exitCalls[0]).toBe(1)
    })

    it('unknown option exits 1', async () => {
      await runCli(['--bogus'])

      expect(stderr).toContain('unknown option')
      expect(exitCalls[0]).toBe(1)
    })
  })
})
