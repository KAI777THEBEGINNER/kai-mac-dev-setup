"""One-off extraction: cut the Clippy spritesheet into numbered PNG frames."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

# Grid geometry from transparent-separator analysis
COLS = [28, 220, 412, 604, 796, 988, 1180, 1372]
COL_W = 135
ROWS = [55, 263, 471, 679, 886, 1095, 1303, 1511, 1719]
ROW_H = 125

OUT = Path(__file__).with_name("assets") / "frames"
OUT.mkdir(parents=True, exist_ok=True)

sheet = Image.open(Path(__file__).with_name("assets") / "spritesheet.webp").convert("RGBA")

count = 0
for r_idx, y in enumerate(ROWS):
    for c_idx, x in enumerate(COLS):
        frame = sheet.crop((x, y, x + COL_W, y + ROW_H))
        if frame.getbbox():  # skip fully-transparent cells
            frame.save(OUT / f"r{r_idx}_c{c_idx}.png")
            count += 1

print(f"Extracted {count} frames to {OUT}")
