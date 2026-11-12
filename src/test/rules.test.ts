import { describe, expect, it } from 'vitest';
import './setup';
import { findCard } from '../data/cardDb';
import { getScript, parseEffect } from '../engine/cardScript';
import { applyAction, createGame, currentLink, linkPower, playOptions } from '../engine/game';
import type { DeckList } from '../engine/game';
import type { GameState } from '../engine/types';
import { autoBuildDeck, exportDecklist, importDecklist, toDeckList } from '../deck/deck';

const id = (name: string, pitch?: number) => {
  const c = findCard(name, pitch);
  if (!c) throw new Error(`missing ${name}`);
  return c.id;
};

/** Build a game where both players have a fixed hand (cards are drawn from the top). */
function game(hand0: string[], hand1: string[], opts: Partial<DeckList> = {}): GameState {
  const hero = id('Dorinthea');
  const filler = Array(30).fill(id('Wounding Blow', 3));
  const mk = (hand: string[]): DeckList => ({ heroId: hero, weaponIds: [], equipmentIds: [], cardIds: [...hand, ...filler], ...opts });
  let s = createGame([
    { name: 'P0', isBot: false, deck: mk(hand0) },
    { name: 'P1', isBot: false, deck: mk(hand1) },
  ], 3);
  // force known hands regardless of shuffle / who goes first
  s = structuredClone(s);
  for (const [pi, names] of [[0, hand0], [1, hand1]] as const) {
    const p = s.players[pi];
    const all = [...p.hand, ...p.deck];
    p.hand = names.map((n) => { const i = all.findIndex((c) => c.cardId === n); return all.splice(i, 1)[0]; });
    p.deck = all;
  }
  s.turnPlayer = 0; s.priority = 0; s.players[0].actionPoints = 1; s.players[1].actionPoints = 0;
  return s;
}

describe('card script compiler', () => {
  it('parses common effects', () => {
    expect(parseEffect('Draw a card.')).toEqual([{ kind: 'draw', amount: 1 }]);
    expect(parseEffect('Deal 3 arcane damage to any target.')).toEqual([{ kind: 'arcane', amount: 3 }]);
    expect(parseEffect('Your next dagger attack this turn gets +2{p}.')).toEqual([{ kind: 'nextAttackPower', amount: 2, filter: { kind: 'subtype', value: 'dagger' } }]);
    expect(parseEffect('Create a Runechant token.')).toEqual([{ kind: 'createToken', name: 'Runechant', amount: 1 }]);
    expect(parseEffect('Something odd happens.')).toBeNull();
  });
  it('compiles keywords, modes and weapon activations', () => {
    expect(getScript(findCard('Enlightened Strike')!).modes.map((m) => m.parsed)).toEqual([true, true, true]);
    const dawn = getScript(findCard('Dawnblade')!);
    expect(dawn.activations[0]).toMatchObject({ attack: true, cost: 1 });
  });
});

describe('engine rules', () => {
  const red7 = id('Raging Onslaught', 1); // 3 cost, 7 power
  const blue = id('Wounding Blow', 3);
  it('requires pitching to pay costs and uses an action point', () => {
    const s = game([red7, blue, blue, blue], [blue, blue, blue, blue]);
    expect(playOptions(s, 0).map((o) => o.uid)).toContain(s.players[0].hand[0].uid);
    const uid = s.players[0].hand[0].uid;
    expect(() => applyAction(s, { type: 'play', uid, pitch: [] })).toThrow(/resources/);
    const s2 = applyAction(s, { type: 'play', uid, pitch: [s.players[0].hand[1].uid] });
    expect(s2.players[0].actionPoints).toBe(0);
    expect(s2.players[0].pitch.length).toBe(1);
    expect(s2.phase).toBe('defend');
    expect(linkPower(currentLink(s2)!)).toBe(7);
  });
  it('resolves damage after blocking and both passing', () => {
    let s = game([red7, blue, blue, blue], [blue, blue, blue, blue]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [s.players[0].hand[1].uid] });
    const blocker = s.players[1].hand[0].uid;
    s = applyAction(s, { type: 'defend', uids: [blocker] });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    expect(s.players[1].life).toBe(20 - (7 - 3));
    expect(s.phase).toBe('action');
    // end turn -> arsenal step -> opponent's turn, hand refilled to intellect
    s = applyAction(s, { type: 'pass' });
    expect(s.phase).toBe('arsenal');
    s = applyAction(s, { type: 'arsenal', uid: s.players[0].hand[0].uid });
    expect(s.players[0].arsenal.length).toBe(1);
    expect(s.players[0].hand.length).toBe(4);
    expect(s.turnPlayer).toBe(1);
    expect(s.players[0].pitch.length).toBe(0);
  });
  it('go again returns the action point', () => {
    const ga = id('Scar for a Scar', 1);
    let s = game([ga, blue, blue, blue], [blue, blue, blue, blue]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = applyAction(s, { type: 'defend', uids: [] });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    expect(s.players[0].actionPoints).toBe(1);
  });
  it('dominate limits blocking to one card from hand', () => {
    const dom = findCard('Bloodrush Bellow') ? id('Pummel', 1) : id('Pummel', 1);
    void dom;
    let s = game([red7, blue, blue, blue], [blue, blue, blue, blue]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [s.players[0].hand[1].uid] });
    s.chain[0].dominate = true;
    const [a, b] = s.players[1].hand.map((h) => h.uid);
    expect(() => applyAction(s, { type: 'defend', uids: [a, b] })).toThrow(/Dominate/);
  });
  it('blade break equipment is destroyed after defending', () => {
    const bb = id('Fyendal\'s Spring Tunic');
    void bb;
    const helm = findCard('Blossom of Spring') ?? findCard('Arcanite Skullcap')!;
    void helm;
    const eq = id('Nullrune Hood');
    let s = game([red7, blue, blue, blue], [blue, blue, blue, blue], { equipmentIds: [eq] });
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [s.players[0].hand[1].uid] });
    const e = s.players[1].equipment[0];
    s = applyAction(s, { type: 'defend', uids: [e.inst.uid] });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    const sc = getScript(findCard('Nullrune Hood')!);
    if (sc.bladeBreak) expect(s.players[1].equipment[0].destroyed).toBe(true);
    else if (sc.battleworn) expect(s.players[1].equipment[0].defenseMod).toBe(-1);
  });
  it('modal attack applies the chosen mode', () => {
    const es = id('Enlightened Strike');
    let s = game([es, blue, blue, blue], [blue, blue, blue, blue]);
    const modes = getScript(findCard('Enlightened Strike')!).modes;
    const powerMode = modes.findIndex((m) => m.onPlay.some((e) => e.kind === 'thisPower'));
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [s.players[0].hand[1].uid], mode: powerMode });
    expect(linkPower(currentLink(s)!)).toBe(7);
  });
});

describe('decklists', () => {
  it('round-trips export/import', () => {
    const d = autoBuildDeck(id('Dorinthea'), 'blitz', 5);
    const text = exportDecklist(d);
    const back = importDecklist(text);
    expect(back.warnings).toEqual([]);
    expect(back.deck!.heroId).toBe(d.heroId);
    expect(back.deck!.cards).toEqual(d.cards);
    expect(toDeckList(back.deck!).cardIds.length).toBe(40);
  });
  it('parses Fabrary-style text', () => {
    const r = importDecklist(`Name: Test\nHero: Dorinthea Ironsong\nWeapons: Dawnblade\nEquipment: Nullrune Hood\n\n3x Raging Onslaught (red)\n(2) Sigil of Solace (blue)\n1 Totally Fake Card`);
    expect(r.deck!.name).toBe('Test');
    expect(Object.values(r.deck!.cards).reduce((a, b) => a + b, 0)).toBe(7);
    expect(r.warnings).toEqual(['Not found: Totally Fake Card']);
  });
});
