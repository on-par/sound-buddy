"""Tests for validate_contracts.py — run: python apps/ios/scripts/test_validate_contracts.py

Each case builds a throwaway Contracts/ tree (schemas/ + examples/) so the
validator is exercised against real files, not mocks.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import validate_contracts as vc

REAL_CONTRACTS = Path(__file__).resolve().parent.parent / "Contracts"

MINI_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["name"],
    "properties": {"name": {"type": "string"}},
}

CURVE = {
    "schemaVersion": 1,
    "id": "flat",
    "label": "Flat",
    "description": "",
    "freqs": [20, 1000, 20000],
    "dbOffsets": [0, 0, 0],
}


class ContractsTree:
    """A temp Contracts dir; write files, then run the validator over it."""

    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        (self.root / "schemas").mkdir()
        (self.root / "examples").mkdir()

    def schema(self, stem: str, body: object) -> None:
        self._write(self.root / "schemas" / f"{stem}.schema.json", body)

    def example(self, name: str, body: object) -> None:
        self._write(self.root / "examples" / name, body)

    def errors(self) -> list[str]:
        return vc.validate_contracts(self.root)

    def cleanup(self) -> None:
        shutil.rmtree(self.root)

    @staticmethod
    def _write(path: Path, body: object) -> None:
        path.write_text(json.dumps(body) if not isinstance(body, str) else body)


class ValidateContractsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = ContractsTree()

    def tearDown(self) -> None:
        self.tree.cleanup()

    def test_checked_in_contracts_are_valid(self) -> None:
        self.assertEqual(vc.validate_contracts(REAL_CONTRACTS), [])

    def test_checked_in_contracts_cover_ideal_curve_and_coaching_event(self) -> None:
        stems = sorted(p.name for p in (REAL_CONTRACTS / "schemas").glob("*.schema.json"))
        self.assertEqual(stems, ["coaching-event.v1.schema.json", "ideal-curve.v1.schema.json"])

    def test_valid_schema_with_matching_example_passes(self) -> None:
        self.tree.schema("thing.v1", MINI_SCHEMA)
        self.tree.example("thing.v1.basic.json", {"name": "x"})
        self.assertEqual(self.tree.errors(), [])

    def test_invalid_schema_is_reported(self) -> None:
        self.tree.schema("thing.v1", {"type": "not-a-json-type"})
        self.tree.example("thing.v1.basic.json", {"name": "x"})
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("thing.v1.schema.json", errors[0])
        self.assertIn("not a valid JSON Schema", errors[0])

    def test_unparseable_json_is_reported(self) -> None:
        self.tree.schema("thing.v1", MINI_SCHEMA)
        self.tree.example("thing.v1.basic.json", "{ not json")
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("thing.v1.basic.json", errors[0])
        self.assertIn("not valid JSON", errors[0])

    def test_schema_without_example_is_reported(self) -> None:
        self.tree.schema("thing.v1", MINI_SCHEMA)
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("thing.v1.schema.json has no example", errors[0])
        self.assertIn("examples/thing.v1.<variant>.json", errors[0])

    def test_example_violating_schema_is_reported_with_its_path(self) -> None:
        self.tree.schema("thing.v1", MINI_SCHEMA)
        self.tree.example("thing.v1.bad.json", {"name": 42})
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("thing.v1.bad.json", errors[0])
        self.assertIn("$.name", errors[0])

    def test_orphan_example_is_reported(self) -> None:
        self.tree.schema("thing.v1", MINI_SCHEMA)
        self.tree.example("thing.v1.basic.json", {"name": "x"})
        self.tree.example("other.v1.basic.json", {"name": "x"})
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("other.v1.basic.json matches no schema", errors[0])

    def test_ideal_curve_length_mismatch_is_reported(self) -> None:
        self.tree.schema("ideal-curve.v1", {"type": "object"})
        self.tree.example("ideal-curve.v1.bad.json", {**CURVE, "dbOffsets": [0, 0]})
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("freqs has 3 points but dbOffsets has 2", errors[0])

    def test_ideal_curve_freqs_must_ascend(self) -> None:
        self.tree.schema("ideal-curve.v1", {"type": "object"})
        self.tree.example("ideal-curve.v1.bad.json", {**CURVE, "freqs": [20, 20, 1000]})
        errors = self.tree.errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("freqs must be strictly ascending", errors[0])

    def test_main_exit_codes(self) -> None:
        self.assertEqual(vc.main([str(REAL_CONTRACTS)]), 0)
        self.tree.schema("thing.v1", MINI_SCHEMA)
        self.assertEqual(vc.main([str(self.tree.root)]), 1)


if __name__ == "__main__":
    unittest.main()
