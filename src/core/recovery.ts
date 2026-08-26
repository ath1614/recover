/**
 * The dunning maths, with no database and no framework so it can be tested directly.
 *
 * An invoice that fails a renewal enters a retry ladder: 1 hour, 6 hours, 1 day, 3 days.
 * Each failed attempt moves it down the ladder; a success moves it out of the queue. The
 * recovery rate is the share of rupees that came back, not the share of invoices, because
 * a recovered ₹5,000 matters more than a recovered ₹199.
 */

export type InvoiceStatus = 'failed' | 'recovering' | 'recovered' | 'written_off' | 'paid';

export interface Invoice {
  id: string;
  customer: string;
  email: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  attempts: number;
  nextAttemptAt: number | null;
  reason: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeskEvent {
  id: string;
  invoiceId: string | null;
  kind: string;
  detail: string;
  createdAt: number;
}

/** Backoff between attempts, in milliseconds. */
export const LADDER = [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000, 3 * 24 * 60 * 60_000];

export const MAX_ATTEMPTS = LADDER.length;

export const formatMoney = (minor: number, currency = 'INR'): string => {
  const value = (minor / 100).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
    maximumFractionDigits: 0,
  });
  return `${currency === 'INR' ? '₹' : '$'}${value}`;
};

export interface DeskSummary {
  atRisk: number;
  recovered: number;
  writtenOff: number;
  recoveryRate: number;
  openCount: number;
  recoveredCount: number;
  dueNow: number;
  averageAttempts: number;
}

export function summarise(invoices: Invoice[], now = Date.now()): DeskSummary {
  const failed = invoices.filter((invoice) => invoice.status === 'failed' || invoice.status === 'recovering');
  const recovered = invoices.filter((invoice) => invoice.status === 'recovered');
  const writtenOff = invoices.filter((invoice) => invoice.status === 'written_off');

  const atRisk = failed.reduce((sum, invoice) => sum + invoice.amount, 0);
  const recoveredTotal = recovered.reduce((sum, invoice) => sum + invoice.amount, 0);
  const lostTotal = writtenOff.reduce((sum, invoice) => sum + invoice.amount, 0);
  const resolved = recoveredTotal + lostTotal;

  return {
    atRisk,
    recovered: recoveredTotal,
    writtenOff: lostTotal,
    recoveryRate: resolved === 0 ? 0 : Math.round((recoveredTotal / resolved) * 1000) / 10,
    openCount: failed.length,
    recoveredCount: recovered.length,
    dueNow: failed.filter((invoice) => (invoice.nextAttemptAt ?? 0) <= now).length,
    averageAttempts:
      recovered.length === 0
        ? 0
        : Math.round((recovered.reduce((sum, invoice) => sum + invoice.attempts, 0) / recovered.length) * 10) / 10,
  };
}

/** Deterministic pseudo-random in [0, 1) from a string, so a retry can be demonstrated and reproduced. */
export function unitFor(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/** A retry succeeds 62% of the time; later attempts are slightly more likely once the ladder retries on a new day. */
export function retrySucceeds(invoiceId: string, attempt: number): boolean {
  const optimism = Math.min(0.12, attempt * 0.03);
  return unitFor(`${invoiceId}:${attempt}`) < 0.62 + optimism;
}

export function nextAttemptAt(from: number, attempt: number): number {
  return from + LADDER[Math.min(attempt, LADDER.length - 1)];
}

export function ladderLabel(attempt: number): string {
  const minutes = Math.round(LADDER[Math.min(attempt, LADDER.length - 1)] / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)} h`;
  return `in ${Math.round(minutes / 1440)} d`;
}

export function hoursUntil(timestamp: number | null, now = Date.now()): number | null {
  if (timestamp === null) return null;
  return Math.round(((timestamp - now) / 3_600_000) * 10) / 10;
}

/** Rupees recovered per day over the last `days` days, oldest first, for the sparkline. */
export function recoverySeries(invoices: Invoice[], days = 14, now = Date.now()): number[] {
  const buckets = new Array(days).fill(0) as number[];
  const day = 86_400_000;
  for (const invoice of invoices) {
    if (invoice.status !== 'recovered') continue;
    const age = Math.floor((now - invoice.updatedAt) / day);
    if (age >= 0 && age < days) buckets[days - 1 - age] += invoice.amount;
  }
  return buckets;
}
