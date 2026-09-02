/**
 * Password hashing and sessions.
 *
 * Passwords are stretched with PBKDF2-HMAC-SHA256 and a per-user salt; the plaintext never
 * leaves the request and the hash never leaves the Worker. Session tokens are random 256-bit
 * values, stored only as a SHA-256 digest, so a dumped `sessions` table cannot be replayed.
 */
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { D1Database, UserRow } from './env';

const ITERATIONS = 100_000;
const SESSION_DAYS = 7;
const encoder = new TextEncoder();

export const SESSION_COOKIE = 'recover_sid';

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (value: string): ArrayBuffer => {
  const buffer = new ArrayBuffer(value.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return buffer;
};

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function stretch(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(bits);
}

export const newSalt = (): string => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

/** Compare two hex digests without returning early on the first differing character. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(36).padStart(2, '0'))
    .join('');
  const now = Date.now();
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * 86_400_000)
    .run();
  return token;
}

export function setSessionCookie(context: Context, token: string): void {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(context.req.url).protocol === 'https:',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(context: Context): void {
  setCookie(context, SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function currentUser(context: Context, db: D1Database): Promise<UserRow | null> {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(token), Date.now())
    .first<UserRow>();
  return row ?? null;
}

/**
 * Reject state-changing requests that did not come from this origin. SameSite=Lax already
 * blocks the classic cross-site form post; this catches the rest.
 */
export function sameOrigin(context: Context): boolean {
  const origin = context.req.header('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(context.req.url).host;
  } catch {
    return false;
  }
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Five bad passwords per five minutes per client. Reset on a successful sign-in. */
export function tooManyAttempts(key: string): boolean {
  const record = attempts.get(key);
  if (!record || record.resetAt < Date.now()) return false;
  return record.count >= 5;
}

export function noteAttempt(key: string, ok: boolean): void {
  if (ok) {
    attempts.delete(key);
    return;
  }
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 300_000 });
  } else {
    record.count += 1;
  }
}

export function clientKey(context: Context): string {
  return context.req.header('CF-Connecting-IP') ?? context.req.header('x-forwarded-for') ?? 'local';
}

export function normaliseEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password must be a string';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 200) return 'Password must be under 200 characters';
  return null;
}
