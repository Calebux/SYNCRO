# Winston Log PII Redaction

This implementation adds automatic PII (Personally Identifiable Information) redaction to Winston logs to protect sensitive user data from being exposed in log files.

## Features

The PII redaction system automatically masks the following types of sensitive data:

### 1. Email Addresses
- **Pattern**: Any valid email address format
- **Redaction**: `[REDACTED]`
- **Example**: `user@example.com` → `[REDACTED]`

### 2. Authentication Tokens
- **Patterns**: JWT tokens, API keys, bearer tokens
- **Redaction**: `[REDACTED]`
- **Example**: `Bearer eyJhbGciOiJIUzI1NiI...` → `Bearer [REDACTED]`

### 3. Passwords
- **Field Names**: Any field containing "password"
- **Redaction**: `[REDACTED]`
- **Example**: `{ password: "secret123" }` → `{ password: "[REDACTED]" }`

### 4. API Keys
- **Field Names**: Fields containing "apikey" or "api" + "key"
- **Redaction**: `[REDACTED]`
- **Example**: `{ apiKey: "sk_live_123..." }` → `{ apiKey: "[REDACTED]" }`

### 5. Credit Card Numbers
- **Pattern**: 16-digit numbers with optional separators
- **Field Names**: Fields containing "credit" or "card" + "number"
- **Redaction**: `[REDACTED]`
- **Example**: `4532-1234-5678-9012` → `[REDACTED]`

### 6. Authorization Headers
- **Field Names**: Fields containing "authorization"
- **Redaction**: `[REDACTED]`
- **Example**: `{ authorization: "Bearer token" }` → `{ authorization: "[REDACTED]" }`

### 7. Secrets
- **Field Names**: Fields containing "secret"
- **Redaction**: `[REDACTED]`
- **Example**: `{ clientSecret: "abc123" }` → `{ clientSecret: "[REDACTED]" }`

## Implementation Details

### Logger Configuration

The PII redaction is implemented as a custom Winston format in `src/config/logger.ts`:

```typescript
const piiRedactionFormat = winston.format((info) => {
  // Redacts sensitive data from log entries
  // Handles both string patterns and field names
  return redactedInfo;
});
```

### Redaction Strategy

1. **Field Name Matching**: Checks object property names for sensitive keywords
2. **Pattern Matching**: Uses regex patterns to find sensitive data in strings
3. **Recursive Processing**: Handles nested objects and arrays
4. **Circular Reference Protection**: Prevents infinite loops with circular objects

### Performance Considerations

- **Shallow Copying**: Uses shallow copying to avoid deep cloning overhead
- **Depth Limiting**: Prevents infinite recursion with a maximum depth of 10
- **Circular Detection**: Uses WeakSet to track processed objects efficiently

## Usage

The PII redaction is automatically applied to all log entries when using the configured logger:

```javascript
import logger from '../config/logger';

// These will be automatically redacted
logger.info('User login', { 
  email: 'user@example.com',      // → [REDACTED]
  password: 'secret123',          // → [REDACTED]
  token: 'abc123...'             // → [REDACTED]
});

logger.info('User user@test.com logged in'); // → User [REDACTED] logged in
```

## Testing

Comprehensive tests are available in `tests/logger.test.ts` covering:

- Email redaction in messages and objects
- Token and API key redaction
- Password field redaction
- Nested object handling
- Array processing
- Edge cases (null values, circular references, deep nesting)

Run tests with:
```bash
npm test -- --testPathPatterns=logger.test.ts
```

## Security Benefits

1. **Compliance**: Helps meet GDPR, CCPA, and other privacy regulations
2. **Data Protection**: Prevents accidental exposure of sensitive data in logs
3. **Audit Trail**: Maintains useful debugging information while protecting PII
4. **Automatic**: No manual intervention required - works transparently

## Configuration

The redaction patterns and field names can be customized by modifying the `SENSITIVE_FIELDS` configuration and field matching logic in `src/config/logger.ts`.

## Limitations

- **Performance Impact**: Adds processing overhead to log operations
- **Pattern Matching**: May occasionally redact non-sensitive data that matches patterns
- **Field Name Dependency**: Relies on consistent naming conventions for field-based redaction

## Best Practices

1. **Test Thoroughly**: Verify redaction works for your specific data patterns
2. **Monitor Performance**: Watch for any performance impact in high-volume logging scenarios
3. **Review Patterns**: Regularly review and update redaction patterns as needed
4. **Document Exceptions**: Clearly document any fields that should not be redacted