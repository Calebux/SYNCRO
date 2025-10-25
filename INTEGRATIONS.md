# API Integrations Guide

This guide provides step-by-step instructions for integrating external APIs with SubSync AI.

## Table of Contents

1. [Gmail API Integration](#gmail-api-integration)
2. [Stripe Payment Processing](#stripe-payment-processing)
3. [Google Calendar Integration](#google-calendar-integration)
4. [Slack Notifications](#slack-notifications)
5. [Plaid Bank Integration](#plaid-bank-integration)
6. [Webhook Setup](#webhook-setup)
7. [AI API Usage Tracking](#ai-api-usage-tracking)

---

## Gmail API Integration

Enable automatic subscription detection by scanning user emails.

### Prerequisites

- Google Cloud Platform account
- Gmail API enabled
- OAuth 2.0 credentials

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Create Project"
3. Name your project (e.g., "SubSync AI")
4. Click "Create"

### Step 2: Enable Gmail API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Gmail API"
3. Click "Enable"

### Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Web application"
4. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/gmail/callback` (development)
   - `https://yourdomain.com/api/auth/gmail/callback` (production)
5. Click "Create"
6. Save your Client ID and Client Secret

### Step 4: Add Environment Variables

Add to your `.env.local`:

\`\`\`env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
\`\`\`

### Step 5: Implement OAuth Flow

Create `app/api/auth/gmail/route.ts`:

\`\`\`typescript
import { google } from 'googleapis'
import { NextResponse } from 'next/server'

export async function GET() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
  ]

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  })

  return NextResponse.redirect(url)
}
\`\`\`

Create `app/api/auth/gmail/callback/route.ts`:

\`\`\`typescript
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect('/dashboard?error=no_code')
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  try {
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user email
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const profile = await gmail.users.getProfile({ userId: 'me' })

    // Save to database
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      await supabase.from('email_accounts').insert({
        user_id: user.id,
        email: profile.data.emailAddress,
        provider: 'gmail',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        is_connected: true,
      })
    }

    return NextResponse.redirect('/dashboard?gmail=connected')
  } catch (error) {
    console.error('Gmail OAuth error:', error)
    return NextResponse.redirect('/dashboard?error=gmail_auth_failed')
  }
}
\`\`\`

### Step 6: Scan Emails for Subscriptions

Create `lib/gmail/scanner.ts`:

\`\`\`typescript
import { google } from 'googleapis'

const SUBSCRIPTION_KEYWORDS = [
  'subscription',
  'recurring payment',
  'monthly charge',
  'annual renewal',
  'auto-renew',
]

export async function scanEmailsForSubscriptions(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const subscriptions = []

  for (const keyword of SUBSCRIPTION_KEYWORDS) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: \`subject:(\${keyword}) after:2023/01/01\`,
      maxResults: 50,
    })

    if (response.data.messages) {
      for (const message of response.data.messages) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
        })

        // Parse email content for subscription details
        const subscription = parseEmailForSubscription(details.data)
        if (subscription) {
          subscriptions.push(subscription)
        }
      }
    }
  }

  return subscriptions
}

function parseEmailForSubscription(email: any) {
  // Extract subscription details from email
  // This is a simplified example - you'll need more sophisticated parsing
  const subject = email.payload.headers.find((h: any) => h.name === 'Subject')?.value
  const from = email.payload.headers.find((h: any) => h.name === 'From')?.value

  // Extract price using regex
  const priceMatch = subject?.match(/\$(\d+\.?\d*)/)?.[1]

  if (priceMatch && from) {
    return {
      name: from.split('<')[0].trim(),
      price: parseFloat(priceMatch),
      source: 'gmail',
    }
  }

  return null
}
\`\`\`

---

## Stripe Payment Processing

Process subscription payments using Stripe.

### Prerequisites

- Stripe account
- Stripe API keys

### Step 1: Get Stripe API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Navigate to "Developers" > "API keys"
3. Copy your Publishable key and Secret key

### Step 2: Add Environment Variables

Already configured in your project:

\`\`\`env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
\`\`\`

### Step 3: Create Stripe Checkout Session

Create `app/api/stripe/checkout/route.ts`:

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { priceId, subscriptionId } = await request.json()

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: \`\${process.env.NEXT_PUBLIC_URL}/dashboard?payment=success&subscription=\${subscriptionId}\`,
      cancel_url: \`\${process.env.NEXT_PUBLIC_URL}/dashboard?payment=cancelled\`,
      customer_email: user.email,
      metadata: {
        user_id: user.id,
        subscription_id: subscriptionId,
      },
    })

    return NextResponse.json({ sessionId: session.id })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
\`\`\`

### Step 4: Handle Stripe Webhooks

Create `app/api/stripe/webhook/route.ts`:

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const { user_id, subscription_id } = session.metadata!

      // Update subscription status
      await supabase
        .from('subscriptions')
        .update({ status: 'active', stripe_subscription_id: session.subscription })
        .eq('id', subscription_id)
        .eq('user_id', user_id)

      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      // Mark subscription as cancelled
      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subscription.id)

      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice

      // Notify user of payment failure
      // You can implement notification logic here

      break
    }
  }

  return NextResponse.json({ received: true })
}
\`\`\`

### Step 5: Configure Webhook in Stripe

1. Go to Stripe Dashboard > "Developers" > "Webhooks"
2. Click "Add endpoint"
3. Enter your webhook URL: `https://yourdomain.com/api/stripe/webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Copy the webhook signing secret and add to `.env.local`:

\`\`\`env
STRIPE_WEBHOOK_SECRET=whsec_...
\`\`\`

---

## Google Calendar Integration

Sync subscription renewal dates to Google Calendar.

### Prerequisites

- Google Cloud Platform project (same as Gmail)
- Google Calendar API enabled

### Step 1: Enable Calendar API

1. In Google Cloud Console, go to "APIs & Services" > "Library"
2. Search for "Google Calendar API"
3. Click "Enable"

### Step 2: Update OAuth Scopes

Update your OAuth scopes to include Calendar:

\`\`\`typescript
const scopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]
\`\`\`

### Step 3: Create Calendar Events

Create `lib/calendar/sync.ts`:

\`\`\`typescript
import { google } from 'googleapis'

export async function addRenewalToCalendar(
  accessToken: string,
  subscription: {
    name: string
    renewalDate: Date
    price: number
  }
) {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const event = {
    summary: \`\${subscription.name} Renewal\`,
    description: \`Subscription renewal for \${subscription.name} - $\${subscription.price}\`,
    start: {
      dateTime: subscription.renewalDate.toISOString(),
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: new Date(subscription.renewalDate.getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: 'America/Los_Angeles',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 }, // 1 day before
        { method: 'popup', minutes: 60 }, // 1 hour before
      ],
    },
  }

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    })

    return response.data.id
  } catch (error) {
    console.error('Failed to create calendar event:', error)
    throw error
  }
}
\`\`\`

---

## Slack Notifications

Send subscription alerts to Slack channels.

### Prerequisites

- Slack workspace
- Slack app with incoming webhooks

### Step 1: Create Slack App

1. Go to [Slack API](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app and select workspace

### Step 2: Enable Incoming Webhooks

1. In your app settings, go to "Incoming Webhooks"
2. Toggle "Activate Incoming Webhooks" to On
3. Click "Add New Webhook to Workspace"
4. Select a channel and authorize
5. Copy the webhook URL

### Step 3: Add Environment Variable

\`\`\`env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
\`\`\`

### Step 4: Send Notifications

Create `lib/slack/notifications.ts`:

\`\`\`typescript
export async function sendSlackNotification(message: {
  title: string
  text: string
  color?: 'good' | 'warning' | 'danger'
}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('Slack webhook URL not configured')
    return
  }

  const payload = {
    attachments: [
      {
        color: message.color || 'good',
        title: message.title,
        text: message.text,
        footer: 'SubSync AI',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(\`Slack API error: \${response.statusText}\`)
    }
  } catch (error) {
    console.error('Failed to send Slack notification:', error)
  }
}

// Example usage
export async function notifySubscriptionRenewal(subscription: any) {
  await sendSlackNotification({
    title: 'Subscription Renewal Reminder',
    text: \`\${subscription.name} will renew in 3 days for $\${subscription.price}\`,
    color: 'warning',
  })
}

export async function notifyPriceIncrease(subscription: any, oldPrice: number, newPrice: number) {
  await sendSlackNotification({
    title: 'Price Increase Detected',
    text: \`\${subscription.name} price increased from $\${oldPrice} to $\${newPrice}\`,
    color: 'danger',
  })
}
\`\`\`

---

## Plaid Bank Integration

Connect bank accounts to automatically detect subscription charges.

### Prerequisites

- Plaid account
- Plaid API keys

### Step 1: Sign Up for Plaid

1. Go to [Plaid Dashboard](https://dashboard.plaid.com/)
2. Sign up for an account
3. Get your Client ID and Secret

### Step 2: Add Environment Variables

\`\`\`env
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # or 'development' or 'production'
\`\`\`

### Step 3: Install Plaid SDK

\`\`\`bash
npm install plaid
\`\`\`

### Step 4: Create Link Token

Create `app/api/plaid/create-link-token/route.ts`:

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server'
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { createClient } from '@/lib/supabase/server'

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
})

const plaidClient = new PlaidApi(configuration)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'SubSync AI',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })

    return NextResponse.json({ link_token: response.data.link_token })
  } catch (error) {
    console.error('Plaid link token error:', error)
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 500 })
  }
}
\`\`\`

### Step 5: Exchange Public Token

Create `app/api/plaid/exchange-token/route.ts`:

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server'
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import { createClient } from '@/lib/supabase/server'

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
})

const plaidClient = new PlaidApi(configuration)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { public_token } = await request.json()

  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    })

    const accessToken = response.data.access_token

    // Save access token to database
    await supabase.from('bank_connections').insert({
      user_id: user.id,
      access_token: accessToken,
      item_id: response.data.item_id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Plaid token exchange error:', error)
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 })
  }
}
\`\`\`

### Step 6: Fetch Transactions

Create `lib/plaid/transactions.ts`:

\`\`\`typescript
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
})

const plaidClient = new PlaidApi(configuration)

export async function fetchTransactions(accessToken: string, startDate: string, endDate: string) {
  try {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    })

    // Filter for recurring transactions
    const recurringTransactions = response.data.transactions.filter((transaction) => {
      // Look for subscription-related merchants
      const subscriptionKeywords = ['netflix', 'spotify', 'adobe', 'microsoft', 'amazon prime']
      return subscriptionKeywords.some((keyword) => transaction.name.toLowerCase().includes(keyword))
    })

    return recurringTransactions
  } catch (error) {
    console.error('Failed to fetch transactions:', error)
    throw error
  }
}
\`\`\`

---

## Webhook Setup

Configure webhooks for external services to notify your app of events.

### Step 1: Create Webhook Endpoint

Create `app/api/webhooks/[provider]/route.ts`:

\`\`\`typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest, { params }: { params: { provider: string } }) {
  const provider = params.provider
  const body = await request.json()

  // Verify webhook signature (provider-specific)
  const signature = request.headers.get('x-webhook-signature')
  if (!verifySignature(provider, body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const supabase = await createClient()

  // Handle different webhook events
  switch (provider) {
    case 'stripe':
      await handleStripeWebhook(body, supabase)
      break
    case 'plaid':
      await handlePlaidWebhook(body, supabase)
      break
    default:
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  return NextResponse.json({ received: true })
}

function verifySignature(provider: string, body: any, signature: string | null): boolean {
  // Implement signature verification for each provider
  // This is a placeholder - implement actual verification
  return true
}

async function handleStripeWebhook(body: any, supabase: any) {
  // Handle Stripe events
}

async function handlePlaidWebhook(body: any, supabase: any) {
  // Handle Plaid events
}
\`\`\`

---

## AI API Usage Tracking

Track usage of AI APIs (OpenAI, Anthropic, etc.) for cost monitoring.

### Prerequisites

- API keys for AI services you use

### Step 1: Add Environment Variables

\`\`\`env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
\`\`\`

### Step 2: Create Usage Tracking Middleware

Create `lib/ai/usage-tracker.ts`:

\`\`\`typescript
import { createClient } from '@/lib/supabase/server'

interface UsageData {
  provider: 'openai' | 'anthropic' | 'other'
  model: string
  tokens: number
  cost: number
}

export async function trackAIUsage(userId: string, usage: UsageData) {
  const supabase = await createClient()

  await supabase.from('ai_usage').insert({
    user_id: userId,
    provider: usage.provider,
    model: usage.model,
    tokens: usage.tokens,
    cost: usage.cost,
    timestamp: new Date().toISOString(),
  })
}

// Pricing per 1K tokens (as of 2024)
const PRICING = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model as keyof typeof PRICING]
  if (!pricing) return 0

  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output
}
\`\`\`

### Step 3: Wrap AI API Calls

\`\`\`typescript
import OpenAI from 'openai'
import { trackAIUsage, calculateCost } from './usage-tracker'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function generateText(userId: string, prompt: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
  })

  const usage = response.usage
  if (usage) {
    const cost = calculateCost('gpt-4', usage.prompt_tokens, usage.completion_tokens)

    await trackAIUsage(userId, {
      provider: 'openai',
      model: 'gpt-4',
      tokens: usage.total_tokens,
      cost,
    })
  }

  return response.choices[0].message.content
}
\`\`\`

---

## Testing Integrations

### Gmail API Testing

\`\`\`bash
# Test OAuth flow
curl http://localhost:3000/api/auth/gmail

# Test email scanning
curl -X POST http://localhost:3000/api/gmail/scan \\
  -H "Authorization: Bearer YOUR_TOKEN"
\`\`\`

### Stripe Testing

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

### Plaid Testing

Use Plaid sandbox credentials:
- Username: `user_good`
- Password: `pass_good`

---

## Troubleshooting

### Common Issues

1. **OAuth redirect mismatch**
   - Ensure redirect URIs match exactly in Google/Stripe console
   - Check for trailing slashes

2. **Webhook signature verification fails**
   - Verify webhook secret is correct
   - Check request body is raw (not parsed)

3. **Rate limiting**
   - Implement exponential backoff
   - Cache API responses when possible

4. **Token expiration**
   - Implement token refresh logic
   - Store refresh tokens securely

### Support

For integration issues:
- Check provider documentation
- Review error logs in dashboard
- Contact support at support@subsync.ai

---

## Security Best Practices

1. **Never commit API keys** - Use environment variables
2. **Validate webhook signatures** - Prevent unauthorized requests
3. **Use HTTPS in production** - Encrypt data in transit
4. **Rotate keys regularly** - Update API keys periodically
5. **Implement rate limiting** - Prevent abuse
6. **Log security events** - Monitor for suspicious activity

---

## Next Steps

After setting up integrations:

1. Test each integration in sandbox/development mode
2. Monitor API usage and costs
3. Set up error alerting
4. Document any custom configurations
5. Train team on integration features

For questions or support, contact: integrations@subsync.ai
