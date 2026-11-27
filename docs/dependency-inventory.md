# Dependency Inventory (#102)

Covers all packages across client, backend, and contracts.
Review cadence: **quarterly** (or immediately on a CVE advisory for any listed package).

---

## Backend (`backend/package.json`)

### Runtime Dependencies

| Package | Version | License | Purpose | Notes |
|---|---|---|---|---|
| `@supabase/supabase-js` | ^2.47.10 | MIT | Database client | Core dependency |
| `cookie-parser` | ^1.4.7 | MIT | Cookie parsing middleware | |
| `dotenv` | ^16.4.5 | BSD-2-Clause | Env var loading | |
| `express` | ^5.2.1 | MIT | HTTP server | v5 (RC) – monitor for stable release |
| `node-cron` | ^3.0.3 | ISC | Cron job scheduling | |
| `nodemailer` | ^6.9.9 | MIT | Email delivery | |
| `web-push` | ^3.6.7 | MPL-2.0 | Web Push / VAPID notifications | MPL-2.0: file-level copyleft, no issue for SaaS |
| `winston` | ^3.14.0 | MIT | Structured logging | |
| `zod` | ^3.23.8 | MIT | Schema validation | |

### Dev Dependencies

| Package | Version | License | Purpose |
|---|---|---|---|
| `@types/*` | various | MIT | TypeScript type definitions |
| `jest` | ^30.2.0 | MIT | Test runner |
| `supertest` | ^7.2.2 | MIT | HTTP integration testing |
| `ts-jest` | ^29.4.6 | MIT | Jest TypeScript transformer |
| `ts-node-dev` | ^2.0.0 | MIT | Dev server with hot reload |
| `typescript` | ^5.5.0 | Apache-2.0 | TypeScript compiler |

---

## Client (`client/package.json`)

### Runtime Dependencies

| Package | Version | License | Purpose | Notes |
|---|---|---|---|---|
| `next` | 15.2.4 | MIT | React framework | |
| `react` / `react-dom` | ^19 | MIT | UI library | |
| `@supabase/supabase-js` | latest | MIT | Database client | Pin to exact version in production |
| `@supabase/ssr` | latest | MIT | Supabase SSR helpers | Pin to exact version in production |
| `@stripe/react-stripe-js` | 5.2.0 | MIT | Stripe React components | |
| `stripe` | latest | MIT | Stripe Node SDK | Pin to exact version in production |
| `axios` | ^1.4.0 | MIT | HTTP client | |
| `zod` | 3.25.76 | MIT | Schema validation | |
| `react-hook-form` | ^7.60.0 | MIT | Form state management | |
| `@hookform/resolvers` | ^3.10.0 | MIT | Zod resolver for react-hook-form | |
| `date-fns` | latest | MIT | Date utilities | Pin to exact version |
| `recharts` | latest | MIT | Charts | Pin to exact version |
| `tailwindcss` | ^4.1.9 | MIT | CSS framework | |
| `tailwind-merge` | ^2.5.5 | MIT | Tailwind class merging | |
| `class-variance-authority` | ^0.7.1 | Apache-2.0 | Component variant utility | |
| `clsx` | ^2.1.1 | MIT | Conditional classnames | |
| `lucide-react` | ^0.454.0 | ISC | Icon library | |
| `next-themes` | latest | MIT | Dark mode | Pin to exact version |
| `sonner` | ^1.7.4 | MIT | Toast notifications | |
| `cmdk` | 1.0.4 | MIT | Command palette | |
| `vaul` | ^1.1.2 | MIT | Drawer component | |
| `embla-carousel-react` | 8.5.1 | MIT | Carousel | |
| `react-day-picker` | 9.8.0 | MIT | Date picker | |
| `react-qr-code` | latest | MIT | QR code display | Pin to exact version |
| `react-resizable-panels` | ^2.1.7 | MIT | Resizable layout panels | |
| `input-otp` | 1.4.1 | MIT | OTP input | |
| `@vercel/analytics` | 1.3.1 | Apache-2.0 | Vercel analytics | |
| `@radix-ui/react-*` (40+ packages) | various | MIT | Accessible UI primitives | All MIT |
| `autoprefixer` | ^10.4.20 | MIT | CSS autoprefixer | |
| `babel-plugin-react-compiler` | ^1.0.0 | MIT | React compiler plugin | |

### Dev Dependencies

| Package | Version | License | Purpose |
|---|---|---|---|
| `typescript` | ^5 | Apache-2.0 | TypeScript compiler |
| `@types/node` | ^22 | MIT | Node type definitions |
| `@types/react` / `@types/react-dom` | ^19 | MIT | React type definitions |
| `postcss` | ^8.5 | MIT | CSS processing |
| `tw-animate-css` | 1.3.3 | MIT | Tailwind animation utilities |

---

## Contracts (`contracts/Cargo.toml`)

| Crate | Version | License | Purpose | Notes |
|---|---|---|---|---|
| `soroban-sdk` | 23 | Apache-2.0 | Stellar Soroban smart contract SDK | Workspace dependency |

---

## SDK (`sdk/`)

No dependencies declared (README only, no package.json).

---

## License Classification Summary

| License | Count | Packages | Compliance Notes |
|---|---|---|---|
| MIT | ~90% | Most npm packages | Permissive; no restrictions for SaaS |
| Apache-2.0 | ~5% | `typescript`, `class-variance-authority`, `@vercel/analytics`, `soroban-sdk` | Permissive; include NOTICE file if distributing |
| ISC | 2 | `node-cron`, `lucide-react` | Functionally equivalent to MIT |
| BSD-2-Clause | 1 | `dotenv` | Permissive |
| MPL-2.0 | 1 | `web-push` | File-level copyleft; modifications to `web-push` source must be open-sourced; using the package as a library in a SaaS product is fine |

**No GPL or LGPL dependencies in runtime code.**

---

## Pinning Recommendations

The following client dependencies use `latest` and should be pinned to exact versions before production:

- `@supabase/supabase-js`
- `@supabase/ssr`
- `stripe`
- `date-fns`
- `recharts`
- `next-themes`
- `react-qr-code`

Run `npm install <package>@<exact-version>` and commit the updated `package-lock.json`.

---

## Review Cadence

| Trigger | Action |
|---|---|
| Quarterly | Run `npm audit` in `client/` and `backend/`; review this document for outdated versions |
| CVE advisory | Patch immediately; update version here |
| New dependency added | Add to this document in the same PR |
| Major version bump | Review changelog for breaking changes and license changes |

To run a security audit:

```bash
cd client && npm audit
cd ../backend && npm audit
```
