"""Tests for the SoundBuddy iPad device-family settings — run:
python apps/ios/scripts/test_ios_device_family.py

Pins project.yml and the generated project.pbxproj (both Debug and Release) to
a universal (iPhone + iPad) target with all four iPad orientations, the
iPhone orientation list unchanged, a device-neutral mic usage string, and no
UIRequiresFullScreen opt-out. Stdlib only.
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

UNIVERSAL_DEVICE_FAMILY = "1,2"

IPHONE_ORIENTATIONS = {
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
}

IPAD_ORIENTATIONS = IPHONE_ORIENTATIONS | {"UIInterfaceOrientationPortraitUpsideDown"}

# Matches TARGETED_DEVICE_FAMILY = 1; or TARGETED_DEVICE_FAMILY = "1,2"; in the pbxproj.
DEVICE_FAMILY_PATTERN = re.compile(r'TARGETED_DEVICE_FAMILY\s*=\s*"?([^;"]+)"?;')

# Matches the iPad orientation key, value quoted, in project.yml or the pbxproj.
IPAD_ORIENTATIONS_PATTERN = re.compile(
    r'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad\s*[:=]\s*"([^"]*)"'
)

# Matches the plain (iPhone) orientation key — must NOT also match the _iPad suffix.
IPHONE_ORIENTATIONS_PATTERN = re.compile(
    r'INFOPLIST_KEY_UISupportedInterfaceOrientations(?!_iPad)\s*[:=]\s*"([^"]*)"'
)


def _read(path: Path) -> str:
    return path.read_text()


class IosDeviceFamilyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.project_yml = _read(PROJECT_YML)
        cls.pbxproj = _read(PBXPROJ)

    def test_device_family_is_universal(self) -> None:
        self.assertIn(
            f'TARGETED_DEVICE_FAMILY: "{UNIVERSAL_DEVICE_FAMILY}"',
            self.project_yml,
            "project.yml must set TARGETED_DEVICE_FAMILY to \"1,2\" for a universal app; "
            "edit project.yml and rerun `xcodegen generate`.",
        )
        matches = DEVICE_FAMILY_PATTERN.findall(self.pbxproj)
        self.assertGreaterEqual(
            len(matches),
            2,
            "expected TARGETED_DEVICE_FAMILY in both Debug and Release build settings; "
            "regenerate SoundBuddy.xcodeproj with `cd apps/ios && xcodegen generate`.",
        )
        for value in matches:
            self.assertEqual(
                value,
                UNIVERSAL_DEVICE_FAMILY,
                "every TARGETED_DEVICE_FAMILY in project.pbxproj must be \"1,2\"; "
                "edit project.yml and rerun `xcodegen generate`.",
            )

    def test_ipad_supports_all_four_orientations(self) -> None:
        yml_match = IPAD_ORIENTATIONS_PATTERN.search(self.project_yml)
        self.assertIsNotNone(
            yml_match,
            "project.yml must set INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad "
            "with all four orientations.",
        )
        self.assertEqual(set(yml_match.group(1).split()), IPAD_ORIENTATIONS)

        pbxproj_matches = IPAD_ORIENTATIONS_PATTERN.findall(self.pbxproj)
        self.assertGreaterEqual(
            len(pbxproj_matches),
            2,
            "expected the iPad orientation key in both Debug and Release build settings; "
            "regenerate SoundBuddy.xcodeproj with `cd apps/ios && xcodegen generate`.",
        )
        for value in pbxproj_matches:
            self.assertEqual(set(value.split()), IPAD_ORIENTATIONS)

    def test_iphone_orientations_unchanged(self) -> None:
        yml_match = IPHONE_ORIENTATIONS_PATTERN.search(self.project_yml)
        self.assertIsNotNone(yml_match)
        self.assertEqual(set(yml_match.group(1).split()), IPHONE_ORIENTATIONS)

        pbxproj_matches = IPHONE_ORIENTATIONS_PATTERN.findall(self.pbxproj)
        self.assertGreaterEqual(len(pbxproj_matches), 2)
        for value in pbxproj_matches:
            self.assertEqual(set(value.split()), IPHONE_ORIENTATIONS)

        # The iPad key must exist and differ from the iPhone-only list (no upside-down).
        ipad_match = IPAD_ORIENTATIONS_PATTERN.search(self.project_yml)
        self.assertIsNotNone(
            ipad_match,
            "the iPad orientation key must be present so iPhone orientations stay distinct from it",
        )
        self.assertNotIn("UIInterfaceOrientationPortraitUpsideDown", yml_match.group(1).split())

    def test_mic_usage_string_is_device_neutral_and_on_device(self) -> None:
        with INFO_PLIST.open("rb") as f:
            plist = plistlib.load(f)
        usage = plist["NSMicrophoneUsageDescription"]
        self.assertNotIn("iPhone", usage)
        self.assertNotIn("iPad", usage)
        self.assertIn("on this device", usage)
        self.assertIn("never leaves", usage)

    def test_does_not_opt_out_of_multitasking(self) -> None:
        self.assertNotIn("UIRequiresFullScreen", self.project_yml)
        self.assertNotIn("UIRequiresFullScreen", _read(INFO_PLIST))


if __name__ == "__main__":
    unittest.main()
