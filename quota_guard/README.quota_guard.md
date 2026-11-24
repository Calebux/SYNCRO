quota_guard
===========

Small helper library to track external API quota consumption, record throttle responses, and decide a user-facing degraded mode.

Usage
-----

Basic tracker:

```python
from quota_guard import QuotaTracker

def alert(name, payload):
    print("ALERT", name, payload)

t = QuotaTracker("gmail", limit=1000, window_seconds=60, alert_threshold_percent=0.8, alert_callback=alert)
t.consume(1)
```

Degraded mode:

```python
from quota_guard import DegradedMode

# pass a list of trackers
dm = DegradedMode([t], throttle_threshold=3, global_percent_threshold=0.9)
degraded, services = dm.evaluate()
```

Testing
-------

Run:

```bash
python -m pip install -r requirements.txt
pytest -q
```
