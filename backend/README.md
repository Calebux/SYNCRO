# Synchro Backend

The backend service for Synchro, a self-custodial subscription management platform. This Express.js server handles API endpoints, authentication, payment processing, and integrations with external services.

## Overview

The backend is responsible for:
- **API Endpoints**: RESTful API for subscription management, user authentication, and analytics
- **Authentication**: User registration, login, and session management
- **Email Integration**: Gmail and Outlook scanning for subscription detection
- **Payment Processing**: Integration with Stripe and Paystack for payment handling
- **Notifications**: Telegram bot integration for subscription reminders
- **Data Persistence**: Database operations for subscriptions, users, and related data

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js 5.2.1
- **Language**: JavaScript/TypeScript (to be determined)
- **Database**: To be configured (PostgreSQL recommended)
- **Authentication**: JWT tokens with HTTP-only cookies
- **Payment Providers**: Stripe, Paystack
- **External Services**: Gmail API, Microsoft 365 API, Telegram Bot API

## Project Structure

```
backend/
├── node_modules/
├── package.json
├── package-lock.json
└── .gitignore
```

## Current State

### ✅ Implemented
- Basic Express.js setup
- Package configuration with Express dependency

### ❌ Not Implemented
- API route handlers
- Database connection and models
- Authentication middleware
- Email scanning services
- Payment processing endpoints
- Telegram bot integration
- Error handling middleware
- Request validation

### ✅ Security Features
- **Rate Limiting**: Comprehensive rate limiting on authentication endpoints
  - Team invitations: 20/hour per user
  - MFA operations: 10/15min per user  
  - Admin endpoints: 100/hour per IP
  - Redis-backed with memory fallback
  - Standard HTTP headers and security logging
- CORS configuration
- Environment variable management

## Setup

### Prerequisites
- Node.js 20+ installed
- npm or yarn package manager

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Create a `.env` file in the backend directory:

```bash
# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/synchro

# Authentication
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# Gmail Integration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/gmail/callback

# Microsoft 365 / Outlook Integration
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=your_tenant_id
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/integrations/outlook/callback

# Payment Providers
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYSTACK_SECRET_KEY=sk_test_...

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Encryption (for API keys)
ENCRYPTION_KEY=your_32_byte_encryption_key

# Rate Limiting (optional)
RATE_LIMIT_REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_ENABLED=true
RATE_LIMIT_TEAM_INVITE_MAX=20
RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS=1
RATE_LIMIT_MFA_MAX=10
RATE_LIMIT_MFA_WINDOW_MINUTES=15
RATE_LIMIT_ADMIN_MAX=100
RATE_LIMIT_ADMIN_WINDOW_HOURS=1

# Soroban / Stellar (Blockchain)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ADDRESS=YOUR_DEPLOYED_CONTRACT_ADDRESS
STELLAR_SECRET_KEY=SB.........................YOUR_TESTNET_SECRET
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

## Development

### Running the Server

```bash
npm start
# or for development with auto-reload
npm run dev
```

### API Endpoints (To Be Implemented)

#### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh authentication token

#### Subscriptions
- `GET /api/subscriptions` - List all subscriptions
- `POST /api/subscriptions` - Create new subscription
- `GET /api/subscriptions/:id` - Get subscription by ID
- `PATCH /api/subscriptions/:id` - Update subscription
- `DELETE /api/subscriptions/:id` - Delete subscription
- `POST /api/subscriptions/bulk` - Bulk operations

#### Email Accounts
- `GET /api/email-accounts` - List connected email accounts
- `POST /api/email-accounts` - Connect new email account
- `DELETE /api/email-accounts/:id` - Disconnect email account
- `POST /api/email-accounts/:id/scan` - Trigger email scan

#### Integrations
- `GET /api/integrations/gmail/auth` - Gmail OAuth redirect
- `POST /api/integrations/gmail/callback` - Gmail OAuth callback
- `POST /api/integrations/gmail/scan` - Scan Gmail for subscriptions
- `GET /api/integrations/outlook/auth` - Outlook OAuth redirect
- `POST /api/integrations/outlook/callback` - Outlook OAuth callback
- `POST /api/integrations/outlook/scan` - Scan Outlook for subscriptions

#### Payments
- `POST /api/payments/stripe/checkout` - Create Stripe checkout session
- `POST /api/payments/stripe/webhook` - Stripe webhook handler
- `POST /api/payments/paystack/initialize` - Initialize Paystack payment
- `POST /api/payments/paystack/verify` - Verify Paystack payment

#### Notifications
- `GET /api/notifications` - List notifications
- `PATCH /api/notifications/:id` - Mark notification as read
- `DELETE /api/notifications/:id` - Delete notification
- `POST /api/notifications/telegram` - Send Telegram notification

#### Analytics
- `GET /api/analytics/dashboard` - Dashboard statistics
- `GET /api/analytics/spending` - Spending trends
- `GET /api/analytics/forecast` - Spending forecast

## Implementation Roadmap

### Phase 1: Core Infrastructure
1. Set up Express server with middleware
2. Configure database connection (PostgreSQL)
3. Implement authentication system
4. Create basic API route structure
5. Add error handling middleware
6. Configure CORS and security headers

### Phase 2: Core Features
1. User authentication endpoints
2. Subscription CRUD operations
3. Database models and migrations
4. Request validation
5. Rate limiting

### Phase 3: Integrations
1. Gmail API integration
2. Microsoft 365 / Outlook integration
3. Stripe payment processing
4. Paystack payment processing
5. Telegram bot integration

### Phase 4: Advanced Features
1. Email scanning and parsing
2. Subscription detection algorithms
3. Notification system
4. Analytics and reporting
5. Webhook handling

## Security Considerations

- Use HTTP-only cookies for authentication tokens
- Implement rate limiting on all endpoints
- Validate and sanitize all user inputs
- Use parameterized queries to prevent SQL injection
- Encrypt sensitive data (API keys, tokens)
- Verify webhook signatures
- Implement CORS properly
- Use environment variables for all secrets
- Add request logging and monitoring

## Testing

Testing setup to be implemented:

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Blockchain Fallback Behavior

- When `SOROBAN_CONTRACT_ADDRESS` or `STELLAR_SECRET_KEY` is not configured, blockchain writes are skipped and events are stored only in the `blockchain_logs` table with `status="pending"` (later updated to `confirmed` only if an on-chain write occurs).
- If Soroban RPC is unavailable or repeated submission attempts fail, the service retries with exponential backoff (3 attempts by default). After exhausting retries:
  - If `REDIS_URL` is set, the failed payload is pushed to a Redis DLQ list `dlq:blockchain_tx` for later reprocessing.
  - If Redis is not available, a dead letter entry is recorded in `blockchain_logs` with `event_type="blockchain_dead_letter"` and `status="dead_letter"`.

## Deployment

### Recommended Platforms
- **Render** (current reference: `backend-ai-sub.onrender.com`)
- **Railway**
- **Heroku**
- **AWS EC2 / ECS**
- **DigitalOcean App Platform**

### Environment Setup
1. Set all required environment variables
2. Configure database connection
3. Set up SSL/TLS certificates
4. Configure domain and DNS
5. Set up monitoring and logging

## Dependencies

Current dependencies:
- `express`: ^5.2.1

Additional dependencies to be added:
- Database driver (e.g., `pg` for PostgreSQL)
- Authentication (e.g., `jsonwebtoken`, `bcrypt`)
- Validation (e.g., `joi` or `zod`)
- Email parsing (e.g., `mailparser`)
- HTTP client (e.g., `axios`)
- Environment variables (e.g., `dotenv`)

## Related Documentation

- See `/client/BACKEND_DOCUMENTATION.md` for detailed API specifications
- See `/client/New_Backend_Api_documentation.md` for API endpoint details
- See `/backend/docs/RATE_LIMITING.md` for comprehensive rate limiting documentation
- See main `/README.md` for project overview

## Notes

- The backend is currently in early development stage
- Most functionality needs to be implemented
- API structure should align with the frontend client expectations
- Consider using TypeScript for better type safety
- Follow RESTful API design principles
- Implement proper error handling and logging

