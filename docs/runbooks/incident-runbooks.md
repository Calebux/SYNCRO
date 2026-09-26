# Incident Runbooks — Money-Losing Failure Modes

Repo: Calebux/SYNCRO · Issue #1519 · [v3][ops]

> **Fill-in-required:** placeholders like `<ALERT_NAME>`, `<DASHBOARD_URL>`, `<ONCALL_CHANNEL>`,
> and exact CLI/API commands are marked because they depend on your actual monitoring stack,
> deployment tooling, and the concrete implementation of the meter store / settlement engine /
> indexer (see the note on issue #1523 — those internals need to be confirmed before these
> commands can be made literal). Everything else (sequencing, decision points, verification
> criteria) is stack-agnostic and ready to use.

Store this file at: `docs/runbooks/incident-runbooks.md`
(link it from `docs/archive/DIRECTORY_OWNERSHIP_MATRIX.md` or your ops README so it's discoverable
during an incident, not just in git history.)

---

## How to use this document

- Each runbook is self-contained. Don't read the whole file during an incident — jump to the
  matching section.
- "Immediate action" is what you do in the first 5 minutes, before root-causing anything.
- "Verify recovery" is a checklist, not a vibe. Don't close the incident until every box is true.
- Rehearsal means running the detection + immediate-action steps in staging with a synthetic
  trigger, timing it, and recording the result in `docs/runbooks/rehearsal-log.md` (create this
  alongside the runbooks — see template at the bottom).

---

## Runbook 1 — Meter store down

**What this means:** the service of record for usage/meter data is unreachable or returning
errors. New usage cannot be read or written reliably.

**Detection**
- Alert: `<ALERT_NAME_METER_STORE_DOWN>` — health check / connection pool exhaustion / query
  timeout rate above threshold on the meter store.
- Manual signal: meter-read API error rate spikes, or reminder/billing jobs start failing with
  meter-lookup errors.

**Immediate action**
1. Declare degraded mode: flip the meter-store feature flag / circuit breaker
   (`<FLAG_OR_CONFIG_KEY>`) so dependent services stop hammering a dead store and instead:
   - Queue writes locally (durable local buffer, not in-memory) instead of dropping them.
   - Serve reads from last-known-good cache where staleness is tolerable; mark responses as
     `stale: true` so callers can decide whether to trust them.
2. **Bound exposure**: identify anything that uses meter data to authorize spend or release
   funds (e.g. settlement triggers, virtual-card funding decisions) and pause those specific
   paths — not the whole system — until the store is back or a manual override is approved.
   Record the pause time; this is your exposure window.
3. Notify: post to `<ONCALL_CHANNEL>` with template:
   > 🔴 Meter store down since `<TIME>`. Degraded mode active. Exposure paths paused: `<LIST>`.
   > Owner: `<NAME>`.

**Reconcile after**
1. Once the store is confirmed healthy (not just "responding" — check write durability, not
   just read latency), replay the local write buffer in order, deduping by idempotency key.
2. Cross-check every reading that was buffered or served stale against the source of truth
   (device/agent reports, chain state, or whatever upstream produced the meter data) before
   trusting it for anything that touches settlement.
3. Un-pause exposure paths only after the reconciliation pass completes with zero unexplained
   deltas — if there are deltas, treat as Runbook 4 (reconciliation delta) first.

**Notify**
- On declare: `<ONCALL_CHANNEL>` + page `<ESCALATION_POLICY>` if exposure paths were paused.
- On resolve: same channel, plus a written postmortem if the exposure window exceeded
  `<THRESHOLD>` minutes or any settlement path was affected.

**Verify recovery**
- [ ] Meter store health check green for `<N>` consecutive minutes.
- [ ] Write buffer fully replayed, buffer empty.
- [ ] Reconciliation pass shows zero unexplained deltas.
- [ ] Exposure paths un-paused and confirmed processing normally.
- [ ] Incident timeline recorded (declare time, exposure window, resolve time).

---

## Runbook 2 — Settlement engine stalled

**What this means:** signed states are being produced (or received) but the settlement engine
isn't advancing them — nothing is being flushed to chain / finalized.

**Detection**
- Alert: `<ALERT_NAME_SETTLEMENT_LAG>` — queue depth or oldest-unsettled-state age exceeds
  threshold.
- Manual signal: settlement dashboard `<DASHBOARD_URL>` shows a growing backlog with no
  corresponding on-chain confirmations.

**Immediate action**
1. **Measure unsettled exposure first, before touching anything.** Sum the value represented by
   every unflushed signed state currently held. This number is what's at risk right now — write
   it down, it's the headline of your incident report.
2. Check whether the stall is: (a) the engine process itself wedged/crashed, (b) starved of a
   dependency (chain RPC, key-signing service, the meter/signed-state store itself), or (c)
   backpressured by something downstream (e.g. chain congestion, insufficient fee balance).
3. **Force a flush**: trigger the engine's manual flush path (`<FLUSH_COMMAND_OR_ENDPOINT>`) for
   the oldest N unsettled states, prioritized by value at risk, not by age alone.
4. If the flush also fails, escalate immediately — a stalled settlement engine that also can't
   be manually flushed is a Runbook 5-adjacent situation (assess whether the signing key itself
   is the blocker) even without confirmed compromise.

**Assess risk**
- For every unsettled state older than `<COUNTERPARTY_DISPUTE_WINDOW>`, treat it as actively at
  risk of a stale-close dispute (Runbook 3) — counterparties can act on old state while yours
  sits unflushed.
- Rank by value, not by count: three small stuck states are less urgent than one large one.

**Notify**
- Declare with the unsettled-exposure number in the first message — that's the number that
  determines how loud the page should be.
- Page `<ESCALATION_POLICY>` immediately if exposure exceeds `<DOLLAR_THRESHOLD>` or any
  unsettled state is within `<TIME_MARGIN>` of a dispute window closing.

**Verify recovery**
- [ ] Settlement queue depth back under threshold.
- [ ] Every previously-unsettled state confirmed on chain (not just "sent" — confirmed).
- [ ] No state exceeded its counterparty dispute window unflushed (or if one did, Runbook 3 was
      triggered for it and resolved).
- [ ] Root cause of the stall identified and either fixed or explicitly deferred with an owner
      and date.

---

## Runbook 3 — Stale-state close detected

**What this means:** a counterparty has published (or attempted to publish) a settlement close
using a state that is not the newest signed state — they're trying to close at a stale, more
favorable-to-them balance.

**Detection**
- Alert: `<ALERT_NAME_STALE_CLOSE>` — a close/finalization event was observed on-chain (or via
  the indexer) whose state sequence number is lower than the highest sequence number your
  signed-state store holds for that channel/counterparty.
- This should be treated as **always urgent** — there is a dispute window and it is closing from
  the moment the stale close lands.

**Immediate action**
1. **Verify** before disputing: confirm the on-chain (or indexed) close's sequence number against
   your signed-state store's latest signed state for that same channel. Check the signature is
   valid and the state is actually newer — don't dispute based on a stale read from your own
   store (see Runbook 6 if the indexer itself might be lagging).
2. **Dispute**: submit the newest valid signed state to the dispute/challenge mechanism before
   the dispute window closes. This is a hard deadline — automate the check-and-submit if it
   isn't already, and treat any manual dispute as a near-miss worth fixing.
3. **Escalate**: this is an active adversarial event. Notify `<ONCALL_CHANNEL>` and
   `<SECURITY_CONTACT>` immediately, regardless of the value involved — a counterparty attempting
   a stale close is a signal worth tracking even on small channels, since it may indicate a
   pattern or a compromised counterparty key.

**Notify**
- Immediate page, not just a channel post — the dispute window is a countdown.
- Include: channel/counterparty ID, stale sequence number, correct sequence number, dispute
  deadline, value at stake.

**Verify recovery**
- [ ] Dispute submitted and confirmed on-chain before the window closed.
- [ ] Final settled balance matches your signed-state store's latest state, not the stale one.
- [ ] Counterparty and channel flagged for review (repeat offenders should be blocked or
      required to re-establish channels with tighter terms).
- [ ] Incident logged even if the dispute succeeded cleanly — near-misses on timing matter.

---

## Runbook 4 — Reconciliation delta outside tolerance

**What this means:** your internal ledger (meter store + settlement store) doesn't match the
chain (or the indexer's view of the chain) by more than the accepted tolerance.

**Detection**
- Alert: `<ALERT_NAME_RECON_DELTA>` — scheduled or continuous reconciliation job reports a delta
  beyond `<TOLERANCE_THRESHOLD>`.

**Immediate action**
1. **Block settlement** for the affected channel(s)/account(s) immediately — don't let new
   settlements layer on top of a ledger you don't trust yet. This is a targeted block, not a
   system-wide freeze, unless the delta is systemic (many accounts, same magnitude — see below).
2. **Classify** the delta:
   - Timing artifact (reconciliation ran mid-flight, e.g. against unconfirmed chain state) →
     re-run reconciliation after confirmation depth `<N_BLOCKS>`.
   - Indexer lag (Runbook 6) → don't trust the "chain" side of the comparison until the indexer
     is caught up; re-run after.
   - Genuine ledger bug (double-count, missed event, sign error) → this is the dangerous case,
     treat as a P1.
   - Systemic (same delta pattern across many accounts) → likely a code/migration bug, escalate
     to engineering leadership immediately, this is not an ops-only incident.
3. Resolve: fix the root cause per classification above, then re-run reconciliation and confirm
   the delta clears before un-blocking settlement for affected accounts.

**Notify**
- `<ONCALL_CHANNEL>` on detection with the delta size and affected scope.
- Escalate to engineering lead if classification points to a genuine ledger bug or systemic
  issue — don't let this sit as an ops ticket if the root cause is a code defect.

**Verify recovery**
- [ ] Delta root-caused and classified.
- [ ] Fix applied (or confirmed as a timing/indexer artifact that resolved itself on re-run).
- [ ] Re-run reconciliation shows delta within tolerance.
- [ ] Settlement un-blocked only for accounts confirmed clean.
- [ ] If genuine bug: postmortem written, and a check added so this class of delta triggers
      faster next time.

---

## Runbook 5 — Settlement key compromise

**What this means:** the key used to sign settlement states (or close/dispute transactions) is
suspected or confirmed compromised.

**Detection**
- Alert: unexpected signing activity, signing from an unrecognized source/IP, or external report
  (e.g. a counterparty flags a signature you didn't produce).
- Treat *suspected* compromise with the same urgency as *confirmed* — the cost of a false
  positive (brief service disruption) is far lower than the cost of a false negative.

**Immediate action**
1. **Revoke** the key's ability to sign immediately — pull it from the signing service /
   rotate access / disable the HSM slot, whatever your key-management setup requires
   (`<KEY_REVOCATION_PROCEDURE>`). Do this before investigating further; you can always
   re-enable if it turns out to be a false alarm, but every minute a compromised key stays live
   is unbounded exposure.
2. **Close channels**: begin cooperative or forced closes on every channel this key has
   authority over, prioritized by value. A compromised signing key means an attacker may be able
   to produce valid-looking states — the only safe posture is to get funds to a settled,
   final position on a *new* key as fast as possible.
3. **Assess loss**: for every channel, compare the last state you know is legitimate (from
   before the suspected compromise window) against what actually settled. Any gap is a
   candidate loss.

**Notify**
- Immediate page to `<SECURITY_CONTACT>` and `<ESCALATION_POLICY>` — this is an all-hands
  incident, not a solo on-call task.
- Notify affected counterparties once closes are underway, per your disclosure policy.

**Verify recovery**
- [ ] Old key fully revoked (confirmed by attempting and failing a test sign, not just "it should
      be disabled").
- [ ] All channels under the compromised key closed or migrated to a new key.
- [ ] Loss assessment complete and documented, even if the number is zero.
- [ ] New key provisioned with tighter access controls than the one that was compromised
      (this is the point where you fix whatever allowed the compromise, not just react to it).
- [ ] Postmortem written; this always gets one, regardless of confirmed vs. suspected outcome.

---

## Runbook 6 — Indexer lag beyond threshold

**What this means:** the indexer's view of chain state is behind the actual chain by more than
the acceptable threshold — anything reading "current state" through the indexer may be looking
at stale data.

**Detection**
- Alert: `<ALERT_NAME_INDEXER_LAG>` — indexer's last-processed block/ledger height vs. chain tip
  exceeds `<LAG_THRESHOLD>`.

**Immediate action**
1. **Stop serving stale reads**: flip the indexer's readiness flag so downstream consumers
   (reconciliation, dispute-window checks, dashboards) either fail closed or explicitly mark
   responses as stale rather than silently serving old data as current. This matters most for
   anything feeding Runbook 3 or Runbook 4 — a stale-close check run against a lagging indexer
   is worse than useless, it's actively misleading.
2. Diagnose why the indexer is behind: resource-starved, upstream RPC issues, a poison event it's
   stuck retrying, or a genuine backlog from a burst of chain activity.
3. **Replay**: once the blocker is cleared, let the indexer replay from its last confirmed
   checkpoint. Don't skip ahead to "catch up" by starting from the current tip — that would
   silently drop the events in the gap.

**Notify**
- `<ONCALL_CHANNEL>` on detection.
- Escalate if lag exceeds the window used for dispute/reconciliation checks (Runbooks 3 and 4
  depend on indexer freshness — a prolonged lag means those runbooks may be operating blind).

**Verify recovery**
- [ ] Indexer caught up to within normal lag tolerance.
- [ ] Replay confirmed to have processed every block/ledger in the gap (no skip-ahead).
- [ ] Readiness flag restored to normal; stale-read guard lifted.
- [ ] Any dispute-window or reconciliation checks that ran during the lag window are re-run now
      that the indexer is caught up.

---

## Rehearsal log template

Create `docs/runbooks/rehearsal-log.md` with entries like:

```
## Runbook 1 — Meter store down
Date: <date>
Environment: staging
Trigger method: <how you simulated it>
Time to declare degraded mode: <duration>
Time to reconcile and un-pause: <duration>
Gaps found: <anything the runbook didn't cover>
Runbook updated: yes/no
```

Per the issue's done-when criteria, Runbooks 1–3 need at least one staging rehearsal logged
before this is closed out; 4–6 should follow once the first three are proven out.