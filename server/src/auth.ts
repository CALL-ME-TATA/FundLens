import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, HttpError } from './db.ts';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET is not set');

export type AuthedRequest = Request & { userId: number };

function issueToken(userId: number) {
  return jwt.sign({ sub: String(userId) }, SECRET, { expiresIn: '1h' });
}

function readCredentials(body: any) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Invalid email');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email, password };
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id',
    [email, hash],
  );
  if (!rows[0]) throw new HttpError(409, 'Email already registered');
  res.status(201).json({ token: issueToken(rows[0].id) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  // Same message for "no user" and "wrong password" so attackers can't enumerate emails.
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  res.json({ token: issueToken(rows[0].id) });
});

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) throw new HttpError(401, 'Missing token');
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    (req as AuthedRequest).userId = Number(payload.sub);
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}
