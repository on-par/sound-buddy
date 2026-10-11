"""Tests for the SoundBuddy export-compliance declaration — run:
python apps/ios/scripts/test_export_compliance.py

Pins project.yml, the generated project.pbxproj (Debug and Release), and
SoundBuddy/Info.plist to ITSAppUsesNonExemptEncryption = NO, so every
TestFlight upload answers "no non-exempt encryption" without a human clicking
through the Missing Export Compliance prompt in App Store Connect. Stdlib
only.
"""

from __future__ import annotations

import plistlib
import re
import unittest
from pathlib import Path

IOS_ROOT = Path(__file__).resolve().parent.parent
PROJECT_YML = IOS_ROOT / "project.yml"
PBXPROJ = IOS_ROOT / "SoundBuddy.xcodeproj" / "project.pbxproj"
INFO_PLIST = IOS_ROOT / "SoundBuddy" / "Info.plist"

# Matches `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO` in project.yml.
PROJECT_YML_PATTERN = re.compile(r"INFOPLIST_KEY_ITSAppUsesNonExemptEncryption:\s*(\S+)")

# Matches `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;` in the pbxproj.
PBXPROJ_PATTERN = re.compile(r"INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = (\w+);")

NO_VALUES = {"no", "false"}
YES_VALUES = {"yes", "true"}


def _read(path: Path) -> str:
    return path.read_text()


def compliance_values(text: str, pattern: re.Pattern[str]) -> list[str]:
    """Return every matched value for an ITSAppUsesNonExemptEncryption pattern."""
    return pattern.findall(text)


class ComplianceValuesHelperTest(unittest.TestCase):
    def test_detects_yes_and_absence(self) -> None:
        self.assertEqual(
            compliance_values("INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: YES", PROJECT_YML_PATTERN),
            ["YES"],
        )
        self.assertEqual(compliance_values("no key here at all", PROJECT_YML_PATTERN), [])


class ExportComplianceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.project_yml = _read(PROJECT_YML)
        cls.pbxproj = _read(PBXPROJ)

    def test_project_yml_declares_no_non_exempt_encryption(self) -> None:
        matches = compliance_values(self.project_yml, PROJECT_YML_PATTERN)
        self.assertEqual(
            len(matches),
            1,
            "expected exactly one INFOPLIST_KEY_ITSAppUsesNonExemptEncryption line in "
            "project.yml; add it under targets.SoundBuddy.settings.base and rerun "
            "`cd apps/ios && xcodegen generate`.",
        )
        self.assertIn(
            matches[0].lower(),
            NO_VALUES,
            f"INFOPLIST_KEY_ITSAppUsesNonExemptEncryption must be NO in project.yml, got "
            f"{matches[0]!r}; set it to NO and rerun `cd apps/ios && xcodegen generate`.",
        )

    def test_pbxproj_declares_no_in_debug_and_release(self) -> None:
        matches = compliance_values(self.pbxproj, PBXPROJ_PATTERN)
        self.assertGreaterEqual(
            len(matches),
            2,
            "expected INFOPLIST_KEY_ITSAppUsesNonExemptEncryption in both the Debug and "
            "Release build settings of project.pbxproj; regenerate with "
            "`cd apps/ios && xcodegen generate`.",
        )
        for value in matches:
            self.assertEqual(
                value.lower(),
                "no",
                f"every INFOPLIST_KEY_ITSAppUsesNonExemptEncryption in project.pbxproj must "
                f"be NO, got {value!r}; fix project.yml and rerun "
                "`cd apps/ios && xcodegen generate`.",
            )

    def test_info_plist_does_not_override_to_yes(self) -> None:
        with INFO_PLIST.open("rb") as f:
            plist = plistlib.load(f)
        if "ITSAppUsesNonExemptEncryption" in plist:
            self.assertFalse(
                plist["ITSAppUsesNonExemptEncryption"],
                "SoundBuddy/Info.plist must not override ITSAppUsesNonExemptEncryption to "
                "YES; remove the key or set it to NO so the generated build setting wins.",
            )


if __name__ == "__main__":
    unittest.main()
