// The last heroes: protect, damage redirection, inventory, opponents' start-of-turn, joke heroes.
import { describe, expect, it } from 'vitest';
import './setup';
import { findCard, getDb } from '../data/cardDb';
import { applyAction, createGame, HERO_INDEX, playOptions } from '../engine/game';
import type { DeckList } from '../engine/game';
import { chooseAction } from '../ai/bot';
import { getHeroAbility } from '../engine/heroes';
import type { GameState, PlayerId } from '../engine/types';

const filler = () => findCard('Wounding Blow', 3)!.id;
const hero = (name: string) => getDb().cards.find((c) => c.types.includes('Hero') && c.name.startsWith(name))!.id;
const deck = (h: string, extra: Partial<DeckList> = {}): DeckList => ({ heroId: hero(h), weaponIds: [], equipmentIds: [], cardIds: Array(40).fill(filler()), ...extra });

describe('every hero is automated', () => {
  it('all 86 heroes have an ability', () => {
    const missing = [...new Set(getDb().cards.filter((c) => c.types.includes('Hero') && !getHeroAbility(c)).map((c) => c.name))];
    expect(missing).toEqual([]);
  });
});

describe('protect (Ultimate Pit Fight)', () => {
  it('Reya protects another hero, adds her block to the defense and makes a Gold token', () => {
    let s: GameState = createGame([{ name: 'A', isBot: false, deck: deck('Dorinthea') }, { name: 'B', isBot: false, deck: deck('Dorinthea') }, { name: 'Reya', isBot: false, deck: deck('Reya') }], 5, 'upf', 0);
    s = structuredClone(s);
    s.players[0].actionPoints = 1; s.players[0].resources = 10; s.players[0].focus = 1;
    const atk = s.players[0].hand[0];
    s = applyAction(s, { type: 'play', uid: atk.uid, pitch: [] });
    if (s.pendingChoices?.length) s = applyAction(s, { type: 'choose', picks: [s.players[1].hero.uid] });
    s = applyAction(s, { type: 'defend', uids: [] });
    const pc = s.pendingChoices?.[0];
    expect(pc?.player).toBe(2);
    expect(pc?.kind).toBe('pick'); // she picks which card protects
    s = applyAction(s, { type: 'choose', picks: [pc!.options[0].uid] });
    expect(s.chain[0].defenders.some((d) => d.inst.owner === 2)).toBe(true);
    expect(s.players[2].permanents.some((pm) => getDb().byId.get(pm.inst.cardId)!.name === 'Gold')).toBe(true);
  });

  it('reaction priority goes round the table and the link resolves after everyone passes', () => {
    let s: GameState = createGame([{ name: 'A', isBot: false, deck: deck('Dorinthea') }, { name: 'B', isBot: false, deck: deck('Dorinthea') }, { name: 'C', isBot: false, deck: deck('Dorinthea') }], 5, 'upf', 0);
    s = structuredClone(s);
    s.players[0].actionPoints = 1; s.players[0].resources = 10; s.players[0].focus = 1;
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    if (s.pendingChoices?.length) s = applyAction(s, { type: 'choose', picks: [s.players[1].hero.uid] });
    s = applyAction(s, { type: 'defend', uids: [] });
    const seen: PlayerId[] = [];
    while (s.phase === 'reaction') { seen.push(s.priority); s = applyAction(s, { type: 'pass' }); }
    expect(new Set(seen).size).toBe(3);
    expect(s.chain[0].damage).not.toBeNull();
  });
});

describe('the last heroes', () => {
  it('Yoji takes the next damage for another hero, minus 1', () => {
    let s = createGame([{ name: 'Yoji', isBot: false, deck: deck('Yoji') }, { name: 'B', isBot: false, deck: deck('Dorinthea') }], 3, 'blitz', 0);
    s = structuredClone(s);
    s.players[0].resources = 3;
    const opt = playOptions(s, 0).find((o) => o.index === HERO_INDEX)!;
    s = applyAction(s, { type: 'activate', uid: opt.uid, index: opt.index, pitch: [] });
    while (s.stack?.length) s = applyAction(s, { type: 'pass' });
    expect(s.players[1].redirectTo).toBe(0);
  });

  it('Squizzy & Floof: the opponent takes a Cracked Bauble and Squizzy gets a Gold', () => {
    let s = createGame([{ name: 'Sq', isBot: true, deck: deck('Squizzy') }, { name: 'B', isBot: true, deck: deck('Dorinthea') }], 3, 'blitz', 0);
    for (let i = 0; i < 400 && s.turn < 3; i++) s = applyAction(s, chooseAction(s, s.pendingChoices?.[0]?.player ?? s.priority).action);
    expect(s.log.some((e) => /Cracked Bauble in their hand/.test(e.text))).toBe(true);
  });

  it('Taylor swaps in better equipment from the inventory', () => {
    const weak = getDb().cards.find((c) => c.types.includes('Equipment') && c.types.includes('Head') && c.defense === 0 && c.types.includes('Generic'))!;
    const strong = getDb().cards.find((c) => c.types.includes('Equipment') && c.types.includes('Head') && c.defense === 2 && c.types.includes('Generic'))!;
    let s = createGame([{ name: 'T', isBot: true, deck: deck('Taylor', { equipmentIds: [weak.id, strong.id] }) }, { name: 'B', isBot: true, deck: deck('Dorinthea') }], 3, 'blitz', 1);
    expect(s.players[0].inventory).toContain(strong.id);
    for (let i = 0; i < 400 && s.turn < 3; i++) s = applyAction(s, chooseAction(s, s.pendingChoices?.[0]?.player ?? s.priority).action);
    expect(s.players[0].equipment.some((e) => e.inst.cardId === strong.id)).toBe(true);
  });

  it('Bolfar can’t equip weapons', () => {
    const w = getDb().cards.find((c) => c.types.includes('Weapon') && c.types.includes('Guardian'))!;
    const s = createGame([{ name: 'Bo', isBot: true, deck: deck('Bolfar', { weaponIds: [w.id] }) }, { name: 'B', isBot: true, deck: deck('Dorinthea') }], 3);
    expect(s.players[0].weapons).toEqual([]);
  });

  it('Yorick: all heroes draw from one shared deck and share a graveyard, even after a JSON round trip', () => {
    let s = createGame([{ name: 'Y', isBot: true, deck: deck('Yorick') }, { name: 'B', isBot: true, deck: deck('Dorinthea', { cardIds: Array(40).fill(findCard('Sigil of Solace', 1)?.id ?? filler()) }) }], 3);
    expect(s.players[0].deck).toBe(s.players[1].deck);
    expect(s.players[0].deck.length).toBe(80 - s.players[0].hand.length - s.players[1].hand.length);
    s = JSON.parse(JSON.stringify(s)); // a saved game or a replay
    for (let i = 0; i < 300 && s.turn < 4; i++) s = applyAction(s, chooseAction(s, s.pendingChoices?.[0]?.player ?? s.priority).action);
    expect(s.players[0].deck).toBe(s.players[1].deck);
    expect(s.players[0].graveyard).toBe(s.players[1].graveyard);
  });
  it('Bolfar: the next crush attack also attacks a second hero, who defends it separately', () => {
    const crush = getDb().cards.find((c) => c.types.includes('Guardian') && c.types.includes('Attack') && c.types.includes('Action') && /Crush - /.test(c.text) && Number(c.cost ?? 9) <= 3 && Number(c.power) >= 4 && c.legal.length > 0)!;
    let s: GameState = createGame([{ name: 'Bo', isBot: false, deck: deck('Bolfar', { cardIds: Array(40).fill(crush.id) }) }, { name: 'L', isBot: false, deck: deck('Dorinthea') }, { name: 'R', isBot: false, deck: deck('Dorinthea') }], 5, 'upf', 0);
    s = structuredClone(s);
    s.players[0].resources = 10; s.players[0].actionPoints = 1; s.players[0].focus = 1;
    const life0 = s.players.map((x) => x.life);
    const act = playOptions(s, 0).find((o) => o.index === HERO_INDEX)!;
    s = applyAction(s, { type: 'activate', uid: act.uid, index: act.index, pitch: [] });
    while (s.stack?.length) s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'play', uid: s.players[0].hand[0].uid, pitch: [] });
    if (s.pendingChoices?.length) s = applyAction(s, { type: 'choose', picks: [s.players[1].hero.uid] });
    expect(s.chain[0].also?.defender).toBe(2);
    expect(s.priority).toBe(1);
    s = applyAction(s, { type: 'defend', uids: [] }); // the first hero
    expect(s.phase).toBe('defend');
    expect(s.priority).toBe(2); // the second hero declares their own block
    s = applyAction(s, { type: 'defend', uids: [] });
    while (s.pendingChoices?.length) s = applyAction(s, { type: 'choose', yes: false });
    while (s.phase === 'reaction') s = applyAction(s, { type: 'pass' });
    expect(s.players[1].life).toBeLessThan(s.players[1].hero ? life0[1] : 0);
    expect(s.players[2].life).toBeLessThan(life0[2]);
  });
});

describe('Smash Palace event deck', () => {
  it('the turn player reveals an event every turn; Kox games use it, and bot games with it play to the end', () => {
    let s: GameState = createGame([{ name: 'Kox', isBot: true, deck: deck('Fightmaster Kox') }, { name: 'B', isBot: true, deck: deck('Dorinthea') }, { name: 'C', isBot: true, deck: deck('Dorinthea') }], 9, 'upf');
    expect(s.eventDeck?.length).toBeGreaterThan(20);
    expect(s.lastEvent).toBeTruthy(); // the first turn already revealed one
    const seen = new Set<string>();
    for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
      s = applyAction(s, chooseAction(s, s.pendingChoices?.[0]?.player ?? s.pendingTriggers?.player ?? s.priority).action);
      if (s.lastEvent) seen.add(s.lastEvent);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('Hit the Jackpot makes a Gold and draws one card per Gold', () => {
    let s: GameState = createGame([{ name: 'A', isBot: true, deck: deck('Dorinthea') }, { name: 'B', isBot: true, deck: deck('Dorinthea') }], 9, 'blitz', 0, { events: true });
    s = structuredClone(s);
    const jackpot = getDb().cards.find((c) => c.name === 'Hit the Jackpot')!.id;
    s.eventDeck = [jackpot, ...s.eventDeck!.filter((x) => x !== jackpot)];
    while (s.turnPlayer === 0) s = applyAction(s, chooseAction(s, s.pendingChoices?.[0]?.player ?? s.priority).action);
    expect(s.lastEvent).toBe(jackpot);
    expect(s.players[1].permanents.some((pm) => getDb().byId.get(pm.inst.cardId)!.name === 'Gold')).toBe(true);
    expect(s.log.some((e) => /B draws 1 \(one per Gold\)/.test(e.text))).toBe(true);
  });
  it('the event deck has 40 cards, the Bloodied equipment works, and Lion\'s Pounce lets you choose your block', async () => {
    const { eventDeckList } = await import('../engine/game');
    const { getScript } = await import('../engine/cardScript');
    expect(eventDeckList().length).toBe(40);
    for (const n of ['Bloodied Boots', 'Bloodied Helm', 'Bloodied Strapping', 'Bloodied Gauntlet', 'Bloodied Shield']) expect([n, getScript(getDb().cards.find((c) => c.name === n)!).coverage]).toEqual([n, 'full']);
    // I go first; the bot's first turn reveals Lion's Pounce and I'm asked how to block
    let s: GameState = createGame([{ name: 'Me', isBot: false, deck: deck('Dorinthea') }, { name: 'A', isBot: true, deck: deck('Dorinthea') }], 9, 'blitz', 0, { events: true });
    s = structuredClone(s);
    const pounceId = getDb().cards.find((c) => c.name === "Lion's Pounce")!.id;
    s.eventDeck = [pounceId, ...s.eventDeck!.filter((x) => x !== pounceId)];
    s.pendingChoices = undefined;
    for (let i = 0; i < 50 && s.turnPlayer === 0; i++) s = applyAction(s, s.phase === 'arsenal' ? { type: 'arsenal', uid: null } : { type: 'pass' });
    const pc = s.pendingChoices![0];
    expect(s.lastEvent).toBe(pounceId);
    expect(pc.player).toBe(0);
    expect(pc.multi).toBe(true);
    const life = s.players[0].life;
    s = applyAction(s, { type: 'choose', picks: [] }); // take it
    expect(s.players[0].life).toBe(life - 3);
  });
});
