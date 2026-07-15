#!/usr/bin/env python3
"""Create a reusable First Pair ink mask and a tinted transparent mark."""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageColor, ImageFilter
except ImportError as exc:
    raise SystemExit(
        "Pillow is required. Install it in a disposable environment with "
        "`python3 -m pip install Pillow`."
    ) from exc


HERE = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Remove the off-white paper from the blue First Pair seal, emit a "
            "full-strength grayscale mask, and tint it for a cover palette."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=HERE / "firstpair-catdog-logo.jpeg",
        help="Source seal image (default: logo/firstpair-catdog-logo.jpeg)",
    )
    parser.add_argument(
        "--mask-out",
        type=Path,
        default=HERE / "firstpair-publisher-mask.png",
        help="Full-strength grayscale mask output (default: logo/firstpair-publisher-mask.png)",
    )
    parser.add_argument(
        "--tint-out",
        type=Path,
        default=HERE / "firstpair-publisher-bronze.png",
        help="Tinted transparent PNG output (default: logo/firstpair-publisher-bronze.png)",
    )
    parser.add_argument(
        "--color",
        default="#c2a979",
        help="Tint color as a CSS-style value (default: #c2a979)",
    )
    parser.add_argument(
        "--max-alpha",
        type=int,
        default=94,
        help="Maximum opacity from 1 to 255 (default: 94)",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=20,
        help="Minimum blue-chroma score retained as ink (default: 20)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.max_alpha <= 255:
        raise SystemExit("--max-alpha must be between 1 and 255")
    if not 1 <= args.threshold <= 254:
        raise SystemExit("--threshold must be between 1 and 254")

    source = Image.open(args.source).convert("RGB")
    red, green, blue = source.split()
    neutral = Image.blend(red, green, 0.5)
    blue_chroma = ImageChops.subtract(blue, neutral)

    # The original JPEG paper is neutral; its engraved ink is strongly blue.
    # Chroma extraction avoids turning the paper and white letterforms opaque.
    low = max(0, args.threshold - 2)
    gain = 255 / 49
    mask = blue_chroma.point(
        lambda value: 0
        if value < args.threshold
        else min(255, round((value - low) * gain))
    ).filter(ImageFilter.GaussianBlur(0.2))

    args.mask_out.parent.mkdir(parents=True, exist_ok=True)
    mask.save(args.mask_out)

    alpha = mask.point(lambda value: round(value * args.max_alpha / 255))
    rgb = ImageColor.getrgb(args.color)
    tinted = Image.new("RGBA", source.size, (*rgb, 0))
    tinted.putalpha(alpha)
    args.tint_out.parent.mkdir(parents=True, exist_ok=True)
    tinted.save(args.tint_out)

    print(f"mask: {args.mask_out}")
    print(f"tint: {args.tint_out}")
    print(f"color: {args.color}; max alpha: {args.max_alpha}")


if __name__ == "__main__":
    main()
