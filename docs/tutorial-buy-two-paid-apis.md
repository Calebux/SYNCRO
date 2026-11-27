# Tutorial: Build an agent that buys data from two paid APIs

This tutorial walks through the full consumer journey: create an agent, fund a channel, call two providers with different prices, enforce a budget, verify receipts, and close.

## Prerequisites

- Node 20+
- SYNCRO local stack running (`npm run dev` in `backend/` and `client/`)

## Steps

1. Create an agent with a budget.
2. Fund a payment channel.
3. Call provider A (cheap).
4. Call provider B (expensive) within remaining budget.
5. Enforce budget: reject calls that exceed it.
6. Verify receipts.
7. Close the channel.

See `examples/buy-two-paid-apis.ts` for runnable code.
`