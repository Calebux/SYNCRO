import logging
import unittest
from quota_guard.tracker import QuotaTracker
from quota_guard.degraded_mode import DegradedMode


class TestQuotaGuard(unittest.TestCase):
    def test_quota_tracker_threshold_and_exhaustion(self):
        events = []

        def alert_cb(name, payload):
            events.append((name, payload))

        t = QuotaTracker(
            "test-api",
            limit=10,
            window_seconds=100,
            alert_threshold_percent=0.8,
            alert_callback=alert_cb,
        )

        # consume 7 (70%) -> no threshold alert
        t.consume(7)
        status = t.get_status()
        self.assertEqual(status["used"], 7)
        self.assertEqual(events, [])

        # consume 1 -> 8 (80%) triggers threshold alert
        t.consume(1)
        self.assertTrue(len(events) >= 1)
        self.assertEqual(events[-1][1]["kind"], "threshold")

        # consume past limit
        t.consume(5)
        last = events[-1][1]["kind"]
        self.assertIn(last, ("threshold", "exhausted"))

    def test_record_throttle_triggers_alert(self):
        events = []

        def alert_cb(name, payload):
            events.append((name, payload))

        t = QuotaTracker("pay-api", limit=100, alert_callback=alert_cb)
        t.record_throttle({"status": 429})
        self.assertTrue(events and events[-1][1]["kind"] == "throttle")

    def test_degraded_mode_combination(self):
        a = QuotaTracker("a", limit=100)
        b = QuotaTracker("b", limit=100)
        a.consume(95)
        b.consume(5)
        dm = DegradedMode([a, b], throttle_threshold=1, global_percent_threshold=0.9)
        degraded, services = dm.evaluate()
        self.assertFalse(degraded)
        self.assertIn("a", services)


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    unittest.main()
