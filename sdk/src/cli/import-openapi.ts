#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, Operation>>;
}

interface Operation {
  summary?: string;
  description?: string;
  operationId?: string;
  "x-syncro-price"?: number;
}

interface CliArgs {
  specPath: string;
  output?: string;
  defaultPrice?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const specPath = args[0];
  if (!specPath) {
    console.error("Error: OpenAPI spec file path is required");
    printUsage();
    process.exit(1);
  }

  let output: string | undefined;
  let defaultPrice = 0.01;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg === "-o") {
      output = args[i + 1];
      i++;
    } else if (arg === "--default-price") {
      const priceStr = args[i + 1];
      if (priceStr) {
        defaultPrice = parseFloat(priceStr);
        if (isNaN(defaultPrice) || defaultPrice < 0) {
          console.error("Error: --default-price must be a positive number");
          process.exit(1);
        }
      }
      i++;
    }
  }

  return { specPath, output, defaultPrice };
}

function printUsage(): void {
  console.log(`
Usage: syncro-import-openapi <spec-file> [options]

Import an OpenAPI specification and generate a pricing configuration file.

Arguments:
  <spec-file>              Path to OpenAPI spec file (JSON or YAML)

Options:
  -o, --output <file>      Output file path (default: pricing.json)
  --default-price <num>    Default price per operation (default: 0.01)
  -h, --help              Show this help message

Examples:
  syncro-import-openapi spec.yaml
  syncro-import-openapi spec.json -o pricing.json
  syncro-import-openapi spec.yaml --default-price 0.05

Vendor Extensions:
  x-syncro-price          Set custom price for specific operation
  
Example OpenAPI with vendor extension:
  paths:
    /users:
      get:
        summary: List users
        x-syncro-price: 0.02
`);
}

function loadSpec(filePath: string): OpenAPISpec {
  try {
    const absolutePath = resolve(filePath);
    const content = readFileSync(absolutePath, "utf-8");
    
    // Try to parse as JSON first
    try {
      return JSON.parse(content);
    } catch {
      // If not JSON, could be YAML - for 1% implementation, error out
      console.error("Error: YAML support not yet implemented. Please provide JSON spec.");
      console.error("Hint: Convert YAML to JSON using an online tool or yq command");
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error reading spec file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function generatePricingConfig(spec: OpenAPISpec, defaultPrice: number): Record<string, any> {
  const routes: Record<string, number | { price: number; description?: string }> = {};
  
  if (!spec.paths) {
    console.warn("Warning: No paths found in OpenAPI spec");
    return {
      defaultPrice,
      currency: "USDC",
      routes: {}
    };
  }

  let operationCount = 0;
  let customPriceCount = 0;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
    
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      operationCount++;
      const routeKey = `${method.toUpperCase()} ${path}`;
      
      // Check for x-syncro-price vendor extension
      const customPrice = operation["x-syncro-price"];
      if (typeof customPrice === "number" && customPrice >= 0) {
        customPriceCount++;
        routes[routeKey] = {
          price: customPrice,
          description: operation.summary || operation.description || undefined
        };
      } else {
        // Use default price
        const description = operation.summary || operation.description;
        if (description) {
          routes[routeKey] = {
            price: defaultPrice,
            description
          };
        } else {
          routes[routeKey] = defaultPrice;
        }
      }
    }
  }

  console.log(`✓ Processed ${operationCount} operations`);
  if (customPriceCount > 0) {
    console.log(`✓ Found ${customPriceCount} operations with x-syncro-price extension`);
  }

  return {
    defaultPrice,
    currency: "USDC",
    routes
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  
  console.log(`Reading OpenAPI spec from: ${args.specPath}`);
  const spec = loadSpec(args.specPath);
  
  // Validate OpenAPI version
  const version = spec.openapi || spec.swagger;
  if (!version) {
    console.error("Error: Not a valid OpenAPI/Swagger spec (missing openapi/swagger version field)");
    process.exit(1);
  }
  console.log(`✓ Detected OpenAPI/Swagger version: ${version}`);
  
  const pricingConfig = generatePricingConfig(spec, args.defaultPrice || 0.01);
  
  const outputPath = args.output || "pricing.json";
  const absoluteOutputPath = resolve(outputPath);
  
  writeFileSync(
    absoluteOutputPath,
    JSON.stringify(pricingConfig, null, 2) + "\n",
    "utf-8"
  );
  
  console.log(`✓ Pricing configuration written to: ${outputPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review the generated pricing file`);
  console.log(`  2. Adjust prices as needed`);
  console.log(`  3. Use this config when registering your provider routes`);
}

// Run CLI
main();
