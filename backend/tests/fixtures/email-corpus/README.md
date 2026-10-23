# Subscription email golden corpus

Ground truth for the subscription email parser, plus the baseline CI gates on.
Added for issue #1280.

## Why this exists

Email parsing accuracy is the product's core value proposition, and before this
corpus there was no measurement of it. Changing a regex or a prompt was
unverifiable — nothing reported whether precision or recall moved — which made
the parser effectively frozen.

## Layout

```
email-corpus/
  cases/<case-id>.json   one case per file
  baseline.json          the committed accuracy floor CI compares against
  README.md              this file
```

## Case format

```jsonc
{
  "id": "netflix-en-monthly-receipt",  // must equal the filename
  "merchant": "Netflix",
  "locale": "en",                      // ISO 639-1
  "kind": "positive",                  // "positive" | "negative"
  "notes": "Why this case is in the corpus.",
  "email": { "subject": "...", "from": "...", "body": "..." },
  "expected": {                        // null for negatives
    "name": "Netflix",
    "amount": 15.99,
    "currency": "USD",
    "interval": "monthly"
  }
}
```

`expected` is **human ground truth** — what the email actually means — not what
the parser currently returns. That is the whole point: the gap between the two
is what the baseline measures.

`negative` cases are emails that must *not* be parsed as subscriptions. They
include deliberately ambiguous ones (a bank charge alert, a utility bill, a
one-off receipt, a cancellation confirmation, a promotional trial offer), because
obvious negatives do not exercise precision.

## Redaction policy

**No real personal data may be committed here.** Every case is synthetic:

- Sender addresses are role accounts (`billing@`, `no-reply@`) on either a public
  merchant domain or a reserved `.example` domain, which can never be registered.
- No recipient names, consumer mailbox addresses, card or account numbers, phone
  numbers, postal addresses, IP addresses, tokens or session identifiers.
- Amounts and dates are invented.

`backend/tests/email-corpus-redaction.test.ts` enforces all of the above and runs
in CI. If you add a case, it must pass that scan.

## Running the harness

```bash
# score the parser against the corpus and gate on the baseline
npm test -w backend -- email-parser-corpus

# same, printing the full Markdown report
VERBOSE=1 npm test -w backend -- email-parser-corpus
```

CI publishes the report to the workflow job summary.

## Updating the baseline

The baseline is a **measured floor, not a target**. Accuracy improvements are
always allowed; regressions fail the build. When you genuinely improve the parser
or add cases, regenerate it and commit the result with the change that caused it:

```bash
npx ts-node backend/scripts/update-email-corpus-baseline.ts
```

Never regenerate the baseline to make a red build go green — that is exactly the
failure mode this gate exists to prevent.
