#!/usr/bin/env python3
"""Generate the Sound Buddy macOS app icon (icon.png -> icon.icns via iconutil).

Design: a dark rounded-square tile with a centered audio waveform rendered in
the app's warm accent palette. Pure PIL, no external assets.
"""
import math
from PIL import Image, ImageDraw

S = 1024  # master size
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# macOS "squircle"-ish rounded rect background with a vertical gradient.
top = (24, 26, 32)      # near-black, slightly cool
bottom = (8, 9, 11)     # #08090B
radius = int(S * 0.225)
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bgd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / (S - 1)
    r = round(top[0] + (bottom[0] - top[0]) * t)
    g = round(top[1] + (bottom[1] - top[1]) * t)
    b = round(top[2] + (bottom[2] - top[2]) * t)
    bgd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)

# Accent palette (from the renderer): amber, coral, green.
accents = [
    (243, 202, 94),   # #F3CA5E
    (242, 166, 90),   # #F2A65A
    (242, 109, 113),  # #F26D71
    (87, 215, 124),   # #57D77C
]

# Centered waveform of vertical rounded bars, symmetric, height by a smooth curve.
n = 11
cx, cy = S / 2, S / 2
span = S * 0.60
bar_w = span / (n * 1.9)
gap = (span - bar_w * n) / (n - 1)
start_x = cx - span / 2
max_h = S * 0.46
for i in range(n):
    # symmetric bell-ish profile, tallest in the middle
    k = (i - (n - 1) / 2) / ((n - 1) / 2)  # -1..1
    h = max_h * (0.28 + 0.72 * math.cos(k * math.pi / 2) ** 1.5)
    x0 = start_x + i * (bar_w + gap)
    x1 = x0 + bar_w
    y0 = cy - h / 2
    y1 = cy + h / 2
    color = accents[i % len(accents)]
    d.rounded_rectangle([x0, y0, x1, y1], radius=bar_w / 2, fill=color + (255,))

out_png = "build/icon.png"
img.save(out_png)
print("wrote", out_png)
