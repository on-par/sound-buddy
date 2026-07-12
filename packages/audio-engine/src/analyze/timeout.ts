import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const SOX_TIMEOUT_MS = 60_000;
export const FFPROBE_TIMEOUT_MS = 30_000;
export const SPECTRUM_TIMEOUT_MS = 300_000;
// ebur128 decodes the whole file with 4x true-peak oversampling; long service
// recordings need the same headroom as the spectrum analysis.
export const EBUR128_TIMEOUT_MS = 300_000;

const execFileAsync = promisify(execFile);

export class SubprocessTimeoutError extends Error {
  constructor(public readonly stage: string, public readonly timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs} ms`);
    this.name = "SubprocessTimeoutError";
  }
}

export async function execFileWithTimeout(
  bin: string,
  args: string[],
  options: { encoding: "utf8"; maxBuffer?: number; env?: NodeJS.ProcessEnv },
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
    if (e.killed) throw new SubprocessTimeoutError(stage, timeoutMs);
    throw err;
  }
}
