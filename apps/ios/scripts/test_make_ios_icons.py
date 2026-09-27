"""Tests for make_ios_icons.py — run: python apps/ios/scripts/test_make_ios_icons.py

Needs Pillow.
"""

from __future__ import annotations

import json
import unittest

from PIL import Image, ImageChops

import make_ios_icons as mk

# Max per-channel difference allowed between the checked-in PNGs and a fresh
# build, so a Pillow resampling tweak doesn't read as drift.
PIXEL_TOLERANCE = 2


def max_channel_diff(a: Image.Image, b: Image.Image) -> int:
    return max(high for _, high in ImageChops.difference(a, b).getextrema())


class MakeIosIconsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mac_icon = Image.open(mk.MAC_ICON_PATH)

    def test_app_icon_is_opaque_1024_rgb(self) -> None:
        icon = mk.build_app_icon(self.mac_icon)
        self.assertEqual(icon.mode, "RGB")
        self.assertEqual(icon.size, (mk.APP_ICON_SIZE, mk.APP_ICON_SIZE))

    def test_app_icon_corners_are_the_tile_gradient_not_black(self) -> None:
        # The Mac squircle's corners are transparent; flattening them to black
        # would leave dark wedges inside iOS's own corner mask.
        icon = mk.build_app_icon(self.mac_icon)
        last = mk.APP_ICON_SIZE - 1
        self.assertEqual(icon.getpixel((0, 0)), mk.GRADIENT_TOP)
        self.assertEqual(icon.getpixel((last, last)), mk.GRADIENT_BOTTOM)

    def test_app_icon_keeps_the_mac_artwork_center(self) -> None:
        icon = mk.build_app_icon(self.mac_icon)
        center = mk.APP_ICON_SIZE // 2
        self.assertEqual(icon.getpixel((center, center)), self.mac_icon.convert("RGB").getpixel((center, center)))

    def test_brand_marks_are_the_point_size_at_each_scale_with_alpha(self) -> None:
        marks = mk.build_brand_marks(self.mac_icon)
        self.assertEqual(list(marks), ["BrandMark.png", "BrandMark@2x.png", "BrandMark@3x.png"])
        for scale in mk.BRAND_MARK_SCALES:
            mark = marks[mk.brand_mark_filename(scale)]
            self.assertEqual(mark.mode, "RGBA")
            self.assertEqual(mark.size, (mk.BRAND_MARK_POINTS * scale,) * 2)
            self.assertEqual(mark.getpixel((0, 0))[3], 0, "squircle corner should stay transparent")

    def test_checked_in_app_icon_matches_a_fresh_build(self) -> None:
        # Drift guard: if the Mac icon changes, rerun make_ios_icons.py.
        checked_in = Image.open(mk.APP_ICON_PATH)
        self.assertEqual(checked_in.mode, "RGB", "App Store Connect rejects app icons with alpha")
        self.assertLessEqual(max_channel_diff(checked_in, mk.build_app_icon(self.mac_icon)), PIXEL_TOLERANCE)

    def test_checked_in_brand_marks_match_a_fresh_build(self) -> None:
        for name, fresh in mk.build_brand_marks(self.mac_icon).items():
            checked_in = Image.open(mk.BRAND_MARK_DIR / name).convert("RGBA")
            self.assertLessEqual(max_channel_diff(checked_in, fresh), PIXEL_TOLERANCE, name)

    def test_asset_catalog_json_names_every_generated_file(self) -> None:
        app_icon = json.loads((mk.APP_ICON_PATH.parent / "Contents.json").read_text())
        self.assertEqual([i.get("filename") for i in app_icon["images"]], [mk.APP_ICON_PATH.name])
        brand = json.loads((mk.BRAND_MARK_DIR / "Contents.json").read_text())
        self.assertEqual(
            {(i["filename"], i["scale"]) for i in brand["images"]},
            {(mk.brand_mark_filename(s), f"{s}x") for s in mk.BRAND_MARK_SCALES},
        )


if __name__ == "__main__":
    unittest.main()
