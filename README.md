# Recover

**Failed payments, recovered.**

A dunning desk for subscription billing. Every failed renewal lands with its decline reason, moves
down a four-step retry ladder, and is measured by the one number that matters: rupees recovered
over rupees resolved.

Live: **https://site-5c739fdc264c443c8d3ddf6fc15d8d1e.freebuff.page**
Demo: **demo@recover.app / demo1234** (or press “Look around with the demo desk”)

## Why

Most churn notifications say “a payment failed”. That is not actionable. A dunning desk answers the
three questions that are: which invoice, why it failed, and whether the next retry is worth making.
Recover is that desk, with the retry ladder and the maths on the same screen.

## What it does

- **Accounts.** Email and password sign-up, PBKDF2-SHA256 hashing, httpOnly session cookies, and a
  demo account that can be reset from the header.
- **A retry ladder.** 1 hour, 6 hours, 1 day, 3 days. Four attempts, then the invoice is exhausted
  and can only be written off.
- **Honest recovery rate.** Recovered amount over recovered plus written-off amount. Unresolved
  invoices are excluded, so the number cannot be flattered by an open queue.
- **Per-account desks.** A new account is seeded with 22 invoices and their events, deterministic
  from the account id, so the demo and a real signup behave the same way.

## Stack

TypeScript, React 19, Vite, Hono on Cloudflare Workers, D1. No UI framework: the stylesheet is the
design system.

## Run

```bash
npm install
npm run dev:api   # Worker + local D1 on :8787
npm run dev       # Vite on :5173, proxying /api
npm test          # 8 tests on the dunning maths
npm run build     # typecheck + bundle the SPA
npm run build:deploy
```

The Worker creates the schema on the first request and seeds the demo desk once. Local D1 state
lives in `.wrangler/state`; delete it to start over.

## Security notes

- Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers runtime ceiling), 16-byte salt per user.
- Sessions: 256-bit random token in an httpOnly, SameSite=Lax cookie; only its SHA-256 digest is stored.
- Mutations require a same-origin `Origin` header; cross-site posts are refused with 403.
- Login attempts are limited to five per five minutes per client.
- Every invoice query is scoped by `user_id`, so one account cannot read another's desk.

## Tests

`npm test` covers the summary maths (recovery rate, due-now, zero-state), the ladder's monotonic
backoff, deterministic retry outcomes, and the 14-day recovery series.

## Limits

Retries are simulated — the desk never touches a card, and the outcome is a deterministic function
of the invoice id so a demo can be repeated. A production system would delegate the retry to the
processor, honour its decline-code semantics, and send the customer an email before attempt four.

## License

MIT. Built by [Atharv Soni](https://github.com/ath1614).
