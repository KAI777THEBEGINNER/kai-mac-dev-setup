"""Spritesheet parser for Clippy desktop pet."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class Frame:
    """A single animation frame."""

    image: Image.Image
    row: int
    col: int


class SpriteSheet:
    """Cuts the Clippy spritesheet into individual frames."""

    # Grid geometry derived from transparent-separator analysis of the 1536x1872 sheet.
    COLS = [28, 220, 412, 604, 796, 988, 1180, 1372]
    COL_WIDTH = 135
    ROWS = [55, 263, 471, 679, 886, 1095, 1303, 1511, 1719]
    ROW_HEIGHT = 125  # most rows; we crop to this for consistency

    def __init__(self, path: str | Path) -> None:
        self.sheet = Image.open(path).convert("RGBA")
        self.frames: list[list[Frame]] = []
        self._cut()

    def _cut(self) -> None:
        for r_idx, y in enumerate(self.ROWS):
            row_frames: list[Frame] = []
            for c_idx, x in enumerate(self.COLS):
                box = (x, y, x + self.COL_WIDTH, y + self.ROW_HEIGHT)
                frame = self.sheet.crop(box)
                # Skip fully-transparent frames (some cells may be empty)
                if frame.getbbox():
                    row_frames.append(Frame(frame, r_idx, c_idx))
            self.frames.append(row_frames)

    def row(self, idx: int) -> list[Frame]:
        """Return all non-empty frames in a given row."""
        if 0 <= idx < len(self.frames):
            return self.frames[idx]
        return []

    def first_frame(self) -> Frame | None:
        for row in self.frames:
            if row:
                return row[0]
        return None
