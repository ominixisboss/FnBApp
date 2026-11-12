// Online games: the server owns the game state, validates every action and sends each
// player only what they may see (see src/online/view.ts).
import type { WebSocket } from 'ws';
import { getDb, isHero } from '../src/data/cardDb';
import { applyAction, createGame } from '../src/engine/game';
import type { DeckList } from '../src/engine/game';
import type { Action, GameState, PlayerId } from '../src/engine/types';
import { validateDeck } from '../src/deck/deck';
import type { Deck, DeckFormat } from '../src/deck/deck';
import { viewFor } from '../src/online/view';
import { q } from './db';

export type ClientMsg =
  | { t: 'host'; deck: DeckList; format: DeckFormat }
  | { t: 'join'; code: string; deck: DeckList }
  | { t: 'queue'; deck: DeckList; format: DeckFormat }
  | { t: 'cancel' }
  | { t: 'act'; action: Action }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'hello'; user: string; inGame: boolean }
  | { t: 'waiting'; code?: string; format: string; queue?: boolean }
  | { t: 'state'; code: string; state: GameState; opponent: { name: string; avatar: string | null; connected: boolean }; matchId: string }
  | { t: 'opponent'; connected: boolean }
  | { t: 'error'; message: string }
  | { t: 'cancelled' };

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
}

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 120_000);
const rooms = new Map<string, Room>();
const userRoom = new Map<number, string>();
const queues = new Map<string, Room>(); // format -> public room waiting for an opponent

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
  return errs.length ? `Deck isn’t legal for ${format === 'cc' ? 'Classic Constructed' : 'Blitz'}: ${errs[0]}` : null;
}

function seatOf(room: Room, userId: number): number {
  return room.seats.findIndex((s) => s.userId === userId);
}

function broadcast(room: Room) {
  if (!room.state) return;
  room.seats.forEach((seat, i) => {
    const opp = room.seats[1 - i];
    send(seat.ws, {
      t: 'state', code: room.code, state: viewFor(room.state!, i as PlayerId), matchId: `online-${room.code}`,
      opponent: { name: opp.name, avatar: opp.avatar, connected: !!opp.ws },
    });
  });
}

function record(room: Room) {
  const s = room.state!;
  room.seats.forEach((seat, i) => {
    const me = s.players[i];
    const them = s.players[1 - i];
    const m = {
      id: `online-${room.code}`, date: Date.now(), format: room.format, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId,
      deckId: null, deckName: 'Online deck', difficulty: 'online', won: s.winner === i, turns: s.turn,
      lifeLeft: me.life, oppLifeLeft: them.life, mode: 'online', opponentName: room.seats[1 - i].name,
    };
    q.putMatch.run(seat.userId, m.id, JSON.stringify(m), m.date, 'online', m.won ? 1 : 0);
  });
}

function finish(room: Room) {
  if (room.ended) return;
  room.ended = true;
  record(room);
  broadcast(room);
  room.seats.forEach((s) => { if (s.leaveTimer) clearTimeout(s.leaveTimer); userRoom.delete(s.userId); });
  setTimeout(() => rooms.delete(room.code), 60_000);
}

function start(room: Room) {
  const [a, b] = room.seats;
  room.state = createGame([
    { name: a.name, isBot: false, deck: a.deck },
    { name: b.name, isBot: false, deck: b.deck },
  ], Math.floor(Math.random() * 2 ** 31), room.format);
  broadcast(room);
}

function profileOf(userId: number, username: string) {
  const row = q.getProfile.get(userId) as { json: string } | undefined;
  try {
    const p = row ? JSON.parse(row.json) : null;
    return { name: (p?.displayName || username).slice(0, 24), avatar: p?.avatarHeroId ?? null };
  } catch {
    return { name: username, avatar: null };
  }
}

export function onConnect(ws: WebSocket, user: { id: number; username: string }) {
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
}

export function onDisconnect(ws: WebSocket, userId: number) {
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
    room.state = applyAction({ ...room.state, priority: i as PlayerId }, { type: 'concede' });
    finish(room);
  }, RECONNECT_GRACE_MS);
}

export function onMessage(ws: WebSocket, user: { id: number; username: string }, msg: ClientMsg) {
  const err = (message: string) => send(ws, { t: 'error', message });
  const current = userRoom.get(user.id);
  const prof = profileOf(user.id, user.username);
  switch (msg.t) {
    case 'host':
    case 'queue': {
      if (current && rooms.get(current) && !rooms.get(current)!.ended) return err('You’re already in a game.');
      const format: DeckFormat = ['blitz', 'cc', 'casual'].includes(msg.format) ? msg.format : 'blitz';
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
      const room: Room = { code: newCode(), format, seats: [seat], state: null, isPrivate: msg.t === 'host', ended: false };
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
      const bad = checkDeck(msg.deck, room.format);
      if (bad) return err(bad);
      room.seats.push({ userId: user.id, name: prof.name, avatar: prof.avatar, deck: msg.deck, ws });
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
        room.state = applyAction({ ...room.state, priority: i as PlayerId }, { type: 'concede' });
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
      if (!a || typeof a !== 'object' || a.type === 'manual') return err('That action isn’t allowed online.');
      try {
        if (a.type === 'concede') room.state = applyAction({ ...room.state, priority: i }, a);
        else {
          if (room.state.priority !== i) return err('It’s not your move.');
          room.state = applyAction(room.state, a);
        }
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
      if (room.state.phase === 'gameOver') finish(room);
      else broadcast(room);
      return;
    }
    default:
      return err('Unknown message');
  }
}

export function roomCount() {
  return { rooms: rooms.size, playing: [...rooms.values()].filter((r) => r.state && !r.ended).length };
}
