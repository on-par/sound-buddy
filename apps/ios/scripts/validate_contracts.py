"""Validate the shared JSON contracts in apps/ios/Contracts.

Runs on Linux CI (.github/workflows/ios.yml) with no Xcode: it is the only
iOS-side check that runs there. Checks:
  - every schemas/<stem>.schema.json is a valid Draft 2020-12 JSON Schema;
  - every schema has at least one examples/<stem>.<variant>.json;
  - every example belongs to exactly one schema and validates against it;
  - IdealCurve semantic rules JSON Schema cannot express (equal-length
    freqs/dbOffsets, strictly ascending freqs) — the Swift decoder enforces
    the same rules in SoundBuddyKit's IdealCurve.

Usage: python apps/ios/scripts/validate_contracts.py [CONTRACTS_DIR]
Requires: pip install jsonschema
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

DEFAULT_CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "Contracts"
SCHEMA_SUFFIX = ".schema.json"
IDEAL_CURVE_PREFIX = "ideal-curve."


def _load(path: Path, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"{path.name} is not valid JSON ({exc}). Fix the syntax and re-run.")
        return None


def _ideal_curve_errors(name: str, doc: object) -> list[str]:
    if not isinstance(doc, dict):
        return []
    freqs, offsets = doc.get("freqs"), doc.get("dbOffsets")
    if not isinstance(freqs, list) or not isinstance(offsets, list):
        return []
    errors = []
    if len(freqs) != len(offsets):
        errors.append(
            f"{name}: freqs has {len(freqs)} points but dbOffsets has {len(offsets)} "
            "— give every frequency exactly one offset."
        )
    if any(b <= a for a, b in zip(freqs, freqs[1:])):
        errors.append(f"{name}: freqs must be strictly ascending — sort them and drop duplicates.")
    return errors


def validate_contracts(contracts_dir: Path) -> list[str]:
    """Return a list of actionable error strings; empty means all contracts are valid."""
    errors: list[str] = []
    schemas: dict[str, Draft202012Validator] = {}
    broken: set[str] = set()  # stems whose schema failed to load; already reported
    for path in sorted((contracts_dir / "schemas").glob(f"*{SCHEMA_SUFFIX}")):
        stem = path.name[: -len(SCHEMA_SUFFIX)]
        schema = _load(path, errors)
        if schema is None:
            broken.add(stem)
            continue
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            errors.append(f"{path.name} is not a valid JSON Schema: {exc.message}")
            broken.add(stem)
            continue
        schemas[stem] = Draft202012Validator(schema)

    covered: set[str] = set()
    for path in sorted((contracts_dir / "examples").glob("*.json")):
        if any(path.name.startswith(f"{s}.") for s in broken):
            continue
        stem = next((s for s in schemas if path.name.startswith(f"{s}.")), None)
        if stem is None:
            errors.append(
                f"{path.name} matches no schema — name it <schema-stem>.<variant>.json "
                "after a file in schemas/."
            )
            continue
        covered.add(stem)
        doc = _load(path, errors)
        if doc is None:
            continue
        for err in sorted(schemas[stem].iter_errors(doc), key=lambda e: e.json_path):
            errors.append(f"{path.name} violates {stem}{SCHEMA_SUFFIX} at {err.json_path}: {err.message}")
        if stem.startswith(IDEAL_CURVE_PREFIX):
            errors.extend(_ideal_curve_errors(path.name, doc))

    for stem in sorted(set(schemas) - covered):
        errors.append(
            f"{stem}{SCHEMA_SUFFIX} has no example — add examples/{stem}.<variant>.json "
            "so the schema is exercised."
        )
    return errors


def main(argv: list[str]) -> int:
    contracts_dir = Path(argv[0]) if argv else DEFAULT_CONTRACTS_DIR
    errors = validate_contracts(contracts_dir)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if not errors:
        print(f"contracts OK: {contracts_dir}")
    return 1 if errors else 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    sys.exit(main(sys.argv[1:]))
