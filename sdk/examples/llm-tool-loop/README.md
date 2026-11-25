# Raw LLM tool-use loop over paid routes

A tool-use loop with no agent framework, built on the `@syncro/sdk/v3` tool
adapter:

1. `createPaidTools({ manifest, paidFetch })` turns each paid route into a JSON
   Schema tool spec whose description includes the route's cost.
2. The loop sends `tools.definitions` to the model.
3. Each tool call the model makes goes through `tools.executeTool(call)`, which
   pays the route's 402 challenge with `createPaidFetch` and returns the result,
   price, and receipt.
4. Results go back to the model until it answers without calling a tool.

Run it from the repository root:

```bash
npx tsx sdk/examples/llm-tool-loop/run.ts
```

The example is self-contained: `createMockGateway()` is an in-process paid API
that issues signed `PAYMENT-REQUIRED` challenges, and `scriptedModel` stands in
for an LLM. It reads the cost from each tool description and calls the cheapest
search tool.

## Using a real model

Replace `scriptedModel` with a function that has the same `Model` signature:

- Send each `ToolDefinition` in the shape your provider expects, e.g. Anthropic
  Messages `{ name, description, input_schema: parameters }` or OpenAI-style
  `{ type: "function", function: { name, description, parameters } }`.
- Map the provider's tool calls to `ToolCall` (`{ id, name, arguments }`;
  `arguments` may be an object or a JSON string).
- Send each `tool` message back as the provider's tool-result message, flagging
  `isError` results as errors.
