import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeButton, useTheme, type Theme } from './lib/theme';
import type { DeskEvent, DeskSummary, Invoice } from './core/recovery';
import { formatMoney, hoursUntil, ladderLabel } from './core/recovery';

interface Desk {
  user: { id: string; name: string; email: string };
  summary: DeskSummary;
  invoices: Invoice[];
  events: DeskEvent[];
  series: number[];
}

const money = (minor: number) => formatMoney(minor);

function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function statusLabel(invoice: Invoice): string {
  if (invoice.status === 'recovered') return 'Recovered';
  if (invoice.status === 'written_off') return 'Written off';
  if (invoice.nextAttemptAt === null) return 'Exhausted';
  return invoice.status === 'recovering' ? 'Retrying' : 'Failed';
}

function humanReason(reason: string): string {
  return reason.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ landing */

function Sparkline({ series }: { series: number[] }) {
  const peak = Math.max(1, ...series);
  const points = series
    .map((value, index) => {
      const x = (index / Math.max(1, series.length - 1)) * 100;
      const y = 34 - (value / peak) * 30;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,36 ${points} 100,36`} fill="url(#sparkFill)" opacity="0.28" />
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Landing({
  onStart,
  signedIn,
  theme,
  toggleTheme,
}: {
  onStart: () => void;
  signedIn: boolean;
  theme: Theme;
  toggleTheme: () => void;
}) {
  return (
    <div className="landing">
      <header className="topbar">
        <a className="mark" href="/" onClick={(event) => { event.preventDefault(); onStart(); }}>
          recover<span className="mark__dot">.</span>
        </a>
        <nav className="topbar__nav">
          <a href="#ladder">The ladder</a>
          <a href="#math">The maths</a>
          <a href="#limits">Limits</a>
        </nav>
        <div className="topbar__actions">
          <ThemeButton theme={theme} toggle={toggleTheme} />
          <button className="button button--small" onClick={onStart}>
            {signedIn ? 'Open your desk' : 'Open the desk'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <p className="kicker">Dunning for subscription billing</p>
          <h1 className="display">
            Failed payments,
            <br />
            recovered.
          </h1>
          <div className="hero__row">
            <p className="hero__lede">
              A renewal fails at 2am because a card expired. The customer still wants the product. Recover keeps the
              invoice alive, retries it on a ladder that respects the customer, and tells you the one number that
              matters: how much of the money came back.
            </p>
            <div className="hero__actions">
              <button className="button" onClick={onStart}>
                {signedIn ? 'Open your desk' : 'Try the demo desk'} <span aria-hidden="true">→</span>
              </button>
              <p className="hero__note">No card, no email, no signup to look around.</p>
            </div>
          </div>

          <div className="receipt" aria-hidden="true">
            <div className="receipt__head">
              <span>invoice · INV-2041</span>
              <span>₹4,999</span>
            </div>
            <div className="receipt__line receipt__line--bad">
              <span>attempt 1</span>
              <span>card expired</span>
            </div>
            <div className="receipt__line">
              <span>retry in 1 hour</span>
              <span>soft decline</span>
            </div>
            <div className="receipt__line">
              <span>retry in 6 hours</span>
              <span>soft decline</span>
            </div>
            <div className="receipt__line receipt__line--good">
              <span>attempt 3</span>
              <span>recovered</span>
            </div>
            <div className="receipt__foot">
              <span>recovery rate</span>
              <strong>68.4%</strong>
            </div>
          </div>
        </section>

        <section className="ladder" id="ladder">
          <div className="section-head">
            <p className="kicker">How it works</p>
            <h2>Three moves, in order.</h2>
          </div>
          <ol className="steps">
            <li>
              <span className="steps__index">01</span>
              <h3>Catch the failure</h3>
              <p>
                Every failed renewal lands on the desk with the decline reason attached: expired card, insufficient
                funds, do not honour. The reason decides the timing, not a fixed schedule.
              </p>
            </li>
            <li>
              <span className="steps__index">02</span>
              <h3>Retry on a ladder</h3>
              <p>
                One hour, six hours, one day, three days. Four attempts, then stop — because a fifth retry is how you
                turn a soft decline into a complaint and a chargeback.
              </p>
            </li>
            <li>
              <span className="steps__index">03</span>
              <h3>Close the books</h3>
              <p>
                Recovered money is counted against what was at risk, written-off money against what was lost. The rate
                on the desk is rupees recovered over rupees resolved — no vanity metrics.
              </p>
            </li>
          </ol>
        </section>

        <section className="math" id="math">
          <div className="math__copy">
            <p className="kicker">The only metric</p>
            <h2>Recovery rate, defined honestly.</h2>
            <p>
              Most dashboards divide recovered invoices by failed invoices. That flatters a desk with one big
              enterprise renewal and hides twenty small failures. Recover weights by amount, and only counts an invoice
              once it is resolved — recovered or written off.
            </p>
            <pre className="formula">
{`recovery rate =
  Σ recovered amount
  ─────────────────────────────
  Σ recovered + Σ written off`}
            </pre>
          </div>
          <div className="math__card">
            <div className="math__row">
              <span>At risk</span>
              <strong>₹1,84,300</strong>
            </div>
            <div className="math__row">
              <span>Recovered</span>
              <strong className="is-good">₹1,26,000</strong>
            </div>
            <div className="math__row">
              <span>Written off</span>
              <strong className="is-bad">₹18,200</strong>
            </div>
            <div className="math__row math__row--total">
              <span>Recovery rate</span>
              <strong>87.4%</strong>
            </div>
            <p className="math__note">Figures from the demo desk, not a customer.</p>
          </div>
        </section>

        <section className="limits" id="limits">
          <p className="kicker">What this is not</p>
          <p>
            Recover is a working demo of the dunning loop, not a billing provider. It never touches a card: retries are
            simulated with a deterministic outcome so a result can be reproduced. A production system would hand the
            retry to the processor, honour its decline codes, and email the customer before the fourth attempt.
          </p>
        </section>
      </main>

      <footer className="footer">
        <span className="footer__mark">recover.</span>
        <p>Built by Atharv Soni · TypeScript, React, Cloudflare Workers, D1.</p>
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------------- auth */

function Auth({
  mode,
  onDone,
  onSwitch,
  onBack,
  theme,
  toggleTheme,
}: {
  mode: 'signin' | 'signup';
  onDone: (desk: Desk) => void;
  onSwitch: (mode: 'signin' | 'signup') => void;
  onBack: () => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode === 'signin' ? 'login' : 'signup'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'signin' ? { email, password } : { name, email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'That did not work');
      const deskResponse = await fetch('/api/desk');
      onDone((await deskResponse.json()) as Desk);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/demo', { method: 'POST' });
      if (!response.ok) throw new Error('The demo desk is unavailable');
      onDone((await (await fetch('/api/desk')).json()) as Desk);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The demo desk is unavailable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth__art">
        <button className="auth__back" onClick={onBack}>
          ← Back
        </button>
        <span className="footer__mark">recover.</span>
        <p className="auth__quote">
          “The second attempt is where the money is. The fifth is where the complaint is.”
        </p>
        <p className="auth__fine">Demo desk: demo@recover.app · demo1234</p>
      </aside>

      <div className="auth__panel">
        <div className="auth__tools">
          <ThemeButton theme={theme} toggle={toggleTheme} />
        </div>
        <div className="tabs" role="tablist">
          <button aria-selected={mode === 'signin'} role="tab" onClick={() => onSwitch('signin')}>
            Sign in
          </button>
          <button aria-selected={mode === 'signup'} role="tab" onClick={() => onSwitch('signup')}>
            Create an account
          </button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
            />
          </label>

          {error && <p className="form__error" role="alert">{error}</p>}

          <button className="button button--full" disabled={busy} type="submit">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create the desk'} <span aria-hidden="true">→</span>
          </button>
          <button className="button button--ghost button--full" type="button" onClick={demo} disabled={busy}>
            Look around with the demo desk
          </button>
          <p className="form__fine">
            Passwords are hashed with PBKDF2-SHA256 and 100,000 rounds. Sessions are httpOnly cookies; the token is
            stored only as a SHA-256 digest.
          </p>
        </form>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- desk */

function DeskView({
  desk,
  onUpdate,
  onSignOut,
  theme,
  toggleTheme,
}: {
  desk: Desk;
  onUpdate: (desk: Desk) => void;
  onSignOut: () => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const open = useMemo(
    () => desk.invoices.filter((invoice) => invoice.status !== 'recovered' && invoice.status !== 'written_off'),
    [desk.invoices],
  );
  const closed = desk.invoices.length - open.length;

  const act = useCallback(
    async (id: string, action: 'retry' | 'write-off') => {
      setBusyId(id);
      setNote(null);
      try {
        const response = await fetch(`/api/invoices/${id}/${action}`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'That did not work');
        onUpdate({ ...desk, ...payload, user: desk.user });
        setNote(
          action === 'retry'
            ? payload.won
              ? 'Recovered on this attempt.'
              : `Attempt ${payload.attempt} declined; the ladder moved.`
            : 'Written off and closed.',
        );
      } catch (caught) {
        setNote(caught instanceof Error ? caught.message : 'That did not work');
      } finally {
        setBusyId(null);
      }
    },
    [desk, onUpdate],
  );

  return (
    <div className="desk">
      <header className="deskbar">
        <span className="mark">
          recover<span className="mark__dot">.</span>
        </span>
        <div className="deskbar__right">
          <ThemeButton theme={theme} toggle={toggleTheme} />
          <span className="deskbar__who">{desk.user.name}</span>
          <button className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="desk__main">
        <div className="desk__head">
          <div>
            <p className="kicker">The desk</p>
            <h1 className="desk__title">{desk.summary.openCount} invoices need attention</h1>
          </div>
          <p className="desk__sub">
            {desk.summary.dueNow} due now · {desk.summary.averageAttempts || '–'} attempts per recovery
          </p>
        </div>

        <section className="kpis">
          <article className="kpi">
            <p>At risk</p>
            <strong>{money(desk.summary.atRisk)}</strong>
            <span>{desk.summary.openCount} open invoices</span>
          </article>
          <article className="kpi">
            <p>Recovered</p>
            <strong className="is-good">{money(desk.summary.recovered)}</strong>
            <span>{desk.summary.recoveredCount} invoices saved</span>
          </article>
          <article className="kpi kpi--accent">
            <p>Recovery rate</p>
            <strong>{desk.summary.recoveryRate}%</strong>
            <span>by amount, not by count</span>
          </article>
          <article className="kpi">
            <p>Written off</p>
            <strong className="is-bad">{money(desk.summary.writtenOff)}</strong>
            <span>{closed} closed in total</span>
          </article>
        </section>

        <section className="panel panel--chart">
          <div className="panel__head">
            <h2>Recovered per day</h2>
            <span>last 14 days</span>
          </div>
          <Sparkline series={desk.series.length ? desk.series : new Array(14).fill(0)} />
        </section>

        {note && <p className="note" role="status">{note}</p>}

        <div className="desk__grid">
          <section className="panel">
            <div className="panel__head">
              <h2>Retry queue</h2>
              <span>{open.length} open</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Next attempt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.map((invoice) => {
                  const due = hoursUntil(invoice.nextAttemptAt);
                  const exhausted = invoice.attempts >= 4;
                  return (
                    <tr key={invoice.id}>
                      <td>
                        <strong>{invoice.customer}</strong>
                        <span className="table__sub">{humanReason(invoice.reason)}</span>
                      </td>
                      <td className="num">{money(invoice.amount)}</td>
                      <td>
                        <span className={`pill pill--${invoice.status}`}>{statusLabel(invoice)}</span>
                        <span className="table__sub">attempt {invoice.attempts}/4</span>
                      </td>
                      <td className="num">
                        {exhausted ? 'ladder done' : due === null ? '—' : due <= 0 ? 'due now' : ladderLabel(invoice.attempts)}
                      </td>
                      <td className="table__actions">
                        <button
                          className="button button--tiny"
                          disabled={busyId === invoice.id || exhausted}
                          onClick={() => act(invoice.id, 'retry')}
                        >
                          Retry
                        </button>
                        <button
                          className="link-button"
                          disabled={busyId === invoice.id}
                          onClick={() => act(invoice.id, 'write-off')}
                        >
                          Write off
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {open.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table__empty">
                      Nothing failed today. Enjoy it.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <aside className="panel panel--feed">
            <div className="panel__head">
              <h2>Activity</h2>
              <span>newest first</span>
            </div>
            <ul className="feed">
              {desk.events.slice(0, 12).map((event) => (
                <li key={event.id} className={`feed__item feed__item--${event.kind.replace('.', '-')}`}>
                  <span className="feed__dot" aria-hidden="true" />
                  <div>
                    <p>{event.detail}</p>
                    <span>{timeAgo(event.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <p className="desk__fine">
          Retries on this demo are simulated with a seeded outcome so the same invoice always behaves the same way.
          Nothing is charged.
        </p>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- app */

export default function App() {
  const [view, setView] = useState<'landing' | 'auth' | 'desk'>('landing');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [desk, setDesk] = useState<Desk | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    fetch('/api/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload?.user) return;
        return fetch('/api/desk')
          .then((response) => response.json())
          .then((next: Desk) => {
            setDesk(next);
            setView('desk');
          });
      })
      .catch(() => undefined);
  }, []);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setDesk(null);
    setView('landing');
  };

  if (view === 'desk' && desk) {
    return <DeskView desk={desk} onUpdate={setDesk} onSignOut={signOut} theme={theme} toggleTheme={toggleTheme} />;
  }

  if (view === 'auth') {
    return (
      <Auth
        mode={mode}
        onSwitch={setMode}
        onBack={() => setView('landing')}
        theme={theme}
        toggleTheme={toggleTheme}
        onDone={(next) => {
          setDesk(next);
          setView('desk');
        }}
      />
    );
  }

  return (
    <Landing
      signedIn={Boolean(desk)}
      onStart={() => setView(desk ? 'desk' : 'auth')}
      theme={theme}
      toggleTheme={toggleTheme}
    />
  );
}
