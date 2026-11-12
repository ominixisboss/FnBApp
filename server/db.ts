// Storage. Two interchangeable backends behind one async interface:
//   - Postgres when DATABASE_URL is set (e.g. a free Neon database, so data survives
//     restarts on hosts with no persistent disk)
//   - SQLite (Node's built-in node:sqlite) otherwise: one local file, no setup
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface UserRow { id: number; username: string; pass_hash: string; salt: string; created_at: number }
export interface LeaderRow { username: string; profile: string | null; wins: number; games: number }
export interface LadderRow { username: string; profile: string | null; rating: number; games: number }
export interface FriendRow { id: number; username: string; profile: string | null }

export interface Store {
  kind: 'sqlite' | 'postgres';
  userByName(username: string): Promise<UserRow | undefined>;
  userById(id: number): Promise<UserRow | undefined>;
  /** returns the new user's id */
  insertUser(username: string, passHash: string, salt: string, createdAt: number): Promise<number>;
  getProfile(userId: number): Promise<string | undefined>;
  putProfile(userId: number, json: string): Promise<void>;
  getDecks(userId: number): Promise<string[]>;
  getDeckUpdatedAt(userId: number, deckId: string): Promise<number | undefined>;
  putDeck(userId: number, deckId: string, json: string, updatedAt: number): Promise<void>;
  deleteDeck(userId: number, deckId: string): Promise<void>;
  getMatches(userId: number): Promise<string[]>;
  /** ignored if the match was already recorded for this user */
  putMatch(userId: number, matchId: string, json: string, date: number, mode: string, won: boolean): Promise<void>;
  leaderboard(): Promise<LeaderRow[]>;
  /** ranked rating (Elo) for online quick matches */
  getRating(userId: number): Promise<{ rating: number; games: number } | undefined>;
  setRating(userId: number, rating: number, games: number): Promise<void>;
  ladder(): Promise<LadderRow[]>;
  /** friendships are stored both ways */
  friends(userId: number): Promise<FriendRow[]>;
  addFriend(userId: number, friendId: number): Promise<void>;
  removeFriend(userId: number, friendId: number): Promise<void>;
  /** online game replays: the starting position and every action */
  putReplay(matchId: string, json: string): Promise<void>;
  getReplay(matchId: string): Promise<string | undefined>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}

const LADDER_SQL = `
  SELECT u.username AS username, p.json AS profile, r.rating AS rating, r.games AS games
  FROM ratings r JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.user_id = u.id
  ORDER BY r.rating DESC, r.games DESC
  LIMIT 50`;
const FRIENDS_SQL = (ph: string) => `
  SELECT u.id AS id, u.username AS username, p.json AS profile
  FROM friends f JOIN users u ON u.id = f.friend_id LEFT JOIN profiles p ON p.user_id = u.id
  WHERE f.user_id = ${ph} ORDER BY u.username`;
const EXTRA_TABLES = (big: string) => `
    CREATE TABLE IF NOT EXISTS ratings (user_id INTEGER PRIMARY KEY, rating INTEGER NOT NULL, games INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS friends (user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, created_at ${big} NOT NULL, PRIMARY KEY (user_id, friend_id));
    CREATE TABLE IF NOT EXISTS replays (match_id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at ${big} NOT NULL);
`;

const LEADERBOARD_SQL = `
  SELECT u.username AS username, p.json AS profile, SUM(m.won) AS wins, COUNT(*) AS games
  FROM matches m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = u.id
  WHERE m.mode = 'online'
  GROUP BY u.id, u.username, p.json
  ORDER BY wins DESC, games ASC
  LIMIT 20`;

// ---------------------------------------------------------------- SQLite

async function sqliteStore(): Promise<Store> {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(process.env.DB_FILE ?? join(dir, 'fab-trainer.sqlite'));
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
  ` + EXTRA_TABLES('INTEGER'));
  const st = {
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
    leaderboard: db.prepare(LEADERBOARD_SQL),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getRating: db.prepare('SELECT rating, games FROM ratings WHERE user_id = ?'),
    setRating: db.prepare('INSERT INTO ratings (user_id, rating, games) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, games = excluded.games'),
    ladder: db.prepare(LADDER_SQL),
    friends: db.prepare(FRIENDS_SQL('?')),
    addFriend: db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)'),
    delFriend: db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?'),
    putReplay: db.prepare('INSERT OR REPLACE INTO replays (match_id, json, created_at) VALUES (?, ?, ?)'),
    getReplay: db.prepare('SELECT json FROM replays WHERE match_id = ?'),
    trimReplays: db.prepare('DELETE FROM replays WHERE created_at < ?'),
  };
  const user = (r: unknown) => (r ? (r as UserRow) : undefined);
  return {
    kind: 'sqlite',
    userByName: async (n) => user(st.userByName.get(n)),
    userById: async (id) => user(st.userById.get(id)),
    insertUser: async (n, h, s, c) => Number(st.insertUser.run(n, h, s, c).lastInsertRowid),
    getProfile: async (id) => (st.getProfile.get(id) as { json: string } | undefined)?.json,
    putProfile: async (id, json) => { st.putProfile.run(id, json, Date.now()); },
    getDecks: async (id) => (st.getDecks.all(id) as { json: string }[]).map((r) => r.json),
    getDeckUpdatedAt: async (id, d) => (st.getDeck.get(id, d) as { updated_at: number } | undefined)?.updated_at,
    putDeck: async (id, d, json, u) => { st.putDeck.run(id, d, json, u); },
    deleteDeck: async (id, d) => { st.delDeck.run(id, d); },
    getMatches: async (id) => (st.getMatches.all(id) as { json: string }[]).map((r) => r.json),
    putMatch: async (id, m, json, date, mode, won) => { st.putMatch.run(id, m, json, date, mode, won ? 1 : 0); },
    leaderboard: async () => st.leaderboard.all() as unknown as LeaderRow[],
    getMeta: async (k) => (st.getMeta.get(k) as { value: string } | undefined)?.value,
    setMeta: async (k, v) => { st.setMeta.run(k, v); },
    getRating: async (id) => st.getRating.get(id) as { rating: number; games: number } | undefined,
    setRating: async (id, r, g) => { st.setRating.run(id, r, g); },
    ladder: async () => st.ladder.all() as unknown as LadderRow[],
    friends: async (id) => st.friends.all(id) as unknown as FriendRow[],
    addFriend: async (a, b) => { const t = Date.now(); st.addFriend.run(a, b, t); st.addFriend.run(b, a, t); },
    removeFriend: async (a, b) => { st.delFriend.run(a, b); st.delFriend.run(b, a); },
    putReplay: async (m, json) => { st.putReplay.run(m, json, Date.now()); st.trimReplays.run(Date.now() - REPLAY_DAYS * 864e5); },
    getReplay: async (m) => (st.getReplay.get(m) as { json: string } | undefined)?.json,
  };
}

/** online replays are kept this long */
const REPLAY_DAYS = 60;

// ---------------------------------------------------------------- Postgres

async function postgresStore(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  // timestamps are stored as BIGINT milliseconds; return them as numbers, not strings
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  const run = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  await run(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
    CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS decks (
      user_id INTEGER NOT NULL, deck_id TEXT NOT NULL, json TEXT NOT NULL, updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, deck_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      user_id INTEGER NOT NULL, match_id TEXT NOT NULL, json TEXT NOT NULL, date BIGINT NOT NULL, mode TEXT NOT NULL, won INTEGER NOT NULL,
      PRIMARY KEY (user_id, match_id)
    );
  ` + EXTRA_TABLES('BIGINT'));
  const one = async <T>(sql: string, params: unknown[]) => (await run(sql, params)).rows[0] as T | undefined;
  return {
    kind: 'postgres',
    userByName: (n) => one<UserRow>('SELECT * FROM users WHERE lower(username) = lower($1)', [n]),
    userById: (id) => one<UserRow>('SELECT * FROM users WHERE id = $1', [id]),
    insertUser: async (n, h, s, c) => (await one<{ id: number }>('INSERT INTO users (username, pass_hash, salt, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [n, h, s, c]))!.id,
    getProfile: async (id) => (await one<{ json: string }>('SELECT json FROM profiles WHERE user_id = $1', [id]))?.json,
    putProfile: async (id, json) => { await run('INSERT INTO profiles (user_id, json, updated_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at', [id, json, Date.now()]); },
    getDecks: async (id) => (await run('SELECT json FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [id])).rows.map((r) => r.json),
    getDeckUpdatedAt: async (id, d) => (await one<{ updated_at: number }>('SELECT updated_at FROM decks WHERE user_id = $1 AND deck_id = $2', [id, d]))?.updated_at,
    putDeck: async (id, d, json, u) => { await run('INSERT INTO decks (user_id, deck_id, json, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, deck_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at', [id, d, json, u]); },
    deleteDeck: async (id, d) => { await run('DELETE FROM decks WHERE user_id = $1 AND deck_id = $2', [id, d]); },
    getMatches: async (id) => (await run('SELECT json FROM matches WHERE user_id = $1 ORDER BY date DESC LIMIT 1000', [id])).rows.map((r) => r.json),
    putMatch: async (id, m, json, date, mode, won) => { await run('INSERT INTO matches (user_id, match_id, json, date, mode, won) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', [id, m, json, date, mode, won ? 1 : 0]); },
    leaderboard: async () => (await run(LEADERBOARD_SQL)).rows.map((r) => ({ ...r, wins: Number(r.wins), games: Number(r.games) })),
    getMeta: async (k) => (await one<{ value: string }>('SELECT value FROM meta WHERE key = $1', [k]))?.value,
    setMeta: async (k, v) => { await run('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, v]); },
    getRating: (id) => one<{ rating: number; games: number }>('SELECT rating, games FROM ratings WHERE user_id = $1', [id]),
    setRating: async (id, r, g) => { await run('INSERT INTO ratings (user_id, rating, games) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET rating = excluded.rating, games = excluded.games', [id, r, g]); },
    ladder: async () => (await run(LADDER_SQL)).rows as LadderRow[],
    friends: async (id) => (await run(FRIENDS_SQL('$1'), [id])).rows as FriendRow[],
    addFriend: async (a, b) => { const t = Date.now(); await run('INSERT INTO friends (user_id, friend_id, created_at) VALUES ($1, $2, $3), ($2, $1, $3) ON CONFLICT DO NOTHING', [a, b, t]); },
    removeFriend: async (a, b) => { await run('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [a, b]); },
    putReplay: async (m, json) => {
      await run('INSERT INTO replays (match_id, json, created_at) VALUES ($1, $2, $3) ON CONFLICT (match_id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at', [m, json, Date.now()]);
      await run('DELETE FROM replays WHERE created_at < $1', [Date.now() - REPLAY_DAYS * 864e5]);
    },
    getReplay: async (m) => (await one<{ json: string }>('SELECT json FROM replays WHERE match_id = $1', [m]))?.json,
  };
}

// ---------------------------------------------------------------- setup

export let store: Store;
let secret = '';

/** Connect to the configured database and load the session secret. Call once at startup. */
export async function initStore(): Promise<Store> {
  store = process.env.DATABASE_URL ? await postgresStore(process.env.DATABASE_URL) : await sqliteStore();
  secret = process.env.SESSION_SECRET ?? (await store.getMeta('session_secret')) ?? '';
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    await store.setMeta('session_secret', secret);
  }
  return store;
}

/** Secret used to sign session tokens: SESSION_SECRET env var, or a random one stored in the database. */
export function sessionSecret(): string {
  return secret;
}

/** True when data will not survive a restart (free hosting with no disk and no DATABASE_URL). */
export const ephemeral = () => process.env.EPHEMERAL_DATA === '1' && !process.env.DATABASE_URL;
