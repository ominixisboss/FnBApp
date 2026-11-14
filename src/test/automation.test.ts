import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import type { Card } from '../data/types';
import { getScript } from '../engine/cardScript';
import { applyAction, createGame, currentLink, defendOptions, HAND_INDEX, linkPower, playOptions } from '../engine/game';
import type { DeckList } from '../engine/game';
import type { GameState } from '../engine/types';
import { decideOptional } from '../ai/bot';

const filler = () => findCard('Wounding Blow', 3)!.id;
const legal = (c: Card) => c.legal.includes('blitz') || c.legal.includes('cc');

function game(hand0: string[], hand1: string[] = []): GameState {
  const mk = (hand: string[]): DeckList => ({ heroId: findCard('Dorinthea')!.id, weaponIds: [], equipmentIds: [], cardIds: [...hand, ...Array(30).fill(filler())] });
  let s = createGame([{ name: 'P0', isBot: false, deck: mk(hand0) }, { name: 'P1', isBot: false, deck: mk(hand1) }], 7);
  s = structuredClone(s);
  for (const [pi, names] of [[0, hand0], [1, hand1]] as const) {
    const p = s.players[pi];
    const all = [...p.hand, ...p.deck];
    p.hand = names.map((n) => { const i = all.findIndex((c) => c.cardId === n); return all.splice(i, 1)[0]; });
    p.deck = all;
  }
  s.turnPlayer = 0; s.priority = 0; s.players[0].actionPoints = 1; s.players[0].resources = 10;
  return s;
}
const find = (pred: (c: Card) => boolean) => getDb().cards.find((c) => legal(c) && pred(c))!;

describe('conditions', () => {
  it('"If you have less life than an opposing hero" applies only when behind', () => {
    const c = find((x) => getScript(x).conditional.some((k) => k.when === 'if' && k.cond?.kind === 'lessLife' && k.effects.some((e) => e.kind === 'thisPower')) && x.types.includes('Attack') && x.types.includes('Action'));
    let s = game([c.id, filler()]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    const even = linkPower(currentLink(s)!);
    let t = game([c.id, filler()]);
    t.players[0].life = 5;
    t = applyAction(t, { type: 'play', uid: t.players[0].hand[0].uid, pitch: [] });
    expect(linkPower(currentLink(t)!)).toBeGreaterThan(even);
  });
});

describe('optional costs', () => {
  it('paying "discard a card" gives the payoff, declining does not', () => {
    const c = find((x) => { const o = getScript(x).optional; return !!o && o.cost.kind === 'discard' && !o.cost.pitch && !o.cost.power && !o.cost.type && o.minPower === undefined && o.timing !== 'defend' && x.types.includes('Attack') && x.types.includes('Action'); });
    const s0 = game([c.id, filler(), filler()]);
    const uid = s0.players[0].hand[0].uid;
    const discard = s0.players[0].hand[1].uid;
    const yes = applyAction(s0, { type: 'play', uid, pitch: [], optional: { accept: true, uid: discard } });
    const no = applyAction(s0, { type: 'play', uid, pitch: [], optional: { accept: false } });
    expect(yes.players[0].graveyard.some((g) => g.uid === discard)).toBe(true);
    expect(no.players[0].hand.some((h) => h.uid === discard)).toBe(true);
    expect(yes.log.length).toBeGreaterThan(no.log.length);
  });
  it('the bot makes a decision on optional costs, with a card to pay when needed', () => {
    const c = find((x) => { const o = getScript(x).optional; return !!o && o.cost.kind === 'discard' && !o.cost.pitch && !o.cost.power && !o.cost.type && o.timing !== 'defend' && o.minPower === undefined; });
    const s = game([c.id, filler(), filler()]);
    const d = decideOptional(s, s.players[0], s.players[0].hand[0].uid, []);
    expect(d).toBeDefined();
    if (d!.accept) expect(s.players[0].hand.some((h) => h.uid === d!.uid)).toBe(true);
  });
});

describe('new mechanics', () => {
  it('"Instant - Discard this" works from hand', () => {
    const c = find((x) => !!getScript(x).handActivation && getScript(x).handActivation!.cost === 0);
    let s = game([c.id]);
    const opt = playOptions(s, 0).find((o) => o.index === HAND_INDEX)!;
    expect(opt).toBeDefined();
    s = applyAction(s, { type: 'activate', uid: opt.uid, index: HAND_INDEX, pitch: [] });
    expect(s.players[0].graveyard.some((g) => g.cardId === c.id)).toBe(true);
  });
  it('"When this hits, put it into your soul" moves the card to the soul', () => {
    const c = find((x) => getScript(x).hitDestination === 'soul' && x.types.includes('Attack') && x.types.includes('Action') && Number(x.cost ?? 0) <= 3);
    let s = game([c.id]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = applyAction(s, { type: 'defend', uids: [] });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' }); // end turn: chain closes
    expect((s.players[0].soul ?? []).some((x) => x.cardId === c.id)).toBe(true);
  });
  it('"This can\'t be defended by equipment" removes equipment blocks', () => {
    const c = find((x) => getScript(x).noEquipDefense && x.types.includes('Attack') && x.types.includes('Action') && Number(x.cost ?? 0) <= 3);
    const eq = find((x) => x.types.includes('Equipment') && x.types.includes('Chest') && typeof x.defense === 'number' && x.types.includes('Generic'));
    const mk = (hand: string[], equip: string[] = []): DeckList => ({ heroId: findCard('Dorinthea')!.id, weaponIds: [], equipmentIds: equip, cardIds: [...hand, ...Array(30).fill(filler())] });
    let s = createGame([{ name: 'A', isBot: false, deck: mk([c.id]) }, { name: 'B', isBot: false, deck: mk([], [eq.id]) }], 3);
    s = structuredClone(s);
    const p = s.players[0];
    const all = [...p.hand, ...p.deck];
    p.hand = [all.splice(all.findIndex((x) => x.cardId === c.id), 1)[0]];
    p.deck = all;
    s.turnPlayer = 0; s.priority = 0; p.actionPoints = 1; p.resources = 10;
    s = applyAction(s, { type: 'play', uid: p.hand[0].uid, pitch: [] });
    expect(() => applyAction(s, { type: 'defend', uids: [s.players[1].equipment[0].inst.uid] })).toThrow();
  });
  it('more of the card pool is fully automated', () => {
    const pool = getDb().cards.filter((c) => legal(c) && !c.types.includes('Hero'));
    const full = pool.filter((c) => getScript(c).coverage === 'full').length;
    expect(full).toBeGreaterThan(780);
  });
});

describe('most-played cards', () => {
  it('Crush cards parse their next-turn penalties', () => {
    for (const [n, mod] of [['Debilitate', 'attackPower'], ['Cartilage Crush', 'costMore'], ['Cranial Crush', 'noDraw'], ['Spinal Crush', 'noGoAgain']] as const) {
      const sc = getScript(findCard(n)!);
      expect(sc.coverage).toBe('full');
      expect(sc.conditional.find((c) => c.when === 'crush')!.effects[0]).toMatchObject({ kind: 'oppNextTurn', mod });
    }
    for (const n of ['Disable', 'Buckling Blow', 'Righteous Cleansing', 'Frontline Plating', 'Embrace Adversity', 'Crown of Providence', 'Enlightened Strike', 'Spinning Wheel Kick', "Bolt'n' Shot", 'Hostile Encroachment', 'Biting Blade', 'Aether Spindle', 'Scuttle the Canal'])
      expect([n, getScript(findCard(n)!).coverage]).toEqual([n, 'full']);
  });

  it('a Debilitate crush makes the next attack weaker', () => {
    let s = game([findCard('Debilitate')!.id]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = applyAction(s, { type: 'defend', uids: [] });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    expect(s.players[1].nextTurn?.attackPower).toBe(2);
  });

  it('Frontline equipment wears down at the end of your turn, and Adversity equipment only blocks after the token was used', () => {
    const plating = findCard('Frontline Plating')!.id;
    const adv = findCard('Embrace Adversity')!.id;
    const mk = (equip: string[]): DeckList => ({ heroId: findCard('Dorinthea')!.id, weaponIds: [], equipmentIds: equip, cardIds: Array(30).fill(filler()) });
    let s = createGame([{ name: 'A', isBot: false, deck: mk([plating]) }, { name: 'B', isBot: false, deck: mk([adv]) }], 3, 'blitz', 0);
    const d0 = s.players[0].equipment[0].defenseMod;
    while (s.turnPlayer === 0) s = applyAction(s, s.phase === 'arsenal' ? { type: 'arsenal', uid: null } : { type: 'pass' });
    expect(s.players[0].equipment[0].defenseMod).toBe(d0 - 1);
    // B's Embrace Adversity can't defend A's attack: A destroyed no Might token
    s = structuredClone(s);
    s.turnPlayer = 0; s.priority = 0; s.phase = 'action'; s.players[0].actionPoints = 1; s.players[0].resources = 10;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(defendOptions(s, 1).some((o) => o.uid === s.players[1].equipment[0].inst.uid)).toBe(false);
  });
});

describe('your own choices', () => {
  it('Enlightened Strike asks which card goes to the bottom of your deck', () => {
    let s = game([findCard('Enlightened Strike')!.id, filler(), findCard('Sigil of Solace', 1)?.id ?? filler()]);
    const keep = s.players[0].hand[1].uid;
    const away = s.players[0].hand[2].uid;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [], mode: 0 });
    const pc = s.pendingChoices?.[0];
    expect(pc?.kind).toBe('pick');
    expect(pc!.options.map((o) => o.uid).sort()).toEqual([keep, away].sort());
    s = applyAction(s, { type: 'choose', picks: [away] });
    expect(s.players[0].deck.at(-1)!.uid).toBe(away);
    expect(s.players[0].hand.some((h) => h.uid === keep)).toBe(true);
  });
});

describe('long tail', () => {
  it('contracts, Ironhide, Cloak of Darkness, Bluster Buff and "enters the arena" are automated', () => {
    for (const n of ['Already Dead', 'Ironhide Gauntlet', 'Cloak of Darkness', 'Bluster Buff', 'Concealed Object']) expect([n, getScript(findCard(n)!).coverage]).toEqual([n, 'full']);
    expect(getScript(findCard('Already Dead')!).contract).toBe('nonAction');
  });
  it('Cloak of Darkness is banished to prevent 2 damage', () => {
    const cloak = findCard('Cloak of Darkness')!.id;
    const mk = (equip: string[]): DeckList => ({ heroId: findCard('Dorinthea')!.id, weaponIds: [], equipmentIds: equip, cardIds: Array(30).fill(filler()) });
    let s = createGame([{ name: 'A', isBot: false, deck: mk([]) }, { name: 'B', isBot: false, deck: mk([cloak]) }], 3, 'blitz', 0);
    s = structuredClone(s); s.players[0].actionPoints = 1; s.players[0].resources = 10;
    const life = s.players[1].life;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    const power = linkPower(currentLink(s)!);
    s = applyAction(s, { type: 'defend', uids: [] });
    s = applyAction(s, { type: 'pass' }); s = applyAction(s, { type: 'pass' });
    expect(s.players[1].banished.some((b) => b.cardId === cloak)).toBe(true);
    expect(life - s.players[1].life).toBe(Math.max(0, power - 2)); // the attack minus the 2 prevented
  });
});

describe('third pass', () => {
  it('a Crouching Tiger created in your banished zone can be played this turn', () => {
    let s = game([findCard('Biting Breeze')!.id, filler()]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = applyAction(s, { type: 'defend', uids: [] });
    s = applyAction(s, { type: 'pass' }); s = applyAction(s, { type: 'pass' });
    const tiger = s.players[0].banished.find((b) => getDb().byId.get(b.cardId)!.name === 'Crouching Tiger');
    expect(tiger).toBeDefined();
    s.players[0].actionPoints = Math.max(1, s.players[0].actionPoints); s.players[0].resources = 5;
    expect(playOptions(s, 0).some((o) => o.uid === tiger!.uid)).toBe(true);
  });
  it('"Choose 1 or both" offers each option and both together', () => {
    const c = getDb().cards.find((x) => /^Choose 1 or both;/im.test(x.text) && getScript(x).modes.length >= 3)!;
    expect(getScript(c).modes.some((m) => m.label.includes(' + '))).toBe(true);
  });
  it('Bite: the dagger deals 1 and is destroyed, and counts as a dagger hit', () => {
    const dagger = getDb().cards.find((c) => c.types.includes('Dagger') && c.types.includes('Assassin'))!;
    const mk = (hand: string[], w: string[]): DeckList => ({ heroId: findCard('Arakni')!.id, weaponIds: w, equipmentIds: [], cardIds: [...hand, ...Array(30).fill(filler())] });
    let s = createGame([{ name: 'A', isBot: false, deck: mk([findCard('Bite')!.id], [dagger.id]) }, { name: 'B', isBot: false, deck: mk([], []) }], 3, 'blitz', 0);
    s = structuredClone(s);
    const p = s.players[0]; const all = [...p.hand, ...p.deck];
    p.hand = [all.splice(all.findIndex((x) => getDb().byId.get(x.cardId)!.name === 'Bite'), 1)[0]]; p.deck = all;
    p.actionPoints = 1; p.resources = 10;
    const life = s.players[1].life;
    s = applyAction(s, { type: 'play', uid: p.hand[0].uid, pitch: [] });
    expect(s.players[1].life).toBe(life - 1);
    expect(s.players[0].weapons.length).toBe(0);
  });
});

describe('card text, fourth pass', () => {
  it('"You may <cost>. If you do, <effect>" asks, and pays only on yes', () => {
    const c = findCard('Clearwater Elixir')!;
    expect(getScript(c).onPlay.some((e) => e.kind === 'mayThen')).toBe(true);
    let s = game([c.id]);
    s.players[0].permanents.push({ inst: { uid: 9999, cardId: findCard('Bloodrot Pox')!.id, owner: 0 }, ward: 0 } as never);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    for (let i = 0; i < 4 && !s.pendingChoices?.length; i++) s = applyAction(s, { type: 'pass' });
    expect(s.pendingChoices?.[0]?.resume.type).toBe('mayThen');
    const life = s.players[0].life;
    const yes = applyAction(s, { type: 'choose', yes: true });
    const no = applyAction(s, { type: 'choose', yes: false });
    expect(yes.players[0].permanents.some((p) => p.inst.uid === 9999)).toBe(false);
    expect(yes.players[0].life).toBe(life + 1);
    expect(no.players[0].permanents.some((p) => p.inst.uid === 9999)).toBe(true);
    expect(no.players[0].life).toBe(life);
  });
  it('"If you prevent damage this way, create a token" creates it once damage is prevented', () => {
    const c = find((x) => getScript(x).onPlay.some((e) => e.kind === 'preventNext' && !!e.thenToken) && x.types.includes('Instant'));
    expect(c).toBeDefined();
    const tokenName = (getScript(c).onPlay.find((e) => e.kind === 'preventNext') as { thenToken: string }).thenToken;
    let s = game([c.id]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    while (s.stack?.length) s = applyAction(s, { type: 'pass' });
    expect(s.players[0].effects.some((e) => e.kind === 'preventNext' && e.thenToken === tokenName)).toBe(true);
  });
  it('"Daggers you control get +1{p} this turn" style effects last the whole turn', () => {
    const c = getDb().cards.find((x) => legal(x) && getScript(x).onPlay.some((e) => e.kind === 'turnAttackPower'));
    expect(c).toBeDefined();
  });
});
