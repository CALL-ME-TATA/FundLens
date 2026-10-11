import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from 'recharts';

type Fund = {
  scheme_code: number; name: string; category: string; units: string; invested: string; redeemed: string;
  latest_nav: string; nav_date: string; current_value: string; absolute_return: string; xirr: number | null;
};
type Portfolio = { invested: string; redeemed: string; current_value: string; absolute_return: string; xirr: number | null; funds: Fund[] };
type Point = { date: string; value: string; invested: string };
type Txn = { id: number; scheme_code: number; name: string; type: TxnType; txn_date: string; amount: string; units: string; nav: string };
type TxnType = 'SIP' | 'LUMPSUM' | 'REDEMPTION';
type SearchResult = { schemeCode: number; schemeName: string };
type Call = <T>(path: string, body?: unknown) => Promise<T>;

// ---------- formatting ----------

const grouped2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
const pct = (v: number | null, signed = false) =>
  v === null || !Number.isFinite(v) ? '—' : `${signed ? sign(v) : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const compact = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${n}`;
const TYPE_LABEL: Record<TxnType, string> = { SIP: 'SIP', LUMPSUM: 'Lump sum', REDEMPTION: 'Redemption' };

// Rupees with the paise set smaller, so exact values stay readable at a glance.
function Money({ value, signed = false }: { value: string | number; signed?: boolean }) {
  const n = Number(value);
  const [whole, paise] = grouped2.format(Math.abs(n)).split('.');
  return (
    <span className="money">
      {signed ? sign(n) : n < 0 ? '−' : ''}₹{whole}<span className="paise">.{paise}</span>
    </span>
  );
}

// AMFI's broad scheme types, named the way investors say them, coloured after rupee-note denominations.
const CATEGORIES: Record<string, { label: string; color: string }> = {
  'Equity Scheme': { label: 'Equity', color: '#2f5d8a' },
  'Income/Debt Oriented Schemes': { label: 'Debt', color: '#b7791f' },
  'Debt Scheme': { label: 'Debt', color: '#b7791f' },
  'Hybrid Scheme': { label: 'Hybrid', color: '#7c5fae' },
  'Other Scheme': { label: 'Index & other', color: '#7a4a2a' },
  'Solution Oriented Scheme': { label: 'Solution-oriented', color: '#5f6b66' },
};
const category = (raw: string) => CATEGORIES[raw] ?? { label: raw || 'Uncategorised', color: '#5f6b66' };

// ---------- api ----------

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const UNREACHABLE = 'Can’t reach the FundLens server. Check that the API is running, then try again.';

async function api<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok && !data?.error && res.status >= 502) throw new ApiError(res.status, UNREACHABLE);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
  },
};

// ---------- app ----------

export default function App() {
  const [token, setToken] = useState(() => store.get('token'));
  const [email, setEmail] = useState(() => store.get('email') ?? '');
  const [notice, setNotice] = useState('');

  const signIn = (t: string, e: string) => {
    store.set('token', t); store.set('email', e);
    setToken(t); setEmail(e); setNotice('');
  };
  const signOut = (reason = '') => {
    store.set('token', null);
    setToken(null); setNotice(reason);
  };

  return token
    ? <Dashboard token={token} email={email} onSignOut={signOut} />
    : <Login onSignIn={signIn} notice={notice} defaultEmail={email} />;
}

// ---------- guilloché rosette ----------

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// Hypotrochoid curves, the same maths a geometric lathe uses to engrave banknote rosettes.
function Rosette({ className = '', monogram = true }: { className?: string; monogram?: boolean }) {
  const paths = useMemo(() => {
    const layers = [
      { R: 60, r: 13, d: 34, scale: 1 },
      { R: 72, r: 17, d: 26, scale: 0.8 },
      { R: 50, r: 9, d: 20, scale: 0.56 },
    ];
    return layers.map(({ R, r, d, scale }) => {
      const k = (R - r) / r;
      const turns = r / gcd(R, r);
      const steps = 180 * turns;
      const norm = (92 * scale) / (R - r + d);
      let p = '';
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * 2 * Math.PI * turns;
        const x = 100 + ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * norm;
        const y = 100 + ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * norm;
        p += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return p;
    });
  }, []);

  return (
    <svg className={`rosette ${className}`} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="97" pathLength={1} />
      <circle cx="100" cy="100" r="94" pathLength={1} />
      {paths.map((d, i) => <path key={i} d={d} pathLength={1} style={{ animationDelay: `${i * 120}ms` }} />)}
      {monogram && <text x="100" y="100" className="rosette-mono">FL</text>}
    </svg>
  );
}

function Microtext() {
  const line = 'FUNDLENS · CERTIFICATE OF REAL RETURN · VALUED AT AMFI NET ASSET VALUE · '.repeat(12);
  return <div className="microtext" aria-hidden="true">{line}</div>;
}

// ---------- login ----------

function Login({ onSignIn, notice, defaultEmail }: { onSignIn: (t: string, e: string) => void; notice: string; defaultEmail: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    setBusy(true); setError('');
    try {
      const { token } = await api<{ token: string }>(`/auth/${mode}`, null, { email, password: f.get('password') });
      onSignIn(token, email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-sheet">
        <Microtext />
        <div className="auth-inner">
          <Rosette className="auth-rosette" />
          <h1 className="wordmark">FundLens</h1>
          <p className="auth-lede">
            Your mutual funds, valued every night at AMFI NAVs, with the return that counts <em>when</em> you invested.
          </p>

          <div className="switch" role="group" aria-label="Account">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
          </div>

          <form onSubmit={submit} className="auth-form">
            {notice && <p className="notice" role="status">{notice}</p>}
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password" type="password" required minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-describedby={mode === 'register' ? 'pw-hint' : undefined}
              />
              {mode === 'register' && <small id="pw-hint">At least 8 characters.</small>}
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </div>
        <Microtext />
      </div>
    </main>
  );
}

// ---------- dashboard ----------

type Data = { portfolio: Portfolio; history: Point[]; txns: Txn[] };

function Dashboard({ token, email, onSignOut }: { token: string; email: string; onSignOut: (reason?: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState('');
  const [focusFund, setFocusFund] = useState<number | null>(null);

  const call: Call = async (path, body) => {
    try {
      return await api(path, token, body);
    } catch (err) {
      if ((err as ApiError).status === 401) onSignOut('Your session expired. Log in again to continue.');
      throw err;
    }
  };

  async function load() {
    setLoadError('');
    try {
      const [portfolio, history, txns] = await Promise.all([
        call<Portfolio>('/portfolio'), call<Point[]>('/portfolio/history'), call<Txn[]>('/transactions'),
      ]);
      setData({ portfolio, history, txns });
    } catch (err) {
      if ((err as ApiError).status !== 401) setLoadError((err as Error).message);
    }
  }
  useEffect(() => { load(); }, [token]);

  const serial = useMemo(() => {
    try { return String(JSON.parse(atob(token.split('.')[1])).sub).padStart(6, '0'); } catch { return '000000'; }
  }, [token]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark small">FundLens</span>
        <div className="account">
          <span className="account-email">{email}</span>
          <button type="button" className="text-btn" onClick={() => onSignOut()}>Log out</button>
        </div>
      </header>

      <main className="page">
        {loadError && (
          <div className="notice error-notice" role="alert">
            <span>Couldn’t load your portfolio. {loadError}</span>
            <button type="button" className="text-btn" onClick={load}>Try again</button>
          </div>
        )}

        {!data ? (!loadError && <Skeleton />) : (
          <>
            <Certificate portfolio={data.portfolio} serial={serial} />
            <div className="pair">
              <ValueChart history={data.history} txns={data.txns} focusFund={focusFund} />
              <Allocation funds={data.portfolio.funds} focusFund={focusFund} />
            </div>
            <RecordTransaction call={call} onRecorded={load} />
            <Holdings funds={data.portfolio.funds} focusFund={focusFund} onFocusFund={setFocusFund} />
            <Ledger txns={data.txns} focusFund={focusFund} />
          </>
        )}
      </main>

      <footer className="colophon">
        NAVs from AMFI via mfapi.in, refreshed nightly at 23:30 IST. FundLens tracks returns; it does not give investment advice.
      </footer>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading portfolio">
      <div className="sk sk-cert" />
      <div className="pair"><div className="sk sk-plate" /><div className="sk sk-plate" /></div>
    </div>
  );
}

// ---------- certificate ----------

function Certificate({ portfolio, serial }: { portfolio: Portfolio; serial: string }) {
  const invested = Number(portfolio.invested);
  const gain = Number(portfolio.absolute_return);
  const empty = portfolio.funds.length === 0;
  const navDate = portfolio.funds.map(f => f.nav_date).sort().at(-1);
  const tone = (n: number | null) => (n === null || n === 0 ? '' : n > 0 ? 'gain' : 'loss');
  const x = portfolio.xirr;

  return (
    <section className="certificate" aria-labelledby="cert-title">
      <Microtext />
      <div className="cert-body">
        <div className="cert-main">
          <h2 id="cert-title" className="cert-title">
            Annualised return <abbr title="Extended internal rate of return: weighs every investment and redemption by its date and size">XIRR</abbr>
          </h2>
          {x === null ? (
            <p className="denomination is-pending">Pending</p>
          ) : (
            <p className={`denomination ${tone(x)}`}>
              {x < 0 ? '−' : ''}{Math.abs(x * 100).toFixed(2)}<span className="denomination-unit">%</span>
            </p>
          )}
          {empty ? (
            <p className="cert-empty">No holdings yet. Record your first transaction below and this certificate will show your real return.</p>
          ) : (
            <dl className="denominations">
              <div><dt>Current value</dt><dd><Money value={portfolio.current_value} /></dd></div>
              <div><dt>Invested</dt><dd><Money value={portfolio.invested} /></dd></div>
              <div><dt>Redeemed</dt><dd><Money value={portfolio.redeemed} /></dd></div>
              <div>
                <dt>Absolute return</dt>
                <dd className={tone(gain)}>
                  <Money value={gain} signed />
                  {invested > 0 && <span className="dd-sub">{pct(gain / invested, true)}</span>}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div className="cert-seal">
          <Rosette />
          <p className="serial">No. FL {serial}</p>
          <p className="asof">{navDate ? <>Valued at NAV of<br />{fmtDate(navDate)}</> : 'Awaiting first valuation'}</p>
        </div>
      </div>
      <Microtext />
    </section>
  );
}

// ---------- value over time ----------

type ChartPoint = { t: number; date: string; value: number; invested: number };

function Readout({ active, payload }: { active?: boolean; payload?: readonly { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const gain = p.value - p.invested;
  return (
    <div className="readout">
      <div className="readout-date">{fmtDate(p.date)}</div>
      <dl>
        <div><dt>Value</dt><dd><Money value={p.value} /></dd></div>
        <div><dt>Net invested</dt><dd><Money value={p.invested} /></dd></div>
        <div><dt>Gain</dt><dd className={gain >= 0 ? 'gain' : 'loss'}><Money value={gain} signed /></dd></div>
      </dl>
    </div>
  );
}

function ValueChart({ history, txns, focusFund }: { history: Point[]; txns: Txn[]; focusFund: number | null }) {
  const data: ChartPoint[] = history.map(p => ({ t: Date.parse(p.date), date: p.date, value: Number(p.value), invested: Number(p.invested) }));

  return (
    <figure className="plate chart-plate" aria-labelledby="chart-title">
      <figcaption className="plate-head">
        <h2 id="chart-title">Value over time</h2>
        {data.length >= 2 && (
          <ul className="legend" aria-label="Legend">
            <li><i className="key key-value" />Value</li>
            <li><i className="key key-invested" />Net invested</li>
            <li><i className="key key-txn" />Transaction</li>
          </ul>
        )}
      </figcaption>
      {data.length < 2 ? (
        <p className="plate-empty">Your value line appears here once you’ve recorded a transaction at least a week ago.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--rule-soft)" />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={t => new Date(t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
              tick={{ fontSize: 12, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--ink)' }} minTickGap={48}
            />
            <YAxis
              tickFormatter={compact} tick={{ fontSize: 12, fill: 'var(--ink-2)' }} width={56}
              tickLine={false} axisLine={false} domain={[0, 'auto']}
            />
            <Tooltip
              content={p => <Readout active={p.active} payload={p.payload as unknown as { payload: ChartPoint }[]} />}
              cursor={{ stroke: 'var(--ink)', strokeWidth: 1, strokeDasharray: '2 3' }}
              isAnimationActive={false}
            />
            <Line type="stepAfter" dataKey="invested" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke="var(--ink)" strokeWidth={2} dot={false} isAnimationActive={false}
              activeDot={{ r: 4, fill: 'var(--paper)', stroke: 'var(--ink)', strokeWidth: 2 }} />
            {txns.map(t => (
              <ReferenceDot
                key={t.id} x={Date.parse(t.txn_date)} y={0} r={0} ifOverflow="visible"
                shape={(props: { cx?: number; cy?: number }) => (
                  <g className={`txn-mark ${focusFund === null ? '' : focusFund === t.scheme_code ? 'is-focus' : 'is-dim'}`}>
                    <line x1={props.cx} x2={props.cx} y1={props.cy} y2={(props.cy ?? 0) - 12} />
                    {t.type === 'REDEMPTION' && <circle cx={props.cx} cy={(props.cy ?? 0) - 14} r={2.5} />}
                  </g>
                )}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}

// ---------- allocation ----------

function Allocation({ funds, focusFund }: { funds: Fund[]; focusFund: number | null }) {
  const groups = new Map<string, { label: string; color: string; value: number }>();
  for (const f of funds) {
    const c = category(f.category);
    const g = groups.get(c.label) ?? { ...c, value: 0 };
    g.value += Number(f.current_value);
    groups.set(c.label, g);
  }
  const rows = [...groups.values()].filter(g => g.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, g) => s + g.value, 0);
  const focusLabel = focusFund === null ? null : category(funds.find(f => f.scheme_code === focusFund)?.category ?? '').label;
  const state = (label: string) => (focusLabel === null ? '' : focusLabel === label ? 'is-focus' : 'is-dim');

  return (
    <figure className="plate alloc-plate" aria-labelledby="alloc-title">
      <figcaption className="plate-head"><h2 id="alloc-title">Allocation</h2></figcaption>
      {rows.length === 0 ? (
        <p className="plate-empty">Your split across equity, debt and other categories appears here.</p>
      ) : (
        <>
          <div className="alloc-bar" role="img" aria-label={rows.map(g => `${g.label} ${((g.value / total) * 100).toFixed(1)}%`).join(', ')}>
            {rows.map(g => (
              <span key={g.label} className={state(g.label)} style={{ width: `${(g.value / total) * 100}%`, background: g.color }} />
            ))}
          </div>
          <ul className="alloc-list">
            {rows.map(g => (
              <li key={g.label} className={state(g.label)}>
                <i style={{ background: g.color }} />
                <span className="alloc-name">{g.label}</span>
                <span className="alloc-pct">{((g.value / total) * 100).toFixed(1)}%</span>
                <span className="alloc-val"><Money value={g.value} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}

// ---------- record a transaction ----------

function FundPicker({ call, selected, onSelect }: { call: Call; selected: SearchResult | null; onSelect: (f: SearchResult | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (selected && query === selected.schemeName) return;
    const q = query.trim();
    if (q.length < 3) { setResults([]); setStatus('idle'); return; }
    let stale = false;
    setStatus('loading');
    const id = setTimeout(async () => {
      try {
        const r = await call<SearchResult[]>(`/funds/search?q=${encodeURIComponent(q)}`);
        if (stale) return;
        setResults(r); setActive(0); setOpen(true); setStatus(r.length ? 'idle' : 'empty');
      } catch {
        if (!stale) setStatus('error');
      }
    }, 250);
    return () => { stale = true; clearTimeout(id); };
  }, [query]);

  const choose = (r: SearchResult) => { onSelect(r); setQuery(r.schemeName); setOpen(false); };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const hint = {
    idle: selected ? `Scheme code ${selected.schemeCode}` : 'Type at least 3 letters of the fund name.',
    loading: 'Searching AMFI schemes…',
    empty: `No schemes match “${query.trim()}”. Try fewer words.`,
    error: 'Search failed. Check your connection and keep typing to retry.',
  }[status];

  return (
    <div className="field picker">
      <label htmlFor="fund-input">Fund</label>
      <input
        id="fund-input" role="combobox" aria-expanded={open && results.length > 0} aria-controls="fund-list"
        aria-activedescendant={open && results.length ? `fund-opt-${active}` : undefined} aria-autocomplete="list"
        aria-describedby="fund-hint" autoComplete="off" placeholder="e.g. Parag Parikh Flexi Cap"
        value={query}
        onChange={e => { setQuery(e.target.value); if (selected) onSelect(null); }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <small id="fund-hint" className={status === 'error' || status === 'empty' ? 'hint-warn' : ''}>{hint}</small>
      {open && results.length > 0 && (
        <ul id="fund-list" role="listbox" className="listbox">
          {results.map((r, i) => (
            <li
              key={r.schemeCode} id={`fund-opt-${i}`} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); choose(r); }} onMouseEnter={() => setActive(i)}
            >
              {r.schemeName}<span className="opt-code">{r.schemeCode}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordTransaction({ call, onRecorded }: { call: Call; onRecorded: () => Promise<void> }) {
  const [fund, setFund] = useState<SearchResult | null>(null);
  const [type, setType] = useState<TxnType>('SIP');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone('');
    if (!fund) return setError('Choose a fund from the search results.');
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return setError('Enter the amount in rupees, with at most 2 decimals (e.g. 5000 or 2500.50).');
    setBusy(true); setError('');
    try {
      const t = await call<Txn>('/transactions', { schemeCode: fund.schemeCode, type, date, amount: amount.trim() });
      setDone(`Recorded ${type === 'SIP' ? 'SIP' : TYPE_LABEL[type].toLowerCase()} of ₹${grouped2.format(Number(t.amount))} on ${fmtDate(t.txn_date)} at NAV ${t.nav}: ${t.units} units.`);
      setAmount(''); // keep fund, type and date so a run of SIPs is quick to enter
      await onRecorded();
    } catch (err) {
      setError((err as Error).message); // every field keeps its value
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="record" aria-labelledby="record-title">
      <h2 id="record-title">Record a transaction</h2>
      <form className="record-row" onSubmit={submit} noValidate>
        <FundPicker call={call} selected={fund} onSelect={f => { setFund(f); setError(''); }} />
        <fieldset className="field">
          <legend>Type</legend>
          <div className="segmented">
            {(Object.keys(TYPE_LABEL) as TxnType[]).map(t => (
              <label key={t} className={type === t ? 'is-on' : ''}>
                <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} max={today()} required onChange={e => setDate(e.target.value)} />
        </label>
        <label className="field amount">
          <span>Amount</span>
          <span className="prefixed">
            <span className="prefix" aria-hidden="true">₹</span>
            <input inputMode="decimal" placeholder="5,000" value={amount} onChange={e => setAmount(e.target.value.replace(/,/g, ''))} required />
          </span>
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
      </form>
      <p className="record-help">
        Units are worked out from the NAV on that date, or the last business day before it.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="success" role="status">{done}</p>}
    </section>
  );
}

// ---------- tables ----------

function Holdings({ funds, focusFund, onFocusFund }: { funds: Fund[]; focusFund: number | null; onFocusFund: (c: number | null) => void }) {
  const open = funds.filter(f => Number(f.units) > 0);
  const closed = funds.length - open.length;

  return (
    <section className="ledger-section" aria-labelledby="holdings-title">
      <div className="section-head">
        <h2 id="holdings-title">Holdings</h2>
        {closed > 0 && <span className="section-note">{closed} fully redeemed {closed === 1 ? 'fund' : 'funds'} not shown</span>}
      </div>
      {open.length === 0 ? (
        <p className="plate-empty">Funds you hold will be listed here with units, NAV and returns.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Fund</th>
                <th scope="col" className="num">Units</th>
                <th scope="col" className="num">NAV</th>
                <th scope="col" className="num">Invested</th>
                <th scope="col" className="num">Current value</th>
                <th scope="col" className="num">Return</th>
                <th scope="col" className="num">XIRR</th>
              </tr>
            </thead>
            <tbody onMouseLeave={() => onFocusFund(null)}>
              {open.map(f => {
                const gain = Number(f.absolute_return);
                const c = category(f.category);
                return (
                  <tr
                    key={f.scheme_code} tabIndex={0}
                    className={focusFund === f.scheme_code ? 'is-focus' : ''}
                    onMouseEnter={() => onFocusFund(f.scheme_code)} onFocus={() => onFocusFund(f.scheme_code)} onBlur={() => onFocusFund(null)}
                  >
                    <th scope="row">
                      <span className="fund-name">{f.name}</span>
                      <span className="fund-cat"><i style={{ background: c.color }} />{c.label}</span>
                    </th>
                    <td className="num">{Number(f.units).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                    <td className="num">{grouped2.format(Number(f.latest_nav))}<span className="cell-sub">{fmtDate(f.nav_date)}</span></td>
                    <td className="num"><Money value={f.invested} /></td>
                    <td className="num strong"><Money value={f.current_value} /></td>
                    <td className={`num ${gain > 0 ? 'gain' : gain < 0 ? 'loss' : ''}`}>
                      <Money value={gain} signed />
                      <span className="cell-sub">{pct(gain / Number(f.invested), true)}</span>
                    </td>
                    <td className={`num strong ${(f.xirr ?? 0) > 0 ? 'gain' : (f.xirr ?? 0) < 0 ? 'loss' : ''}`}>{pct(f.xirr, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Ledger({ txns, focusFund }: { txns: Txn[]; focusFund: number | null }) {
  return (
    <section className="ledger-section" aria-labelledby="ledger-title">
      <div className="section-head">
        <h2 id="ledger-title">Ledger</h2>
        <span className="section-note">{txns.length} {txns.length === 1 ? 'entry' : 'entries'}</span>
      </div>
      {txns.length === 0 ? (
        <p className="plate-empty">Every SIP, lump sum and redemption you record is kept here with the NAV it used.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Fund</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col" className="num">NAV</th>
                <th scope="col" className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id} className={focusFund === null ? '' : focusFund === t.scheme_code ? 'is-focus' : 'is-dim'}>
                  <td className="nowrap">{fmtDate(t.txn_date)}</td>
                  <td>{t.name}</td>
                  <td><span className={`type-mark ${t.type === 'REDEMPTION' ? 'out' : ''}`}>{TYPE_LABEL[t.type]}</span></td>
                  <td className="num"><Money value={t.amount} /></td>
                  <td className="num">{grouped2.format(Number(t.nav))}</td>
                  <td className="num">{t.type === 'REDEMPTION' ? '−' : '+'}{Number(t.units).toLocaleString('en-IN', { minimumFractionDigits: 4 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

