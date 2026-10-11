"""Generate the shared RTA display fixture (epic #1705, issue #1707).

docs/rta-display-spec/fixtures/rta-display-v1.json is the canonical parity
file for the RTA display spec (docs/rta-display-spec.md): input band frames,
their real dt and a target, with the expected smoothed levels, absolute
fractions, relative deviations, clamps, tones and peak-hold values. Every
platform's RTA display tests (iOS now, Mac #1709 and web #1710 later) run
the same file to +/-0.01 dB.

This script is an independent, stdlib-only reference implementation of the
spec math, so the Swift port is checked against something it did not
produce. It also writes a byte-identical copy into the SoundBuddyKit test
fixtures (Swift tests read that copy and assert it matches the canonical
file).

Usage: python3 apps/ios/scripts/make_rta_display_fixture.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_PATH = REPO_ROOT / "docs" / "rta-display-spec" / "fixtures" / "rta-display-v1.json"
SWIFT_COPY_PATH = (
    REPO_ROOT / "apps" / "ios" / "SoundBuddyKit" / "Tests" / "SoundBuddyKitTests"
    / "Fixtures" / "rta-display-v1.json"
)
DB_DECIMALS = 6

# Spec constants (docs/rta-display-spec.md). Mirrored by RTABallistics,
# RTAPeakHold, RTAScale.relative/.absolute and RTADeviationTone in Swift.
BALLISTICS = {
    "medium": {"attackTauS": 0.05, "releaseTauS": 0.4},
    "slow": {"attackTauS": 0.25, "releaseTauS": 1.5},
}
PEAK_HOLD_S = 1.5
PEAK_RELEASE_DB_PER_S = 20.0
RELATIVE_RANGE_DB = 15.0
RELATIVE_TICK_DB = 5.0
ABSOLUTE_FLOOR_DB = -96.0
ABSOLUTE_CEILING_DB = 0.0
ABSOLUTE_TICK_DB = 12.0
NEUTRAL_DEVIATION_DB = 3.0
SILENCE_FLOOR_DB = -120.0
TOLERANCE_DB = 0.01


def db_to_power(db: float) -> float:
    return 10.0 ** (db / 10.0)


def power_to_db(power: float) -> float:
    if power <= 0.0:
        return SILENCE_FLOOR_DB
    return max(SILENCE_FLOOR_DB, 10.0 * math.log10(power))


def finite_mean(xs: list[float]) -> float | None:
    vals = [x for x in xs if math.isfinite(x)]
    return sum(vals) / len(vals) if vals else None


def tone(deviation: float) -> str:
    if deviation > NEUTRAL_DEVIATION_DB:
        return "over"
    if deviation < -NEUTRAL_DEVIATION_DB:
        return "under"
    return "neutral"


def clamp_relative(deviation: float) -> tuple[float, str | None]:
    if deviation > RELATIVE_RANGE_DB:
        return RELATIVE_RANGE_DB, "above"
    if deviation < -RELATIVE_RANGE_DB:
        return -RELATIVE_RANGE_DB, "below"
    return deviation, None


def absolute_fraction(level: float) -> float:
    span = ABSOLUTE_CEILING_DB - ABSOLUTE_FLOOR_DB
    return min(1.0, max(0.0, (level - ABSOLUTE_FLOOR_DB) / span))


class PeakTracker:
    """Hold for PEAK_HOLD_S, then fall at PEAK_RELEASE_DB_PER_S, never below the value."""

    def __init__(self) -> None:
        self.peaks: list[float] = []
        self.ages: list[float] = []

    def update(self, values: list[float], dt: float) -> None:
        if len(values) != len(self.peaks):
            self.peaks = list(values)
            self.ages = [0.0] * len(values)
            return
        for i, value in enumerate(values):
            self.ages[i] += dt
            if value >= self.peaks[i]:
                self.peaks[i] = value
                self.ages[i] = 0.0
            else:
                falling = max(0.0, min(dt, self.ages[i] - PEAK_HOLD_S))
                self.peaks[i] = max(value, self.peaks[i] - PEAK_RELEASE_DB_PER_S * falling)


class DisplayModel:
    """Exponential power-domain ballistics with real dt, then level-matched deviations."""

    def __init__(self, ballistics: str) -> None:
        self.attack = BALLISTICS[ballistics]["attackTauS"]
        self.release = BALLISTICS[ballistics]["releaseTauS"]
        self.power: list[float] = []
        self.levels: list[float] = []
        self.deviations: list[float] = []
        self.peaks = PeakTracker()
        self.deviation_peaks = PeakTracker()

    def step(self, levels_db: list[float], target: list[float] | None, dt: float) -> None:
        dt = max(0.0, dt)
        inputs = [db_to_power(x) for x in levels_db]
        if len(inputs) != len(self.power):
            self.power = inputs
            self.levels = list(levels_db)
        else:
            for i, p in enumerate(inputs):
                if p == self.power[i]:
                    continue
                tau = self.attack if p > self.power[i] else self.release
                self.power[i] += (1.0 - math.exp(-dt / tau)) * (p - self.power[i])
                self.levels[i] = power_to_db(self.power[i])
        offsets = target if target is not None and len(target) == len(self.levels) else [0.0] * len(self.levels)
        level_mean = finite_mean(self.levels)
        offset_mean = finite_mean(offsets)
        if level_mean is None or offset_mean is None:
            self.deviations = [0.0] * len(self.levels)
        else:
            shift = level_mean - offset_mean
            self.deviations = [lv - (o + shift) for lv, o in zip(self.levels, offsets)]
        self.peaks.update(self.levels, dt)
        self.deviation_peaks.update(self.deviations, dt)


def r(x: float) -> float:
    return round(x, DB_DECIMALS)


def frames(count: int, dt: float, levels: list[float]) -> list[dict]:
    return [{"dt": dt, "levelsDb": list(levels)} for _ in range(count)]


def cases() -> list[dict]:
    flat4 = [0.0, 0.0, 0.0, 0.0]
    return [
        {
            # AC2: band 0 rises 8 dB over three steady bands, which puts it
            # +6 dB over the level-matched flat target (dev = 8 * 3/4), held
            # 1 s; then it drops 20 dB and releases with tau 0.4 s.
            "name": "medium-rise-to-plus-six-then-drop-twenty",
            "ballistics": "medium",
            "bandsHz": [250.0, 500.0, 1000.0, 2000.0],
            "targetOffsetsDb": flat4,
            "frames": frames(1, 0.0, [-40.0] * 4)
            + frames(20, 0.05, [-32.0, -40.0, -40.0, -40.0])
            + frames(16, 0.05, [-52.0, -40.0, -40.0, -40.0]),
        },
        {
            # AC3: a one-frame spike; the peak holds 1.5 s then falls 20 dB/s.
            # Render-rate frames (1/60 s) with one dropped frame (1/30 s).
            "name": "peak-hold-after-one-frame-spike",
            "ballistics": "medium",
            "bandsHz": [500.0, 1000.0, 2000.0, 4000.0],
            "targetOffsetsDb": flat4,
            "frames": frames(1, 0.0, [-40.0] * 4)
            + frames(1, 0.05, [-10.0, -40.0, -40.0, -40.0])
            + frames(60, 1.0 / 60.0, [-40.0] * 4)
            + frames(1, 1.0 / 30.0, [-40.0] * 4)
            + frames(90, 1.0 / 60.0, [-40.0] * 4),
        },
        {
            "name": "slow-ballistics-rise-and-fall",
            "ballistics": "slow",
            "bandsHz": [100.0, 1000.0, 10000.0],
            "targetOffsetsDb": [0.0, 0.0, 0.0],
            "frames": frames(1, 0.0, [-60.0, -60.0, -60.0])
            + frames(20, 0.05, [-30.0, -60.0, -60.0])
            + frames(30, 0.05, [-70.0, -60.0, -60.0]),
        },
        {
            # No target: deviations are relative to the measured mean.
            "name": "no-target-relative-to-measured-mean",
            "ballistics": "medium",
            "bandsHz": [125.0, 250.0, 500.0, 1000.0, 2000.0],
            "targetOffsetsDb": None,
            "frames": frames(1, 0.0, [-30.0, -35.0, -40.0, -45.0, -50.0])
            + frames(10, 0.05, [-50.0, -45.0, -40.0, -35.0, -30.0]),
        },
        {
            # A shaped (already bandwidth-corrected) target, and deviations
            # beyond +/-15 dB that clamp with an overflow flag, plus a band
            # under the -96 dBFS absolute floor.
            "name": "shaped-target-clamp-and-overflow",
            "ballistics": "medium",
            "bandsHz": [63.0, 250.0, 1000.0, 4000.0, 16000.0],
            "targetOffsetsDb": [6.0, 3.0, 0.0, -3.0, -6.0],
            "frames": frames(1, 0.0, [-20.0, -40.0, -50.0, -70.0, -110.0])
            + frames(12, 0.05, [-15.0, -40.0, -50.0, -75.0, -105.0]),
        },
    ]


def run_case(case: dict) -> dict:
    model = DisplayModel(case["ballistics"])
    expected = []
    for frame in case["frames"]:
        model.step(frame["levelsDb"], case["targetOffsetsDb"], frame["dt"])
        clamped = [clamp_relative(d) for d in model.deviations]
        expected.append(
            {
                "levelsDb": [r(x) for x in model.levels],
                "absoluteFractions": [r(absolute_fraction(x)) for x in model.levels],
                "peaksDb": [r(x) for x in model.peaks.peaks],
                "relativeDb": [r(x) for x in model.deviations],
                "relativeClampedDb": [r(c[0]) for c in clamped],
                "overflow": [c[1] for c in clamped],
                "tone": [tone(x) for x in model.deviations],
                "relativePeaksDb": [r(x) for x in model.deviation_peaks.peaks],
            }
        )
    return {
        "name": case["name"],
        "ballistics": case["ballistics"],
        "bandsHz": case["bandsHz"],
        "targetOffsetsDb": case["targetOffsetsDb"],
        "frames": [{"dt": r(f["dt"]), "levelsDb": f["levelsDb"]} for f in case["frames"]],
        "expected": expected,
    }


def build_fixture() -> dict:
    return {
        "version": 1,
        "spec": "docs/rta-display-spec.md",
        "description": (
            "Shared RTA display parity vectors (epic #1705). Feed each case's frames, in order, "
            "into the display model with the case's ballistics and target; after each frame the "
            "model must match that frame's expected entry to toleranceDb. The first frame of a "
            "case is adopted as-is. targetOffsetsDb are display offsets on the case's band grid "
            "(already bandwidth-corrected, see docs/rta-target-convention.md); null means no "
            "target (relative to the measured mean)."
        ),
        "toleranceDb": TOLERANCE_DB,
        "constants": {
            "ballistics": BALLISTICS,
            "peakHoldS": PEAK_HOLD_S,
            "peakReleaseDbPerS": PEAK_RELEASE_DB_PER_S,
            "relativeRangeDb": RELATIVE_RANGE_DB,
            "relativeTickDb": RELATIVE_TICK_DB,
            "absoluteFloorDb": ABSOLUTE_FLOOR_DB,
            "absoluteCeilingDb": ABSOLUTE_CEILING_DB,
            "absoluteTickDb": ABSOLUTE_TICK_DB,
            "neutralDeviationDb": NEUTRAL_DEVIATION_DB,
            "silenceFloorDb": SILENCE_FLOOR_DB,
        },
        "cases": [run_case(c) for c in cases()],
    }


def _line(value: object) -> str:
    return json.dumps(value, separators=(", ", ": "))


def render() -> str:
    """Pretty JSON with one frame or expected entry per line, so diffs stay readable."""
    fixture = build_fixture()
    head = {k: v for k, v in fixture.items() if k != "cases"}
    lines = ["{"]
    for key, value in head.items():
        lines.append(f"  {json.dumps(key)}: {_line(value)},")
    lines.append('  "cases": [')
    for ci, case in enumerate(fixture["cases"]):
        lines.append("    {")
        for key in ("name", "ballistics", "bandsHz", "targetOffsetsDb"):
            lines.append(f"      {json.dumps(key)}: {_line(case[key])},")
        for key in ("frames", "expected"):
            lines.append(f"      {json.dumps(key)}: [")
            entries = case[key]
            for ei, entry in enumerate(entries):
                lines.append(f"        {_line(entry)}{',' if ei < len(entries) - 1 else ''}")
            lines.append("      ]" + ("," if key == "frames" else ""))
        lines.append("    }" + ("," if ci < len(fixture["cases"]) - 1 else ""))
    lines.append("  ]")
    lines.append("}")
    text = "\n".join(lines) + "\n"
    assert json.loads(text) == fixture
    return text


def main() -> None:
    text = render()
    for path in (CANONICAL_PATH, SWIFT_COPY_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"wrote {path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
