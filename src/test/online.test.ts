// End-to-end: starts the real server, two players play a full game over WebSockets.
// Each side picks moves with the AI using only its own (redacted) view of the game.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import './setup';
import { findCard } from '../data/cardDb';
import { autoBuildDeck, toDeckList } from '../deck/deck';
import { chooseAction } from '../ai/bot';
import type { Action, GameState } from '../engine/types';
import { applyAction } from '../engine/game';
import type { PodView } from '../online/podTypes';
import { autoBuildLimited, botPick, limitedDeckList, setHeroes } from '../deck/limited';
import { eligibleForHero, getDb } from '../data/cardDb';

const PORT = 18787 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

beforeAll(async () => {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(join(tmpdir(), 'fab-')) },
    stdio: 'pipe',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}, 30_000);

afterAll(() => { server?.kill(); });

async function account(name: string) {
  const r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'password1' }) });
  return (await r.json()) as { token: string };
}

interface Client { ws: WebSocket; states: GameState[]; errors: string[]; waiting: { code?: string } | null; spectated: GameState[]; pod: PodView | null; challenged: { code: string } | null }

function connect(token: string): Promise<Client> {
  return new Promise((resolve) => {
    const c: Client = { ws: new WebSocket(`ws://localhost:${PORT}/ws?token=${token}`), states: [], errors: [], waiting: null, spectated: [], pod: null, challenged: null };
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'state') c.states.push(m.state);
      if (m.t === 'error') c.errors.push(m.message);
      if (m.t === 'waiting') c.waiting = m;
      if (m.t === 'spectate') c.spectated.push(m.state);
      if (m.t === 'pod') c.pod = m.pod;
      if (m.t === 'challenged') c.challenged = m;
    });
    c.ws.on('open', () => resolve(c));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** wait until a condition holds (or give up after a few seconds and let the assertions report it) */
async function until(cond: () => boolean, ms = 5000) { for (let t = 0; t < ms && !cond(); t += 25) await wait(25); }

describe('online play', () => {
  it('rejects bad credentials and requires auth for sync', async () => {
    const bad = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'x', password: '1' }) });
    expect(bad.status).toBe(400);
    expect((await fetch(`${BASE}/api/decks`)).status).toBe(401);
  });

  it('plays a full game between two players through the server', async () => {
    const a = await account('alice');
    const b = await account('bob');
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    const deckA = toDeckList(autoBuildDeck(findCard('Dorinthea')!.id, 'blitz', 1));
    const deckB = toDeckList(autoBuildDeck(findCard('Bravo')!.id, 'blitz', 2));
    ca.ws.send(JSON.stringify({ t: 'host', deck: deckA, format: 'blitz' }));
    await until(() => !!ca.waiting?.code);
    expect(ca.waiting?.code).toMatch(/^[A-Z0-9]{5}$/);
    cb.ws.send(JSON.stringify({ t: 'join', code: ca.waiting!.code, deck: deckB }));
    await until(() => ca.states.length > 0 && cb.states.length > 0);
    expect(ca.states.length).toBeGreaterThan(0);

    // hidden information never reaches the other player
    const va = ca.states.at(-1)!;
    expect(va.players[1].hand.every((h) => h.cardId === '__hidden__')).toBe(true);
    expect(va.players[0].hand.every((h) => h.cardId !== '__hidden__')).toBe(true);
    expect(va.players[0].deck.every((h) => h.cardId === '__hidden__')).toBe(true);
    // each player sees themselves as player 0
    expect(va.players[0].name).toBe('alice');
    expect(cb.states.at(-1)!.players[0].name).toBe('bob');

    let steps = 0;
    for (; steps < 3000; steps++) {
      // both players get every update; wait until the mover has seen the latest one
      for (let i = 0; i < 200 && ca.states.length !== cb.states.length; i++) await wait(5);
      const sa = ca.states.at(-1)!;
      if (sa.phase === 'gameOver') break;
      // a pending choice is answered by whoever is choosing; otherwise the player with priority moves
      const chooser = sa.pendingChoices?.[0]?.player;
      const mover = (chooser ?? sa.priority) === 0 ? ca : cb;
      const view = mover.states.at(-1)!;
      const before = ca.states.length;
      mover.ws.send(JSON.stringify({ t: 'act', action: chooseAction(view, 0, 'normal').action }));
      for (let i = 0; i < 50 && ca.states.length === before && mover.errors.length === 0; i++) await wait(5);
      if (mover.errors.length) throw new Error(`server rejected a move: ${mover.errors.join('; ')}`);
    }
    const end = ca.states.at(-1)!;
    expect(end.phase).toBe('gameOver');
    expect(cb.states.at(-1)!.winner).toBe(end.winner === 0 ? 1 : 0); // rotated views agree

    // both players got the result in their history, and the leaderboard has it
    const ma = await (await fetch(`${BASE}/api/matches`, { headers: { authorization: `Bearer ${a.token}` } })).json();
    expect(ma.matches[0].mode).toBe('online');
    const board = await (await fetch(`${BASE}/api/leaderboard`)).json();
    expect(board.length).toBe(2);
    // the replay rebuilds exactly the same game
    const rep = await (await fetch(`${BASE}/api/replay?match=online-${ca.waiting!.code}`, { headers: { authorization: `Bearer ${a.token}` } })).json();
    let rs = rep.initial as GameState;
    for (const st of rep.actions as { a: Action; by?: 0 | 1 }[]) rs = st.by !== undefined ? applyAction({ ...rs, priority: st.by }, st.a) : applyAction(rs, st.a);
    expect(rs.phase).toBe('gameOver');
    expect(rs.winner).toBe(end.winner); // alice hosted, so she is player 0 in the full game too
    expect(rep.users.length).toBe(2);
    // private room: no rating change
    expect((await (await fetch(`${BASE}/api/ladder`)).json()).length).toBe(0);
    ca.ws.close();
    cb.ws.close();
  }, 60_000);

  it('sandbox rooms allow manual moves of your own cards only; normal rooms refuse them', async () => {
    const a = await account('frank');
    const b = await account('gina');
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    const deck = toDeckList(autoBuildDeck(findCard('Dorinthea')!.id, 'blitz', 1));
    ca.ws.send(JSON.stringify({ t: 'host', deck, format: 'blitz', sandbox: true }));
    await wait(300);
    cb.ws.send(JSON.stringify({ t: 'join', code: ca.waiting!.code, deck }));
    await wait(400);
    // gina (seat 1) moves a card from her hand to her graveyard, speaking as "player 0" from her own view
    const mine = cb.states.at(-1)!.players[0].hand[0];
    cb.ws.send(JSON.stringify({ t: 'act', action: { type: 'manual', op: 'move', player: 0, uid: mine.uid, to: 'graveyard' } }));
    await wait(300);
    expect(cb.states.at(-1)!.players[0].graveyard.some((g) => g.uid === mine.uid)).toBe(true);
    expect(ca.states.at(-1)!.players[1].graveyard.some((g) => g.uid === mine.uid)).toBe(true); // frank sees it too
    // she can't touch frank's cards
    const his = ca.states.at(-1)!.players[0].hand[0];
    const errs = cb.errors.length;
    cb.ws.send(JSON.stringify({ t: 'act', action: { type: 'manual', op: 'move', player: 1, uid: his.uid, to: 'graveyard' } }));
    await wait(300);
    expect(cb.errors.length).toBe(errs + 1);
    ca.ws.close();
    cb.ws.close();
  }, 30_000);

  it('friends can spectate, and a friend-cup game fills in its result automatically', async () => {
    const h = await account('hana');
    const i = await account('ivan');
    const j = await account('jade');
    const auth = (t: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
    await fetch(`${BASE}/api/friends`, { method: 'POST', headers: auth(h.token), body: JSON.stringify({ username: 'ivan' }) });
    await fetch(`${BASE}/api/friends`, { method: 'POST', headers: auth(j.token), body: JSON.stringify({ username: 'hana' }) });
    const cup = await (await fetch(`${BASE}/api/tournaments`, { method: 'POST', headers: auth(h.token), body: JSON.stringify({ name: 'Test cup', format: 'blitz', usernames: ['ivan'] }) })).json();
    expect(cup.games.length).toBe(1);
    const ch = await connect(h.token);
    const ci = await connect(i.token);
    const cj = await connect(j.token);
    const deck = toDeckList(autoBuildDeck(findCard('Dorinthea')!.id, 'blitz', 1));
    ch.ws.send(JSON.stringify({ t: 'host', deck, format: 'blitz' }));
    await wait(300);
    ci.ws.send(JSON.stringify({ t: 'join', code: ch.waiting!.code, deck }));
    await wait(400);
    // jade watches hana's game and sees it from hana's side
    cj.ws.send(JSON.stringify({ t: 'spectate', username: 'hana' }));
    await wait(300);
    expect(cj.spectated.length).toBeGreaterThan(0);
    expect(cj.spectated.at(-1)!.players[0].hand.every((c) => c.cardId !== '__hidden__')).toBe(true);
    expect(cj.spectated.at(-1)!.players[1].hand.every((c) => c.cardId === '__hidden__')).toBe(true);
    // ivan concedes: hana's win goes into the cup
    ci.ws.send(JSON.stringify({ t: 'act', action: { type: 'concede' } }));
    await wait(700);
    const after = (await (await fetch(`${BASE}/api/tournaments`, { headers: auth(i.token) })).json())[0];
    expect(after.games[0].winner).toBe(after.players.find((p: { username: string }) => p.username === 'hana').id);
    expect(cj.spectated.at(-1)!.phase).toBe('gameOver');
    for (const c of [ch, ci, cj]) c.ws.close();
  }, 30_000);

  it('ranked quick match moves ratings; friends and presence', async () => {
    const a = await account('dana');
    const b = await account('eve');
    const auth = (t: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
    // friends
    expect((await fetch(`${BASE}/api/friends`, { method: 'POST', headers: auth(a.token), body: JSON.stringify({ username: 'eve' }) })).status).toBe(200);
    const ca = await connect(a.token);
    const cb = await connect(b.token);
    const fl = await (await fetch(`${BASE}/api/friends`, { headers: auth(b.token) })).json();
    expect(fl).toEqual([expect.objectContaining({ username: 'dana', status: 'online' })]);
    // ranked game: both queue, one concedes
    const deck = toDeckList(autoBuildDeck(findCard('Dorinthea')!.id, 'blitz', 1));
    ca.ws.send(JSON.stringify({ t: 'queue', deck, format: 'blitz' }));
    await wait(200);
    cb.ws.send(JSON.stringify({ t: 'queue', deck, format: 'blitz' }));
    await wait(400);
    expect(ca.states.length).toBeGreaterThan(0);
    cb.ws.send(JSON.stringify({ t: 'act', action: { type: 'concede' } }));
    await wait(600);
    const lad = await (await fetch(`${BASE}/api/ladder`)).json();
    const byName = Object.fromEntries(lad.map((r: { username: string; rating: number }) => [r.username, r.rating]));
    expect(byName.dana).toBeGreaterThan(1000);
    expect(byName.eve).toBeLessThan(1000);
    // the same game counts on this month's season ladder for its format, and in each player's season history
    const season = await (await fetch(`${BASE}/api/ladder?format=blitz`)).json();
    expect(season.map((r: { username: string }) => r.username).sort()).toEqual(['dana', 'eve']);
    const me = await (await fetch(`${BASE}/api/me`, { headers: auth(a.token) })).json();
    expect(me.seasons).toEqual([expect.objectContaining({ format: 'blitz', games: 1, peak: expect.any(Number) })]);
    expect(me.season.id).toMatch(/^\d{4}-\d{2}$/);
    ca.ws.close();
    cb.ws.close();
  }, 30_000);

  it('syncs decks with newest-wins merging', async () => {
    const c = await account('carol');
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${c.token}` };
    const deck = { id: 'd1', name: 'Old', format: 'blitz', heroId: findCard('Bravo')!.id, cards: {}, updatedAt: 100 };
    await fetch(`${BASE}/api/decks`, { method: 'PUT', headers: auth, body: JSON.stringify({ decks: [deck] }) });
    await fetch(`${BASE}/api/decks`, { method: 'PUT', headers: auth, body: JSON.stringify({ decks: [{ ...deck, name: 'Stale', updatedAt: 50 }] }) });
    let r = await (await fetch(`${BASE}/api/decks`, { headers: auth })).json();
    expect(r.decks[0].name).toBe('Old');
    await fetch(`${BASE}/api/decks`, { method: 'PUT', headers: auth, body: JSON.stringify({ decks: [], deleted: ['d1'] }) });
    r = await (await fetch(`${BASE}/api/decks`, { headers: auth })).json();
    expect(r.decks).toEqual([]);
  });

  it('friends draft together at a table and the server keeps each pool', async () => {
    const [a, b] = [await account('pia'), await account('quinn')];
    const [ca, cb] = [await connect(a.token), await connect(b.token)];
    ca.ws.send(JSON.stringify({ t: 'podCreate', mode: 'draft', set: 'WTR' }));
    await wait(300);
    const code = ca.pod!.code;
    cb.ws.send(JSON.stringify({ t: 'podJoin', code }));
    await wait(300);
    expect(ca.pod!.players.map((p) => p.username)).toEqual(['pia', 'quinn']);
    cb.ws.send(JSON.stringify({ t: 'podStart' })); // only the host may start
    await wait(200);
    expect(cb.errors.at(-1)).toMatch(/host/);
    ca.ws.send(JSON.stringify({ t: 'podStart' }));
    await wait(300);
    expect(ca.pod!.phase).toBe('drafting');
    expect(ca.pod!.players.length).toBe(8); // six bots fill the table
    // each player drafts for a hero, taking the card a bot would (3 packs of 14)
    const [ha, hb] = setHeroes('WTR');
    const stamp = (c: Client) => `${c.pod!.round}:${c.pod!.you.pack.length}`;
    for (let i = 0; i < 50 && ca.pod!.phase === 'drafting'; i++) {
      const before = stamp(ca);
      ca.ws.send(JSON.stringify({ t: 'podPick', index: botPick(ca.pod!.you.pack, ha) }));
      cb.ws.send(JSON.stringify({ t: 'podPick', index: botPick(cb.pod!.you.pack, hb) }));
      // wait for the packs to pass: both players see the next pack, not yet picked from
      await until(() => ca.pod!.phase !== 'drafting' || (stamp(ca) !== before && stamp(cb) === stamp(ca) && !ca.pod!.you.picked && !cb.pod!.you.picked));
    }
    await until(() => ca.pod!.phase === 'building');
    expect(ca.pod!.phase).toBe('building');
    expect(ca.pod!.you.pool.length).toBe(42);
    // a deck with a card that isn't in your pool is refused
    const db = getDb();
    const hero = setHeroes('WTR')[0];
    const foreign = db.cards.find((c) => !ca.pod!.you.pool.includes(c.id) && c.types.includes('Action') && c.pitch === 1)!;
    const deckA = limitedDeckList(hero, autoBuildLimited(ca.pod!.you.pool, hero));
    ca.ws.send(JSON.stringify({ t: 'podDeck', deck: { ...deckA, cardIds: [...deckA.cardIds.slice(1), foreign.id] } }));
    await wait(200);
    expect(ca.errors.at(-1)).toMatch(/pool|can’t be used/);
    // pad with any eligible pool cards if the auto-build came up short of 30
    ca.ws.close();
    cb.ws.close();
  }, 30_000);

  it('a sealed table: decks are checked against your own pool, and tablemates play each other with them', async () => {
    const [a, b] = [await account('rui'), await account('sol')];
    const [ca, cb] = [await connect(a.token), await connect(b.token)];
    ca.ws.send(JSON.stringify({ t: 'podCreate', mode: 'sealed', set: 'WTR' }));
    await until(() => !!ca.pod);
    cb.ws.send(JSON.stringify({ t: 'podJoin', code: ca.pod!.code }));
    await until(() => ca.pod!.players.length === 2 && !!cb.pod);
    ca.ws.send(JSON.stringify({ t: 'podStart' }));
    await until(() => ca.pod!.phase === 'building' && cb.pod!.phase === 'building');
    expect(ca.pod!.phase).toBe('building');
    expect(ca.pod!.you.pool.length).toBe(84); // six packs each
    const db = getDb();
    // each player builds for the set hero who can use the most of their pool
    const build = (pool: string[]) => {
      const h = setHeroes('WTR').map((x) => ({ x, n: pool.filter((id) => eligibleForHero(db.byId.get(id)!, x)).length })).sort((p, q) => q.n - p.n)[0].x;
      return limitedDeckList(h, autoBuildLimited(pool, h, 32));
    };
    const okA = build(ca.pod!.you.pool), okB = build(cb.pod!.you.pool);
    expect(okA.cardIds.length).toBeGreaterThanOrEqual(30);
    // borrowing a card from the other player's pool is refused
    const theirs = cb.pod!.you.pool.find((id) => !ca.pod!.you.pool.includes(id) && eligibleForHero(db.byId.get(id)!, db.byId.get(okA.heroId)!) && !db.byId.get(id)!.types.includes('Equipment') && !db.byId.get(id)!.types.includes('Weapon'));
    if (theirs) {
      const n = ca.errors.length;
      ca.ws.send(JSON.stringify({ t: 'podDeck', deck: { ...okA, cardIds: [...okA.cardIds.slice(1), theirs] } }));
      await until(() => ca.errors.length > n);
      expect(ca.errors.at(-1)).toMatch(/pool/);
    }
    ca.ws.send(JSON.stringify({ t: 'podDeck', deck: okA }));
    cb.ws.send(JSON.stringify({ t: 'podDeck', deck: okB }));
    await until(() => !!cb.pod!.players.find((p) => p.username === 'rui')?.ready && !!ca.pod!.players.find((p) => p.username === 'sol')?.ready);
    expect(cb.pod!.players.find((p) => p.username === 'rui')!.ready).toBe(true);
    // rui challenges sol; sol accepts with a placeholder and the server uses sol's table deck
    ca.ws.send(JSON.stringify({ t: 'podPlay', opponent: 'sol' }));
    await until(() => !!cb.challenged);
    expect(cb.challenged).toBeTruthy();
    cb.ws.send(JSON.stringify({ t: 'join', code: cb.challenged!.code, deck: { heroId: '', weaponIds: [], equipmentIds: [], cardIds: [] } }));
    await until(() => cb.states.length > 0);
    expect(cb.states.length).toBeGreaterThan(0);
    expect(cb.states.at(-1)!.players[0].hero.cardId).toBe(okB.heroId);
    ca.ws.close();
    cb.ws.close();
  }, 30_000);

  it('push: the server has a key, stores subscriptions, and an offline friend sees a challenge when they connect', async () => {
    const key = await (await fetch(`${BASE}/api/push/key`)).json();
    expect(key.key).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    const [a, b] = [await account('tess'), await account('ugo')];
    const H = (t: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
    expect((await fetch(`${BASE}/api/push`, { method: 'POST', headers: H(b.token), body: JSON.stringify({ subscription: { endpoint: 'not a url' } }) })).status).toBe(400);
    const sub = { endpoint: 'https://push.invalid/abc', keys: { p256dh: 'BOr1', auth: 'x1' } };
    expect((await fetch(`${BASE}/api/push`, { method: 'POST', headers: H(b.token), body: JSON.stringify({ subscription: sub }) })).status).toBe(200);
    await fetch(`${BASE}/api/friends`, { method: 'POST', headers: H(a.token), body: JSON.stringify({ username: 'ugo' }) });
    const ca = await connect(a.token);
    ca.ws.send(JSON.stringify({ t: 'challenge', to: 'ugo', deck: toDeckList(autoBuildDeck(findCard('Dorinthea')!.id, 'blitz', 1)), format: 'blitz' }));
    await until(() => !!ca.waiting);
    expect(ca.errors).toEqual([]); // ugo is offline, but the challenge still goes out
    const cb = await connect(b.token);
    await until(() => !!cb.challenged);
    expect(cb.challenged).toEqual(expect.objectContaining({ username: 'tess' }));
    ca.ws.close();
    cb.ws.close();
  }, 30_000);
});

