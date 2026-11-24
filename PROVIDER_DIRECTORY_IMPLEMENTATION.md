# Provider Directory - 1% Implementation

## Overview

This PR implements the first 1% of a searchable provider directory for SYNCRO, enabling agents to discover paid APIs by category, unit, asset, and price. Providers explicitly opt in to appear in search results.

## What Was Implemented

### Core Directory Service

**File**: `backend/src/v3/directory-service.ts` (~350 lines)

**Key Features**:
- ✅ Explicit opt-in/opt-out mechanism
- ✅ Category-based filtering
- ✅ Asset filtering (default: USDC)
- ✅ Mode filtering (staging/production)
- ✅ Pagination support (max 100 per page)
- ✅ Basic reliability stats (uptime, route count, avg response time)
- ✅ Payout verification requirement (security)
- ✅ Sample route display with pricing

**Data Structures**:
```typescript
interface DirectoryEntry {
  providerId: string;
  identity: string;
  mode: 'staging' | 'production';
  description?: string;
  categories: string[];
  acceptedAssets: string[];
  stats: ProviderStats;
  sampleRoutes: DirectoryRoute[];
  contact?: ContactInfo;
  listedAt: string;
}
```

### RESTful API Routes

**File**: `backend/src/routes/directory.ts` (~200 lines)

**Public Endpoints** (Read-only, no auth):
- `GET /api/v3/directory` - Query providers with filters
- `GET /api/v3/directory/categories` - Get available categories
- `GET /api/v3/directory/:providerId` - Get specific provider entry

**Provider-Authenticated Endpoints** (Requires x-provider-key):
- `POST /api/v3/directory/opt-in` - Join the directory
- `POST /api/v3/directory/opt-out` - Leave the directory
- `GET /api/v3/directory/my-listing` - View own listing

### Test Suite

**File**: `backend/src/v3/__tests__/directory-service.test.ts` (~300 lines)

**Coverage**:
- Opt-in validation and payout verification
- Opt-out functionality
- Category filtering
- Mode filtering
- Pagination
- Entry retrieval
- Category aggregation
- Stats generation

## Usage Examples

### Agent Discovers Providers

```bash
# Query all AI providers accepting USDC
curl 'https://api.syncro.dev/api/v3/directory?category=ai&asset=USDC'

# Response
{
  "data": [
    {
      "providerId": "uuid-123",
      "identity": "acme-ai",
      "mode": "production",
      "description": "GPT-4 and Claude inference APIs",
      "categories": ["ai", "ml", "nlp"],
      "acceptedAssets": ["USDC"],
      "stats": {
        "routeCount": 12,
        "uptime": 99.5,
        "callsLast30Days": 50000,
        "avgResponseTimeMs": 250
      },
      "sampleRoutes": [
        {
          "method": "POST",
          "pathPattern": "/v1/chat/completions",
          "unit": "token",
          "priceStroops": 10,
          "description": "GPT-4 chat endpoint"
        }
      ],
      "contact": {
        "website": "https://acme.ai",
        "email": "support@acme.ai"
      },
      "listedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 20,
    "total": 1
  }
}
```

### Provider Opts Into Directory

```bash
# Provider registers first
curl -X POST 'https://api.syncro.dev/api/v3/providers' \
  -H 'Content-Type: application/json' \
  -d '{
    "identity": "acme-ai",
    "payoutAddress": "GXXX...",
    "upstreamBaseUrl": "https://api.acme.ai",
    "agreementTerms": "Standard terms",
    "mode": "production"
  }'

# Response includes providerSecret
{
  "data": {
    "providerId": "uuid-123",
    "providerSecret": "secret-key-456",
    ...
  }
}

# Provider verifies payout (required before opt-in)
curl -X POST 'https://api.syncro.dev/api/v3/providers/uuid-123/payout-verify' \
  -H 'x-provider-key: secret-key-456' \
  -d '{ "signature": "..." }'

# Provider opts into directory
curl -X POST 'https://api.syncro.dev/api/v3/directory/opt-in' \
  -H 'Content-Type: application/json' \
  -H 'x-provider-key: secret-key-456' \
  -d '{
    "description": "GPT-4 and Claude inference APIs",
    "categories": ["ai", "ml", "nlp"],
    "contact": {
      "website": "https://acme.ai",
      "email": "support@acme.ai",
      "discord": "https://discord.gg/acme"
    }
  }'

# Response confirms listing
{
  "data": {
    "providerId": "uuid-123",
    "optedIn": true,
    "categories": ["ai", "ml", "nlp"],
    "optedInAt": "2024-01-15T10:00:00Z"
  }
}
```

### Provider Views Own Listing

```bash
curl 'https://api.syncro.dev/api/v3/directory/my-listing' \
  -H 'x-provider-key: secret-key-456'

# Shows exactly what agents see
{
  "data": {
    "providerId": "uuid-123",
    "identity": "acme-ai",
    ...
  }
}
```

### Provider Opts Out

```bash
curl -X POST 'https://api.syncro.dev/api/v3/directory/opt-out' \
  -H 'x-provider-key: secret-key-456'

# Provider immediately removed from search results
{
  "success": true,
  "message": "Provider removed from directory"
}
```

## Query Parameters

**GET /api/v3/directory**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `category` | string | Filter by service category | - |
| `asset` | string | Filter by accepted asset | USDC |
| `mode` | enum | staging or production | - |
| `offset` | number | Pagination offset | 0 |
| `limit` | number | Results per page (max 100) | 20 |

## Security Features

1. **Payout Verification Required**: Providers must verify payout address before opting in
2. **Provider Authentication**: Opt-in/out requires x-provider-key header
3. **No Sensitive Data**: Provider secrets never exposed in directory
4. **Opt-in Only**: Providers don't appear by default
5. **Immediate Opt-out**: Providers can remove themselves instantly

## Acceptance Criteria Met

From the original issue:

- ✅ **Agents can query by category**: `?category=ai`
- ✅ **Agents can query by asset**: `?asset=USDC`
- ✅ **Only opted-in providers appear**: Explicit opt-in required
- ✅ **Public read-only API**: GET endpoints require no auth
- ✅ **Provider opt-in**: POST /directory/opt-in with provider auth
- ✅ **Basic reliability stats**: uptime, route count, avg response time

## Files Changed/Added

```
A  backend/src/v3/directory-service.ts              # Core service (~350 lines)
A  backend/src/routes/directory.ts                   # API routes (~200 lines)
A  backend/src/v3/__tests__/directory-service.test.ts  # Test suite (~300 lines)
A  PROVIDER_DIRECTORY_IMPLEMENTATION.md              # This documentation
```

## Current Limitations (1% Implementation)

Intentionally not implemented (future work):

- ❌ **Database persistence**: Currently in-memory (lost on restart)
- ❌ **Real uptime tracking**: Mock data for now
- ❌ **Moderation queue**: Auto-approved, no review process
- ❌ **Featured providers**: No promotion/ranking algorithm
- ❌ **Search ranking**: Simple uptime-based sort only
- ❌ **Rate limiting**: Not yet enforced (mentioned in spec)
- ❌ **Caching**: Not yet implemented
- ❌ **Full-text search**: Only exact category matching
- ❌ **Provider ratings/reviews**: No user feedback system
- ❌ **Historical stats**: Only current stats, no trends

## Design Decisions

### Why Explicit Opt-in?

Privacy and control. Providers may not want to be publicly discoverable until they're ready. Opt-in ensures:
- No accidental exposure during testing
- Providers control their visibility
- Clear consent for data sharing

### Why Require Payout Verification?

Prevents spam and fake listings. Only providers who've verified their payout address (proven control of funds) can list in the directory.

### Why In-Memory Storage?

For 1% implementation, keeps things simple. Database migration is straightforward:
- Add `directory_opt_ins` table
- Replace Map with SQL queries
- No API changes needed

### Why Mock Stats?

Real uptime tracking requires:
- Persistent time-series database
- Health check system
- Historical data aggregation

For 1% demo, mock data shows the structure.

## Integration Points

### With Existing Systems

1. **Provider Store**: Uses existing `InMemoryProviderStore` for provider data
2. **Provider Auth**: Uses existing `authenticateProvider` middleware
3. **Route Registration**: Displays routes from existing route store
4. **Payout Verification**: Checks `payoutVerified` flag before opt-in

### Future Integrations

1. **Gateway Analytics**: Pull real uptime/response time from gateway logs
2. **Receipt System**: Count successful calls from settlement records
3. **Rate Limiter**: Apply directory endpoint rate limits
4. **Cache Layer**: Add Redis caching for query results
5. **Search Service**: Integrate Algolia/Elasticsearch for full-text search

## Next Steps (Remaining 99%)

To complete full directory functionality:

### Phase 1: Persistence & Reliability (10%)
- Migrate to PostgreSQL/Supabase storage
- Implement real uptime tracking
- Add health check system
- Historical stats aggregation

### Phase 2: Search & Discovery (20%)
- Full-text search (name, description, categories)
- Fuzzy matching
- Search ranking algorithm
- Trending providers

### Phase 3: Moderation & Quality (30%)
- Admin moderation queue
- Provider verification badges
- User ratings and reviews
- Report/flag system
- Quality score calculation

### Phase 4: Performance & Scale (40%)
- Rate limiting (100 requests/min per IP)
- Redis caching (5-minute TTL)
- CDN for static listings
- Pagination cursor-based (not offset)
- Database indexes and query optimization

## Testing

```bash
cd backend

# Run directory tests
npm test -- directory-service

# Run all v3 tests
npm test -- v3

# With coverage
npm test -- --coverage directory-service
```

## Example Categories

Suggested categories for providers:

- **AI/ML**: `ai`, `ml`, `nlp`, `cv`, `speech`, `translation`
- **Data**: `data`, `analytics`, `storage`, `database`
- **Compute**: `compute`, `serverless`, `batch`, `gpu`
- **Communication**: `email`, `sms`, `voice`, `messaging`
- **Media**: `image`, `video`, `audio`, `transcoding`
- **Finance**: `payment`, `crypto`, `banking`, `exchange`
- **Developer Tools**: `api`, `testing`, `monitoring`, `deployment`

## API Rate Limiting (Planned)

**Public Endpoints**:
- 100 requests/minute per IP
- 1000 requests/hour per IP
- Burst: 20 requests/second

**Provider Endpoints**:
- 1000 requests/hour per provider key
- Burst: 100 requests/minute

## Caching Strategy (Planned)

**Directory Queries**:
- Cache TTL: 5 minutes
- Cache key: `directory:${category}:${asset}:${mode}:${offset}:${limit}`
- Invalidate on opt-in/opt-out

**Provider Entries**:
- Cache TTL: 10 minutes
- Cache key: `directory:provider:${providerId}`
- Invalidate on route changes, opt-out

**Categories**:
- Cache TTL: 30 minutes
- Cache key: `directory:categories`
- Invalidate on new opt-in with new category

## Branch

- Branch: `feature/provider-directory`
- Fork: https://github.com/coderolisa/SYNCRO.git
- Ready for PR creation

## Notes

- **TypeScript strict mode**: All types properly defined
- **Zod validation**: Input validation for all API endpoints
- **Error handling**: Proper error responses with status codes
- **Logging**: Structured logging for debugging
- **Testable**: Service layer separated from HTTP layer
- **Extensible**: Easy to add more filters, stats, features
