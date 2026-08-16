#!/usr/bin/env python3
"""Probe the multitrack-track <-> console-channel mapping. READ-ONLY.

For issues #895 (mapping spike) and #830 (console-aware channel analysis).

What determines the mapping
---------------------------
Two independent routing tables have to agree before "track N == channel N"
is true:

  /config/routing/IN    what feeds console channels, in blocks of 8
  /config/routing/CARD  what feeds the card/USB recorder, in blocks of 8

If a block on the CARD side names the same source as the matching block on the
IN side, the recorder is capturing exactly what that channel hears, and the
mapping is 1:1 for those 8 tracks. Where they differ, it is not.

Both can point at a *user patch* (UIN / UOUT), which is another level of
indirection stored in /config/userrout/. Those are resolved here too, because
"UIN9-16" alone does not tell you which physical input is involved.

Usage: python3 mapping_probe.py 10.1.2.247
"""

import sys

import m32r_osc

BLOCK_LABELS = ["1-8", "9-16", "17-24", "25-32"]


def node_line(console, path):
    """Fetch one /node line, returning its fields after the path."""
    for _ in range(3):
        console.send("/node", path.lstrip("/"))
        while True:
            message = console.recv()
            if message is None:
                break
            if message[0] == "node" and message[2]:
                line = message[2][0].rstrip("\n")
                if line.split(None, 1)[0] == path:
                    return line.split()[1:]
    return None


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "10.1.2.247"
    console = m32r_osc.Console(host, timeout=0.5)

    print("=" * 70)
    print("1. CARD TYPE")
    print("=" * 70)
    fields = node_line(console, "/-stat/xcardtype")
    print("  /-stat/xcardtype = %s" % (fields[0] if fields else "?"))

    print()
    print("=" * 70)
    print("2. ROUTING BLOCKS  (the mapping question)")
    print("=" * 70)
    routing_in = node_line(console, "/config/routing/IN") or []
    routing_card = node_line(console, "/config/routing/CARD") or []
    routing_play = node_line(console, "/config/routing/PLAY") or []

    print("  /config/routing/IN   = %s" % " ".join(routing_in))
    print("  /config/routing/CARD = %s" % " ".join(routing_card))
    print("  /config/routing/PLAY = %s" % " ".join(routing_play))
    print()
    print("  %-10s %-14s %-14s %s" % ("tracks", "channels fed by", "card fed by", "1:1?"))
    print("  " + "-" * 60)
    for index, label in enumerate(BLOCK_LABELS):
        src_in = routing_in[index] if index < len(routing_in) else "?"
        src_card = routing_card[index] if index < len(routing_card) else "?"
        same = "YES" if src_in == src_card and src_in != "?" else "NO"
        print("  %-10s %-14s %-14s %s" % (label, src_in, src_card, same))

    print()
    print("=" * 70)
    print("3. PER-CHANNEL SOURCE INDEX")
    print("=" * 70)
    print("  %-6s %-10s %-22s %s" % ("ch", "source", "name", "note"))
    print("  " + "-" * 60)
    sources = {}
    for channel in range(1, 33):
        reply = console.query("/ch/%02d/config/source" % channel)
        source = reply[2][0] if reply and reply[2] else None
        name_reply = console.query("/ch/%02d/config/name" % channel)
        name = name_reply[2][0] if name_reply and name_reply[2] else ""
        sources[channel] = source
        note = ""
        if source is not None:
            if source == 0:
                note = "OFF"
            elif source != channel:
                note = "!! source != channel number"
        print("  %-6d %-10s %-22r %s" % (channel, source, name, note))

    identity = [c for c, s in sources.items() if s == c]
    print()
    print("  channels whose source index equals their own number: %d / 32"
          % len(identity))

    print()
    print("=" * 70)
    print("4. USER PATCH TABLES  (resolve UIN / UOUT)")
    print("=" * 70)
    for kind, count in (("in", 32), ("out", 48)):
        print()
        print("  /config/userrout/%s:" % kind)
        row = []
        for slot in range(1, count + 1):
            fields = node_line(console, "/config/userrout/%s/%02d" % (kind, slot))
            value = fields[0] if fields else "-"
            row.append("%02d:%-4s" % (slot, value))
            if len(row) == 8:
                print("    " + " ".join(row))
                row = []
        if row:
            print("    " + " ".join(row))

    console.close()
    print()
    print("(sent %d messages, all read-only)" % console.sent)


if __name__ == "__main__":
    main()
