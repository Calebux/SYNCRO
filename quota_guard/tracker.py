import threading
import time
import logging
from typing import Callable, Optional

logger = logging.getLogger("quota_guard.tracker")


class QuotaTracker:
    """Tracks quota consumption and throttle events for a single external API.

    Usage:
    - Instantiate with a `limit` (tokens per window) and `window_seconds`.
    - Call `consume(amount=1)` for quota usage events.
    - Call `record_throttle(info)` when a throttle response is received from the API.
    - Register an `alert_callback` to receive alerts before hard exhaustion.
    """

    def __init__(
        self,
        name: str,
        limit: int,
        window_seconds: int = 60,
        alert_threshold_percent: float = 0.8,
        alert_callback: Optional[Callable[[str, dict], None]] = None,
        logger_obj: Optional[logging.Logger] = None,
    ):
        self.name = name
        self.limit = int(limit)
        self.window_seconds = int(window_seconds)
        self.alert_threshold = float(alert_threshold_percent)
        self.alert_callback = alert_callback
        self.logger = logger_obj or logger

        self._lock = threading.Lock()
        self._window_start = time.time()
        self._used = 0
        self._throttle_count = 0

    def _maybe_reset_window(self):
        now = time.time()
        if now - self._window_start >= self.window_seconds:
            self.logger.debug("%s: resetting quota window", self.name)
            self._window_start = now
            self._used = 0

    def consume(self, amount: int = 1) -> None:
        """Record consumption of `amount` quota.

        Logs warnings when nearing configured alert threshold and errors on exhaustion.
        """
        if amount <= 0:
            return
        with self._lock:
            self._maybe_reset_window()
            self._used += int(amount)
            remaining = max(self.limit - self._used, 0)

            pct = self._used / float(self.limit) if self.limit > 0 else 1.0
            self.logger.info(
                "%s: consumed=%d remaining=%d (%.0f%% used)",
                self.name,
                self._used,
                remaining,
                pct * 100,
            )

            if pct >= 1.0:
                self.logger.error(
                    "%s: quota exhausted (used=%d limit=%d)", self.name, self._used, self.limit
                )
                self._on_alert("exhausted", {"used": self._used, "limit": self.limit})
            elif pct >= self.alert_threshold:
                self.logger.warning(
                    "%s: approaching quota limit (used=%d limit=%d threshold=%.0f%%)",
                    self.name,
                    self._used,
                    self.limit,
                    self.alert_threshold * 100,
                )
                self._on_alert(
                    "threshold", {"used": self._used, "limit": self.limit, "percent": pct}
                )

    def record_throttle(self, info: Optional[dict] = None) -> None:
        """Record that the external API returned a throttle response.

        This should be called by the API client when it receives a 429/503 or similar.
        """
        with self._lock:
            self._throttle_count += 1
            self.logger.warning(
                "%s: throttle response recorded (count=%d) info=%s",
                self.name,
                self._throttle_count,
                info,
            )
            self._on_alert("throttle", {"throttle_count": self._throttle_count, "info": info})

    def record_remote_quota(self, remaining: int, total: int) -> None:
        """Sync tracker with quota information reported by the remote service.

        Many APIs return headers like X-RateLimit-Remaining/Limit; call this method
        with those values to keep our counters accurate.
        """
        if total <= 0:
            return
        with self._lock:
            self.limit = int(total)
            self._used = max(int(total) - int(remaining), 0)
            self.logger.debug(
                "%s: synced remote quota remaining=%d total=%d used=%d",
                self.name,
                remaining,
                total,
                self._used,
            )

    def get_status(self) -> dict:
        with self._lock:
            self._maybe_reset_window()
            return {
                "name": self.name,
                "limit": self.limit,
                "used": self._used,
                "remaining": max(self.limit - self._used, 0),
                "throttle_count": self._throttle_count,
                "window_seconds": self.window_seconds,
            }

    def reset(self) -> None:
        with self._lock:
            self._window_start = time.time()
            self._used = 0
            self._throttle_count = 0

    def _on_alert(self, kind: str, payload: dict) -> None:
        if self.alert_callback:
            try:
                self.alert_callback(self.name, {"kind": kind, **payload})
            except Exception:
                self.logger.exception("%s: alert_callback raised", self.name)
