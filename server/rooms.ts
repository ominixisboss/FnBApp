// Online games: the server owns the game state, validates every action and sends each
// player only what they may see (see src/online/view.ts).
import type { WebSocket } from 'ws';
import { getDb, isHero } from '../src/data/cardDb';
import { applyAction, createGame } from '../src/engine/game';
import type { DeckList } from '../src/engine/game';
import type { Action, GameState, PlayerId } from '../src/engine/types';
import { formatName, validateDeck } from '../src/deck/deck';
import type { Deck, DeckFormat } from '../src/deck/deck';
import { viewFor } from '../src/online/view';
import { store } from './db';
import { createPod, joinPod, leavePod, pick as podPick, podDeck, startPod, submitDeck, userPod, viewFor as podView } from './pods';
import type { PodView } from './pods';

export type ClientMsg =
  | { t: 'host'; deck: DeckList; format: DeckFormat; sandbox?: boolean }
  | { t: 'join'; code: string; deck: DeckList }
  | { t: 'queue'; deck: DeckList; format: DeckFormat }
  | { t: 'cancel' }
  | { t: 'act'; action: Action }
  | { t: 'leave' }
  | { t: 'emote'; id: string }
  | { t: 'podCreate'; mode: string; set: string }
  | { t: 'podJoin'; code: string }
  | { t: 'podStart' }
  | { t: 'podPick'; index: number }
  | { t: 'podDeck'; deck: DeckList }
  | { t: 'podLeave' }
  | { t: 'podPlay'; opponent: string }
  | { t: 'challenge'; to: string; deck: DeckList; format: DeckFormat }
  | { t: 'decline'; code: string }
  | { t: 'spectate'; username: string }
  | { t: 'unspectate' };

export type ServerMsg =
  | { t: 'hello'; user: string; inGame: boolean }
  | { t: 'waiting'; code?: string; format: string; queue?: boolean }
  | { t: 'state'; code: string; state: GameState; opponent: { name: string; avatar: string | null; connected: boolean }; matchId: string; sandbox?: boolean }
  | { t: 'opponent'; connected: boolean }
  | { t: 'error'; message: string }
  | { t: 'cancelled' }
  | { t: 'emote'; id: string }
  | { t: 'challenged'; from: string; username: string; code: string; format: string }
  | { t: 'declined'; by: string }
  | { t: 'rated'; before: number; after: number; season?: string; format?: string }
  | { t: 'pod'; pod: PodView | null }
  | { t: 'spectate'; state: GameState; names: [string, string]; watching: string }
  | { t: 'spectateEnd' };

/** The emotes players can send in online games. */
export const EMOTES = ['hello', 'gg', 'nice', 'thinking', 'oops', 'wow'];
/** Ranked tiers by rating. */
/** Ranked seasons last a calendar month (UTC). */
export const currentSeason = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
export const seasonEnds = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
export const tierOf = (r: number) => (r >= 1700 ? 'Mythic' : r >= 1550 ? 'Diamond' : r >= 1400 ? 'Platinum' : r >= 1250 ? 'Gold' : r >= 1100 ? 'Silver' : 'Bronze');
const START_RATING = 1000;

interface Seat {
  userId: number;
  name: string;
  avatar: string | null;
  deck: DeckList;
  ws: WebSocket | null;
  leaveTimer?: ReturnType<typeof setTimeout>;
}

interface Room {
  code: string;
  format: DeckFormat;
  seats: Seat[];
  state: GameState | null;
  isPrivate: boolean;
  ended: boolean;
  /** manual moves allowed (private rooms only, chosen by the host) */
  sandbox?: boolean;
  /** for replays: the starting position and every action in order (concessions note who conceded) */
  initial?: GameState;
  actions: { a: Action; by?: PlayerId }[];
  /** a game between two players at a draft/sealed table: decks come from the server's copy */
  pod?: string;
  /** friends watching: each follows one player's view */
  spectators?: { ws: WebSocket; seat: PlayerId }[];
}

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 120_000);
const rooms = new Map<string, Room>();
const userRoom = new Map<number, string>();
const queues = new Map<string, Room>(); // format -> public room waiting for an opponent
const sockets = new Map<number, WebSocket>(); // user -> their live connection (for presence and challenges)
const lastEmote = new Map<number, number>();

/** Friends list presence. */
export function presence(userId: number): 'offline' | 'online' | 'in-game' {
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  if (room?.state && !room.ended) return 'in-game';
  return sockets.has(userId) ? 'online' : 'offline';
}

/** Concede for seat i (records it for the replay). */
function concede(room: Room, i: PlayerId) {
  room.state = applyAction({ ...room.state!, priority: i }, { type: 'concede' });
  room.actions.push({ a: { type: 'concede' }, by: i });
}

const send = (ws: WebSocket | null, msg: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

/** Check a submitted deck list: real cards, a hero, and legal for the format. */
export function checkDeck(deck: DeckList, format: DeckFormat): string | null {
  const db = getDb();
  if (!deck || typeof deck !== 'object') return 'Missing deck';
  const all = [deck.heroId, ...(deck.weaponIds ?? []), ...(deck.equipmentIds ?? []), ...(deck.cardIds ?? [])];
  if (all.some((id) => typeof id !== 'string' || !db.byId.has(id) || id === '__hidden__')) return 'Deck contains unknown cards';
  if (!isHero(db.byId.get(deck.heroId)!)) return 'Deck has no hero';
  if (deck.cardIds.length < 20 || deck.cardIds.length > 120) return 'Deck size is invalid';
  if (format === 'casual') return null;
  const cards: Record<string, number> = {};
  for (const id of [...deck.weaponIds, ...deck.equipmentIds, ...deck.cardIds]) cards[id] = (cards[id] ?? 0) + 1;
  const d: Deck = { id: 'x', name: 'x', format, heroId: deck.heroId, cards, updatedAt: 0 };
  const errs = validateDeck(d).filter((e) => !e.startsWith('No weapon'));
  return errs.length ? `Deck isn’t legal for ${formatName(format)}: ${errs[0]}` : null;
}

function seatOf(room: Room, userId: number): number {
  return room.seats.findIndex((s) => s.userId === userId);
}

function broadcast(room: Room) {
  if (!room.state) return;
  for (const sp of room.spectators ?? []) {
    send(sp.ws, { t: 'spectate', state: viewFor(room.state, sp.seat), names: [room.seats[sp.seat].name, room.seats[1 - sp.seat]?.name ?? '?'], watching: room.seats[sp.seat].name });
  }
  room.seats.forEach((seat, i) => {
    const opp = room.seats[1 - i];
    send(seat.ws, {
      t: 'state', code: room.code, state: viewFor(room.state!, i as PlayerId), matchId: `online-${room.code}`,
      opponent: { name: opp.name, avatar: opp.avatar, connected: !!opp.ws }, sandbox: !!room.sandbox,
    });
  });
}

/** Save the result to both players' histories (resolves once both writes have finished). */
function record(room: Room): Promise<unknown> {
  const s = room.state!;
  return Promise.all(room.seats.map((seat, i) => {
    const me = s.players[i];
    const them = s.players[1 - i];
    const m = {
      id: `online-${room.code}`, date: Date.now(), format: room.format, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId,
      deckId: null, deckName: 'Online deck', difficulty: 'online', won: s.winner === i, turns: s.turn,
      lifeLeft: me.life, oppLifeLeft: them.life, mode: 'online', opponentName: room.seats[1 - i].name,
    };
    return store.putMatch(seat.userId, m.id, JSON.stringify(m), m.date, 'online', m.won).catch((e) => console.error('could not record match', e));
  }));
}

/** Ranked games (quick match) move both players' Elo ratings. */
async function rate(room: Room) {
  if (room.isPrivate || !room.state || room.state.winner === null) return;
  const [a, b] = await Promise.all(room.seats.map((s) => store.getRating(s.userId)));
  const ra = a?.rating ?? START_RATING;
  const rb = b?.rating ?? START_RATING;
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  const sa = room.state.winner === 0 ? 1 : 0;
  const k = (games: number) => (games < 10 ? 40 : 24); // settle in faster for new players
  const na = Math.round(ra + k(a?.games ?? 0) * (sa - ea));
  const nb = Math.round(rb + k(b?.games ?? 0) * ((1 - sa) - (1 - ea)));
  await store.setRating(room.seats[0].userId, na, (a?.games ?? 0) + 1);
  await store.setRating(room.seats[1].userId, nb, (b?.games ?? 0) + 1);
  // the season ladder for this format (resets every month)
  const season = currentSeason();
  const [sa0, sb0] = await Promise.all(room.seats.map((st) => store.getSeasonRating(st.userId, season, room.format)));
  const sra = sa0?.rating ?? START_RATING, srb = sb0?.rating ?? START_RATING;
  const sea = 1 / (1 + 10 ** ((srb - sra) / 400));
  const sna = Math.round(sra + k(sa0?.games ?? 0) * (sa - sea));
  const snb = Math.round(srb + k(sb0?.games ?? 0) * ((1 - sa) - (1 - sea)));
  await store.setSeasonRating(room.seats[0].userId, season, room.format, { rating: sna, games: (sa0?.games ?? 0) + 1, peak: Math.max(sna, sa0?.peak ?? START_RATING) });
  await store.setSeasonRating(room.seats[1].userId, season, room.format, { rating: snb, games: (sb0?.games ?? 0) + 1, peak: Math.max(snb, sb0?.peak ?? START_RATING) });
  send(room.seats[0].ws, { t: 'rated', before: sra, after: sna, season, format: room.format });
  send(room.seats[1].ws, { t: 'rated', before: srb, after: snb, season, format: room.format });
}

function saveReplay(room: Room) {
  if (!room.initial || !room.state) return Promise.resolve();
  const json = JSON.stringify({
    matchId: `online-${room.code}`, date: Date.now(), format: room.format, ranked: !room.isPrivate,
    users: room.seats.map((s) => s.userId), names: room.seats.map((s) => s.name), initial: room.initial, actions: room.actions,
  });
  return store.putReplay(`online-${room.code}`, json).catch((e) => console.error('could not save replay', e));
}

/** A finished online game between two members of a friend tournament fills in their open game there. */
async function tournamentResult(room: Room) {
  if (!room.state || room.state.winner === null || room.seats.length < 2) return;
  const [a, b] = room.seats.map((x) => x.userId);
  const winner = room.seats[room.state.winner].userId;
  for (const raw of await store.tournamentsFor(a)) {
    const t = JSON.parse(raw) as FriendTournament;
    if (t.format !== room.format) continue;
    const g = t.games.find((x) => x.winner === undefined && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    if (!g) continue;
    g.winner = winner;
    g.matchId = `online-${room.code}`;
    await store.putTournament(t.id, t.players.map((p) => p.id), JSON.stringify(t));
    return;
  }
}

export interface FriendTournament {
  id: string; name: string; format: string; owner: number; created: number;
  players: { id: number; username: string; name: string }[];
  games: { a: number; b: number; winner?: number; matchId?: string }[];
}

function finish(room: Room) {
  if (room.ended) return;
  room.ended = true;
  // save the result first, so stats and the leaderboard are up to date when players see "game over"
  void Promise.all([record(room), saveReplay(room), tournamentResult(room)]).finally(() => { broadcast(room); void rate(room).catch((e) => console.error('rating failed', e)); });
  room.seats.forEach((s) => { if (s.leaveTimer) clearTimeout(s.leaveTimer); userRoom.delete(s.userId); });
  setTimeout(() => rooms.delete(room.code), 60_000);
}

function start(room: Room) {
  const [a, b] = room.seats;
  room.state = createGame([
    { name: a.name, isBot: false, deck: a.deck },
    { name: b.name, isBot: false, deck: b.deck },
  ], Math.floor(Math.random() * 2 ** 31), room.format);
  room.initial = room.state;
  room.actions = [];
  broadcast(room);
}

async function profileOf(userId: number, username: string) {
  const row = await store.getProfile(userId).catch(() => undefined);
  try {
    const p = row ? JSON.parse(row) : null;
    return { name: (p?.displayName || username).slice(0, 24), avatar: p?.avatarHeroId ?? null };
  } catch {
    return { name: username, avatar: null };
  }
}

export function onConnect(ws: WebSocket, user: { id: number; username: string }) {
  sockets.set(user.id, ws);
  const code = userRoom.get(user.id);
  const room = code ? rooms.get(code) : undefined;
  if (room && !room.ended) {
    const i = seatOf(room, user.id);
    const old = room.seats[i].ws;
    room.seats[i].ws = ws;
    if (old && old !== ws) old.close(4000, 'Connected elsewhere');
    if (room.seats[i].leaveTimer) clearTimeout(room.seats[i].leaveTimer);
    send(ws, { t: 'hello', user: user.username, inGame: !!room.state });
    if (room.state) {
      broadcast(room);
      send(room.seats[1 - i]?.ws ?? null, { t: 'opponent', connected: true });
    } else send(ws, { t: 'waiting', code: room.isPrivate ? room.code : undefined, format: room.format, queue: !room.isPrivate });
    return;
  }
  send(ws, { t: 'hello', user: user.username, inGame: false });
  const pod = userPod(user.id);
  if (pod) send(ws, { t: 'pod', pod: podView(pod, user.id) });
}

const notifyPod = (userId: number, view: PodView | null) => send(sockets.get(userId) ?? null, { t: 'pod', pod: view });

export function onDisconnect(ws: WebSocket, userId: number) {
  if (sockets.get(userId) === ws) sockets.delete(userId);
  for (const r of rooms.values()) if (r.spectators) r.spectators = r.spectators.filter((sp) => sp.ws !== ws);
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  if (!room) return;
  const i = seatOf(room, userId);
  if (i < 0 || room.seats[i].ws !== ws) return;
  room.seats[i].ws = null;
  if (!room.state) {
    // still waiting for an opponent: drop the room
    rooms.delete(room.code);
    userRoom.delete(userId);
    if (queues.get(room.format) === room) queues.delete(room.format);
    return;
  }
  if (room.ended) return;
  send(room.seats[1 - i].ws, { t: 'opponent', connected: false });
  room.seats[i].leaveTimer = setTimeout(() => {
    if (room.seats[i].ws || room.ended || !room.state) return;
    concede(room, i as PlayerId);
    finish(room);
  }, RECONNECT_GRACE_MS);
}

export async function onMessage(ws: WebSocket, user: { id: number; username: string }, msg: ClientMsg) {
  const err = (message: string) => send(ws, { t: 'error', message });
  const prof = msg.t === 'host' || msg.t === 'queue' || msg.t === 'join' ? await profileOf(user.id, user.username) : { name: user.username, avatar: null };
  const current = userRoom.get(user.id); // read after the await so concurrent messages see each other's rooms
  switch (msg.t) {
    case 'host':
    case 'queue': {
      if (current && rooms.get(current) && !rooms.get(current)!.ended) return err('You’re already in a game.');
      const format: DeckFormat = ['blitz', 'cc', 'll', 'sage', 'commoner', 'casual'].includes(msg.format) ? msg.format : 'blitz';
      const bad = checkDeck(msg.deck, format);
      if (bad) return err(bad);
      const seat: Seat = { userId: user.id, name: prof.name, avatar: prof.avatar, deck: msg.deck, ws };
      if (msg.t === 'queue') {
        const waiting = queues.get(format);
        if (waiting && waiting.seats[0].userId !== user.id && waiting.seats[0].ws) {
          queues.delete(format);
          waiting.seats.push(seat);
          userRoom.set(user.id, waiting.code);
          start(waiting);
          return;
        }
      }
      const room: Room = { code: newCode(), format, seats: [seat], state: null, isPrivate: msg.t === 'host', ended: false, actions: [], sandbox: msg.t === 'host' && !!msg.sandbox };
      rooms.set(room.code, room);
      userRoom.set(user.id, room.code);
      if (msg.t === 'queue') queues.set(format, room);
      send(ws, { t: 'waiting', code: room.isPrivate ? room.code : undefined, format, queue: msg.t === 'queue' });
      return;
    }
    case 'join': {
      if (current && rooms.get(current) && !rooms.get(current)!.ended) return err('You’re already in a game.');
      const room = rooms.get(String(msg.code ?? '').trim().toUpperCase());
      if (!room || room.state || room.ended) return err('No open room with that code.');
      if (room.seats[0].userId === user.id) return err('That’s your own room. Share the code with a friend.');
      let deck = msg.deck;
      if (room.pod) {
        const pd = podDeck(user.id);
        if (!pd || pd.pod.code !== room.pod) return err('Submit your deck at the draft table first.');
        deck = pd.deck;
      }
      const bad = checkDeck(deck, room.format);
      if (bad) return err(bad);
      room.seats.push({ userId: user.id, name: prof.name, avatar: prof.avatar, deck, ws });
      userRoom.set(user.id, room.code);
      start(room);
      return;
    }
    case 'cancel':
    case 'leave': {
      const room = current ? rooms.get(current) : undefined;
      if (!room) return send(ws, { t: 'cancelled' });
      if (room.state && !room.ended) {
        const i = seatOf(room, user.id);
        concede(room, i as PlayerId);
        room.seats[i].ws = null; // they left: only the opponent gets the final state
        finish(room);
      } else {
        rooms.delete(room.code);
        if (queues.get(room.format) === room) queues.delete(room.format);
      }
      userRoom.delete(user.id);
      send(ws, { t: 'cancelled' });
      return;
    }
    case 'act': {
      const room = current ? rooms.get(current) : undefined;
      if (!room?.state || room.ended) return err('You’re not in a game.');
      const i = seatOf(room, user.id) as PlayerId;
      const a = msg.action;
      if (!a || typeof a !== 'object') return err('That action isn’t allowed online.');
      if (a.type === 'manual') {
        // tabletop rooms: you may move your own cards and change your own counters; everyone sees it in the log
        if (!room.sandbox) return err('Manual moves aren’t allowed in this room.');
        if (a.op === 'power') return err('Use the attack’s own cards to change its power.');
        // each client sees itself as player 0: translate to the real seat
        const real = 'player' in a ? { ...a, player: (a.player === 0 ? i : 1 - i) as PlayerId } : a;
        if ('player' in real && real.player !== i) return err('You can only move your own cards.');
        try { room.state = applyAction(room.state, real); room.actions.push({ a: real }); } catch (e) { return err(e instanceof Error ? e.message : String(e)); }
        broadcast(room);
        return;
      }
      try {
        if (a.type === 'concede') concede(room, i);
        else {
          if (room.state.priority !== i) return err('It’s not your move.');
          room.state = applyAction(room.state, a);
          room.actions.push({ a });
        }
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
      if (room.state.phase === 'gameOver') finish(room);
      else broadcast(room);
      return;
    }
    case 'emote': {
      const room = current ? rooms.get(current) : undefined;
      if (!room?.state || !EMOTES.includes(msg.id)) return;
      const now = Date.now();
      if (now - (lastEmote.get(user.id) ?? 0) < 2000) return; // no spamming
      lastEmote.set(user.id, now);
      const i = seatOf(room, user.id);
      send(room.seats[1 - i]?.ws ?? null, { t: 'emote', id: msg.id });
      return;
    }
    case 'challenge': {
      if (current && rooms.get(current) && !rooms.get(current)!.ended) return err('You’re already in a game.');
      const target = await store.userByName(String(msg.to ?? ''));
      if (!target) return err('No player with that name.');
      if (!(await store.friends(user.id)).some((f) => f.id === target.id)) return err('You can only challenge friends.');
      const tws = sockets.get(target.id);
      if (!tws) return err(`${target.username} isn’t online right now.`);
      if (presence(target.id) === 'in-game') return err(`${target.username} is in a game.`);
      const format: DeckFormat = ['blitz', 'cc', 'll', 'sage', 'commoner', 'casual'].includes(msg.format) ? msg.format : 'blitz';
      const bad = checkDeck(msg.deck, format);
      if (bad) return err(bad);
      const p = await profileOf(user.id, user.username);
      const room: Room = { code: newCode(), format, seats: [{ userId: user.id, name: p.name, avatar: p.avatar, deck: msg.deck, ws }], state: null, isPrivate: true, ended: false, actions: [] };
      rooms.set(room.code, room);
      userRoom.set(user.id, room.code);
      send(ws, { t: 'waiting', code: room.code, format, queue: false });
      send(tws, { t: 'challenged', from: p.name, username: user.username, code: room.code, format });
      return;
    }
    case 'podCreate': {
      const p = await profileOf(user.id, user.username);
      const r = createPod(user.id, user.username, p.name, String(msg.mode), String(msg.set));
      if (typeof r === 'string') return err(r);
      return notifyPod(user.id, podView(r, user.id));
    }
    case 'podJoin': {
      const p = await profileOf(user.id, user.username);
      const r = joinPod(user.id, user.username, p.name, String(msg.code ?? ''), notifyPod);
      if (typeof r === 'string') return err(r);
      return notifyPod(user.id, podView(r, user.id));
    }
    case 'podStart': { const e = startPod(user.id, notifyPod); if (e) err(e); return; }
    case 'podPick': { const e = podPick(user.id, Number(msg.index), notifyPod); if (e) err(e); return; }
    case 'podDeck': { const e = submitDeck(user.id, msg.deck, notifyPod); if (e) err(e); return; }
    case 'podLeave': leavePod(user.id, notifyPod); return;
    case 'podPlay': {
      if (current && rooms.get(current) && !rooms.get(current)!.ended) return err('You’re already in a game.');
      const mine = podDeck(user.id);
      if (!mine) return err('Submit your deck first.');
      const opp = mine.pod.seats.find((x) => x.userId !== null && x.username === String(msg.opponent ?? ''));
      if (!opp || opp.userId === user.id) return err('That player isn’t at your table.');
      const tws = sockets.get(opp.userId!);
      if (!tws) return err(`${opp.name} isn’t online right now.`);
      if (presence(opp.userId!) === 'in-game') return err(`${opp.name} is in a game.`);
      const p = await profileOf(user.id, user.username);
      const room: Room = { code: newCode(), format: 'casual', seats: [{ userId: user.id, name: p.name, avatar: p.avatar, deck: mine.deck, ws }], state: null, isPrivate: true, ended: false, actions: [], pod: mine.pod.code };
      rooms.set(room.code, room);
      userRoom.set(user.id, room.code);
      send(ws, { t: 'waiting', code: room.code, format: 'casual', queue: false });
      send(tws, { t: 'challenged', from: p.name, username: user.username, code: room.code, format: `${mine.pod.mode} table ${mine.pod.code}` });
      return;
    }
    case 'decline': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!room || room.state) return;
      send(room.seats[0].ws, { t: 'declined', by: user.username });
      rooms.delete(room.code);
      userRoom.delete(room.seats[0].userId);
      send(room.seats[0].ws, { t: 'cancelled' });
      return;
    }
    case 'spectate': {
      const target = await store.userByName(String(msg.username ?? ''));
      if (!target) return err('No player with that name.');
      if (!(await store.friends(user.id)).some((f) => f.id === target.id)) return err('You can only watch friends.');
      const code = userRoom.get(target.id);
      const room = code ? rooms.get(code) : undefined;
      if (!room?.state || room.ended) return err(`${target.username} isn’t in a game right now.`);
      for (const r of rooms.values()) if (r.spectators) r.spectators = r.spectators.filter((sp) => sp.ws !== ws);
      const seat = seatOf(room, target.id) as PlayerId;
      (room.spectators ??= []).push({ ws, seat });
      send(ws, { t: 'spectate', state: viewFor(room.state, seat), names: [room.seats[seat].name, room.seats[1 - seat].name], watching: room.seats[seat].name });
      return;
    }
    case 'unspectate': {
      for (const r of rooms.values()) if (r.spectators) r.spectators = r.spectators.filter((sp) => sp.ws !== ws);
      send(ws, { t: 'spectateEnd' });
      return;
    }
    default:
      return err('Unknown message');
  }
}

export function roomCount() {
  return { rooms: rooms.size, playing: [...rooms.values()].filter((r) => r.state && !r.ended).length };
}
