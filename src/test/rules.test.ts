// Rules scenarios: each test plays out a small situation and checks the engine resolves it the way the
// comprehensive rules say it should.
import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import { applyAction, checkDefense, equipDefense } from '../engine/game';
import type { GameState } from '../engine/types';
import { buildPuzzle } from '../learn/puzzleEngine';

const id = (name: string, pitch?: number) => getDb().cards.find((c) => c.name === name && (pitch === undefined || c.pitch === pitch))!.id;
const nameOf = (cardId: string) => getDb().byId.get(cardId)!.name;

function setup(myHand: string[], oppHand: string[] = [], oppEquipment: string[] = []): GameState {
  const s = buildPuzzle({
    id: 't', title: 't', text: '',
    me: { hero: findCard('Bravo')!.id, hand: myHand },
    opp: { hero: findCard('Dorinthea')!.id, life: 20, hand: oppHand, equipment: oppEquipment },
  });
  s.players[0].resources = 10;
  return s;
}
const play = (s: GameState, i = 0) => applyAction(s, { type: 'play', uid: s.players[0].hand[i].uid, pitch: [] });
/** both players pass priority in the reaction step, so the chain link resolves */
const resolveLink = (s: GameState) => applyAction(applyAction(s, { type: 'pass' }), { type: 'pass' });

describe('rules scenarios', () => {
  it('go again: a card with go again gives back the action point it used', () => {
    const s = play(setup([id('Over Flex', 1)]));
    expect(s.players[0].actionPoints).toBe(1);
  });

  it('without go again, an attack uses up your action point', () => {
    let s = play(setup([id('Wounding Blow', 1)]));
    s = applyAction(s, { type: 'defend', uids: [] });
    s = resolveLink(s);
    expect(s.players[0].actionPoints).toBe(0);
    expect(s.players[1].life).toBe(16);
  });

  it('dominate: the attack can be defended by at most one card from hand', () => {
    const s = play(setup([id('Macho Grande', 1)], [id('Wounding Blow', 1), id('Wounding Blow', 2)]));
    const [a, b] = s.players[1].hand.map((h) => h.uid);
    expect(checkDefense(s, [a, b])).toBeTruthy();
    expect(checkDefense(s, [a])).toBeNull();
  });

  it('blade break: equipment that defends is destroyed when the chain link resolves', () => {
    let s = play(setup([id('Wounding Blow', 1)], [], [id('Ironrot Helm')]));
    s = applyAction(s, { type: 'defend', uids: [s.players[1].equipment[0].inst.uid] });
    s = resolveLink(s);
    expect(s.players[1].life).toBe(17); // 4 power - 1 defense
    expect(s.players[1].equipment[0].destroyed).toBe(true);
  });

  it('temper: equipment loses 1 defense each time it defends, and is destroyed at 0', () => {
    let s = play(setup([id('Wounding Blow', 1)], [], [id('Helm of the Arknight')]));
    s = applyAction(s, { type: 'defend', uids: [s.players[1].equipment[0].inst.uid] });
    s = resolveLink(s);
    const helm = s.players[1].equipment[0];
    expect(helm.destroyed).toBeFalsy();
    expect(equipDefense(helm)).toBe(1);
  });

  it('arcane barrier: the defender may pay resources to prevent arcane damage', () => {
    let s = setup([id('Aether Dart', 1)], [], [id('Arcane Lantern')]);
    s.players[1].resources = 1;
    s = play(s);
    expect(s.players[1].life).toBe(18); // 3 arcane, 1 prevented by paying 1
    expect(s.players[1].resources).toBe(0);
  });

  it('intimidate: a random card from the defending hero’s hand is banished until end of turn', () => {
    const s = play(setup([id('Pack Hunt', 1)], [id('Wounding Blow', 1), id('Wounding Blow', 2)]));
    expect(s.players[1].hand.length).toBe(1);
    expect(s.players[1].intimidated.length).toBe(1);
  });

  it('the combat chain closes when the turn player passes, and attack cards go to the graveyard', () => {
    let s = play(setup([id('Wounding Blow', 1)]));
    s = applyAction(s, { type: 'defend', uids: [] });
    s = resolveLink(s);
    expect(s.chain.length).toBe(1);
    s = applyAction(s, { type: 'pass' });
    expect(s.chain.length).toBe(0);
    expect(s.players[0].graveyard.map((g) => nameOf(g.cardId))).toContain('Wounding Blow');
  });

  it('you choose the order of your own start-of-turn triggers', () => {
    let s = setup([]);
    const tok = (name: string, uid: number) => ({ inst: { uid, cardId: findCard(name)!.id, owner: 0 as const }, ward: 0 });
    s.players[0].permanents.push(tok('Might', 7001), tok('Vigor', 7002));
    s.turnPlayer = 1;
    s.priority = 1;
    s = applyAction(s, { type: 'pass' }); // the opponent ends their turn; mine starts
    expect(s.turnPlayer).toBe(0);
    expect(s.pendingTriggers?.uids.length).toBe(2);
    expect(() => applyAction(s, { type: 'pass' })).toThrow();
    const order = [...s.pendingTriggers!.uids].reverse();
    s = applyAction(s, { type: 'orderTriggers', order });
    expect(s.pendingTriggers).toBeUndefined();
    expect(s.players[0].permanents.length).toBe(0);
    expect(s.players[0].resources).toBe(1); // Vigor
    expect(s.players[0].effects.some((e) => e.kind === 'nextAttackPower')).toBe(true); // Might
  });
});
