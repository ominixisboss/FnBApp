// Flesh and Blood rules engine (core rules). Pure functions: every action returns a new state.
import type { Card } from '../data/types';
import { card, findCard, has, n } from '../data/cardDb';
import { getScript, describeFilter } from './cardScript';
import type { AttackFilter, Effect, Mode } from './cardScript';
import type {
  Action, CardInst, ChainLink, Defender, Difficulty, GameState, PlayerId, PlayerState, TurnEffect,
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

function log(s: GameState, player: PlayerId | null, text: string) {
  s.log.push({ turn: s.turn, player, text: secondPerson(text) });
}

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
  }
}

// ---------------------------------------------------------------- setup

export function createGame(setup: [PlayerSetup, PlayerSetup], seed = Date.now() & 0x7fffffff, format = 'blitz'): GameState {
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
      hand: [], arsenal: [], pitch: [], graveyard: [], banished: [], intimidated: [],
      weapons: [], equipment: [], permanents: [], resources: 0, actionPoints: 0, effects: [], marked: false,
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
  s.turnPlayer = rand(s) < 0.5 ? 0 : 1;
  s.priority = s.turnPlayer;
  log(s, null, `${pname(s, s.turnPlayer)} goes first.`);
  for (const p of s.players) drawUpTo(s, p);
  startTurn(s);
  return s;
}

function draw(s: GameState, p: PlayerState, count = 1) {
  void s;
  for (let i = 0; i < count; i++) {
    const c = p.deck.shift();
    if (!c) return;
    p.hand.push(c);
  }
}

function drawUpTo(s: GameState, p: PlayerState) {
  const need = p.intellect - p.hand.length;
  if (need > 0) draw(s, p, need);
}

function startTurn(s: GameState) {
  const p = s.players[s.turnPlayer];
  p.actionPoints = 1;
  p.resources = 0;
  p.effects = [];
  p.weapons.forEach((w) => (w.usedThisTurn = false));
  p.equipment.forEach((e) => (e.usedThisTurn = false));
  s.phase = 'action';
  s.priority = s.turnPlayer;
  log(s, s.turnPlayer, `— Turn ${s.turn}: ${p.name} —`);
  // start of turn token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    const destroy = () => removePermanent(s, p, pm.inst.uid);
    if (name === 'Agility') { destroy(); p.effects.push({ kind: 'nextAttackGoAgain', filter: { kind: 'any' }, source: name }); }
    else if (name === 'Might') { destroy(); p.effects.push({ kind: 'nextAttackPower', amount: 1, filter: { kind: 'any' }, source: name }); }
    else if (name === 'Vigor') { destroy(); p.resources += 1; }
    else if (['Embodiment of Earth', 'Sigil of Fate', 'Seismic Surge'].includes(name)) destroy();
    else if (getScript(cardOf(pm.inst)).unparsed.some((u) => /^at the beginning of your action phase, destroy this\.?$/i.test(u))) destroy();
  }
}

function removePermanent(s: GameState, p: PlayerState, uid: number) {
  const i = p.permanents.findIndex((pm) => pm.inst.uid === uid);
  if (i < 0) return;
  const [pm] = p.permanents.splice(i, 1);
  if (!has(cardOf(pm.inst), 'Token')) p.graveyard.push(pm.inst);
  log(s, p.id, `${cardOf(pm.inst).name} leaves the arena.`);
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
  return costOf(c) + frostbite(p);
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

export function playOptions(s: GameState, pid: PlayerId): PlayOption[] {
  const p = s.players[pid];
  const out: PlayOption[] = [];
  if (s.priority !== pid || !['action', 'reaction'].includes(s.phase)) return out;
  for (const inst of [...p.hand, ...p.arsenal]) {
    const c = cardOf(inst);
    if (!timingOk(s, pid, c)) continue;
    const cost = effectiveCost(s, p, c);
    const sc = getScript(c);
    const extra = (sc.additionalCost.discardRandom ?? 0) + (sc.additionalCost.banishRandomHand ?? 0);
    if (extra > 0 && p.hand.filter((h) => h.uid !== inst.uid).length < extra) continue;
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
      } else if (s.phase !== 'action' || s.turnPlayer !== pid || p.actionPoints < 1) return;
      const cost = a.cost + frostbite(p);
      if (availableResources(p) < cost) return;
      out.push({ uid: src.inst.uid, kind: 'activation', index, cost, label: `${cardOf(src.inst).name}: ${a.attack ? 'Attack' : a.text.split(':').slice(1).join(':').trim()}` });
    });
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
  for (const h of p.hand) {
    const d = defenseOf(cardOf(h));
    if (d === null) continue;
    out.push({ uid: h.uid, kind: 'hand', defense: d });
  }
  for (const e of p.equipment) {
    if (e.destroyed || defenseOf(cardOf(e.inst)) === null) continue;
    out.push({ uid: e.inst.uid, kind: 'equipment', defense: equipDefense(e) });
  }
  return out;
}

/** Validate a block. Returns an error message or null. */
export function checkDefense(s: GameState, uids: number[]): string | null {
  const l = currentLink(s);
  if (!l) return 'No attack to defend';
  const p = s.players[other(l.attacker)];
  const fromHand = uids.filter((u) => p.hand.some((h) => h.uid === u));
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
  switch (action.type) {
    case 'play': doPlay(s, action.uid, action.pitch, action.mode ?? 0); break;
    case 'activate': doActivate(s, action.uid, action.index, action.pitch); break;
    case 'pass': doPass(s); break;
    case 'defend': doDefend(s, action.uids); break;
    case 'arsenal': doArsenal(s, action.uid); break;
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
    p.pitch.push(inst);
    log(s, p.id, `${p.name} pitches ${c.name} (+${pitchOf(c)}).`);
  }
  if (p.resources < cost) throw new Error(`Not enough resources (need ${cost}, have ${p.resources})`);
  p.resources -= cost;
  // Frostbite: destroyed when you play a card / activate
  const fb = p.permanents.find((pm) => cardOf(pm.inst).name === 'Frostbite');
  if (fb) removePermanent(s, p, fb.inst.uid);
}

function doPlay(s: GameState, uid: number, pitch: number[], mode: number) {
  const pid = s.priority;
  const p = s.players[pid];
  const opt = playOptions(s, pid).find((o) => o.uid === uid && o.kind === 'card');
  if (!opt) throw new Error('That card can’t be played now');
  const fromArsenal = p.arsenal.some((a) => a.uid === uid);
  const inst = removeFrom(fromArsenal ? p.arsenal : p.hand, uid)!;
  const c = cardOf(inst);
  const sc = getScript(c);
  pay(s, p, opt.cost, pitch);
  // additional costs
  for (let i = 0; i < (sc.additionalCost.discardRandom ?? 0); i++) {
    const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
    if (d) { p.graveyard.push(d); log(s, pid, `${p.name} discards ${cardOf(d).name} at random.`); }
  }
  for (let i = 0; i < (sc.additionalCost.banishRandomHand ?? 0); i++) {
    const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
    if (d) { p.banished.push(d); log(s, pid, `${p.name} banishes ${cardOf(d).name} at random.`); }
  }
  const isAction = has(c, 'Action') && !has(c, 'Instant');
  if (s.phase === 'action' && isAction) p.actionPoints -= 1;
  log(s, pid, `${p.name} plays ${c.name}${fromArsenal ? ' from arsenal' : ''}.`);

  const chosen = sc.modes[mode];
  if (chosen) log(s, pid, `Mode: ${chosen.label}.`);
  if (has(c, 'Attack') && has(c, 'Action')) {
    startAttack(s, p, inst, false, fromArsenal, chosen);
    return;
  }
  if (chosen) resolveEffects(s, p, chosen.onPlay, inst);
  if (has(c, 'Attack Reaction')) {
    resolveEffects(s, p, sc.onPlay, inst);
    p.graveyard.push(inst);
    afterReactionPlay(s);
    return;
  }
  if (has(c, 'Defense Reaction')) {
    const l = currentLink(s)!;
    const def: Defender = { kind: 'reaction', inst, defense: defenseOf(c) ?? 0 };
    l.defenders.push(def);
    for (const e of sc.onPlay) {
      if (e.kind === 'thisDefense') def.defense += e.amount;
      else resolveEffects(s, p, [e], inst);
    }
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
  resolveEffects(s, p, sc.onPlay, inst);
  if (fromArsenal) for (const cnd of sc.conditional) resolveEffects(s, p, cnd.effects, inst);
  if (['Aura', 'Item', 'Ally'].some((t) => has(c, t))) {
    p.permanents.push({ inst, ward: sc.ward });
  } else {
    p.graveyard.push(inst);
  }
  if (isAction && goAgain && s.phase === 'action') p.actionPoints += 1;
  if (s.phase === 'reaction') afterReactionPlay(s);
}

function doActivate(s: GameState, uid: number, index: number, pitch: number[]) {
  const pid = s.priority;
  const p = s.players[pid];
  const opt = playOptions(s, pid).find((o) => o.uid === uid && o.kind === 'activation' && o.index === index);
  if (!opt) throw new Error('That ability can’t be activated now');
  const found = findInst(s, uid)!;
  const c = cardOf(found.inst);
  const a = getScript(c).activations[index];
  pay(s, p, opt.cost, pitch);
  if (!a.instant) p.actionPoints -= 1;
  const w = p.weapons.find((w) => w.inst.uid === uid);
  if (w && a.oncePerTurn) w.usedThisTurn = true;
  const e = p.equipment.find((e) => e.inst.uid === uid);
  if (e && a.oncePerTurn) e.usedThisTurn = true;
  log(s, pid, `${p.name} activates ${c.name}.`);
  if (a.attack) {
    startAttack(s, p, found.inst, true, false);
    if (a.goAgain) currentLink(s)!.goAgain = true;
    return;
  }
  resolveEffects(s, p, a.effects, found.inst);
  if (a.destroySelf) {
    if (e) { e.destroyed = true; log(s, pid, `${c.name} is destroyed.`); }
    else removePermanent(s, p, uid);
  }
  if (!a.instant && a.goAgain) p.actionPoints += 1;
  if (s.phase === 'reaction') afterReactionPlay(s);
}

function startAttack(s: GameState, p: PlayerState, inst: CardInst, fromWeapon: boolean, fromArsenal: boolean, mode?: Mode) {
  const c = cardOf(inst);
  const sc = getScript(c);
  const link: ChainLink = {
    attacker: p.id, inst, fromWeapon, fromArsenal, basePower: powerOf(c), powerMod: 0,
    goAgain: sc.goAgain, dominate: sc.dominate, overpower: sc.overpower, piercing: sc.piercing,
    defenders: [], reactions: [], damage: null, hit: false, extraOnHit: mode?.onHit ?? [],
  };
  s.chain.push(link);
  s.chainOpen = true;
  // pending "next attack" effects
  p.effects = p.effects.filter((e) => {
    if (e.kind === 'nextAttackPower' && matchesFilter(e.filter, link)) { link.powerMod += e.amount; return false; }
    if (e.kind === 'nextAttackGoAgain' && matchesFilter(e.filter, link)) { link.goAgain = true; return false; }
    return true;
  });
  // token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    const destroy = () => removePermanent(s, p, pm.inst.uid);
    if (name === 'Runechant') { destroy(); dealDamage(s, other(p.id), 1, true, 'Runechant'); }
    else if (name === 'Quicken') { destroy(); link.goAgain = true; }
    else if (name === 'Courage') { destroy(); link.powerMod += 1; }
    else if (name === 'Embodiment of Lightning' && !fromWeapon) { destroy(); link.goAgain = true; }
    else if (name === 'Blade Dance' && fromWeapon) { destroy(); link.goAgain = true; }
  }
  if (!fromWeapon) {
    resolveEffects(s, p, sc.onPlay, inst);
    if (mode) resolveEffects(s, p, mode.onPlay, inst);
    if (fromArsenal) for (const cnd of sc.conditional) resolveEffects(s, p, cnd.effects, inst);
    if (sc.boost && p.deck.length > 0) {
      const top = p.deck.shift()!;
      p.banished.push(top);
      const mech = has(cardOf(top), 'Mechanologist');
      log(s, p.id, `${p.name} boosts, banishing ${cardOf(top).name}${mech ? ' — go again!' : '.'}`);
      if (mech) link.goAgain = true;
    }
  }
  if (sc.intimidateOnAttack) resolveEffects(s, p, [{ kind: 'intimidate' }], inst);
  resolveEffects(s, p, sc.onAttack, inst);
  if (mode) resolveEffects(s, p, mode.onAttack, inst);
  if (s.phase === 'gameOver') return;
  log(s, p.id, `Attack: ${c.name} — ${linkPower(link)} power${link.goAgain ? ', go again' : ''}${link.dominate ? ', dominate' : ''}.`);
  s.phase = 'defend';
  s.priority = other(p.id);
}

function doDefend(s: GameState, uids: number[]) {
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
      l.defenders.push({ kind: 'hand', inst: h, defense: defenseOf(cardOf(h)) ?? 0 });
      names.push(cardOf(h).name);
      continue;
    }
    const e = d.equipment.find((e) => e.inst.uid === uid && !e.destroyed);
    if (!e) throw new Error('Invalid defending card');
    l.defenders.push({ kind: 'equipment', inst: e.inst, defense: equipDefense(e) });
    names.push(cardOf(e.inst).name);
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

function doPass(s: GameState) {
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
  const power = linkPower(l);
  const def = linkDefense(l);
  const raw = Math.max(0, power - def);
  const dealt = raw > 0 ? dealDamage(s, defender.id, raw, false, cardOf(l.inst).name) : 0;
  l.damage = dealt;
  l.hit = dealt > 0;
  if (raw === 0) log(s, null, `${cardOf(l.inst).name} is fully blocked.`);
  if (l.hit && s.phase !== 'gameOver') {
    const sc = getScript(cardOf(l.inst));
    resolveEffects(s, attacker, [...sc.onHit, ...l.extraOnHit], l.inst);
  }
  // equipment wear
  for (const d of l.defenders) {
    if (d.kind === 'equipment') {
      const e = defender.equipment.find((e) => e.inst.uid === d.inst.uid)!;
      const esc = getScript(cardOf(e.inst));
      if (esc.bladeBreak) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} breaks (blade break).`); }
      else if (esc.battleworn) e.defenseMod -= 1;
      else if (esc.temper) {
        e.defenseMod -= 1;
        if (equipDefense(e) <= 0) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} is destroyed (temper).`); }
      }
    } else {
      defender.graveyard.push(d.inst);
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
    if (!l.fromWeapon) s.players[l.attacker].graveyard.push(l.inst);
  }
  if (s.chain.length) log(s, null, 'The combat chain closes.');
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
    log(s, p.id, `${p.name} puts a card into arsenal.`);
  }
  endTurn(s);
}

function endTurn(s: GameState) {
  const p = s.players[s.turnPlayer];
  // end phase token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    if (name === 'Ponder') { removePermanent(s, p, pm.inst.uid); draw(s, p, 1); }
    else if (name === 'Frostbite' || name === 'Frailty') removePermanent(s, p, pm.inst.uid);
    else if (name === 'Bloodrot Pox') { removePermanent(s, p, pm.inst.uid); dealDamage(s, p.id, 2, false, 'Bloodrot Pox'); }
  }
  for (const pl of s.players) {
    // pitch zone to bottom of deck, intimidated cards back to hand
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
    if (pay > 0) { p.resources -= pay; dmg -= pay; log(s, target, `${p.name} pays ${pay} for arcane barrier.`); }
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
      log(s, target, `${cardOf(pm.inst).name} (ward) prevents ${prevented}.`);
      removePermanent(s, p, pm.inst.uid);
    }
  }
  // Zen State
  if (dmg > 0 && p.permanents.some((pm) => cardOf(pm.inst).name === 'Zen State')) dmg -= 1;
  dmg = Math.max(0, dmg);
  if (dmg > 0) {
    p.life -= dmg;
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
      case 'arcane': dealDamage(s, opp.id, e.amount, true, srcName); break;
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
      case 'thisDefense': break;
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
        if (opp.hand.length) {
          const d = opp.hand.splice(Math.floor(rand(s) * opp.hand.length), 1)[0];
          opp.intimidated.push(d);
          log(s, opp.id, `Intimidate: a random card from ${opp.name}'s hand is banished until end of turn.`);
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
