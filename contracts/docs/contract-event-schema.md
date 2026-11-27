# Contract Event Schema

The contracts in this workspace publish Soroban events with a stable two-part
topic convention:

- `(<contract_family>, <action>)`
- Example: `("channel", "closed")`

Guidelines:

- The first topic names the contract family or lifecycle domain.
- The second topic names the state transition or lifecycle action.
- Event payloads carry the contract-specific data for the transition.
- The backend indexer stores the raw topics and also a normalized dotted path
  such as `channel.closed` in `blockchain_logs.event_type`.

Current canonical families:

- `channel`
- `escrow`
- `agent`
- `allowance`
- `card`
- `upgrade`
- `voucher`
- `payment`

When adding a new contract, publish a topic pair that fits the same pattern so
the ledger indexer and downstream dashboards can treat all contracts
consistently.

## Event schema versioning (v1)

Every v3 contract event payload carries a schema version so payloads can
evolve without breaking indexers and watchers:

- New events MUST include `schema_version: 1` (integer) in the event data map.
- The backend indexer branches on this version (see
  `backend/src/blockchain/indexer.ts`: `extractSchemaVersion` /
  `decodeEventByVersion`). Unknown future versions are persisted with their
  raw `value` and logged, never silently dropped.
- Version 1 payload shapes are pinned per event (positional Soroban SDK
  values); any field addition or reorder requires bumping the version and
  adding a decoder branch plus tests.

Example (v1 `channel.opened` value):

```json
{ "schema_version": 1, "channel_id": 7, "deposit": 50 }
```
