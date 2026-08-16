#!/usr/bin/env python3
"""Capture the console's current state to a .scn scene file. READ-ONLY.

How this works
--------------
The X32/M32 ``/node`` query is a read. The console answers on OSC address
``node`` with a single string that is *already* a scene-file line:

    /ch/01/mix OFF   -oo ON +0 OFF   -oo

A .scn file is exactly a version header followed by those lines. So a scene
save is a tree walk of ``/node`` queries plus a header — no write ever touches
the console, and nothing is stored on the board.

``/node`` has no directory listing (querying a container returns only its first
child), so we walk an explicit path list in ``scn_paths.txt``, taken from the
canonical X32-Edit .scn layout so the output ordering matches.

Usage:
    python3 dump_scene.py 10.1.2.247 --name "Sunday AM" --out sunday.scn
"""

import argparse
import os
import sys
import time

import m32r_osc

HERE = os.path.dirname(os.path.abspath(__file__))
PATH_LIST = os.path.join(HERE, "scn_paths.txt")

# Scene format version emitted by firmware 2.7-era X32/M32 consoles.
SCN_VERSION = "#2.7#"

GAP_S = 0.004      # ~250 queries/sec ceiling; console answers in ~2 ms
RETRIES = 3


def load_paths():
    with open(PATH_LIST) as handle:
        return [line.strip() for line in handle if line.strip()]


def walk(console, paths, progress=True):
    """Query every path. Returns (by_returned_path, missing, mismatched)."""
    results = {}
    missing = []
    mismatched = []

    for index, path in enumerate(paths):
        query = path.lstrip("/")
        line = None
        for _ in range(RETRIES):
            console.send("/node", query)
            deadline = time.time() + 0.35
            while time.time() < deadline:
                message = console.recv()
                if message is None:
                    break
                address, _tags, args = message
                if address == "node" and args:
                    line = args[0].rstrip("\n")
                    break
            if line is not None:
                break
        if line is None:
            missing.append(path)
        else:
            returned = line.split(None, 1)[0]
            if returned != path:
                mismatched.append((path, returned))
            results[returned] = line
        time.sleep(GAP_S)

        if progress and (index + 1) % 250 == 0:
            sys.stderr.write("  ... %d/%d paths\n" % (index + 1, len(paths)))
            sys.stderr.flush()

    return results, missing, mismatched


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("--name", default="OSC Capture",
                        help="scene name written into the header")
    parser.add_argument("--note", default="", help="scene note")
    parser.add_argument("--out", default="capture.scn")
    args = parser.parse_args()

    paths = load_paths()
    print("Walking %d node paths on %s (read-only)" % (len(paths), args.host))

    console = m32r_osc.Console(args.host, timeout=0.35)
    started = time.time()
    results, missing, mismatched = walk(console, paths)
    elapsed = time.time() - started
    console.close()

    with open(args.out, "w") as handle:
        handle.write('%s "%s" "%s" %%000000000 1\n'
                     % (SCN_VERSION, args.name, args.note))
        for path in paths:
            if path in results:
                handle.write(results[path] + "\n")

    written = sum(1 for p in paths if p in results)
    print()
    print("Wrote %s" % args.out)
    print("  lines written : %d / %d" % (written, len(paths)))
    print("  no reply      : %d" % len(missing))
    print("  path mismatch : %d" % len(mismatched))
    print("  elapsed       : %.1f s (%d queries)" % (elapsed, console.sent))

    if missing:
        print()
        print("Paths the console did not answer (first 40):")
        for path in missing[:40]:
            print("   ", path)
    if mismatched:
        print()
        print("Paths where the console answered with a different node (first 20):")
        for asked, got in mismatched[:20]:
            print("    asked %-28s got %s" % (asked, got))


if __name__ == "__main__":
    main()
