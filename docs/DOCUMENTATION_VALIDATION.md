# Documentation Code Sample Validation

This document describes how code samples in documentation are validated to prevent documentation rot.

## Overview

Documentation examples are automatically tested in CI to ensure they compile and maintain correct syntax. This prevents documentation from silently becoming outdated.

## Validated Documentation

The following documentation files have their code samples validated:

| File | Language Support | Purpose |
|------|-----------------|---------|
| `sdk/README.md` | TypeScript, JavaScript | SDK usage examples |
| `backend/README.md` | TypeScript, JavaScript | Backend setup and configuration |
| `backend/SUBSCRIPTION_API.md` | TypeScript, JavaScript, Bash | API usage and curl examples |

## Supported Languages

Currently, code samples in the following languages are validated:

- **TypeScript** (marked with ` ```typescript `)
  - Checked with `tsc` for syntax errors
  - Type annotations verified
  
- **JavaScript** (marked with ` ```javascript ` or ` ```js `)
  - Validated using Node.js Function() constructor
  - Basic syntax and structure checked
  
- **Bash** (marked with ` ```bash ` or ` ```sh `)
  - Syntax validated with `bash -n` (no execution)
  - Commands checked for correctness

- **Other languages** (Python, SQL, etc.)
  - Currently skipped (no validation)
  - Can be added by extending validation logic

## CI Integration

### Trigger

Documentation validation runs automatically when:
- A pull request modifies validated documentation files
- `.github/workflows/validate-docs.yml` is modified
- Manual trigger via GitHub Actions workflow dispatch

### Flow

1. CI job installs dependencies
2. Extracts code blocks from markdown files
3. Validates syntax for each language
4. Reports failures with specific error messages
5. Blocks PR merge if validation fails
6. Comments on PR with failure details

### Running Locally

To validate documentation before pushing:

```bash
# Validate all configured docs
node scripts/validate-docs.js

# Exit code: 0 = success, 1 = failures
```

## Adding New Code Samples

When adding code examples to validated documentation:

### 1. Use Language Tags

Include the language identifier in your markdown code fence:

````markdown
```typescript
const sdk = init({ apiKey: "sk_..." });
```
````

### 2. Ensure Valid Syntax

Your code must:
- Have valid TypeScript/JavaScript/Bash syntax
- Not contain pseudo-code or placeholder symbols (e.g., `...` on its own line)
- Be self-contained or clearly show assumptions

### 3. Handle Dependencies

For imports and external dependencies:
- TypeScript examples can use `import` statements that will be type-checked
- JavaScript examples should use valid JS syntax
- Bash examples can reference commands available in standard environments

### 4. Example: Valid TypeScript Sample

````markdown
```typescript
import { init } from "@syncro/sdk";

const sdk = init({
  apiKey: process.env.SYNCRO_API_KEY,
  baseURL: "https://api.syncro.com",
  enableLogging: true,
});

const subscriptions = await sdk.listSubscriptions();
```
````

### 5. Example: Valid Bash Sample

````markdown
```bash
curl -X GET https://api.syncro.com/subscriptions \
  -H "Authorization: Bearer sk_live_..."
```
````

## Common Validation Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `Unexpected identifier` | Syntax error or missing import | Check TypeScript syntax, add missing imports |
| `Expected ';'` | Missing semicolon (JS) | Add semicolon or enable implicit completion |
| `Unknown function` | Reference to undefined function | Add function definition or clarify it's from a library |
| `bash: -n: line N: unexpected EOF` | Incomplete bash script | Ensure script is syntactically complete |

## Adding New Documentation Files to Validation

To add a new documentation file to validation:

1. **Update `scripts/validate-docs.js`**:
   - Add the file path to the `VALIDATED_DOCS` array

2. **Update `.github/workflows/validate-docs.yml`**:
   - Add the file path to the `paths` filter

3. **Test locally**:
   ```bash
   node scripts/validate-docs.js
   ```

### Example: Adding `client/README.md`

```javascript
// scripts/validate-docs.js
const VALIDATED_DOCS = [
  "sdk/README.md",
  "backend/README.md",
  "backend/SUBSCRIPTION_API.md",
  "client/README.md",  // Add this line
];
```

```yaml
# .github/workflows/validate-docs.yml
on:
  pull_request:
    paths:
      - 'sdk/README.md'
      - 'backend/README.md'
      - 'backend/SUBSCRIPTION_API.md'
      - 'client/README.md'  # Add this line
```

## Extending Validation

To add validation for additional languages:

1. **Add language handler in `scripts/validate-docs.js`**:
   ```javascript
   function validatePythonSample(code) {
     try {
       execSync(`python -m py_compile`, { input: code });
       return { success: true };
     } catch (e) {
       return { success: false, error: e.message };
     }
   }
   ```

2. **Update switch statement**:
   ```javascript
   case "python":
     return validatePythonSample(code);
   ```

3. **Update supported languages list** in this document

## Troubleshooting

### PR stuck on validation

**Check**: Run `node scripts/validate-docs.js` locally to see errors

**Common issues**:
- Missing npm dependencies
- Invalid syntax in code examples
- Language tag misspelled (e.g., `typescripts` instead of `typescript`)

### Validation passes locally but fails in CI

**Cause**: Different Node.js or tool versions
**Solution**: Check CI logs, match local environment to `runs-on: ubuntu-latest` with Node.js 20

### Want to skip validation for a file

Add non-validated language tag or remove from `VALIDATED_DOCS`:

```markdown
```example
This won't be validated
```
```

## Security Considerations

- Code samples are validated for syntax only, not executed
- Bash samples use `bash -n` (syntax-only check, no execution)
- JavaScript samples use `Function()` constructor (syntax check, not evaluation)
- No external code is downloaded or executed during validation
- Dependencies are from `package.json` only

## Related Issues

- #687: Validate documentation code samples in CI
- #93: Quality backlog item

## References

- [Validation Script](../../scripts/validate-docs.js)
- [CI Workflow](../../.github/workflows/validate-docs.yml)
