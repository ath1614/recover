import { LADDER, nextAttemptAt, type Invoice } from '../core/recovery';
import type { D1Database } from './env';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    customer TEXT NOT NULL,
    email TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invoices_by_user ON invoices (user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    invoice_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_by_user ON events (user_id, created_at DESC)`,
];

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
}

const CUSTOMERS = [
  ['Aarav Mehta', 'aarav@northloop.in'],
  ['Devika Rao', 'devika@studio27.co'],
  ['Kabir Shah', 'kabir@paperkite.dev'],
  ['Meera Iyer', 'meera@runwaylabs.io'],
  ['Rohan Gupta', 'rohan@framebase.app'],
  ['Sana Kapoor', 'sana@tiffin.club'],
  ['Nikhil Verma', 'nikhil@oddlymade.com'],
  ['Tara Nair', 'tara@monsoonseo.in'],
  ['Aditya Bose', 'aditya@stackfern.dev'],
  ['Priya Menon', 'priya@lumenops.io'],
  ['Vikram Sethi', 'vikram@quietparts.in'],
  ['Ananya Joshi', 'ananya@brightfold.co'],
];

const REASONS = [
  'card_expired',
  'insufficient_funds',
  'do_not_honor',
  'authentication_required',
];

const PLANS = [29900, 49900, 99900, 149900, 249900, 499900];

/** A tiny deterministic generator so a seeded dashboard looks identical on every machine. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const seedFrom = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Give a new account a desk worth looking at: a mix of open failures, recovered money and one
 * write-off, spread across the last three weeks so the sparkline has a shape.
 */
export async function seedUser(db: D1Database, userId: string): Promise<void> {
  const existing = await db
    .prepare('SELECT COUNT(*) AS count FROM invoices WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const random = rng(seedFrom(userId));
  const now = Date.now();
  const day = 86_400_000;
  const statements: ReturnType<D1Database['prepare']>[] = [];

  for (let index = 0; index < 22; index += 1) {
    const [customer, email] = CUSTOMERS[Math.floor(random() * CUSTOMERS.length)];
    const amount = PLANS[Math.floor(random() * PLANS.length)];
    const reason = REASONS[Math.floor(random() * REASONS.length)];
    const createdAt = now - Math.floor(random() * 21) * day - 3_600_000;
    const roll = random();
    const id = `inv_${userId.slice(0, 6)}_${index.toString().padStart(3, '0')}`;

    let status: Invoice['status'];
    let attempts: number;
    let nextAt: number | null = null;
    let updatedAt = createdAt;

    if (roll < 0.5) {
      status = 'recovered';
      attempts = 1 + Math.floor(random() * 3);
      updatedAt = createdAt + Math.floor(random() * 5) * day + 7_200_000;
    } else if (roll < 0.85) {
      status = random() < 0.5 ? 'failed' : 'recovering';
      attempts = Math.floor(random() * 3);
      const ladderFrom = now - Math.floor(random() * 6) * 3_600_000;
      nextAt = nextAttemptAt(ladderFrom, attempts);
      updatedAt = createdAt + attempts * 3_600_000;
    } else if (roll < 0.95) {
      status = 'failed';
      attempts = LADDER.length;
      nextAt = null;
      updatedAt = now - Math.floor(random() * 2) * day;
    } else {
      status = 'written_off';
      attempts = LADDER.length;
      updatedAt = createdAt + 9 * day;
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO invoices
            (id, user_id, customer, email, amount, currency, status, attempts, next_attempt_at, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, customer, email, amount, status, attempts, nextAt, reason, createdAt, updatedAt),
    );

    statements.push(
      db
        .prepare('INSERT INTO events (id, user_id, invoice_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(
          `evt_${id}_open`,
          userId,
          id,
          'charge.failed',
          `${customer} · ${reason.replace(/_/g, ' ')} · ₹${(amount / 100).toLocaleString('en-IN')}`,
          createdAt,
        ),
    );

    if (status === 'recovered') {
      statements.push(
        db
          .prepare('INSERT INTO events (id, user_id, invoice_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(
            `evt_${id}_win`,
            userId,
            id,
            'charge.succeeded',
            `Recovered on attempt ${attempts} · ${customer}`,
            updatedAt,
          ),
      );
    }
    if (status === 'written_off') {
      statements.push(
        db
          .prepare('INSERT INTO events (id, user_id, invoice_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(`evt_${id}_off`, userId, id, 'invoice.written_off', `Ladder exhausted · ${customer}`, updatedAt),
      );
    }
  }

  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

export const DEMO_EMAIL = 'demo@recover.app';
export const DEMO_PASSWORD = 'demo1234';
