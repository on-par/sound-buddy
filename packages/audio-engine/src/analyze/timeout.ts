import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const SOX_TIMEOUT_MS = 60_000;
export const FFPROBE_TIMEOUT_MS = 30_000;
export const SPECTRUM_TIMEOUT_MS = 300_000;
// ebur128 decodes the whole file with 4x true-peak oversampling; long service
// recordings need the same headroom as the spectrum analysis.
export const EBUR128_TIMEOUT_MS = 300_000;
// Pre-extraction decodes a full video container to WAV; same scale as SPECTRUM/EBUR128.
export const EXTRACT_TIMEOUT_MS = 300_000;

const execFileAsync = promisify(execFile);

export class SubprocessTimeoutError extends Error {
  constructor(public readonly stage: string, public readonly timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs} ms`);
    this.name = "SubprocessTimeoutError";
  }
}

// Shared abort-detection predicate — the single source of truth for "was this
// rejection caused by an AbortSignal", reused by every caller that needs to
// tell a user cancellation apart from a genuine failure.
export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null | undefined;
  return e?.name === "AbortError" || e?.code === "ABORT_ERR";
}

export async function execFileWithTimeout(
  bin: string,
  args: string[],
  options: { encoding: "utf8"; maxBuffer?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
  stage: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(bin, args, {
      ...options,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (err) {
    const e = err as { killed?: boolean };
    // An abort (user cancellation) surfaces as `killed: true` too — check it
    // first so a cancellation isn't mislabeled a SubprocessTimeoutError.
    if (isAbortError(err) || options.signal?.aborted) throw err;
    if (e.killed) throw new SubprocessTimeoutError(stage, timeoutMs);
    throw err;
  }
}
