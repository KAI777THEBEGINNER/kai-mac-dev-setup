"""Claude Code session-state watcher."""
from __future__ import annotations

import json
import time
from pathlib import Path

from PyQt6.QtCore import QFileSystemWatcher, QObject, pyqtSignal


class ClaudeStateWatcher(QObject):
    """Watches ~/.claude/sessions/*.json and emits status changes."""

    status_changed = pyqtSignal(str)  # "idle" | "busy" | "gone"

    SESSIONS_DIR = Path.home() / ".claude" / "sessions"

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._last_status: str | None = None
        self._watcher = QFileSystemWatcher(self)
        if self.SESSIONS_DIR.exists():
            self._watcher.addPath(str(self.SESSIONS_DIR))
            for f in self.SESSIONS_DIR.glob("*.json"):
                self._watcher.addPath(str(f))
        self._watcher.directoryChanged.connect(self._scan)
        self._watcher.fileChanged.connect(self._scan)
        self._scan()

    def _scan(self) -> None:
        latest_status = "gone"
        latest_time = 0.0

        if self.SESSIONS_DIR.exists():
            for path in self.SESSIONS_DIR.glob("*.json"):
                try:
                    data = json.loads(path.read_text())
                    updated = data.get("updatedAt", 0) / 1000.0
                    if updated > latest_time:
                        latest_time = updated
                        latest_status = data.get("status", "idle")
                except Exception:
                    continue

        # fallback: if a session was updated in the last 30s, trust it
        if latest_status == "gone" and latest_time > 0:
            if time.time() - latest_time < 30:
                latest_status = "idle"

        if latest_status != self._last_status:
            self._last_status = latest_status
            self.status_changed.emit(latest_status)
