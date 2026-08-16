#!/usr/bin/env python3
"""List the shows/scenes/snippets stored on the console. READ-ONLY.

Important limitation this script demonstrates: /node exposes only each stored
scene's *metadata* (name, note, flags). The parameter data of a stored scene
lives in console flash and is only reachable by recalling it, which is a write.
So a read-only capture can archive the CURRENT live state, not an arbitrary
stored scene.

Usage: python3 list_scenes.py 10.1.2.247
"""

import sys

import m32r_osc

SLOTS = 100  # X32/M32 scene slots are 000..099


def node(console, path):
    console.send("/node", path)
    lines = []
    while True:
        message = console.recv()
        if message is None:
            break
        if message[0] == "node" and message[2]:
            lines.append(message[2][0].rstrip("\n"))
    return lines


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "10.1.2.247"
    console = m32r_osc.Console(host, timeout=0.4)

    for line in node(console, "-show/showfile/show"):
        print("show    :", line)
    for line in node(console, "-show/prepos/current"):
        print("current :", line)

    print()
    print("scenes:")
    found = 0
    for index in range(SLOTS):
        path = "-show/showfile/scene/%03d" % index
        for line in node(console, path):
            if line.startswith("/-show/showfile/scene/%03d" % index):
                print("   ", line)
                found += 1
    if not found:
        print("    (none)")

    console.close()


if __name__ == "__main__":
    main()
