# Health & Readiness Probes

This document describes the expanded health check endpoints for Synchro and when to use them in deployment workflows.

## Overview

The backend exposes three health check endpoints to support Kubernetes/container orchestration and monitoring:

| Endpoint | Purpose | HTTP Status | Auth Required |
|----------|---------|-------------|---------------|
| `/health/live` | Liveness probe | 200 always | No |
| `/health/ready` | Readiness probe | 200 or 503 | No |
| `/health` | Legacy endpoint | 200 always | No |

## Liveness Probe (`/health/live`)

**Purpose**: Indicates if the process is alive and responding.

**When to use**:
- Kubernetes liveness probes (restarts container if this fails)
- Checking if the service should be restarted
- Basic "is the server running?" checks

**Response (always HTTP 200)**:
```json
{
  "status": "alive",
  "timestamp": "2026-06-25T00:00:00.000Z",
  "uptime_ms": 86400000
}
```

**Behavior**:
- ✅ No external dependencies checked
- ✅ Minimal overhead (process is alive = endpoint responds)
- ✅ Very fast response time
- ❌ Doesn't indicate if service is ready for traffic

**Deployment Use Case**:
```yaml
# Kubernetes liveness probe
livenessProbe:
  httpGet:
    path: /health/live
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

## Readiness Probe (`/health/ready`)

**Purpose**: Indicates if the service is ready to accept traffic.

**When to use**:
- Kubernetes readiness probes (remove from service traffic if this fails)
- Load balancer health checks (before routing traffic)
- Determining if service can handle requests
- Checking if critical dependencies are available

**Response (HTTP 200 if ready, 503 if not)**:
```json
{
  "status": "ready",
  "timestamp": "2026-06-25T00:00:00.000Z",
  "message": "All critical dependencies healthy",
  "dependencies": [
    {
      "name": "database",
      "status": "healthy",
      "latency_ms": 5
    },
    {
      "name": "redis",
      "status": "healthy",
      "latency_ms": 2
    },
    {
      "name": "queue",
      "status": "healthy",
      "latency_ms": 1
    },
    {
      "name": "providers",
      "status": "healthy",
      "latency_ms": 0
    }
  ]
}
```

**Not Ready Response (HTTP 503)**:
```json
{
  "status": "not_ready",
  "timestamp": "2026-06-25T00:00:00.000Z",
  "message": "Critical dependencies unhealthy: database",
  "dependencies": [
    {
      "name": "database",
      "status": "unhealthy",
      "latency_ms": 30,
      "error": "Connection timeout"
    },
    {
      "name": "redis",
      "status": "healthy",
      "latency_ms": 2
    }
  ]
}
```

**Critical vs. Optional Dependencies**:
- **Critical** (readiness blocks): Database, Redis
- **Optional** (degraded allowed): Queue, Providers

**Behavior**:
- ✅ Checks critical dependencies (database, Redis)
- ✅ Returns 503 if critical deps are unhealthy
- ✅ Allows degraded state for non-critical services
- ❌ Slightly higher latency than liveness probe

**Deployment Use Case**:
```yaml
# Kubernetes readiness probe
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 2
```

## Checked Dependencies

### Database (Critical)
- Connection to Supabase/PostgreSQL
- Executes lightweight query (table count)
- **Failure impact**: Service cannot read/write data → not ready

### Redis (Critical)
- Connection to Redis instance
- Executes PING command
- **Failure impact**: Caching, rate limiting, session management down → not ready

### Queue (Optional)
- Connection to Bull queue (Redis-backed)
- Validated through Redis connectivity
- **Failure impact**: Async jobs delayed but service still functional

### Providers (Optional)
- Checks if external services are configured (Stripe, Gmail, Outlook, Telegram, Stellar)
- No actual API calls (lightweight check)
- **Failure impact**: Some features unavailable but service functional

## Recommended Kubernetes Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: syncro-backend
spec:
  template:
    spec:
      containers:
      - name: backend
        image: syncro-backend:latest
        ports:
        - containerPort: 3001
        
        # Liveness: restart if process dies
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        # Readiness: only receive traffic if ready
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 2
        
        # Startup: give container time to initialize
        startupProbe:
          httpGet:
            path: /health/ready
            port: 3001
          periodSeconds: 5
          failureThreshold: 12  # 60 seconds total
```

## Docker Compose Example

```yaml
services:
  backend:
    image: syncro-backend:latest
    ports:
      - "3001:3001"
    healthcheck:
      # Use readiness for overall service health
      test: ["CMD", "curl", "-f", "http://localhost:3001/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 2
      start_period: 30s
    depends_on:
      - postgres
      - redis
```

## Load Balancer Configuration (AWS ELB/ALB)

```
Health Check Configuration:
- Path: /health/ready
- Protocol: HTTP
- Port: 3001
- Healthy Threshold: 2
- Unhealthy Threshold: 3
- Interval: 30s
- Timeout: 5s
- Expected HTTP Code: 200
```

## Monitoring & Alerting

### Alert when readiness fails
```
Alert: "Backend not ready" 
Condition: GET /health/ready returns 503 for > 5 minutes
Action: Page on-call engineer, check logs for dependency issues
```

### Alert on latency increase
```
Alert: "Slow health check"
Condition: /health/ready response time > 2 seconds
Action: Check database, Redis, queue performance
```

## Testing Locally

```bash
# Check liveness
curl http://localhost:3001/health/live
# Response: HTTP 200

# Check readiness
curl http://localhost:3001/health/ready
# Response: HTTP 200 (all ready) or HTTP 503 (not ready)

# Check specific dependency
curl http://localhost:3001/health/ready | jq '.dependencies[] | select(.name=="database")'
```

## Development vs. Production

### Development Environment
- `/health/live` and `/health/ready` available without authentication
- May have degraded dependencies (optional providers) but still ready
- Use for local testing before commit

### Production Environment
- `/health/live` and `/health/ready` available without authentication
- Critical dependencies must be healthy
- Use in load balancer and orchestration
- Monitor readiness failures as service incidents

## Backwards Compatibility

The legacy `/health` endpoint still exists and returns:
```json
{
  "status": "ok",
  "timestamp": "2026-06-25T00:00:00.000Z",
  "deprecated": true
}
```

**Migration path**:
1. Update deployment configs to use `/health/live` and `/health/ready`
2. Remove dependency on `/health` endpoint
3. Deprecate `/health` in next major release

## Implementation Details

### Dependency Health Service

The `DependencyHealthService` class handles all health checks:

```typescript
import { dependencyHealthService } from './services/dependency-health-service';

// Get liveness status
const liveness = dependencyHealthService.getLiveness();

// Get readiness status
const readiness = await dependencyHealthService.getReadiness();

// Get individual dependency status
const allDeps = await dependencyHealthService.checkAllDependencies();
```

### Adding New Dependency Checks

To add a new dependency check:

1. Add a `check<Service>()` method to `DependencyHealthService`
2. Include it in `checkAllDependencies()`
3. Classify as critical or optional
4. Update this document with dependency details

Example:
```typescript
async checkPostgres(): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    // Your check implementation
    return { name: 'postgres', status: 'healthy', latency_ms: ... };
  } catch (error) {
    return { name: 'postgres', status: 'unhealthy', error: ... };
  }
}
```

## Related

- [Health Service](../../backend/src/services/health-service.ts) - Admin health metrics
- [Dependency Health Service](../../backend/src/services/dependency-health-service.ts) - Probe implementation
- Issue #700: Expand health and readiness endpoints
