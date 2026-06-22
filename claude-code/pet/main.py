"""Claude Code desktop pet — Clippy floating assistant."""
from __future__ import annotations

import sys
from pathlib import Path

from PyQt6.QtCore import Qt, QTimer, QPoint, QSettings
from PyQt6.QtGui import QAction, QCursor, QIcon, QImage, QMouseEvent, QPixmap
from PyQt6.QtWidgets import QApplication, QLabel, QMenu, QSystemTrayIcon, QWidget

from sprite import SpriteSheet
from state import ClaudeStateWatcher


class PetWindow(QWidget):
    """Frameless, top-most, draggable sprite window."""

    # Map status -> (spritesheet_row, frame_interval_ms)
    ANIMATIONS = {
        "idle": (0, 900),
        "busy": (4, 180),
        "gone": (0, 900),
    }

    def __init__(self, sheet: SpriteSheet) -> None:
        super().__init__()
        self.sheet = sheet
        self._frames: list = []
        self._frame_idx = 0
        self._drag_pos: QPoint | None = None

        self.settings = QSettings("claude-pet", "clippy")

        # Window flags: frameless, always on top, tool (no dock icon), no focus steal
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowDoesNotAcceptFocus
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)

        self.label = QLabel(self)
        self.label.setScaledContents(True)

        # Animation timer
        self._anim_timer = QTimer(self)
        self._anim_timer.timeout.connect(self._next_frame)

        # State watcher
        self._watcher = ClaudeStateWatcher(self)
        self._watcher.status_changed.connect(self._on_status)

        # Poll for state changes every second (file watcher alone misses rapid updates)
        self._poll_timer = QTimer(self)
        self._poll_timer.timeout.connect(self._watcher._scan)
        self._poll_timer.start(1000)

        # Restore position or center
        pos = self.settings.value("pos")
        if pos:
            self.move(pos)
        else:
            screen = QApplication.primaryScreen().geometry()
            self.move(screen.width() - 200, screen.height() - 250)

        # Start idle
        self._set_anim("idle")
        self.show()

    def _pil_to_pixmap(self, pil_img) -> QPixmap:
        data = pil_img.tobytes("raw", "RGBA")
        qimg = QImage(data, pil_img.width, pil_img.height, QImage.Format.Format_RGBA8888)
        return QPixmap.fromImage(qimg)

    def _set_anim(self, status: str) -> None:
        row_idx, interval = self.ANIMATIONS.get(status, (0, 900))
        self._frames = self.sheet.row(row_idx)
        if not self._frames:
            self._frames = [self.sheet.first_frame()]
        self._frame_idx = 0
        self._show_current()
        self._anim_timer.start(interval)

    def _show_current(self) -> None:
        if not self._frames:
            return
        frame = self._frames[self._frame_idx]
        pixmap = self._pil_to_pixmap(frame.image)
        self.label.setPixmap(pixmap)
        self.label.adjustSize()
        self.adjustSize()

    def _next_frame(self) -> None:
        if not self._frames:
            return
        self._frame_idx = (self._frame_idx + 1) % len(self._frames)
        self._show_current()

    def _on_status(self, status: str) -> None:
        # When transitioning from busy -> idle, show a quick completion burst
        if getattr(self, "_last_status", None) == "busy" and status == "idle":
            self._play_once_then(1, 120, lambda: self._set_anim("idle"))
            return
        self._last_status = status
        self._set_anim(status)

    def _play_once_then(self, row_idx: int, interval: int, callback) -> None:
        frames = self.sheet.row(row_idx)
        if not frames:
            callback()
            return
        self._anim_timer.stop()
        self._frames = frames
        self._frame_idx = 0
        self._show_current()

        idx = [0]
        t = QTimer(self)
        t.setSingleShot(False)

        def tick():
            idx[0] += 1
            if idx[0] >= len(frames):
                t.stop()
                t.deleteLater()
                callback()
                return
            self._frame_idx = idx[0]
            self._show_current()

        t.timeout.connect(tick)
        t.start(interval)

    # ── Mouse / Drag ──
    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._drag_pos is not None and event.buttons() == Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        self._drag_pos = None
        self.settings.setValue("pos", self.pos())
        event.accept()

    # ── Context Menu ──
    def contextMenuEvent(self, event) -> None:
        menu = QMenu(self)
        hide_act = QAction("Hide", self)
        hide_act.triggered.connect(self.hide)
        menu.addAction(hide_act)
        menu.addSeparator()
        quit_act = QAction("Quit", self)
        quit_act.triggered.connect(QApplication.quit)
        menu.addAction(quit_act)
        menu.exec(QCursor.pos())
        event.accept()


def main() -> None:
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    # Tray icon so the app stays alive when hidden
    tray = QSystemTrayIcon(app)
    asset_path = Path(__file__).with_name("assets") / "spritesheet.webp"
    tray.setIcon(QIcon(QPixmap(str(asset_path)).scaled(64, 64, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)))
    tray.setToolTip("Claude Pet — Clippy")

    menu = QMenu()
    show_act = QAction("Show", app)
    quit_act = QAction("Quit", app)
    menu.addAction(show_act)
    menu.addAction(quit_act)
    tray.setContextMenu(menu)

    sheet = SpriteSheet(asset_path)
    window = PetWindow(sheet)

    show_act.triggered.connect(window.show)
    quit_act.triggered.connect(app.quit)
    tray.activated.connect(lambda reason: window.show() if reason == QSystemTrayIcon.ActivationReason.Trigger else None)
    tray.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
