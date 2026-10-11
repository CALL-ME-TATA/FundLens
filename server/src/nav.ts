import cron from 'node-cron';
import { pool, HttpError } from './db.ts';

const API = 'https://api.mfapi.in/mf';

type MfApiResponse = {
  meta: { scheme_code: number; scheme_name: string; fund_house: string; scheme_category: string };
  data: { date: string; nav: string }[]; // date is 'DD-MM-YYYY', newest first
  status: string;
};

const toIsoDate = (ddmmyyyy: string) => ddmmyyyy.split('-').reverse().join('-');

async function fetchFund(schemeCode: number, latestOnly: boolean): Promise<MfApiResponse> {
  const res = await fetch(`${API}/${schemeCode}${latestOnly ? '/latest' : ''}`);
  if (!res.ok) throw new HttpError(502, `NAV API returned ${res.status}`);
  const body = (await res.json()) as MfApiResponse;
  if (body.status !== 'SUCCESS' || !body.meta?.scheme_name) throw new HttpError(404, `Unknown scheme ${schemeCode}`);
  return body;
}

// Idempotent upsert: re-running the job never creates duplicates, and AMFI corrections overwrite.
async function saveNavs(schemeCode: number, data: MfApiResponse['data']) {
  const rows = data.filter(d => Number(d.nav) > 0);
  await pool.query(
    `INSERT INTO nav_history (scheme_code, nav_date, nav)
     SELECT $1, unnest($2::date[]), unnest($3::numeric[])
     ON CONFLICT (scheme_code, nav_date) DO UPDATE SET nav = EXCLUDED.nav`,
    [schemeCode, rows.map(d => toIsoDate(d.date)), rows.map(d => d.nav)],
  );
}

// First time a fund is used: store its metadata and full NAV history.
export async function ensureFund(schemeCode: number) {
  const { rowCount } = await pool.query('SELECT 1 FROM funds WHERE scheme_code = $1', [schemeCode]);
  if (rowCount) return;
  const { meta, data } = await fetchFund(schemeCode, false);
  await pool.query(
    `INSERT INTO funds (scheme_code, name, fund_house, category) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [schemeCode, meta.scheme_name, meta.fund_house, meta.scheme_category],
  );
  await saveNavs(schemeCode, data);
}

export async function searchFunds(q: string) {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new HttpError(502, 'NAV API search failed');
  return ((await res.json()) as { schemeCode: number; schemeName: string }[]).slice(0, 20);
}

// Daily job: pull the latest NAV for every fund we track.
export async function ingestLatestNavs() {
  const { rows } = await pool.query<{ scheme_code: number }>('SELECT scheme_code FROM funds');
  let ok = 0;
  for (const { scheme_code } of rows) {
    try {
      const { data } = await fetchFund(scheme_code, true);
      await saveNavs(scheme_code, data);
      ok++;
    } catch (e) {
      // One bad fund must not stop the rest; the next run retries it.
      console.error(`NAV ingest failed for ${scheme_code}:`, (e as Error).message);
    }
  }
  console.log(`NAV ingest: ${ok}/${rows.length} funds updated`);
}

export function scheduleNavJob() {
  // AMFI publishes NAVs by ~11 PM IST on business days.
  cron.schedule('30 23 * * *', ingestLatestNavs, { timezone: 'Asia/Kolkata' });
}
