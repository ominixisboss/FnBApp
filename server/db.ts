// SQLite storage (Node's built-in node:sqlite). One file, no external database needed.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(dir, { recursive: true });
export const db = new DatabaseSync(process.env.DB_FILE ?? join(dir, 'fab-trainer.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS decks (
    user_id INTEGER NOT NULL, deck_id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, deck_id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    user_id INTEGER NOT NULL, match_id TEXT NOT NULL, json TEXT NOT NULL, date INTEGER NOT NULL, mode TEXT NOT NULL, won INTEGER NOT NULL,
    PRIMARY KEY (user_id, match_id)
  );
`);

/** Secret used to sign session tokens: SESSION_SECRET env var, or a random one stored in the database. */
export function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('session_secret') as { value: string } | undefined;
  if (row) return row.value;
  const v = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('session_secret', v);
  return v;
}

export interface UserRow { id: number; username: string; pass_hash: string; salt: string; created_at: number }

export const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)'),
  getProfile: db.prepare('SELECT json FROM profiles WHERE user_id = ?'),
  putProfile: db.prepare('INSERT INTO profiles (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
  getDecks: db.prepare('SELECT json FROM decks WHERE user_id = ? ORDER BY updated_at DESC'),
  getDeck: db.prepare('SELECT updated_at FROM decks WHERE user_id = ? AND deck_id = ?'),
  putDeck: db.prepare('INSERT INTO decks (user_id, deck_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, deck_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
  delDeck: db.prepare('DELETE FROM decks WHERE user_id = ? AND deck_id = ?'),
  getMatches: db.prepare('SELECT json FROM matches WHERE user_id = ? ORDER BY date DESC LIMIT 1000'),
  putMatch: db.prepare('INSERT OR IGNORE INTO matches (user_id, match_id, json, date, mode, won) VALUES (?, ?, ?, ?, ?, ?)'),
  leaderboard: db.prepare(`
    SELECT u.username AS username, p.json AS profile,
           SUM(m.won) AS wins, COUNT(*) AS games
    FROM matches m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = u.id
    WHERE m.mode = 'online'
    GROUP BY m.user_id
    ORDER BY wins DESC, games ASC
    LIMIT 20`),
};
