# Rate Limiting Documentation

## Overview

The SYNCRO backend implements comprehensive rate limiting to protect against brute force attacks, email spam, and API abuse. Rate limiting is applied to authentication-related endpoints using `express-rate-limit` with Redis backing for persistence and multi-instance support.

## Protected Endpoints

### Team Invitation Endpoints
- **Endpoint**: `POST /api/team/invite`
- **Limit**: 20 requests per hour per user
- **Purpose**: Prevents email spam through team invitations
- **Key**: User ID (authenticated requests only)

### MFA Endpoints
- **Endpoints**: 
  - `POST /api/2fa/recovery-codes/generate`
  - `POST /api/2fa/recovery-codes/verify`
- **Limit**: 10 requests per 15 minutes per user
- **Purpose**: Prevents brute force attacks on MFA operations
- **Key**: User ID (authenticated requests only)

### Admin Endpoints
- **Endpoints**: All `/api/admin/*` endpoints
- **Limit**: 100 requests per hour per IP address
- **Purpose**: Prevents API key brute force attacks
- **Key**: IP address

## Configuration

### Environment Variables

```bash
# Redis Configuration (optional)
RATE_LIMIT_REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_ENABLED=true

# Team Invitation Limits
RATE_LIMIT_TEAM_INVITE_MAX=20
RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS=1

# MFA Limits
RATE_LIMIT_MFA_MAX=10
RATE_LIMIT_MFA_WINDOW_MINUTES=15

# Admin Limits
RATE_LIMIT_ADMIN_MAX=100
RATE_LIMIT_ADMIN_WINDOW_HOURS=1
```

### Default Values

| Setting | Default Value | Description |
|---------|---------------|-------------|
| `RATE_LIMIT_TEAM_INVITE_MAX` | 20 | Maximum team invitations per window |
| `RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS` | 1 | Time window in hours |
| `RATE_LIMIT_MFA_MAX` | 10 | Maximum MFA attempts per window |
| `RATE_LIMIT_MFA_WINDOW_MINUTES` | 15 | Time window in minutes |
| `RATE_LIMIT_ADMIN_MAX` | 100 | Maximum admin requests per window |
| `RATE_LIMIT_ADMIN_WINDOW_HOURS` | 1 | Time window in hours |
| `RATE_LIMIT_REDIS_ENABLED` | `true` if URL provided | Enable Redis backing |

## Redis Integration

### Benefits of Redis Backing
- **Persistence**: Rate limits survive server restarts
- **Multi-instance**: Shared state across multiple server instances
- **Performance**: Efficient storage and retrieval of rate limit data

### Fallback Behavior
When Redis is unavailable:
1. System automatically falls back to in-memory rate limiting
2. Warning is logged about the fallback
3. Rate limiting continues to function normally
4. Automatic reconnection attempts are made

### Redis Health Monitoring
The system provides health status for Redis connections:
```typescript
const status = RateLimiterFactory.getStoreStatus();
// Returns: { type: 'redis' | 'memory', available: boolean }
```

## HTTP Headers

### Standard Rate Limiting Headers
All rate-limited responses include standard headers:

- `X-RateLimit-Limit`: Maximum requests allowed in the time window
- `X-RateLimit-Remaining`: Number of requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when the rate limit resets

### Rate Limit Exceeded (429 Response)
When rate limits are exceeded:
- `Retry-After`: Seconds to wait before making another request
- `X-RateLimit-Policy`: Type of rate limit that was exceeded
- `X-Security-Event`: Set to "rate-limit-exceeded" for security monitoring

## Error Responses

### Team Invitation Rate Limit
```json
{
  "error": "Too many team invitations. You can send up to 20 invitations per 1 hour. Please try again later."
}
```

### MFA Rate Limit
```json
{
  "error": "Too many MFA attempts. You can make up to 10 attempts per 15 minutes. Please try again later."
}
```

### Admin Rate Limit
```json
{
  "error": "Too many admin requests. You can make up to 100 requests per 1 hour. Please try again later."
}
```

## Security Features

### Security Event Logging
Rate limit violations are logged with detailed information:
```json
{
  "type": "rate_limit_exceeded",
  "endpoint": "team-invite",
  "userId": "user-123",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "path": "/api/team/invite",
  "method": "POST"
}
```

### Key Generation Strategies
- **User-based**: Uses authenticated user ID for personalized limits
- **IP-based**: Uses client IP address for anonymous or admin endpoints
- **Fallback**: Falls back to IP when user ID is unavailable

## Operational Considerations

### Monitoring
Monitor these metrics for rate limiting health:
- Rate limit violation frequency
- Redis connection status
- Memory vs Redis store usage
- Response time impact

### Scaling
- Redis-backed rate limiting scales horizontally
- Memory store is per-instance only
- Consider Redis clustering for high availability

### Performance Impact
- Redis operations add ~1-2ms latency per request
- Memory store has negligible performance impact
- Rate limiting middleware executes early in request pipeline

## Troubleshooting

### Common Issues

#### Redis Connection Failures
**Symptoms**: Warnings about memory store fallback
**Solution**: Check Redis connectivity and configuration

#### Rate Limits Too Restrictive
**Symptoms**: Legitimate users getting 429 responses
**Solution**: Adjust environment variables and restart

#### Rate Limits Not Working
**Symptoms**: No rate limiting observed
**Solution**: Verify middleware is applied to endpoints

### Debug Information
Enable debug logging to see rate limiting decisions:
```bash
DEBUG=rate-limit:* npm run dev
```

## Development

### Testing Rate Limits
Use the provided test utilities:
```bash
npm test -- rate-limiting-integration.test.ts
```

### Custom Rate Limiters
Create custom rate limiters for specific needs:
```typescript
const customLimiter = RateLimiterFactory.createCustomLimiter({
  windowMs: 60000, // 1 minute
  max: 5,
  message: { error: 'Custom rate limit exceeded' },
  endpointType: 'custom',
});
```

## Security Best Practices

1. **Monitor Rate Limit Violations**: Set up alerts for unusual patterns
2. **Adjust Limits Based on Usage**: Review and tune limits regularly
3. **Use Redis in Production**: Ensure persistence and multi-instance support
4. **Log Security Events**: Maintain audit trails for security analysis
5. **Test Fallback Behavior**: Verify system works when Redis is unavailable

## Migration Guide

### From No Rate Limiting
1. Deploy with conservative limits
2. Monitor for false positives
3. Adjust limits based on legitimate usage patterns
4. Enable Redis for production deployments

### Updating Limits
1. Update environment variables
2. Restart application instances
3. Monitor for impact on legitimate users
4. Document changes for operational team