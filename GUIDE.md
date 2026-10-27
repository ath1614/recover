# Recover — the beginner's guide

You do not need to know Cloudflare, React or databases to read this. Start at the top and stop when
you have what you need.

## 1. What is this thing?

A subscription business charges a customer every month. Sometimes the card fails — it expired, the
account was short, the bank said no. That is called a **failed payment**, and the process of chasing
it is called **dunning**.

Recover is a small website that does that chasing:

1. A payment fails. The invoice appears on a desk with a reason ("card expired").
2. The desk retries it later — after an hour, six hours, a day, three days. Not instantly, because a
   bank that said "insufficient funds" at 2am may say yes at 10am.
3. After four attempts it stops, and you either got the money or you write it off.

The whole point is to make one number honest: **how much of the money came back**.

## 2. The one idea

> Retry on a schedule that respects the customer, and measure recovery in rupees, not invoices.

A ₹499 recovery and an ₹8,999 recovery are not the same win. A desk that says "we recovered 90% of
invoices" may have recovered 20% of the money. Recover divides by amount, and it only counts cases
that are finished.

## 3. What you see

- **Landing page** (`/`) — the pitch. The tilted receipt on the right is the whole product in one
  object: failed attempt, two retries, recovered.
- **Sign in / Create account** — email and password. There is a demo button so a visitor can look
  around without signing up.
- **The desk** (`/api/desk` feeds it) — four numbers, a chart, a queue, and an activity feed.

## 4. How a click travels

You press **Retry** on an invoice:

```
browser  ──POST /api/invoices/inv_123/retry──▶  Worker
                                                 │ 1. read the session cookie
                                                 │ 2. load the invoice (scoped to your user id)
                                                 │ 3. is the ladder exhausted? → 409
                                                 │ 4. attempt++, decide win/lose
                                                 │ 5. UPDATE invoice + INSERT event
                                                 ▼
browser  ◀── JSON: { won, attempt, summary, invoices, events } ── D1 (SQLite)
```

The browser never decides whether a retry worked. It asks, and redraws what it is told.

## 5. The files, in reading order

| File | What it is |
| --- | --- |
| `src/core/recovery.ts` | The maths, with no database or framework. Read this first. |
| `src/core/recovery.test.ts` | The tests that pin the maths down. |
| `src/server/auth.ts` | Password hashing and session cookies. |
| `src/server/schema.ts` | The database tables, and the 22-invoice seed. |
| `src/server/index.ts` | The API: auth routes, `/api/desk`, retry, write-off. |
| `src/App.tsx` | The three screens in one file: landing, auth, desk. |
| `src/styles.css` | The design system (paper, oxblood, serif display). |

## 6. Run it

```bash
npm install
npm run dev:api   # terminal 1 — the API on http://127.0.0.1:8787
npm run dev       # terminal 2 — the site on http://127.0.0.1:5173
npm test          # the maths tests
```

The first request creates the tables and seeds the demo desk. If you want a clean slate, delete
`.wrangler/state`.

## 7. Security, in plain words

- A password is never stored. It is run through **PBKDF2** (a deliberately slow hash) with a random
  **salt**, and only the result is kept. Slow is the feature: guessing a million passwords takes too
  long.
- A session is a random long string in a cookie marked `httpOnly` — JavaScript cannot read it, so a
  bad script on the page cannot steal it. The database stores only a hash of that string, so a
  database leak does not hand anyone a working login.
- Every invoice query includes `user_id = ?`, so one account cannot read another's desk even if it
  guesses an id.
- Unsafe requests (POST) are refused if the `Origin` header says they came from another site.

## 8. Words you will meet

| Word | Meaning here |
| --- | --- |
| **Minor units** | Money stored as whole numbers (paise/cents), never floats. ₹499 is `49900`. |
| **Dunning** | The process of recovering failed recurring payments. |
| **Ladder** | The fixed backoff schedule: 1h, 6h, 1d, 3d. |
| **Write-off** | Accepting the loss and closing the invoice. |
| **D1** | Cloudflare's SQLite database, reached through a binding called `DB`. |
| **Worker** | The server: one JavaScript file running at the edge. |

## 9. Try these

1. Open `src/core/recovery.ts` and change `0.62` to `0.9`. Run `npm test`. Which test fails, and why
   is that a good test?
2. Add a fifth step to `LADDER`. What breaks in the UI if you forget `MAX_ATTEMPTS`?
3. Sign up with a new email. The desk is seeded — find where `seedUser` decides how many invoices to
   create.
4. In the desk, write off an invoice. Watch `summary.recoveryRate` change, and explain why a
   write-off *lowers* the rate even though nothing new was lost.

## 10. Limits (say these out loud in an interview)

The retry is simulated: no card is charged, and the outcome is deterministic from the invoice id so a
demo repeats exactly. A real system would hand the retry to Stripe or Razorpay, respect their decline
codes, and email the customer before attempt four.
