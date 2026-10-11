import { useEffect, useState, type FormEvent } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';

type Fund = {
  scheme_code: number; name: string; category: string; units: string; invested: string; redeemed: string;
  latest_nav: string; nav_date: string; current_value: string; absolute_return: string; xirr: number | null;
};
type Portfolio = { invested: string; redeemed: string; current_value: string; absolute_return: string; xirr: number | null; funds: Fund[] };
type Point = { date: string; value: string; invested: string };
type Txn = { id: number; name: string; type: string; txn_date: string; amount: string; units: string; nav: string };

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (v: string | number) => inr.format(Number(v));
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(2)}%`);
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];

async function api<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status });
  return data;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const login = (t: string | null) => {
    if (t) localStorage.setItem('token', t); else localStorage.removeItem('token');
    setToken(t);
  };
  return token ? <Dashboard token={token} onLogout={() => login(null)} /> : <Login onLogin={login} />;
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const { token } = await api<{ token: string }>(`/auth/${mode}`, null, { email: f.get('email'), password: f.get('password') });
      onLogin(token);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <main className="auth">
      <h1>FundLens</h1>
      <p className="muted">Track your mutual fund portfolio, returns and XIRR.</p>
      <form onSubmit={submit} className="card stack">
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" minLength={8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">{mode === 'login' ? 'Log in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  async function load() {
    try {
      const [p, h, t] = await Promise.all([
        api<Portfolio>('/portfolio', token), api<Point[]>('/portfolio/history', token), api<Txn[]>('/transactions', token),
      ]);
      setPortfolio(p); setHistory(h); setTxns(t);
    } catch (err) {
      if ((err as { status?: number }).status === 401) onLogout();
    }
  }
  useEffect(() => { load(); }, [token]);

  if (!portfolio) return <main className="page"><p className="muted">Loading…</p></main>;

  const allocation = Object.entries(
    portfolio.funds.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + Number(f.current_value);
      return acc;
    }, {}),
  ).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const chartData = history.map(p => ({ date: p.date, Value: Number(p.value), Invested: Number(p.invested) }));
  const gain = Number(portfolio.absolute_return);

  return (
    <main className="page">
      <header className="row">
        <h1>FundLens</h1>
        <button className="link" onClick={onLogout}>Log out</button>
      </header>

      <section className="stats">
        <Stat label="Invested" value={money(portfolio.invested)} />
        <Stat label="Current value" value={money(portfolio.current_value)} />
        <Stat label="Absolute return" value={money(gain)} tone={gain >= 0 ? 'up' : 'down'}
          sub={Number(portfolio.invested) > 0 ? `${((gain / Number(portfolio.invested)) * 100).toFixed(2)}%` : undefined} />
        <Stat label="XIRR" value={pct(portfolio.xirr)} tone={(portfolio.xirr ?? 0) >= 0 ? 'up' : 'down'} />
      </section>

      <section className="grid">
        <div className="card">
          <h2>Portfolio value over time</h2>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="date" minTickGap={40} tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} width={56} />
                <Tooltip formatter={v => money(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="Value" stroke="#2563eb" dot={false} strokeWidth={2} />
                <Line type="stepAfter" dataKey="Invested" stroke="#94a3b8" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="muted">Add a transaction to see your chart.</p>}
        </div>
        <div className="card">
          <h2>Allocation by category</h2>
          {allocation.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100}>
                  {allocation.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => money(Number(v))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="muted">No holdings yet.</p>}
        </div>
      </section>

      <AddTransaction token={token} onAdded={load} />

      <section className="card">
        <h2>Holdings</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Fund</th><th>Units</th><th>NAV</th><th>Invested</th><th>Value</th><th>Return</th><th>XIRR</th></tr></thead>
            <tbody>
              {portfolio.funds.map(f => (
                <tr key={f.scheme_code}>
                  <td>{f.name}<div className="muted small">{f.category}</div></td>
                  <td>{Number(f.units).toFixed(3)}</td>
                  <td>{f.latest_nav}<div className="muted small">{f.nav_date}</div></td>
                  <td>{money(f.invested)}</td>
                  <td>{money(f.current_value)}</td>
                  <td className={Number(f.absolute_return) >= 0 ? 'up' : 'down'}>{money(f.absolute_return)}</td>
                  <td>{pct(f.xirr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Transactions</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Fund</th><th>Type</th><th>Amount</th><th>NAV</th><th>Units</th></tr></thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id}>
                  <td>{t.txn_date}</td><td>{t.name}</td><td>{t.type}</td>
                  <td>{money(t.amount)}</td><td>{t.nav}</td><td>{t.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className={`big ${tone ?? ''}`}>{value}</div>
      {sub && <div className={`small ${tone ?? ''}`}>{sub}</div>}
    </div>
  );
}

function AddTransaction({ token, onAdded }: { token: string; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ schemeCode: number; schemeName: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function search() {
    setError('');
    try { setResults(await api(`/funds/search?q=${encodeURIComponent(query)}`, token)); }
    catch (err) { setError((err as Error).message); }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setError('');
    try {
      await api('/transactions', token, {
        schemeCode: Number(f.get('schemeCode')), type: f.get('type'), date: f.get('date'), amount: f.get('amount'),
      });
      form.reset();
      onAdded();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2>Add transaction</h2>
      <div className="row">
        <input placeholder="Search fund, e.g. parag parikh flexi" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(); }} aria-label="Search fund" />
        <button type="button" onClick={search} disabled={query.trim().length < 3}>Search</button>
      </div>
      <form onSubmit={submit} className="txn-form">
        <label>Fund
          <select name="schemeCode" required>
            <option value="">{results.length ? 'Select a fund' : 'Search above first'}</option>
            {results.map(r => <option key={r.schemeCode} value={r.schemeCode}>{r.schemeName}</option>)}
          </select>
        </label>
        <label>Type
          <select name="type" defaultValue="SIP">
            <option value="SIP">SIP</option><option value="LUMPSUM">Lump sum</option><option value="REDEMPTION">Redemption</option>
          </select>
        </label>
        <label>Date<input name="date" type="date" required max={new Date().toISOString().slice(0, 10)} /></label>
        <label>Amount (₹)<input name="amount" type="number" min="1" step="0.01" required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
