// FaB Trainer server: serves the built app, the account/sync API and online play.
//   npm run build && npm run server        (PORT defaults to 8787)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { makeDb, setDb } from '../src/data/cardDb';
import { q } from './db';
import type { UserRow } from './db';
import { checkPassword, hashPassword, makeToken, userFromToken, validateCredentials } from './auth';
import { onConnect, onDisconnect, onMessage, roomCount } from './rooms';
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
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (path === '/api/health') return json(res, 200, { ok: true, cards: cardJson.cards.length, ephemeral: process.env.EPHEMERAL_DATA === '1', ...roomCount() });

    if ((path === '/api/register' || path === '/api/login') && req.method === 'POST') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts, wait a minute.' });
      const { username, password } = (await readBody(req)) as { username?: string; password?: string };
      const bad = validateCredentials(username, password);
      if (bad) return json(res, 400, { error: bad });
      const existing = q.userByName.get(username!) as UserRow | undefined;
      if (path === '/api/register') {
        if (existing) return json(res, 409, { error: 'That username is taken.' });
        const { salt, hash } = hashPassword(password!);
        const r = q.insertUser.run(username!, hash, salt, Date.now());
        const user = q.userById.get(Number(r.lastInsertRowid)) as unknown as UserRow;
        return json(res, 200, { token: makeToken(user.id), user: publicUser(user) });
      }
      if (!existing || !checkPassword(password!, existing)) return json(res, 401, { error: 'Wrong username or password.' });
      return json(res, 200, { token: makeToken(existing.id), user: publicUser(existing) });
    }

    if (path === '/api/leaderboard' && req.method === 'GET') {
      const rows = q.leaderboard.all() as { username: string; profile: string | null; wins: number; games: number }[];
      return json(res, 200, rows.map((r) => {
        let p: { displayName?: string; avatarHeroId?: string } = {};
        try { p = r.profile ? JSON.parse(r.profile) : {}; } catch { /* ignore */ }
        return { name: p.displayName || r.username, username: r.username, avatarHeroId: p.avatarHeroId ?? null, wins: r.wins, games: r.games };
      }));
    }

    // everything below needs a signed-in user
    const user = userFromToken(bearer(req));
    if (!user) return json(res, 401, { error: 'Please sign in again.' });

    if (path === '/api/me' && req.method === 'GET') {
      const row = q.getProfile.get(user.id) as { json: string } | undefined;
      return json(res, 200, { user: publicUser(user), profile: row ? JSON.parse(row.json) : null });
    }
    if (path === '/api/profile' && req.method === 'PUT') {
      const p = (await readBody(req)) as Record<string, unknown>;
      const clean = {
        displayName: String(p.displayName ?? user.username).slice(0, 24),
        avatarHeroId: typeof p.avatarHeroId === 'string' ? p.avatarHeroId.slice(0, 40) : null,
        createdAt: Number(p.createdAt) || user.created_at,
      };
      q.putProfile.run(user.id, JSON.stringify(clean), Date.now());
      return json(res, 200, { profile: clean });
    }
    if (path === '/api/decks' && req.method === 'GET') {
      return json(res, 200, { decks: (q.getDecks.all(user.id) as { json: string }[]).map((r) => JSON.parse(r.json)) });
    }
    if (path === '/api/decks' && req.method === 'PUT') {
      const { decks = [], deleted = [] } = (await readBody(req)) as { decks?: { id: string; updatedAt: number }[]; deleted?: string[] };
      if (!Array.isArray(decks) || decks.length > 500) return json(res, 400, { error: 'Invalid decks' });
      for (const d of decks) {
        if (!d || typeof d.id !== 'string' || d.id.length > 40) continue;
        const cur = q.getDeck.get(user.id, d.id) as { updated_at: number } | undefined;
        if (!cur || cur.updated_at <= (Number(d.updatedAt) || 0)) q.putDeck.run(user.id, d.id, JSON.stringify(d), Number(d.updatedAt) || Date.now());
      }
      for (const id of Array.isArray(deleted) ? deleted : []) if (typeof id === 'string') q.delDeck.run(user.id, id);
      return json(res, 200, { decks: (q.getDecks.all(user.id) as { json: string }[]).map((r) => JSON.parse(r.json)) });
    }
    if (path === '/api/matches' && req.method === 'GET') {
      return json(res, 200, { matches: (q.getMatches.all(user.id) as { json: string }[]).map((r) => JSON.parse(r.json)) });
    }
    if (path === '/api/matches' && req.method === 'POST') {
      const { matches = [] } = (await readBody(req)) as { matches?: { id: string; date: number; won: boolean; mode?: string }[] };
      for (const m of matches.slice(0, 1000)) {
        if (!m || typeof m.id !== 'string' || m.mode === 'online') continue; // online results are recorded by the server
        q.putMatch.run(user.id, m.id.slice(0, 60), JSON.stringify(m), Number(m.date) || Date.now(), 'ai', m.won ? 1 : 0);
      }
      return json(res, 200, { ok: true });
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
  const user = userFromToken(url.searchParams.get('token'));
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const u = { id: user.id, username: user.username };
    onConnect(ws, u);
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      onMessage(ws, u, msg);
    });
    ws.on('close', () => onDisconnect(ws, u.id));
  });
});

// keep connections alive through proxies
setInterval(() => wss.clients.forEach((c) => c.ping()), 25_000).unref();

server.listen(PORT, () => console.log(`FaB Trainer server on http://localhost:${PORT}`));
