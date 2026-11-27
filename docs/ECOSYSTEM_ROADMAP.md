# SYNCRO Post-v3 Ecosystem Roadmap

**Tracking epic:** [#1405](https://github.com/Calebux/SYNCRO/issues/1405)  
**Roadmap issue:** [#1883](https://github.com/Calebux/SYNCRO/issues/1883)  
**Last reviewed:** 2026-11-25  

---

## Purpose & Relationship to the v3 Rewrite

SYNCRO is transitioning from a self-custodial subscription manager to a **pay-per-call settlement layer on Stellar** for autonomous agents, tracked in the v3 rewrite epic ([#1405](https://github.com/Calebux/SYNCRO/issues/1405)). The core TypeScript consumer and provider SDKs ([#1489](https://github.com/Calebux/SYNCRO/issues/1489), [#1492](https://github.com/Calebux/SYNCRO/issues/1492)) establish the initial baseline.

Once the v3 rewrite lands, contributors and integrators need a forward view of the surrounding ecosystem work across three tracks:

1. **SDK languages & runtimes** — bringing paid-call clients and conformance testing beyond the initial TypeScript `fetch` wrapper (building on the language-bindings assessment in [#1497](https://github.com/Calebux/SYNCRO/issues/1497)).
2. **Framework & provider integrations** — connecting agent frameworks, MCP tools, edge runtimes, and existing APIs to SYNCRO metering and settlement.
3. **Protocol interoperability** — enabling cross-protocol payment negotiation and compatibility where feasible.

Items below are grouped into **NOW**, **NEXT**, and **LATER** based on current issue dependencies and readiness:

- **NOW** covers immediate post-rewrite priorities that build directly on the core TypeScript SDK and gateway.
- **NEXT** covers upcoming ecosystem expansion once the immediate SDK and conformance foundations are in place.
- **LATER** covers longer-term possibilities and exploratory evaluations. **Items in LATER—and any exploratory research issues—are not approved or guaranteed deliverables.**

---

## NOW — Immediate Post-Rewrite Priorities

Work in this bucket builds directly on the v3 gateway and TypeScript SDK to unblock early adopters, Python agents, MCP hosts, and x402 interoperability.

### SDK Languages & Conformance

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| Paid-request interceptors for `axios`, `ky`, and `undici` | SDK | [#1810](https://github.com/Calebux/SYNCRO/issues/1810) | Reuses the `createPaidFetch` core so JS/TS codebases do not need to replace their HTTP client. |
| Python consumer client (`paid_fetch` for `httpx`) | SDK | [#1812](https://github.com/Calebux/SYNCRO/issues/1812) | Concrete first non-TypeScript binding following [#1497](https://github.com/Calebux/SYNCRO/issues/1497), verified against shared signing vectors. |
| Cross-SDK conformance test suite | SDK | [#1815](https://github.com/Calebux/SYNCRO/issues/1815) | Language-agnostic HTTP-level test suite covering challenge parsing, signing, retries, and receipt verification across SDKs. |

### Framework & Provider Integrations

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| MCP wallet server (`@syncro/mcp-wallet`) | Integrations | [#1817](https://github.com/Calebux/SYNCRO/issues/1817) | Exposes budgeted `paid_fetch`, `quote`, `budget_status`, and `list_receipts` tools for any MCP client. |
| Vercel AI SDK tool helper | Integrations | [#1819](https://github.com/Calebux/SYNCRO/issues/1819) | Wraps paid HTTP routes as AI SDK tools with per-call `maxPrice` limits via `createPaidFetch`. |
| Generic LLM function-calling adapter | Integrations | [#1821](https://github.com/Calebux/SYNCRO/issues/1821) | Framework-neutral JSON Schema tool definition and `createPaidFetch` executor for raw tool-use loops. |
| Provider middleware for Cloudflare Workers | Integrations | [#1824](https://github.com/Calebux/SYNCRO/issues/1824) | Workers-native provider middleware using WebCrypto and Workers storage without Node built-ins. |

### Protocol Interoperability

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| x402 interoperability for challenges and payment headers | Interop | [#1822](https://github.com/Calebux/SYNCRO/issues/1822) | Maps SYNCRO challenges to x402 `PaymentRequirements`, adds optional compatibility mode, and documents differences. |

---

## NEXT — Upcoming Ecosystem Expansion

Work in this bucket extends language coverage, provider-side tooling, discovery, and multi-SDK governance once the NOW items are underway.

### SDK Languages

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| Go client (`http.RoundTripper`) | SDK | [#1813](https://github.com/Calebux/SYNCRO/issues/1813) | Paying `http.RoundTripper` for Go agents and backend services, tested against shared vectors. |
| Rust client crate | SDK | [#1814](https://github.com/Calebux/SYNCRO/issues/1814) | Shares `no_std`-friendly channel-state encoding with Soroban contracts and provides a `reqwest`-based client. |

### Framework & Provider Integrations

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| Provider-side metering for MCP servers | Integrations | [#1818](https://github.com/Calebux/SYNCRO/issues/1818) | `meteredTool(handler, pricing)` wrapper for the MCP TypeScript SDK (HTTP/SSE first). |
| LangChain & LangGraph tool and callback handler | Integrations | [#1820](https://github.com/Calebux/SYNCRO/issues/1820) | JS tool wrapper and spend-reporting callback handler first; Python version follows [#1812](https://github.com/Calebux/SYNCRO/issues/1812). |
| Zero-code reverse-proxy mode | Integrations | [#1825](https://github.com/Calebux/SYNCRO/issues/1825) | Standalone proxy in front of existing HTTP APIs for 402 handling, metering, and receipts. |
| OpenAPI route pricing generator | Integrations | [#1827](https://github.com/Calebux/SYNCRO/issues/1827) | Scaffolds a declarative provider pricing file from an OpenAPI specification. |
| Provider discovery manifest (`/.well-known/syncro.json`) | Integrations | [#1828](https://github.com/Calebux/SYNCRO/issues/1828) | Machine-readable discovery of accepted assets, pricing, and receipt-signing keys. |

### Governance & Compatibility

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| Gateway API and SDK versioning policy & compatibility matrix | Governance | [#1882](https://github.com/Calebux/SYNCRO/issues/1882) | Defines version compatibility and support windows across the gateway API, contracts, and multiple SDKs. |

---

## LATER — Longer-Term & Exploratory Work

Items in this section are longer-term candidates or exploratory evaluations. Inclusion here indicates interest and problem framing, **not** an approved commitment or delivery schedule.

| Item | Track | GitHub Issue | Notes |
|------|-------|--------------|-------|
| Evaluate interop with other machine-payment protocols | Interop | [#1823](https://github.com/Calebux/SYNCRO/issues/1823) | Exploratory survey of protocols such as MPP and Lightning L402, culminating in a go/no-go ADR. |
| Envoy `ext_authz` admission plugin | Integrations | [#1826](https://github.com/Calebux/SYNCRO/issues/1826) | External authorization service for providers running Envoy or Istio service meshes. |
| Public provider directory API | Integrations | [#1829](https://github.com/Calebux/SYNCRO/issues/1829) | Searchable directory of registered providers by category, unit, asset, and price. |
| Fiat on-ramp via SEP-24 anchors | Integrations | [#1830](https://github.com/Calebux/SYNCRO/issues/1830) | Guided SEP-24 anchor deposit flow to fund agent channels without holding USDC upfront. |
| Accounting exports for usage, fees, and payouts | Integrations | [#1831](https://github.com/Calebux/SYNCRO/issues/1831) | Accountant-friendly exports of settlement, fee, and payout records. |

---

## Community Proposals & Voting

Community members, integrators, and contributors are encouraged to propose new SDK languages, framework integrations, and protocol interoperability initiatives using the repository's existing GitHub issue workflow.

### How to Propose an Initiative

1. **Check existing issues first** — search open and closed issues (including [`v3-rewrite`](https://github.com/Calebux/SYNCRO/labels/v3-rewrite)) to avoid duplicates and see if a related thread already exists.
2. **Submit a Feature Request** — open a new GitHub Issue using the [Feature Request template](../.github/ISSUE_TEMPLATE/feature_request.md) (`[FEAT] ...`). This automatically applies `status:triage` and `type:feature` per the [Issue Triage & Backlog Governance Policy](./issue-triage-policy.md).
3. **Include key context** — in your issue description, clearly explain:
   - **Purpose & problem:** what gap the SDK, integration, or protocol bridge addresses.
   - **Expected benefits & use cases:** who benefits (agent developers, API providers, principals) and concrete usage scenarios.
   - **Technical considerations:** target runtime/protocol, signing or receipt-verification requirements, dependencies on existing v3 primitives, and any compatibility constraints.

### How to Discuss & Vote

- **Vote with reactions:** add a `👍` (`+1`) reaction to the opening comment of a proposal issue to signal demand or support.
- **Add constructive context:** comment on the issue with your specific use case, production constraints, or willingness to help implement or test the integration.

### How Maintainers Review Proposals

- New proposals enter the standard triage and backlog grooming flow described in [issue-triage-policy.md](./issue-triage-policy.md), where maintainers classify them by `area:`, `priority:`, and `risk:`.
- Maintainers weigh community support (`👍` reactions and substantive use-case comments) alongside architectural fit, security/risk, maintenance burden, and dependencies on the core v3 stack.
- Community votes and feedback directly inform prioritization and quarterly roadmap updates, but do not automatically guarantee implementation or override maintainer decisions.

---

## Quarterly Roadmap Review

Maintainers review this roadmap **every quarter** (every three months) as part of ongoing backlog governance to keep it accurate and aligned with the state of the v3 ecosystem. Each quarterly review:

1. **Reassesses priorities and groupings** — promotes, re-sequences, or defers items across **NOW**, **NEXT**, and **LATER** based on progress, dependencies, and maintainer capacity.
2. **Updates issue links and status** — reflects completed work, closed or superseded issues, and newly opened ecosystem issues.
3. **Incorporates community input** — reviews highly upvoted or well-specified community proposals submitted through GitHub Issues.
4. **Records changes** — updates the **Last reviewed** date at the top of this page so contributors and integrators can see when the roadmap was last verified.

---

**Related docs:** [README.md](../README.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [issue-triage-policy.md](./issue-triage-policy.md) · [ROADMAP.md](./ROADMAP.md) (historical MVP roadmap)
