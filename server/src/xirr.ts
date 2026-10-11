// XIRR: the annual rate r where the NPV of dated cash flows is zero.
//   sum( amount_i / (1 + r) ^ (days_i / 365) ) = 0
// Money going in (purchases) is negative, money coming out (redemptions, current value) is positive.

export type CashFlow = { amount: number; date: string }; // date = 'YYYY-MM-DD'

const DAY_MS = 86_400_000;

export function xirr(flows: CashFlow[]): number | null {
  // Needs at least one inflow and one outflow, otherwise no rate exists.
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null;

  const times = flows.map(f => Date.parse(f.date));
  const t0 = Math.min(...times);
  const years = times.map(t => (t - t0) / DAY_MS / 365);

  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i], 0);
  const dnpv = (r: number) => flows.reduce((s, f, i) => s - (years[i] * f.amount) / (1 + r) ** (years[i] + 1), 0);

  // Newton-Raphson: fast (quadratic) when it converges.
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const d = dnpv(r);
    if (d === 0) break;
    const next = r - npv(r) / d;
    if (!Number.isFinite(next) || next <= -1) break; // diverged, fall back
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }

  // Bisection fallback: slower but guaranteed if the root is bracketed.
  let lo = -0.9999, hi = 100;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-7) return mid;
    if (npv(lo) * v < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
