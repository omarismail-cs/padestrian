"""Generate color-coded map pin PNGs from source artwork."""
from __future__ import annotations

from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).resolve().parent / "assets"
OUT = ROOT / "public" / "images"
SIZE = 64

HOUSE_SRC = SRC / "house-pin-source.png"
GROCERY_SRC = SRC / "grocery-pin-source.png"

HOUSE_COLORS = {
    "house-walkable": (0x6B, 0xBF, 0x91),
    "house-grocery": (0x84, 0xCC, 0x16),
    "house-transit": (0x8B, 0x5C, 0xF6),
    "house-neither": (0x64, 0x74, 0x8B),
    "house-default": (0x94, 0xA3, 0xB8),
}

def process_icon(
    src: Path,
    out_path: Path,
    pin_rgb: tuple[int, int, int] | None = None,
) -> None:
    im = Image.open(src).convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    # Transparent background (near-black outside pin)
    bg = (r < 40) & (g < 40) & (b < 40)
    a[bg] = 0

    # Pin body: strong red in source artwork
    pin = (r > 120) & (r > g + 35) & (r > b + 35) & ~bg
    if pin_rgb is not None:
        pr, pg, pb = pin_rgb
        arr[pin, 0] = pr
        arr[pin, 1] = pg
        arr[pin, 2] = pb
    arr[pin, 3] = 255

    # Preserve black silhouette + white grocery details
    dark = (r < 90) & (g < 90) & (b < 90) & ~bg & ~pin
    arr[dark, 0:3] = 0
    arr[dark, 3] = 255

    light = (r > 200) & (g > 200) & (b > 200)
    arr[light, 0:3] = 255
    arr[light, 3] = 255

    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    # Trim padding then fit to SIZE
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    out = out.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, optimize=True)
    print(f"wrote {out_path}")


def main() -> None:
    for name, rgb in HOUSE_COLORS.items():
        process_icon(HOUSE_SRC, OUT / f"{name}.png", pin_rgb=rgb)

    # Supermarkets: original red pin, no recolor
    process_icon(GROCERY_SRC, OUT / "grocery-icon.png")
    process_icon(HOUSE_SRC, OUT / "house-icon.png", pin_rgb=HOUSE_COLORS["house-default"])


if __name__ == "__main__":
    main()
