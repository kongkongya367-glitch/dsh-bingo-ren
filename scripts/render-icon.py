#!/usr/bin/env python3
"""Render icon.svg's geometry to assets/icon-512.png.

The SVG is the source of truth. This script reproduces the same shapes with
Pillow so the PNG can be regenerated where headless Edge/Chromium cannot start
(for example inside a sandboxed coding session). Pillow and numpy are
development-only tools, not runtime dependencies of the plugin.

Usage:
    python scripts/render-icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icon-512.png"
SUPERSAMPLE = 16  # 64 * 16 = 1024 px, downsampled to 512
SIZE = 64
W = SIZE * SUPERSAMPLE


def rgb(value: str):
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def linear_gradient(size, start, end, color_start, color_end):
    """RGB gradient along start -> end, in pixel coordinates."""
    width, height = size
    ys, xs = np.mgrid[0:height, 0:width]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    t = ((xs - start[0]) * dx + (ys - start[1]) * dy) / float(dx * dx + dy * dy)
    t = np.clip(t, 0.0, 1.0)[..., None]
    c0 = np.array(color_start, dtype=np.float32)[None, None, :]
    c1 = np.array(color_end, dtype=np.float32)[None, None, :]
    return c0 * (1.0 - t) + c1 * t


def cubic(p0, p1, p2, p3, steps=120):
    t = np.linspace(0.0, 1.0, steps)[:, None]
    points = (
        ((1 - t) ** 3) * np.array(p0)
        + 3 * ((1 - t) ** 2) * t * np.array(p1)
        + 3 * (1 - t) * (t**2) * np.array(p2)
        + (t**3) * np.array(p3)
    )
    return [tuple(p) for p in points]


def scaled(points):
    return [(x * SUPERSAMPLE, y * SUPERSAMPLE) for x, y in points]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    # Rounded plate, 2..62 with a 16-unit radius.
    plate_mask = Image.new("L", (W, W), 0)
    mask_draw = ImageDraw.Draw(plate_mask)
    mask_draw.rounded_rectangle(
        [2 * SUPERSAMPLE, 2 * SUPERSAMPLE, 62 * SUPERSAMPLE - 1, 62 * SUPERSAMPLE - 1],
        radius=16 * SUPERSAMPLE,
        fill=255,
    )
    alpha = np.asarray(plate_mask, dtype=np.float32) / 255.0

    gradient = linear_gradient(
        (W, W),
        (6 * SUPERSAMPLE, 4 * SUPERSAMPLE),
        (58 * SUPERSAMPLE, 60 * SUPERSAMPLE),
        rgb("191C23"),
        rgb("0B0D11"),
    )
    plate = np.dstack([gradient, alpha * 255.0]).astype(np.uint8)
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    canvas.alpha_composite(Image.fromarray(plate, "RGBA"))

    # 1px (at 512) inner ring: white at 12%.
    ring_mask = Image.new("L", (W, W), 0)
    ring_draw = ImageDraw.Draw(ring_mask)
    ring_draw.rounded_rectangle(
        [
            2.5 * SUPERSAMPLE,
            2.5 * SUPERSAMPLE,
            61.5 * SUPERSAMPLE - 1,
            61.5 * SUPERSAMPLE - 1,
        ],
        radius=round(15.5 * SUPERSAMPLE),
        outline=255,
        width=round(1 * SUPERSAMPLE),
    )
    ring_alpha = (np.asarray(ring_mask, dtype=np.float32) * 0.12).astype(np.uint8)
    ring = Image.new("RGBA", (W, W), (255, 255, 255, 0))
    ring.putalpha(Image.fromarray(ring_alpha, "L"))
    canvas.alpha_composite(ring)

    # Four-point Bingo star.
    star_points = []
    star_points += cubic((32, 11), (34.4, 24.2), (39.8, 29.6), (53, 32))
    star_points += cubic((53, 32), (39.8, 34.4), (34.4, 39.8), (32, 53))
    star_points += cubic((32, 53), (29.6, 39.8), (24.2, 34.4), (11, 32))
    star_points += cubic((11, 32), (24.2, 29.6), (29.6, 24.2), (32, 11))
    star_layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(star_layer).polygon(scaled(star_points), fill=rgb("F8F9FB") + (255,))
    canvas.alpha_composite(star_layer)

    # Small blue spark at the top-right.
    dot_mask = Image.new("L", (W, W), 0)
    cx, cy, radius = 47.5, 16.5, 2.8
    ImageDraw.Draw(dot_mask).ellipse(
        [
            (cx - radius) * SUPERSAMPLE,
            (cy - radius) * SUPERSAMPLE,
            (cx + radius) * SUPERSAMPLE,
            (cy + radius) * SUPERSAMPLE,
        ],
        fill=255,
    )
    dot_gradient = linear_gradient(
        (W, W),
        (45 * SUPERSAMPLE, 13 * SUPERSAMPLE),
        (51 * SUPERSAMPLE, 21 * SUPERSAMPLE),
        rgb("9DCBFF"),
        rgb("4F7FF0"),
    )
    dot_alpha = np.asarray(dot_mask, dtype=np.float32) / 255.0
    dot = np.dstack([dot_gradient, dot_alpha * 255.0]).astype(np.uint8)
    canvas.alpha_composite(Image.fromarray(dot, "RGBA"))

    canvas = canvas.resize((512, 512), Image.Resampling.LANCZOS)
    canvas.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, 512x512)")


if __name__ == "__main__":
    main()
