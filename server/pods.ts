// Draft and Sealed pods for friends: everyone joins a table by code, empty draft seats are filled with bots,
// packs pass round the table, and each player then builds a 30+ card deck from their own pool. The server
// keeps every pool, so decks played from a pod are checked against what the player actually opened or drafted.
import { eligibleForHero, getDb } from '../src/data/cardDb';
import type { DeckList } from '../src/engine/game';
import type { PodView } from '../src/online/podTypes';
export type { PodView };
import { LIMITED_MIN_DECK, LIMITED_SETS, botPick, openPack, rngFrom, setHeroes } from '../src/deck/limited';

const SEATS = 8;
const ROUNDS = 3;
const SEALED_PACKS = 6;
const PICK_SECONDS = 75;
const MAX_HUMANS = 8;

interface PodSeat {
  userId: number | null; // null = bot
  username: string;
  name: string;
  botHero?: string;
  pack: string[];
  pool: string[];
  picked: boolean;
}

export interface Pod {
  code: string;
  mode: 'draft' | 'sealed';
  set: string;
  host: number;
  phase: 'lobby' | 'drafting' | 'building';
  round: number;
  seed: number;
  seats: PodSeat[];
  decks: Map<number, DeckList>;
  pickDeadline?: number;
  timer?: ReturnType<typeof setTimeout>;
  updated: number;
}

const pods = new Map<string, Pod>();
const podOf = new Map<number, string>(); // user -> pod code

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do { c = 'P' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (pods.has(c));
  return c;
}

export const userPod = (userId: number) => { const c = podOf.get(userId); return c ? pods.get(c) : undefined; };

export function viewFor(pod: Pod, userId: number): PodView {
  const me = pod.seats.find((s) => s.userId === userId);
  return {
    code: pod.code, mode: pod.mode, set: pod.set, setName: LIMITED_SETS.find(([c]) => c === pod.set)?.[1] ?? pod.set,
    phase: pod.phase, round: pod.round, isHost: pod.host === userId, pickDeadline: pod.pickDeadline,
    players: pod.seats.map((s) => ({ username: s.username, name: s.name, bot: s.userId === null, picks: s.pool.length, ready: s.userId !== null && pod.decks.has(s.userId) })),
    you: { pack: me?.pack ?? [], pool: me?.pool ?? [], picked: !!me?.picked, deckSubmitted: pod.decks.has(userId) },
  };
}

type Notify = (userId: number, view: PodView | null) => void;

function broadcast(pod: Pod, notify: Notify) {
  pod.updated = Date.now();
  for (const s of pod.seats) if (s.userId !== null) notify(s.userId, viewFor(pod, s.userId));
}

export function createPod(userId: number, username: string, name: string, mode: string, set: string): Pod | string {
  if (userPod(userId)) return 'You’re already at a draft table. Leave it first.';
  if (!LIMITED_SETS.some(([c]) => c === set)) return 'Unknown set.';
  const pod: Pod = {
    code: newCode(), mode: mode === 'sealed' ? 'sealed' : 'draft', set, host: userId, phase: 'lobby', round: 0,
    seed: Math.floor(Math.random() * 2 ** 31), seats: [{ userId, username, name, pack: [], pool: [], picked: false }], decks: new Map(), updated: Date.now(),
  };
  pods.set(pod.code, pod);
  podOf.set(userId, pod.code);
  return pod;
}

export function joinPod(userId: number, username: string, name: string, code: string, notify: Notify): Pod | string {
  const pod = pods.get(code.trim().toUpperCase());
  if (!pod) return 'No table with that code.';
  if (pod.seats.some((s) => s.userId === userId)) return pod;
  if (userPod(userId)) return 'You’re already at a draft table. Leave it first.';
  if (pod.phase !== 'lobby') return 'That table has already started.';
  if (pod.seats.length >= MAX_HUMANS) return 'That table is full.';
  pod.seats.push({ userId, username, name, pack: [], pool: [], picked: false });
  podOf.set(userId, pod.code);
  broadcast(pod, notify);
  return pod;
}

export function leavePod(userId: number, notify: Notify) {
  const pod = userPod(userId);
  podOf.delete(userId);
  notify(userId, null);
  if (!pod) return;
  if (pod.phase === 'lobby') {
    pod.seats = pod.seats.filter((s) => s.userId !== userId);
    if (!pod.seats.length) { pods.delete(pod.code); return; }
    if (pod.host === userId) pod.host = pod.seats[0].userId!;
  } else {
    // mid-draft: a bot takes over the seat so the packs keep moving
    const seat = pod.seats.find((s) => s.userId === userId);
    if (seat) { seat.userId = null; seat.name = `${seat.name} (bot)`; seat.botHero = randomHero(pod); }
    pod.decks.delete(userId);
    if (!pod.seats.some((s) => s.userId !== null)) { clearTimeout(pod.timer); pods.delete(pod.code); return; }
    if (pod.phase === 'drafting') maybeAdvance(pod, notify);
  }
  broadcast(pod, notify);
}

function randomHero(pod: Pod): string {
  const hs = setHeroes(pod.set);
  return hs[Math.floor(Math.random() * hs.length)]?.id ?? '';
}

export function startPod(userId: number, notify: Notify): string | null {
  const pod = userPod(userId);
  if (!pod) return 'You’re not at a table.';
  if (pod.host !== userId) return 'Only the host can start.';
  if (pod.phase !== 'lobby') return null;
  const rng = rngFrom(pod.seed);
  if (pod.mode === 'sealed') {
    for (const s of pod.seats) s.pool = Array.from({ length: SEALED_PACKS }, () => openPack(pod.set, rng)).flat();
    pod.phase = 'building';
  } else {
    let b = 1;
    while (pod.seats.length < SEATS) pod.seats.push({ userId: null, username: `bot${b}`, name: `Bot ${b++}`, botHero: randomHero(pod), pack: [], pool: [], picked: false });
    pod.round = 1;
    for (const s of pod.seats) s.pack = openPack(pod.set, rng);
    pod.phase = 'drafting';
    armTimer(pod, notify);
  }
  broadcast(pod, notify);
  return null;
}

function armTimer(pod: Pod, notify: Notify) {
  clearTimeout(pod.timer);
  pod.pickDeadline = Date.now() + PICK_SECONDS * 1000;
  pod.timer = setTimeout(() => {
    // anyone who hasn't picked in time gets the card a bot would take
    for (const s of pod.seats) if (s.userId !== null && !s.picked && s.pack.length) autoPick(pod, s);
    maybeAdvance(pod, notify);
    broadcast(pod, notify);
  }, PICK_SECONDS * 1000);
}

function autoPick(pod: Pod, s: PodSeat) {
  const db = getDb();
  const hero = db.byId.get(s.botHero ?? randomHero(pod));
  const i = hero ? botPick(s.pack, hero) : 0;
  s.pool.push(s.pack.splice(i, 1)[0]);
  s.picked = true;
}

export function pick(userId: number, index: number, notify: Notify): string | null {
  const pod = userPod(userId);
  if (!pod || pod.phase !== 'drafting') return 'Nothing to pick right now.';
  const s = pod.seats.find((x) => x.userId === userId)!;
  if (s.picked) return 'Wait for the others to pick.';
  if (!Number.isInteger(index) || index < 0 || index >= s.pack.length) return 'That card isn’t in your pack.';
  s.pool.push(s.pack.splice(index, 1)[0]);
  s.picked = true;
  maybeAdvance(pod, notify);
  broadcast(pod, notify);
  return null;
}

/** When every human has picked: the bots pick, packs pass, and a new round opens when they're empty. */
function maybeAdvance(pod: Pod, notify: Notify) {
  if (pod.seats.some((s) => s.userId !== null && !s.picked && s.pack.length)) return;
  for (const s of pod.seats) if (s.userId === null && s.pack.length) autoPick(pod, s);
  const dir = pod.round === 2 ? -1 : 1;
  const packs = pod.seats.map((s) => s.pack);
  pod.seats.forEach((s, i) => { s.pack = packs[(i - dir + pod.seats.length) % pod.seats.length]; s.picked = false; });
  if (pod.seats[0].pack.length === 0) {
    if (pod.round < ROUNDS) {
      pod.round++;
      const rng = rngFrom(pod.seed + pod.round * 7919);
      for (const s of pod.seats) s.pack = openPack(pod.set, rng);
    } else {
      clearTimeout(pod.timer);
      pod.pickDeadline = undefined;
      pod.phase = 'building';
      return;
    }
  }
  armTimer(pod, notify);
}

/** A deck from a pod must use a hero from the set and only cards from the player's own pool. */
export function submitDeck(userId: number, deck: DeckList, notify: Notify): string | null {
  const pod = userPod(userId);
  if (!pod || pod.phase !== 'building') return 'You can’t submit a deck right now.';
  const s = pod.seats.find((x) => x.userId === userId)!;
  const db = getDb();
  if (!deck || !setHeroes(pod.set).some((h) => h.id === deck.heroId)) return 'Choose a hero from this set.';
  const hero = db.byId.get(deck.heroId)!;
  const left = new Map<string, number>();
  for (const id of s.pool) left.set(id, (left.get(id) ?? 0) + 1);
  for (const id of [...(deck.weaponIds ?? []), ...(deck.equipmentIds ?? []), ...(deck.cardIds ?? [])]) {
    const n = left.get(id) ?? 0;
    if (!n) return 'That deck uses cards that aren’t in your pool.';
    if (!eligibleForHero(db.byId.get(id)!, hero)) return `${db.byId.get(id)!.name} can’t be used by ${hero.name}.`;
    left.set(id, n - 1);
  }
  if ((deck.cardIds ?? []).length < LIMITED_MIN_DECK) return `Your deck needs at least ${LIMITED_MIN_DECK} cards.`;
  pod.decks.set(userId, deck);
  broadcast(pod, notify);
  return null;
}

/** The checked deck a player submitted to their pod (used when they play someone at the table). */
export function podDeck(userId: number): { pod: Pod; deck: DeckList } | null {
  const pod = userPod(userId);
  const deck = pod?.decks.get(userId);
  return pod && deck ? { pod, deck } : null;
}

/** Tables are dropped a day after their last change. */
setInterval(() => {
  for (const p of pods.values()) if (Date.now() - p.updated > 864e5) {
    clearTimeout(p.timer);
    pods.delete(p.code);
    for (const s of p.seats) if (s.userId !== null) podOf.delete(s.userId);
  }
}, 36e5).unref();
