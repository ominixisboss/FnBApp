import type { Card } from './types';
import { CLASSES, TALENTS, ELEMENTS, PITCH_COLOR } from './types';

export interface CardDb {
  cards: Card[];
  byId: Map<string, Card>;
  byName: Map<string, Card[]>; // lower-case name -> printings of each pitch
  builtAt: string;
}

let db: CardDb | null = null;
let loading: Promise<CardDb> | null = null;

export function makeDb(cards: Card[], builtAt = ''): CardDb {
  const byId = new Map<string, Card>();
  const byName = new Map<string, Card[]>();
  for (const c of cards) {
    byId.set(c.id, c);
    const k = c.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(c);
  }
  return { cards, byId, byName, builtAt };
}

export function setDb(d: CardDb) {
  db = d;
}

export function loadCardDb(): Promise<CardDb> {
  if (db) return Promise.resolve(db);
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/cards.json`)
      .then((r) => r.json())
      .then((json: { cards: Card[]; builtAt: string }) => {
        db = makeDb(json.cards, json.builtAt);
        return db;
      });
  }
  return loading;
}

export function getDb(): CardDb {
  if (!db) throw new Error('Card database not loaded');
  return db;
}

export function card(id: string): Card {
  const c = getDb().byId.get(id);
  if (!c) throw new Error(`Unknown card ${id}`);
  return c;
}

/** Look up a card by name and optional pitch colour ("red"/"yellow"/"blue" or 1/2/3). */
export function findCard(name: string, pitch?: number | null): Card | undefined {
  const list = getDb().byName.get(name.trim().toLowerCase());
  if (!list) return undefined;
  if (pitch == null) return list[0];
  return list.find((c) => c.pitch === pitch) ?? (list.length === 1 ? list[0] : undefined);
}

export const has = (c: Card, t: string) => c.types.includes(t);
export const isHero = (c: Card) => has(c, 'Hero');
export const isYoung = (c: Card) => has(c, 'Young');
export const isEquipment = (c: Card) => has(c, 'Equipment');
export const isWeapon = (c: Card) => has(c, 'Weapon');
export const isToken = (c: Card) => has(c, 'Token');
export const isAttackAction = (c: Card) => has(c, 'Action') && has(c, 'Attack');
export const n = (v: number | string | null | undefined): number =>
  typeof v === 'number' ? v : 0;

export function supertypes(c: Card): string[] {
  return c.types.filter((t) => CLASSES.includes(t) || TALENTS.includes(t));
}

/** Can a card go in a deck for this hero (class / talent matching)? */
export function eligibleForHero(c: Card, hero: Card): boolean {
  if (isHero(c) || isToken(c)) return false;
  if (c.types.includes('Placeholder Card')) return false;
  const heroTypes = new Set(supertypes(hero));
  if (heroTypes.has('Elemental')) ELEMENTS.forEach((e) => heroTypes.add(e));
  heroTypes.add('Generic');
  const st = supertypes(c);
  if (st.length === 0) return true;
  // hero-specific cards ("Specialization") — card text says "<Hero> Specialization"
  const spec = c.keywords.find((k) => k.endsWith('Specialization'));
  if (spec) {
    const who = spec.replace(' Specialization', '').toLowerCase();
    if (!hero.name.toLowerCase().startsWith(who)) return false;
  }
  return st.every((t) => heroTypes.has(t));
}

export function cardLabel(c: Card): string {
  return c.pitch ? `${c.name} (${PITCH_COLOR[c.pitch]})` : c.name;
}
