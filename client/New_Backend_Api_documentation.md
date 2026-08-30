# Subscription Tracker Backend API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Payment Integration](#payment-integration)
5. [Telegram Integration](#telegram-integration)
6. [Error Handling](#error-handling)
7. [Environment Variables](#environment-variables)

---

## Overview

**Base URL**: `https://backend-ai-sub.onrender.com`

**Authentication Method**: HTTP-only cookies (primary) + Bearer tokens (fallback)

**CORS**: Configured for your frontend URL (set in `FRONTEND_URL` environment variable)

### Key Features

- Email/password and Google OAuth authentication
- Gmail scanning for subscription detection
- Stripe and Paystack payment integration
- Telegram bot notifications
- Subscription management (CRUD operations)

---

## Authentication

### Cookie-Based Authentication (Recommended)

The backend sets an `authToken` HTTP-only cookie after successful login/signup. This cookie is automatically sent with requests when using `credentials: 'include'`.

```javascript
// Frontend fetch example
fetch("https://backend-ai-sub.onrender.com/api/auth/me", {
  method: "GET",
  credentials: "include", // Important: includes cookies
});
```

### Bearer Token Authentication (Fallback)

If cookies aren't available, use the `Authorization` header:

```javascript
fetch("https://backend-ai-sub.onrender.com/api/subscriptions", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

---

## API Endpoints

### 1. Authentication (`/api/auth`)

#### POST `/api/auth/signup`

Register a new user with email and password.

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe" // optional
}
```

**Response** (201):

```json
{
  "message": "Account created successfully",
  "user": {
    "id": "user_id_here",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Notes**:

- Password must be at least 8 characters
- Sets `authToken` cookie automatically
- Returns 400 if email already exists

**Frontend Example**:

```javascript
const signup = async (email, password, name) => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/auth/signup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, name }),
    }
  );
  return response.json();
};
```

---

#### POST `/api/auth/login`

Login with email and password.

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (200):

```json
{
  "message": "Logged in successfully",
  "user": {
    "id": "user_id_here",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Notes**:

- Sets `authToken` cookie automatically
- Returns 401 for invalid credentials

**Frontend Example**:

```javascript
const login = async (email, password) => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    }
  );
  return response.json();
};
```

---

#### GET `/api/auth/google/url`

Get Google OAuth login URL for sign in/sign up.

**Response** (200):

```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&scope=openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email..."
}
```

**Complete Frontend Flow**:

```javascript
// Step 1: Fetch the Google OAuth URL
const response = await fetch(
  "https://backend-ai-sub.onrender.com/api/auth/google/url"
);
const { url } = await response.json();

// Step 2: Redirect user to Google (MUST be full page redirect)
window.location.href = url;

// Step 3: User sees Google consent screen and grants permission
// Step 4: Google redirects to: https://backend-ai-sub.onrender.com/api/auth/google/callback?code=...
// Step 5: Backend processes the callback (see below)
// Step 6: Backend redirects user to: ${YOUR_FRONTEND_URL}/oauth-success
// Step 7: Cookie is now set! Check authentication:

// On /oauth-success page:
async function checkAuth() {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/auth/me",
    {
      credentials: "include", // Sends the cookie automatically
    }
  );
  const { user } = await response.json();
  console.log("Logged in as:", user.email);
  // Redirect to dashboard
  window.location.href = "/dashboard";
}
```

**CRITICAL UNDERSTANDING**:

- ✅ The JWT token **IS** saved automatically - as an HTTP-only cookie
- ✅ You **DON'T NEED** to manually save or access the token
- ✅ Just use `credentials: 'include'` in all fetch requests
- ❌ You **CANNOT** access the token via `document.cookie` (this is intentional security)
- ❌ Do NOT use popups - Google OAuth requires full page redirects

---

#### GET `/api/auth/google/callback`

Google OAuth callback (automatically handled by backend, **no frontend code needed**).

**What Happens Internally**:

1. User is redirected here from Google with `?code=AUTHORIZATION_CODE`
2. Backend exchanges code for user's Google profile info
3. Backend creates new user OR logs in existing user
4. Backend generates JWT token: `signJwt({ id: user.id, email: user.email })`
5. **Backend sets HTTP-only cookie**: `res.cookie("authToken", jwt, {...})`
6. Backend redirects user to frontend

**Cookie Configuration**:

```javascript
{
  name: "authToken",
  httpOnly: true,  // Cannot be accessed by JavaScript (security)
  secure: true,    // Only sent over HTTPS in production
  sameSite: "lax", // CSRF protection
  maxAge: 7 days,  // Auto-expires after 1 week
  path: "/"        // Available for all routes
}
```

**Redirect URLs**:

- Success: `${FRONTEND_URL}/oauth-success`
- Error: `${FRONTEND_URL}/oauth-error?reason=authentication_failed`

**Frontend `/oauth-success` Page Example**:

```javascript
// pages/oauth-success.jsx
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function OAuthSuccess() {
  const router = useRouter();

  useEffect(() => {
    // Verify authentication worked
    fetch("https://backend-ai-sub.onrender.com/api/auth/me", {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          // Success! Cookie is set and working
          console.log("Logged in as:", data.user.email);
          router.push("/dashboard");
        } else {
          // Something went wrong
          router.push("/login?error=auth_failed");
        }
      })
      .catch((err) => {
        console.error("Auth verification failed:", err);
        router.push("/login?error=auth_failed");
      });
  }, []);

  return <div>Completing sign in...</div>;
}
```

---

### 🍪 **Understanding HTTP-Only Cookies**

**Why your token "seems invisible"**:

- HTTP-only cookies are **intentionally hidden** from JavaScript
- This prevents malicious scripts from stealing your token (XSS protection)
- The browser automatically attaches the cookie to every request

**How to verify the cookie exists**:

1. Open DevTools → Application Tab → Cookies
2. Look for `authToken` cookie under your domain
3. You'll see it there, but `document.cookie` won't show it

**How authentication works with HTTP-only cookies**:

```javascript
// ❌ WRONG - Trying to manually access the cookie
const token = document.cookie; // Won't work! Cookie is hidden

// ❌ WRONG - Trying to manually set Authorization header
fetch("/api/subscriptions", {
  headers: { Authorization: `Bearer ${token}` }, // No token available!
});

// ✅ CORRECT - Let the browser handle it automatically
fetch("https://backend-ai-sub.onrender.com/api/subscriptions", {
  credentials: "include", // Browser sends cookie automatically
});

// ✅ CORRECT - Works with axios too
axios.get("https://backend-ai-sub.onrender.com/api/subscriptions", {
  withCredentials: true, // Same as credentials: 'include'
});
```

---

### 🔐 **Complete Authentication Pattern**

```javascript
// lib/api.js - Create a reusable API client
const API_BASE = "https://backend-ai-sub.onrender.com";

export async function apiCall(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: "include", // Always include cookies
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // User not authenticated - redirect to login
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

// Usage examples:
// Get current user
const { user } = await apiCall("/api/auth/me");

// Get subscriptions
const { subscriptions } = await apiCall("/api/subscriptions");

// Create subscription
const newSub = await apiCall("/api/subscriptions", {
  method: "POST",
  body: JSON.stringify({ provider: "Netflix", amount: 15.99 }),
});

// Logout
await apiCall("/api/auth/logout", { method: "POST" });
```

---

#### GET `/api/auth/me` 🔒

Get current authenticated user details.

**Response** (200):

```json
{
  "user": {
    "id": "user_id_here",
    "email": "user@example.com",
    "name": "John Doe",
    "hasPaidForScanning": false,
    "hasPaidForTelegram": false
  }
}
```

**Notes**: Requires authentication

**Frontend Example**:

```javascript
const getCurrentUser = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/auth/me",
    {
      credentials: "include",
    }
  );
  return response.json();
};
```

---

#### POST `/api/auth/logout` 🔒

Logout current user.

**Response** (200):

```json
{
  "message": "Logged out successfully"
}
```

**Notes**: Clears `authToken` cookie

**Frontend Example**:

```javascript
const logout = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/auth/logout",
    {
      method: "POST",
      credentials: "include",
    }
  );
  return response.json();
};
```

---

### 2. Gmail Integration (`/api/gmail`)

#### GET `/api/gmail/connect/url` 🔒

Get Gmail OAuth connection URL (for scanning emails).

**Response** (200):

```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

**Frontend Usage**:

```javascript
// 1. Fetch Gmail connect URL
const response = await fetch(
  "https://backend-ai-sub.onrender.com/api/gmail/connect/url",
  {
    credentials: "include",
  }
);
const { url } = await response.json();

// 2. Open URL in popup or new window
window.open(url, "_blank", "width=600,height=700");

// 3. User grants Gmail access, then redirected to:
// ${FRONTEND_URL}/gmail-connected?success=true
```

**Notes**:

- Requires authentication
- Currently does NOT require payment (payment check commented out)
- Grants Gmail read-only access for subscription scanning

---

#### GET `/api/gmail/connect/callback`

Gmail OAuth callback (handled automatically, redirects to frontend).

**Redirect URLs**:

- Success: `${FRONTEND_URL}/gmail-connected?success=true`
- Error: `${FRONTEND_URL}/gmail-connected?error=authentication_failed`

**Notes**: Automatically scans Gmail after successful connection

---

### 3. Subscriptions (`/api/subscriptions`)

#### GET `/api/subscriptions` 🔒

Get all subscriptions for the authenticated user.

**Response** (200):

```json
{
  "subscriptions": [
    {
      "id": "sub_id_here",
      "userId": "user_id_here",
      "provider": "Netflix",
      "product": "Premium Plan",
      "amount": 15.99,
      "currency": "USD",
      "tag": "other",
      "status": "active",
      "startDate": "2024-01-01T00:00:00.000Z",
      "nextBilling": "2025-01-01T00:00:00.000Z",
      "expiryDate": null,
      "createdAt": "2024-12-01T00:00:00.000Z",
      "rawData": { "messageId": "...", "subject": "..." }
    }
  ]
}
```

**Subscription Tags**:

- `ai` - AI services (ChatGPT, Claude, Anthropic, etc.)
- `other` - Everything else

**Frontend Example**:

```javascript
const getSubscriptions = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/subscriptions",
    {
      credentials: "include",
    }
  );
  const data = await response.json();
  return data.subscriptions;
};
```

---

#### POST `/api/subscriptions` 🔒

Manually create a new subscription.

**Request Body**:

```json
{
  "provider": "Netflix",
  "product": "Premium Plan", // optional
  "amount": 15.99, // optional, must be > 0
  "currency": "USD", // optional
  "tag": "other", // optional
  "startDate": "2024-01-01", // optional
  "nextBilling": "2025-01-01", // optional
  "expiryDate": null // optional
}
```

**Response** (201):

```json
{
  "id": "sub_id_here",
  "userId": "user_id_here",
  "provider": "Netflix",
  "product": "Premium Plan",
  "amount": 15.99,
  "currency": "USD",
  "tag": "other",
  "status": "active",
  "startDate": "2024-01-01T00:00:00.000Z",
  "nextBilling": "2025-01-01T00:00:00.000Z",
  "createdAt": "2024-12-05T00:00:00.000Z"
}
```

**Frontend Example**:

```javascript
const createSubscription = async (subData) => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/subscriptions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(subData),
    }
  );
  return response.json();
};
```

---

#### PUT `/api/subscriptions/:id` 🔒

Update an existing subscription.

**Request Body** (partial update):

```json
{
  "amount": 19.99,
  "nextBilling": "2025-02-01"
}
```

**Response** (200):

```json
{
  "id": "sub_id_here",
  "userId": "user_id_here",
  "provider": "Netflix",
  "amount": 19.99,
  "nextBilling": "2025-02-01T00:00:00.000Z",
  ...
}
```

**Notes**: Returns 403 if user doesn't own the subscription

**Frontend Example**:

```javascript
const updateSubscription = async (id, updates) => {
  const response = await fetch(
    `https://backend-ai-sub.onrender.com/api/subscriptions/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(updates),
    }
  );
  return response.json();
};
```

---

#### DELETE `/api/subscriptions/:id` 🔒

Delete a subscription.

**Response** (200):

```json
{
  "message": "Subscription deleted successfully"
}
```

**Notes**: Returns 403 if user doesn't own the subscription

**Frontend Example**:

```javascript
const deleteSubscription = async (id) => {
  const response = await fetch(
    `https://backend-ai-sub.onrender.com/api/subscriptions/${id}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  return response.json();
};
```

---

### 4. Payments (`/api/payments`)

#### POST `/api/payments/initialize` 🔒

Initialize a payment for scanning or Telegram features.

**Request Body**:

```json
{
  "paymentType": "scanning", // "scanning" | "telegram" | "bundle"
  "country": "NG" // optional, auto-detected from IP
}
```

**Response** (200):

```json
{
  "success": true,
  "message": "Payment initialized successfully",
  "data": {
    "authorizationUrl": "https://checkout.stripe.com/...",
    "reference": "stripe_scanning_1733404800000_abc123",
    "gateway": "stripe",
    "amount": 5.0
  }
}
```

**Payment Types & Pricing**:

- `scanning`: $5 USD / ₦8,000 NGN
- `telegram`: $2 USD / ₦3,200 NGN
- `bundle`: $7 USD / ₦11,200 NGN (both features)

**Gateway Selection**:

- African countries (NG, GH, ZA, KE, etc.) → Paystack
- Other countries → Stripe

**Frontend Flow**:

```javascript
// 1. Initialize payment
const response = await fetch(
  "https://backend-ai-sub.onrender.com/api/payments/initialize",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ paymentType: "scanning" }),
  }
);
const { data } = await response.json();

// 2. Redirect to payment gateway
window.location.href = data.authorizationUrl;

// 3. User completes payment, redirected to:
// Success: /payment/success?reference=xxx&session_id=yyy
// Cancel: /payment/cancel?reference=xxx
```

---

#### GET `/api/payments/verify/stripe/:sessionId` 🔒

Verify a Stripe payment by session ID.

**Response** (200):

```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "reference": "stripe_scanning_1733404800000_abc123",
    "amount": 5.0,
    "paymentType": "scanning"
  }
}
```

**Frontend Example**:

```javascript
// On /payment/success page
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("session_id");

const response = await fetch(
  `https://backend-ai-sub.onrender.com/api/payments/verify/stripe/${sessionId}`,
  {
    credentials: "include",
  }
);
const result = await response.json();
```

---

#### GET `/api/payments/paystack/verify/:reference` 🔒

Verify a Paystack payment by reference.

**Response** (200):

```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "reference": "paystack_telegram_1733404800000_def456",
    "amount": 2.0,
    "paymentType": "telegram"
  }
}
```

**Frontend Example**:

```javascript
// On /payment/verify page
const urlParams = new URLSearchParams(window.location.search);
const reference = urlParams.get("reference");

const response = await fetch(
  `https://backend-ai-sub.onrender.com/api/payments/paystack/verify/${reference}`,
  {
    credentials: "include",
  }
);
const result = await response.json();
```

---

#### GET `/api/payments/status` 🔒

Get user's payment status.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "hasPaidForScanning": true,
    "hasPaidForTelegram": false
  }
}
```

**Frontend Example**:

```javascript
const getPaymentStatus = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/payments/status",
    {
      credentials: "include",
    }
  );
  return response.json();
};
```

---

#### GET `/api/payments/history` 🔒

Get payment history for authenticated user.

**Response** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "payment_id",
      "amount": 5.0,
      "currency": "USD",
      "paymentType": "scanning",
      "paymentGateway": "stripe",
      "paymentStatus": "success",
      "reference": "stripe_scanning_1733404800000_abc123",
      "createdAt": "2024-12-05T00:00:00.000Z"
    }
  ]
}
```

**Frontend Example**:

```javascript
const getPaymentHistory = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/payments/history",
    {
      credentials: "include",
    }
  );
  return response.json();
};
```

---

### 5. Telegram (`/api/telegram`)

#### GET `/api/telegram/link` 🔒 💳

Get Telegram bot connection link.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "link": "https://t.me/YourBot?start=user_id_here",
    "isConnected": false,
    "instructions": [
      "Click the link below to open Telegram",
      "Press \"Start\" or send /start",
      "Your account will be linked automatically"
    ]
  }
}
```

**Notes**: Requires `hasPaidForTelegram = true`

**Frontend Usage**:

```javascript
// 1. Get Telegram link
const response = await fetch(
  "https://backend-ai-sub.onrender.com/api/telegram/link",
  {
    credentials: "include",
  }
);
const { data } = await response.json();

// 2. Show link to user or open in new tab
window.open(data.link, "_blank");
```

---

#### GET `/api/telegram/status` 🔒

Check Telegram connection status.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "isConnected": true,
    "hasPaidForFeature": true,
    "chatId": "123456789"
  }
}
```

**Frontend Example**:

```javascript
const getTelegramStatus = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/telegram/status",
    {
      credentials: "include",
    }
  );
  return response.json();
};
```

---

#### POST `/api/telegram/disconnect` 🔒 💳

Disconnect Telegram from user account.

**Response** (200):

```json
{
  "success": true,
  "message": "Telegram disconnected successfully"
}
```

**Notes**: Requires `hasPaidForTelegram = true`

**Frontend Example**:

```javascript
const disconnectTelegram = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/telegram/disconnect",
    {
      method: "POST",
      credentials: "include",
    }
  );
  return response.json();
};
```

---

#### POST `/api/telegram/test` 🔒 💳

Send a test notification to connected Telegram.

**Response** (200):

```json
{
  "success": true,
  "message": "Test notification sent successfully"
}
```

**Notes**:

- Requires `hasPaidForTelegram = true`
- Requires Telegram to be connected

**Frontend Example**:

```javascript
const sendTestNotification = async () => {
  const response = await fetch(
    "https://backend-ai-sub.onrender.com/api/telegram/test",
    {
      method: "POST",
      credentials: "include",
    }
  );
  return response.json();
};
```

---

### 6. Webhooks (`/api/webhooks`)

#### POST `/api/webhooks/stripe`

Stripe webhook endpoint (for automatic payment processing).

**Notes**:

- No authentication required
- Verified using Stripe webhook signature
- Automatically updates user access on successful payment

---

#### POST `/api/webhooks/paystack`

Paystack webhook endpoint (for automatic payment processing).

**Notes**:

- No authentication required
- Verified using Paystack webhook signature
- Automatically updates user access on successful payment

---

## Payment Integration

### Payment Flow

```
1. User clicks "Purchase Scanning" button
   ↓
2. Frontend calls POST /api/payments/initialize
   ↓
3. Backend creates payment record, returns authorization URL
   ↓
4. Frontend redirects to Stripe/Paystack
   ↓
5. User completes payment
   ↓
6. Payment gateway calls webhook (automatic)
   ↓
7. Backend updates user access (hasPaidForScanning = true)
   ↓
8. User redirected back to frontend success page
   ↓
9. Frontend verifies payment and updates UI
```

### Frontend Implementation Example

```javascript
// Initialize payment
async function purchaseFeature(paymentType) {
  try {
    const response = await fetch(
      "https://backend-ai-sub.onrender.com/api/payments/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ paymentType }),
      }
    );

    const { data } = await response.json();

    // Redirect to payment gateway
    window.location.href = data.authorizationUrl;
  } catch (error) {
    console.error("Payment initialization failed:", error);
  }
}

// On success page (/payment/success?reference=xxx&session_id=yyy)
async function verifyPayment(reference, sessionId) {
  const isStripe = sessionId !== undefined;
  const endpoint = isStripe
    ? `/api/payments/verify/stripe/${sessionId}`
    : `/api/payments/paystack/verify/${reference}`;

  const response = await fetch(
    `https://backend-ai-sub.onrender.com${endpoint}`,
    {
      credentials: "include",
    }
  );

  const result = await response.json();

  if (result.success) {
    // Payment successful - update UI
    console.log("Payment verified!", result.data);
  }
}
```

---

## Telegram Integration

### Telegram Bot Commands

Users can interact with the Telegram bot:

- `/start` - Link Telegram account
- `/help` - Show available commands
- `/status` - Check notification status
- `/subscriptions` - View active subscriptions
- `/settings` - View notification settings
- `/unlink` - Disconnect Telegram

### Notification Types

The bot sends automatic notifications for:

1. **Subscription Expiring** - 7, 3, and 1 day before renewal
2. **Subscription Expired** - When subscription passes expiry date
3. **New Subscription Found** - When email scan finds new subscription
4. **Scan Completed** - When email scan finishes
5. **Weekly Summary** - Every Sunday at 8 AM

### Frontend Integration

```javascript
// 1. Check if user has paid for Telegram
const statusResponse = await fetch(
  "https://backend-ai-sub.onrender.com/api/payments/status",
  {
    credentials: "include",
  }
);
const { data } = await statusResponse.json();

if (!data.hasPaidForTelegram) {
  // Show payment button
  return;
}

// 2. Get Telegram connection link
const linkResponse = await fetch(
  "https://backend-ai-sub.onrender.com/api/telegram/link",
  {
    credentials: "include",
  }
);
const { data: linkData } = await linkResponse.json();

// 3. Display link to user
console.log("Connect Telegram:", linkData.link);

// 4. Check connection status
const statusResponse = await fetch(
  "https://backend-ai-sub.onrender.com/api/telegram/status",
  {
    credentials: "include",
  }
);
const { data: telegramStatus } = await statusResponse.json();

if (telegramStatus.isConnected) {
  console.log("Telegram connected!");
}
```

---

## Error Handling

### Standard Error Response Format

```json
{
  "error": "Error message here"
}
```

or

```json
{
  "success": false,
  "message": "Error message here",
  "requiresPayment": true, // optional
  "paymentType": "scanning" // optional
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created (new resource)
- `400` - Bad request (validation error)
- `401` - Unauthorized (not logged in)
- `403` - Forbidden (insufficient permissions or payment required)
- `404` - Not found
- `500` - Internal server error

### Payment Required Responses

When a feature requires payment, the API returns:

```json
{
  "success": false,
  "message": "Please purchase email scanning feature to access this functionality",
  "requiresPayment": true,
  "paymentType": "scanning"
}
```

**Frontend should**:

1. Check for `requiresPayment: true`
2. Redirect user to payment page with `paymentType`

---

## Environment Variables

Required environment variables for backend:

```env
# Database
DATABASE_URL="postgresql://..."

# JWT
JWT_SECRET="your-jwt-secret-here"

# Encryption (32 bytes hex, 64 chars)
ENCRYPTION_KEY="your-64-character-hex-encryption-key-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Frontend URL (your frontend domain)
FRONTEND_URL="https://your-frontend.com"
FRONTEND_REDIRECT_URI="https://your
```
