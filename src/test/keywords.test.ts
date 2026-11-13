import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import { applyAction, currentLink, linkPower } from '../engine/game';
import { getScript } from '../engine/cardScript';
import type { GameState } from '../engine/types';
import { buildPuzzle } from '../learn/puzzleEngine';

const id = (name: string, pitch?: number) => getDb().cards.find((c) => c.name === name && (pitch === undefined || c.pitch === pitch))!.id;
const named = (name: string) => getDb().cards.find((c) => c.name === name)!;

function setup(myHand: string[], oppHand: string[] = []): GameState {
  const s = buildPuzzle({
    id: 't', title: 't', text: '',
    me: { hero: findCard('Bravo')!.id, hand: myHand },
    opp: { hero: findCard('Dorinthea')!.id, life: 20, hand: oppHand },
  });
  s.players[0].resources = 10;
  return s;
}
/** put a card with this id on top of a player's deck */
function onTop(s: GameState, p: 0 | 1, cardId: string) {
  s.players[p].deck.unshift({ uid: 9000 + s.players[p].deck.length + p * 500, cardId, owner: p } as GameState['players'][0]['deck'][0]);
}

describe('more keywords', () => {
  it('"instead" upgrades replace the base effect when the condition holds', () => {
    let s = setup([id('Arcane Polarity', 1)]);
    const life = s.players[0].life;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.players[0].life).toBe(life + 1);
    let t = setup([id('Arcane Polarity', 1)]);
    t.players[0].turn.arcaneTaken = true;
    const l2 = t.players[0].life;
    t = applyAction(t, { type: 'play', uid: t.players[0].hand[0].uid, pitch: [] });
    expect(t.players[0].life).toBe(l2 + 4);
  });

  it('clash: the higher top card wins and its hero creates the token', () => {
    let s = setup([id('Bare Fangs', 1)], [id('Clash of Agility', 1)]);
    onTop(s, 0, id('Lava Burst', 1)); // 2 power, drawn by Bare Fangs
    onTop(s, 0, id('Lava Burst', 1));
    onTop(s, 1, id('Bare Fangs', 1)); // 6 power
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.phase).toBe('defend');
    s = applyAction(s, { type: 'defend', uids: [s.players[1].hand[0].uid] });
    expect(s.log.some((l) => l.text.startsWith('Clash!'))).toBe(true);
    expect(s.players[1].permanents.some((pm) => getDb().byId.get(pm.inst.cardId)!.name === 'Agility')).toBe(true);
    expect(s.players[1].turn.clashesWon).toBe(1);
  });

  it('draw then discard at random, with a bonus for discarding a big card', () => {
    let s = setup([id('Bare Fangs', 1), id('Bare Fangs', 1)]);
    onTop(s, 0, id('Bare Fangs', 1));
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    // every card in hand has 6 power, so whichever is discarded triggers the bonus
    expect(s.players[0].graveyard.length).toBe(1);
    expect(linkPower(currentLink(s)!)).toBe(6 + 2);
  });

  it('reload puts a card from hand into an empty arsenal', () => {
    let s = setup([id('Over Flex', 1), id('Lava Burst', 1)]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.players[0].arsenal.length).toBe(1);
    expect(s.players[0].hand.length).toBe(0);
  });

  it('parses rupture, charge conditions and start-of-turn auras', () => {
    expect(getScript(named('Lava Burst')).conditional[0].cond).toEqual({ kind: 'chainLinkAtLeast', n: 4 });
    expect(getScript(named('Battlefield Blitz')).conditional[0].cond).toEqual({ kind: 'charged' });
    const b = getScript(named('Blessing of Patience'));
    expect(b.destroyAt).toBe('startOfTurn');
    expect(b.onDestroy).toEqual([{ kind: 'gainLife', amount: 3 }]);
    expect(getScript(named('Clash of Agility')).coverage).toBe('full');
    expect(getScript(named('Bear Hug')).playIf).toEqual({ kind: 'pitchPower', n: 6 });
    expect(getScript(named('Comet Collision')).conditional.some((x) => x.when === 'instead')).toBe(true);
    expect(getScript(named('Endless Maw')).conditional.some((x) => x.when === 'additional' && x.threshold === 6)).toBe(true);
    expect(getScript(named('Cadaverous Tilling')).optional?.cost).toEqual({ kind: 'decompose', earth: 2 });
    expect(getScript(named('Deadwood Dirge')).coverage).toBe('full');
  });
});

describe('more heroes', () => {
  it('Hala sharpens her sword; Levia skips blood debt after banishing a big card', async () => {
    const { getHeroAbility } = await import('../engine/heroes');
    expect(getHeroAbility(named('Hala, Bladesaint of the Vow'))?.id).toBe('hala');
    const levia = getHeroAbility(named('Levia, Shadowborn Abomination'))!;
    const p = { banished: [] as { cardId: string; uid: number; owner: 0 }[], turn: { flags: { banStart: 0 } } } as unknown as GameState['players'][0];
    expect(levia.skipBloodDebt!({ p } as never)).toBe(false);
    p.banished.push({ cardId: id('Bare Fangs', 1), uid: 1, owner: 0 });
    expect(levia.skipBloodDebt!({ p } as never)).toBe(true);
  });
});
