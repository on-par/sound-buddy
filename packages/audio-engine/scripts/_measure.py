#!/usr/bin/env python3
"""
_measure.py — run a command as a child and report its wall-clock time and peak
resident set size. Used by benchmark.mjs to measure per-stage cost of the
analysis pipeline (sox / ffprobe / spectrum.py) without instrumenting the
production scripts themselves.

Usage:
    python3 _measure.py <metrics_out.json> <cmd> [args...]

The child's stdout and stderr are inherited (so the caller still sees, e.g.,
spectrum.py's JSON on stdout and sox's stat table on stderr). Metrics are
written to <metrics_out.json>:

    { "wall_s", "peak_rss_bytes", "user_s", "sys_s", "exit" }

Peak RSS is read from getrusage(RUSAGE_CHILDREN).ru_maxrss for the single child
we spawn. The units of ru_maxrss differ by platform (bytes on macOS, kibibytes
on Linux); we normalise to bytes here.
"""

import sys
import json
import time
import platform
import resource
import subprocess


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: _measure.py <metrics_out.json> <cmd> [args...]", file=sys.stderr)
        return 2

    metrics_path = sys.argv[1]
    cmd = sys.argv[2:]

    t0 = time.perf_counter()
    proc = subprocess.run(cmd)  # inherit stdio
    wall = time.perf_counter() - t0

    ru = resource.getrusage(resource.RUSAGE_CHILDREN)
    maxrss = ru.ru_maxrss
    # macOS reports bytes; Linux reports kibibytes.
    peak_bytes = maxrss if platform.system() == "Darwin" else maxrss * 1024

    with open(metrics_path, "w") as fh:
        json.dump(
            {
                "wall_s": wall,
                "peak_rss_bytes": peak_bytes,
                "user_s": ru.ru_utime,
                "sys_s": ru.ru_stime,
                "exit": proc.returncode,
            },
            fh,
        )

    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
