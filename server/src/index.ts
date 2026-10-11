import express, { type ErrorRequestHandler } from 'express';
import { authRouter } from './auth.ts';
import { portfolioRouter } from './portfolio.ts';
import { HttpError } from './db.ts';
import { ingestLatestNavs, scheduleNavJob } from './nav.ts';

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api/auth', authRouter);
app.use('/api', portfolioRouter);

// Express 5 forwards rejected promises from async handlers here.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  // Malformed JSON body etc. from express.json() carries its own 4xx status.
  if (err.status >= 400 && err.status < 500) { res.status(err.status).json({ error: 'Malformed request body' }); return; }
  // Postgres class 22 = bad data (invalid date, numeric overflow), class 23 = constraint violation.
  if (/^2[23]/.test(err.code ?? '')) { res.status(400).json({ error: 'Invalid input' }); return; }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(onError);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`FundLens API on http://localhost:${port}`));

scheduleNavJob();
if (process.argv.includes('--ingest-now')) ingestLatestNavs();
