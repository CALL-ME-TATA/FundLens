# FundLens

Mutual fund portfolio tracker. Record SIP, lump-sum and redemption transactions; see current value, absolute return and XIRR per fund and for the whole portfolio. NAVs come from the public [mfapi.in](https://www.mfapi.in/) API (AMFI data) and refresh daily.

**Stack:** TypeScript · Node.js 24 · Express 5 · PostgreSQL 16 · React 19 · Recharts · Vite

## Run it

```bash
docker compose up -d          # Postgres on :5432, schema auto-loaded from server/schema.sql
cd server && npm i && cp .env.example .env && npm run dev   # API on :4000
cd client && npm i && npm run dev                           # UI on :5173
```

`npm test` in `server/` runs the XIRR tests. `npm run ingest` triggers the NAV job immediately.

## Layout

```
server/
  schema.sql          tables, constraints, indexes
  src/index.ts        Express app + error handler + cron start
  src/db.ts           pg pool, withTx() transaction helper
  src/auth.ts         register / login (bcrypt + JWT), requireAuth middleware
  src/portfolio.ts    transactions, holdings, XIRR, value-over-time
  src/nav.ts          NAV fetch, idempotent upsert, daily cron job
  src/xirr.ts         Newton-Raphson + bisection XIRR solver (+ xirr.test.ts)
client/src/App.tsx    login, dashboard, charts, add-transaction form
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | `{email, password}` → `{token}` |
| POST | `/api/auth/login` | `{email, password}` → `{token}` |
| GET | `/api/funds/search?q=` | Search schemes by name |
| POST | `/api/transactions` | `{schemeCode, type, date, amount}` |
| GET | `/api/transactions` | User's transactions |
| GET | `/api/portfolio` | Totals, per-fund holdings, XIRR |
| GET | `/api/portfolio/history` | Weekly portfolio value vs net invested |

All routes except auth need `Authorization: Bearer <token>`.
