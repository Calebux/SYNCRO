# SDK Observability - Logger Interface Implementation

## Summary

Successfully implemented a structured logging interface for SDK observability, enabling consumers to inspect request lifecycle, retry attempts, event listener reconnects, and batch execution progress.

## Implementation Details

### 1. Logger Interface (`src/logger.ts`)

Defined a clean Logger interface with four core methods:

- `info(message: string, meta?: Record<string, unknown>)` - Informational messages
- `warn(message: string, meta?: Record<string, unknown>)` - Warning messages
- `error(message: string, meta?: Record<string, unknown>)` - Error messages
- `debug(message: string, meta?: Record<string, unknown>)` - Debug-level messages

### 2. Default Implementations

#### Silent Logger (Production Safe)

```typescript
export const silentLogger: Logger
```

- No console output
- Safe for production environments
- Used by default when no logger is provided

#### Console Logger (Development)

```typescript
export function createConsoleLogger(): Logger
```

- Outputs messages to console with level-based prefixes (`[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]`)
- Useful for development and debugging

### 3. SDK Integration

The `Logger` type is exported from `@syncro/sdk` and can be used with v3 payments utilities:

```typescript
import { createConsoleLogger, type Logger } from '@syncro/sdk';
```

#### Logging Points in v3 Payments API

- **Gateway Calls**
  - Logs request start with idempotency key
  - Logs retry attempts with attempt number and delay
  - Logs successful payment settlement
  - Logs gateway errors with error code and retryability

- **Receipt Verification**
  - Logs verification start with receipt ID
  - Logs successful verification
  - Logs verification failures with check name and expected/actual values

- **Event Listener**
  - Logs listener start with contract count and RPC URL
  - Logs events received with count and ledger range
  - Logs reconnection attempts and backoff delays

- **Batch Operations**
  - Logs batch start with total operation count
  - Logs individual operation execution (debug level)
  - Logs operation failures with error details
  - Logs batch completion with success/failure counts

### 4. Event Listener Integration (`src/event-listener.ts`)

#### Configuration

`ListenToEventsOptions` includes:

```typescript
logger?: Logger | undefined;
```

#### Logging Points

- **Listener Lifecycle**
  - Logs listener start with contract count and RPC URL
  - Logs listener stop

- **Event Processing**
  - Logs events received with count, ledger range
  - Debug logs for individual operation tracking

- **Failure & Reconnection**
  - Logs poll failures with attempt count and max attempts
  - Logs reconnection backoff delays
  - Includes error messages for debugging

### 5. Batch Operations Integration (`src/batch-operations.ts`)

#### Function Signature

```typescript
export async function runBatch<T, K = string>(
  ids: K[],
  operation: (id: K) => Promise<{ success: boolean; data?: T; error?: string }>,
  logger?: Logger,
): Promise<BatchResult<T, K>>
```

#### Logging Points

- **Execution Lifecycle**
  - Logs batch start with total operation count
  - Logs individual operation execution (debug level)
  - Logs operation failures with error details
  - Logs batch completion with success/failure counts

### 6. Comprehensive Test Coverage

#### Logger Unit Tests (`src/logger.test.ts`)

- 10 tests covering all logger implementations
- Silent logger test confirming no output
- Console logger test validating format and output
- Composite logger test verifying delegation to multiple loggers

#### Event Listener Logging

- Listener lifecycle logging
- Event processing logging
- Failure & reconnection logging

#### Batch Operations Logging

- Execution lifecycle logging
- Individual operation logging
- Completion logging

## Usage Examples

### Basic Usage with Console Logger

```typescript
import { createConsoleLogger, type Logger } from '@syncro/sdk';

const logger = createConsoleLogger();
```

### Custom Logger Implementation

```typescript
const customLogger: Logger = {
  info: (msg, meta) => sendToMonitoringService('info', msg, meta),
  warn: (msg, meta) => sendToMonitoringService('warn', msg, meta),
  error: (msg, meta) => sendToMonitoringService('error', msg, meta),
  debug: (msg, meta) => console.debug(msg, meta),
};
```

### Event Listener with Logger

```typescript
import { createEventListener, createConsoleLogger } from '@syncro/sdk';

const listener = createEventListener(
  {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractIds: ['CABC...'],
    logger: createConsoleLogger(),
  },
  (event) => console.log('Event:', event)
);
```

### Batch Operations with Logger

```typescript
import { runBatch, createConsoleLogger } from '@syncro/sdk';

const results = await runBatch(
  paymentIds,
  async (id) => {
    // operation code
  },
  createConsoleLogger()
);
```

### Production Setup with Silent Logger (Default)

```typescript
import { createConsoleLogger } from '@syncro/sdk';

// logger defaults to silentLogger - no console output
const logger = createConsoleLogger();
```

## Acceptance Criteria Met

✅ Define Logger interface with info(), warn(), error(), debug()
✅ Allow injection of custom logger during SDK usage
✅ Default to silent logger (no console.log in production)
✅ Log gateway call retries with idempotency keys
✅ Log event listener failures with reconnection tracking
✅ Log batch execution start/finish with success/failure counts
✅ Add tests ensuring logger is called correctly

## Files Created/Modified

### Created
- `src/logger.ts` - Logger interface and implementations
- `src/logger.test.ts` - 10 unit tests for logger

### Modified
- `src/types.ts` - Added Logger type export
- `src/event-listener.ts` - Added logger support and logging
- `src/batch-operations.ts` - Added logger support and logging

## Running Tests

```bash
# Run all logger tests
NODE_OPTIONS='--experimental-vm-modules' npm jest src/logger*.test.ts

# Run specific test file
NODE_OPTIONS='--experimental-vm-modules' npm jest src/logger.test.ts
```
