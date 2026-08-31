# playback.py installs stop handlers at process start and exits via flush + os._exit

- Status: Accepted
- Date: 2026-08-31

## Context

playback.py runs a daemon thread parked in a blocking read on `sys.stdin` for its entire
life — that is the #759 NDJSON command channel that the ADR "Soundcheck route hot-swap is
an NDJSON stdin command channel" requires, and the ADR "Python child-process stream
lifecycle is owned by one deep module" has the python-stream slot spawn every child with
`stdio: ['pipe','pipe','pipe']`, so in production stdin is always a live pipe the parent
holds open. A daemon thread blocked inside a buffered reader holds that object's lock, and
CPython's interpreter finalization must acquire the same lock to close `sys.stdin`; the
result is a shutdown that hangs or aborts instead of exiting. This is invisible on CI
(stdin is not a live blocking fd there) and showed up only in the 0.9.1 RC regression run,
where `subprocess.run(..., timeout=15)` reported timeouts against a child that had
finished its work but could not finish exiting.

Separately, the SIGTERM/SIGINT handlers were registered deep inside `_run_output_stream`,
after module imports, manifest load, stem opening and the output-device query. Electron
stops playback with SIGTERM, so any stop that raced startup hit the default disposition
and killed the process with -15 — a nonzero exit the main process reads as a crash, and
the reason two live-stdin integration tests failed.

## Decision

playback.py registers its SIGTERM/SIGINT handlers as the first statement of `main()`,
through an injectable `install_stop_handlers(on_stop, register=signal.signal)`. The
startup handler exits the process immediately; once an output stream exists,
`_run_output_stream` re-points the same handlers at the graceful `stop.set()` path so a
stop still unwinds the `with sd.OutputStream(...)` block and closes the device. There is
never a window in which SIGTERM is on the default disposition.

Every exit path goes through `flush_and_exit(code, exit_fn=os._exit)`, which flushes
stdout and stderr and then terminates without running interpreter finalization. The
explicit flushes preserve the NDJSON stdout contract that `os._exit` would otherwise
discard; skipping finalization makes the exit code independent of what the stdin listener
thread happens to be doing.

This applies to playback.py only. stream.py keeps `sys.exit(0)` because its stop path must
run `finalize()` to close stem headers and write session.json; any future Python child
that grows a blocking stdin listener must adopt the flush + `os._exit` pattern rather than
re-deriving it, and must not adopt it without first proving it has no finalization work.

## Consequences

Positive: the process exit code is deterministic on every host and every stdin shape
(TTY, held-open pipe, /dev/null); a stopped soundcheck playback can no longer wedge in
interpreter shutdown and orphan the audio device; a SIGTERM during startup is a clean
stop rather than a -15 the renderer surfaces as a crash; the #759 command channel is
preserved unchanged.

Negative: `os._exit` skips `atexit` hooks, `finally` blocks and garbage collection, so any
future cleanup added to playback.py must run before `flush_and_exit`, not in a `finally`
or an exit hook — a footgun that needs the comment on `flush_and_exit` to stay accurate.
Handlers being installed twice means the startup and streaming stop paths differ, so a
change to one must be checked against the other.

## References

- [Issue #1340 — restore playback.py discrete-routing and live-stdin integration tests](https://github.com/patrob/sound-buddy/issues/1340)
- [ADR — Soundcheck route hot-swap is an NDJSON stdin command channel](docs/adr/0014-soundcheck-route-hot-swap-is-an-ndjson-stdin-command-channel-the-discrete-output-stream-opens-at-the-device-s-full-channel-count.md)
- [ADR — Python child-process stream lifecycle is owned by one deep module](docs/adr/0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
- [Issue #1340](https://github.com/on-par/sound-buddy/issues/1340)
