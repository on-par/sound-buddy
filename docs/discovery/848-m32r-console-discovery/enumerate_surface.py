#!/usr/bin/env python3
"""Enumerate the readable OSC surface by category. READ-ONLY.

Every query here is a bare parameter path with no arguments, which the console
answers with the current value and nothing else. Output is a table of
address / OSC type tag / value, grouped into the categories from the work plan.

Also cross-checks the documented float->dB fader mapping against the dB text
the same console reports via /node, so the conversion is verified rather than
assumed.

Usage: python3 enumerate_surface.py 10.1.2.247 [--scn capture.scn]
"""

import argparse
import sys

import m32r_osc

CATEGORIES = [
    ("Console identity", [
        "/info", "/xinfo", "/status",
    ]),
    ("Channel strip - config", [
        "/ch/01/config/name", "/ch/01/config/icon", "/ch/01/config/color",
        "/ch/01/config/source",
    ]),
    ("Channel strip - mix", [
        "/ch/01/mix/fader", "/ch/01/mix/on", "/ch/01/mix/pan",
        "/ch/01/mix/mono", "/ch/01/mix/mlevel",
        "/ch/01/mix/01/level", "/ch/01/mix/01/on", "/ch/01/mix/01/pan",
    ]),
    ("Channel strip - preamp / headamp", [
        "/ch/01/preamp/trim", "/ch/01/preamp/invert",
        "/ch/01/preamp/hpon", "/ch/01/preamp/hpslope", "/ch/01/preamp/hpf",
        "/headamp/000/gain", "/headamp/000/phantom",
    ]),
    ("Channel strip - dynamics / gate", [
        "/ch/01/gate/on", "/ch/01/gate/mode", "/ch/01/gate/thr",
        "/ch/01/gate/range", "/ch/01/gate/attack", "/ch/01/gate/release",
        "/ch/01/dyn/on", "/ch/01/dyn/mode", "/ch/01/dyn/thr",
        "/ch/01/dyn/ratio", "/ch/01/dyn/knee", "/ch/01/dyn/mgain",
    ]),
    ("Channel strip - EQ", [
        "/ch/01/eq/on",
        "/ch/01/eq/1/type", "/ch/01/eq/1/f", "/ch/01/eq/1/g", "/ch/01/eq/1/q",
        "/ch/01/eq/4/type", "/ch/01/eq/4/f", "/ch/01/eq/4/g", "/ch/01/eq/4/q",
    ]),
    ("Channel strip - delay / insert / automix", [
        "/ch/01/delay/on", "/ch/01/delay/time",
        "/ch/01/insert/on", "/ch/01/insert/pos", "/ch/01/insert/sel",
        "/ch/01/automix/group", "/ch/01/automix/weight",
    ]),
    ("Buses", [
        "/bus/01/config/name", "/bus/01/mix/fader", "/bus/01/mix/on",
        "/bus/01/mix/pan", "/bus/01/eq/1/f", "/bus/01/dyn/on",
    ]),
    ("Matrices", [
        "/mtx/01/config/name", "/mtx/01/mix/fader", "/mtx/01/mix/on",
    ]),
    ("Mains", [
        "/main/st/config/name", "/main/st/mix/fader", "/main/st/mix/on",
        "/main/st/mix/pan", "/main/m/mix/fader", "/main/m/mix/on",
    ]),
    ("DCA", [
        "/dca/1/config/name", "/dca/1/fader", "/dca/1/on",
        "/dca/8/fader", "/dca/8/on",
    ]),
    ("Aux in / FX return", [
        "/auxin/01/config/name", "/auxin/01/mix/fader",
        "/fxrtn/01/config/name", "/fxrtn/01/mix/fader",
    ]),
    ("FX racks", [
        "/fx/1/type", "/fx/1/source/l", "/fx/1/source/r", "/fx/1/par/01",
    ]),
    ("Outputs / routing", [
        "/outputs/main/01/src", "/outputs/main/01/pos",
        "/outputs/main/01/delay/on", "/outputs/main/01/delay/time",
        "/config/routing/IN/1-8", "/config/routing/OUT/1-4",
    ]),
    ("Console state (read-only status)", [
        "/-stat/solosw/01", "/-stat/keysolo", "/-stat/selidx",
        "/-stat/chfaderbank", "/-stat/tape/state",
        "/-prefs/name", "/-prefs/ip/addr",
    ]),
]


def fader_float_to_db(value):
    """Documented X32/M32 linear fader position -> dB."""
    if value <= 0.0:
        return float("-inf")
    if value >= 0.5:
        return value * 40.0 - 30.0
    if value >= 0.25:
        return value * 80.0 - 50.0
    if value >= 0.0625:
        return value * 160.0 - 70.0
    return value * 480.0 - 90.0


def parse_scn_db(scn_path, node_path, field):
    """Pull one whitespace-separated field from a .scn node line."""
    if not scn_path:
        return None
    try:
        with open(scn_path) as handle:
            for line in handle:
                if line.startswith(node_path + " "):
                    parts = line.split()
                    return parts[field] if field < len(parts) else None
    except OSError:
        return None
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("--scn", help="captured .scn to cross-check dB values")
    args = parser.parse_args()

    console = m32r_osc.Console(args.host, timeout=0.6)
    ok = 0
    failed = []

    for title, paths in CATEGORIES:
        print()
        print("== %s ==" % title)
        print("   %-34s %-6s %s" % ("OSC address", "type", "value"))
        for path in paths:
            reply = console.query(path)
            if reply is None:
                print("   %-34s %-6s %s" % (path, "-", "NO REPLY"))
                failed.append(path)
                continue
            _, tags, values = reply
            shown = values[0] if len(values) == 1 else values
            print("   %-34s %-6s %r" % (path, tags or "-", shown))
            ok += 1

    # Verify the float -> dB conversion against the console's own dB text.
    print()
    print("== fader float -> dB conversion check ==")
    checks = [
        ("/dca/1/fader", "/dca/1", 2),
        ("/dca/2/fader", "/dca/2", 2),
        ("/dca/8/fader", "/dca/8", 2),
        ("/main/st/mix/fader", "/main/st/mix", 2),
    ]
    print("   %-24s %-10s %-10s %s" % ("address", "float", "computed", "console .scn"))
    for address, node_path, field in checks:
        reply = console.query(address)
        if reply is None or not reply[2]:
            continue
        raw = reply[2][0]
        computed = fader_float_to_db(raw)
        reported = parse_scn_db(args.scn, node_path, field)
        print("   %-24s %-10.6f %-10s %s"
              % (address, raw,
                 "-oo" if computed == float("-inf") else "%.1f" % computed,
                 reported if reported is not None else "(no .scn)"))

    console.close()
    print()
    print("%d paths answered, %d did not." % (ok, len(failed)))
    if failed:
        print("No reply:")
        for path in failed:
            print("   ", path)


if __name__ == "__main__":
    main()
