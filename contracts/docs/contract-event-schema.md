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
