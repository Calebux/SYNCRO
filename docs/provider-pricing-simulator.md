# Provider pricing simulator

The provider console's pricing simulator compares a draft rate card with the route's currently applicable version.

## Pricing semantics

- Prices are integer stroops per unit.
- A free allowance is applied **per call** before paid tiers.
- Tiers are marginal bands: each tier price applies only to paid units above the preceding tier boundary.
- Tier upper bounds are cumulative paid units; the final tier must use `upToUnits: null`.
- The gateway reserves against the maximum billable usage using the same schedule and commits the actual charge after the upstream response.
- A fully free maximum reservation still takes a one-stroop meter hold because the metering ledger requires a positive reservation; the actual committed amount remains zero.

The simulator calls the provider pricing endpoint, which uses the gateway's `calculateChargeStroops` and `roundBillableUnits` functions. Hypothetical profiles can model multiple agents. Historical mode replays recorded settlement quantities and groups them by payment channel because settlement records do not currently store agent IDs.

## Fee estimate

The platform fee basis-point input is an estimate only. The current gateway settlement path does not deduct a platform fee; the simulator keeps the assumed fee separate from provider net revenue and labels it as an estimate.

## Example rate card

```json
{
  "priceStroops": 5,
  "freeUnits": 10,
  "tiers": [
    { "upToUnits": 1000, "priceStroops": 5 },
    { "upToUnits": null, "priceStroops": 2 }
  ]
}
```
