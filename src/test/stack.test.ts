import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import { applyAction } from '../engine/game';
import type { GameState } from '../engine/types';
import { buildPuzzle } from '../learn/puzzleEngine';

const id = (name: string, pitch?: number) => getDb().cards.find((c) => c.name === name && (pitch === undefined || c.pitch === pitch))!.id;

function setup(oppHand: string[]): GameState {
  return buildPuzzle({
    id: 't', title: 't', text: '',
    me: { hero: findCard('Bravo')!.id, hand: [id('Conflicting Thoughts', 1), id('Sigil of Solace', 1)] },
    opp: { hero: findCard('Dorinthea')!.id, life: 20, hand: oppHand },
  });
}

describe('the stack and priority', () => {
  it('a card waits on the stack while the opponent can respond, and resolves after both pass', () => {
    let s = setup([id('Sigil of Solace', 1)]);
    const attack = s.players[0].hand[0];
    s = applyAction(s, { type: 'play', uid: attack.uid, pitch: [] });
    // the opponent holds an instant, so they get the chance to respond
    expect(s.stack?.length).toBe(1);
    expect(s.priority).toBe(1);
    expect(s.chain.length).toBe(0);
    // they respond: their instant goes on top and resolves first
    const sigil = s.players[1].hand[0];
    s = applyAction(s, { type: 'play', uid: sigil.uid, pitch: [] });
    expect(s.stack?.length).toBe(2);
    expect(s.priority).toBe(0);
    const life = s.players[1].life;
    s = applyAction(s, { type: 'pass' }); // I let their instant resolve
    expect(s.players[1].life).toBe(life + 3);
    // my attack is still waiting; I could respond with my own instant now, but I pass and so does the opponent
    expect(s.stack?.length).toBe(1);
    expect(s.priority).toBe(0);
    s = applyAction(s, { type: 'pass' });
    // the opponent has nothing left to respond with, so it resolves straight away: the attack starts
    expect(s.stack).toBeUndefined();
    expect(s.chain.length).toBe(1);
    expect(s.phase).toBe('defend');
  });

  it('with nothing to respond with, cards resolve immediately', () => {
    let s = setup([]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.stack).toBeUndefined();
    expect(s.chain.length).toBe(1);
  });

  it('only instants can be played while something is on the stack', () => {
    let s = setup([id('Sigil of Solace', 1)]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    s = applyAction(s, { type: 'play', uid: s.players[1].hand[0].uid, pitch: [] });
    // my turn to respond: my Sigil (instant) is fine
    expect(() => applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] })).not.toThrow();
  });

  it('pitched cards go to the bottom of the deck in the chosen order', () => {
    let s = buildPuzzle({
      id: 't', title: 't', text: '',
      me: { hero: findCard('Bravo')!.id, hand: [id('Conflicting Thoughts', 1), id('Sigil of Solace', 3), id('Sigil of Solace', 2), id('Sigil of Solace', 1)] },
      opp: { hero: findCard('Dorinthea')!.id, life: 20 },
    });
    const [, b, y] = s.players[0].hand;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[3].uid, pitch: [] }); // Sigil (0 cost)
    s.players[0].resources = 0;
    // pitch two cards by playing something that costs 3+: easier to put them in the pitch zone directly
    s.players[0].pitch.push(b, y);
    s.players[0].hand = s.players[0].hand.filter((h) => h.uid !== b.uid && h.uid !== y.uid);
    s = applyAction(s, { type: 'pass', pitchOrder: [y.uid, b.uid] });
    if (s.phase === 'arsenal') s = applyAction(s, { type: 'arsenal', uid: null });
    const me = s.players[0];
    expect(me.deck.slice(-2).map((c) => c.uid)).toEqual([y.uid, b.uid]); // the end of the deck array is the bottom
  });
});
