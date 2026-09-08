import { Hono } from 'hono';
import {
  MAX_ATTEMPTS,
  nextAttemptAt,
  recoverySeries,
  retrySucceeds,
  summarise,
  type DeskEvent,
  type Invoice,
} from '../core/recovery';
import {
  clearSessionCookie,
  clientKey,
  createSession,
  currentUser,
  newSalt,
  normaliseEmail,
  noteAttempt,
  passwordProblem,
  sameOrigin,
  setSessionCookie,
  stretch,
  timingSafeEqual,
  tooManyAttempts,
} from './auth';
import type { D1Database, Env, EventRow, InvoiceRow, UserRow } from './env';
import { DEMO_EMAIL, DEMO_PASSWORD, ensureSchema, seedUser } from './schema';

const app = new Hono<{ Bindings: Env }>();
let ready: Promise<void> | null = null;

async function ensureReady(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureSchema(db);
      const demo = await db.prepare('SELECT id, salt FROM users WHERE email = ?').bind(DEMO_EMAIL).first<{ id: string; salt: string }>();
      if (!demo) {
        const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
        const salt = newSalt();
        await db
          .prepare(
            `INSERT INTO users (id, email, name, password_hash, salt, is_demo, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
          )
          .bind(id, DEMO_EMAIL, 'Demo desk', await stretch(DEMO_PASSWORD, salt), salt, Date.now())
          .run();
        await seedUser(db, id);
      }
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  customer: row.customer,
  email: row.email,
  amount: row.amount,
  currency: row.currency,
  status: row.status as Invoice['status'],
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  reason: row.reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toEvent = (row: EventRow): DeskEvent => ({
  id: row.id,
  invoiceId: row.invoice_id,
  kind: row.kind,
  detail: row.detail,
  createdAt: row.created_at,
});

const publicUser = (user: UserRow) => ({ id: user.id, name: user.name, email: user.email });

app.use('/api/*', async (context, next) => {
  await ensureReady(context.env.DB);
  await next();
});

app.onError((error, context) => {
  return context.json(
    { error: error instanceof Error ? error.message : String(error), where: 'api' },
    500,
  );
});

app.use('/api/*', async (context, next) => {
  if (context.req.method !== 'GET' && !sameOrigin(context)) {
    return context.json({ error: 'Cross-origin request refused' }, 403);
  }
  await next();
});

app.get('/api/health', async (context) => {
  try {
    const counts = await context.env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM invoices) AS invoices',
    ).first<{ users: number; invoices: number }>();
    const started = Date.now();
    await stretch('probe-password', '00112233445566778899aabbccddeeff');
    return context.json({ ok: true, ...counts, hashMs: Date.now() - started });
  } catch (error) {
    return context.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

app.post('/api/auth/signup', async (context) => {
  type SignupBody = { name?: string; email?: string; password?: string };
  const body: SignupBody = await context.req.json<SignupBody>().catch(() => ({}) as SignupBody);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const email = normaliseEmail(body.email);
  const problem = passwordProblem(body.password);

  if (name.length < 2) return context.json({ error: 'Tell us your name' }, 422);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return context.json({ error: 'That email does not look right' }, 422);
  if (problem) return context.json({ error: problem }, 422);

  const existing = await context.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return context.json({ error: 'An account with that email already exists' }, 409);

  const salt = newSalt();
  const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
  await context.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, salt, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(id, email, name, await stretch(body.password as string, salt), salt, Date.now())
    .run();

  await seedUser(context.env.DB, id);
  setSessionCookie(context, await createSession(context.env.DB, id));
  return context.json({ user: { id, name, email } }, 201);
});

app.post('/api/auth/login', async (context) => {
  const key = clientKey(context);
  if (tooManyAttempts(key)) {
    return context.json({ error: 'Too many attempts. Try again in five minutes.' }, 429);
  }

  type LoginBody = { email?: string; password?: string };
  const body: LoginBody = await context.req.json<LoginBody>().catch(() => ({}) as LoginBody);
  const email = normaliseEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  const hash = user ? await stretch(password, user.salt) : await stretch(password, '00');
  const ok = Boolean(user && timingSafeEqual(hash, user.password_hash));
  noteAttempt(key, ok);

  if (!user || !ok) return context.json({ error: 'Email or password is wrong' }, 401);

  setSessionCookie(context, await createSession(context.env.DB, user.id));
  return context.json({ user: publicUser(user) });
});

app.post('/api/auth/demo', async (context) => {
  const user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(DEMO_EMAIL).first<UserRow>();
  if (!user) return context.json({ error: 'Demo desk is not available' }, 503);
  setSessionCookie(context, await createSession(context.env.DB, user.id));
  return context.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', async (context) => {
  clearSessionCookie(context);
  return context.json({ ok: true });
});

app.get('/api/me', async (context) => {
  const user = await currentUser(context, context.env.DB);
  if (!user) return context.json({ user: null }, 401);
  return context.json({ user: publicUser(user) });
});

async function loadDesk(db: D1Database, userId: string) {
  const [invoiceRows, eventRows] = await Promise.all([
    db.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all<InvoiceRow>(),
    db
      .prepare('SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .bind(userId)
      .all<EventRow>(),
  ]);
  const invoices = invoiceRows.results.map(toInvoice);
  return {
    summary: summarise(invoices),
    invoices,
    events: eventRows.results.map(toEvent),
    series: recoverySeries(invoices),
  };
}

app.get('/api/desk', async (context) => {
  const user = await currentUser(context, context.env.DB);
  if (!user) return context.json({ error: 'Sign in to see your desk' }, 401);
  const desk = await loadDesk(context.env.DB, user.id);
  return context.json({ user: publicUser(user), ...desk }, 200, { 'cache-control': 'no-store' });
});

app.post('/api/invoices/:id/retry', async (context) => {
  const user = await currentUser(context, context.env.DB);
  if (!user) return context.json({ error: 'Sign in first' }, 401);

  const row = await context.env.DB.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), user.id)
    .first<InvoiceRow>();
  if (!row) return context.json({ error: 'Invoice not found' }, 404);
  if (row.status === 'recovered' || row.status === 'written_off') {
    return context.json({ error: 'That invoice is closed' }, 409);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return context.json({ error: 'The retry ladder is exhausted. Write it off instead.' }, 409);
  }

  const attempt = row.attempts + 1;
  const now = Date.now();
  const won = retrySucceeds(row.id, attempt);

  const statements = [
    context.env.DB.prepare(
      'UPDATE invoices SET status = ?, attempts = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).bind(won ? 'recovered' : 'failed', attempt, won ? null : nextAttemptAt(now, attempt), now, row.id, user.id),
    context.env.DB.prepare('INSERT INTO events (id, user_id, invoice_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      `evt_${crypto.randomUUID().slice(0, 12)}`,
      user.id,
      row.id,
      won ? 'charge.succeeded' : 'charge.failed',
      won
        ? `Recovered on attempt ${attempt} · ${row.customer}`
        : `Attempt ${attempt} declined · ${row.reason.replace(/_/g, ' ')}`,
      now,
    ),
  ];
  await context.env.DB.batch(statements);

  const desk = await loadDesk(context.env.DB, user.id);
  return context.json({ won, attempt, ...desk });
});

app.post('/api/invoices/:id/write-off', async (context) => {
  const user = await currentUser(context, context.env.DB);
  if (!user) return context.json({ error: 'Sign in first' }, 401);

  const row = await context.env.DB.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), user.id)
    .first<InvoiceRow>();
  if (!row) return context.json({ error: 'Invoice not found' }, 404);
  if (row.status === 'recovered') return context.json({ error: 'Already recovered' }, 409);

  const now = Date.now();
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE invoices SET status = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind('written_off', now, row.id, user.id),
    context.env.DB.prepare('INSERT INTO events (id, user_id, invoice_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      `evt_${crypto.randomUUID().slice(0, 12)}`,
      user.id,
      row.id,
      'invoice.written_off',
      `Written off · ${row.customer}`,
      now,
    ),
  ]);

  const desk = await loadDesk(context.env.DB, user.id);
  return context.json(desk);
});

app.all('/api/*', (context) => context.json({ error: 'Not found' }, 404));

app.all('*', async (context) => {
  const response = await context.env.ASSETS.fetch(context.req.raw);
  if (response.status !== 404) return response;
  const url = new URL(context.req.url);
  if (url.pathname.includes('.')) return response;
  return context.env.ASSETS.fetch(new URL('/', url).toString());
});

export default app;
