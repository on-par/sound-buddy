#!/usr/bin/env python3
"""Derive the iOS app icon and header brand mark from the Mac icon.

Source of truth: app/build/icon.png (1024, made by app/build/make_icon.py) —
a dark squircle with the warm waveform bars. Writes into
apps/ios/SoundBuddy/Assets.xcassets:

- AppIcon.appiconset/AppIcon.png — 1024x1024, opaque RGB. iOS applies its own
  corner mask and App Store Connect rejects icons with an alpha channel, so the
  Mac squircle's transparent corners are filled with the tile's own gradient.
- BrandMark.imageset/BrandMark{,@2x,@3x}.png — the Mac squircle as-is (alpha
  kept) at the header mark size, for Image("BrandMark").

Regenerate after the Mac icon changes:

    python apps/ios/scripts/make_ios_icons.py

Needs Pillow.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
MAC_ICON_PATH = REPO_ROOT / "app" / "build" / "icon.png"
ASSETS_DIR = REPO_ROOT / "apps" / "ios" / "SoundBuddy" / "Assets.xcassets"
APP_ICON_PATH = ASSETS_DIR / "AppIcon.appiconset" / "AppIcon.png"
BRAND_MARK_DIR = ASSETS_DIR / "BrandMark.imageset"

APP_ICON_SIZE = 1024
# Point size of the header mark (AnalyzeView Layout.brandMarkSize).
BRAND_MARK_POINTS = 36
BRAND_MARK_SCALES = (1, 2, 3)

# The Mac tile's vertical gradient (app/build/make_icon.py `top` / `bottom`).
GRADIENT_TOP = (24, 26, 32)
GRADIENT_BOTTOM = (8, 9, 11)


def gradient_tile(size: int) -> Image.Image:
    """A full-bleed square of the Mac tile's top-to-bottom gradient."""
    tile = Image.new("RGBA", (size, size))
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(GRADIENT_TOP, GRADIENT_BOTTOM))
        tile.paste(color + (255,), (0, y, size, y + 1))
    return tile


def build_app_icon(mac_icon: Image.Image) -> Image.Image:
    """The Mac artwork flattened onto its gradient: opaque, full-bleed RGB."""
    art = mac_icon.convert("RGBA").resize((APP_ICON_SIZE, APP_ICON_SIZE), Image.Resampling.LANCZOS)
    return Image.alpha_composite(gradient_tile(APP_ICON_SIZE), art).convert("RGB")


def brand_mark_filename(scale: int) -> str:
    return "BrandMark.png" if scale == 1 else f"BrandMark@{scale}x.png"


def build_brand_marks(mac_icon: Image.Image) -> dict[str, Image.Image]:
    """The Mac squircle (alpha kept) at each header scale, keyed by filename."""
    art = mac_icon.convert("RGBA")
    return {
        brand_mark_filename(scale): art.resize(
            (BRAND_MARK_POINTS * scale, BRAND_MARK_POINTS * scale), Image.Resampling.LANCZOS
        )
        for scale in BRAND_MARK_SCALES
    }


def main() -> None:
    mac_icon = Image.open(MAC_ICON_PATH)
    build_app_icon(mac_icon).save(APP_ICON_PATH)
    print("wrote", APP_ICON_PATH.relative_to(REPO_ROOT))
    BRAND_MARK_DIR.mkdir(exist_ok=True)
    for name, image in build_brand_marks(mac_icon).items():
        path = BRAND_MARK_DIR / name
        image.save(path)
        print("wrote", path.relative_to(REPO_ROOT))


if __name__ == "__main__":
    main()
