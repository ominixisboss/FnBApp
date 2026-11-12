// FaB Trainer server: serves the built app, the account/sync API and online play.
//   npm run build && npm run server        (PORT defaults to 8787)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { makeDb, setDb } from '../src/data/cardDb';
import { ephemeral, initStore, store } from './db';
import type { UserRow } from './db';
import { checkPassword, hashPassword, makeToken, userFromToken, validateCredentials } from './auth';
import { onConnect, onDisconnect, onMessage, presence, roomCount, tierOf } from './rooms';
import type { ClientMsg } from './rooms';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);

// card database for the rules engine
const cardsFile = [join(DIST, 'data/cards.json'), join(ROOT, 'public/data/cards.json')].find(existsSync)!;
const cardJson = JSON.parse(readFileSync(cardsFile, 'utf8'));
setDb(makeDb(cardJson.cards, cardJson.builtAt));

// ---------------------------------------------------------------- helpers
const MAX_BODY = 2 * 1024 * 1024;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const bearer = (req: IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;

// simple per-IP rate limit for login/register
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimited(req: IncomingMessage): boolean {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { n: 1, reset: now + 60_000 }); return false; }
  a.n++;
  return a.n > 20;
}

const publicUser = (u: UserRow) => ({ id: u.id, username: u.username, createdAt: u.created_at });

// ---------------------------------------------------------------- API
async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const url = new URL(req.url ?? "/", "http://x");
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (path === '/api/health') return json(res, 200, { ok: true, cards: cardJson.cards.length, ephemeral: ephemeral(), storage: store.kind, ...roomCount() });

    if ((path === '/api/register' || path === '/api/login') && req.method === 'POST') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts, wait a minute.' });
      const { username, password } = (await readBody(req)) as { username?: string; password?: string };
      const bad = validateCredentials(username, password);
      if (bad) return json(res, 400, { error: bad });
      const existing = await store.userByName(username!);
      if (path === '/api/register') {
        if (existing) return json(res, 409, { error: 'That username is taken.' });
        const { salt, hash } = hashPassword(password!);
        let id: number;
        try {
          id = await store.insertUser(username!, hash, salt, Date.now());
        } catch {
          return json(res, 409, { error: 'That username is taken.' }); // lost a race with another sign-up
        }
        const user = (await store.userById(id))!;
        return json(res, 200, { token: makeToken(user.id), user: publicUser(user) });
      }
      if (!existing || !checkPassword(password!, existing)) return json(res, 401, { error: 'Wrong username or password.' });
      return json(res, 200, { token: makeToken(existing.id), user: publicUser(existing) });
    }

    if (path === '/api/leaderboard' && req.method === 'GET') {
      const rows = await store.leaderboard();
      return json(res, 200, rows.map((r) => {
        let p: { displayName?: string; avatarHeroId?: string } = {};
        try { p = r.profile ? JSON.parse(r.profile) : {}; } catch { /* ignore */ }
        return { name: p.displayName || r.username, username: r.username, avatarHeroId: p.avatarHeroId ?? null, wins: r.wins, games: r.games };
      }));
    }

    if (path === '/api/ladder' && req.method === 'GET') {
      const rows = await store.ladder();
      return json(res, 200, rows.map((r) => {
        let p: { displayName?: string; avatarHeroId?: string } = {};
        try { p = r.profile ? JSON.parse(r.profile) : {}; } catch { /* ignore */ }
        return { name: p.displayName || r.username, username: r.username, avatarHeroId: p.avatarHeroId ?? null, rating: r.rating, games: r.games, tier: tierOf(r.rating) };
      }));
    }

    // everything below needs a signed-in user
    const user = await userFromToken(bearer(req));
    if (!user) return json(res, 401, { error: 'Please sign in again.' });

    if (path === '/api/me' && req.method === 'GET') {
      const row = await store.getProfile(user.id);
      const r = await store.getRating(user.id);
      const rating = r ? { rating: r.rating, games: r.games, tier: tierOf(r.rating) } : null;
      return json(res, 200, { user: publicUser(user), profile: row ? JSON.parse(row) : null, rating });
    }
    if (path === '/api/profile' && req.method === 'PUT') {
      const p = (await readBody(req)) as Record<string, unknown>;
      const clean = {
        displayName: String(p.displayName ?? user.username).slice(0, 24),
        avatarHeroId: typeof p.avatarHeroId === 'string' ? p.avatarHeroId.slice(0, 40) : null,
        createdAt: Number(p.createdAt) || user.created_at,
        // equipped cosmetics: short ids only
        cosmetics: Object.fromEntries(Object.entries((p.cosmetics ?? {}) as Record<string, unknown>)
          .filter(([k, v]) => ['sleeve', 'mat', 'frame'].includes(k) && typeof v === 'string' && v.length <= 20)),
      };
      await store.putProfile(user.id, JSON.stringify(clean));
      return json(res, 200, { profile: clean });
    }
    if (path === '/api/decks' && req.method === 'GET') {
      return json(res, 200, { decks: (await store.getDecks(user.id)).map((r) => JSON.parse(r)) });
    }
    if (path === '/api/decks' && req.method === 'PUT') {
      const { decks = [], deleted = [] } = (await readBody(req)) as { decks?: { id: string; updatedAt: number }[]; deleted?: string[] };
      if (!Array.isArray(decks) || decks.length > 500) return json(res, 400, { error: 'Invalid decks' });
      for (const d of decks) {
        if (!d || typeof d.id !== 'string' || d.id.length > 40) continue;
        const cur = await store.getDeckUpdatedAt(user.id, d.id);
        if (cur === undefined || cur <= (Number(d.updatedAt) || 0)) await store.putDeck(user.id, d.id, JSON.stringify(d), Number(d.updatedAt) || Date.now());
      }
      for (const id of Array.isArray(deleted) ? deleted : []) if (typeof id === 'string') await store.deleteDeck(user.id, id);
      return json(res, 200, { decks: (await store.getDecks(user.id)).map((r) => JSON.parse(r)) });
    }
    if (path === '/api/matches' && req.method === 'GET') {
      return json(res, 200, { matches: (await store.getMatches(user.id)).map((r) => JSON.parse(r)) });
    }
    if (path === '/api/matches' && req.method === 'POST') {
      const { matches = [] } = (await readBody(req)) as { matches?: { id: string; date: number; won: boolean; mode?: string }[] };
      for (const m of matches.slice(0, 1000)) {
        if (!m || typeof m.id !== 'string' || m.mode === 'online') continue; // online results are recorded by the server
        await store.putMatch(user.id, m.id.slice(0, 60), JSON.stringify(m), Number(m.date) || Date.now(), 'ai', !!m.won);
      }
      return json(res, 200, { ok: true });
    }
    if (path === '/api/friends' && req.method === 'GET') {
      const rows = await store.friends(user.id);
      return json(res, 200, rows.map((f) => {
        let p: { displayName?: string; avatarHeroId?: string } = {};
        try { p = f.profile ? JSON.parse(f.profile) : {}; } catch { /* ignore */ }
        return { username: f.username, name: p.displayName || f.username, avatarHeroId: p.avatarHeroId ?? null, status: presence(f.id) };
      }));
    }
    if (path === '/api/friends' && req.method === 'POST') {
      const { username } = (await readBody(req)) as { username?: string };
      const other = await store.userByName(String(username ?? '').trim());
      if (!other) return json(res, 404, { error: 'No player with that username.' });
      if (other.id === user.id) return json(res, 400, { error: 'That’s you!' });
      await store.addFriend(user.id, other.id);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/friends' && req.method === 'DELETE') {
      const other = await store.userByName(String(url.searchParams.get('username') ?? ''));
      if (other) await store.removeFriend(user.id, other.id);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/replay' && req.method === 'GET') {
      const raw = await store.getReplay(String(url.searchParams.get('match') ?? ''));
      if (!raw) return json(res, 404, { error: 'This replay is no longer available.' });
      const r = JSON.parse(raw) as { users: number[] };
      if (!r.users.includes(user.id)) return json(res, 403, { error: 'You weren’t in that game.' });
      return json(res, 200, r);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 400, { error: e instanceof Error ? e.message : 'Bad request' });
  }
}

// ---------------------------------------------------------------- static files
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('FaB Trainer API is running. Build the app (npm run build) to serve it from here.');
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

// ---------------------------------------------------------------- server
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path.startsWith('/api/')) { void api(req, res, path); return; }
  serveStatic(req, res, path);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  void userFromToken(url.searchParams.get('token')).then((user) => {
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const u = { id: user.id, username: user.username };
    onConnect(ws, u);
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      void onMessage(ws, u, msg);
    });
    ws.on('close', () => onDisconnect(ws, u.id));
  });
  });
});

// keep connections alive through proxies
setInterval(() => wss.clients.forEach((c) => c.ping()), 25_000).unref();

await initStore();
server.listen(PORT, () => console.log(`FaB Trainer server on http://localhost:${PORT} (storage: ${store.kind}${ephemeral() ? ', ephemeral' : ''})`));
