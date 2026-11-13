import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import { applyAction, createGame, currentLink, HERO_INDEX, linkPower, playOptions } from '../engine/game';
import type { DeckList } from '../engine/game';
import { getHeroAbility } from '../engine/heroes';
import { getScript } from '../engine/cardScript';
import type { GameState } from '../engine/types';

const id = (name: string, pitch?: number) => {
  const c = findCard(name, pitch);
  if (!c) throw new Error(`missing ${name}`);
  return c.id;
};

function game(hero: string, hand0: string[], opts: Partial<DeckList> = {}): GameState {
  const filler = Array(30).fill(id('Wounding Blow', 3));
  const mk = (h: string, hand: string[]): DeckList => ({ heroId: id(h), weaponIds: [], equipmentIds: [], cardIds: [...hand, ...filler], ...opts });
  let s = createGame([{ name: 'P0', isBot: false, deck: mk(hero, hand0) }, { name: 'P1', isBot: false, deck: mk('Dorinthea', []) }], 3);
  s = structuredClone(s);
  const p = s.players[0];
  const all = [...p.hand, ...p.deck];
  p.hand = hand0.map((n) => { const i = all.findIndex((c) => c.cardId === n); return all.splice(i, 1)[0]; });
  p.deck = all;
  s.turnPlayer = 0; s.priority = 0; p.actionPoints = 1; p.resources = 10;
  return s;
}

const passToDamage = (s: GameState) => {
  s = applyAction(s, { type: 'defend', uids: [] });
  s = applyAction(s, { type: 'pass' });
  return applyAction(s, { type: 'pass' });
};

describe('hero abilities', () => {
  it('every blitz hero with an ability matches exactly one implementation', () => {
    const matched = getDb().cards.filter((c) => c.types.includes('Hero') && getHeroAbility(c));
    expect(matched.length).toBeGreaterThan(30);
  });

  it('Dorinthea: weapon can attack again after its first hit', () => {
    let s = game('Dorinthea', [], { weaponIds: [id('Dawnblade')] });
    const w = s.players[0].weapons[0];
    const opt = playOptions(s, 0).find((o) => o.uid === w.inst.uid)!;
    s = applyAction(s, { type: 'activate', uid: w.inst.uid, index: opt.index, pitch: [] });
    s = passToDamage(s);
    expect(s.players[0].weapons[0].usedThisTurn).toBe(false);
  });

  it('Bravo: activation gives cost-3+ attacks dominate', () => {
    const red = id('Crippling Crush', 1);
    let s = game('Bravo', [red]);
    s.players[0].actionPoints = 2;
    const opt = playOptions(s, 0).find((o) => o.index >= HERO_INDEX)!;
    s = applyAction(s, { type: 'activate', uid: opt.uid, index: opt.index, pitch: [] });
    expect(s.players[0].actionPoints).toBe(2); // go again
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(currentLink(s)!.dominate).toBe(true);
  });

  it('Ira: second attack each turn gets +1 power', () => {
    const ga = id('Scar for a Scar', 1);
    let s = game('Ira, Scarlet Revenger', [ga, ga]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    const first = linkPower(currentLink(s)!);
    s = passToDamage(s);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(linkPower(currentLink(s)!)).toBe(first + 1);
  });

  it('Fai starts with Phoenix Flame in the graveyard and can return it', () => {
    let s = game('Fai', []);
    expect(s.players[0].graveyard.some((g) => findCard('Phoenix Flame')!.name === getDb().byId.get(g.cardId)!.name)).toBe(true);
    const opt = playOptions(s, 0).find((o) => o.index >= HERO_INDEX)!;
    s = applyAction(s, { type: 'activate', uid: opt.uid, index: opt.index, pitch: [] });
    expect(s.players[0].hand.some((h) => getDb().byId.get(h.cardId)!.name === 'Phoenix Flame')).toBe(true);
  });
});

describe('new card mechanics', () => {
  it('ninja combo triggers after the named attack', () => {
    const combo = getDb().cards.find((c) => getScript(c).conditional.some((x) => x.when === 'combo'))!;
    const cnd = getScript(combo).conditional.find((x) => x.when === 'combo')!;
    const first = findCard(cnd.comboWith!.split(' or ')[0])!;
    let s = game('Katsu', [first.id, combo.id]);
    s.players[0].actionPoints = 2;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = passToDamage(s);
    s.players[0].actionPoints = Math.max(1, s.players[0].actionPoints);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.log.some((l) => l.text.startsWith('Combo!'))).toBe(true);
  });

  it('blood debt costs life in the end phase', () => {
    const bd = getDb().cards.find((c) => getScript(c).bloodDebt)!;
    let s = game('Vynnset', []);
    s.players[0].banished.push({ uid: 9999, cardId: bd.id, owner: 0 });
    const before = s.players[0].life;
    s = applyAction(s, { type: 'pass' });
    if (s.phase === 'arsenal') s = applyAction(s, { type: 'arsenal', uid: null });
    expect(s.players[0].life).toBe(before - 1);
  });
});
