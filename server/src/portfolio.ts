import { Router } from 'express';
import { pool, withTx, HttpError } from './db.ts';
import { requireAuth, type AuthedRequest } from './auth.ts';
import { ensureFund, searchFunds } from './nav.ts';
import { xirr, type CashFlow } from './xirr.ts';

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

const TYPES = ['SIP', 'LUMPSUM', 'REDEMPTION'];
// NAV dates are Indian calendar days, so "today" is IST, not UTC (UTC lags IST by 5:30 every morning).
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

portfolioRouter.get('/funds/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) throw new HttpError(400, 'Query must be at least 3 characters');
  res.json(await searchFunds(q));
});

portfolioRouter.post('/transactions', async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const schemeCode = Number(req.body?.schemeCode);
  const type = String(req.body?.type);
  const date = String(req.body?.date);
  const amount = String(req.body?.amount);

  if (!Number.isInteger(schemeCode) || schemeCode <= 0) throw new HttpError(400, 'Invalid schemeCode');
  if (!TYPES.includes(type)) throw new HttpError(400, `type must be one of ${TYPES.join(', ')}`);
  // Round-trip check rejects impossible dates like 2024-02-30, which Date.parse silently rolls over.
  const parsed = new Date(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new HttpError(400, 'Invalid date');
  if (date > today()) throw new HttpError(400, 'Date cannot be in the future');
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new HttpError(400, 'amount must be a number with up to 2 decimals');
  if (Number(amount) < 1 || Number(amount) > 1e9) throw new HttpError(400, 'amount must be between ₹1 and ₹100 crore');

  await ensureFund(schemeCode);

  const txn = await withTx(async c => {
    // Serialize writes per user: two concurrent redemptions can't both pass the holdings check.
    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);

    // Use the NAV on the transaction date, or the last business day before it (weekends/holidays).
    // Units are computed in SQL so the division stays exact NUMERIC.
    const { rows: [n] } = await c.query(
      `SELECT nav, ROUND($2::numeric / nav, 4) AS units FROM nav_history
       WHERE scheme_code = $1 AND nav_date <= $3 ORDER BY nav_date DESC LIMIT 1`,
      [schemeCode, amount, date],
    );
    if (!n) throw new HttpError(400, 'No NAV available on or before that date');

    if (type === 'REDEMPTION') {
      const { rows: [h] } = await c.query(
        `SELECT COALESCE(SUM(CASE WHEN type = 'REDEMPTION' THEN -units ELSE units END), 0) >= $3::numeric AS ok
         FROM transactions WHERE user_id = $1 AND scheme_code = $2`,
        [userId, schemeCode, n.units],
      );
      if (!h.ok) throw new HttpError(400, 'Redemption exceeds units held');
    }

    const { rows: [t] } = await c.query(
      `INSERT INTO transactions (user_id, scheme_code, type, txn_date, amount, units, nav)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, schemeCode, type, date, amount, n.units, n.nav],
    );
    return t;
  });
  res.status(201).json(txn);
});

portfolioRouter.get('/transactions', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, f.name FROM transactions t JOIN funds f USING (scheme_code)
     WHERE user_id = $1 ORDER BY txn_date DESC, id DESC`,
    [(req as AuthedRequest).userId],
  );
  res.json(rows);
});

// Per-fund holdings valued at the latest NAV. All money math stays in SQL NUMERIC.
const HOLDINGS = `
  WITH per_fund AS (
    SELECT f.scheme_code, f.name, split_part(f.category, ' - ', 1) AS category,
           SUM(CASE WHEN t.type = 'REDEMPTION' THEN -t.units ELSE t.units END) AS units,
           SUM(CASE WHEN t.type <> 'REDEMPTION' THEN t.amount ELSE 0 END)     AS invested,
           SUM(CASE WHEN t.type = 'REDEMPTION' THEN t.amount ELSE 0 END)      AS redeemed,
           n.nav AS latest_nav, n.nav_date
    FROM transactions t
    JOIN funds f USING (scheme_code)
    CROSS JOIN LATERAL (
      SELECT nav, nav_date FROM nav_history WHERE scheme_code = f.scheme_code ORDER BY nav_date DESC LIMIT 1
    ) n
    WHERE t.user_id = $1
    GROUP BY f.scheme_code, n.nav, n.nav_date
  )
  SELECT *, ROUND(units * latest_nav, 2) AS current_value FROM per_fund`;

portfolioRouter.get('/portfolio', async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const [{ rows: funds }, { rows: [totals] }, { rows: txns }] = await Promise.all([
    pool.query(`SELECT *, current_value + redeemed - invested AS absolute_return FROM (${HOLDINGS}) h ORDER BY current_value DESC`, [userId]),
    pool.query(
      `SELECT COALESCE(SUM(invested), 0) AS invested, COALESCE(SUM(redeemed), 0) AS redeemed,
              COALESCE(SUM(current_value), 0) AS current_value,
              COALESCE(SUM(current_value + redeemed - invested), 0) AS absolute_return
       FROM (${HOLDINGS}) h`,
      [userId],
    ),
    pool.query('SELECT scheme_code, type, txn_date, amount FROM transactions WHERE user_id = $1', [userId]),
  ]);

  // XIRR: purchases are outflows (-), redemptions are inflows (+), and today's value is a final inflow.
  // Float is fine here: XIRR is an iterative approximation, not a ledger amount.
  const flowsFor = (code?: number): CashFlow[] => {
    const flows = txns
      .filter(t => code === undefined || t.scheme_code === code)
      .map(t => ({ amount: (t.type === 'REDEMPTION' ? 1 : -1) * Number(t.amount), date: t.txn_date }));
    const value = code === undefined ? totals.current_value : funds.find(f => f.scheme_code === code)?.current_value;
    if (Number(value) > 0) flows.push({ amount: Number(value), date: today() });
    return flows;
  };

  res.json({
    ...totals,
    xirr: xirr(flowsFor()),
    funds: funds.map(f => ({ ...f, xirr: xirr(flowsFor(f.scheme_code)) })),
  });
});

// Portfolio value vs. net invested, sampled weekly from the first transaction to today.
portfolioRouter.get('/portfolio/history', async (req, res) => {
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(MIN(txn_date), CURRENT_DATE, '7 days')::date AS d
       FROM transactions WHERE user_id = $1
       UNION SELECT CURRENT_DATE
     )
     SELECT d AS date,
            ROUND(SUM(h.units * n.nav), 2) AS value,
            SUM(h.net_invested)            AS invested
     FROM days
     CROSS JOIN LATERAL (
       SELECT scheme_code,
              SUM(CASE WHEN type = 'REDEMPTION' THEN -units  ELSE units  END) AS units,
              SUM(CASE WHEN type = 'REDEMPTION' THEN -amount ELSE amount END) AS net_invested
       FROM transactions WHERE user_id = $1 AND txn_date <= d GROUP BY scheme_code
     ) h
     CROSS JOIN LATERAL (
       SELECT nav FROM nav_history WHERE scheme_code = h.scheme_code AND nav_date <= d
       ORDER BY nav_date DESC LIMIT 1
     ) n
     GROUP BY d ORDER BY d`,
    [(req as AuthedRequest).userId],
  );
  res.json(rows);
});
