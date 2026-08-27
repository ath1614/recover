import { describe, expect, it } from 'vitest';
import {
  LADDER,
  MAX_ATTEMPTS,
  nextAttemptAt,
  recoverySeries,
  retrySucceeds,
  summarise,
  type Invoice,
} from './recovery';

const invoice = (over: Partial<Invoice>): Invoice => ({
  id: 'inv_1',
  customer: 'Aarav Mehta',
  email: 'aarav@example.com',
  amount: 49_900,
  currency: 'INR',
  status: 'failed',
  attempts: 1,
  nextAttemptAt: null,
  reason: 'card_expired',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('summarise', () => {
  it('counts only resolved money in the recovery rate', () => {
    const summary = summarise([
      invoice({ id: 'a', status: 'recovered', amount: 10_000 }),
      invoice({ id: 'b', status: 'recovered', amount: 5_000 }),
      invoice({ id: 'c', status: 'written_off', amount: 5_000 }),
      invoice({ id: 'd', status: 'failed', amount: 90_000 }),
    ]);
    expect(summary.recovered).toBe(15_000);
    expect(summary.writtenOff).toBe(5_000);
    expect(summary.atRisk).toBe(90_000);
    expect(summary.recoveryRate).toBe(75);
  });

  it('is zero, not NaN, when nothing has resolved yet', () => {
    const summary = summarise([invoice({ status: 'failed' })]);
    expect(summary.recoveryRate).toBe(0);
    expect(summary.openCount).toBe(1);
    expect(summary.averageAttempts).toBe(0);
  });

  it('counts only invoices whose next attempt is due', () => {
    const now = 1_000_000;
    const summary = summarise(
      [
        invoice({ id: 'a', status: 'failed', nextAttemptAt: now - 1 }),
        invoice({ id: 'b', status: 'failed', nextAttemptAt: now + 60_000 }),
      ],
      now,
    );
    expect(summary.dueNow).toBe(1);
  });
});

describe('the retry ladder', () => {
  it('backs off further on every attempt', () => {
    for (let attempt = 1; attempt < LADDER.length; attempt += 1) {
      expect(LADDER[attempt]).toBeGreaterThan(LADDER[attempt - 1]);
    }
    expect(MAX_ATTEMPTS).toBe(4);
  });

  it('never schedules past the end of the ladder', () => {
    const now = 0;
    expect(nextAttemptAt(now, MAX_ATTEMPTS + 3)).toBe(LADDER[LADDER.length - 1]);
  });

  it('resolves a retry deterministically', () => {
    const first = retrySucceeds('inv_abc', 2);
    expect(retrySucceeds('inv_abc', 2)).toBe(first);
    const outcomes = new Set(Array.from({ length: 40 }, (_, index) => retrySucceeds(`inv_${index}`, 2)));
    expect(outcomes.size).toBe(2);
  });

  it('recovers a plausible share of invoices over many attempts', () => {
    let wins = 0;
    for (let index = 0; index < 2_000; index += 1) {
      if (retrySucceeds(`inv_${index}`, 1)) wins += 1;
    }
    const rate = wins / 2_000;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.75);
  });
});

describe('recoverySeries', () => {
  it('puts recovered money in the right day bucket', () => {
    const day = 86_400_000;
    const now = 100 * day;
    const series = recoverySeries(
      [
        invoice({ id: 'a', status: 'recovered', amount: 1_000, updatedAt: now - 2 * day }),
        invoice({ id: 'b', status: 'recovered', amount: 500, updatedAt: now - 1 * day }),
        invoice({ id: 'c', status: 'failed', amount: 9_000, updatedAt: now }),
      ],
      7,
      now,
    );
    expect(series).toHaveLength(7);
    expect(series[4]).toBe(1_000);
    expect(series[5]).toBe(500);
    expect(series.reduce((sum, value) => sum + value, 0)).toBe(1_500);
  });
});
