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
    // you choose which card to reload
    expect(s.pendingChoices?.[0].kind).toBe('reload');
    s = applyAction(s, { type: 'choose', picks: [s.players[0].hand[0].uid] });
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

describe('choices, wagers and the crowd', () => {
  it('opt: you choose which cards stay on top and in what order', () => {
    let s = setup([id('Blood Tribute', 1)]);
    const top3 = s.players[0].deck.slice(0, 3).map((d) => d.uid);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.pendingChoices?.[0].kind).toBe('opt');
    expect(() => applyAction(s, { type: 'pass' })).toThrow();
    s = applyAction(s, { type: 'choose', picks: [top3[2], top3[0]] });
    // the two kept are on top in the chosen order (Blood Tribute then banishes the new top card)
    expect(s.players[0].banished.at(-1)!.uid).toBe(top3[2]);
    expect(s.players[0].deck[0].uid).toBe(top3[0]);
    expect(s.players[0].deck.at(-1)!.uid).toBe(top3[1]);
  });

  it('wager: the attacker wins if the attack hits, otherwise the defender', () => {
    for (const block of [false, true]) {
      let s = setup([id('Wage Gold', 1)], [id('Wounding Blow', 1), id('Wounding Blow', 1), id('Wounding Blow', 1)]);
      s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
      expect(s.pendingChoices?.[0].kind).toBe('yesno');
      s = applyAction(s, { type: 'choose', yes: true });
      s = applyAction(s, { type: 'defend', uids: block ? s.players[1].hand.map((h) => h.uid) : [] });
      s = applyAction(applyAction(s, { type: 'pass' }), { type: 'pass' });
      const gold = (p: 0 | 1) => s.players[p].permanents.filter((pm) => getDb().byId.get(pm.inst.cardId)!.name === 'Gold').length;
      expect([gold(0), gold(1)]).toEqual(block ? [0, 1] : [1, 0]);
    }
  });

  it('the crowd cheers you, and "if you\'ve been cheered" sees it', () => {
    let s = setup([id('Jaws of Victory', 1)]);
    s.players[0].life = 10; // less life than the opponent
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    expect(s.players[0].turn.cheers).toBe(1);
    expect(s.chain.at(-1)!.goAgain).toBe(true);
  });

  it('parses wager grants, winner effects and crowd triggers', () => {
    expect(getScript(named('Big Slick')).coverage).toBe('full');
    expect(getScript(named('Big Blinder')).coverage).toBe('full');
    expect(getScript(named('Money Where Ya Mouth Is')).coverage).toBe('full');
    expect(getScript(named('Bet Big')).onAttack[0]).toEqual({ kind: 'wager', tokens: ['Gold', 'Might', 'Vigor'], optional: true });
  });
});

describe('more keywords (rules 8.3)', () => {
  it('parses heave, quell, suspense, fragment, rune gate, watery grave, scrap, beat chest, guardwell, mirage, evo', () => {
    expect(getScript(named('Overswing')).heave).toBe(2);
    expect(getScript(named('mBrio Base Walkers')).quell).toBe(1);
    expect(getScript(named('Act of Glory')).suspense).toBe(true);
    expect(getScript(named('Clear Conscience')).fragment).toBe(true);
    expect(getScript(named('Deathly Delight')).runeGate).toBe(true);
    expect(getScript(named('Hydraulic Press')).optional?.cost).toEqual({ kind: 'banishGraveMatch', types: ['Item', 'Equipment'] });
    expect(getScript(named('Bare Swing')).optional?.cost).toEqual({ kind: 'discard', power: 6 });
    expect(getScript(named('Balance of Justice')).guardwell).toBe(true);
    expect(getScript(named('Flicker Trick')).mirage).toBe(true);
    expect(getScript(named('Evo Battery Pack')).evoSlot).toBe('Chest');
    expect(getScript(named('Falcon Wing')).conditional[0].cond).toEqual({ kind: 'hasAim' });
  });

  it('fragment: each defending card with 2+ defense takes 2 power off the attack', () => {
    let s = setup([id('Clear Conscience', 1)], [id('Wounding Blow', 1), id('Wounding Blow', 1)]);
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    const base = linkPower(currentLink(s)!);
    s = applyAction(s, { type: 'defend', uids: s.players[1].hand.map((h) => h.uid) });
    expect(linkPower(currentLink(s)!)).toBe(base - 4);
  });

  it('heave: pay at the end of your turn to put the card face-up into your arsenal and get Seismic Surge tokens', async () => {
    const { heaveOptions } = await import('../engine/game');
    let s = setup([id('Overswing', 1), id('Wounding Blow', 3)]);
    s.players[0].resources = 0;
    s = applyAction(s, { type: 'pass' }); // end the action phase
    expect(s.phase).toBe('arsenal');
    const opt = heaveOptions(s, 0)[0];
    expect(opt.cost).toBe(2);
    s = applyAction(s, { type: 'heave', uid: opt.uid, pitch: [s.players[0].hand.find((h) => h.uid !== opt.uid)!.uid] });
    expect(s.players[0].arsenal.map((a) => getDb().byId.get(a.cardId)!.name)).toEqual(['Overswing']);
    expect(s.players[0].permanents.filter((pm) => getDb().byId.get(pm.inst.cardId)!.name === 'Seismic Surge').length).toBe(2);
  });
});
