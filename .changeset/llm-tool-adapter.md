---
"@syncro/sdk": minor
---

Add a framework-neutral LLM function-calling adapter to `@syncro/sdk/v3`. `toToolDefinition(route)` turns a paid route from a provider manifest into a JSON Schema (draft-07) tool spec with the route's cost in its description, and `executeTool(call, options)` / `createPaidTools(options)` run a model's tool call through `createPaidFetch`, returning failures as tool errors instead of throwing.
