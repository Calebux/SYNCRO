# SubSync AI - Backend Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [What's Implemented](#whats-implemented)
4. [What's In Progress](#whats-in-progress)
5. [Database Schema](#database-schema)
6. [API Routes](#api-routes)
7. [Authentication & Authorization](#authentication--authorization)
8. [Security Features](#security-features)
9. [Integration Points](#integration-points)
10. [Deployment Guide](#deployment-guide)

---

## Architecture Overview

SubSync AI is built as a full-stack Next.js 15 application using the App Router with:
- **Frontend**: React 19 with TypeScript, Tailwind CSS v4
- **Backend**: Next.js API Routes (serverless functions)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Payments**: Stripe
- **Hosting**: Vercel

### Current State
- **Frontend**: ✅ Implemented
- **Backend**: ✅ Production-ready Express.js API (30+ services, 24 route modules)
- **Database**: ✅ Connected via Supabase with RLS policies enforced
- **Authentication**: ✅ JWT + HTTP-only cookies, RBAC enforced on all protected routes
- **Integrations**: ✅ Gmail, Outlook, Telegram, Slack, Stripe, Paystack — all implemented

---

## Tech Stack

### Core Technologies
\`\`\`json
{
  "runtime": "Node.js 20+",
  "framework": "Next.js 15.1.6",
  "language": "TypeScript 5.x",
  "database": "PostgreSQL (via Supabase)",
  "orm": "None (using Supabase client directly)",
  "authentication": "Supabase Auth",
  "payments": "Stripe",
  "deployment": "Vercel"
}
\`\`\`

### Key Dependencies
\`\`\`json
{
  "@supabase/ssr": "^0.5.2",
  "@supabase/supabase-js": "^2.47.10",
  "stripe": "^17.5.0",
  "date-fns": "^4.1.0",
  "recharts": "^2.15.0",
  "react": "19.0.0",
  "next": "15.1.6"
}
\`\`\`

---

## What's Implemented ✅

### 1. Database Schema (Ready but Not Connected)

**Location**: `/scripts/*.sql`

All tables are defined with Row Level Security (RLS) policies:

#### Tables Created:
- ✅ `profiles` - User profile information
- ✅ `email_accounts` - Connected email accounts
- ✅ `subscriptions` - Main subscription data
- ✅ `team_members` - Team collaboration
- ✅ `notifications` - User notifications

**Status**: SQL scripts exist but need to be executed on Supabase instance.

### 2. Authentication Pages

**Location**: `/app/auth/*`

- ✅ `/auth/login` - Login page with email/password
- ✅ `/auth/sign-up` - Registration page
- ✅ `/auth/sign-up-success` - Post-registration confirmation
- ✅ `/auth/error` - Error handling page

**Status**: UI complete, but not enforced (users can access app without login).

### 3. Supabase Client Utilities

**Location**: `/lib/supabase/*`

- ✅ `browser-client.ts` - Client-side Supabase singleton
- ✅ `server-client.ts` - Server-side Supabase singleton
- ✅ `middleware.ts` - Session refresh utilities
- ✅ `subscriptions.ts` - CRUD operations for subscriptions

**Status**: Code exists but has environment variable issues (typo: `proSUPABASE_...`).

### 4. Security Features

**Location**: `/lib/security/*`, `/middleware.ts`

- ✅ CSRF token generation and verification
- ✅ Rate limiting (client-side)
- ✅ Input sanitization utilities
- ✅ Session timeout management
- ✅ Security headers in middleware
- ✅ Password hashing utilities

**Status**: Utilities exist but not integrated into API routes.

### 5. Business Logic Utilities

**Location**: `/lib/*`

- ✅ `duplicate-detection.ts` - Fuzzy matching for duplicates
- ✅ `price-tracking.ts` - Price change detection
- ✅ `currency-utils.ts` - Multi-currency support
- ✅ `timezone-utils.ts` - UTC/local timezone conversion
- ✅ `validation.ts` - Input validation
- ✅ `csv-utils.ts` - CSV export with injection prevention
- ✅ `audit-log.ts` - Audit logging utilities
- ✅ `network-utils.ts` - Retry logic with exponential backoff
- ✅ `cache-utils.ts` - Client-side caching
- ✅ `performance-utils.ts` - Debounce, throttle, memoization

**Status**: All utilities implemented and working with mock data.

### 6. Frontend Features (Complete)

- ✅ Dashboard with analytics
- ✅ Subscription management (CRUD)
- ✅ Team management
- ✅ Notifications panel
- ✅ Settings page
- ✅ Onboarding flow
- ✅ Command palette (Ctrl+K)
- ✅ Keyboard shortcuts
- ✅ Dark mode
- ✅ Responsive design
- ✅ Accessibility features

**Status**: Fully functional with in-memory mock data.

---

## What's In Progress

### Stellar Mainnet
Blockchain writes are currently configured for Stellar Testnet. Mainnet support is blocked on mainnet-ready card issuance.

### AI Classification Accuracy
Anthropic/Gemini fallback is wired and functional; accuracy tuning is ongoing.

### WebSocket Push
VAPID push notifications are shipped. Real-time WebSocket delivery is under development.


---

## Database Schema

### Entity Relationship Diagram

\`\`\`
┌─────────────┐
│ auth.users  │ (Supabase Auth)
└──────┬──────┘
       │
       ├──────────────────────────────────┐
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌──────────────┐
│  profiles   │                    │team_members  │
├─────────────┤                    ├──────────────┤
│ id (PK)     │                    │ id (PK)      │
│ email       │                    │ user_id (FK) │
│ full_name   │                    │ name         │
│ company     │                    │ email        │
│ currency    │                    │ role         │
│ timezone    │                    │ department   │
└─────────────┘                    └──────────────┘
       │
       ▼
┌──────────────┐
│email_accounts│
├──────────────┤
│ id (PK)      │
│ user_id (FK) │
│ email        │
│ provider     │
│ is_connected │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│subscriptions │
├──────────────┤
│ id (PK)      │
│ user_id (FK) │
│ email_acc_id │
│ name         │
│ category     │
│ price        │
│ status       │
│ renews_in    │
│ is_trial     │
│ price_history│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│notifications │
├──────────────┤
│ id (PK)      │
│ user_id (FK) │
│ sub_id (FK)  │
│ type         │
│ title        │
│ message      │
│ is_read      │
└──────────────┘
\`\`\`

### Table Details

#### profiles
\`\`\`sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  full_name TEXT,
  company_name TEXT,
  currency TEXT DEFAULT 'USD',
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

**RLS Policies**: Users can only access their own profile

#### email_accounts
\`\`\`sql
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  email TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'gmail', 'outlook', etc.
  is_connected BOOLEAN DEFAULT TRUE,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

**RLS Policies**: Users can only access their own email accounts

#### subscriptions
\`\`\`sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC NOT NULL,
  icon TEXT,
  renews_in INTEGER, -- days until renewal
  status TEXT DEFAULT 'active', -- 'active', 'cancelled', 'paused'
  color TEXT,
  renewal_url TEXT,
  tags TEXT[],
  date_added TIMESTAMPTZ DEFAULT NOW(),
  email_account_id UUID REFERENCES email_accounts(id),
  last_used_at TIMESTAMPTZ,
  has_api_key BOOLEAN DEFAULT FALSE,
  is_trial BOOLEAN DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ,
  price_after_trial NUMERIC,
  source TEXT DEFAULT 'manual', -- 'manual', 'email', 'bank'
  manually_edited BOOLEAN DEFAULT FALSE,
  edited_fields TEXT[],
  pricing_type TEXT DEFAULT 'fixed', -- 'fixed', 'usage-based', 'tiered'
  billing_cycle TEXT DEFAULT 'monthly', -- 'monthly', 'yearly', 'one-time'
  cancelled_at TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  resumes_at TIMESTAMPTZ,
  price_range JSONB, -- { min: number, max: number }
  price_history JSONB DEFAULT '[]', -- [{ date, amount }]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

**RLS Policies**: Users can only access their own subscriptions

**Indexes**:
\`\`\`sql
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_renews_in ON subscriptions(renews_in);
\`\`\`

#### team_members
\`\`\`sql
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL, -- 'admin', 'manager', 'member', 'viewer'
  department TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

**RLS Policies**: Users can only access their own team members

#### notifications
\`\`\`sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  type TEXT NOT NULL, -- 'renewal', 'price_change', 'duplicate', 'trial_ending'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  subscription_id UUID REFERENCES subscriptions(id),
  is_read BOOLEAN DEFAULT FALSE,
  action_taken BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

**RLS Policies**: Users can only access their own notifications

**Indexes**:
\`\`\`sql
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
\`\`\`

---

## API Routes

### Current API Structure

\`\`\`
/app/api/
├── subscriptions/
│   ├── route.ts          # GET (list), POST (create)
│   └── [id]/
│       └── route.ts      # GET, PATCH, DELETE (single)
├── analytics/
│   └── route.ts          # GET (dashboard stats)
└── payments/
    └── route.ts          # POST (process payment)
\`\`\`

### Required API Routes

#### Authentication
\`\`\`
POST /api/auth/signup          # Create new user
POST /api/auth/login           # Login user
POST /api/auth/logout          # Logout user
POST /api/auth/refresh         # Refresh session
POST /api/auth/reset-password  # Password reset
\`\`\`

#### Subscriptions
\`\`\`
GET    /api/subscriptions           # List all (with filters)
POST   /api/subscriptions           # Create new
GET    /api/subscriptions/:id       # Get single
PATCH  /api/subscriptions/:id       # Update
DELETE /api/subscriptions/:id       # Delete
POST   /api/subscriptions/bulk      # Bulk operations
GET    /api/subscriptions/export    # Export CSV
\`\`\`

#### Email Accounts
\`\`\`
GET    /api/email-accounts          # List connected accounts
POST   /api/email-accounts          # Connect new account
DELETE /api/email-accounts/:id      # Disconnect account
POST   /api/email-accounts/:id/scan # Trigger email scan
\`\`\`

#### Team Members
\`\`\`
GET    /api/team-members            # List team
POST   /api/team-members            # Add member
PATCH  /api/team-members/:id        # Update member
DELETE /api/team-members/:id        # Remove member
\`\`\`

#### Notifications
\`\`\`
GET    /api/notifications           # List notifications
PATCH  /api/notifications/:id       # Mark as read
DELETE /api/notifications/:id       # Delete notification
POST   /api/notifications/mark-all-read # Mark all as read
\`\`\`

#### Analytics
\`\`\`
GET /api/analytics/dashboard        # Dashboard stats
GET /api/analytics/spending         # Spending trends
GET /api/analytics/forecast         # Spending forecast
GET /api/analytics/categories       # Category breakdown
\`\`\`

#### Integrations
\`\`\`
# Gmail
GET  /api/integrations/gmail/auth      # OAuth redirect
POST /api/integrations/gmail/callback  # OAuth callback
POST /api/integrations/gmail/scan      # Scan emails
POST /api/integrations/email/rescan    # Trigger bounded email re-scan

# Microsoft 365 / Outlook
GET  /api/integrations/outlook/auth      # OAuth redirect
POST /api/integrations/outlook/callback  # OAuth callback
POST /api/integrations/outlook/scan      # Scan emails

# Stripe
POST /api/integrations/stripe/checkout # Create checkout
POST /api/integrations/stripe/webhook  # Webhook handler
GET  /api/integrations/stripe/portal   # Customer portal

# Calendar (iCal feed)
GET  /api/calendar/feed/:userId/:token.ics  # Public iCal feed (token-gated)
GET  /api/calendar/token                     # Authenticated feed token
GET  /api/calendar/preferences               # Calendar sync preferences
PATCH /api/calendar/preferences              # Update calendar sync preferences

# Slack
POST /api/integrations/slack/notify    # Send notification
\`\`\`

`POST /api/integrations/email/rescan` accepts `emailAccountId`, `startDate`, and `endDate`.
The backend enforces ownership of the account, rejects disconnected providers, and currently limits replay windows to 31 days to keep reprocessing bounded and safe. Replay jobs are persisted in `rescan_jobs` and emit audit events for request, completion, and failure outcomes.

### API Response Format

**Success Response**:
\`\`\`json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
\`\`\`

**Error Response**:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "field": "price",
      "issue": "Must be a positive number"
    }
  }
}
\`\`\`

### Error Codes
\`\`\`typescript
enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INTEGRATION_ERROR = 'INTEGRATION_ERROR',
}
\`\`\`

---

## Authentication & Authorization

### Current State
- ✅ Supabase Auth configured
- ✅ Login/signup pages created
- ❌ Not enforced (users can bypass)
- ❌ No session management
- ❌ No protected routes

### Required Implementation

#### 1. Middleware Authentication
**File**: `/middleware.ts`

\`\`\`typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Protected routes
  const isProtectedRoute = !request.nextUrl.pathname.startsWith('/auth')
  
  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (request.nextUrl.pathname.startsWith('/auth') && user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
\`\`\`

#### 2. Server-Side User Fetching
**Pattern**: Always fetch user on server components

\`\`\`typescript
// app/page.tsx (Server Component)
import { createClient } from '@/lib/supabase/server-client'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }
  
  // Fetch user's subscriptions
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
  
  return <DashboardClient subscriptions={subscriptions} user={user} />
}
\`\`\`

#### 3. API Route Protection
**Pattern**: Check authentication in every API route

\`\`\`typescript
// app/api/subscriptions/route.ts
import { createClient } from '@/lib/supabase/server-client'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }
  
  // Proceed with authenticated request
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
  
  return NextResponse.json({ subscriptions: data })
}
\`\`\`

#### 4. Row Level Security (RLS)
**Status**: ✅ Already configured in database schema

All tables have RLS policies that ensure:
- Users can only read their own data
- Users can only insert data with their own user_id
- Users can only update/delete their own data

**Example Policy**:
\`\`\`sql
CREATE POLICY "subscriptions_select_own"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);
\`\`\`

This means even if someone bypasses frontend checks, they cannot access other users' data at the database level.

---

## Security Features

### Implemented ✅

#### 1. Security Headers
**File**: `/middleware.ts`

\`\`\`typescript
const securityHeaders = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=63072000',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
\`\`\`

#### 2. Input Sanitization
**File**: `/lib/security-utils.ts`

Functions available:
- `sanitizeHtml()` - Remove dangerous HTML
- `sanitizeSQL()` - Prevent SQL injection
- `sanitizeEmail()` - Validate and clean emails
- `sanitizeUrl()` - Validate URLs
- `sanitizeFilename()` - Clean filenames

#### 3. Rate Limiting
**File**: `/lib/security-utils.ts`

Client-side rate limiting implemented:
- API calls: 100 requests per minute
- Login attempts: 5 per minute
- Bulk operations: 10 per minute

**Status**: ⚠️ Client-side only, needs server-side implementation

#### 4. CSRF Protection
**File**: `/lib/security-utils.ts`

Token generation and verification available but not integrated.

#### 5. Session Management
**File**: `/lib/security-utils.ts`

- Session timeout: 30 minutes of inactivity
- Warning at 5 minutes remaining
- Automatic logout on timeout

**Status**: ⚠️ Utilities exist but not integrated

### Required Implementation ❌

#### 1. Server-Side Rate Limiting
**Recommended**: Use Vercel Edge Config or Upstash Redis

\`\`\`typescript
// lib/rate-limit-server.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
})

// Usage in API route
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success } = await ratelimit.limit(ip)
  
  if (!success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 }
    )
  }
  
  // Proceed with request
}
\`\`\`

#### 2. API Key Encryption
**Task**: Encrypt API keys before storing in database

\`\`\`typescript
// lib/encryption.ts
import crypto from 'crypto'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY! // 32 bytes
const IV_LENGTH = 16

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(text: string): string {
  const parts = text.split(':')
  const iv = Buffer.from(parts.shift()!, 'hex')
  const encrypted = Buffer.from(parts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString()
}
\`\`\`

#### 3. Webhook Signature Verification
**Task**: Verify webhook signatures from Stripe, Plaid, etc.

\`\`\`typescript
// app/api/webhooks/stripe/route.ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!
  
  let event: Stripe.Event
  
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }
  
  // Process webhook event
  switch (event.type) {
    case 'payment_intent.succeeded':
      // Handle successful payment
      break
    // ... other events
  }
  
  return NextResponse.json({ received: true })
}
\`\`\`

#### 4. Content Security Policy
**Task**: Add CSP headers

\`\`\`typescript
// middleware.ts
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`

response.headers.set('Content-Security-Policy', cspHeader.replace(/\s{2,}/g, ' ').trim())
\`\`\`

---

## Integration Points

### 1. Gmail API (Email Scanning)
**Status**: ❌ Not implemented
**Priority**: High
**See**: `INTEGRATIONS.md` Section 1

**Required Environment Variables**:
\`\`\`bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
\`\`\`

### 2. Microsoft 365 / Outlook (Work Email Scanning)
**Status**: ❌ Not implemented
**Priority**: High (for enterprise customers)
**See**: `INTEGRATIONS.md` Section 2

**Required Environment Variables**:
\`\`\`bash
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=
\`\`\`

### 3. Stripe (Payments)
**Status**: ⚠️ Connected but not processing
**Priority**: High
**See**: `INTEGRATIONS.md` Section 5

**Environment Variables** (Already Set):
\`\`\`bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
\`\`\`

### 4. Calendar Sync (iCal Feed Export)
**Status**: ✅ Implemented
**Priority**: P1
**See**: `../backend/CALENDAR_INTEGRATION_GUIDE.md`

Provides a token-gated iCal feed for subscription renewals and reminder schedules. Google Calendar OAuth push sync remains a future enhancement in `INTEGRATIONS.md` Section 6.

### 5. Slack (Team Notifications)
**Status**: ❌ Not implemented
**Priority**: Low
**See**: `INTEGRATIONS.md` Section 7

---

## Deployment Guide

### Prerequisites
1. Vercel account
2. Supabase project
3. Stripe account (for payments)
4. Domain name (optional)

### Step 1: Supabase Setup

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create new project
   - Note down:
     - Project URL
     - Anon key
     - Service role key

2. **Run Database Migrations**
   - Go to SQL Editor in Supabase Dashboard
   - Copy contents of `/scripts/001_create_tables.sql`
   - Execute
   - Copy contents of `/scripts/002_create_profile_trigger.sql`
   - Execute

3. **Verify Tables**
   \`\`\`sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public';
   \`\`\`
   
   Should show:
   - profiles
   - email_accounts
   - subscriptions
   - team_members
   - notifications

4. **Configure Authentication**
   - Go to Authentication → Settings
   - Enable Email provider
   - Set Site URL to your domain
   - Add redirect URLs:
     - `http://localhost:3000/auth/callback` (development)
     - `https://yourdomain.com/auth/callback` (production)

### Step 2: Vercel Deployment

1. **Connect Repository**
   - Go to https://vercel.com
   - Import Git repository
   - Select your SubSync AI repo

2. **Configure Environment Variables**
   \`\`\`bash
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
   
   # Stripe (if using payments)
   STRIPE_SECRET_KEY=sk_live_xxx
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   
   # Other (optional)
   GOOGLE_CLIENT_ID=xxx
   GOOGLE_CLIENT_SECRET=xxx
   MICROSOFT_CLIENT_ID=xxx
   MICROSOFT_CLIENT_SECRET=xxx
   MICROSOFT_TENANT_ID=xxx
   MICROSOFT_REDIRECT_URI=xxx
   GOOGLE_CALENDAR_CLIENT_ID=xxx
   GOOGLE_CALENDAR_CLIENT_SECRET=xxx
   SLACK_BOT_TOKEN=xxx
   SLACK_SIGNING_SECRET=xxx
   \`\`\`

3. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Visit your deployment URL

### Step 3: Post-Deployment

1. **Test Authentication**
   - Visit `/auth/sign-up`
   - Create test account
   - Verify email confirmation works
   - Login at `/auth/login`

2. **Test Database Connection**
   - Add a subscription
   - Refresh page
   - Verify subscription persists

3. **Configure Stripe Webhooks** (if using)
   - Go to Stripe Dashboard → Webhooks
   - Add endpoint: `https://yourdomain.com/api/webhooks/stripe`
   - Select events to listen for
   - Copy webhook secret to environment variables

4. **Setup Custom Domain** (optional)
   - Go to Vercel project settings
   - Add custom domain
   - Update Supabase redirect URLs

### Step 4: Monitoring

1. **Vercel Analytics**
   - Automatically enabled
   - View at Vercel Dashboard → Analytics

2. **Supabase Logs**
   - View at Supabase Dashboard → Logs
   - Monitor database queries
   - Check for errors

3. **Error Tracking** (recommended)
   - Add Sentry or similar
   - Track frontend and API errors

### Environment Variables Reference

\`\`\`bash
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Stripe (if using payments)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Gmail Integration (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# Microsoft 365 Integration (optional - for enterprise)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=

# Calendar Integration (optional)
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=

# Slack Integration (optional)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=

# Security (recommended)
ENCRYPTION_KEY= # 32 random bytes in hex
CSRF_SECRET= # Random string

# Rate Limiting (optional)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
\`\`\`

---

## Development Workflow

### Local Development

1. **Clone Repository**
   \`\`\`bash
   git clone <repo-url>
   cd subsync-ai
   \`\`\`

2. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Setup Environment Variables**
   \`\`\`bash
   cp .env.example .env.local
   # Edit .env.local with your values
   \`\`\`

4. **Run Development Server**
   \`\`\`bash
   npm run dev
   \`\`\`

5. **Access Application**
   - Open http://localhost:3000
   - Create account at /auth/sign-up

### Database Migrations

**Current State**: Manual SQL scripts

**Recommended**: Use a migration tool like Prisma or Drizzle

**Manual Process**:
1. Create new SQL file in `/scripts/`
2. Number sequentially (003_xxx.sql)
3. Execute in Supabase SQL Editor
4. Document in migration log

### Testing

**Current State**: No tests

**Recommended Setup**:
\`\`\`bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
\`\`\`

**Test Structure**:
\`\`\`
/tests/
├── unit/
│   ├── utils/
│   │   ├── currency.test.ts
│   │   ├── validation.test.ts
│   │   └── duplicate-detection.test.ts
│   └── components/
│       └── button.test.tsx
├── integration/
│   ├── api/
│   │   └── subscriptions.test.ts
│   └── auth/
│       └── login.test.ts
└── e2e/
    ├── onboarding.spec.ts
    └── subscription-management.spec.ts
\`\`\`

---

## Troubleshooting

### Common Issues

#### 1. "proSUPABASE is not defined"
**Cause**: Typo in environment variable names
**Fix**: Update `/lib/supabase/browser-client.ts` and `/lib/supabase/server-client.ts`
\`\`\`typescript
// Change from:
const url = proSUPABASE_NEXT_PUBLIC_SUPABASE_URL

// To:
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
\`\`\`

#### 2. "Failed to load chunk"
**Cause**: Lazy loading or build issues
**Fix**: 
- Clear `.next` folder: `rm -rf .next`
- Rebuild: `npm run build`
- Check for circular dependencies

#### 3. "Unauthorized" on API calls
**Cause**: Missing or expired session
**Fix**:
- Check middleware is refreshing session
- Verify cookies are being set
- Check Supabase Auth settings

#### 4. "Row Level Security policy violation"
**Cause**: Trying to access data without proper user_id
**Fix**:
- Ensure `user_id` is set on insert
- Verify RLS policies are correct
- Check user is authenticated

#### 5. Stripe webhook not working
**Cause**: Invalid signature or wrong endpoint
**Fix**:
- Verify webhook secret is correct
- Check endpoint URL matches Stripe dashboard
- Use `stripe listen --forward-to localhost:3000/api/webhooks/stripe` for local testing

---

## Performance Optimization

### Current Optimizations ✅
- React Compiler enabled
- Image optimization configured
- Lazy loading for modals
- Client-side caching
- Debounced search
- Virtualized lists (1000+ items)

### Recommended Optimizations ❌

#### 1. Database Indexing
\`\`\`sql
-- Add indexes for common queries
CREATE INDEX idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX idx_subscriptions_renews_in ON subscriptions(renews_in) WHERE status = 'active';
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
\`\`\`

#### 2. API Response Caching
\`\`\`typescript
// Use Vercel Edge Config or Redis
import { kv } from '@vercel/kv'

export async function GET(request: Request) {
  const cacheKey = `subscriptions:${userId}`
  
  // Try cache first
  const cached = await kv.get(cacheKey)
  if (cached) return NextResponse.json(cached)
  
  // Fetch from database
  const data = await fetchSubscriptions(userId)
  
  // Cache for 5 minutes
  await kv.set(cacheKey, data, { ex: 300 })
  
  return NextResponse.json(data)
}
\`\`\`

#### 3. Pagination
\`\`\`typescript
// Add pagination to list endpoints
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = (page - 1) * limit
  
  const { data, count } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
  
  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit),
    },
  })
}
\`\`\`

#### 4. Database Connection Pooling
**Status**: Supabase handles this automatically
**Note**: Use `SUPABASE_POSTGRES_PRISMA_URL` for connection pooling

---

## Security Checklist

### Pre-Production Checklist

- [ ] All environment variables set in Vercel
- [ ] Supabase RLS policies enabled on all tables
- [ ] Authentication middleware protecting all routes
- [ ] API routes checking user authentication
- [ ] Rate limiting implemented (server-side)
- [ ] CSRF protection on forms
- [ ] Input sanitization on all user inputs
- [ ] API keys encrypted in database
- [ ] Webhook signatures verified
- [ ] Security headers configured
- [ ] HTTPS enforced (automatic on Vercel)
- [ ] Session timeout implemented
- [ ] Error messages don't leak sensitive info
- [ ] SQL injection prevention (using parameterized queries)
- [ ] XSS prevention (React escapes by default)
- [ ] CORS configured properly
- [ ] File upload validation (if applicable)
- [ ] Audit logging for sensitive operations

### Compliance Checklist

- [ ] Privacy policy page
- [ ] Terms of service page
- [ ] Cookie consent banner
- [ ] GDPR data export functionality
- [ ] GDPR data deletion functionality
- [ ] User data retention policy
- [ ] Backup and disaster recovery plan

---

## Support & Resources

### Documentation
- Next.js: https://nextjs.org/docs
- Supabase: https://supabase.com/docs
- Stripe: https://stripe.com/docs
- Tailwind CSS: https://tailwindcss.com/docs

### Internal Documentation
- `INTEGRATIONS.md` - API integration guides
- `LANDING_PAGE_PROMPT.md` - Landing page specifications
- `README.md` - Project overview

### Getting Help
1. Check this documentation first
2. Review `INTEGRATIONS.md` for integration-specific issues
3. Check Supabase logs for database errors
4. Check Vercel logs for deployment errors
5. Review Next.js documentation for framework issues

---

## Changelog

### Version 2.0 (Current)
- Production-ready Express.js backend (30+ services, 24 route modules)
- Database connected with RLS policies enforced
- JWT authentication enforced on all protected routes
- Gmail and Outlook OAuth email scanning
- Stripe and Paystack webhook handling
- Telegram, Slack, push, and email digest notifications
- Blockchain indexing (Soroban/Stellar Testnet)
- Calendar iCal feed, webhooks, risk scoring, analytics

---

## Contact

For questions or issues with this documentation, contact the development team.

**Last Updated**: May 2026
**Version**: 2.0
**Status**: Production
