# Rate card versioning on paid calls

Paid calls must send the `rateCardVersion` they were priced against. This
document defines what the gateway does when that version is stale — i.e. the
provider has published a newer rate card since the agent last fetched one.

## Policy: reject and refresh

When a paid call arrives with a `rateCardVersion` that is not the current
version, the gateway **rejects** the call. It does **not** honour the old price
for a grace window and it does **not** silently reprice, because either would
let an agent transact at a price the provider no longer offers.

Instead the gateway returns a distinct taxonomy error so the SDK can refresh
the rate card and retry once automatically.

## Error taxonomy

Stale versions are reported with the taxonomy code `RATE_CARD_VERSION_STALE`.
The error payload includes the current version so the client can refresh
without an extra round trip:

```json
{
  "error": {
    "code": "RATE_CARD_VERSION_STALE",
    "message": "rateCardVersion is stale; refresh the rate card and retry",
    "details": {
      "sentVersion": "2024-01-01",
      "currentVersion": "2024-06-01"
    }
  }
}
```

`currentVersion` is always present on this error. `sentVersion` echoes the
value the caller supplied.

## SDK behaviour

On receiving `RATE_CARD_VERSION_STALE` the SDK:

1. Refreshes the rate card (fetching `currentVersion`).
2. Retries the paid call **once** with the refreshed `rateCardVersion`.

If the retry also fails with `RATE_CARD_VERSION_STALE` (e.g. pricing changed
again mid-flight), the error is surfaced to the caller rather than retried
indefinitely.

## Tested outcome

A paid call carrying a stale `rateCardVersion` produces the documented
outcome: a `RATE_CARD_VERSION_STALE` error containing the current version, and
the SDK refreshes and retries once automatically.
