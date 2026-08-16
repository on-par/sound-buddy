#!/usr/bin/env python3
"""Read-only identity + reply-format probe for an M32R console.

Learns exactly what /info, /xinfo, /status and /node return so the rest of the
tooling can rely on the formats instead of guessing.

Usage: python3 identity.py 10.1.2.247
"""

import sys

import m32r_osc

IDENTITY_QUERIES = ["/info", "/xinfo", "/status"]

# A few representative /node queries covering different node shapes.
NODE_QUERIES = [
    "",             # root
    "-stat",
    "-prefs",
    "ch/01",
    "ch/01/config",
    "ch/01/mix",
    "ch/01/preamp",
    "main/st/mix",
    "dca/1",
]


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "10.1.2.247"
    console = m32r_osc.Console(host, timeout=0.8)

    print("=== identity ===")
    for address in IDENTITY_QUERIES:
        reply = console.query(address)
        if reply is None:
            print("%-10s no reply" % address)
            continue
        _, tags, args = reply
        print("%-10s tags=%-8r args=%r" % (address, tags, args))

    print()
    print("=== /xremote handshake ===")
    reply = console.query("/xremote")
    print("/xremote  ->", reply)

    print()
    print("=== /node replies ===")
    for path in NODE_QUERIES:
        reply = console.query("/node", path)
        if reply is None:
            print("node %-16r no reply" % path)
            continue
        _, tags, args = reply
        text = args[0] if args else ""
        preview = text if len(text) < 400 else text[:400] + " ...[truncated]"
        print("node %-16r tags=%r" % (path, tags))
        for line in preview.splitlines():
            print("      | %s" % line)

    console.close()
    print()
    print("(sent %d messages total)" % console.sent)


if __name__ == "__main__":
    main()
