# @syncro/client

The frontend client application for SYNCRO (`@syncro/client`), built with Next.js 15, React 19, and TypeScript. This is the user-facing web application that provides the subscription management interface, dashboard, analytics, and integration management.

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

## Current State (June 2026)

### ✅ Fully Implemented
- **Complete UI/UX**: All pages, components, and responsive design
- **Dashboard**: Real-time analytics, subscription cards, spending charts, quick actions
- **Subscription Management**: Full CRUD operations with Supabase persistence
- **Authentication**: Supabase Auth with Next.js middleware enforcement
- **Multi-Factor Authentication**: TOTP-based MFA flows
- **Real Database**: Supabase PostgreSQL integration with live data persistence
- **Team Management**: User roles, permissions, and member organization
- **Settings**: Profile, security, integration, and notification preferences
- **Notifications**: Real-time alerts panel and notification preferences
- **Business Logic**: Currency conversion, duplicate detection, audit logging
- **Accessibility**: Command palette (Ctrl+K), dark mode, responsive design
- **Performance**: Memoization, debouncing, request deduplication

### ⚠️ Partially Implemented
- **Email Integrations**: Backend services for Gmail/Outlook API scanning are functional; UI is complete; deep invoice parsing logic is under refinement
- **Payment Processing**: Stripe and Paystack configured; integration complete; live flows in testing phase

### ❌ Not Yet Available
- **On-Chain Automation**: Pending non-custodial Stellar card issuance (external dependency)

**Status**: MVP complete and fully functional. Core features production-ready.
**Last Updated**: June 2026

## Setup

### Prerequisites
- Node.js 20+
- npm or yarn
- Supabase account and project

### Installation

1. **Install dependencies**:
   ```bash
   cd client
   npm install
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

3. **Database setup** - Tables are automatically created in Supabase. Seed data can be loaded via:
   ```bash
   npm run db:seed
   ```

### Development

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

**Tests**:
```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run e2e          # End-to-end tests
```

## Features

### ✅ Core Features (Fully Implemented)

**Dashboard**
- Real-time subscription overview with category breakdown
- Spending charts and analytics
- Quick action buttons for common tasks
- Advanced search, filtering, and sorting

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
- Dark mode and accessibility

**Team Collaboration**
- Invite team members and manage roles
- Role-based access control (admin, editor, viewer)
- Bulk user management
- Audit logging of team actions

**Notifications & Reminders**
- Real-time notification panel
- Multi-channel reminder delivery (email, in-app, Telegram)
- Notification preferences per subscription
- Digest email summaries

### ⚠️ Features In Progress

**Email Integration**
- Gmail API integration (backend ready, parsing refinement ongoing)
- Outlook API integration (backend ready, parsing refinement ongoing)
- Automatic subscription discovery from email receipts

**Payment Processing**
- Stripe integration and webhook handling
- Paystack integration for global payments
- Live payment testing phase underway

### 🔄 Planned Features

**Calendar Sync**: Upcoming subscription renewal calendar integration  
**Slack Notifications**: Direct Slack message delivery for reminders  
**AI Insights**: Smart recommendations for subscription optimization  
**On-Chain Automation**: Full automation via non-custodial Stellar cards (pending card issuance availability)

## Project Architecture

### Directory Structure

```
client/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes (for future backend calls)
│   ├── dashboard/                # Main dashboard pages
│   ├── auth/                     # Authentication pages (login, signup)
│   ├── settings/                 # User settings pages
│   ├── [user]/                   # User-scoped pages
│   ├── layout.tsx                # Root layout with auth middleware
│   └── page.tsx                  # Home/landing page
├── components/                   # React components
│   ├── ui/                       # Reusable UI components (buttons, forms, etc.)
│   ├── dashboard/                # Dashboard-specific components
│   ├── modals/                   # Modal dialogs
│   └── pages/                    # Page-level components
├── lib/                          # Utility functions and services
│   ├── supabase.ts               # Supabase client setup
│   ├── auth.ts                   # Auth utilities
│   ├── api.ts                    # API call helpers
│   └── utils/                    # Validation, formatting, conversion helpers
├── hooks/                        # Custom React hooks
│   ├── useAuth.ts                # Authentication state hook
│   ├── useSubscriptions.ts       # Subscription data hook
│   └── useNotifications.ts       # Notification state hook
├── styles/                       # Global styles and Tailwind config
├── public/                       # Static assets (images, icons)
└── tests/                        # Test files (Vitest, Playwright)
```

### Data Flow

```
User Input → React Component → Supabase Client → PostgreSQL
   ↓            ↓                  ↓               ↓
Browser      State Hook      Real-time Updates   Live Data
```

### Key Technologies

- **Next.js 15**: React framework with App Router and server components
- **React 19**: UI library with new hooks
- **TypeScript**: Type-safe development
- **Supabase**: Backend-as-a-service (auth, database, real-time)
- **Tailwind CSS v4**: Utility-first CSS framework
- **ShadcN UI**: Pre-built component library
- **Vitest**: Unit testing
- **Playwright**: E2E testing

## Development Workflow

### Writing Code

1. **Create component** in `/components/` or `/app/`
2. **Add tests** in adjacent `.test.ts` or `.test.tsx` file
3. **Use hooks** for data fetching (`useAuth`, `useSubscriptions`)
4. **Import Supabase client** from `@/lib/supabase` for data operations

### Running Locally

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests
npm run test:watch

# Terminal 3: Run E2E tests (optional)
npm run e2e:headed
```

### Testing

**Unit Tests**:
```bash
npm test
```

**E2E Tests**:
```bash
npm run e2e              # Headless
npm run e2e:headed      # With browser UI
```

**View Coverage**:
```bash
npm run test:coverage
```

### Database Operations

All database access goes through Supabase client:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Query data
const { data, error } = await supabase
  .from('subscriptions')
  .select('*')
  .eq('user_id', userId);
```

### Making API Calls

For backend integration, use the API client helper:

```typescript
// GET request
const subscriptions = await fetch('/api/subscriptions').then(r => r.json());

// POST request
const newSub = await fetch('/api/subscriptions', {
  method: 'POST',
  body: JSON.stringify(subscription),
}).then(r => r.json());
```

## Next Steps

### For Local Development
1. Clone repo and run `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in Supabase credentials
3. Start dev server: `npm run dev`
4. Run tests: `npm test`

### For Contributing
1. Create feature branch: `git checkout -b feat/your-feature`
2. Make changes and run tests: `npm test`
3. Run linter: `npm run lint`
4. Commit and push: `git push -u origin feat/your-feature`
5. Open pull request

### Future Enhancements
1. **Email Parsing Refinement**: Complete deep invoice parsing for Gmail/Outlook emails
2. **Payment Testing**: Finalize live payment flow testing with Stripe/Paystack
3. **Calendar Integration**: Add reminder/renewal calendar sync
4. **Slack Notifications**: Direct notification delivery to Slack
5. **On-Chain Automation**: Full automation once Stellar non-custodial cards are available

### Known Limitations
- On-chain automation pending external Stellar card issuance
- Email invoice parsing still refining complex receipt formats
- Payment processing in final testing phase

## Related Documentation

- See `/client/BACKEND_DOCUMENTATION.md` for detailed backend API specs
- See `/client/INTEGRATIONS.md` for integration guides
- See main `/README.md` for project overview
- See `/backend/README.md` for backend service details
