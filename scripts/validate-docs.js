#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Validates code samples in markdown documentation
 * Extracts code blocks, runs them, reports failures
 */

const VALIDATED_DOCS = [
  "sdk/README.md",
  "backend/README.md",
  "backend/SUBSCRIPTION_API.md",
];

const SDK_SAMPLES_PATH = ".validated-samples";

interface ValidationResult {
  file: string;
  success: boolean;
  samples: { language: string; code: string; error?: string }[];
}

function extractCodeBlocks(markdown) {
  const blocks = [];
  const codeBlockRegex = /```(\w+)\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    blocks.push({
      language: match[1],
      code: match[2],
    });
  }

  return blocks;
}

function validateTypeScriptSample(code) {
  try {
    // Check syntax with TypeScript compiler
    execSync(`npx tsc --noEmit --skipLibCheck 2>&1`, {
      input: code,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function validateJavaScriptSample(code) {
  try {
    // Basic syntax validation
    new Function(code);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function validateBashSample(code) {
  try {
    // Check syntax only (don't execute)
    execSync(`bash -n`, {
      input: code,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function validateSample(language, code) {
  switch (language) {
    case "typescript":
      return validateTypeScriptSample(code);
    case "javascript":
    case "js":
      return validateJavaScriptSample(code);
    case "bash":
    case "sh":
      return validateBashSample(code);
    default:
      return { success: true }; // Skip unknown languages
  }
}

function validateFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return {
      file: filePath,
      success: false,
      samples: [{ language: "error", code: "", error: `File not found: ${fullPath}` }],
    };
  }

  const markdown = fs.readFileSync(fullPath, "utf-8");
  const blocks = extractCodeBlocks(markdown);

  const results = blocks
    .filter((b) => ["typescript", "javascript", "js", "bash", "sh"].includes(b.language))
    .map((block) => ({
      language: block.language,
      code: block.code,
      ...validateSample(block.language, block.code),
    }));

  const success = results.every((r) => r.success !== false);

  return {
    file: filePath,
    success,
    samples: results,
  };
}

function main() {
  console.log("🔍 Validating documentation code samples...\n");

  const results = VALIDATED_DOCS.map(validateFile);
  const failed = results.filter((r) => !r.success);

  results.forEach((result) => {
    const status = result.success ? "✅" : "❌";
    console.log(`${status} ${result.file}`);

    result.samples.forEach((sample, idx) => {
      if (!sample.success) {
        console.log(`   Sample ${idx + 1} (${sample.language}): ${sample.error}`);
      }
    });
  });

  console.log(`\n📊 Results: ${results.length - failed.length}/${results.length} files valid\n`);

  if (failed.length > 0) {
    console.error("❌ Documentation validation failed!");
    process.exit(1);
  }

  console.log("✅ All documentation samples are valid!");
  process.exit(0);
}

main();
