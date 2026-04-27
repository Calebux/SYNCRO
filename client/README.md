# Synchro Client (Frontend)

The frontend client application for Synchro, built with Next.js 15, React 19, and TypeScript. This is the user-facing web application that provides the subscription management interface, dashboard, analytics, and integration management.

## Overview

The client is responsible for:
- **User Interface**: Complete subscription management dashboard
- **User Experience**: Onboarding, settings, notifications, and analytics
- **API Integration**: Communication with backend services
- **State Management**: Client-side state and data caching
- **Authentication UI**: Login, signup, and session management
- **Real-time Updates**: Subscription status and notification updates

## Tech Stack

- **Framework**: Next.js 15.1.6 (App Router)
- **UI Library**: React 19
- **Language**: TypeScript 5.x
- **Styling**: Tailwind CSS v4
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Payments**: Stripe
- **Deployment**: Vercel

## Key Goals

- **Prevent unwanted recurring charges**: Users only pay when they choose
- **Non-custodial design**: Synchro does not hold or control funds. Users manage payments directly via gift cards or local accounts
- **Subscription awareness**: Synchro sends reminders and provides direct cancel links
- **Scalable roadmap**: MVP will later evolve into fully automated payments once non-custodial Stellar card issuance is available

## Project Structure

```
client/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes (Next.js serverless functions)
│   ├── dashboard/         # Dashboard pages
│   ├── auth/              # Authentication pages
│   └── ...
├── components/            # React components
│   ├── ui/                # Reusable UI components
│   ├── modals/            # Modal components
│   ├── pages/             # Page-specific components
│   └── ...
├── lib/                   # Utility functions and services
│   ├── supabase/          # Supabase client utilities
│   └── ...
├── hooks/                 # Custom React hooks
├── scripts/               # Database migration scripts
└── public/                # Static assets
```

## Current State

### ✅ Implemented
- Complete UI/UX with all pages and components
- Dashboard with analytics and subscription management
- Authentication pages (login, signup)
- Settings and team management
- Notifications system
- Onboarding flow
- Command palette (Ctrl+K)
- Keyboard shortcuts
- Dark mode support
- Responsive design
- Accessibility features
- Business logic utilities (validation, currency, timezone, etc.)
- Security utilities (sanitization, CSRF, rate limiting)
- Database schema (SQL scripts ready)

### ⚠️ Partially Implemented
- API routes (exist but return mock data)
- Supabase integration (utilities exist but have environment variable typos)
- Authentication (pages exist but not enforced)

### ❌ Not Implemented
- Real database connection (currently using mock data)
- Email integrations (Gmail, Outlook)
- Real payment processing
- Real-time notifications
- Production deployment configuration

## Setup

### Prerequisites
- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)

### Installation

```bash
cd client
pnpm install
```

### Environment Variables

Create a `.env.local` file:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Backend API (if using separate backend)
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Features

### Dashboard
- Subscription overview with cards
- Analytics and spending charts
- Quick actions and filters
- Search and sorting

### Subscription Management
- Add, edit, delete subscriptions
- Bulk operations
- Category organization
- Price tracking
- Renewal reminders

### Integrations
- Gmail email scanning (UI ready, integration pending)
- Outlook email scanning (UI ready, integration pending)
- Calendar sync (planned)
- Slack notifications (planned)

### Team Management
- Add team members
- Role-based permissions
- Department organization

### Settings
- User profile management
- Email account connections
- Notification preferences
- Currency and timezone settings

## Development Workflow

### Database Migrations
SQL scripts are in `/scripts/` directory. Execute them in Supabase SQL Editor in order:
1. `001_create_users_and_profiles.sql`
2. `002_create_profile_trigger.sql`
3. `002_create_email_accounts.sql`
4. `003_create_subscriptions.sql`
5. `004_create_teams.sql`
6. `005_create_api_keys.sql`
7. `006_create_notifications.sql`

### API Routes
API routes are in `/app/api/`:
- `/api/subscriptions` - Subscription CRUD
- `/api/analytics` - Dashboard analytics
- `/api/payments` - Payment processing

### Components
- Reusable UI components in `/components/ui/`
- Page-specific components in `/components/pages/`
- Modal components in `/components/modals/`

## Next Steps

1. Fix Supabase environment variable typos
2. Execute database migrations
3. Connect frontend to real database
4. Implement authentication middleware
5. Replace mock API routes with real database calls
6. Implement email integrations
7. Set up real payment processing

## Related Documentation

- See `/client/BACKEND_DOCUMENTATION.md` for detailed backend API specs
- See `/client/INTEGRATIONS.md` for integration guides
- See main `/README.md` for project overview
- See `/backend/README.md` for backend service details
