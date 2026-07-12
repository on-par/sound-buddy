import { describe, it, expect } from "vitest";
import { execFileWithTimeout, SubprocessTimeoutError, isAbortError } from "./timeout.js";

describe("execFileWithTimeout", () => {
  it("kills the child and rejects with SubprocessTimeoutError when it never returns", async () => {
    await expect(
      execFileWithTimeout("sleep", ["5"], { encoding: "utf8" }, "sleep test", 100),
    ).rejects.toBeInstanceOf(SubprocessTimeoutError);
  });

  it("resolves normally for a fast process", async () => {
    const { stdout } = await execFileWithTimeout("echo", ["ok"], { encoding: "utf8" }, "echo test", 5_000);
    expect(stdout.trim()).toBe("ok");
  });

  it("rejects with an abort error, not SubprocessTimeoutError, for a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = execFileWithTimeout(
      "sleep",
      ["5"],
      { encoding: "utf8", signal: controller.signal },
      "sleep test",
      60_000,
    );
    await expect(run).rejects.not.toBeInstanceOf(SubprocessTimeoutError);
    await expect(run).rejects.toSatisfy((err: unknown) => isAbortError(err));
  });

  it("rejects with an abort error, not SubprocessTimeoutError, when aborted mid-run", async () => {
    const controller = new AbortController();
    const run = execFileWithTimeout(
      "sleep",
      ["5"],
      { encoding: "utf8", signal: controller.signal },
      "sleep test",
      60_000,
    );
    setTimeout(() => controller.abort(), 50);

    await expect(run).rejects.not.toBeInstanceOf(SubprocessTimeoutError);
    await expect(run).rejects.toSatisfy((err: unknown) => isAbortError(err));
  });
});
