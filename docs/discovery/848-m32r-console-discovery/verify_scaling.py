#!/usr/bin/env python3
"""Verify float<->engineering-unit conversions against the console. READ-ONLY.

Each OSC float parameter is a 0.0-1.0 normalised position. The console also
reports the same parameter in engineering units through /node text. This script
queries both and checks a candidate formula against the console's own numbers,
so the conversion table in the findings doc is measured, not assumed.

Usage: python3 verify_scaling.py 10.1.2.247
"""

import math
import sys

import m32r_osc

# (label, osc float path, /node path, field index in the node line, formula, unit)
CHECKS = [
    ("headamp gain",  "/headamp/000/gain",   "/headamp/000",     1, lambda f: -12 + f * 72,        "dB"),
    ("preamp trim",   "/ch/01/preamp/trim",  "/ch/01/preamp",    1, lambda f: (f - 0.5) * 36,      "dB"),
    ("preamp HPF",    "/ch/01/preamp/hpf",   "/ch/01/preamp",    5, lambda f: 20 * 20 ** f,        "Hz"),
    ("EQ1 freq",      "/ch/01/eq/1/f",       "/ch/01/eq/1",      2, lambda f: 20 * 1000 ** f,      "Hz"),
    ("EQ1 gain",      "/ch/01/eq/1/g",       "/ch/01/eq/1",      3, lambda f: (f - 0.5) * 30,      "dB"),
    ("EQ1 Q",         "/ch/01/eq/1/q",       "/ch/01/eq/1",      4, lambda f: 10 * 0.03 ** f,      ""),
    ("gate thr",      "/ch/01/gate/thr",     "/ch/01/gate",      3, lambda f: -80 + f * 80,        "dB"),
    ("gate range",    "/ch/01/gate/range",   "/ch/01/gate",      4, lambda f: 3 + f * 57,          "dB"),
    ("dyn thr",       "/ch/01/dyn/thr",      "/ch/01/dyn",       5, lambda f: -60 + f * 60,        "dB"),
    ("bus send lvl",  "/ch/01/mix/01/level", "/ch/01/mix/01",    2, None,                          "dB"),
    ("ch pan",        "/ch/01/mix/pan",      "/ch/01/mix",       4, lambda f: (f - 0.5) * 200,     ""),
]


def fader_db(value):
    """Documented X32/M32 fader position -> dB (shared by faders and sends)."""
    if value <= 0.0:
        return float("-inf")
    if value >= 0.5:
        return value * 40.0 - 30.0
    if value >= 0.25:
        return value * 80.0 - 50.0
    if value >= 0.0625:
        return value * 160.0 - 70.0
    return value * 480.0 - 90.0


def node_fields(console, path):
    console.send("/node", path.lstrip("/"))
    while True:
        message = console.recv()
        if message is None:
            return None
        if message[0] == "node" and message[2]:
            line = message[2][0].rstrip("\n")
            if line.startswith(path + " "):
                return line.split()


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "10.1.2.247"
    console = m32r_osc.Console(host, timeout=0.6)

    print("%-15s %-10s %-12s %-12s %s"
          % ("parameter", "osc float", "computed", "console", "match"))
    passed = failed = 0

    for label, osc_path, node_path, field, formula, unit in CHECKS:
        reply = console.query(osc_path)
        fields = node_fields(console, node_path)
        if reply is None or not reply[2] or fields is None or field >= len(fields):
            print("%-15s (could not read)" % label)
            continue

        raw = reply[2][0]
        computed = fader_db(raw) if formula is None else formula(raw)
        reported = fields[field]

        try:
            actual = float(reported.replace("k", "e3") if reported.count("k") else reported)
        except ValueError:
            actual = None if reported != "-oo" else float("-inf")

        if actual is None:
            verdict = "?"
        elif computed == actual == float("-inf"):
            verdict = "OK"
        elif math.isinf(computed) or math.isinf(actual):
            verdict = "MISMATCH"
        else:
            tolerance = max(abs(actual) * 0.01, 0.06)
            verdict = "OK" if abs(computed - actual) <= tolerance else "MISMATCH"

        passed += verdict == "OK"
        failed += verdict == "MISMATCH"
        shown = "-oo" if math.isinf(computed) else "%.2f" % computed
        print("%-15s %-10.6f %-12s %-12s %s"
              % (label, raw, shown + unit, reported + unit, verdict))

    console.close()
    print()
    print("%d formulas verified, %d mismatched." % (passed, failed))


if __name__ == "__main__":
    main()
