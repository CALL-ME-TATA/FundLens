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
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(onError);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`FundLens API on http://localhost:${port}`));

scheduleNavJob();
if (process.argv.includes('--ingest-now')) ingestLatestNavs();
