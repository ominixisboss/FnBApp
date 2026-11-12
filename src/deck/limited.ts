// Limited formats: Sealed (open 6 packs, build from the pool) and Draft (pass packs around a table of bots).
import { eligibleForHero, getDb, isToken } from '../data/cardDb';
import type { Card } from '../data/types';
import type { DeckList } from '../engine/game';
import { isArenaCard } from './deck';

export const LIMITED_SETS: [string, string][] = [
  ['WTR', 'Welcome to Rathe'], ['ARC', 'Arcane Rising'], ['CRU', 'Crucible of War'], ['MON', 'Monarch'], ['ELE', 'Tales of Aria'],
  ['UPR', 'Uprising'], ['DYN', 'Dynasty'], ['OUT', 'Outsiders'], ['DTD', 'Dusk till Dawn'], ['EVO', 'Bright Lights'],
  ['HVY', 'Heavy Hitters'], ['MST', 'Part the Mistveil'], ['ROS', 'Rosetta'], ['HNT', 'The Hunted'], ['SEA', 'High Seas'],
];
export const PACK_SIZE = 14;
export const LIMITED_MIN_DECK = 30;

export type Rng = () => number;
export function rngFrom(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; };
}

const isHeroCard = (c: Card) => c.types.includes('Hero');
function setCards(code: string): Card[] {
  return getDb().cards.filter((c) => c.sets.includes(code) && !isHeroCard(c) && !isToken(c) && !c.types.includes('Placeholder Card') && !c.types.includes('Resource') && c.typeText !== '');
}
const cache = new Map<string, Record<string, Card[]>>();
function byRarity(code: string) {
  if (!cache.has(code)) {
    const all = setCards(code);
    cache.set(code, {
      C: all.filter((c) => c.rarity === 'C' || c.rarity === 'T'),
      R: all.filter((c) => c.rarity === 'R' || c.rarity === 'S'),
      M: all.filter((c) => c.rarity === 'M' || c.rarity === 'L' || c.rarity === 'F'),
    });
  }
  return cache.get(code)!;
}

/** One booster: 10 commons, 3 rares and one slot that is usually a rare, sometimes a majestic (or better). */
export function openPack(code: string, rng: Rng): string[] {
  const r = byRarity(code);
  const pick = (list: Card[]) => list[Math.floor(rng() * list.length)];
  const out: string[] = [];
  const add = (list: Card[]) => { if (list.length) out.push(pick(list).id); };
  for (let i = 0; i < 10; i++) add(r.C.length ? r.C : r.R);
  for (let i = 0; i < 3; i++) add(r.R.length ? r.R : r.C);
  add(rng() < 0.18 && r.M.length ? r.M : r.R.length ? r.R : r.C);
  return out;
}

export function setHeroes(code: string): Card[] {
  return getDb().cards.filter((c) => isHeroCard(c) && c.types.includes('Young') && c.sets.includes(code));
}

/** A rough "how good is this card in limited" score (bots draft and auto-build with it). */
export function limitedScore(c: Card, hero?: Card): number {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  let v = num(c.power) * 1.2 + num(c.defense) * 0.6 - num(c.cost) * 0.45 + (c.keywords.includes('Go again') ? 1.5 : 0);
  if (c.types.includes('Attack')) v += 1;
  if (isArenaCard(c)) v += 2;
  if (c.rarity === 'M' || c.rarity === 'L') v += 1.5;
  if (c.rarity === 'R' || c.rarity === 'S') v += 0.6;
  if (hero) v += eligibleForHero(c, hero) ? 3 : -20;
  return v;
}

/** The best legal deck from a pool: every useful weapon/equipment plus the strongest `size` other cards. */
export function autoBuildLimited(pool: string[], hero: Card, size = LIMITED_MIN_DECK): string[] {
  const db = getDb();
  const cards = pool.map((id) => db.byId.get(id)!).filter((c) => c && eligibleForHero(c, hero));
  const arena: Card[] = [];
  const slots = new Set<string>();
  let hands = 0;
  for (const c of cards.filter(isArenaCard).sort((a, b) => limitedScore(b) - limitedScore(a))) {
    if (c.types.includes('Weapon')) {
      const need = c.types.includes('2H') ? 2 : 1;
      if (hands + need > 2) continue;
      hands += need;
      arena.push(c);
      continue;
    }
    const slot = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'].find((t) => c.types.includes(t)) ?? c.id;
    if (slots.has(slot)) continue;
    slots.add(slot);
    arena.push(c);
  }
  const main = cards.filter((c) => !isArenaCard(c)).sort((a, b) => limitedScore(b) - limitedScore(a)).slice(0, size);
  return [...arena, ...main].map((c) => c.id);
}

export function limitedDeckList(hero: Card, ids: string[]): DeckList {
  const db = getDb();
  const out: DeckList = { heroId: hero.id, weaponIds: [], equipmentIds: [], cardIds: [] };
  for (const id of ids) {
    const c = db.byId.get(id)!;
    if (c.types.includes('Weapon')) out.weaponIds.push(id);
    else if (isArenaCard(c)) out.equipmentIds.push(id);
    else out.cardIds.push(id);
  }
  return out;
}

/** Bots pick the best card for their hero. */
export function botPick(pack: string[], hero: Card): number {
  const db = getDb();
  let best = 0;
  pack.forEach((id, i) => { if (limitedScore(db.byId.get(id)!, hero) > limitedScore(db.byId.get(pack[best])!, hero)) best = i; });
  return best;
}
