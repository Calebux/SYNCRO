/**
 * Run with:  npx tsx sdk/examples/llm-tool-loop/run.ts
 */
import { createPaidTools } from "../../src/v3/index.js";
import { createMockGateway, exampleManifest, runToolLoop, scriptedModel } from "./tool-loop.js";

const gateway = createMockGateway();

const tools = createPaidTools({
  manifest: exampleManifest,
  paidFetch: {
    spendingKey: gateway.spendingKey,
    gatewayPublicKey: gateway.gatewayPublicKey,
    fetchImpl: gateway.fetchImpl,
  },
});

console.log("Tools sent to the model:");
console.log(JSON.stringify(tools.definitions, null, 2));

const result = await runToolLoop({
  model: scriptedModel,
  tools,
  prompt: "stellar payment channels",
});

console.log("\nAnswer:", result.answer);
console.log("Spent:", result.spent);
console.log("Receipts:", result.toolResults.map((r) => r.receipt));
