// Flesh and Blood rules engine (core rules). Pure functions: every action returns a new state.
import type { Card } from '../data/types';
import { card, findCard, has, n } from '../data/cardDb';
import { getScript, describeFilter } from './cardScript';
import { getHeroAbility } from './heroes';
import type { HeroApi, HeroCtx } from './heroes';
import type { AttackFilter, Condition, Effect, Mode, OptionalCost } from './cardScript';
import type { Layer, PermanentState } from './types';
import type {
  Action, CardInst, ChainLink, Difficulty, GameState, OptionalChoice, PlayerId, PlayerState, TurnEffect,
} from './types';

export interface DeckList {
  heroId: string;
  weaponIds: string[];
  equipmentIds: string[];
  cardIds: string[];
}

export interface PlayerSetup {
  name: string;
  isBot: boolean;
  difficulty?: Difficulty;
  deck: DeckList;
}

export const MAX_TURNS = 150;

// ---------------------------------------------------------------- helpers

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const cardOf = (i: CardInst): Card => card(i.cardId);

function rand(s: GameState): number {
  // mulberry32
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function log(s: GameState, player: PlayerId | null, text: string, rule?: string) {
  s.log.push({ turn: s.turn, player, text: secondPerson(text), ...(rule ? { rule } : {}) });
}

/** Short rule explanations attached to log lines, so players learn why things happen. */
export const RULES = {
  triggerOrder: 'When several of your effects trigger at the same time, you choose the order they resolve in.',
  stack: 'Cards and abilities go on the stack. Both players may respond with instants; when both pass in a row, the top one resolves (last in, first out).',
  goAgain: 'Go again: when this resolves, you gain an action point, so you can keep acting this turn.',
  dominate: 'Dominate: the attack can’t be defended by more than one card from hand.',
  overpower: 'Overpower: the attack can’t be defended by more than one action card.',
  piercing: 'Piercing: if defended by equipment, the attack gets extra power.',
  intimidate: 'Intimidate: a random card from the defending hero’s hand is banished face down until the end of the turn, so it can’t block.',
  bladeBreak: 'Blade break: if this equipment defends, it is destroyed when the combat chain link resolves.',
  battleworn: 'Battleworn: if this defends, it gets a -1 defense counter afterwards.',
  temper: 'Temper: if this defends, it gets a -1 defense counter; at 0 defense it is destroyed.',
  arcaneBarrier: 'Arcane barrier N: you may pay N resources to prevent N arcane damage.',
  ward: 'Ward N: if you would be dealt damage, destroy this to prevent N of it.',
  pitchOrder: 'At the end of each turn, cards in the pitch zone go to the bottom of their owner’s deck in any order that player chooses.',
  drawUp: 'End phase: the turn player draws up to their intellect.',
  arsenal: 'End phase: you may put a card from your hand face down into your arsenal, to play later.',
  chainClose: 'When the action phase ends or a link without go again resolves and the turn player passes, the combat chain closes and its cards go to the graveyard.',
};

const IRREGULAR: Record<string, string> = { "doesn’t": "don’t", has: 'have', is: 'are', goes: 'go' };
/** "You plays X" -> "You play X" for the human player named "You". */
function secondPerson(text: string): string {
  return text.replace(/\bYou's\b/g, 'your').replace(/\bYou (\S+)/g, (m, verb: string) => {
    if (IRREGULAR[verb]) return `You ${IRREGULAR[verb]}`;
    if (/(ch|sh|ss|x)es$/.test(verb)) return `You ${verb.slice(0, -2)}`;
    if (/[a-z]s$/.test(verb) && !/ss$/.test(verb)) return `You ${verb.slice(0, -1)}`;
    return m;
  });
}

const pname = (s: GameState, p: PlayerId) => s.players[p].name;

function mk(s: GameState, cardId: string, owner: PlayerId): CardInst {
  return { uid: s.nextUid++, cardId, owner };
}

const newTurnInfo = () => ({ attacks: 0, attackActionHits: 0, weaponHits: 0, played: [], drew: false, boosted: false, flags: {} });

function heroApi(s: GameState): HeroApi {
  return {
    log: (p, text) => log(s, p ? p.id : null, text),
    createToken: (p, name, amount) => createToken(s, p, name, amount),
    draw: (p, amount) => { draw(s, p, amount); log(s, p.id, `${p.name} draws ${amount} card${amount > 1 ? 's' : ''}.`); },
    dealDamage: (t, amount, arcane, source) => { dealDamage(s, t.id, amount, arcane, source); },
    startAttack: (p, inst) => startAttack(s, p, inst, false, false),
    mk: (cardId, owner) => mk(s, cardId, owner.id),
    shuffle: (arr) => shuffle(s, arr),
    destroyNamed: (p, name) => {
      const pm = p.permanents.find((x) => cardOf(x.inst).name === name);
      if (!pm) return false;
      removePermanent(s, p, pm.inst.uid);
      return true;
    },
    discard: (p, inst) => {
      if (!removeFrom(p.hand, inst.uid)) return;
      p.graveyard.push(inst);
      noteDiscard(s, p, inst);
      log(s, p.id, `${p.name} discards ${cardOf(inst).name}.`);
    },
    intimidate: (t) => {
      s.players[other(t.id)].turn.intimidated = true;
      if (!t.hand.length) return;
      const d = t.hand.splice(Math.floor(rand(s) * t.hand.length), 1)[0];
      t.intimidated.push(d);
      log(s, t.id, `Intimidate: a random card from ${t.name}'s hand is banished until end of turn.`, RULES.intimidate);
    },
  };
}

export function heroCtx(s: GameState, p: PlayerState): HeroCtx {
  return { s, p, opp: s.players[other(p.id)], api: heroApi(s) };
}

const ability = (p: PlayerState) => getHeroAbility(cardOf(p.hero));

/** Base power of a card for its controller (Lyath halves it). */
function basePowerFor(p: PlayerState, c: Card): number {
  const v = powerOf(c);
  return ability(p)?.halveStats ? Math.ceil(v / 2) : v;
}

/** Defense value of a card for its controller. */
export function defenseFor(p: PlayerState, _c: Card, base: number): number {
  return ability(p)?.halveStats ? Math.ceil(base / 2) : base;
}

export function costOf(c: Card): number {
  return typeof c.cost === 'number' ? c.cost : 0;
}
export function pitchOf(c: Card): number {
  return c.pitch ?? 0;
}
export function powerOf(c: Card): number {
  return n(c.power);
}
export function defenseOf(c: Card): number | null {
  return typeof c.defense === 'number' ? c.defense : c.defense === null ? null : 0;
}

export function findInst(s: GameState, uid: number): { p: PlayerState; zone: string; inst: CardInst } | null {
  for (const p of s.players) {
    for (const zone of ['hand', 'arsenal', 'deck', 'pitch', 'graveyard', 'banished'] as const) {
      const inst = p[zone].find((i) => i.uid === uid);
      if (inst) return { p, zone, inst };
    }
    const w = p.weapons.find((w) => w.inst.uid === uid);
    if (w) return { p, zone: 'weapon', inst: w.inst };
    const e = p.equipment.find((e) => e.inst.uid === uid);
    if (e) return { p, zone: 'equipment', inst: e.inst };
    const pm = p.permanents.find((e) => e.inst.uid === uid);
    if (pm) return { p, zone: 'permanent', inst: pm.inst };
  }
  return null;
}

function removeFrom(list: CardInst[], uid: number): CardInst | undefined {
  const i = list.findIndex((c) => c.uid === uid);
  return i >= 0 ? list.splice(i, 1)[0] : undefined;
}

export function currentLink(s: GameState): ChainLink | undefined {
  const l = s.chain[s.chain.length - 1];
  return l && l.damage === null ? l : undefined;
}

export function linkPower(l: ChainLink): number {
  return Math.max(0, l.basePower + l.powerMod);
}

export function linkDefense(l: ChainLink): number {
  return l.defenders.reduce((a, d) => a + d.defense, 0);
}

export function equipDefense(e: { inst: CardInst; defenseMod: number }): number {
  return Math.max(0, (defenseOf(cardOf(e.inst)) ?? 0) + e.defenseMod);
}

export function matchesFilter(f: AttackFilter, l: { inst: CardInst; fromWeapon: boolean }): boolean {
  const c = cardOf(l.inst);
  switch (f.kind) {
    case 'any': return true;
    case 'attackAction': return !l.fromWeapon;
    case 'weapon': return l.fromWeapon;
    case 'subtype': return c.types.some((t) => t.toLowerCase() === f.value);
    case 'class': return c.types.includes(f.value);
    case 'anyClass': return f.values.some((v) => c.types.includes(v));
    case 'boosted': return !l.fromWeapon && getScript(c).boost;
  }
}

// ---------------------------------------------------------------- setup

/** `first`: who takes the first turn (decided by a die roll before the game); random if not given. */
export function createGame(setup: [PlayerSetup, PlayerSetup], seed = Date.now() & 0x7fffffff, format = 'blitz', first?: PlayerId): GameState {
  const s: GameState = {
    seed, nextUid: 1, turn: 1, turnPlayer: 0, phase: 'action', priority: 0, passes: 0,
    players: [null!, null!], chain: [], chainOpen: false, winner: null, log: [], format,
  };
  setup.forEach((ps, idx) => {
    const id = idx as PlayerId;
    const hero = card(ps.deck.heroId);
    const p: PlayerState = {
      id, name: ps.name, isBot: ps.isBot, difficulty: ps.difficulty ?? 'normal',
      hero: mk(s, hero.id, id), life: hero.health ?? 20, intellect: hero.intellect ?? 4,
      deck: shuffle(s, ps.deck.cardIds.map((cid) => mk(s, cid, id))),
      hand: [], arsenal: [], pitch: [], graveyard: [], banished: [], intimidated: [], soul: [],
      weapons: [], equipment: [], permanents: [], resources: 0, actionPoints: 0, effects: [], marked: false,
      turn: newTurnInfo(),
    };
    // equip one item per slot, weapons up to two hands
    const slots = new Set<string>();
    let hands = 0;
    for (const wid of ps.deck.weaponIds) {
      const w = card(wid);
      const size = w.types.includes('2H') ? 2 : 1;
      if (hands + size > 2) continue;
      hands += size;
      p.weapons.push({ inst: mk(s, wid, id), usedThisTurn: false });
    }
    for (const eid of ps.deck.equipmentIds) {
      const e = card(eid);
      if (e.types.includes('Weapon')) continue;
      const slot = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'].find((t) => e.types.includes(t)) ?? e.id;
      if (slot === 'Off-Hand') {
        if (hands >= 2) continue;
        hands++;
      }
      if (slots.has(slot)) continue;
      slots.add(slot);
      p.equipment.push({ inst: mk(s, eid, id), defenseMod: 0, destroyed: false, usedThisTurn: false });
    }
    s.players[id] = p;
  });
  for (const p of s.players) ability(p)?.setup?.(heroCtx(s, p));
  const coin = rand(s) < 0.5 ? 0 : 1; // always drawn, so the rest of the game is the same whoever goes first
  s.turnPlayer = first ?? coin;
  s.priority = s.turnPlayer;
  log(s, null, `${pname(s, s.turnPlayer)} goes first.`);
  for (const p of s.players) drawUpTo(s, p);
  startTurn(s);
  return s;
}

function draw(s: GameState, p: PlayerState, count = 1, triggers = true) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const c = p.deck.shift();
    if (!c) break;
    p.hand.push(c);
    n++;
  }
  if (!triggers || n === 0) return;
  p.turn.drew = true;
  if (s.phase === 'action' || s.phase === 'defend' || s.phase === 'reaction') {
    const o = s.players[other(p.id)];
    ability(o)?.onOpponentDraw?.(heroCtx(s, o), n);
  }
}

function drawUpTo(s: GameState, p: PlayerState) {
  const need = p.intellect - p.hand.length;
  if (need > 0) draw(s, p, need, false);
}

function startTurn(s: GameState) {
  const p = s.players[s.turnPlayer];
  p.actionPoints = 1;
  p.resources = 0;
  p.effects = [];
  p.weapons.forEach((w) => (w.usedThisTurn = false));
  p.equipment.forEach((e) => (e.usedThisTurn = false));
  for (const pl of s.players) pl.turn = newTurnInfo();
  s.phase = 'action';
  s.priority = s.turnPlayer;
  log(s, s.turnPlayer, `— Turn ${s.turn}: ${p.name} —`);
  // start of turn triggers: a human player with two or more different ones chooses their order
  const triggers = p.permanents.filter((pm) => isStartTrigger(pm.inst));
  if (!p.isBot && new Set(triggers.map((pm) => cardOf(pm.inst).name)).size >= 2) {
    s.pendingTriggers = { player: p.id, uids: triggers.map((pm) => pm.inst.uid) };
    log(s, p.id, `${p.name} chooses the order of the start-of-turn triggers.`, RULES.triggerOrder);
    return;
  }
  for (const pm of triggers) runStartTrigger(s, p, pm.inst.uid);
  ability(p)?.startOfTurn?.(heroCtx(s, p));
}

const START_TOKENS = ['Agility', 'Might', 'Vigor', 'Embodiment of Earth', 'Sigil of Fate', 'Seismic Surge'];
function isStartTrigger(inst: CardInst): boolean {
  const c = cardOf(inst);
  if (START_TOKENS.includes(c.name)) return true;
  const sc = getScript(c);
  return !!sc.destroyAt || sc.steamUpkeep;
}

function runStartTrigger(s: GameState, p: PlayerState, uid: number) {
  const pm = p.permanents.find((x) => x.inst.uid === uid);
  if (!pm) return;
  const name = cardOf(pm.inst).name;
  const destroy = () => removePermanent(s, p, pm.inst.uid);
  // tokens whose printed text says what they do (Might, Vigor, Agility, ...) resolve through that text when destroyed
  if (getScript(cardOf(pm.inst)).onDestroy.length) { destroy(); return; }
  if (name === 'Agility') { destroy(); p.effects.push({ kind: 'nextAttackGoAgain', filter: { kind: 'any' }, source: name }); }
  else if (name === 'Might') { destroy(); p.effects.push({ kind: 'nextAttackPower', amount: 1, filter: { kind: 'any' }, source: name }); }
  else if (name === 'Vigor') { destroy(); p.resources += 1; }
  else if (['Embodiment of Earth', 'Sigil of Fate', 'Seismic Surge'].includes(name)) destroy();
  else {
    const sc = getScript(cardOf(pm.inst));
    if (sc.destroyAt) destroy();
    else if (sc.steamUpkeep) {
      if ((pm.steam ?? 0) > 0) { pm.steam = (pm.steam ?? 0) - 1; log(s, p.id, `${name}: a steam counter is removed (${pm.steam} left).`); }
      else destroy();
    }
  }
}

function doOrderTriggers(s: GameState, order: number[]) {
  const pt = s.pendingTriggers;
  if (!pt) throw new Error('There are no triggers to order.');
  if (order.length !== pt.uids.length || !pt.uids.every((u) => order.includes(u))) throw new Error('Put every trigger in the order.');
  const p = s.players[pt.player];
  s.pendingTriggers = undefined;
  for (const uid of order) runStartTrigger(s, p, uid);
  ability(p)?.startOfTurn?.(heroCtx(s, p));
}

function removePermanent(s: GameState, p: PlayerState, uid: number) {
  const i = p.permanents.findIndex((pm) => pm.inst.uid === uid);
  if (i < 0) return;
  const [pm] = p.permanents.splice(i, 1);
  const c = cardOf(pm.inst);
  if (!has(c, 'Token')) p.graveyard.push(pm.inst);
  if (has(c, 'Item')) p.turn.itemDestroyed = true;
  log(s, p.id, `${c.name} leaves the arena.`);
  const onDestroy = getScript(c).onDestroy;
  if (onDestroy.length) resolveEffects(s, p, onDestroy, pm.inst);
}

/** Put a card into its owner's graveyard; ephemeral cards cease to exist instead. */
function toGraveyard(p: PlayerState, inst: CardInst) {
  if (getScript(cardOf(inst)).ephemeral) return;
  p.graveyard.push(inst);
}

/** Clash: each hero reveals the top card of their deck; the hero whose card has the greater {p} wins. */
function clash(s: GameState): PlayerId | null {
  const tops = s.players.map((pl) => pl.deck[0]);
  const pw = tops.map((t) => (t ? powerOf(cardOf(t)) : -1));
  const names = s.players.map((pl, i) => `${pl.name}: ${tops[i] ? `${cardOf(tops[i]!).name} (${pw[i]})` : 'no card'}`);
  const winner: PlayerId | null = pw[0] > pw[1] ? 0 : pw[1] > pw[0] ? 1 : null;
  log(s, null, `Clash! ${names.join(' vs ')} — ${winner === null ? 'no winner' : `${s.players[winner].name} wins`}.`, 'Clash: each hero reveals the top card of their deck. The hero who revealed the card with the greatest {p} wins.');
  if (winner !== null) s.players[winner].turn.clashesWon = (s.players[winner].turn.clashesWon ?? 0) + 1;
  return winner;
}

/** Track a discard for "if you've discarded a card with N or more power" and hero abilities. */
function noteDiscard(s: GameState, p: PlayerState, inst: CardInst) {
  const c = cardOf(inst);
  p.turn.discardedPower = Math.max(p.turn.discardedPower ?? 0, powerOf(c));
  ability(p)?.onDiscard?.(heroCtx(s, p), c);
}

/** Evaluate a printed condition ("If you have less life than an opposing hero, ..."). */
export function evalCondition(s: GameState, p: PlayerState, cond: Condition, link?: ChainLink): boolean {
  const opp = s.players[other(p.id)];
  const chainBy = s.chain.filter((l) => l.attacker === p.id);
  switch (cond.kind) {
    case 'auraThisTurn': return !!p.turn.auraPlayed;
    case 'lessLife': return p.life < opp.life;
    case 'draconicLinks': return chainBy.filter((l) => cardOf(l.inst).types.includes('Draconic')).length >= cond.n;
    case 'arcaneThisTurn': return !!p.turn.arcaneDealt;
    case 'powerAboveBase': return !!link && link.powerMod > 0;
    case 'instantThisLink': return !!link && (link.instants ?? 0) > 0;
    case 'defendedByFewer': return !!link && link.defenders.filter((d) => d.kind !== 'equipment').length < cond.n;
    case 'powerAtLeast': return !!link && linkPower(link) >= cond.n;
    case 'reactionsThisLink': return !!link && (link.reactionCount ?? 0) >= cond.n;
    case 'discardedPower': return (p.turn.discardedPower ?? 0) >= cond.n;
    case 'hitWithDagger': return chainBy.some((l) => l.hit && cardOf(l.inst).types.includes('Dagger'));
    case 'defendedByAction': return !!link && link.defenders.some((d) => has(cardOf(d.inst), 'Action'));
    case 'earthBanished': return p.banished.filter((b) => cardOf(b).types.includes('Earth')).length >= cond.n;
    case 'playedNonAttack': return p.turn.played.some((id) => { const c = card(id); return has(c, 'Action') && !has(c, 'Attack'); });
    case 'drew': return p.turn.drew;
    case 'itemDestroyed': return !!p.turn.itemDestroyed;
    case 'pitchColor': return p.pitch.some((x) => pitchOf(cardOf(x)) === cond.pitch);
    case 'pitchPower': return p.pitch.some((x) => powerOf(cardOf(x)) >= cond.n);
    case 'lastDraconic': { const prev = s.chain[s.chain.length - 2]; return !!prev && cardOf(prev.inst).types.includes('Draconic'); }
    case 'controls': return p.permanents.some((pm) => cardOf(pm.inst).name.toLowerCase() === cond.name.toLowerCase());
    case 'aurasAtLeast': return p.permanents.filter((pm) => has(cardOf(pm.inst), 'Aura')).length >= cond.n;
    case 'anotherBlue': return p.turn.played.filter((id) => card(id).pitch === 3).length >= 2;
    case 'attackingMarked': return opp.marked;
    case 'weaponAttacked': return !!p.turn.weaponAttacked;
    case 'intimidated': return !!p.turn.intimidated;
    case 'attackedTimes': return (p.turn.attackedTimes ?? 0) >= cond.n;
    case 'charged': return !!p.turn.charged;
    case 'instantToGrave': return !!p.turn.instantToGrave;
    case 'highTide': return p.pitch.filter((x) => pitchOf(cardOf(x)) === 3).length >= cond.n;
    case 'reprise': { const l = link ?? currentLink(s); return !!l && l.defenders.some((d) => d.kind === 'hand'); }
    case 'defendedByAttackAction': { const l = link ?? currentLink(s); return !!l && l.defenders.some((d) => has(cardOf(d.inst), 'Attack') && has(cardOf(d.inst), 'Action')); }
    case 'chainLinkAtLeast': return s.chain.length >= cond.n;
    case 'arcaneTaken': return !!p.turn.arcaneTaken;
  }
}

/** Resolve a card's "If <condition>, <effect>" sentences of the given kind. */
function resolveConditionals(s: GameState, p: PlayerState, c: Card, inst: CardInst, when: 'if' | 'ifLink', link?: ChainLink) {
  for (const cnd of getScript(c).conditional) {
    if (cnd.when !== when || !cnd.cond) continue;
    if (!evalCondition(s, p, cnd.cond, link)) continue;
    log(s, p.id, `${c.name}: condition met.`);
    resolveEffects(s, p, cnd.effects, inst);
  }
}

/** "If a card with N or more {p} is banished/discarded this way, ..." after a random additional cost */
function applyAdditionalPayoff(s: GameState, p: PlayerState, c: Card, inst: CardInst) {
  const best = p.turn.flags[`addlPow${inst.uid}`];
  if (best === undefined) return;
  for (const cnd of getScript(c).conditional) {
    if (cnd.when !== 'additional' || best < (cnd.threshold ?? 0)) continue;
    log(s, p.id, `${c.name}: a card with ${cnd.threshold}+ power was used to pay — bonus!`);
    resolveEffects(s, p, cnd.effects, inst);
  }
}

/** Is a card's optional cost payable right now (ignoring resources)? */
export function optionalPayable(p: PlayerState, oc: OptionalCost, playingUid: number): boolean {
  const others = p.hand.filter((h) => h.uid !== playingUid);
  switch (oc.cost.kind) {
    case 'discard': return others.some((h) => oc.cost.kind === 'discard' && (!oc.cost.pitch || pitchOf(cardOf(h)) === oc.cost.pitch));
    case 'pay': return true;
    case 'banishGrave': return p.graveyard.length >= oc.cost.n;
    case 'destroyTop': return p.deck.length > 0;
    case 'handToBottom': case 'banishHand': return others.length > 0;
    case 'discardOrTop': return others.length > 0 || p.deck.length > 0;
    case 'destroyOwn': return p.permanents.some((pm) => ownMatches(cardOf(pm.inst), oc.cost));
    case 'arsenalToBottom': return p.arsenal.length > 0;
    case 'banishGraveMatch': return p.graveyard.some((g) => graveMatches(cardOf(g), oc.cost));
    case 'decompose': return decomposePick(p, oc.cost.kind === 'decompose' ? oc.cost.earth : 0) !== null;
    case 'reveal': return others.some((h) => oc.cost.kind === 'reveal' && cardOf(h).types.includes(oc.cost.talent));
    case 'charge': return others.some((h) => oc.cost.kind === 'charge' && (!oc.cost.pitch || pitchOf(cardOf(h)) === oc.cost.pitch));
  }
}

function graveMatches(c: Card, cost: OptionalCost['cost']): boolean {
  if (cost.kind !== 'banishGraveMatch') return false;
  return cost.name ? c.name.toLowerCase() === cost.name.toLowerCase() : !!cost.type && c.types.includes(cost.type) && (cost.type !== 'Attack' || c.types.includes('Action'));
}

/** Decompose: N Earth cards plus a different action card from the graveyard. */
function decomposePick(p: PlayerState, earth: number): CardInst[] | null {
  const earths = p.graveyard.filter((g) => cardOf(g).types.includes('Earth'));
  for (const action of p.graveyard.filter((g) => has(cardOf(g), 'Action'))) {
    const rest = earths.filter((e) => e.uid !== action.uid).slice(0, earth);
    if (rest.length === earth) return [...rest, action];
  }
  return null;
}

function ownMatches(c: Card, cost: OptionalCost['cost']): boolean {
  if (cost.kind !== 'destroyOwn') return false;
  if (cost.name) return c.name.toLowerCase() === cost.name.toLowerCase();
  return !!cost.type && c.types.includes(cost.type);
}

/** Pay an optional cost. Returns the card used (for "if a card with N+ power is discarded this way"). */
function payOptional(s: GameState, p: PlayerState, oc: OptionalCost, choice: OptionalChoice, playingUid: number): Card | null {
  const pick = (filter: (c: Card) => boolean) => {
    const inst = choice.uid !== undefined ? p.hand.find((h) => h.uid === choice.uid && h.uid !== playingUid) : undefined;
    if (!inst || !filter(cardOf(inst))) throw new Error('Choose a card from your hand to pay for that.');
    return removeFrom(p.hand, inst.uid)!;
  };
  const cost = oc.cost;
  switch (cost.kind) {
    case 'reveal': {
      // Fusion: the revealed card stays in hand
      const inst = choice.uid !== undefined ? p.hand.find((h) => h.uid === choice.uid && h.uid !== playingUid) : undefined;
      if (!inst || !cardOf(inst).types.includes(cost.talent)) throw new Error(`Reveal ${cost.talent === 'Ice' || cost.talent === 'Earth' ? 'an' : 'a'} ${cost.talent} card from your hand to fuse.`);
      log(s, p.id, `${p.name} reveals ${cardOf(inst).name}: fused!`, `${cost.talent} Fusion: as an additional cost you may reveal ${cost.talent === 'Lightning' ? 'a' : 'an'} ${cost.talent} card from your hand. If you do, the card is fused and gets its bonus.`);
      return cardOf(inst);
    }
    case 'charge': {
      const inst = pick((c) => !cost.pitch || pitchOf(c) === cost.pitch);
      (p.soul ??= []).push(inst);
      p.turn.charged = true;
      log(s, p.id, `${p.name} charges their soul with ${cardOf(inst).name}.`, 'Charge: put a card from your hand into your hero’s soul (Light heroes draw power from it).');
      return cardOf(inst);
    }
    case 'discard': {
      const inst = pick((c) => !cost.pitch || pitchOf(c) === cost.pitch);
      p.graveyard.push(inst);
      noteDiscard(s, p, inst);
      log(s, p.id, `${p.name} discards ${cardOf(inst).name}.`);
      return cardOf(inst);
    }
    case 'discardOrTop': {
      if (choice.top) {
        const t = p.deck.shift();
        if (!t) throw new Error('Your deck is empty.');
        p.graveyard.push(t);
        log(s, p.id, `${p.name} destroys ${cardOf(t).name} from the top of the deck.`);
        return cardOf(t);
      }
      const inst = pick(() => true);
      p.graveyard.push(inst);
      noteDiscard(s, p, inst);
      log(s, p.id, `${p.name} discards ${cardOf(inst).name}.`);
      return cardOf(inst);
    }
    case 'handToBottom': {
      const inst = pick(() => true);
      p.deck.push(inst);
      log(s, p.id, `${p.name} puts a card from hand on the bottom of the deck.`);
      return cardOf(inst);
    }
    case 'banishHand': {
      const inst = pick(() => true);
      p.banished.push(inst);
      log(s, p.id, `${p.name} banishes ${cardOf(inst).name} from hand.`);
      return cardOf(inst);
    }
    case 'banishGrave': {
      if (p.graveyard.length < cost.n) throw new Error('Not enough cards in your graveyard.');
      let best: Card | null = null;
      for (let i = 0; i < cost.n; i++) {
        const g = p.graveyard.splice(Math.floor(rand(s) * p.graveyard.length), 1)[0];
        p.banished.push(g);
        if (!best || powerOf(cardOf(g)) > powerOf(best)) best = cardOf(g);
      }
      log(s, p.id, `${p.name} banishes ${cost.n} card${cost.n > 1 ? 's' : ''} from the graveyard.`);
      return best;
    }
    case 'destroyTop': {
      const t = p.deck.shift();
      if (!t) throw new Error('Your deck is empty.');
      p.graveyard.push(t);
      log(s, p.id, `${p.name} destroys ${cardOf(t).name} from the top of the deck.`);
      return cardOf(t);
    }
    case 'destroyOwn': {
      const pm = p.permanents.find((x) => ownMatches(cardOf(x.inst), cost));
      if (!pm) throw new Error('You have nothing to destroy for that.');
      removePermanent(s, p, pm.inst.uid);
      return cardOf(pm.inst);
    }
    case 'arsenalToBottom': {
      const a = p.arsenal.shift();
      if (!a) throw new Error('Your arsenal is empty.');
      p.deck.push(a);
      log(s, p.id, `${p.name} puts the card from their arsenal on the bottom of their deck.`);
      return cardOf(a);
    }
    case 'banishGraveMatch': {
      const g = p.graveyard.find((x) => graveMatches(cardOf(x), cost));
      if (!g) throw new Error('No such card in your graveyard.');
      removeFrom(p.graveyard, g.uid);
      p.banished.push(g);
      log(s, p.id, `${p.name} banishes ${cardOf(g).name} from the graveyard.`);
      return cardOf(g);
    }
    case 'decompose': {
      const pick = decomposePick(p, cost.earth);
      if (!pick) throw new Error('Not enough Earth and action cards in your graveyard.');
      for (const g of pick) { removeFrom(p.graveyard, g.uid); p.banished.push(g); }
      log(s, p.id, `${p.name} decomposes: banishes ${pick.map((g) => cardOf(g).name).join(', ')} from the graveyard.`, 'Decompose: banish Earth cards and an action card from your graveyard for a bonus.');
      return cardOf(pick[pick.length - 1]);
    }
    case 'pay':
      return null; // paid together with the card's cost
  }
}

/** Apply an accepted optional cost's payoff (respecting "if a card with N+ power ... this way"). */
function optionalPayoff(s: GameState, p: PlayerState, oc: OptionalCost, used: Card | null, inst: CardInst) {
  if (oc.minPower !== undefined && (!used || powerOf(used) < oc.minPower)) {
    log(s, p.id, `${cardOf(inst).name}: the paid card didn't have ${oc.minPower}+ power.`);
    return;
  }
  resolveEffects(s, p, oc.effects, inst);
}

function createToken(s: GameState, p: PlayerState, name: string, amount: number) {
  const t = findCard(name);
  if (!t) {
    log(s, p.id, `(token "${name}" not in database)`);
    return;
  }
  for (let i = 0; i < amount; i++) {
    const inst = mk(s, t.id, p.id);
    p.permanents.push({ inst, ward: getScript(t).ward });
  }
  if (has(t, 'Aura')) p.turn.auraPlayed = true;
  log(s, p.id, `${p.name} creates ${amount > 1 ? amount + ' ' : 'a '}${t.name} token${amount > 1 ? 's' : ''}.`);
}

// ---------------------------------------------------------------- legality

export interface PlayOption {
  uid: number;
  kind: 'card' | 'activation';
  index: number; // activation index
  cost: number;
  label: string;
}

function frostbite(p: PlayerState) {
  return p.permanents.filter((pm) => cardOf(pm.inst).name === 'Frostbite').length;
}

export function effectiveCost(s: GameState, p: PlayerState, c: Card): number {
  void s;
  const sc = getScript(c);
  let less = 0;
  if (sc.costLessPer === 'draconicLink') less = s.chain.filter((l) => l.attacker === p.id && cardOf(l.inst).types.includes('Draconic')).length;
  else if (sc.costLessPer) less = p.permanents.filter((pm) => cardOf(pm.inst).name === sc.costLessPer).length;
  if (sc.costLessIf && p.permanents.some((pm) => cardOf(pm.inst).name.toLowerCase() === sc.costLessIf!.toLowerCase())) less += 1;
  return Math.max(0, costOf(c) - less) + frostbite(p);
}

/** Resources available: floating pool plus pitch value of hand cards (excluding `exclude`). */
export function availableResources(p: PlayerState, exclude: number[] = []): number {
  return p.resources + p.hand.filter((h) => !exclude.includes(h.uid)).reduce((a, h) => a + pitchOf(cardOf(h)), 0);
}

function reactionTargetsOk(s: GameState, c: Card): boolean {
  const l = currentLink(s);
  if (!l) return false;
  const sc = getScript(c);
  const targeted = sc.onPlay.filter((e): e is Extract<Effect, { filter: AttackFilter }> =>
    e.kind === 'targetAttackPower' || e.kind === 'targetAttackGoAgain');
  return targeted.every((e) => matchesFilter(e.filter, l));
}

/** Can player `pid` play card `c` right now (timing-wise), ignoring cost? */
function timingOk(s: GameState, pid: PlayerId, c: Card): boolean {
  if (s.phase === 'gameOver' || s.priority !== pid) return false;
  const p = s.players[pid];
  const isInstant = has(c, 'Instant');
  if (s.phase === 'action') {
    // while something is on the stack, either player may only respond with instants
    if (s.stack?.length) return isInstant;
    if (s.turnPlayer !== pid) return false;
    if (isInstant) return true;
    if (has(c, 'Action')) return p.actionPoints > 0;
    return false;
  }
  if (s.phase === 'reaction') {
    const l = currentLink(s);
    if (!l) return false;
    if (isInstant) return true;
    if (has(c, 'Attack Reaction')) return l.attacker === pid && reactionTargetsOk(s, c);
    if (has(c, 'Defense Reaction')) {
      if (l.attacker === pid) return false;
      if (l.overpower && has(c, 'Action') && l.defenders.some((d) => has(cardOf(d.inst), 'Action'))) return false;
      return true;
    }
  }
  return false;
}

export const HERO_INDEX = 1000;
export const HAND_INDEX = 2000;

export function playOptions(s: GameState, pid: PlayerId): PlayOption[] {
  const p = s.players[pid];
  const out: PlayOption[] = [];
  if (s.priority !== pid || !['action', 'reaction'].includes(s.phase) || s.pendingTriggers) return out;
  const fromBanished = p.banished.filter((b) => { const fb = getScript(cardOf(b)).fromBanished; return !!fb && (!fb.cond || evalCondition(s, p, fb.cond)); });
  for (const inst of [...p.hand, ...p.arsenal, ...fromBanished]) {
    const c = cardOf(inst);
    if (!timingOk(s, pid, c)) continue;
    const cost = effectiveCost(s, p, c);
    const sc = getScript(c);
    const extra = (sc.additionalCost.discardRandom ?? 0) + (sc.additionalCost.banishRandomHand ?? 0);
    if (extra > 0 && p.hand.filter((h) => h.uid !== inst.uid).length < extra) continue;
    if ((sc.additionalCost.banishGraveyard ?? 0) > p.graveyard.length) continue;
    if (sc.playIf && !evalCondition(s, p, sc.playIf)) continue;
    if (availableResources(p, [inst.uid]) < cost) continue;
    out.push({ uid: inst.uid, kind: 'card', index: 0, cost, label: c.name });
  }
  const sources = [
    ...p.weapons.map((w) => ({ inst: w.inst, used: w.usedThisTurn })),
    ...p.equipment.filter((e) => !e.destroyed).map((e) => ({ inst: e.inst, used: e.usedThisTurn })),
    ...p.permanents.map((pm) => ({ inst: pm.inst, used: false })),
  ];
  for (const src of sources) {
    const sc = getScript(cardOf(src.inst));
    sc.activations.forEach((a, index) => {
      if (a.oncePerTurn && src.used) return;
      if (a.instant) {
        if (!['action', 'reaction'].includes(s.phase)) return;
      } else if (s.phase !== 'action' || s.turnPlayer !== pid || p.actionPoints < 1 || s.stack?.length) return;
      const mod = ability(p)?.activationCostMod?.(heroCtx(s, p), cardOf(src.inst)) ?? 0;
      const cost = Math.max(0, a.cost + mod) + frostbite(p);
      if (availableResources(p) < cost) return;
      out.push({ uid: src.inst.uid, kind: 'activation', index, cost, label: `${cardOf(src.inst).name}: ${a.attack ? 'Attack' : a.text.split(':').slice(1).join(':').trim()}` });
    });
  }
  // hero abilities
  const ab = ability(p);
  ab?.activations?.forEach((a, i) => {
    if (a.oncePerTurn && p.turn.flags[`hero${i}`]) return;
    if (a.instant) {
      if (!['action', 'reaction'].includes(s.phase)) return;
    } else if (s.phase !== 'action' || s.turnPlayer !== pid || p.actionPoints < 1 || s.stack?.length) return;
    const ctx = heroCtx(s, p);
    if (!a.canUse(ctx)) return;
    const cost = a.cost(ctx) + frostbite(p);
    if (availableResources(p) < cost) return;
    out.push({ uid: p.hero.uid, kind: 'activation', index: HERO_INDEX + i, cost, label: `${cardOf(p.hero).name}: ${a.label}` });
  });
  // "Instant - Discard this: <effect>" from hand
  for (const inst of p.hand) {
    const ha = getScript(cardOf(inst)).handActivation;
    if (!ha) continue;
    const cost = ha.cost + frostbite(p);
    if (availableResources(p, [inst.uid]) < cost) continue;
    out.push({ uid: inst.uid, kind: 'activation', index: HAND_INDEX, cost, label: `Discard ${cardOf(inst).name}: ${ha.text.split(':').slice(1).join(':').trim()}` });
  }
  return out;
}

export interface DefendOption {
  uid: number;
  kind: 'hand' | 'equipment';
  defense: number;
}

export function defendOptions(s: GameState, pid: PlayerId): DefendOption[] {
  if (s.phase !== 'defend' || s.priority !== pid) return [];
  const p = s.players[pid];
  const out: DefendOption[] = [];
  const l = currentLink(s);
  if (!l?.noHandDefense) {
    for (const h of p.hand) {
      const d = defenseOf(cardOf(h));
      if (d === null) continue;
      out.push({ uid: h.uid, kind: 'hand', defense: defenseFor(p, cardOf(h), d) });
    }
  }
  for (const e of p.equipment) {
    if (l?.noEquipDefense) break;
    if (e.destroyed || defenseOf(cardOf(e.inst)) === null) continue;
    out.push({ uid: e.inst.uid, kind: 'equipment', defense: defenseFor(p, cardOf(e.inst), equipDefense(e)) });
  }
  return out;
}

/** Validate a block. Returns an error message or null. */
export function checkDefense(s: GameState, uids: number[]): string | null {
  const l = currentLink(s);
  if (!l) return 'No attack to defend';
  const p = s.players[other(l.attacker)];
  const fromHand = uids.filter((u) => p.hand.some((h) => h.uid === u));
  if (l.noHandDefense && fromHand.length > 0) return 'This attack can’t be defended by cards from hand.';
  if (l.dominate && fromHand.length > 1) return 'Dominate: this attack can’t be defended by more than 1 card from hand.';
  if (l.overpower) {
    const actions = uids.map((u) => findInst(s, u)).filter((f) => f && has(cardOf(f.inst), 'Action'));
    if (actions.length > 1) return 'Overpower: this attack can’t be defended by more than 1 action card.';
  }
  return null;
}

// ---------------------------------------------------------------- apply

export function applyAction(prev: GameState, action: Action): GameState {
  const s: GameState = structuredClone(prev);
  if (s.phase === 'gameOver' && action.type !== 'manual') return s;
  if (s.pendingTriggers && !['orderTriggers', 'concede', 'manual'].includes(action.type)) throw new Error('Choose the order of your start-of-turn triggers first.');
  switch (action.type) {
    case 'play': doPlay(s, action.uid, action.pitch, action.mode ?? 0, action.optional); break;
    case 'activate': doActivate(s, action.uid, action.index, action.pitch); break;
    case 'pass': doPass(s, action.pitchOrder); break;
    case 'orderTriggers': doOrderTriggers(s, action.order); break;
    case 'defend': doDefend(s, action.uids, action.boosts ?? [], action.pitch ?? []); break;
    case 'arsenal': if (action.pitchOrder) s.players[s.turnPlayer].turn.pitchOrder = action.pitchOrder; doArsenal(s, action.uid); break;
    case 'concede': {
      const loser = s.priority;
      log(s, loser, `${pname(s, loser)} concedes.`);
      endGame(s, other(loser));
      break;
    }
    case 'manual': doManual(s, action); break;
  }
  checkWin(s);
  return s;
}

function pay(s: GameState, p: PlayerState, cost: number, pitch: number[]) {
  for (const uid of pitch) {
    if (p.resources >= cost) break; // never over-pitch beyond need
    const inst = removeFrom(p.hand, uid);
    if (!inst) throw new Error('Pitched card not in hand');
    const c = cardOf(inst);
    p.resources += pitchOf(c);
    if (ability(p)?.pitchToBanished) p.banished.push(inst);
    else p.pitch.push(inst);
    log(s, p.id, `${p.name} pitches ${c.name} (+${pitchOf(c)}).`);
    if (c.types.includes('Chi')) p.turn.flags.chi = (p.turn.flags.chi ?? 0) + pitchOf(c);
    ability(p)?.onPitch?.(heroCtx(s, p), c);
  }
  if (p.resources < cost) throw new Error(`Not enough resources (need ${cost}, have ${p.resources})`);
  p.resources -= cost;
  // Frostbite: destroyed when you play a card / activate
  const fb = p.permanents.find((pm) => cardOf(pm.inst).name === 'Frostbite');
  if (fb) removePermanent(s, p, fb.inst.uid);
}

function doPlay(s: GameState, uid: number, pitch: number[], mode: number, optional?: OptionalChoice) {
  const pid = s.priority;
  const p = s.players[pid];
  const opt = playOptions(s, pid).find((o) => o.uid === uid && o.kind === 'card');
  if (!opt) throw new Error('That card can’t be played now');
  const fromArsenal = p.arsenal.some((a) => a.uid === uid);
  const fromBanished = !fromArsenal && p.banished.some((b) => b.uid === uid);
  const c = cardOf((fromArsenal ? p.arsenal : fromBanished ? p.banished : p.hand).find((h) => h.uid === uid)!);
  const sc = getScript(c);
  // optional cost ("you may ... If you do, ..."): validate before paying anything
  const oc = optional?.accept && sc.optional && sc.optional.timing !== 'defend' ? sc.optional : undefined;
  if (oc && !optionalPayable(p, oc, uid)) throw new Error('You can’t pay that optional cost.');
  if (oc && optional?.uid !== undefined && pitch.includes(optional.uid)) throw new Error('That card is being pitched.');
  const extraCost = oc?.cost.kind === 'pay' ? oc.cost.amount : 0;
  const inst = removeFrom(fromArsenal ? p.arsenal : fromBanished ? p.banished : p.hand, uid)!;
  if (fromBanished) p.turn.flags[`banishedPlay${uid}`] = 1;
  pay(s, p, opt.cost + extraCost, pitch);
  // additional costs
  for (let i = 0; i < (sc.additionalCost.discardRandom ?? 0); i++) {
    const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
    if (d) {
      p.graveyard.push(d);
      log(s, pid, `${p.name} discards ${cardOf(d).name} at random.`);
      noteDiscard(s, p, d);
      p.turn.flags[`addlPow${uid}`] = Math.max(p.turn.flags[`addlPow${uid}`] ?? -1, powerOf(cardOf(d)));
    }
  }
  for (let i = 0; i < (sc.additionalCost.banishGraveyard ?? 0); i++) {
    // "banish N random cards from your graveyard": random by the card's own wording
    const d = p.graveyard.splice(Math.floor(rand(s) * p.graveyard.length), 1)[0];
    if (d) { p.banished.push(d); log(s, pid, `${p.name} banishes ${cardOf(d).name} from the graveyard.`); p.turn.flags[`addlPow${uid}`] = Math.max(p.turn.flags[`addlPow${uid}`] ?? -1, powerOf(cardOf(d))); }
  }
  for (let i = 0; i < (sc.additionalCost.banishRandomHand ?? 0); i++) {
    const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
    if (d) { p.banished.push(d); log(s, pid, `${p.name} banishes ${cardOf(d).name} at random.`); }
  }
  const optUsed = oc ? payOptional(s, p, oc, optional!, uid) : null;
  const isAction = has(c, 'Action') && !has(c, 'Instant');
  if (s.phase === 'action' && isAction) p.actionPoints -= 1;
  log(s, pid, `${p.name} plays ${c.name}${fromArsenal ? ' from arsenal' : fromBanished ? ' from the banished zone' : ''}.`);
  p.turn.played.push(c.id);
  if (has(c, 'Aura')) p.turn.auraPlayed = true;
  const link = currentLink(s);
  if (link && link.attacker === pid) {
    if (has(c, 'Instant')) link.instants = (link.instants ?? 0) + 1;
    if (has(c, 'Attack Reaction')) link.reactionCount = (link.reactionCount ?? 0) + 1;
  }
  ability(p)?.onPlayCard?.(heroCtx(s, p), c);
  const chosenMode = sc.modes[mode];
  if (chosenMode) log(s, pid, `Mode: ${chosenMode.label}.`);
  if (s.phase === 'action') {
    // it goes on the stack; the other player may respond before it resolves
    (s.stack ??= []).push({ controller: pid, inst, kind: 'card', fromArsenal, mode, optional: oc ? { accept: true, usedId: optUsed?.id ?? null } : undefined, label: c.name });
    openPriority(s, pid);
    return;
  }
  resolveCard(s, p, inst, fromArsenal, mode, oc, optUsed);
}

/** A played card resolves (from the stack in the action phase, or straight away in the reaction step). */
function resolveCard(s: GameState, p: PlayerState, inst: CardInst, fromArsenal: boolean, mode: number, oc: OptionalCost | undefined, optUsed: Card | null) {
  const pid = p.id;
  const c = cardOf(inst);
  const sc = getScript(c);
  const isAction = has(c, 'Action') && !has(c, 'Instant');
  const chosen = sc.modes[mode];
  if (has(c, 'Attack') && has(c, 'Action')) {
    startAttack(s, p, inst, false, fromArsenal, chosen, oc ? { oc, used: optUsed } : undefined);
    return;
  }
  if (chosen) resolveEffects(s, p, chosen.onPlay, inst);
  if (has(c, 'Attack Reaction')) {
    resolveEffects(s, p, sc.onPlay, inst);
    resolveConditionals(s, p, c, inst, 'if');
    resolveConditionals(s, p, c, inst, 'ifLink', currentLink(s));
    if (oc) optionalPayoff(s, p, oc, optUsed, inst);
    toGraveyard(p, inst);
    afterReactionPlay(s);
    return;
  }
  if (has(c, 'Defense Reaction')) {
    const l = currentLink(s)!;
    l.defenders.push({ kind: 'reaction', inst, defense: defenseFor(p, c, defenseOf(c) ?? 0) });
    resolveEffects(s, p, sc.onPlay, inst); // "this gets +N{d}" adds to this defender
    resolveConditionals(s, p, c, inst, 'if');
    if (oc) optionalPayoff(s, p, oc, optUsed, inst);
    afterReactionPlay(s);
    return;
  }
  // non-attack action / instant / permanent
  // Eloquence: non-attack action gets go again
  let goAgain = sc.goAgain;
  if (isAction) {
    const eq = p.permanents.find((pm) => cardOf(pm.inst).name === 'Eloquence');
    if (eq) { removePermanent(s, p, eq.inst.uid); goAgain = true; }
  }
  const instead = sc.conditional.find((x) => x.when === 'instead' && x.cond && evalCondition(s, p, x.cond));
  if (instead) log(s, pid, `${c.name}: condition met — the stronger effect applies instead.`);
  resolveEffects(s, p, instead ? instead.effects : sc.onPlay, inst);
  resolveConditionals(s, p, c, inst, 'if');
  applyAdditionalPayoff(s, p, c, inst);
  if (oc) optionalPayoff(s, p, oc, optUsed, inst);
  if (fromArsenal) for (const cnd of sc.conditional) if (cnd.when === 'fromArsenal') resolveEffects(s, p, cnd.effects, inst);
  if (p.turn.flags[`banishedPlay${inst.uid}`]) for (const cnd of sc.conditional) if (cnd.when === 'fromBanished') resolveEffects(s, p, cnd.effects, inst);
  if (['Aura', 'Item', 'Ally'].some((t) => has(c, t))) {
    const pm: PermanentState = { inst, ward: sc.ward, steam: sc.steam || undefined };
    p.permanents.push(pm);
    if (sc.crank && (pm.steam ?? 0) > 0 && s.phase === 'action' && s.turnPlayer === pid) {
      pm.steam = (pm.steam ?? 0) - 1;
      p.actionPoints += 1;
      ability(p)?.onCrank?.(heroCtx(s, p));
      log(s, pid, `${c.name} cranks: a steam counter is removed and ${p.name} gains an action point.`, 'Crank: when this enters the arena, you may remove a steam counter from it. If you do, gain an action point.');
    }
  } else {
    toGraveyard(p, inst);
    if (has(c, 'Instant')) p.turn.instantToGrave = true;
  }
  if (isAction && goAgain && s.phase === 'action') { p.actionPoints += 1; log(s, pid, `${c.name} has go again: ${p.name} gains an action point.`, RULES.goAgain); }
  if (s.phase === 'reaction') afterReactionPlay(s);
}

// ---------------------------------------------------------------- the stack and priority

/** After `pid` adds a layer, the other player gets priority (they may respond with an instant or pass). */
function openPriority(s: GameState, pid: PlayerId) {
  s.priority = other(pid);
  s.passes = 1; // the player who just acted counts as having passed
  settleStack(s);
}

/** Players who couldn't respond with anything pass automatically, so play keeps flowing. */
function settleStack(s: GameState) {
  for (let i = 0; i < 40 && s.phase === 'action' && s.stack?.length && playOptions(s, s.priority).length === 0; i++) passOnStack(s);
}

function passOnStack(s: GameState) {
  s.passes += 1;
  if (s.passes < 2) { s.priority = other(s.priority); return; }
  // both players passed in a row: the top layer resolves, then the turn player gets priority
  const layer = s.stack!.pop()!;
  s.passes = 0;
  s.priority = s.turnPlayer;
  resolveLayer(s, layer);
  if (!s.stack?.length) delete s.stack;
}

function resolveLayer(s: GameState, layer: Layer) {
  const p = s.players[layer.controller];
  log(s, null, `${layer.label} resolves.`, s.stack?.length ? RULES.stack : undefined);
  if (layer.kind === 'card') {
    const sc = getScript(cardOf(layer.inst));
    const oc = layer.optional?.accept ? sc.optional : undefined;
    resolveCard(s, p, layer.inst, !!layer.fromArsenal, layer.mode ?? 0, oc, layer.optional?.usedId ? card(layer.optional.usedId) : null);
  } else {
    resolveActivation(s, p, layer.inst, layer.index ?? 0);
  }
}

function doActivate(s: GameState, uid: number, index: number, pitch: number[]) {
  const pid = s.priority;
  const p = s.players[pid];
  const opt = playOptions(s, pid).find((o) => o.uid === uid && o.kind === 'activation' && o.index === index);
  if (!opt) throw new Error('That ability can’t be activated now');
  let inst: CardInst;
  let label: string;
  if (index === HAND_INDEX) {
    // "Instant - Discard this: ..." the discard is part of the cost
    inst = removeFrom(p.hand, uid)!;
    pay(s, p, opt.cost, pitch);
    p.graveyard.push(inst);
    noteDiscard(s, p, inst);
    label = cardOf(inst).name;
    log(s, pid, `${p.name} discards ${label} to activate it.`);
  } else if (index >= HERO_INDEX) {
    const a = ability(p)!.activations![index - HERO_INDEX];
    pay(s, p, opt.cost, pitch);
    if (!a.instant) p.actionPoints -= 1;
    p.turn.flags[`hero${index - HERO_INDEX}`] = 1;
    inst = p.hero;
    label = `${cardOf(p.hero).name}: ${a.label}`;
    log(s, pid, `${p.name} activates ${label}.`);
  } else {
    const found = findInst(s, uid)!;
    inst = found.inst;
    const c = cardOf(inst);
    const a = getScript(c).activations[index];
    pay(s, p, opt.cost, pitch);
    if (!a.instant) p.actionPoints -= 1;
    const w = p.weapons.find((w) => w.inst.uid === uid);
    if (w && a.oncePerTurn) w.usedThisTurn = true;
    const e = p.equipment.find((e) => e.inst.uid === uid);
    if (e && a.oncePerTurn) e.usedThisTurn = true;
    label = c.name;
    log(s, pid, `${p.name} activates ${c.name}.`);
  }
  if (s.phase === 'action') {
    (s.stack ??= []).push({ controller: pid, inst, kind: 'activation', index, label });
    openPriority(s, pid);
    return;
  }
  resolveActivation(s, p, inst, index);
}

/** An activated ability resolves. */
function resolveActivation(s: GameState, p: PlayerState, inst: CardInst, index: number) {
  const pid = p.id;
  if (index === HAND_INDEX) {
    const ha = getScript(cardOf(inst)).handActivation!;
    resolveEffects(s, p, ha.effects, inst);
    if (s.phase === 'reaction') afterReactionPlay(s);
    return;
  }
  if (index >= HERO_INDEX) {
    const a = ability(p)!.activations![index - HERO_INDEX];
    const phaseBefore = s.phase;
    const chainBefore = s.chain.length;
    a.resolve(heroCtx(s, p));
    if (s.chain.length > chainBefore) return; // ability started an attack
    if (!a.instant && a.goAgain) p.actionPoints += 1;
    if (phaseBefore === 'reaction' && s.phase === 'reaction') afterReactionPlay(s);
    return;
  }
  const c = cardOf(inst);
  const a = getScript(c).activations[index];
  if (a.attack) {
    startAttack(s, p, inst, true, false);
    if (a.goAgain) currentLink(s)!.goAgain = true;
    return;
  }
  resolveEffects(s, p, a.effects, inst);
  if (a.destroySelf) {
    const e = p.equipment.find((x) => x.inst.uid === inst.uid);
    if (e) { e.destroyed = true; log(s, pid, `${c.name} is destroyed.`); }
    else removePermanent(s, p, inst.uid);
  }
  if (!a.instant && a.goAgain) p.actionPoints += 1;
  if (s.phase === 'reaction') afterReactionPlay(s);
}

function startAttack(s: GameState, p: PlayerState, inst: CardInst, fromWeapon: boolean, fromArsenal: boolean, mode?: Mode, optional?: { oc: OptionalCost; used: Card | null }) {
  const c = cardOf(inst);
  const sc = getScript(c);
  const link: ChainLink = {
    attacker: p.id, inst, fromWeapon, fromArsenal, basePower: basePowerFor(p, c) + (fromWeapon ? p.weapons.find((w) => w.inst.uid === inst.uid)?.counters ?? 0 : 0), powerMod: 0,
    goAgain: sc.goAgain, dominate: sc.dominate, overpower: sc.overpower, piercing: sc.piercing,
    defenders: [], reactions: [], damage: null, hit: false, extraOnHit: mode?.onHit ?? [],
    noEquipDefense: sc.noEquipDefense || undefined,
  };
  s.chain.push(link);
  s.chainOpen = true;
  p.turn.attacks += 1;
  if (fromWeapon) p.turn.weaponAttacked = true;
  const target = s.players[other(p.id)];
  target.turn.attackedTimes = (target.turn.attackedTimes ?? 0) + 1;
  // pending "next attack" effects
  p.effects = p.effects.filter((e) => {
    if (e.kind === 'nextAttackPower' && matchesFilter(e.filter, link)) { link.powerMod += e.amount; return false; }
    if (e.kind === 'nextAttackGoAgain' && matchesFilter(e.filter, link)) { link.goAgain = true; return false; }
    if (e.kind === 'nextAttackOnHit' && matchesFilter(e.filter, link)) { link.extraOnHit = [...link.extraOnHit, ...e.effects]; return false; }
    return true;
  });
  // token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    const destroy = () => removePermanent(s, p, pm.inst.uid);
    if (name === 'Runechant') { destroy(); if (dealDamage(s, other(p.id), 1, true, 'Runechant') > 0) p.turn.arcaneDealt = true; }
    else if (name === 'Quicken') { destroy(); link.goAgain = true; }
    else if (name === 'Courage') { destroy(); link.powerMod += 1; }
    else if (name === 'Embodiment of Lightning' && !fromWeapon) { destroy(); link.goAgain = true; }
    else if (name === 'Blade Dance' && fromWeapon) { destroy(); link.goAgain = true; }
  }
  if (!fromWeapon) {
    resolveEffects(s, p, sc.onPlay, inst);
    if (mode) resolveEffects(s, p, mode.onPlay, inst);
    const prev = s.chain[s.chain.length - 2];
    for (const cnd of sc.conditional) {
      if (cnd.when === 'combo' && prev && prev.attacker === p.id && cardOf(prev.inst).name.toLowerCase() === cnd.comboWith?.toLowerCase()) {
        log(s, p.id, `Combo! (${cardOf(prev.inst).name} → ${c.name})`);
        resolveEffects(s, p, cnd.effects, inst);
      }
    }
    if (fromArsenal) for (const cnd of sc.conditional) if (cnd.when === 'fromArsenal') resolveEffects(s, p, cnd.effects, inst);
    if (p.turn.flags[`banishedPlay${inst.uid}`]) for (const cnd of sc.conditional) if (cnd.when === 'fromBanished') resolveEffects(s, p, cnd.effects, inst);
    resolveConditionals(s, p, c, inst, 'if');
    applyAdditionalPayoff(s, p, c, inst);
    if (optional && optional.oc.timing === 'play') optionalPayoff(s, p, optional.oc, optional.used, inst);
    if (sc.boost && p.deck.length > 0) {
      const top = p.deck.shift()!;
      p.turn.boosted = true;
      if (!ability(p)?.onBoostBanish?.(heroCtx(s, p), top)) p.banished.push(top);
      const mech = has(cardOf(top), 'Mechanologist');
      log(s, p.id, `${p.name} boosts, banishing ${cardOf(top).name}${mech ? ' — go again!' : '.'}`);
      if (mech) link.goAgain = true;
    }
  }
  if (sc.intimidateOnAttack) resolveEffects(s, p, [{ kind: 'intimidate' }], inst);
  resolveEffects(s, p, sc.onAttack, inst);
  if (mode) resolveEffects(s, p, mode.onAttack, inst);
  if (optional && optional.oc.timing === 'attack') optionalPayoff(s, p, optional.oc, optional.used, inst);
  ability(p)?.onAttack?.(heroCtx(s, p), link);
  if (s.phase === 'gameOver') return;
  log(s, p.id, `Attack: ${c.name} — ${linkPower(link)} power${link.goAgain ? ', go again' : ''}${link.dominate ? ', dominate' : ''}${link.overpower ? ', overpower' : ''}.`, link.dominate ? RULES.dominate : link.overpower ? RULES.overpower : link.goAgain ? RULES.goAgain : undefined);
  s.phase = 'defend';
  s.priority = other(p.id);
}

function doDefend(s: GameState, uids: number[], boosts: number[] = [], pitch: number[] = []) {
  const l = currentLink(s);
  if (s.phase !== 'defend' || !l) throw new Error('Not defending now');
  const err = checkDefense(s, uids);
  if (err) throw new Error(err);
  const legal = new Set(defendOptions(s, s.priority).map((o) => o.uid));
  if (uids.some((u) => !legal.has(u))) throw new Error('That card can’t defend.');
  const d = s.players[other(l.attacker)];
  const names: string[] = [];
  for (const uid of uids) {
    const h = removeFrom(d.hand, uid);
    if (h) {
      l.defenders.push({ kind: 'hand', inst: h, defense: defenseFor(d, cardOf(h), defenseOf(cardOf(h)) ?? 0) });
      names.push(cardOf(h).name);
      continue;
    }
    const e = d.equipment.find((e) => e.inst.uid === uid && !e.destroyed);
    if (!e) throw new Error('Invalid defending card');
    l.defenders.push({ kind: 'equipment', inst: e.inst, defense: defenseFor(d, cardOf(e.inst), equipDefense(e)) });
    names.push(cardOf(e.inst).name);
  }
  // Unity: "when this defends together with a card from hand, this gets +N{d}"
  const fromHand = l.defenders.filter((x) => x.kind === 'hand').length;
  for (const x of l.defenders) {
    const u = getScript(cardOf(x.inst)).unity;
    if (u && fromHand - (x.kind === 'hand' ? 1 : 0) > 0) { x.defense += u; log(s, d.id, `${cardOf(x.inst).name} (unity) gets +${u} defense.`); }
  }
  // "When this defends, <effect>"
  for (const x of [...l.defenders]) {
    const od = getScript(cardOf(x.inst)).onDefend;
    if (od.length && (s.phase as string) !== 'gameOver') resolveEffects(s, d, od, x.inst);
  }
  // "When this defends, you may <cost>. If you do, <effect>" for the blockers the player opted into
  const boostDefs = l.defenders.filter((x) => boosts.includes(x.inst.uid));
  const payTotal = boostDefs.reduce((a, x) => {
    const oc = getScript(cardOf(x.inst)).optional;
    return a + (oc?.timing === 'defend' && oc.cost.kind === 'pay' ? oc.cost.amount : 0);
  }, 0);
  if (payTotal > 0 || pitch.length) pay(s, d, payTotal, pitch);
  for (const x of boostDefs) {
    const oc = getScript(cardOf(x.inst)).optional;
    if (!oc || oc.timing !== 'defend') throw new Error(`${cardOf(x.inst).name} has no defend option.`);
    let used: Card | null = null;
    if (oc.cost.kind !== 'pay') {
      if (!optionalPayable(d, oc, x.inst.uid)) throw new Error(`You can’t pay for ${cardOf(x.inst).name}’s ability.`);
      used = payOptional(s, d, oc, { accept: true }, x.inst.uid);
    }
    log(s, d.id, `${cardOf(x.inst).name}: ${oc.effectText}.`);
    optionalPayoff(s, d, oc, used, x.inst);
  }
  if (getScript(cardOf(l.inst)).phantasm && l.defenders.some((x) => {
    const dc = cardOf(x.inst);
    return has(dc, 'Attack') && has(dc, 'Action') && !dc.types.includes('Illusionist') && powerOf(dc) >= 6;
  })) {
    l.basePower = 0;
    l.powerMod = 0;
    l.goAgain = false;
    log(s, l.attacker, `Phantasm: ${cardOf(l.inst).name} is destroyed.`);
  }
  if (l.piercing > 0 && l.defenders.some((x) => x.kind === 'equipment')) {
    l.powerMod += l.piercing;
    log(s, l.attacker, `Piercing: ${cardOf(l.inst).name} gets +${l.piercing} power.`);
  }
  log(s, d.id, names.length ? `${d.name} defends with ${names.join(', ')} (${linkDefense(l)}).` : `${d.name} doesn’t defend.`);
  s.phase = 'reaction';
  s.priority = l.attacker;
  s.passes = 0;
}

function afterReactionPlay(s: GameState) {
  s.priority = other(s.priority);
  s.passes = 0;
}

function doPass(s: GameState, pitchOrder?: number[]) {
  if (s.phase === 'action' && s.stack?.length) { passOnStack(s); settleStack(s); return; }
  if (pitchOrder) s.players[s.turnPlayer].turn.pitchOrder = pitchOrder;
  if (s.phase === 'reaction') {
    s.passes += 1;
    if (s.passes >= 2) resolveDamage(s);
    else s.priority = other(s.priority);
    return;
  }
  if (s.phase === 'action') {
    closeChain(s);
    s.phase = 'arsenal';
    const p = s.players[s.turnPlayer];
    if (p.arsenal.length > 0 || p.hand.length === 0) endTurn(s);
    return;
  }
  if (s.phase === 'defend') {
    doDefend(s, []);
    return;
  }
  if (s.phase === 'arsenal') endTurn(s);
}

function resolveDamage(s: GameState) {
  const l = currentLink(s)!;
  const attacker = s.players[l.attacker];
  const defender = s.players[other(l.attacker)];
  // "If this is defended by an action card / has N or more power / ... this chain link, ..."
  if (!l.fromWeapon) resolveConditionals(s, attacker, cardOf(l.inst), l.inst, 'ifLink', l);
  const power = linkPower(l);
  const def = linkDefense(l);
  const raw = Math.max(0, power - def);
  const dealt = raw > 0 ? dealDamage(s, defender.id, raw, false, cardOf(l.inst).name) : 0;
  l.hit = dealt > 0;
  if (raw === 0) log(s, null, `${cardOf(l.inst).name} is fully blocked.`);
  if (l.hit && s.phase !== 'gameOver') {
    if (l.fromWeapon) attacker.turn.weaponHits += 1;
    else attacker.turn.attackActionHits += 1;
    const sc = getScript(cardOf(l.inst));
    resolveEffects(s, attacker, [...sc.onHit, ...l.extraOnHit], l.inst); // link is still "current" here
    if (dealt >= 4) for (const cnd of sc.conditional) if (cnd.when === 'crush') { log(s, l.attacker, 'Crush!'); resolveEffects(s, attacker, cnd.effects, l.inst); }
    for (const cnd of sc.conditional) if (cnd.when === 'surge' && dealt > (cnd.threshold ?? 0)) { log(s, l.attacker, 'Surge!'); resolveEffects(s, attacker, cnd.effects, l.inst); }
    if (sc.hitDestination && !l.fromWeapon) l.destination = sc.hitDestination;
    ability(attacker)?.onHit?.(heroCtx(s, attacker), l);
    if (defender.marked) { defender.marked = false; log(s, defender.id, `${defender.name} is no longer marked.`); }
  }
  l.damage = dealt;
  // equipment wear
  for (const d of l.defenders) {
    if (d.kind === 'equipment') {
      const e = defender.equipment.find((e) => e.inst.uid === d.inst.uid)!;
      const esc = getScript(cardOf(e.inst));
      if (esc.bladeBreak) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} breaks (blade break).`, RULES.bladeBreak); }
      else if (esc.battleworn) e.defenseMod -= 1;
      else if (esc.temper) {
        e.defenseMod -= 1;
        if (equipDefense(e) <= 0) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} is destroyed (temper).`, RULES.temper); }
      }
    } else {
      toGraveyard(defender, d.inst);
    }
  }
  // resolution step
  if (s.phase === 'gameOver') return;
  if (l.goAgain) attacker.actionPoints += 1;
  s.phase = 'action';
  s.priority = s.turnPlayer;
  s.passes = 0;
}

function closeChain(s: GameState) {
  for (const l of s.chain) {
    if (l.fromWeapon) continue;
    const owner = s.players[l.attacker];
    if (l.destination === 'soul') { (owner.soul ??= []).push(l.inst); log(s, owner.id, `${cardOf(l.inst).name} is put into ${owner.name}'s soul.`); }
    else if (l.destination === 'deckBottom') owner.deck.push(l.inst);
    else toGraveyard(owner, l.inst);
  }
  if (s.chain.length) log(s, null, 'The combat chain closes.', RULES.chainClose);
  s.chain = [];
  s.chainOpen = false;
}

function doArsenal(s: GameState, uid: number | null) {
  if (s.phase !== 'arsenal') throw new Error('Not the end phase');
  const p = s.players[s.turnPlayer];
  if (uid !== null) {
    if (p.arsenal.length > 0) throw new Error('Arsenal is full');
    const inst = removeFrom(p.hand, uid);
    if (!inst) throw new Error('Card not in hand');
    p.arsenal.push(inst);
    log(s, p.id, `${p.name} puts a card into arsenal.`, RULES.arsenal);
  }
  endTurn(s);
}

function endTurn(s: GameState) {
  const p = s.players[s.turnPlayer];
  for (const pl of s.players) ability(pl)?.endPhase?.(heroCtx(s, pl));
  const debt = ability(p)?.skipBloodDebt?.(heroCtx(s, p)) ? 0 : p.banished.filter((b) => getScript(cardOf(b)).bloodDebt).length;
  if (debt > 0) { p.life -= debt; log(s, p.id, `Blood debt: ${p.name} loses ${debt} life (${p.life}).`); checkWin(s); if (s.phase === 'gameOver') return; }
  // end phase token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    if (name === 'Ponder') { removePermanent(s, p, pm.inst.uid); draw(s, p, 1); }
    else if (name === 'Frostbite' || name === 'Frailty') removePermanent(s, p, pm.inst.uid);
    else if (name === 'Bloodrot Pox') { removePermanent(s, p, pm.inst.uid); dealDamage(s, p.id, 2, false, 'Bloodrot Pox'); }
  }
  for (const pl of s.players) {
    // pitch zone to bottom of deck (in the order the player chose), intimidated cards back to hand
    const order = pl.turn.pitchOrder;
    if (order && order.length === pl.pitch.length && pl.pitch.every((x) => order.includes(x.uid))) {
      pl.pitch = order.map((u) => pl.pitch.find((x) => x.uid === u)!);
      log(s, pl.id, `${pl.name} puts the pitched cards on the bottom of their deck in a chosen order.`, RULES.pitchOrder);
    }
    pl.deck.push(...pl.pitch);
    pl.pitch = [];
    pl.hand.push(...pl.intimidated);
    pl.intimidated = [];
    pl.resources = 0;
    pl.effects = pl.effects.filter((e) => e.kind !== 'preventNext');
  }
  p.actionPoints = 0;
  drawUpTo(s, p);
  if (s.phase === 'gameOver') return;
  if (p.deck.length === 0 && p.hand.length === 0 && p.arsenal.length === 0) {
    log(s, p.id, `${p.name} has no cards left.`);
  }
  s.turnPlayer = other(s.turnPlayer);
  s.turn += 1;
  const outOfCards = (pl: PlayerState) => pl.deck.length + pl.hand.length + pl.arsenal.length === 0;
  if (s.turn > MAX_TURNS || s.players.every(outOfCards)) {
    // simulator safeguard against stalled games: higher life total wins
    const [a, b] = s.players;
    log(s, null, s.turn > MAX_TURNS ? `Turn limit reached.` : 'Both players are out of cards.');
    endGame(s, a.life >= b.life ? 0 : 1);
    return;
  }
  startTurn(s);
}

// ---------------------------------------------------------------- effects

/** Deal damage to a hero, applying prevention. Returns damage actually dealt. */
export function dealDamage(s: GameState, target: PlayerId, amount: number, arcane: boolean, source: string): number {
  const p = s.players[target];
  let dmg = amount;
  if (arcane) {
    // spellvoid / arcane barrier (automatic)
    for (const e of p.equipment) {
      if (dmg <= 0 || e.destroyed) continue;
      const sc = getScript(cardOf(e.inst));
      if (sc.spellvoid > 0) { dmg -= sc.spellvoid; e.destroyed = true; log(s, target, `${cardOf(e.inst).name} (spellvoid) prevents ${sc.spellvoid}.`); }
    }
    for (const pm of [...p.permanents]) {
      const sc = getScript(cardOf(pm.inst));
      if (dmg > 0 && sc.spellvoid > 0) { dmg -= sc.spellvoid; removePermanent(s, p, pm.inst.uid); }
    }
    const barrier = p.equipment.filter((e) => !e.destroyed).reduce((a, e) => a + getScript(cardOf(e.inst)).arcaneBarrier, 0);
    const pay = Math.min(barrier, dmg, p.resources);
    if (pay > 0) { p.resources -= pay; dmg -= pay; log(s, target, `${p.name} pays ${pay} for arcane barrier.`, RULES.arcaneBarrier); }
  }
  // prevention effects
  for (const e of p.effects) {
    if (dmg <= 0) break;
    if (e.kind === 'preventNext' && e.amount > 0) {
      const prevented = Math.min(e.amount, dmg);
      dmg -= prevented;
      e.amount = 0;
      log(s, target, `${prevented} damage prevented (${e.source}).`);
    }
  }
  p.effects = p.effects.filter((e) => !(e.kind === 'preventNext' && e.amount <= 0));
  // ward
  for (const pm of [...p.permanents]) {
    if (dmg <= 0) break;
    if (pm.ward > 0) {
      const prevented = Math.min(pm.ward, dmg);
      dmg -= prevented;
      log(s, target, `${cardOf(pm.inst).name} (ward) prevents ${prevented}.`, RULES.ward);
      removePermanent(s, p, pm.inst.uid);
    }
  }
  // Zen State
  if (dmg > 0 && p.permanents.some((pm) => cardOf(pm.inst).name === 'Zen State')) dmg -= 1;
  dmg = Math.max(0, dmg);
  if (dmg > 0) {
    p.life -= dmg;
    if (arcane) p.turn.arcaneTaken = true;
    log(s, target, `${source} deals ${dmg}${arcane ? ' arcane' : ''} damage to ${p.name} (${p.life} life).`);
  }
  checkWin(s);
  return dmg;
}

function resolveEffects(s: GameState, p: PlayerState, effects: Effect[], src: CardInst) {
  const opp = s.players[other(p.id)];
  const srcName = cardOf(src).name;
  for (const e of effects) {
    if (s.phase === 'gameOver') return;
    const l = currentLink(s);
    switch (e.kind) {
      case 'arcane': {
        const amp = p.effects.filter((x) => x.kind === 'ampArcane').reduce((a, x) => a + (x.kind === 'ampArcane' ? x.amount : 0), 0);
        if (amp) { p.effects = p.effects.filter((x) => x.kind !== 'ampArcane'); log(s, p.id, `Arcane damage amplified by ${amp}.`); }
        if (dealDamage(s, opp.id, e.amount + amp, true, srcName) > 0) p.turn.arcaneDealt = true;
        break;
      }
      case 'ampArcane': p.effects.push({ kind: 'ampArcane', amount: e.amount, source: srcName }); log(s, p.id, `Next arcane damage effect deals +${e.amount}.`); break;
      case 'weakenAttack': if (l) { l.powerMod -= e.amount; log(s, p.id, `${cardOf(l.inst).name} gets -${e.amount} power (${linkPower(l)}).`); } break;
      case 'damage': dealDamage(s, opp.id, e.amount, false, srcName); break;
      case 'gainLife': p.life += e.amount; log(s, p.id, `${p.name} gains ${e.amount} life (${p.life}).`); break;
      case 'loseLifeOpp': opp.life -= e.amount; log(s, opp.id, `${opp.name} loses ${e.amount} life (${opp.life}).`); break;
      case 'draw': draw(s, p, e.amount); log(s, p.id, `${p.name} draws ${e.amount} card${e.amount > 1 ? 's' : ''}.`); break;
      case 'gainResource': p.resources += e.amount; break;
      case 'nextAttackPower':
        p.effects.push({ kind: 'nextAttackPower', amount: e.amount, filter: e.filter, source: srcName });
        log(s, p.id, `Next ${describeFilter(e.filter)} gets +${e.amount} power.`);
        break;
      case 'nextAttackGoAgain': p.effects.push({ kind: 'nextAttackGoAgain', filter: e.filter, source: srcName }); break;
      case 'targetAttackPower':
        if (l && l.attacker === p.id && matchesFilter(e.filter, l)) { l.powerMod += e.amount; log(s, p.id, `${cardOf(l.inst).name} gets +${e.amount} power (${linkPower(l)}).`); }
        break;
      case 'targetAttackGoAgain': if (l && matchesFilter(e.filter, l)) l.goAgain = true; break;
      case 'thisPower': if (l && l.inst.uid === src.uid) l.powerMod += e.amount; break;
      case 'thisGoAgain': if (l && l.inst.uid === src.uid) l.goAgain = true; break;
      case 'thisDominate': if (l && l.inst.uid === src.uid) l.dominate = true; break;
      case 'thisDefense': {
        const def = l?.defenders.find((d) => d.inst.uid === src.uid);
        if (def) { def.defense += e.amount; log(s, p.id, `${srcName} gets +${e.amount} defense.`); }
        break;
      }
      case 'thisOverpower': if (l && l.inst.uid === src.uid) l.overpower = true; break;
      case 'sharpen': {
        const sword = p.weapons.find((w) => cardOf(w.inst).types.includes('Sword'));
        if (sword) { sword.counters = (sword.counters ?? 0) + e.times; log(s, p.id, `${cardOf(sword.inst).name} is sharpened (+${e.times}{p} counter${e.times > 1 ? 's' : ''}).`, 'Sharpen: put a +1{p} counter on a sword weapon you control.'); }
        break;
      }
      case 'tutor': {
        const i = p.deck.findIndex((d) => cardOf(d).name.toLowerCase() === e.name.toLowerCase());
        if (i >= 0) { const [t] = p.deck.splice(i, 1); p.hand.push(t); shuffle(s, p.deck); log(s, p.id, `${p.name} searches their deck for ${cardOf(t).name}.`); }
        else log(s, p.id, `${p.name} finds no ${e.name} in their deck.`);
        break;
      }
      case 'preventNext': p.effects.push({ kind: 'preventNext', amount: e.amount, source: srcName }); break;
      case 'createToken': createToken(s, p, e.name, e.amount); break;
      case 'banishTopOpp':
        for (let i = 0; i < e.amount; i++) { const t = opp.deck.shift(); if (t) { opp.banished.push(t); log(s, opp.id, `${cardOf(t).name} is banished from the top of ${opp.name}'s deck.`); } }
        break;
      case 'oppDiscardRandom':
        for (let i = 0; i < e.amount; i++) {
          if (!opp.hand.length) break;
          const d = opp.hand.splice(Math.floor(rand(s) * opp.hand.length), 1)[0];
          opp.graveyard.push(d);
          log(s, opp.id, `${opp.name} discards ${cardOf(d).name}.`);
        }
        break;
      case 'intimidate':
        p.turn.intimidated = true;
        if (opp.hand.length) {
          const d = opp.hand.splice(Math.floor(rand(s) * opp.hand.length), 1)[0];
          opp.intimidated.push(d);
          log(s, opp.id, `Intimidate: a random card from ${opp.name}'s hand is banished until end of turn.`, RULES.intimidate);
        }
        break;
      case 'opt': {
        // simplified opt: blue cards stay on top, others go to the bottom
        const top = p.deck.splice(0, e.amount);
        const keep = top.filter((t) => pitchOf(cardOf(t)) !== 3 || has(cardOf(t), 'Defense Reaction'));
        const bottom = top.filter((t) => !keep.includes(t));
        p.deck.unshift(...keep);
        p.deck.push(...bottom);
        log(s, p.id, `${p.name} opts ${e.amount}.`);
        break;
      }
      case 'mark': opp.marked = true; break;
      case 'discardRandom': {
        let best = -1;
        for (let i = 0; i < e.amount; i++) {
          if (!p.hand.length) break;
          const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
          p.graveyard.push(d);
          noteDiscard(s, p, d);
          best = Math.max(best, powerOf(cardOf(d)));
          log(s, p.id, `${p.name} discards ${cardOf(d).name} at random.`);
        }
        if (e.then && e.ifPower !== undefined && best >= e.ifPower) resolveEffects(s, p, e.then, src);
        break;
      }
      case 'destroyOwnThen': {
        const pm = p.permanents.find((x) => { const c = cardOf(x.inst); return e.name ? c.name.toLowerCase() === e.name.toLowerCase() : !!e.type && c.types.includes(e.type); });
        if (!pm) { log(s, p.id, `${p.name} has nothing to destroy, so nothing else happens.`); break; }
        removePermanent(s, p, pm.inst.uid);
        resolveEffects(s, p, e.then, src);
        break;
      }
      case 'banishTopSelf':
        for (let i = 0; i < e.amount; i++) { const t = p.deck.shift(); if (t) { p.banished.push(t); log(s, p.id, `${p.name} banishes ${cardOf(t).name} from the top of their deck.`); } }
        break;
      case 'createInHand': {
        const t = findCard(e.name);
        if (t) { p.hand.push(mk(s, t.id, p.id)); log(s, p.id, `${p.name} creates ${t.name} in their hand.`); }
        break;
      }
      case 'nextAttackOnHit': p.effects.push({ kind: 'nextAttackOnHit', filter: e.filter, effects: e.effects, source: srcName }); break;
      case 'reload': {
        if (p.arsenal.length > 0 || p.hand.length === 0) break;
        const pick = [...p.hand].sort((a, b) => cardPlayValue(cardOf(b)) - cardPlayValue(cardOf(a)))[0];
        removeFrom(p.hand, pick.uid);
        p.arsenal.push(pick);
        log(s, p.id, `${p.name} reloads: a card from hand goes face down into the arsenal.`, 'Reload: if you have no card in your arsenal, you may put a card from your hand face down into your arsenal.');
        break;
      }
      case 'clash': {
        if (e.guardianOnly && (!l || !cardOf(l.inst).types.includes('Guardian'))) break;
        const w = clash(s);
        if (w !== null && e.winnerToken) createToken(s, s.players[w], e.winnerToken, 1);
        if (w === p.id && e.ifWin) resolveEffects(s, p, e.ifWin, src);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- manual & misc

function doManual(s: GameState, a: Extract<Action, { type: 'manual' }>) {
  switch (a.op) {
    case 'draw': draw(s, s.players[a.player]); log(s, a.player, `[manual] ${pname(s, a.player)} draws a card.`); break;
    case 'life': s.players[a.player].life += a.amount; log(s, a.player, `[manual] ${pname(s, a.player)} life ${a.amount > 0 ? '+' : ''}${a.amount} (${s.players[a.player].life}).`); break;
    case 'resource': s.players[a.player].resources = Math.max(0, s.players[a.player].resources + a.amount); log(s, a.player, `[manual] resources ${a.amount > 0 ? '+' : ''}${a.amount}.`); break;
    case 'actionPoint': s.players[a.player].actionPoints = Math.max(0, s.players[a.player].actionPoints + a.amount); log(s, a.player, `[manual] action points ${a.amount > 0 ? '+' : ''}${a.amount}.`); break;
    case 'power': { const l = currentLink(s); if (l) { l.powerMod += a.amount; log(s, l.attacker, `[manual] attack power ${a.amount > 0 ? '+' : ''}${a.amount} (${linkPower(l)}).`); } break; }
    case 'discard': { const p = s.players[a.player]; const c = removeFrom(p.hand, a.uid); if (c) { p.graveyard.push(c); log(s, a.player, `[manual] discards ${cardOf(c).name}.`); } break; }
    case 'returnFromGraveyard': { const p = s.players[a.player]; const c = removeFrom(p.graveyard, a.uid); if (c) { p.hand.push(c); log(s, a.player, `[manual] returns ${cardOf(c).name} to hand.`); } break; }
    case 'token': createToken(s, s.players[a.player], a.name, 1); break;
    case 'move': {
      const p = s.players[a.player];
      const zones: [string, CardInst[]][] = [['hand', p.hand], ['arsenal', p.arsenal], ['pitch', p.pitch], ['graveyard', p.graveyard], ['banished', p.banished], ['deck', p.deck], ['soul', p.soul ?? []], ['intimidated', p.intimidated]];
      let inst: CardInst | undefined;
      let from = '';
      for (const [name, list] of zones) { const c = removeFrom(list, a.uid); if (c) { inst = c; from = name; break; } }
      if (!inst) {
        const pm = p.permanents.find((x) => x.inst.uid === a.uid);
        if (pm) { p.permanents = p.permanents.filter((x) => x !== pm); inst = pm.inst; from = 'the arena'; }
      }
      if (!inst) throw new Error('Card not found');
      switch (a.to) {
        case 'hand': p.hand.push(inst); break;
        case 'arsenal': p.arsenal.push(inst); break;
        case 'pitch': p.pitch.push(inst); break;
        case 'graveyard': p.graveyard.push(inst); break;
        case 'banished': p.banished.push(inst); break;
        case 'soul': (p.soul ??= []).push(inst); break;
        case 'deck': if (a.bottom) p.deck.push(inst); else p.deck.unshift(inst); break;
        case 'arena': p.permanents.push({ inst, ward: getScript(cardOf(inst)).ward }); break;
      }
      const hidden = from === 'deck' || (a.to === 'deck');
      const where = a.to === 'deck' ? `the ${a.bottom ? 'bottom' : 'top'} of the deck` : a.to === 'arena' ? 'the arena' : a.to;
      log(s, a.player, `[manual] ${pname(s, a.player)} moves ${hidden && from === 'deck' ? 'a card' : cardOf(inst).name} from ${from} to ${where}.`);
      break;
    }
    case 'shuffle': { const p = s.players[a.player]; p.deck = shuffle(s, p.deck); log(s, a.player, `[manual] ${pname(s, a.player)} shuffles their deck.`); break; }
    case 'counter': {
      const p = s.players[a.player];
      const pm = p.permanents.find((x) => x.inst.uid === a.uid);
      const eq = p.equipment.find((x) => x.inst.uid === a.uid);
      const w = p.weapons.find((x) => x.inst.uid === a.uid);
      if (pm) { pm.counters = Math.max(0, (pm.counters ?? 0) + a.amount); log(s, a.player, `[manual] ${cardOf(pm.inst).name}: ${pm.counters} counter${pm.counters === 1 ? '' : 's'}.`); }
      else if (eq) { eq.defenseMod += a.amount; log(s, a.player, `[manual] ${cardOf(eq.inst).name} defense ${a.amount > 0 ? '+' : ''}${a.amount}.`); }
      else if (w) { w.counters = Math.max(0, (w.counters ?? 0) + a.amount); log(s, a.player, `[manual] ${cardOf(w.inst).name}: +${w.counters}{p} counters.`); }
      break;
    }
    case 'equipment': {
      const eq = s.players[a.player].equipment.find((x) => x.inst.uid === a.uid);
      if (eq) { eq.destroyed = a.destroyed; log(s, a.player, `[manual] ${cardOf(eq.inst).name} ${a.destroyed ? 'is destroyed' : 'is restored'}.`); }
      break;
    }
  }
}

function checkWin(s: GameState) {
  if (s.phase === 'gameOver') return;
  for (const p of s.players) {
    if (p.life <= 0) {
      endGame(s, other(p.id));
      return;
    }
  }
}

function endGame(s: GameState, winner: PlayerId) {
  s.phase = 'gameOver';
  s.winner = winner;
  log(s, winner, `${pname(s, winner)} wins!`);
}

export function pendingEffectsText(p: PlayerState): string[] {
  return p.effects.map((e: TurnEffect) => {
    if (e.kind === 'nextAttackPower') return `Next ${describeFilter(e.filter)} +${e.amount} power (${e.source})`;
    if (e.kind === 'nextAttackGoAgain') return `Next ${describeFilter(e.filter)} gets go again (${e.source})`;
    if (e.kind === 'ampArcane') return `Next arcane damage +${e.amount} (${e.source})`;
    if (e.kind === 'nextAttackOnHit') return `Next ${describeFilter(e.filter)} gets an on-hit effect (${e.source})`;
    return `Prevent next ${e.amount} damage (${e.source})`;
  });
}

/** Auto-choose cards to pitch for a cost: prefer the least valuable, then minimise waste. */
export function autoPitch(p: PlayerState, cost: number, exclude: number[] = []): number[] | null {
  const need = cost - p.resources;
  if (need <= 0) return [];
  const cands = p.hand.filter((h) => !exclude.includes(h.uid)).map((h) => ({ uid: h.uid, c: cardOf(h) }));
  let best: { uids: number[]; score: number } | null = null;
  const m = cands.length;
  for (let mask = 1; mask < 1 << m; mask++) {
    let total = 0;
    let value = 0;
    const uids: number[] = [];
    for (let i = 0; i < m; i++) {
      if (!(mask & (1 << i))) continue;
      const c = cands[i].c;
      total += pitchOf(c);
      value += cardPlayValue(c);
      uids.push(cands[i].uid);
    }
    if (total < need) continue;
    const score = value + (total - need) * 0.6;
    if (!best || score < best.score) best = { uids, score };
  }
  return best ? best.uids : null;
}

/** Rough value of keeping a card to play rather than pitching it. */
export function cardPlayValue(c: Card): number {
  const sc = getScript(c);
  let v = 0;
  if (has(c, 'Attack') && has(c, 'Action')) v = powerOf(c) - costOf(c) * 0.5 + (sc.goAgain ? 1.5 : 0);
  else if (has(c, 'Attack Reaction')) v = 2;
  else if (has(c, 'Defense Reaction')) v = (defenseOf(c) ?? 0) * 0.8;
  else if (has(c, 'Action') || has(c, 'Instant')) v = 2.5;
  else v = 0;
  if (pitchOf(c) === 3) v -= 1.5;
  if (pitchOf(c) === 1) v += 0.5;
  return Math.max(0, v);
}
