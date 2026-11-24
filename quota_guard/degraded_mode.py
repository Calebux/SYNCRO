from typing import List, Tuple


class DegradedMode:
    """Simple degraded mode evaluator.

    Given a list of `QuotaTracker`-like objects (objects with `get_status()`),
    decide whether system should enter a degraded mode and which services to degrade.
    """

    def __init__(self, trackers, throttle_threshold: int = 3, global_percent_threshold: float = 0.9):
        self.trackers = trackers
        self.throttle_threshold = int(throttle_threshold)
        self.global_percent_threshold = float(global_percent_threshold)

    def evaluate(self) -> Tuple[bool, List[str]]:
        """Return (degraded, services_to_limit).

        - degraded: whether a global degraded mode should be activated
        - services_to_limit: list of tracker names to apply rate-limiting / degraded behaviour
        """
        services = []
        total_limit = 0
        total_used = 0
        high_throttle = []

        for t in self.trackers:
            s = t.get_status()
            total_limit += s.get("limit", 0)
            total_used += s.get("used", 0)
            if s.get("throttle_count", 0) >= self.throttle_threshold:
                high_throttle.append(s.get("name"))
            # degrade individual services that are >95% used
            if s.get("limit", 1) > 0 and s.get("used", 0) / float(s.get("limit")) >= 0.95:
                services.append(s.get("name"))

        degraded = False
        if total_limit > 0 and (total_used / float(total_limit)) >= self.global_percent_threshold:
            degraded = True

        # if throttles detected, degrade affected services
        services = list(set(services + high_throttle))

        return degraded, services
