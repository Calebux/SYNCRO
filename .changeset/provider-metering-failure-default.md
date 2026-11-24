---
"@syncro/sdk": major
---

Provider middleware now rejects requests with a 503 (including a retry hint) when metering fails, instead of silently serving free by default. Opting into `failureMode: 'serve-free'` is now explicit, logs a one-time warning per process, and counts served-free requests so providers can see the cost.
