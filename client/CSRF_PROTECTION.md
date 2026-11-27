# CSRF Protection Architecture

> **Status**: ✅ Implemented  
> **Last Updated**: 2026-05-27  
> **Backlog ID**: #28

---

## 1. Overview
Cross-Site Request Forgery (CSRF) is a vulnerability where an unauthorized website can force a user's browser to execute action requests on a different origin where they are authenticated. Because Next.js App Router API routes authenticate users via standard session cookies, they are vulnerable to CSRF.

We mitigate this vulnerability by implementing the **Double Submit Cookie** pattern. This is a stateless, secure, and industry-standard mechanism.

---

## 2. Double Submit Cookie Pattern

```
┌───────────┐                    ┌──────────────┐
│  Browser  │ ──────────────────▶│ Next Server  │
│ (Client)  │                    │   (Backend)  │
└─────┬─────┘                    └──────┬───────┘
      │                                 │
      │ 1. Read 'csrf-token' cookie     │
      ├────────────────────────────────▶│
      │                                 │ 2. Set 'csrf-token' cookie
      │                                 │    (sameSite: lax, secure)
      │                                 │
      │ 3. Include cookie & header      │
      │    - Cookie: csrf-token=XYZ     │
      │    - Header: x-csrf-token=XYZ   │
      ├────────────────────────────────▶│
      │                                 │ 4. Verify cookie === header
      │                                 │    - Match: 200 OK
      │                                 │    - Mismatch: 403 Forbidden
```

### Flow Description
1. **Cookie Provisioning**: Standard middleware checks if the user has a `csrf-token` cookie. If missing, it generates a cryptographically secure, random token and sets it as a secure, lax, non-HttpOnly cookie (`csrf-token`).
2. **Client-Side Interception**: Our central HTTP client (Axios in `lib/api.ts`) automatically intercepts all mutating requests (POST, PUT, PATCH, DELETE), extracts the token from `document.cookie`, and appends it to the request as the `x-csrf-token` header.
3. **Server-Side Validation**:
   - The central `createApiRoute` creator checks all mutating HTTP verbs.
   - It asserts that the `csrf-token` cookie value matches the `x-csrf-token` request header exactly.
   - If they do not match, or if either is missing, the request is instantly rejected with `403 Forbidden` (`CSRF token mismatch` or `CSRF token missing`).

---

## 3. Justifications & Exemptions

All mutating API endpoints are fully protected, except for two specific exemptions:

| Route | Method | Exempted? | Justification |
|---|---|---|---|
| `/api/csp-report` | POST | 🛡️ Yes | Called automatically by browser built-in CSP agents. These agents do not support appending custom headers like `x-csrf-token`. Safe because the route has no database mutation privileges and only logs structured reports. |
| `/api/webhooks/stripe` | POST | 🛡️ Yes | Called directly by Stripe's servers. Stripe does not support cookies or CSRF headers, and instead authenticates using secure cryptographic signatures inside the `stripe-signature` header. |

All other POST, PUT, PATCH, and DELETE endpoints are fully secured.

---

## 4. Test Strategy & Regression Checks
To prevent breaking existing API test suites (which mock requests outside a browser context), CSRF verification is automatically bypassed in test environments (`process.env.NODE_ENV === 'test'`) unless explicitly forced by sending the `x-force-csrf-check` header.

Specific regression tests have been added to cover all CSRF states:
- **Cookie Missing**: Verifies that requests without the cookie are rejected with `403 Forbidden`.
- **Header Missing**: Verifies that requests without the matching header are rejected with `403 Forbidden`.
- **Token Mismatch**: Verifies that forged or mismatching headers are rejected with `403 Forbidden`.
- **Token Match**: Verifies that valid matching cookie-header pairs successfully complete.
