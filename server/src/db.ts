import pg from 'pg';

// Keep DATE columns as 'YYYY-MM-DD' strings. The default parser turns them into JS Dates
// at local midnight, which shifts the day when the server's timezone changes.
pg.types.setTypeParser(1082, v => v);
// NUMERIC stays a string (pg's default) so money is never silently turned into a float.

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Run fn inside BEGIN/COMMIT on one connection; any throw rolls everything back.
export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
