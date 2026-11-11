import type { Card } from '../data/types';
import { PITCH_COLOR } from '../data/types';
import {
  card, eligibleForHero, findCard, getDb, has, isEquipment, isHero, isWeapon, isYoung, n,
} from '../data/cardDb';
import type { DeckList } from '../engine/game';
import { getScript } from '../engine/cardScript';

export type DeckFormat = 'blitz' | 'cc' | 'casual';

export interface Deck {
  id: string;
  name: string;
  format: DeckFormat;
  heroId: string;
  /** card id -> copies. Includes weapons and equipment. */
  cards: Record<string, number>;
  updatedAt: number;
}

export const FORMAT_RULES: Record<DeckFormat, { minDeck: number; maxDeck: number; copies: number; young: boolean | null; legalKey: string | null }> = {
  blitz: { minDeck: 40, maxDeck: 40, copies: 2, young: true, legalKey: 'blitz' },
  cc: { minDeck: 60, maxDeck: 80, copies: 3, young: false, legalKey: 'cc' },
  casual: { minDeck: 20, maxDeck: 200, copies: 99, young: null, legalKey: null },
};

export const isArenaCard = (c: Card) => isWeapon(c) || isEquipment(c);

export function newDeck(heroId: string, format: DeckFormat, name?: string): Deck {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: name ?? `${card(heroId).name} deck`,
    format,
    heroId,
    cards: {},
    updatedAt: Date.now(),
  };
}

export function deckCounts(d: Deck) {
  let main = 0;
  let arena = 0;
  for (const [id, cnt] of Object.entries(d.cards)) {
    const c = getDb().byId.get(id);
    if (!c) continue;
    if (isArenaCard(c)) arena += cnt;
    else main += cnt;
  }
  return { main, arena };
}

export function validateDeck(d: Deck): string[] {
  const errs: string[] = [];
  const hero = getDb().byId.get(d.heroId);
  if (!hero || !isHero(hero)) return ['Choose a hero.'];
  const r = FORMAT_RULES[d.format];
  if (r.young === true && !isYoung(hero)) errs.push(`${hero.name} is not a young hero (Blitz needs a young hero).`);
  if (r.young === false && isYoung(hero)) errs.push(`${hero.name} is a young hero (Classic Constructed needs an adult hero).`);
  if (r.legalKey && !hero.legal.includes(r.legalKey as never)) errs.push(`${hero.name} is not legal in this format.`);
  const { main } = deckCounts(d);
  if (main < r.minDeck) errs.push(`Deck has ${main} cards; needs at least ${r.minDeck}.`);
  if (main > r.maxDeck) errs.push(`Deck has ${main} cards; maximum is ${r.maxDeck}.`);
  const byName = new Map<string, number>();
  let weapons = 0;
  for (const [id, cnt] of Object.entries(d.cards)) {
    const c = getDb().byId.get(id);
    if (!c) { errs.push(`Unknown card ${id}`); continue; }
    if (!eligibleForHero(c, hero)) errs.push(`${c.name} can't be used by ${hero.name} (class/talent mismatch).`);
    if (r.legalKey && !c.legal.includes(r.legalKey as never)) errs.push(`${c.name} is not legal (or banned) in ${d.format.toUpperCase()}.`);
    const key = `${c.name}|${c.pitch ?? ''}`;
    byName.set(key, (byName.get(key) ?? 0) + cnt);
    if (c.keywords.includes('Legendary') && cnt > 1) errs.push(`${c.name} is legendary (max 1).`);
    if (isWeapon(c)) weapons += cnt;
  }
  for (const [key, cnt] of byName) {
    if (cnt > r.copies) errs.push(`${key.split('|')[0]}: ${cnt} copies (max ${r.copies}).`);
  }
  if (weapons === 0) errs.push('No weapon included (allowed, but most heroes want one).');
  return errs;
}

export function toDeckList(d: Deck): DeckList {
  const out: DeckList = { heroId: d.heroId, weaponIds: [], equipmentIds: [], cardIds: [] };
  for (const [id, cnt] of Object.entries(d.cards)) {
    const c = card(id);
    for (let i = 0; i < cnt; i++) {
      if (isWeapon(c)) out.weaponIds.push(id);
      else if (isEquipment(c)) out.equipmentIds.push(id);
      else out.cardIds.push(id);
    }
  }
  return out;
}

// ------------------------------------------------------------ import / export

const COLOR_PITCH: Record<string, number> = { red: 1, yellow: 2, blue: 3 };

export interface ImportResult {
  deck: Deck | null;
  warnings: string[];
}

/**
 * Parses common text decklist formats (Fabrary / FaB DB / Talishar exports):
 *   Hero: Dorinthea Ironsong
 *   Weapons: Dawnblade
 *   Equipment: Braveforge Bracers, Refraction Bolters
 *   (3) Ironsong Response (red)
 *   3x Warrior's Valor (yellow)
 *   2 Sigil of Solace [blue]
 */
export function importDecklist(text: string, format?: DeckFormat): ImportResult {
  const warnings: string[] = [];
  let heroId: string | null = null;
  let name: string | null = null;
  let fmt: DeckFormat | undefined = format;
  const cards: Record<string, number> = {};
  const add = (raw: string, count: number) => {
    let nm = raw.trim().replace(/\s+/g, ' ');
    let pitch: number | null = null;
    const m = nm.match(/^(.*?)\s*[([]\s*(red|yellow|blue|1|2|3)\s*[)\]]\s*$/i) ?? nm.match(/^(.*?)\s*-\s*(red|yellow|blue)$/i);
    if (m) {
      nm = m[1].trim();
      pitch = COLOR_PITCH[m[2].toLowerCase()] ?? Number(m[2]);
    }
    const c = findCard(nm, pitch);
    if (!c) { warnings.push(`Not found: ${raw.trim()}`); return; }
    if (isHero(c)) { heroId = c.id; return; }
    cards[c.id] = (cards[c.id] ?? 0) + count;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || /^(see the full deck|made with|https?:)/i.test(line)) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^name:\s*(.+)$/i))) { name = m[1].trim(); continue; }
    if ((m = line.match(/^format:\s*(.+)$/i))) {
      const f = m[1].toLowerCase();
      fmt = f.includes('blitz') ? 'blitz' : f.includes('classic') || f === 'cc' ? 'cc' : fmt;
      continue;
    }
    if ((m = line.match(/^hero:\s*(.+)$/i))) {
      const h = findCard(m[1]);
      if (h && isHero(h)) heroId = h.id;
      else warnings.push(`Hero not found: ${m[1]}`);
      continue;
    }
    if ((m = line.match(/^(?:weapons?|equipment|arena cards?)\s*:\s*(.*)$/i))) {
      for (const part of m[1].split(/,\s*/)) if (part.trim()) add(part, 1);
      continue;
    }
    if (/^(deck|main ?deck|sideboard|inventory|arena|pitch \d)\s*:?$/i.test(line) || /^[A-Za-z ]+(\(\d+\))?\s*:$/.test(line)) continue;
    if ((m = line.match(/^\(?(\d+)\)?\s*x?\s+(.+)$/i))) { add(m[2], +m[1]); continue; }
    if ((m = line.match(/^(.+?)\s+x\s*(\d+)$/i))) { add(m[1], +m[2]); continue; }
    // bare card name (count 1)
    add(line, 1);
  }
  if (!heroId) {
    warnings.unshift('No hero found in the list — add a line like "Hero: Dorinthea Ironsong".');
    return { deck: null, warnings };
  }
  const hero = card(heroId);
  const deck = newDeck(heroId, fmt ?? (isYoung(hero) ? 'blitz' : 'cc'), name ?? undefined);
  deck.cards = cards;
  return { deck, warnings };
}

export function exportDecklist(d: Deck): string {
  const hero = card(d.heroId);
  const lines = [`Name: ${d.name}`, `Hero: ${hero.name}`, `Format: ${d.format === 'cc' ? 'Classic Constructed' : d.format === 'blitz' ? 'Blitz' : 'Casual'}`];
  const entries = Object.entries(d.cards).map(([id, cnt]) => ({ c: card(id), cnt }));
  const weapons = entries.filter((e) => isWeapon(e.c));
  const equipment = entries.filter((e) => isEquipment(e.c) && !isWeapon(e.c));
  const main = entries.filter((e) => !isArenaCard(e.c));
  const flat = (list: typeof entries) => list.flatMap((e) => Array(e.cnt).fill(e.c.name)).join(', ');
  if (weapons.length) lines.push(`Weapons: ${flat(weapons)}`);
  if (equipment.length) lines.push(`Equipment: ${flat(equipment)}`);
  lines.push('');
  main
    .sort((a, b) => (a.c.pitch ?? 0) - (b.c.pitch ?? 0) || a.c.name.localeCompare(b.c.name))
    .forEach((e) => lines.push(`(${e.cnt}) ${e.c.name}${e.c.pitch ? ` (${PITCH_COLOR[e.c.pitch]})` : ''}`));
  return lines.join('\n');
}

// ------------------------------------------------------------ auto-build

/** Score how good a card is likely to be in the simulator (prefers fully scripted cards). */
function autoScore(c: Card): number {
  const sc = getScript(c);
  let v = 0;
  if (has(c, 'Attack') && has(c, 'Action')) v += n(c.power) * 1.2 - n(c.cost) * 0.6 + (sc.goAgain ? 2 : 0);
  if (has(c, 'Attack Reaction')) v += 2.5;
  if (has(c, 'Defense Reaction')) v += n(c.defense) * 0.9;
  if (has(c, 'Instant') || (has(c, 'Action') && !has(c, 'Attack'))) v += sc.onPlay.length ? 3 : 0.5;
  if (has(c, 'Block')) v += n(c.defense) * 0.6;
  v += sc.coverage === 'full' ? 2 : sc.coverage === 'partial' ? 0.8 : -1.5;
  if (c.pitch === 3) v += 0.5;
  if (c.types.length && !c.types.includes('Generic')) v += 3; // prefer class/talent cards
  return v;
}

const weaponScore = (w: Card) => n(w.power) - (getScript(w).activations.find((a) => a.attack)?.cost ?? 2) * 0.8;

/** Build a legal, playable deck for any hero from the full card pool. */
export function autoBuildDeck(heroId: string, format: DeckFormat, seed = 1): Deck {
  const hero = card(heroId);
  const fmt: DeckFormat = format;
  const r = FORMAT_RULES[fmt];
  const pool = getDb().cards.filter((c) => eligibleForHero(c, hero) && (!r.legalKey || c.legal.includes(r.legalKey as never)));
  const deck = newDeck(heroId, fmt, `${hero.name} (auto)`);
  let rng = seed;
  const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // weapon: prefer ones that attack, then any
  const weapons = pool.filter((c) => isWeapon(c) && !has(c, 'Token'));
  const attackWeapons = weapons.filter((w) => getScript(w).activations.some((a) => a.attack) && n(w.power) > 0);
  const classWeapons = (attackWeapons.length ? attackWeapons : weapons).filter((w) => !w.types.includes('Generic'));
  const wPick = (classWeapons.length ? classWeapons : attackWeapons.length ? attackWeapons : weapons)
    .sort((a, b) => weaponScore(b) - weaponScore(a))[0];
  if (wPick) {
    deck.cards[wPick.id] = 1;
    if (wPick.types.includes('1H') && !wPick.keywords.includes('Legendary')) deck.cards[wPick.id] = 2;
  }
  // equipment: best defense per slot
  for (const slot of ['Head', 'Chest', 'Arms', 'Legs']) {
    const eq = pool
      .filter((c) => isEquipment(c) && c.types.includes(slot) && typeof c.defense === 'number')
      .sort((a, b) => n(b.defense) - n(a.defense) + (rnd() - 0.5))[0];
    if (eq) deck.cards[eq.id] = 1;
  }
  // main deck: score cards, keep mix of pitch values
  const mains = pool.filter((c) => !isArenaCard(c) && !has(c, 'Hero') && c.pitch !== null && !c.types.includes('Resource') && !c.keywords.includes('Legendary'));
  const scored = mains.map((c) => ({ c, s: autoScore(c) + rnd() * 1.5 })).sort((a, b) => b.s - a.s);
  const target = r.minDeck;
  const copies = Math.min(r.copies, 3);
  const pitchTarget: Record<number, number> = { 1: Math.round(target * 0.45), 2: Math.round(target * 0.2), 3: 0 };
  pitchTarget[3] = target - pitchTarget[1] - pitchTarget[2];
  const pitchCount: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const { c } of scored) {
    if (total >= target) break;
    const p = c.pitch!;
    if (pitchCount[p] >= pitchTarget[p]) continue;
    const k = Math.min(copies, pitchTarget[p] - pitchCount[p], target - total);
    deck.cards[c.id] = k;
    pitchCount[p] += k;
    total += k;
  }
  // fill if pitch buckets ran dry
  for (const { c } of scored) {
    if (total >= target) break;
    const have = deck.cards[c.id] ?? 0;
    const k = Math.min(copies - have, target - total);
    if (k > 0) { deck.cards[c.id] = have + k; total += k; }
  }
  return deck;
}

export function heroesFor(format: DeckFormat): Card[] {
  const r = FORMAT_RULES[format];
  return getDb().cards.filter((c) => isHero(c) &&
    (r.young === null || isYoung(c) === r.young) &&
    (!r.legalKey || c.legal.includes(r.legalKey as never)) &&
    !c.types.includes('Demi-Hero'));
}

// ------------------------------------------------------------ storage

const KEY = 'fab-trainer.decks.v1';

export function loadDecks(): Deck[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveDecks(decks: Deck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    /* storage unavailable */
  }
}
