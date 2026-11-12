// Password hashing (scrypt) and signed session tokens (HMAC-SHA256), no external libraries.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { sessionSecret, store } from './db';
import type { UserRow } from './db';

const TOKEN_DAYS = 30;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function checkPassword(password: string, user: UserRow): boolean {
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const b = Buffer.from(user.pass_hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const sign = (data: string) => createHmac('sha256', sessionSecret()).update(data).digest('base64url');

export function makeToken(userId: number): string {
  const data = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + TOKEN_DAYS * 864e5 })).toString('base64url');
  return `${data}.${sign(data)}`;
}

export async function userFromToken(token: string | null | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (typeof u !== 'number' || Date.now() > e) return null;
    return (await store.userById(u)) ?? null;
  } catch {
    return null;
  }
}

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,20}$/.test(username)) return 'Username must be 3–20 letters, numbers, _ or -.';
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) return 'Password must be at least 6 characters.';
  return null;
}
