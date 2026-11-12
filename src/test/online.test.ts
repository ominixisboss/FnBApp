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
import type { GameState } from '../engine/types';

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

interface Client { ws: WebSocket; states: GameState[]; errors: string[]; waiting: { code?: string } | null }

function connect(token: string): Promise<Client> {
  return new Promise((resolve) => {
    const c: Client = { ws: new WebSocket(`ws://localhost:${PORT}/ws?token=${token}`), states: [], errors: [], waiting: null };
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'state') c.states.push(m.state);
      if (m.t === 'error') c.errors.push(m.message);
      if (m.t === 'waiting') c.waiting = m;
    });
    c.ws.on('open', () => resolve(c));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await wait(300);
    expect(ca.waiting?.code).toMatch(/^[A-Z0-9]{5}$/);
    cb.ws.send(JSON.stringify({ t: 'join', code: ca.waiting!.code, deck: deckB }));
    await wait(300);
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
      const sa = ca.states.at(-1)!;
      if (sa.phase === 'gameOver') break;
      const mover = sa.priority === 0 ? ca : cb;
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
    ca.ws.close();
    cb.ws.close();
  }, 60_000);

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
});
