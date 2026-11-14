// Flesh and Blood rules engine (core rules). Pure functions: every action returns a new state.
import type { Card } from '../data/types';
import { card, findCard, getDb, has, n } from '../data/cardDb';
import { getScript, describeFilter } from './cardScript';
import { getHeroAbility } from './heroes';
import type { HeroApi, HeroCtx } from './heroes';
import type { AttackFilter, Condition, Effect, Mode, OptionalCost, OptionalCostKind, TriggerEvent } from './cardScript';
import type { Layer, PermanentState } from './types';
import type {
  Action, CardInst, ChainLink, Difficulty, GameState, OptionalChoice, PendingChoice, PlayerId, PlayerState, TurnEffect,
} from './types';

export interface DeckList {
  heroId: string;
  weaponIds: string[];
  equipmentIds: string[];
  cardIds: string[];
  /** cards outside the deck the hero may fetch (Taylor's equipment, The Librarian's Tomes) */
  inventoryIds?: string[];
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

// ---------------------------------------------------------------- seats (two players, or 3-4 in Ultimate Pit Fight)

export const alivePlayers = (s: GameState) => s.players.filter((p) => !p.eliminated);
/** the next player round the table who is still in the game */
export function nextAlive(s: GameState, pid: PlayerId): PlayerId {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) { const q = ((pid + i) % n) as PlayerId; if (!s.players[q].eliminated) return q; }
  return pid;
}
/** Who a player may attack or target: in Ultimate Pit Fight only the heroes to their immediate left and right. */
export function targetableOpponents(s: GameState, pid: PlayerId): PlayerId[] {
  const n = s.players.length;
  // events: "you may attack any opposing hero"
  if (s.players[pid].turn?.flags.anyTarget) return s.players.filter((q) => q.id !== pid && !q.eliminated).map((q) => q.id);
  const out: PlayerId[] = [];
  const step = (dir: 1 | -1) => { for (let i = 1; i < n; i++) { const q = ((pid + dir * i + n * 4) % n) as PlayerId; if (!s.players[q].eliminated) return q; } return null; };
  for (const q of [step(1), step(-1)]) if (q !== null && q !== pid && !out.includes(q)) out.push(q);
  return out;
}
/** The opponent an effect of this player means: the other side of the current attack, or their chosen focus. */
export function oppOf(s: GameState, pid: PlayerId): PlayerId {
  if (s.players.length === 2) return other(pid);
  const l = s.chain[s.chain.length - 1];
  if (l) {
    const d = defenderOf(l);
    if (pid === l.attacker) return d;
    if (pid === d) return l.attacker;
  }
  const t = targetableOpponents(s, pid);
  const f = s.players[pid].focus;
  return f !== undefined && t.includes(f) ? f : t[0] ?? other(pid);
}
export const defenderOf = (l: ChainLink): PlayerId => l.defender ?? other(l.attacker);
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
  tap: '{t} (tap): turn the card sideways. A tapped hero or permanent can\u2019t pay another {t} cost until it untaps at the start of its controller\u2019s turn.',
  wager: 'Wager: when this chain link resolves, if the attack hit, its attacker wins the wager; otherwise the defending hero does. The winner gets what was wagered.',
  crowd: 'The crowd cheering or booing does nothing by itself, but some cards and heroes react to it.',
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
    crowd: (p, cheer) => crowd(s, p, cheer),
    random: () => rand(s),
    askReload: (p) => {
      if (p.arsenal.length || !p.hand.length) return;
      if (p.isBot) { const pick = [...p.hand].sort((a, b) => cardPlayValue(cardOf(b)) - cardPlayValue(cardOf(a)))[0]; removeFrom(p.hand, pick.uid); p.arsenal.push(pick); log(s, p.id, `${p.name} puts a card face down into the arsenal.`); return; }
      ask(s, { player: p.id, kind: 'reload', prompt: 'You may put a card from your hand face down into your arsenal.', options: p.hand.map((h) => ({ uid: h.uid, cardId: h.cardId })), resume: { type: 'reload' } });
    },
    clash: (p) => { const w = clash(s); void p; return w === null ? null : s.players[w]; },
    ask: (chooser, owner, key, prompt, botYes, data, cards) => ask(s, { player: chooser.id, kind: 'yesno', prompt, options: (cards ?? []).map((cid, i) => ({ uid: -1 - i, cardId: cid })), resume: { type: 'hero', owner: owner.id, key, data, botYes } }),
    equip: (p, cid) => equipCard(s, p, cid),
    orderEvents: (p) => {
      const top = (s.eventDeck ?? []).slice(0, 3);
      if (!top.length) return;
      if (p.isBot) {
        // the events that help Kox most go on top: Gold and card draw first, punishing ones last
        const good = ['Hit the Jackpot', 'Benefactor of Bloodworth Goldmane', 'Tremor of Anticipation', 'Rally the Underdog', 'Arena Medic', 'Crushing Impact'];
        const score = (cid: string) => { const i = good.indexOf(card(cid).name); return i < 0 ? 99 : i; };
        s.eventDeck!.splice(0, top.length, ...[...top].sort((a, b) => score(a) - score(b)));
        log(s, p.id, `${p.name} looks at the top ${top.length} cards of the event deck and puts them back in an order.`);
        return;
      }
      ask(s, { player: p.id, kind: 'opt', prompt: 'Fightmaster Kox: tap the events in the order you want them to come (first = next). Any you leave go after them.', options: top.map((cid, i) => ({ uid: -1 - i, cardId: cid })), resume: { type: 'eventOrder' } });
    },
    pick: (chooser, owner, key, prompt, options, data) => ask(s, { player: chooser.id, kind: 'target', prompt, options: options.map((i) => ({ uid: i.uid, cardId: i.cardId })), resume: { type: 'hero', owner: owner.id, key, data, botYes: true } }),
    targets: (p) => targetableOpponents(s, p.id).map((q) => s.players[q]),
    pay: (p, amount) => {
      if (availableResources(p, []) < amount) return false;
      pay(s, p, amount, autoPitch(p, amount) ?? []);
      return true;
    },
    removeEquipment: (p, uid) => {
      const i = p.equipment.findIndex((e) => e.inst.uid === uid);
      return i < 0 ? null : p.equipment.splice(i, 1)[0].inst;
    },
    discard: (p, inst) => {
      if (!removeFrom(p.hand, inst.uid)) return;
      p.graveyard.push(inst);
      noteDiscard(s, p, inst);
      log(s, p.id, `${p.name} discards ${cardOf(inst).name}.`);
    },
    intimidate: (t) => {
      s.players[oppOf(s, t.id)].turn.intimidated = true;
      if (!t.hand.length) return;
      const d = t.hand.splice(Math.floor(rand(s) * t.hand.length), 1)[0];
      t.intimidated.push(d);
      log(s, t.id, `Intimidate: a random card from ${t.name}'s hand is banished until end of turn.`, RULES.intimidate);
    },
  };
}

export function heroCtx(s: GameState, p: PlayerState): HeroCtx {
  return { s, p, opp: s.players[oppOf(s, p.id)], api: heroApi(s) };
}

/** A hero's automated ability (Shiyana uses the ability of the hero she's copying). */
export const heroAbilityOf = (p: PlayerState) => getHeroAbility(p.copyOf ? card(p.copyOf) : cardOf(p.hero));
const ability = heroAbilityOf;

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
  const l = s.chain.find((x) => x.inst.uid === uid);
  if (l) return { p: s.players[l.attacker], zone: 'chain', inst: l.inst };
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

export function matchesFilter(f: AttackFilter, l: { inst: CardInst; fromWeapon: boolean; ally?: boolean }): boolean {
  const c = cardOf(l.inst);
  switch (f.kind) {
    case 'any': return true;
    case 'attackAction': return !l.fromWeapon;
    case 'weapon': return l.fromWeapon && !l.ally;
    case 'ally': return !!l.ally;
    case 'subtype': return c.types.some((t) => t.toLowerCase() === f.value);
    case 'class': return c.types.includes(f.value);
    case 'anyClass': return f.values.some((v) => c.types.includes(v));
    case 'boosted': return !l.fromWeapon && getScript(c).boost;
    case 'runeGated': return !l.fromWeapon && !!(l as { runeGated?: boolean }).runeGated;
    case 'classAttackAction': return !l.fromWeapon && c.types.includes(f.value) && has(c, 'Attack') && has(c, 'Action');
    case 'keyword': return c.keywords.includes(f.value);
    case 'color': return c.pitch === f.pitch;
    case 'word': return (!f.ally || !!l.ally) && (c.types.some((t) => t.toLowerCase() === f.value.toLowerCase()) || c.name.toLowerCase().includes(f.value.toLowerCase()));
  }
}

// ---------------------------------------------------------------- setup

/** `first`: who takes the first turn (decided by a die roll before the game); random if not given. */
export function createGame(setup: PlayerSetup[], seed = Date.now() & 0x7fffffff, format = 'blitz', first?: PlayerId, opts: { events?: boolean } = {}): GameState {
  const s: GameState = {
    seed, nextUid: 1, turn: 1, turnPlayer: 0, phase: 'action', priority: 0, passes: 0,
    players: setup.map(() => null!), chain: [], chainOpen: false, winner: null, log: [], format,
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
    p.inventory = [...(ps.deck.inventoryIds ?? [])];
    const noWeapons = !!getHeroAbility(hero)?.noWeapons;
    for (const wid of noWeapons ? [] : ps.deck.weaponIds) {
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
      if (slots.has(slot)) { p.inventory.push(eid); continue; }
      slots.add(slot);
      p.equipment.push({ inst: mk(s, eid, id), defenseMod: getScript(e).equipCounter ? -1 : 0, destroyed: false, usedThisTurn: false, faceDown: getScript(e).cloaked || undefined });
    }
    s.players[id] = p;
  });
  for (const p of s.players) ability(p)?.setup?.(heroCtx(s, p));
  // Smash Palace: a shared event deck (Fightmaster Kox can arrange it)
  if (opts.events || s.players.some((p) => ability(p)?.id === 'kox')) {
    s.eventDeck = shuffle(s, eventDeckList());
    s.eventDiscard = [];
  }
  const roll = rand(s); // always drawn, so the rest of the game is the same whoever goes first
  const coin = (s.players.length === 2 ? (roll < 0.5 ? 0 : 1) : Math.floor(roll * s.players.length)) as PlayerId;
  s.turnPlayer = first ?? coin;
  s.priority = s.turnPlayer;
  log(s, null, `${pname(s, s.turnPlayer)} goes first.`);
  for (const p of s.players) drawUpTo(s, p);
  startTurn(s);
  return s;
}

function draw(s: GameState, p: PlayerState, count = 1, triggers = true) {
  if (p.turn.flags.noDraw && s.turnPlayer === p.id && s.phase !== 'arsenal') { log(s, p.id, `${p.name} can't draw cards this action phase.`); return; }
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
    for (const o of s.players) if (o.id !== p.id && !o.eliminated) ability(o)?.onOpponentDraw?.(heroCtx(s, o), n);
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
  // untap step: the hero and its permanents untap
  p.heroTapped = false;
  for (const pm of p.permanents) pm.tapped = false;
  for (const pl of s.players) { pl.turn = newTurnInfo(); pl.redirectTo = undefined; }
  // grudges fade: halve how much each opponent attacked this player
  if (p.attackedBy) for (const k of Object.keys(p.attackedBy)) p.attackedBy[+k as PlayerId] = Math.floor((p.attackedBy[+k as PlayerId] ?? 0) / 2);
  s.phase = 'action';
  s.priority = s.turnPlayer;
  log(s, s.turnPlayer, `— Turn ${s.turn}: ${p.name} —`);
  for (const pl of s.players) if (pl.drinkFrom === p.id) pl.drinkFrom = undefined; // "until the start of your next turn"
  if (s.eventDeck) flipEvent(s, p);
  // Graven equipment: destroy Silver to equip it again from the graveyard
  for (const e of p.equipment) {
    const n = e.destroyed ? getScript(cardOf(e.inst)).graveEquip : undefined;
    if (!n || p.permanents.filter((pm) => cardOf(pm.inst).name === 'Silver').length < n) continue;
    if (p.isBot) graveEquip(s, p, e.inst.uid, n);
    else ask(s, { player: p.id, kind: 'yesno', prompt: `${cardOf(e.inst).name}: destroy ${n} Silver to equip it again from your graveyard?`, options: [{ uid: e.inst.uid, cardId: e.inst.cardId }], resume: { type: 'event', key: 'graveEquip', data: [e.inst.uid, n] } });
  }
  if (p.nextTurn) {
    const n = p.nextTurn;
    if (n.attackPower) p.effects.push({ kind: 'nextAttackPower', amount: -n.attackPower, filter: { kind: 'any' }, source: 'crush' });
    if (n.costMore) p.turn.flags.costMore = n.costMore;
    if (n.noDraw) p.turn.flags.noDraw = 1;
    if (n.noGoAgain) p.turn.flags.noGoAgain = 1;
    if (n.noSmallAttacks) p.turn.flags.noSmall = 1;
    p.nextTurn = undefined;
  }
  // Shiyana becomes a copy of the opposing hero until the start of her next turn
  if (cardOf(p.hero).name.startsWith('Shiyana')) {
    const target = s.players[oppOf(s, p.id)].hero;
    p.copyOf = cardOf(target).name.startsWith('Shiyana') ? undefined : target.cardId;
    if (p.copyOf) log(s, p.id, `${p.name} becomes a copy of ${card(p.copyOf).name}.`);
  }
  // start of turn triggers: a human player with two or more different ones chooses their order
  const triggers = p.permanents.filter((pm) => isStartTrigger(pm.inst));
  if (!p.isBot && new Set(triggers.map((pm) => cardOf(pm.inst).name)).size >= 2) {
    s.pendingTriggers = { player: p.id, uids: triggers.map((pm) => pm.inst.uid) };
    log(s, p.id, `${p.name} chooses the order of the start-of-turn triggers.`, RULES.triggerOrder);
    return;
  }
  for (const pm of triggers) runStartTrigger(s, p, pm.inst.uid);
  ability(p)?.startOfTurn?.(heroCtx(s, p));
  opponentsStartOfTurn(s, p);
  afterStartTriggers(s, p);
}

/** "At the start of each opposing hero's turn" abilities (Squizzy & Floof). */
function opponentsStartOfTurn(s: GameState, p: PlayerState) {
  for (const pl of s.players) if (pl.id !== p.id && !pl.eliminated) ability(pl)?.opponentStartOfTurn?.(heroCtx(s, pl), p);
}

/** Put an equipment card into play for `p`, replacing whatever was in that slot. */
function equipCard(s: GameState, p: PlayerState, cid: string) {
  const c = card(cid);
  const slot = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'].find((t) => c.types.includes(t));
  if (slot) p.equipment = p.equipment.filter((e) => !cardOf(e.inst).types.includes(slot));
  p.equipment.push({ inst: mk(s, cid, p.id), defenseMod: 0, destroyed: false, usedThisTurn: false, faceDown: getScript(c).cloaked || undefined });
  log(s, p.id, `${p.name} equips ${c.name}.`);
}

/** How threatening an opponent is to `me` in a Pit Fight: life, cards, board and grudges. */
function pitThreat(s: GameState, me: PlayerState, q: PlayerState): number {
  const others = alivePlayers(s).filter((x) => x.id !== me.id);
  const leader = others.every((x) => x.id === q.id || q.life + q.hand.length * 2 >= x.life + x.hand.length * 2);
  return q.life * 0.5 + q.hand.length * 1.5 + q.permanents.length * 0.5 + (leader ? 4 : 0) + (me.attackedBy?.[q.id] ?? 0) * 3;
}

/** A bot's Pit Fight target: a hero it can knock out, else the biggest threat it can reach. */
function pitTarget(s: GameState, p: PlayerState, legal: PlayerId[], power: number): PlayerId | undefined {
  if (legal.length <= 1) return legal[0];
  const score = (q: PlayerState) => {
    const expectedBlock = Math.min(q.hand.length, 2) * 1.5 + q.equipment.filter((e) => !e.destroyed).length * 0.5;
    const lethal = power - expectedBlock >= q.life;
    // heroes on the brink are worth pressing even if they can still block this one
    return (lethal ? 100 - q.life : 0) + pitThreat(s, p, q) + Math.max(0, 8 - q.life) * 3;
  };
  return [...legal].sort((a, b) => score(s.players[b]) - score(s.players[a]))[0];
}

/** Cards that can protect (defend an attack aimed at another hero). */
function protectOptions(p: PlayerState): CardInst[] {
  const all = !!ability(p)?.protectAll;
  const hand = p.hand.filter((h) => { const c = cardOf(h); return c.keywords.includes('Protect') || (all && (defenseOf(c) ?? 0) > 0); });
  const eq = p.equipment.filter((e) => !e.destroyed && (cardOf(e.inst).keywords.includes('Protect') || (all && equipDefense(e) >= 1))).map((e) => e.inst);
  return [...hand, ...eq];
}

/** Ultimate Pit Fight: after the defender declares, other heroes may protect them. */
function offerProtect(s: GameState, l: ChainLink) {
  const li = s.chain.indexOf(l);
  for (const q of s.players) {
    if (q.eliminated || q.id === l.attacker || q.id === defenderOf(l)) continue;
    const opts = protectOptions(q);
    if (!opts.length) continue;
    // protect with the card that defends best for the least value
    const best = [...opts].sort((a, b) => (defenseOf(cardOf(b)) ?? 0) - (defenseOf(cardOf(a)) ?? 0) || (pitchOf(cardOf(b)) - pitchOf(cardOf(a))))[0];
    // bots protect when their hero profits from it, or when the attacker is their neighbour too
    const botYes = protectWorthIt(s, q, l, best);
    ask(s, { player: q.id, kind: 'pick', prompt: `Protect ${s.players[defenderOf(l)].name} from ${cardOf(l.inst).name} (${linkPower(l)} power)? Pick the card to defend with, or skip.`, confirm: 'Protect with this', skippable: true, botPick: botYes ? best.uid : null, options: [best, ...opts.filter((o) => o !== best)].map((o) => ({ uid: o.uid, cardId: o.cardId })), resume: { type: 'protect', link: li } });
  }
}

/** Should a bot protect the defender? When its hero profits, to stop a knock-out that would leave the attacker stronger, or to blunt the leader. */
function protectWorthIt(s: GameState, q: PlayerState, l: ChainLink, card0: CardInst): boolean {
  if (ability(q)?.onProtect) return true;
  const def = s.players[defenderOf(l)];
  const atk = s.players[l.attacker];
  const incoming = linkPower(l) - linkDefense(l);
  const cheap = pitchOf(cardOf(card0)) !== 1 || (defenseOf(cardOf(card0)) ?? 0) >= 3;
  const wouldDie = incoming >= def.life;
  // with 3 left, losing the defender means facing the attacker alone; and don't save someone who keeps hitting us
  const grudge = (q.attackedBy?.[def.id] ?? 0) >= 2;
  if (wouldDie && !grudge && alivePlayers(s).length === 3) return true;
  if (wouldDie && !grudge && pitThreat(s, q, atk) > pitThreat(s, q, def) + 4) return true;
  return cheap && incoming >= 6 && pitThreat(s, q, atk) > pitThreat(s, q, def) + 8 && q.hand.length >= 4;
}

function doProtect(s: GameState, q: PlayerState, li: number, uid: number) {
  const l = s.chain[li];
  if (!l || l.damage !== null || s.phase !== 'reaction') return;
  const h = removeFrom(q.hand, uid);
  const name = h ? cardOf(h).name : cardOf(q.equipment.find((x) => x.inst.uid === uid)?.inst ?? l.inst).name;
  if (h) l.defenders.push({ kind: 'hand', inst: h, defense: defenseFor(q, cardOf(h), defenseOf(cardOf(h)) ?? 0) });
  else {
    const e = q.equipment.find((x) => x.inst.uid === uid && !x.destroyed);
    if (!e) return;
    l.defenders.push({ kind: 'equipment', inst: e.inst, defense: defenseFor(q, cardOf(e.inst), equipDefense(e)) });
  }
  log(s, q.id, `${q.name} protects ${s.players[defenderOf(l)].name} with ${name} (${linkDefense(l)}).`, 'Protect: you may defend an attack that targets another hero.');
  ability(q)?.onProtect?.(heroCtx(s, q));
}


const START_TOKENS = ['Agility', 'Might', 'Vigor', 'Embodiment of Earth', 'Sigil of Fate', 'Seismic Surge'];
function isStartTrigger(inst: CardInst): boolean {
  const c = cardOf(inst);
  if (START_TOKENS.includes(c.name)) return true;
  const sc = getScript(c);
  return !!sc.destroyAt || sc.steamUpkeep || !!sc.suspense || !!sc.triggers?.some((t) => t.on === 'startTurn');
}

function runStartTrigger(s: GameState, p: PlayerState, uid: number) {
  const pm = p.permanents.find((x) => x.inst.uid === uid);
  if (!pm) return;
  const name = cardOf(pm.inst).name;
  const destroy = () => removePermanent(s, p, pm.inst.uid);
  const scr = getScript(cardOf(pm.inst));
  if (scr.suspense && !scr.destroyAt) {
    pm.suspense = Math.max(0, (pm.suspense ?? 2) - 1);
    log(s, p.id, `${name}: a suspense counter is removed (${pm.suspense} left).`, 'Suspense: enters with 2 suspense counters; remove one at the start of your turn; destroyed when it has none.');
    if (pm.suspense === 0) destroy();
    return;
  }
  // tokens whose printed text says what they do (Might, Vigor, Agility, ...) resolve through that text when destroyed
  if (scr.onDestroy.length) { destroy(); return; }
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
    else for (const t of sc.triggers ?? []) if (t.on === 'startTurn' && p.permanents.includes(pm)) { log(s, p.id, `${name}: ${t.text}.`); resolveEffects(s, p, t.effects, pm.inst); }
  }
}

/** after the start-of-turn triggers: equipment's "at the start of your turn", then "at the beginning of your action phase" */
function afterStartTriggers(s: GameState, p: PlayerState) {
  for (const e of p.equipment) if (e.faceDown && !e.destroyed && getScript(cardOf(e.inst)).heirloom && p.life === 1) { e.faceDown = false; log(s, p.id, `${p.name} turns ${cardOf(e.inst).name} face-up (exactly 1 life).`); }
  for (const e of p.equipment.filter((x) => !x.destroyed)) for (const t of getScript(cardOf(e.inst)).triggers ?? []) if (t.on === 'startTurn') { log(s, p.id, `${cardOf(e.inst).name}: ${t.text}.`); resolveEffects(s, p, t.effects, e.inst); }
  fireTriggers(s, p, 'actionPhase');
}

function doOrderTriggers(s: GameState, order: number[]) {
  const pt = s.pendingTriggers;
  if (!pt) throw new Error('There are no triggers to order.');
  if (order.length !== pt.uids.length || !pt.uids.every((u) => order.includes(u))) throw new Error('Put every trigger in the order.');
  const p = s.players[pt.player];
  s.pendingTriggers = undefined;
  for (const uid of order) runStartTrigger(s, p, uid);
  ability(p)?.startOfTurn?.(heroCtx(s, p));
  opponentsStartOfTurn(s, p);
  afterStartTriggers(s, p);
}

/** Run `p`'s permanents', equipment's and weapons' abilities that wait for `on` ("whenever you boost, ..."). */
function fireTriggers(s: GameState, p: PlayerState, on: TriggerEvent, link?: { inst: CardInst; fromWeapon: boolean }, createdBefore?: number) {
  if (p.eliminated) return;
  // a card created after the event (a Runechant made while the attack started) doesn't see it
  const srcs = [...p.permanents.map((pm) => pm.inst), ...p.equipment.filter((e) => !e.destroyed && !e.faceDown).map((e) => e.inst), ...p.weapons.map((w) => w.inst)]
    .filter((i) => createdBefore === undefined || i.uid < createdBefore);
  for (const inst of srcs) {
    const trs = getScript(cardOf(inst)).triggers;
    if (!trs) continue;
    trs.forEach((t, i) => {
      if (t.on !== on || (s.phase as string) === 'gameOver') return;
      if (t.filter && (!link || !matchesFilter(t.filter, link))) return;
      const key = `trig${inst.uid}:${i}`;
      if (t.once && p.turn.flags[key]) return;
      // an earlier trigger may have destroyed it
      if (!p.permanents.some((pm) => pm.inst.uid === inst.uid) && !p.equipment.some((e) => e.inst.uid === inst.uid && !e.destroyed) && !p.weapons.some((w) => w.inst.uid === inst.uid)) return;
      if (t.once) p.turn.flags[key] = 1;
      log(s, p.id, `${cardOf(inst).name}: ${t.text}.`);
      resolveEffects(s, p, t.effects, inst);
    });
  }
}

/** Is it a <name> ("Gold", "Runechant"), or does it count as one ("This counts as a Gold")? */
export function isA(inst: CardInst, name: string): boolean {
  const c = cardOf(inst);
  return c.name === name || getScript(c).countsAs === name;
}

function removePermanent(s: GameState, p: PlayerState, uid: number) {
  const i = p.permanents.findIndex((pm) => pm.inst.uid === uid);
  if (i < 0) return;
  const [pm] = p.permanents.splice(i, 1);
  const c = cardOf(pm.inst);
  if (has(c, 'Token')) p.turn.flags[`destroyed:${c.name}`] = 1; // "if the attack's controller has destroyed a Might token this turn"
  if (!has(c, 'Token')) graveFromArena(s.players[pm.inst.owner] ?? p, pm.inst);
  if (has(c, 'Item')) p.turn.itemDestroyed = true;
  log(s, p.id, `${c.name} leaves the arena.`);
  const onDestroy = getScript(c).onDestroy;
  if (onDestroy.length) resolveEffects(s, p, onDestroy, pm.inst);
  for (const t of getScript(c).triggers ?? []) if (t.on === 'leaves') { log(s, p.id, `${c.name}: ${t.text}.`); resolveEffects(s, p, t.effects, pm.inst); }
}

// ---------------------------------------------------------------- decisions, wagers and the crowd

/** Queue a decision for a (human) player; everything else waits until they answer. */
function ask(s: GameState, c: PendingChoice) {
  (s.pendingChoices ??= []).push(c);
}

/** Park the remaining effects on the newest unanswered choice made during this effect. */
function deferFrom(s: GameState, p: PlayerState, src: CardInst, rest: Effect[]) {
  const c = s.pendingChoices![s.pendingChoices!.length - 1];
  (c.then ??= []).push({ player: p.id, src, effects: rest });
}

function doChoose(s: GameState, a: Extract<Action, { type: 'choose' }>) {
  const c = s.pendingChoices?.[0];
  if (!c) throw new Error('There is nothing to choose.');
  const p = s.players[c.player];
  const picks = (a.picks ?? []).filter((u, i, all) => all.indexOf(u) === i && c.options.some((o) => o.uid === u));
  s.pendingChoices = s.pendingChoices!.slice(1);
  if (!s.pendingChoices.length) s.pendingChoices = undefined;
  switch (c.resume.type) {
    case 'opt': {
      const uids = c.options.map((o) => o.uid);
      const top = p.deck.filter((d) => uids.includes(d.uid));
      p.deck.splice(0, p.deck.length, ...p.deck.filter((d) => !uids.includes(d.uid))); // in place: Yorick's heroes share one deck
      const keep = picks.map((u) => top.find((t) => t.uid === u)!).filter(Boolean);
      const bottom = top.filter((t) => !picks.includes(t.uid));
      p.deck.unshift(...keep);
      p.deck.push(...bottom);
      log(s, p.id, `${p.name} opts ${uids.length}: ${keep.length} on top, ${bottom.length} to the bottom.`, 'Opt: look at the top cards of your deck and put any of them on the bottom, the rest back on top in any order.');
      ability(p)?.onOpt?.(heroCtx(s, p), uids.length);
      break;
    }
    case 'reload': {
      const uid = picks[0];
      if (uid === undefined || p.arsenal.length) { log(s, p.id, `${p.name} doesn't reload.`); break; }
      const inst = removeFrom(p.hand, uid);
      if (inst) { p.arsenal.push(inst); log(s, p.id, `${p.name} reloads: a card from hand goes face down into the arsenal.`, 'Reload: if you have no card in your arsenal, you may put a card from your hand face down into your arsenal.'); }
      break;
    }
    case 'hero': {
      const owner = s.players[c.resume.owner];
      ability(owner)?.onChoice?.(heroCtx(s, owner), c.resume.key, !!a.yes, c.resume.data, picks);
      break;
    }
    case 'protect': if (picks[0] !== undefined) doProtect(s, p, c.resume.link, picks[0]); else log(s, p.id, `${p.name} doesn't protect.`); break;
    case 'handToBottom': {
      const inst = (picks[0] !== undefined && removeFrom(p.hand, picks[0])) || p.hand.shift();
      if (inst) { p.deck.push(inst); log(s, p.id, `${p.name} puts a card from their hand on the bottom of their deck.`); }
      break;
    }
    case 'defendCost': {
      const l = currentLink(s);
      const duid = c.resume.uid;
      const x = l?.defenders.find((d) => d.inst.uid === duid) ?? l?.also?.defenders.find((d) => d.inst.uid === duid);
      const oc = x && getScript(cardOf(x.inst)).optional;
      if (picks[0] === undefined || !x || !oc) { log(s, p.id, `${p.name} doesn't use ${x ? cardOf(x.inst).name : 'the card'}'s ability.`); break; }
      const inst = removeFrom(p.hand, picks[0]) ?? removeFrom(p.arsenal, picks[0]);
      if (!inst) break;
      p.deck.push(inst);
      log(s, p.id, `${cardOf(x.inst).name}: ${p.name} puts a card on the bottom of their deck and ${oc.effectText}.`);
      optionalPayoff(s, p, oc, cardOf(inst), x.inst);
      break;
    }
    case 'cleanse': {
      const t = s.players[c.resume.target];
      const name = picks[0] !== undefined ? cardOf(t.deck.find((d) => d.uid === picks[0]) ?? t.deck[0]).name : null;
      if (name) cleanseName(s, p, t, c.resume.n, name, 'Righteous Cleansing');
      break;
    }
    case 'mayThen': {
      const r = c.resume;
      if (!a.yes || !mayPayable(p, r.cost, r.src)) { log(s, p.id, `${p.name} doesn't ${r.text.split(' to ')[0]}.`); break; }
      try { payMay(s, p, r.cost, r.src); } catch { log(s, p.id, `${p.name} can't pay for that.`); break; }
      log(s, p.id, `${cardOf(r.src).name}: ${p.name} chooses to ${r.text}.`);
      resolveEffects(s, p, r.then, r.src);
      break;
    }
    case 'event': resolveEventChoice(s, p, c.resume.key, picks, !!a.yes, c, c.resume.data); break;
    case 'eventOrder': {
      const top = (s.eventDeck ?? []).splice(0, c.options.length);
      const keep = picks.map((u) => c.options.findIndex((o) => o.uid === u)).filter((i) => i >= 0).map((i) => top[i]);
      const rest = top.filter((_, i) => !picks.includes(c.options[i].uid));
      s.eventDeck = [...keep, ...rest, ...(s.eventDeck ?? [])];
      log(s, p.id, `${p.name} puts the top ${top.length} cards of the event deck back in the order they want.`);
      break;
    }
    case 'wager':
      if (a.yes) addWager(s, p, c.resume.link, c.resume.tokens, c.resume.winnerDraw);
      else log(s, p.id, `${p.name} doesn't wager.`);
      break;
    case 'damageTarget': {
      const opp = s.players[oppOf(s, p.id)];
      const pick = picks[0];
      if (pick !== undefined && pick !== opp.hero.uid) damageAlly(s, opp, pick, c.resume.amount, c.resume.source);
      else if (dealDamage(s, opp.id, c.resume.amount, c.resume.arcane, c.resume.source) > 0 && c.resume.arcane) p.turn.arcaneDealt = true;
      break;
    }
    case 'attackTarget': {
      const l = s.chain[c.resume.link];
      const pick = picks[0];
      if (!l || pick === undefined) break;
      // a hero: that player defends (multiplayer); otherwise one of their allies or spectra auras
      const heroSeat = s.players.find((x) => x.hero.uid === pick);
      if (heroSeat) {
        if (heroSeat.id !== defenderOf(l)) { l.defender = heroSeat.id; l.target = undefined; if (s.phase === 'defend') s.priority = heroSeat.id; log(s, p.id, `${cardOf(l.inst).name} attacks ${heroSeat.name}.`); }
        break;
      }
      const owner = s.players.find((x) => x.permanents.some((pm) => pm.inst.uid === pick));
      if (!owner) break;
      if (owner.id !== defenderOf(l)) { l.defender = owner.id; if (s.phase === 'defend') s.priority = owner.id; }
      const opp = owner;
      const pm = opp.permanents.find((x) => x.inst.uid === pick);
      if (!pm) break;
      if (getScript(cardOf(pm.inst)).spectra) {
        // Spectra: when this becomes the target of an attack, destroy it; the attack has nothing left to hit
        log(s, opp.id, `${cardOf(pm.inst).name} (spectra) is targeted by ${cardOf(l.inst).name} and destroyed.`, 'Spectra: this can be attacked. When it becomes the target of an attack, destroy it.');
        removePermanent(s, opp, pick);
        s.chain.splice(c.resume.link, 1);
        if (!l.fromWeapon) graveFromArena(p, l.inst);
        if (!s.chain.length) s.chainOpen = false;
        s.phase = 'action';
        s.priority = s.turnPlayer;
        s.passes = 0;
      } else {
        l.target = pick;
        log(s, p.id, `${cardOf(l.inst).name} attacks ${cardOf(pm.inst).name}.`);
      }
      break;
    }
    case 'betsy': {
      const l = s.chain[c.resume.link];
      if (a.yes && l && availableResources(p) >= 2) {
        pay(s, p, 2, autoPitch(p, 2) ?? []);
        l.powerMod += 1; l.overpower = true;
        log(s, p.id, `${p.name} pays 2: ${cardOf(l.inst).name} gets +1 power and overpower.`);
      }
      break;
    }
  }
  // finish the effect that asked
  for (const t of c.then ?? []) resolveEffects(s, s.players[t.player], t.effects, t.src);
}

/** An attack wagers: it's settled when its chain link resolves (see settleWagers). */
function addWager(s: GameState, p: PlayerState, li: number, tokens: string[], winnerDraw?: number) {
  const l = s.chain[li];
  if (!l) return;
  (l.wagers ??= []).push({ tokens, winnerDraw });
  log(s, p.id, `${p.name} wagers${tokens.length ? ` ${tokens.join(', ')}` : ''} on ${cardOf(l.inst).name}.`, RULES.wager);
  p.effects = p.effects.filter((e) => {
    if (e.kind !== 'nextWagerPower') return true;
    l.powerMod += e.amount;
    if (e.overpower) l.overpower = true;
    log(s, p.id, `${cardOf(l.inst).name} wagers: +${e.amount} power${e.overpower ? ' and overpower' : ''} (${e.source}).`);
    return false;
  });
  const ab = ability(p);
  if (ab?.id === 'betsy' && availableResources(p) >= 2) {
    if (p.isBot) { pay(s, p, 2, autoPitch(p, 2) ?? []); l.powerMod += 1; l.overpower = true; log(s, p.id, `Betsy pays 2: ${cardOf(l.inst).name} gets +1 power and overpower.`); }
    else ask(s, { player: p.id, kind: 'yesno', prompt: `Betsy: pay 2 resources to give ${cardOf(l.inst).name} +1 power and overpower?`, options: [], resume: { type: 'betsy', link: li } });
  }
}

function settleWagers(s: GameState, l: ChainLink) {
  if (!l.wagers?.length) return;
  const winner = s.players[l.hit ? l.attacker : defenderOf(l)];
  const loser = s.players[l.hit ? defenderOf(l) : l.attacker];
  for (const w of l.wagers) {
    log(s, winner.id, `${winner.name} wins the wager.`);
    fireTriggers(s, winner, 'winWager');
    if (w.goldSwap) {
      const gold = loser.permanents.filter((pm) => isA(pm.inst, 'Gold'));
      loser.permanents = loser.permanents.filter((pm) => !gold.includes(pm));
      winner.permanents.push(...gold);
      if (gold.length) log(s, winner.id, `${winner.name} gains control of ${gold.length} Gold from ${loser.name}.`);
    }
    for (const t of w.tokens) createToken(s, winner, t, 1);
    if (w.winnerDraw) draw(s, winner, w.winnerDraw);
    ability(winner)?.onWagerWin?.(heroCtx(s, winner), l);
  }
}

/** The crowd cheers or boos a hero: nothing happens by itself, but cards and heroes react to it. */
export function crowd(s: GameState, p: PlayerState, cheer: boolean) {
  if (cheer) p.turn.cheers = (p.turn.cheers ?? 0) + 1; else p.turn.boos = (p.turn.boos ?? 0) + 1;
  log(s, p.id, `The crowd ${cheer ? 'cheers' : 'boos'} ${p.name}!`, RULES.crowd);
  for (const pm of [...p.permanents]) {
    const sc = getScript(cardOf(pm.inst));
    const fx = cheer ? sc.onCheer : sc.onBoo;
    if (fx.length) resolveEffects(s, p, fx, pm.inst);
  }
  const ab = ability(p);
  if (cheer) ab?.onCheer?.(heroCtx(s, p)); else ab?.onBoo?.(heroCtx(s, p));
}

/** What can be attacked or dealt damage besides the hero: allies (they have life) and, for attacks, spectra auras. */
export function attackablePermanents(p: PlayerState) {
  return p.permanents.filter((pm) => { const c = cardOf(pm.inst); return (has(c, 'Ally') && (c.health ?? 0) > 0) || getScript(c).spectra; });
}
const allies = (p: PlayerState) => p.permanents.filter((pm) => has(cardOf(pm.inst), 'Ally') && (cardOf(pm.inst).health ?? 0) > 0);

/** Damage to an ally: it's destroyed once the damage reaches its life. */
function damageAlly(s: GameState, owner: PlayerState, uid: number, amount: number, source: string) {
  const pm = owner.permanents.find((x) => x.inst.uid === uid);
  if (!pm || amount <= 0) return 0;
  pm.damage = (pm.damage ?? 0) + amount;
  const c = cardOf(pm.inst);
  log(s, owner.id, `${source} deals ${amount} damage to ${c.name} (${Math.max(0, (c.health ?? 0) - pm.damage)} life left).`);
  if (pm.damage >= (c.health ?? 0)) {
    removePermanent(s, owner, uid);
    destroyedBy(s, s.turnPlayer, owner.id);
  }
  return amount;
}

/** Banish the cards named `name` from the top `n` of `t`'s deck (Righteous Cleansing). */
function cleanseName(s: GameState, p: PlayerState, t: PlayerState, n: number, name: string, src: string) {
  const top = t.deck.slice(0, n);
  const gone = top.filter((x) => cardOf(x).name === name);
  t.deck.splice(0, t.deck.length, ...t.deck.filter((x) => !gone.includes(x)));
  t.banished.push(...gone);
  for (const g of gone) banishedFromOpp(s, p, g);
  log(s, p.id, `${src}: ${p.name} looks at the top ${top.length} cards of ${t.name}'s deck and banishes ${gone.length} ${name}.`);
}

// ---------------------------------------------------------------- Smash Palace event deck

/** The 40-card Smash Palace event deck. The copy counts aren't published; this mix follows the set's price tiers
 *  (SMP007–013 and the Bloodied equipment once each, SMP019–032 twice each), which adds up to exactly 40. */
const EVENT_SINGLES = ['Air of a Comeback', 'Benefactor of Bloodworth Goldmane', 'Big Hits, Big Applause', 'Code of Conduct: Kill or Be Killed', 'Hit the Jackpot', 'Random Events Unfold', "Visit the 'Winner Takes All'"];
export function eventDeckList(): string[] {
  const events = getDb().cards.filter((c) => c.types.includes('Event') && !c.types.includes('Hero'));
  const seen = new Set<string>();
  return events.flatMap((c) => {
    if (seen.has(c.name)) return [];
    seen.add(c.name);
    return EVENT_SINGLES.includes(c.name) || c.types.includes('Equipment') ? [c.id] : [c.id, c.id];
  });
}

/** At the start of each turn, the turn player reveals the top card of the event deck and follows it. */
function flipEvent(s: GameState, p: PlayerState) {
  if (!s.eventDeck) return;
  if (!s.eventDeck.length) { s.eventDeck = shuffle(s, s.eventDiscard ?? []); s.eventDiscard = []; }
  const id = s.eventDeck.shift();
  if (!id) return;
  s.lastEvent = id;
  log(s, p.id, `Event: ${card(id).name} — ${card(id).text.replace(/\n/g, ' ')}`, 'Event deck (Smash Palace): at the start of each turn, the turn player reveals the top card of the event deck and follows it.');
  if (!resolveEvent(s, p, id)) (s.eventDiscard ??= []).push(id);
}

const golds = (p: PlayerState) => p.permanents.filter((pm) => isA(pm.inst, 'Gold'));
const worstCard = (list: CardInst[]) => [...list].sort((a, b) => cardPlayValueLite(cardOf(a)) - cardPlayValueLite(cardOf(b)))[0];
const pickOpts = (list: CardInst[]) => list.map((i) => ({ uid: i.uid, cardId: i.cardId }));

/** Follow an event. Returns true if the card stays in play (equipped) instead of going to the event discard. */
function resolveEvent(s: GameState, p: PlayerState, id: string): boolean {
  const c = card(id);
  const others = s.players.filter((q) => q.id !== p.id && !q.eliminated);
  const ev = (key: string, k: Partial<NonNullable<GameState['pendingChoices']>[0]>, data?: number[]) =>
    ask(s, { player: p.id, kind: 'pick', prompt: '', options: [], ...k, resume: { type: 'event', key, data } } as NonNullable<GameState['pendingChoices']>[0]);
  if (c.types.includes('Equipment')) {
    const slot = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'].find((t) => c.types.includes(t))!;
    const cur = p.equipment.find((e) => !e.destroyed && cardOf(e.inst).types.includes(slot));
    if (!cur) { equipCard(s, p, id); return true; }
    if (p.isBot) { if ((defenseOf(c) ?? 0) > equipDefense(cur)) { equipCard(s, p, id); return true; } return false; }
    ask(s, { player: p.id, kind: 'yesno', prompt: `${c.name}: equip it in place of ${cardOf(cur.inst).name}?`, options: [{ uid: -1, cardId: id }], resume: { type: 'event', key: 'equip' } });
    return true; // decided in the answer
  }
  switch (c.name) {
    case 'Air of a Comeback': {
      const naa = p.graveyard.filter((g) => has(cardOf(g), 'Action') && !has(cardOf(g), 'Attack'));
      if (!naa.length) break;
      if (!p.isBot) { ev('comeback', { prompt: `${c.name}: put a non-attack action card from your graveyard on top of your deck${p.hand.length ? '' : ' (no cards in hand: instead you may play it this turn for free)'}? Pick one, or skip.`, confirm: 'Choose it', skippable: true, options: pickOpts(naa) }); break; }
      comeback(s, p, [...naa].sort((a, b) => costOf(cardOf(b)) - costOf(cardOf(a)))[0]);
      break;
    }
    case 'Benefactor of Bloodworth Goldmane': createToken(s, p, 'Gold', 1); p.effects.push({ kind: 'nextAttackGoldPower', source: c.name }); break;
    case 'Big Hits, Big Applause':
      p.turn.flags.clashDraw = 1;
      for (const q of others) clash(s, p.id, q.id);
      break;
    case 'Code of Conduct: Kill or Be Killed': p.turn.flags.anyTarget = 1; p.turn.flags.killOrBeKilled = 1; break;
    case 'Crowd Roars Fight!': p.effects.push({ kind: 'nextAttackPower', amount: 1, filter: { kind: 'any' }, source: c.name }); p.turn.flags.anyTarget = 1; p.turn.flags.anyTargetNext = 1; break;
    case 'Crushing Impact': p.turn.flags.crushingImpact = 1; break;
    case "Didn't See That Coming":
      for (const q of others) if (q.life > p.life && q.hand.length) {
        if (!q.isBot) ask(s, { player: q.id, kind: 'pick', prompt: `${c.name}: you have more life than ${p.name}. Discard a card.`, confirm: 'Discard it', options: pickOpts(q.hand), resume: { type: 'event', key: 'discard' } });
        else discardCard(s, q, worstCard(q.hand));
      }
      break;
    case 'Dominate the Competition': p.effects.push({ kind: 'nextAttackDominate', source: c.name }); break;
    case 'Ez Sqeez Bookie Syndicate': p.turn.flags.ezSqeez = 1; break;
    case 'Fight Night Prize Purse': {
      if (!others.length) break;
      if (!p.isBot && others.length > 1) { ask(s, { player: p.id, kind: 'target', prompt: `${c.name}: choose an opponent. You each create a Gold token.`, options: pickOpts(others.map((q) => q.hero)), resume: { type: 'event', key: 'purse' } }); break; }
      const q = [...others].sort((a, b) => pitThreat(s, p, a) - pitThreat(s, p, b))[0]; // the least threatening gets the Gold
      createToken(s, p, 'Gold', 1); createToken(s, q, 'Gold', 1);
      break;
    }
    case 'Hit the Jackpot': createToken(s, p, 'Gold', 1); draw(s, p, golds(p).length); log(s, p.id, `${p.name} draws ${golds(p).length} (one per Gold).`); break;
    case 'Ire of the Crowd': p.turn.flags.ire = 1; break;
    case 'Let Me Buy You a Drink': {
      const g = golds(p)[0];
      if (g) removePermanent(s, p, g.inst.uid);
      if (!others.length) break;
      if (!p.isBot && others.length > 1) { ask(s, { player: p.id, kind: 'target', prompt: `${c.name}: choose an opponent. They draw a card, and their attacks on you get -2{p} until your next turn.`, options: pickOpts(others.map((q) => q.hero)), resume: { type: 'event', key: 'drink' } }); break; }
      drink(s, p, [...others].sort((a, b) => pitThreat(s, p, b) - pitThreat(s, p, a))[0]);
      break;
    }
    case "Lion's Pounce":
      // a 3{p} attack on every other hero: each chooses their own blockers (hand cards and equipment)
      for (const q of others) {
        const opts = [...q.hand.filter((h) => (defenseOf(cardOf(h)) ?? 0) > 0), ...q.equipment.filter((e) => !e.destroyed && equipDefense(e) > 0).map((e) => e.inst)];
        if (!q.isBot && opts.length) {
          ask(s, { player: q.id, kind: 'pick', multi: true, skippable: true, confirm: 'Block with these', prompt: `Lion's Pounce attacks you for 3. Choose cards to block with, or skip and take it.`, options: pickOpts(opts), resume: { type: 'event', key: 'pounce', data: [p.id] } });
          continue;
        }
        // bots: block with equipment, and with a hand card too when the damage would hurt
        const eq = q.equipment.filter((e) => !e.destroyed && equipDefense(e) > 0).sort((a, b) => equipDefense(b) - equipDefense(a))[0];
        const handBlock = q.life <= 8 ? [...q.hand].filter((h) => (defenseOf(cardOf(h)) ?? 0) >= 2).sort((a, b) => cardPlayValueLite(cardOf(a)) - cardPlayValueLite(cardOf(b)))[0] : undefined;
        pounce(s, p, q, [...(eq ? [eq.inst.uid] : []), ...(handBlock ? [handBlock.uid] : [])]);
        if (s.phase === 'gameOver') break;
      }
      break;
    case 'Pick Yourself Up Off the Floor': {
      const atk = p.graveyard.filter((g) => has(cardOf(g), 'Attack') && has(cardOf(g), 'Action'));
      if (!atk.length) break;
      if (!p.isBot && atk.length > 1) { ev('pickUp', { prompt: `${c.name}: put an attack action card from your graveyard on top of your deck${others.some((q) => q.life > p.life) ? ' (you have less life than an opponent: into your hand instead)' : ''}.`, confirm: 'Choose it', options: pickOpts(atk) }); break; }
      pickUp(s, p, [...atk].sort((a, b) => powerOf(cardOf(b)) - powerOf(cardOf(a)))[0]);
      break;
    }
    case 'Rally the Underdog': draw(s, p, others.some((q) => q.life > p.life) ? 2 : 1); break;
    case 'Random Events Unfold':
      if (!(s.eventDeck ?? []).some((x) => card(x).name !== c.name)) break; // nothing else to flip
      s.eventDeck = [...shuffle(s, s.eventDeck ?? []), id];
      flipEvent(s, p);
      return true; // it went to the bottom of the event deck
    case 'The Moat Exchange':
      for (const q of [p, ...others]) {
        const pool = [...q.hand, ...q.arsenal];
        if (!pool.length) continue;
        if (!q.isBot) { ask(s, { player: q.id, kind: 'pick', multi: true, prompt: `${c.name}: put any number of cards from your hand or arsenal on the bottom of your deck, then draw that many.`, confirm: 'Done', skippable: true, options: pickOpts(pool), resume: { type: 'event', key: 'moat' } }); continue; }
        moat(s, q, pool.filter((x) => pitchOf(cardOf(x)) === 3 && !has(cardOf(x), 'Defense Reaction')).slice(0, 2));
      }
      break;
    case 'Tremor of Anticipation': p.turn.flags.tremor = 1; createToken(s, p, 'Gold', 1); break;
    case "Visit the 'Winner Takes All'": p.turn.flags.winnerTakesAll = 1; break;
    default: {
      // events the card-text compiler handles (Arena Medic, ...)
      const inst = mk(s, id, p.id);
      resolveEffects(s, p, getScript(c).onPlay, inst);
      resolveConditionals(s, p, c, inst, 'if');
    }
  }
  return false;
}

/** Lion's Pounce hits `q`, who blocks with `uids` (hand cards go to the graveyard, equipment wears like a block). */
function pounce(s: GameState, p: PlayerState, q: PlayerState, uids: number[]) {
  let block = 0;
  const names: string[] = [];
  for (const uid of uids) {
    const h = removeFrom(q.hand, uid);
    if (h) { block += defenseOf(cardOf(h)) ?? 0; names.push(cardOf(h).name); toGraveyard(q, h); continue; }
    const e = q.equipment.find((x) => x.inst.uid === uid && !x.destroyed);
    if (!e) continue;
    block += equipDefense(e);
    names.push(cardOf(e.inst).name);
    const esc = getScript(cardOf(e.inst));
    if (esc.bladeBreak) e.destroyed = true; else if (esc.battleworn || esc.temper) e.defenseMod -= 1;
    if (esc.temper && equipDefense(e) <= 0) e.destroyed = true;
  }
  log(s, q.id, `Lion's Pounce attacks ${q.name}${names.length ? `, who blocks with ${names.join(', ')} (${block})` : ''}.`);
  if (3 - block > 0) dealDamage(s, q.id, 3 - block, false, "Lion's Pounce");
  void p;
}

function graveEquip(s: GameState, p: PlayerState, uid: number, n: number) {
  const e = p.equipment.find((x) => x.inst.uid === uid && x.destroyed);
  if (!e || p.permanents.filter((pm) => cardOf(pm.inst).name === 'Silver').length < n) return;
  for (let i = 0; i < n; i++) { const sv = p.permanents.find((pm) => cardOf(pm.inst).name === 'Silver'); if (sv) removePermanent(s, p, sv.inst.uid); }
  e.destroyed = false; e.defenseMod = 0; e.usedThisTurn = false;
  log(s, p.id, `${p.name} destroys ${n} Silver and equips ${cardOf(e.inst).name} from their graveyard.`);
}

function comeback(s: GameState, p: PlayerState, inst: CardInst) {
  if (!p.hand.length) {
    p.turn.flags[`playGrave${inst.uid}`] = 1; p.turn.flags[`freePlay${inst.uid}`] = 1;
    log(s, p.id, `${p.name} may play ${cardOf(inst).name} from their graveyard this turn without paying its cost.`);
  } else {
    removeFrom(p.graveyard, inst.uid); p.deck.unshift(inst);
    log(s, p.id, `${p.name} puts ${cardOf(inst).name} from their graveyard on top of their deck.`);
  }
}
function pickUp(s: GameState, p: PlayerState, inst: CardInst) {
  removeFrom(p.graveyard, inst.uid);
  const less = s.players.some((q) => q.id !== p.id && !q.eliminated && q.life > p.life);
  if (less) p.hand.push(inst); else p.deck.unshift(inst);
  log(s, p.id, `${p.name} puts ${cardOf(inst).name} from their graveyard ${less ? 'into their hand' : 'on top of their deck'}.`);
}
function drink(s: GameState, p: PlayerState, q: PlayerState) {
  draw(s, q, 1);
  q.drinkFrom = p.id;
  log(s, p.id, `${q.name} draws a card; their attacks on ${p.name} get -2{p} until ${p.name}'s next turn.`);
}
function moat(s: GameState, q: PlayerState, cards: CardInst[]) {
  for (const x of cards) { const i = removeFrom(q.hand, x.uid) ?? removeFrom(q.arsenal, x.uid); if (i) q.deck.push(i); }
  if (cards.length) { draw(s, q, cards.length); log(s, q.id, `${q.name} puts ${cards.length} card${cards.length > 1 ? 's' : ''} on the bottom and draws as many.`); }
}
function discardCard(s: GameState, q: PlayerState, inst: CardInst | undefined) {
  if (!inst || !removeFrom(q.hand, inst.uid)) return;
  q.graveyard.push(inst); noteDiscard(s, q, inst);
  log(s, q.id, `${q.name} discards ${cardOf(inst).name}.`);
}

/** The answer to a choice an event asked for. */
function resolveEventChoice(s: GameState, p: PlayerState, key: string, picks: number[], yes: boolean, c: NonNullable<GameState['pendingChoices']>[0], _data?: number[]) {
  const id = s.lastEvent;
  const hero = () => s.players.find((q) => q.hero.uid === picks[0]);
  switch (key) {
    case 'equip':
      if (yes && id) equipCard(s, p, id); else if (id) (s.eventDiscard ??= []).push(id);
      break;
    case 'comeback': { const g = p.graveyard.find((x) => x.uid === picks[0]); if (g) comeback(s, p, g); break; }
    case 'pickUp': { const g = p.graveyard.find((x) => x.uid === picks[0]); if (g) pickUp(s, p, g); break; }
    case 'discard': discardCard(s, p, p.hand.find((x) => x.uid === picks[0]) ?? worstCard(p.hand)); break;
    case 'purse': { const q = hero(); if (q) { createToken(s, p, 'Gold', 1); createToken(s, q, 'Gold', 1); } break; }
    case 'drink': { const q = hero(); if (q) drink(s, p, q); break; }
    case 'moat': moat(s, p, [...p.hand, ...p.arsenal].filter((x) => picks.includes(x.uid))); break;
    case 'pounce': pounce(s, s.players[_data![0]], p, picks); break;
    case 'graveEquip': if (yes) graveEquip(s, p, _data![0], _data![1]); break;
    case 'powerOrGoAgain': {
      const l = s.chain[_data![0]];
      if (!l) break;
      if (yes) { l.goAgain = true; log(s, p.id, `${cardOf(l.inst).name} gets go again.`); }
      else { l.powerMod += _data![1]; log(s, p.id, `${cardOf(l.inst).name} gets +${_data![1]}{p} (${linkPower(l)}).`); }
      break;
    }
    case 'payOrWeaken': {
      const [li, amount, cost] = _data!;
      const l = s.chain[li];
      if (!l) break;
      if (yes && availableResources(p) >= cost) { pay(s, p, cost, autoPitch(p, cost) ?? []); log(s, p.id, `${p.name} pays ${cost} for ${cardOf(l.inst).name}.`); }
      else { l.powerMod -= amount; log(s, p.id, `${cardOf(l.inst).name} gets -${amount}{p} (${linkPower(l)}).`); }
      break;
    }
  }
  void c;
}

/** `by` banished an opponent's card: contracts on `by`'s combat chain may be completed (each creates a Silver). */
function banishedFromOpp(s: GameState, by: PlayerState, inst: CardInst) {
  const c = cardOf(inst);
  const pitch = c.pitch ?? 0;
  const ok: Record<NonNullable<ReturnType<typeof getScript>['contract']>, boolean> = {
    nonAction: !has(c, 'Action'), attackAction: has(c, 'Attack') && has(c, 'Action'), nonAttackAction: has(c, 'Action') && !has(c, 'Attack'),
    red: pitch === 1, yellow: pitch === 2, blue: pitch === 3, reaction: has(c, 'Attack Reaction') || has(c, 'Defense Reaction'),
    lowDefense: (defenseOf(c) ?? 99) <= 2, cheap: costOf(c) <= 1, costly: costOf(c) >= 2, goAgain: getScript(c).goAgain,
  };
  for (const l of s.chain) {
    if (l.attacker !== by.id) continue;
    const k = getScript(cardOf(l.inst)).contract;
    if (!k || !ok[k]) continue;
    log(s, by.id, `${cardOf(l.inst).name}: contract completed (${c.name} banished).`, 'Contract: when you banish a card of the named kind from an opponent, the contract is completed.');
    createToken(s, by, 'Silver', 1);
  }
}

/** A hero destroyed a card someone else controls: Theryon may punish it. */
function destroyedBy(s: GameState, by: PlayerId, owner: PlayerId) {
  if (by === owner) return;
  for (const pl of s.players) if (pl.id !== by && !pl.eliminated) ability(pl)?.onOtherDestroys?.(heroCtx(s, pl), s.players[by]);
}

const evoCount = (p: PlayerState) => p.equipment.filter((e) => !e.destroyed && cardOf(e.inst).types.includes('Evo')).length;

/** Watery grave: a card put into the graveyard from the arena is turned face-down. */
function graveFromArena(p: PlayerState, inst: CardInst) {
  if (getScript(cardOf(inst)).wateryGrave) inst.faceDown = true;
  toGraveyard(p, inst);
}

/** Put a card into its owner's graveyard; ephemeral cards cease to exist instead. */
function toGraveyard(p: PlayerState, inst: CardInst) {
  const sc = getScript(cardOf(inst));
  if (sc.ephemeral) return;
  if (sc.banishInsteadOfGrave) { p.banished.push(inst); return; }
  p.graveyard.push(inst);
}

/** Clash: each hero reveals the top card of their deck; the hero whose card has the greater {p} wins. */
function clash(s: GameState, a: PlayerId = s.turnPlayer, b: PlayerId = oppOf(s, s.turnPlayer)): PlayerId | null {
  const two = [s.players[a], s.players[b]];
  const tops = two.map((pl) => pl.deck[0]);
  const pw = tops.map((t) => (t ? powerOf(cardOf(t)) : -1));
  const names = two.map((pl, i) => `${pl.name}: ${tops[i] ? `${cardOf(tops[i]!).name} (${pw[i]})` : 'no card'}`);
  let winner: PlayerId | null = pw[0] > pw[1] ? a : pw[1] > pw[0] ? b : null;
  if (winner === null) { const w = two.find((pl) => ability(pl)?.winsTiedClash); if (w) winner = w.id; }
  log(s, null, `Clash! ${names.join(' vs ')} — ${winner === null ? 'no winner' : `${s.players[winner].name} wins`}.`, 'Clash: each hero reveals the top card of their deck. The hero who revealed the card with the greatest {p} wins.');
  if (winner !== null) {
    s.players[winner].turn.clashesWon = (s.players[winner].turn.clashesWon ?? 0) + 1;
    { const wt = tops[winner === a ? 0 : 1]; const w = wt && getScript(cardOf(wt)).onClashWin; if (wt && w?.length) resolveEffects(s, s.players[winner], w, wt); }
    if (s.players[s.turnPlayer].turn.flags.clashDraw) draw(s, s.players[winner], 1); // Big Hits, Big Applause
  }
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
  const opp = s.players[oppOf(s, p.id)];
  const chainBy = s.chain.filter((l) => l.attacker === p.id);
  switch (cond.kind) {
    case 'auraThisTurn': return !!p.turn.auraPlayed;
    case 'lessLife': return p.life < opp.life;
    case 'draconicLinks': return chainBy.filter((l) => cardOf(l.inst).types.includes('Draconic')).length >= cond.n;
    case 'arcaneThisTurn': return !!p.turn.arcaneDealt;
    case 'dealtArcane': return (p.turn.flags.lastArcane ?? 0) > 0;
    case 'powerAboveBase': return !!link && link.powerMod > 0;
    case 'instantThisLink': return !!link && (link.instants ?? 0) > 0;
    case 'defendedByFewer': return !!link && link.defenders.filter((d) => d.kind !== 'equipment').length < cond.n;
    case 'powerAtLeast': return !!link && linkPower(link) >= cond.n;
    case 'reactionsThisLink': return !!link && (link.reactionCount ?? 0) >= cond.n;
    case 'discardedPower': return (p.turn.discardedPower ?? 0) >= cond.n;
    case 'hitWithDagger': return chainBy.some((l) => l.hit && cardOf(l.inst).types.includes('Dagger')) || !!p.turn.flags.daggerHit;
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
    case 'rolledSix': return !!p.turn.flags.rolledSix;
    case 'linkGoAgain': { const l = link ?? currentLink(s); return !!l && l.goAgain; }
    case 'linkClass': { const l = link ?? currentLink(s); return !!l && cardOf(l.inst).types.includes(cond.cls); }
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
    case 'moreLife': return p.life > opp.life;
    case 'oppTalent': return cardOf(opp.hero).types.includes(cond.talent);
    case 'wageredThisLink': { const l = link ?? currentLink(s); return !!l && (l.wagers?.length ?? 0) > 0; }
    case 'cheered': return (p.turn.cheers ?? 0) > 0;
    case 'booed': return (p.turn.boos ?? 0) > 0;
    case 'anotherRed': return p.turn.played.filter((id) => card(id).pitch === 1).length >= 2;
    case 'anotherBlue': return p.turn.played.filter((id) => card(id).pitch === 3).length >= 2;
    case 'transcended': return !!p.turn.flags.transcended;
    case 'emptyHand': return p.hand.length === 0;
    case 'emptyDeck': return p.deck.length === 0;
    case 'boostedTimes': return (p.turn.flags.boosts ?? 0) >= cond.n;
    case 'oppSoul': return (opp.soul ?? []).length > 0;
    case 'phantasmDestroyed': return !!p.turn.flags.phantasm;
    case 'createdToken': return !!p.turn.flags[`created:${cond.name}`];
    case 'lastAttackColor': { const prev = s.chain[s.chain.length - 2]; return !!prev && prev.attacker === p.id && !prev.fromWeapon && cardOf(prev.inst).pitch === cond.pitch; }
    case 'lastAttackName': { const prev = s.chain[s.chain.length - 2]; return !!prev && prev.attacker === p.id && cardOf(prev.inst).name.toLowerCase() === cond.name.toLowerCase(); }
    case 'hasAim': return !!(link ?? currentLink(s))?.inst.aim;
    case 'scrapped': { const l = link ?? currentLink(s); return !!l && !!p.turn.flags[`scrap${l.inst.uid}`]; }
    case 'beatChest': return !!p.turn.beatChest;
    case 'noChest': return !p.equipment.some((e) => !e.destroyed && cardOf(e.inst).types.includes('Chest'));
    case 'evoEquipped': return evoCount(p) >= cond.n;
    case 'all': return cond.conds.every((x) => evalCondition(s, p, x, link));
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
    case 'discard': return others.some((h) => oc.cost.kind === 'discard' && (!oc.cost.pitch || pitchOf(cardOf(h)) === oc.cost.pitch) && (!oc.cost.power || powerOf(cardOf(h)) >= oc.cost.power) && typeMatches(cardOf(h), oc.cost.type));
    case 'destroySelf': return p.permanents.some((pm) => pm.inst.uid === playingUid) || p.equipment.some((e) => e.inst.uid === playingUid && !e.destroyed);
    case 'banishSoul': return (p.soul ?? []).length > 0;
    case 'tapHero': return !p.heroTapped;
    case 'tapOwn': return !!untappedOwn(p, oc.cost.what, playingUid);
    case 'all': return oc.cost.costs.every((k) => k.kind === 'pay' || optionalPayable(p, { ...oc, cost: k }, playingUid));
    case 'pay': return true;
    case 'banishGrave': return p.graveyard.length >= oc.cost.n;
    case 'destroyTop': return p.deck.length > 0;
    case 'handToBottom': case 'banishHand': return others.length > 0;
    case 'discardOrTop': return others.length > 0 || p.deck.length > 0;
    case 'discardOrItem': return others.length > 0 || p.permanents.some((pm) => has(cardOf(pm.inst), 'Item'));
    case 'destroyOwn': return p.permanents.some((pm) => ownMatches(cardOf(pm.inst), oc.cost));
    case 'arsenalToBottom': return p.arsenal.length > 0;
    case 'banishGraveMatch': return p.graveyard.some((g) => graveMatches(cardOf(g), oc.cost));
    case 'decompose': return decomposePick(p, oc.cost.kind === 'decompose' ? oc.cost.earth : 0) !== null;
    case 'reveal': return others.some((h) => oc.cost.kind === 'reveal' && cardOf(h).types.includes(oc.cost.talent));
    case 'charge': return others.some((h) => oc.cost.kind === 'charge' && (!oc.cost.pitch || pitchOf(cardOf(h)) === oc.cost.pitch));
  }
}

/** "an instant card", "an attack action card", "a non-attack action card" */
export function typeMatches(c: Card, type?: string): boolean {
  if (!type) return true;
  if (type === 'Attack') return has(c, 'Attack') && has(c, 'Action');
  if (type === 'NonAttack') return has(c, 'Action') && !has(c, 'Attack');
  return has(c, type);
}

function graveMatches(c: Card, cost: OptionalCost['cost']): boolean {
  if (cost.kind !== 'banishGraveMatch') return false;
  if (cost.types) return cost.types.some((t) => c.types.includes(t));
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
  if (cost.name) return c.name.toLowerCase() === cost.name.toLowerCase() || getScript(c).countsAs?.toLowerCase() === cost.name.toLowerCase();
  return !!cost.type && c.types.includes(cost.type);
}

/** Pay an optional cost. Returns the card used (for "if a card with N+ power is discarded this way"). */
function payOptional(s: GameState, p: PlayerState, oc: OptionalCost, choice: OptionalChoice, playingUid: number): Card | null {
  const pick = (filter: (c: Card) => boolean) => {
    // no card named (e.g. an equipment's "when this defends, you may ..."): use the least useful one
    const inst = choice.uid !== undefined ? p.hand.find((h) => h.uid === choice.uid && h.uid !== playingUid)
      : [...p.hand].filter((h) => h.uid !== playingUid && filter(cardOf(h))).sort((a, b) => cardPlayValueLite(cardOf(a)) - cardPlayValueLite(cardOf(b)))[0];
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
      { const oc = getScript(cardOf(inst)).onCharge; if (oc?.length) { log(s, p.id, `${cardOf(inst).name}: solflare!`); resolveEffects(s, p, oc, inst); } }
      return cardOf(inst);
    }
    case 'discard': {
      const inst = pick((c) => (!cost.pitch || pitchOf(c) === cost.pitch) && (!cost.power || powerOf(c) >= cost.power) && typeMatches(c, cost.type));
      if (cost.power) { p.turn.beatChest = true; log(s, p.id, `${p.name} beats their chest!`, 'Beat Chest: as an additional cost to play this, you may discard a card with 6 or more power.'); fireTriggers(s, p, 'beatChest'); }
      p.graveyard.push(inst);
      noteDiscard(s, p, inst);
      log(s, p.id, `${p.name} discards ${cardOf(inst).name}.`);
      return cardOf(inst);
    }
    case 'discardOrItem': {
      const item = p.permanents.find((pm) => has(cardOf(pm.inst), 'Item'));
      if (choice.top || (choice.uid === undefined && !p.hand.some((h) => h.uid !== playingUid) && item)) {
        if (!item) throw new Error('You control no item.');
        removePermanent(s, p, item.inst.uid);
        return cardOf(item.inst);
      }
      const inst = pick(() => true);
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
      if (cost.types) p.turn.flags[`scrap${playingUid}`] = 1;
      log(s, p.id, cost.types ? `${p.name} scraps ${cardOf(g).name}.` : `${p.name} banishes ${cardOf(g).name} from the graveyard.`, cost.types ? 'Scrap: as an additional cost to play this, you may banish an item or equipment from your graveyard.' : undefined);
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
    case 'banishSoul': {
      const x = (p.soul ?? []).shift();
      if (!x) throw new Error('Your soul is empty.');
      p.banished.push(x);
      log(s, p.id, `${p.name} banishes ${cardOf(x).name} from their soul.`);
      return cardOf(x);
    }
    case 'tapHero':
      if (p.heroTapped) throw new Error('Your hero is already tapped.');
      p.heroTapped = true;
      log(s, p.id, `${p.name} taps their hero.`, RULES.tap);
      return null;
    case 'tapOwn': {
      const t = untappedOwn(p, cost.what, playingUid);
      if (!t) throw new Error('You have nothing untapped to tap for that.');
      tapThing(s, p, t);
      return cardOf(t.inst);
    }
    case 'all': {
      let used: Card | null = null;
      for (const k of cost.costs) {
        if (k.kind === 'pay') { pay(s, p, k.amount, autoPitch(p, k.amount) ?? []); continue; }
        used = payOptional(s, p, { ...oc, cost: k }, choice, playingUid) ?? used;
      }
      return used;
    }
    case 'destroySelf': {
      const pm = p.permanents.find((x) => x.inst.uid === playingUid);
      const eq = !pm && p.equipment.find((e) => e.inst.uid === playingUid && !e.destroyed);
      if (eq) { eq.destroyed = true; log(s, p.id, `${cardOf(eq.inst).name} is destroyed.`); return cardOf(eq.inst); }
      if (!pm) throw new Error('It is no longer in the arena.');
      removePermanent(s, p, pm.inst.uid);
      return cardOf(pm.inst);
    }
  }
}

/** Does `p`'s hero's activated ability have {t} in its cost ("Instant - {r}, {t}: ...")? */
function heroAbilityTaps(p: PlayerState): boolean {
  const h = cardOf(p.hero);
  return /(?:^|\n)(?:once per turn )?(?:action|instant|attack reaction|defense reaction)\s*[-–][^:\n]*\{t\}/i.test(h.text);
}

/** An untapped cog / ally `p` controls, or the card `uid` itself ('this'): a permanent, equipment or weapon. */
function untappedOwn(p: PlayerState, what: 'cog' | 'ally' | 'this', uid: number): { inst: CardInst; tapped?: boolean; usedThisTurn?: boolean } | undefined {
  if (what === 'this') {
    return p.permanents.find((pm) => pm.inst.uid === uid && !pm.tapped)
      ?? p.equipment.find((e) => e.inst.uid === uid && !e.destroyed && !e.usedThisTurn)
      ?? p.weapons.find((w) => w.inst.uid === uid && !w.usedThisTurn);
  }
  const type = what === 'cog' ? 'Cog' : 'Ally';
  return p.permanents.find((pm) => !pm.tapped && cardOf(pm.inst).types.includes(type));
}
/** {t} it: a permanent stays tapped until its controller's turn; equipment and weapons count as used this turn. */
function tapThing(s: GameState, p: PlayerState, t: { inst: CardInst; tapped?: boolean; usedThisTurn?: boolean }) {
  if ('usedThisTurn' in t && !p.permanents.some((pm) => pm.inst.uid === t.inst.uid)) t.usedThisTurn = true;
  else t.tapped = true;
  log(s, p.id, `${p.name} taps ${cardOf(t.inst).name}.`, RULES.tap);
}

/** How a bot decides a "you may <cost>. If you do, <then>" (set by the AI module; without it bots pay when they can). */
let botMayJudge: ((s: GameState, p: PlayerState, e: Extract<Effect, { kind: 'mayThen' }>, src: CardInst) => boolean) | null = null;
export function setBotMayJudge(fn: typeof botMayJudge) { botMayJudge = fn; }

/** "You may <cost>. If you do, <then>": can it be paid, and pay it (the ability's card is `src`). */
function mayPayable(p: PlayerState, cost: OptionalCostKind, src: CardInst): boolean {
  if (cost.kind === 'pay') return availableResources(p) >= cost.amount;
  if (cost.kind === 'all') return cost.costs.every((k) => mayPayable(p, k, src)) && availableResources(p) >= cost.costs.reduce((a, k) => a + (k.kind === 'pay' ? k.amount : 0), 0);
  return optionalPayable(p, { timing: 'play', cost, effects: [], costText: '', effectText: '' }, src.uid);
}
function payMay(s: GameState, p: PlayerState, cost: OptionalCostKind, src: CardInst) {
  if (cost.kind === 'pay') { pay(s, p, cost.amount, autoPitch(p, cost.amount) ?? []); return; }
  payOptional(s, p, { timing: 'play', cost, effects: [], costText: '', effectText: '' }, { accept: true }, src.uid);
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
  const ab = ability(p);
  if (ab?.tokenCount) amount = ab.tokenCount(heroCtx(s, p), t, amount);
  if (s.players[s.turnPlayer].turn.flags.tremor && amount > 0) amount += 1; // Tremor of Anticipation
  for (let i = 0; i < amount; i++) {
    const inst = mk(s, t.id, p.id);
    p.permanents.push({ inst, ward: getScript(t).ward });
  }
  if (has(t, 'Aura')) p.turn.auraPlayed = true;
  p.turn.flags[`created:${t.name}`] = 1;
  log(s, p.id, `${p.name} creates ${amount > 1 ? amount + ' ' : 'a '}${t.name} token${amount > 1 ? 's' : ''}.`);
  ab?.onCreateToken?.(heroCtx(s, p), t, amount);
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

/** how much a card is worth keeping in hand (low = first to put away) */
const cardPlayValueLite = (c: Card) => powerOf(c) + (defenseOf(c) ?? 0) + (c.pitch === 1 ? 2 : 0) + (has(c, 'Defense Reaction') ? 2 : 0);

export function effectiveCost(s: GameState, p: PlayerState, c: Card): number {
  void s;
  const sc = getScript(c);
  let less = 0;
  if (sc.costLessPer === 'draconicLink') less = s.chain.filter((l) => l.attacker === p.id && cardOf(l.inst).types.includes('Draconic')).length;
  else if (sc.costLessPer) less = p.permanents.filter((pm) => isA(pm.inst, sc.costLessPer!)).length;
  if (sc.costLessIf && p.permanents.some((pm) => cardOf(pm.inst).name.toLowerCase() === sc.costLessIf!.toLowerCase())) less += 1;
  less -= ability(p)?.cardCostMod?.(heroCtx(s, p), c) ?? 0;
  for (const e of p.effects) if (e.kind === 'costLess' && matchesFilter(e.filter, { inst: { uid: -1, cardId: c.id, owner: p.id }, fromWeapon: false })) less += e.amount;
  const more = has(c, 'Action') && s.turnPlayer === p.id ? p.turn.flags.costMore ?? 0 : 0;
  return Math.max(0, costOf(c) - less) + frostbite(p) + more;
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
  if (has(c, 'Defense Reaction') && currentLink(s)?.noDefenseReactions) return false;
  if (s.players[pid].turn.flags.noSmall && s.phase === 'action' && has(c, 'Attack') && has(c, 'Action') && powerOf(c) <= 3) return false;
  if (s.phase === 'gameOver' || s.priority !== pid) return false;
  const p = s.players[pid];
  const isInstant = has(c, 'Instant') || !!ability(p)?.asInstant?.(heroCtx(s, p), c, p.arsenal.some((a) => a.cardId === c.id))
    || p.hand.concat(p.banished, p.graveyard).some((h) => h.cardId === c.id && p.turn.flags[`asInstant${h.uid}`]);
  if (s.phase === 'action') {
    // while something is on the stack, either player may only respond with instants
    if (s.stack?.length) return isInstant;
    if (s.turnPlayer !== pid) return false;
    if (isInstant) return true;
    if (has(c, 'Action')) return p.actionPoints > 0;
    return false;
  }
  if (s.phase === 'reaction' || (isInstant && (s.phase === 'defend') && s.priority === pid)) {
    const l = currentLink(s);
    if (!l) return false;
    if (isInstant) return s.phase === 'reaction';
    if (has(c, 'Attack Reaction')) return l.attacker === pid && reactionTargetsOk(s, c);
    if (has(c, 'Defense Reaction')) {
      if (l.attacker === pid || defenderOf(l) !== pid) return false;
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
  if (s.priority !== pid || !['action', 'reaction'].includes(s.phase) || s.pendingTriggers || s.pendingChoices?.length) return out;
  const fromBanished = p.banished.filter((b) => { const fb = getScript(cardOf(b)).fromBanished; return !!fb && (!fb.cond || evalCondition(s, p, fb.cond)); });
  // cards an effect lets you play from your banished zone or graveyard this turn (Kano, Zen, Katsu, Blaze, Oscilio, Teklovossen)
  const ab0 = ability(p);
  for (const b of p.banished) {
    const c = cardOf(b);
    const free = !!p.turn.flags[`playBanished${b.uid}`];
    if (!free && !ab0?.playFromBanished?.(heroCtx(s, p), c)) continue;
    if (fromBanished.includes(b) || !timingOk(s, pid, c)) continue;
    const cost = p.turn.flags[`freePlay${b.uid}`] ? frostbite(p) : effectiveCost(s, p, c);
    if (availableResources(p) < cost) continue;
    out.push({ uid: b.uid, kind: 'card', index: 0, cost, label: c.name });
  }
  for (const g of p.graveyard) {
    if (!p.turn.flags[`playGrave${g.uid}`]) continue;
    const c = cardOf(g);
    if (!timingOk(s, pid, c)) continue;
    const cost = effectiveCost(s, p, c);
    if (availableResources(p) < cost) continue;
    out.push({ uid: g.uid, kind: 'card', index: 0, cost, label: `${c.name} (from graveyard)` });
  }
  // Rune Gate: with Runechants at least equal to its cost, play it from your banished zone without paying its cost
  const runechants = p.permanents.filter((pm) => isA(pm.inst, 'Runechant')).length;
  for (const b of p.banished) {
    const c = cardOf(b);
    if (!getScript(c).runeGate || fromBanished.includes(b) || runechants < costOf(c) || !timingOk(s, pid, c)) continue;
    out.push({ uid: b.uid, kind: 'card', index: 0, cost: frostbite(p), label: `${c.name} (rune gate)` });
  }
  for (const inst of [...p.hand, ...p.arsenal, ...fromBanished]) {
    const c = cardOf(inst);
    if (!timingOk(s, pid, c)) continue;
    const cost = effectiveCost(s, p, c);
    const sc = getScript(c);
    const extra = (sc.additionalCost.discardRandom ?? 0) + (sc.additionalCost.banishRandomHand ?? 0) + (sc.additionalCost.handToBottom ?? 0);
    if ((sc.additionalCost.banishSoul ?? 0) > (p.soul ?? []).length) continue;
    if (extra > 0 && p.hand.filter((h) => h.uid !== inst.uid).length < extra) continue;
    if ((sc.additionalCost.banishGraveyard ?? 0) > p.graveyard.length) continue;
    if (sc.playIf && !evalCondition(s, p, sc.playIf)) continue;
    if (sc.noFromHand && p.hand.some((h) => h.uid === inst.uid)) continue;
    if (availableResources(p, [inst.uid]) < cost) continue;
    out.push({ uid: inst.uid, kind: 'card', index: 0, cost, label: c.name });
  }
  const sources = [
    ...p.weapons.map((w) => ({ inst: w.inst, used: w.usedThisTurn })),
    ...p.equipment.filter((e) => !e.destroyed).map((e) => ({ inst: e.inst, used: e.usedThisTurn, faceDown: !!e.faceDown })),
    ...p.permanents.map((pm) => ({ inst: pm.inst, used: false, perm: true })),
    // the attack card on the active chain link: its "Instant - ...: This gets +1{p}" abilities
    ...(() => { const l = currentLink(s); return l && l.attacker === pid && !l.fromWeapon && l.damage === null ? [{ inst: l.inst, used: false, perm: true, chain: true }] : []; })(),
  ];
  for (const src of sources) {
    const sc = getScript(cardOf(src.inst));
    sc.activations.forEach((a, index) => {
      if (a.oncePerTurn && src.used) return;
      // a face-down (cloaked) equipment: only "turn this face-up" and "only while face-down" abilities work
      const fd = 'faceDown' in src && src.faceDown;
      if (fd ? !(a.faceUpCost || a.onlyFaceDown) : (a.faceUpCost || a.onlyFaceDown)) return;
      // an ally's (or other permanent's) once-per-turn ability; allies attack only during your action phase
      if (a.oncePerTurn && 'perm' in src && !a.tapSelf && (p.turn.flags[`act${src.inst.uid}:${index}`] ?? 0) >= (a.perTurn ?? 1)) return;
      if ('chain' in src && !a.instant) return;
      if (a.attack && sc.attackIfWeapon && !p.turn.weaponAttacked) return;
      if (a.tapSelf && !untappedOwn(p, 'this', src.inst.uid)) return;
      if (a.tapHero && p.heroTapped) return;
      if (a.tapCog && !untappedOwn(p, 'cog', src.inst.uid)) return;
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
  const heroTaps = heroAbilityTaps(p);
  ab?.activations?.forEach((a, i) => {
    // a hero ability with {t} in its cost: usable while the hero is untapped (an untap effect lets it go again)
    if (heroTaps ? p.heroTapped : a.oncePerTurn && p.turn.flags[`hero${i}`]) return;
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
    if (e.destroyed || e.faceDown || defenseOf(cardOf(e.inst)) === null) continue;
    const di = getScript(cardOf(e.inst)).defendIf;
    if (di && l) { const atk = s.players[l.attacker]; if (di.token ? !atk.turn.flags[`destroyed:${di.token}`] : !atk.turn.drew) continue; }
    out.push({ uid: e.inst.uid, kind: 'equipment', defense: defenseFor(p, cardOf(e.inst), equipDefense(e)) });
  }
  return out;
}

/** Validate a block. Returns an error message or null. */
export function checkDefense(s: GameState, uids: number[]): string | null {
  const l = currentLink(s);
  if (!l) return 'No attack to defend';
  const p = s.players[defenderOf(l)];
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

/** Yorick's shared deck and graveyard: make every player's arrays the same objects again (after JSON, e.g. a replay or an online save). */
export function linkSharedZones(s: GameState) {
  if (!s.sharedZones) return;
  const [a] = s.players;
  for (const p of s.players) { if (p.deck !== a.deck) p.deck = a.deck; if (p.graveyard !== a.graveyard) p.graveyard = a.graveyard; }
}

export function applyAction(prev: GameState, action: Action): GameState {
  const s: GameState = structuredClone(prev); // structuredClone keeps shared arrays shared
  linkSharedZones(s);
  if (s.phase === 'gameOver' && action.type !== 'manual') return s;
  if (s.pendingTriggers && !['orderTriggers', 'concede', 'manual'].includes(action.type)) throw new Error('Choose the order of your start-of-turn triggers first.');
  if (s.pendingChoices?.length && !['choose', 'concede', 'manual'].includes(action.type)) throw new Error('Make your choice first.');
  switch (action.type) {
    case 'play': doPlay(s, action.uid, action.pitch, action.mode ?? 0, action.optional); break;
    case 'activate': doActivate(s, action.uid, action.index, action.pitch); break;
    case 'pass': doPass(s, action.pitchOrder); break;
    case 'orderTriggers': doOrderTriggers(s, action.order); break;
    case 'choose': doChoose(s, action); break;
    case 'heave': doHeave(s, action.uid, action.pitch); break;
    case 'focus': {
      const who = s.players[s.turnPlayer === s.priority ? s.priority : s.turnPlayer];
      if (targetableOpponents(s, who.id).includes(action.player)) { who.focus = action.player; log(s, who.id, `${who.name} turns to face ${s.players[action.player].name}.`); }
      break;
    }
    case 'defend': doDefend(s, action.uids, action.boosts ?? [], action.pitch ?? []); break;
    case 'arsenal': if (action.pitchOrder) s.players[s.turnPlayer].turn.pitchOrder = action.pitchOrder; doArsenal(s, action.uid); break;
    case 'concede': {
      const loser = s.priority;
      log(s, loser, `${pname(s, loser)} concedes.`);
      eliminate(s, s.players[loser]);
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
    const op = getScript(c).onPitch;
    if (op?.length) resolveEffects(s, p, op, inst);
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
  const fromGrave = !fromArsenal && !fromBanished && !p.hand.some((h) => h.uid === uid) && p.graveyard.some((g) => g.uid === uid);
  if (fromBanished && getScript(cardOf(p.banished.find((b) => b.uid === uid)!)).runeGate) p.turn.flags[`runeGated${uid}`] = 1;
  const zone = fromArsenal ? p.arsenal : fromBanished ? p.banished : fromGrave ? p.graveyard : p.hand;
  const c = cardOf(zone.find((h) => h.uid === uid)!);
  const sc = getScript(c);
  // Meld: the Action half (and the meld) needs an action; otherwise only the Instant half can be played
  if (sc.meldAction && mode !== 1 && !(s.phase === 'action' && !s.stack?.length && s.turnPlayer === pid && p.actionPoints > 0)) {
    mode = 1;
    log(s, pid, `Only ${sc.modes[1]?.label ?? 'the instant half'} of ${c.name} can be played now.`);
  }
  // optional cost ("you may ... If you do, ..."): validate before paying anything
  const oc = optional?.accept && sc.optional && sc.optional.timing !== 'defend' ? sc.optional : undefined;
  if (oc && !optionalPayable(p, oc, uid)) throw new Error('You can’t pay that optional cost.');
  if (oc && optional?.uid !== undefined && pitch.includes(optional.uid)) throw new Error('That card is being pitched.');
  const extraCost = oc?.cost.kind === 'pay' ? oc.cost.amount : 0;
  const inst = removeFrom(zone, uid)!;
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
  if (sc.additionalCost.banishSoul) {
    const gone = (p.soul ?? []).splice(0, sc.additionalCost.banishSoul);
    p.banished.push(...gone);
    log(s, pid, `${p.name} banishes ${gone.length} cards from their hero's soul.`);
  }
  for (let i = 0; i < (sc.additionalCost.handToBottom ?? 0); i++) {
    // the player picks the card (optional.uid); otherwise the least useful one: the lowest pitch-and-power card
    const chosen = p.hand.find((h) => h.uid === optional?.uid);
    if (!chosen && !p.isBot && p.hand.length > 1) {
      ask(s, { player: pid, kind: 'pick', prompt: `${c.name}: as an additional cost, put a card from your hand on the bottom of your deck.`, confirm: 'Put it on the bottom', options: p.hand.map((h) => ({ uid: h.uid, cardId: h.cardId })), resume: { type: 'handToBottom' } });
      continue;
    }
    const pick = chosen ?? [...p.hand].sort((a, b) => cardPlayValueLite(cardOf(a)) - cardPlayValueLite(cardOf(b)))[0];
    if (pick) { removeFrom(p.hand, pick.uid); p.deck.push(pick); log(s, pid, `${p.name} puts a card from their hand on the bottom of their deck.`); }
  }
  for (let i = 0; i < (sc.additionalCost.banishRandomHand ?? 0); i++) {
    const d = p.hand.splice(Math.floor(rand(s) * p.hand.length), 1)[0];
    if (d) { p.banished.push(d); log(s, pid, `${p.name} banishes ${cardOf(d).name} at random.`); }
  }
  const optUsed = oc ? payOptional(s, p, oc, optional!, uid) : null;
  // a cost reduction for "your next ... card" is used up by this card
  const cl = p.effects.findIndex((e) => e.kind === 'costLess' && matchesFilter(e.filter, { inst, fromWeapon: false }));
  if (cl >= 0) p.effects.splice(cl, 1);
  const isAction = (has(c, 'Action') && !has(c, 'Instant')) || (!!sc.meldAction && mode !== 1);
  if (s.phase === 'action' && isAction) p.actionPoints -= 1;
  if (has(c, 'Action')) p.turn.flags.costMore = 0; // "their first action during their next turn costs an additional {r}"
  log(s, pid, `${p.name} plays ${c.name}${fromArsenal ? ' from arsenal' : fromBanished ? ' from the banished zone' : ''}.`);
  p.turn.played.push(c.id);
  if (has(c, 'Aura')) p.turn.auraPlayed = true;
  if (has(c, 'Action')) fireTriggers(s, p, 'playAction');
  if (has(c, 'Action') && !has(c, 'Attack')) fireTriggers(s, p, 'playNonAttackAction');
  if (has(c, 'Aura')) fireTriggers(s, p, 'playAura');
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
  const isAction = (has(c, 'Action') && !has(c, 'Instant')) || (!!sc.meldAction && mode !== 1);
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
    if (ability(p)?.grantGoAgain?.(heroCtx(s, p), c)) goAgain = true;
  }
  const instead = sc.conditional.find((x) => x.when === 'instead' && x.cond && evalCondition(s, p, x.cond));
  if (instead) log(s, pid, `${c.name}: condition met — the stronger effect applies instead.`);
  resolveEffects(s, p, instead ? instead.effects : sc.onPlay, inst);
  resolveConditionals(s, p, c, inst, 'if');
  applyAdditionalPayoff(s, p, c, inst);
  if (oc) optionalPayoff(s, p, oc, optUsed, inst);
  if (fromArsenal) for (const cnd of sc.conditional) if (cnd.when === 'fromArsenal') resolveEffects(s, p, cnd.effects, inst);
  if (p.turn.flags[`banishedPlay${inst.uid}`]) for (const cnd of sc.conditional) if (cnd.when === 'fromBanished') resolveEffects(s, p, cnd.effects, inst);
  if (sc.evoSlot) {
    // Evo: transform the base equipment in that slot into this
    const base = p.equipment.find((e) => !e.destroyed && cardOf(e.inst).types.includes('Base') && cardOf(e.inst).types.includes(sc.evoSlot!));
    if (base) {
      log(s, pid, `${cardOf(base.inst).name} transforms into ${c.name}.`, 'Evo: if you have a base equipment in that slot, it transforms into the Evo, which is equipped.');
      base.inst = inst; base.defenseMod = 0; base.usedThisTurn = false;
    } else {
      log(s, pid, `${c.name} has no base ${sc.evoSlot.toLowerCase()} to transform.`);
      toGraveyard(p, inst);
    }
  } else if (['Aura', 'Item', 'Ally'].some((t) => has(c, t))) {
    const pm: PermanentState = { inst, ward: sc.ward, steam: sc.steam || undefined, suspense: sc.suspense ? 2 : undefined, counters: sc.startCounters?.n };
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
  if (isAction && goAgain && s.phase === 'action' && !p.turn.flags.noGoAgain) { p.actionPoints += 1; log(s, pid, `${c.name} has go again: ${p.name} gains an action point.`, RULES.goAgain); }
  if (s.phase === 'reaction') afterReactionPlay(s);
}

// ---------------------------------------------------------------- the stack and priority

/** After `pid` adds a layer, the other player gets priority (they may respond with an instant or pass). */
function openPriority(s: GameState, pid: PlayerId) {
  s.priority = nextAlive(s, pid);
  s.passes = 1; // the player who just acted counts as having passed
  settleStack(s);
}

/** Players who couldn't respond with anything pass automatically, so play keeps flowing. */
function settleStack(s: GameState) {
  for (let i = 0; i < 40 && s.phase === 'action' && s.stack?.length && playOptions(s, s.priority).length === 0; i++) passOnStack(s);
}

function passOnStack(s: GameState) {
  s.passes += 1;
  if (s.passes < alivePlayers(s).length) { s.priority = nextAlive(s, s.priority); return; }
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
    if (heroAbilityTaps(p)) { p.heroTapped = true; log(s, pid, `${p.name} taps their hero.`, RULES.tap); }
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
    if (a.oncePerTurn && (p.permanents.some((pm) => pm.inst.uid === uid) || s.chain.some((l) => l.inst.uid === uid))) p.turn.flags[`act${uid}:${index}`] = (p.turn.flags[`act${uid}:${index}`] ?? 0) + 1;
    if (a.faceUpCost) { const fe = p.equipment.find((x) => x.inst.uid === uid); if (fe) { fe.faceDown = false; log(s, pid, `${p.name} turns ${c.name} face-up.`); } }
    if (a.tapSelf) { const t = untappedOwn(p, 'this', uid); if (t) tapThing(s, p, t); }
    if (a.tapHero) { p.heroTapped = true; log(s, pid, `${p.name} taps their hero.`, RULES.tap); }
    if (a.tapCog) { const t = untappedOwn(p, 'cog', uid); if (t) tapThing(s, p, t); }
    label = c.name;
    log(s, pid, `${p.name} activates ${c.name}.`);
    if (p.permanents.some((pm) => pm.inst.uid === uid)) ability(p)?.onActivatePermanent?.(heroCtx(s, p), c);
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
  const firstNewUid = s.nextUid;
  const c = cardOf(inst);
  const sc = getScript(c);
  // an ally attacks with its own power and stays in the arena (like a weapon), but it isn't a weapon attack
  const allyPm = fromWeapon ? p.permanents.find((pm) => pm.inst.uid === inst.uid && has(cardOf(pm.inst), 'Ally')) : undefined;
  const weapon = fromWeapon && !allyPm;
  const link: ChainLink = {
    attacker: p.id, inst, fromWeapon, fromArsenal, ally: allyPm ? true : undefined,
    basePower: basePowerFor(p, c) + (weapon ? p.weapons.find((w) => w.inst.uid === inst.uid)?.counters ?? 0 : 0),
    powerMod: weapon ? p.turn.flags.weaponBonus ?? 0 : 0,
    goAgain: sc.goAgain, dominate: sc.dominate, overpower: sc.overpower, piercing: sc.piercing,
    defenders: [], reactions: [], damage: null, hit: false, extraOnHit: mode?.onHit ?? [],
    noEquipDefense: sc.noEquipDefense || undefined,
    unpreventable: sc.unpreventable || undefined,
  };
  if (p.turn.flags[`runeGated${inst.uid}`]) (link as ChainLink & { runeGated?: boolean }).runeGated = true;
  s.chain.push(link);
  s.chainOpen = true;
  // allies and spectra auras can be attacked: a human attacker chooses the target (bots go for the hero)
  // who defends: the hero the combat chain is focused on, else the attacker's chosen neighbour (bots: the weakest)
  const prev = s.chain[s.chain.length - 2];
  const legal = targetableOpponents(s, p.id);
  link.defender = prev ? defenderOf(prev)
    : p.focus !== undefined && legal.includes(p.focus) ? p.focus
    : p.isBot ? pitTarget(s, p, legal, linkPower(link)) ?? oppOf(s, p.id)
    : legal[0] ?? oppOf(s, p.id);
  const heroes = prev ? [s.players[link.defender].hero] : legal.map((q) => s.players[q].hero);
  const targets = (prev ? [link.defender] : legal).flatMap((q) => attackablePermanents(s.players[q]));
  if ((targets.length || heroes.length > 1) && !p.isBot) {
    ask(s, { player: p.id, kind: 'target', prompt: `What does ${c.name} attack?`, options: [...heroes, ...targets.map((pm) => pm.inst)].map((i) => ({ uid: i.uid, cardId: i.cardId })), resume: { type: 'attackTarget', link: s.chain.length - 1 } });
  }
  p.turn.attacks += 1;
  if (link.defender !== undefined && p.drinkFrom === link.defender) { link.powerMod -= 2; log(s, p.id, `${c.name} gets -2{p} (Let Me Buy You a Drink).`); }
  if (p.turn.flags.anyTargetNext) p.turn.flags.anyTarget = p.turn.flags.anyTargetNext = 0; // Crowd Roars Fight!: only this attack
  if (link.defender !== undefined && p.turn.flags.ezSqeez) addWager(s, p, s.chain.length - 1, ['Gold', 'Gold']);
  if (link.defender !== undefined && p.turn.flags.winnerTakesAll) {
    createToken(s, p, 'Gold', 1); createToken(s, s.players[link.defender], 'Gold', 1);
    addWager(s, p, s.chain.length - 1, []);
    link.wagers![link.wagers!.length - 1].goldSwap = true;
  }
  if (s.players.length > 2 && link.defender !== undefined) { const d = s.players[link.defender]; (d.attackedBy ??= {})[p.id] = (d.attackedBy[p.id] ?? 0) + 1; }
  if (weapon) p.turn.weaponAttacked = true;
  if (allyPm) p.turn.flags.allyAttacks = (p.turn.flags.allyAttacks ?? 0) + 1;
  const target = s.players[link.defender];
  target.turn.attackedTimes = (target.turn.attackedTimes ?? 0) + 1;
  for (const pl of s.players) if (pl.id !== p.id && pl.id !== link.defender && !pl.eliminated) ability(pl)?.onOtherAttack?.(heroCtx(s, pl), link);
  // pending "next attack" effects
  const grantedOnAttack: Effect[] = [];
  p.effects = p.effects.filter((e) => {
    if (e.kind === 'nextAttackPower' && matchesFilter(e.filter, link)) { link.powerMod += e.amount; return false; }
    if (e.kind === 'nextAttackGoAgain' && matchesFilter(e.filter, link)) { link.goAgain = true; return false; }
    if (e.kind === 'nextAttackDominate') { link.dominate = true; return false; }
    if (e.kind === 'turnAttackPower' && matchesFilter(e.filter, link)) { link.powerMod += e.amount; return true; }
    if (e.kind === 'turnAttackDominate') { link.dominate = true; return true; }
    if (e.kind === 'turnAttackGoAgain' && matchesFilter(e.filter, link)) { link.goAgain = true; return true; }
    if (e.kind === 'nextAttackGoldPower') { const g = p.permanents.filter((pm) => isA(pm.inst, 'Gold')).length; link.powerMod += g; if (g) log(s, p.id, `${c.name} gets +${g}{p} for ${p.name}'s Gold (${e.source}).`); return false; }
    if (e.kind === 'nextAttackOnHit' && matchesFilter(e.filter, link)) { link.extraOnHit = [...link.extraOnHit, ...e.effects]; return false; }
    if (e.kind === 'nextAttackOnAttack' && matchesFilter(e.filter, link)) { grantedOnAttack.push(...e.effects); return false; }
    return true;
  });
  // token triggers
  for (const pm of [...p.permanents]) {
    const name = cardOf(pm.inst).name;
    const destroy = () => removePermanent(s, p, pm.inst.uid);
    if (isA(pm.inst, 'Runechant')) {
      // a card that counts as a Runechant ("Runechant of Envy") is usurped: its own payoff too
      const usurp = name !== 'Runechant' ? getScript(cardOf(pm.inst)).onUsurp : undefined;
      if (usurp?.length) { log(s, p.id, `${c.name} usurps ${name}.`); resolveEffects(s, p, usurp, pm.inst); }
      if (p.permanents.includes(pm)) destroy();
      if (dealDamage(s, link.defender!, 1, true, 'Runechant') > 0) p.turn.arcaneDealt = true;
    }
    else if (name === 'Quicken') { destroy(); link.goAgain = true; }
    else if (name === 'Courage') { destroy(); link.powerMod += 1; }
    else if (name === 'Embodiment of Lightning' && !fromWeapon) { destroy(); link.goAgain = true; }
    else if (name === 'Blade Dance' && weapon) { destroy(); link.goAgain = true; }
  }
  // "when you play an attack action card / activate a weapon attack" abilities (the attack is on the chain now; Runechants went first)
  if (weapon || (!fromWeapon && has(c, 'Attack') && has(c, 'Action'))) fireTriggers(s, p, weapon ? 'weaponAttack' : 'playAttackAction', link, firstNewUid);
  if (!s.chain.includes(link) || (s.phase as string) === 'gameOver') return;
  if (!fromWeapon) {
    resolveEffects(s, p, sc.onPlay, inst);
    if (mode) resolveEffects(s, p, mode.onPlay, inst);
    const prev = s.chain[s.chain.length - 2];
    for (const cnd of sc.conditional) {
      if (cnd.when === 'combo' && prev && prev.attacker === p.id && (cnd.comboWith ?? '').toLowerCase().split(' or ').includes(cardOf(prev.inst).name.toLowerCase())) {
        log(s, p.id, `Combo! (${cardOf(prev.inst).name} → ${c.name})`);
        resolveEffects(s, p, cnd.effects, inst);
      }
    }
    if (fromArsenal) for (const cnd of sc.conditional) if (cnd.when === 'fromArsenal') resolveEffects(s, p, cnd.effects, inst);
    if (p.turn.flags[`banishedPlay${inst.uid}`]) for (const cnd of sc.conditional) if (cnd.when === 'fromBanished') resolveEffects(s, p, cnd.effects, inst);
    applyAdditionalPayoff(s, p, c, inst);
    if (optional && optional.oc.timing === 'play') optionalPayoff(s, p, optional.oc, optional.used, inst);
    if (sc.boost && p.deck.length > 0) {
      const top = p.deck.shift()!;
      p.turn.boosted = true;
      p.turn.flags.boosts = (p.turn.flags.boosts ?? 0) + 1;
      if (!ability(p)?.onBoostBanish?.(heroCtx(s, p), top)) p.banished.push(top);
      const mech = has(cardOf(top), 'Mechanologist');
      log(s, p.id, `${p.name} boosts, banishing ${cardOf(top).name}${mech ? ' — go again!' : '.'}`);
      if (mech) link.goAgain = true;
      fireTriggers(s, p, 'boost');
    }
  }
  if (sc.intimidateOnAttack) resolveEffects(s, p, [{ kind: 'intimidate' }], inst);
  resolveEffects(s, p, sc.onAttack, inst);
  if (grantedOnAttack.length) resolveEffects(s, p, grantedOnAttack, inst);
  // "If ..., this gets ..." is checked once the attack's own triggers (cheers, wagers, ...) have happened
  if (!fromWeapon) resolveConditionals(s, p, c, inst, 'if');
  if (mode) resolveEffects(s, p, mode.onAttack, inst);
  if (optional && optional.oc.timing === 'attack') optionalPayoff(s, p, optional.oc, optional.used, inst);
  ability(p)?.onAttack?.(heroCtx(s, p), link);
  if (s.phase === 'gameOver') return;
  // its target was knocked out by the attack's own triggers (Pit Fight): the attack is over
  if (!s.chain.includes(link)) { log(s, p.id, `${c.name} has no hero left to attack.`); return; }
  log(s, p.id, `Attack: ${c.name} — ${linkPower(link)} power${link.goAgain ? ', go again' : ''}${link.dominate ? ', dominate' : ''}${link.overpower ? ', overpower' : ''}.`, link.dominate ? RULES.dominate : link.overpower ? RULES.overpower : link.goAgain ? RULES.goAgain : undefined);
  s.phase = 'defend';
  s.priority = link.defender!;
}

function doDefend(s: GameState, uids: number[], boosts: number[] = [], pitch: number[] = []) {
  const l = currentLink(s);
  if (s.phase !== 'defend' || !l) throw new Error('Not defending now');
  const err = checkDefense(s, uids);
  if (err) throw new Error(err);
  const legal = new Set(defendOptions(s, s.priority).map((o) => o.uid));
  if (uids.some((u) => !legal.has(u))) throw new Error('That card can’t defend.');
  const d = s.players[defenderOf(l)];
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
  // Fragment: each defending card with 2 or more defense makes this attack lose 2 power
  const atk = getScript(cardOf(l.inst));
  if (atk.fragment) {
    for (const x of l.defenders) {
      if ((defenseOf(cardOf(x.inst)) ?? 0) < 2) continue;
      l.powerMod -= 2;
      log(s, l.attacker, `${cardOf(l.inst).name} fragments: -2 power (${linkPower(l)}).`, 'Fragment: whenever a card with 2 or more defense defends this, this gets -2 power.');
      if (atk.onFragment.length) resolveEffects(s, s.players[l.attacker], atk.onFragment, l.inst);
    }
  }
  // Mirage: a mirage defending a non-Illusionist attack with 6 or more power is destroyed
  if (!cardOf(l.inst).types.includes('Illusionist') && linkPower(l) >= 6) {
    for (const x of [...l.defenders]) {
      if (!getScript(cardOf(x.inst)).mirage) continue;
      l.defenders = l.defenders.filter((y) => y !== x);
      graveFromArena(d, x.inst);
      log(s, d.id, `${cardOf(x.inst).name} (mirage) is destroyed by the ${linkPower(l)}-power attack.`, 'Mirage: when this is defending a non-Illusionist attack with 6 or more power, destroy it.');
    }
  }
  // lasting defense bonuses
  const grants = d.permanents.map((pm) => getScript(cardOf(pm.inst)).grantDefend).filter((g): g is NonNullable<typeof g> => !!g);
  for (const x of l.defenders) {
    const c = cardOf(x.inst);
    const db = getScript(c).defendBonus;
    if (db?.when === 'weaponAttack' && l.fromWeapon && !l.ally) { x.defense += db.amount; log(s, d.id, `${c.name} gets +${db.amount} defense against a weapon attack.`); }
    if (x.kind !== 'equipment' && has(c, 'Action')) for (const g of grants) {
      if ((g.cards === 'attackAction') === has(c, 'Attack')) { x.defense += g.amount; log(s, d.id, `${c.name} gets +${g.amount} defense.`); }
    }
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
    if ((oc.cost.kind === 'handToBottom') && !d.isBot && d.hand.length + d.arsenal.length > 0) {
      ask(s, { player: d.id, kind: 'pick', prompt: `${cardOf(x.inst).name}: put a card from your hand or arsenal on the bottom of your deck to ${oc.effectText}? Pick one, or skip.`, confirm: 'Put it on the bottom', skippable: true, options: [...d.hand, ...d.arsenal].map((h) => ({ uid: h.uid, cardId: h.cardId })), resume: { type: 'defendCost', uid: x.inst.uid } });
      continue;
    }
    if (oc.cost.kind !== 'pay') {
      if (!optionalPayable(d, oc, x.inst.uid)) { log(s, d.id, `${cardOf(x.inst).name}: nothing left to pay with, so its ability isn't used.`); continue; }
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
    s.players[l.attacker].turn.flags.phantasm = 1;
  }
  if (l.piercing > 0 && l.defenders.some((x) => x.kind === 'equipment')) {
    l.powerMod += l.piercing;
    log(s, l.attacker, `Piercing: ${cardOf(l.inst).name} gets +${l.piercing} power.`);
  }
  log(s, d.id, names.length ? `${d.name} defends with ${names.join(', ')} (${linkDefense(l)}).` : `${d.name} doesn’t defend.`);
  // Bolfar: the attack also targets a second hero, who now declares their own defenders
  if (l.also?.stage === 'pending' && !s.players[l.also.defender].eliminated) {
    l.also.main = { defender: defenderOf(l), defenders: l.defenders };
    l.defender = l.also.defender;
    l.defenders = [];
    l.also.stage = 'declaring';
    s.priority = l.also.defender;
    log(s, l.also.defender, `${s.players[l.also.defender].name} defends ${cardOf(l.inst).name} too.`);
    return;
  }
  if (l.also?.stage === 'declaring' && l.also.main) {
    l.also.defenders = l.defenders;
    l.defenders = l.also.main.defenders;
    l.defender = l.also.main.defender;
    l.also.stage = 'done';
  }
  s.phase = 'reaction';
  s.priority = l.attacker;
  s.passes = 0;
  if (s.players.length > 2) offerProtect(s, l);
}

/** In the reaction step, priority goes back and forth between the attacker and the defender. */
function swapReactionPriority(s: GameState) {
  const l = currentLink(s);
  // two players: back and forth; Ultimate Pit Fight: round the table
  s.priority = !l ? other(s.priority) : s.players.length > 2 ? nextAlive(s, s.priority) : s.priority === l.attacker ? defenderOf(l) : l.attacker;
}
function afterReactionPlay(s: GameState) {
  swapReactionPriority(s);
  s.passes = 0;
}

function doPass(s: GameState, pitchOrder?: number[]) {
  if (s.phase === 'action' && s.stack?.length) { passOnStack(s); settleStack(s); return; }
  if (pitchOrder) s.players[s.turnPlayer].turn.pitchOrder = pitchOrder;
  if (s.phase === 'reaction') {
    s.passes += 1;
    if (s.passes >= alivePlayers(s).length) resolveDamage(s);
    else swapReactionPriority(s);
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
  const defender = s.players[defenderOf(l)];
  // "If this is defended by an action card / has N or more power / ... this chain link, ..."
  if (!l.fromWeapon) resolveConditionals(s, attacker, cardOf(l.inst), l.inst, 'ifLink', l);
  ability(attacker)?.beforeDamage?.(heroCtx(s, attacker), l);
  for (const x of l.defenders) {
    const db = getScript(cardOf(x.inst)).defendBonus;
    if (db?.when === 'reactionThisLink' && (l.reactionCount ?? 0) > 0) { x.defense += db.amount; log(s, defender.id, `${cardOf(x.inst).name} gets +${db.amount} defense.`); }
  }
  const power = linkPower(l);
  // Bolfar's second hero: they take the attack's damage minus their own defenders
  if (l.also?.stage === 'done' && !s.players[l.also.defender].eliminated) {
    const x = s.players[l.also.defender];
    const xdef = l.also.defenders.reduce((a, d) => a + d.defense, 0);
    const xdealt = Math.max(0, power - xdef) > 0 ? dealDamage(s, x.id, power - xdef, false, cardOf(l.inst).name, l.unpreventable) : 0;
    if (xdealt > 0 && s.phase !== 'gameOver') {
      const main = l.defender;
      l.defender = x.id; // effects of the hit apply to this hero
      const sc0 = getScript(cardOf(l.inst));
      resolveEffects(s, attacker, [...sc0.onHit, ...l.extraOnHit], l.inst);
      if (xdealt >= 4) for (const cnd of sc0.conditional) if (cnd.when === 'crush') { log(s, l.attacker, 'Crush!'); resolveEffects(s, attacker, cnd.effects, l.inst); }
      l.defender = main;
    }
    if (s.phase === 'gameOver' || !s.chain.includes(l)) return;
  }
  const def = linkDefense(l);
  let raw = Math.max(0, power - def);
  if (raw > 0 && raw < 4 && attacker.turn.flags.crushingImpact) { attacker.turn.flags.crushingImpact = 0; raw = 4; log(s, attacker.id, 'Crushing Impact: the damage becomes 4.'); }
  const allyTarget = l.target !== undefined && defender.permanents.some((pm) => pm.inst.uid === l.target);
  const dealt = raw <= 0 ? 0 : allyTarget ? damageAlly(s, defender, l.target!, raw, cardOf(l.inst).name) : dealDamage(s, defender.id, raw, false, cardOf(l.inst).name, l.unpreventable);
  l.hit = dealt > 0;
  if (raw === 0) log(s, null, `${cardOf(l.inst).name} is fully blocked.`);
  if (l.hit && s.phase !== 'gameOver' && !allyTarget) { // hitting an ally isn't hitting a hero
    if (l.ally) attacker.turn.flags.allyHits = (attacker.turn.flags.allyHits ?? 0) + 1;
    else if (l.fromWeapon) {
      attacker.turn.weaponHits += 1;
      const hits = (attacker.turn.flags[`hits${l.inst.uid}`] = (attacker.turn.flags[`hits${l.inst.uid}`] ?? 0) + 1);
      const w = attacker.weapons.find((x) => x.inst.uid === l.inst.uid);
      if (w && hits === 2 && getScript(cardOf(w.inst)).secondHitCounter) { w.counters = (w.counters ?? 0) + 1; log(s, attacker.id, `${cardOf(w.inst).name} hits a second time this turn: +1{p} counter (${w.counters}).`); }
    }
    else attacker.turn.attackActionHits += 1;
    const sc = getScript(cardOf(l.inst));
    resolveEffects(s, attacker, [...sc.onHit, ...l.extraOnHit], l.inst); // link is still "current" here
    if (dealt >= 4) for (const cnd of sc.conditional) if (cnd.when === 'crush') { log(s, l.attacker, 'Crush!'); resolveEffects(s, attacker, cnd.effects, l.inst); }
    for (const cnd of sc.conditional) if (cnd.when === 'surge' && dealt > (cnd.threshold ?? 0)) { log(s, l.attacker, 'Surge!'); resolveEffects(s, attacker, cnd.effects, l.inst); }
    if (sc.hitDestination && !l.fromWeapon) l.destination = sc.hitDestination;
    ability(attacker)?.onHit?.(heroCtx(s, attacker), l);
    fireTriggers(s, attacker, 'hit', l);
    // Concealed traps: a face-down equipment of the hero who was hit
    for (const e of defender.equipment) {
      const cc = e.faceDown && !e.destroyed ? getScript(cardOf(e.inst)).concealed : undefined;
      if (!cc) continue;
      const ok = cc.when === 'goAgain' ? l.goAgain : cc.when === 'aboveBase' ? l.powerMod > 0 : (l.reactionCount ?? 0) > 0;
      if (!ok) continue;
      e.destroyed = true; e.faceDown = false;
      log(s, defender.id, `${cardOf(e.inst).name} springs: ${defender.name} destroys it.`);
      for (const q of s.players) if (q.id !== defender.id && !q.eliminated) createToken(s, q, cc.token, 1);
    }
    if (defender.marked) { defender.marked = false; log(s, defender.id, `${defender.name} is no longer marked.`); }
  }
  l.damage = dealt;
  settleWagers(s, l);
  // equipment wear
  for (const d of [...l.defenders, ...(l.also?.defenders ?? [])]) {
    const dp = s.players[d.inst.owner] ?? defender; // a protecting hero's cards go back to them
    if (d.kind === 'equipment') {
      const e = dp.equipment.find((e) => e.inst.uid === d.inst.uid);
      if (!e) continue;
      const esc = getScript(cardOf(e.inst));
      if (esc.bladeBreak) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} breaks (blade break).`, RULES.bladeBreak); }
      else if (esc.battleworn) e.defenseMod -= 1;
      else if (esc.temper) {
        e.defenseMod -= 1;
        if (equipDefense(e) <= 0) { e.destroyed = true; log(s, defender.id, `${cardOf(e.inst).name} is destroyed (temper).`, RULES.temper); }
      }
    } else if (ability(attacker)?.banishStealthBlockers && cardOf(l.inst).keywords.includes('Stealth') && has(cardOf(d.inst), 'Action')) {
      dp.banished.push(d.inst);
      log(s, dp.id, `${cardOf(d.inst).name} is banished (Nuu).`);
    } else {
      toGraveyard(dp, d.inst);
    }
  }
  for (const pl of s.players) ability(pl)?.onLinkResolve?.(heroCtx(s, pl), l);
  // resolution step
  if (s.phase === 'gameOver') return;
  if (l.goAgain && !attacker.turn.flags.noGoAgain) attacker.actionPoints += 1;
  s.phase = 'action';
  s.priority = s.turnPlayer;
  s.passes = 0;
}

function closeChain(s: GameState) {
  // "When the combat chain closes, if this didn't hit, the defending hero creates a <X> token"
  for (const l of s.chain) { const t = getScript(cardOf(l.inst)).closeMissToken; if (t && !l.hit && !l.fromWeapon) createToken(s, s.players[defenderOf(l)], t, 1); }
  if (s.chain.length) for (const pl of s.players) fireTriggers(s, pl, 'chainClose');
  for (const l of s.chain) {
    if (l.fromWeapon) continue;
    const owner = s.players[l.attacker];
    if (l.destination === 'soul') { (owner.soul ??= []).push(l.inst); log(s, owner.id, `${cardOf(l.inst).name} is put into ${owner.name}'s soul.`); }
    else if (l.destination === 'deckBottom') owner.deck.push(l.inst);
    else if (l.destination === 'hand') { owner.hand.push(l.inst); log(s, owner.id, `${cardOf(l.inst).name} returns to ${owner.name}'s hand.`); }
    else graveFromArena(owner, l.inst);
  }
  // Guardwell: equipment that defended loses all its defense when the combat chain closes
  for (const l of s.chain) for (const d of l.defenders) {
    if (d.kind !== 'equipment' || !getScript(cardOf(d.inst)).guardwell) continue;
    const e = s.players[d.inst.owner].equipment.find((x) => x.inst.uid === d.inst.uid);
    if (e && !e.destroyed) { e.defenseMod -= equipDefense(e); log(s, d.inst.owner, `${cardOf(e.inst).name} (guardwell) loses its defense.`); }
  }
  for (const pl of s.players) for (const e of pl.equipment) if (!e.destroyed && pl.turn.flags[`closeDestroy${e.inst.uid}`]) { e.destroyed = true; pl.turn.flags[`closeDestroy${e.inst.uid}`] = 0; log(s, pl.id, `${cardOf(e.inst).name} is destroyed as the combat chain closes.`); }
  if (s.chain.length) log(s, null, 'The combat chain closes.', RULES.chainClose);
  s.chain = [];
  s.chainOpen = false;
}

/** Heave N: at the end of your turn, pay N to put this from your hand face-up into your arsenal and create N Seismic Surge tokens. */
export function heaveOptions(s: GameState, pid: PlayerId): { uid: number; cost: number }[] {
  const p = s.players[pid];
  if (s.phase !== 'arsenal' || s.turnPlayer !== pid || p.arsenal.length) return [];
  return p.hand.filter((h) => { const n = getScript(cardOf(h)).heave; return !!n && availableResources(p, [h.uid]) >= n; }).map((h) => ({ uid: h.uid, cost: getScript(cardOf(h)).heave! }));
}
function doHeave(s: GameState, uid: number, pitch: number[]) {
  const opt = heaveOptions(s, s.turnPlayer).find((o) => o.uid === uid);
  if (!opt) throw new Error('You can’t heave that now.');
  const p = s.players[s.turnPlayer];
  const inst = removeFrom(p.hand, uid)!;
  pay(s, p, opt.cost, pitch.length ? pitch : autoPitch(p, opt.cost) ?? []);
  p.arsenal.push(inst);
  log(s, p.id, `${p.name} heaves ${cardOf(inst).name} into the arsenal.`, 'Heave N: at the beginning of your end phase, you may pay N to put this face-up into your arsenal. If you do, create N Seismic Surge tokens.');
  createToken(s, p, 'Seismic Surge', opt.cost);
  endTurn(s);
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
  // quelled equipment is destroyed at the beginning of the end phase; stolen cards go home
  { const tp = s.players[s.turnPlayer]; if (tp.turn.flags.ire && tp.turn.attackActionHits + tp.turn.weaponHits === 0) { tp.life -= 2; log(s, tp.id, `Ire of the Crowd: ${tp.name} didn't hit a hero this turn and loses 2 life (${tp.life}).`); checkWin(s); if (s.phase === 'gameOver') return; } }
  for (const w of s.players[s.turnPlayer].weapons) if (getScript(cardOf(w.inst)).secondHitCounter && w.counters && !s.players[s.turnPlayer].turn.flags[`hits${w.inst.uid}`]) { w.counters = 0; log(s, s.turnPlayer, `${cardOf(w.inst).name} didn't hit this turn: its +1{p} counters are removed.`); }
  fireTriggers(s, s.players[s.turnPlayer], 'endPhase');
  if ((s.phase as string) === 'gameOver') return;
  { const tp = s.players[s.turnPlayer]; for (const pm of [...tp.permanents]) if (getScript(cardOf(pm.inst)).destroyAtEnd) removePermanent(s, tp, pm.inst.uid); }
  for (const e of s.players[s.turnPlayer].equipment) if (!e.destroyed && getScript(cardOf(e.inst)).endPhaseWear) { e.defenseMod -= 1; log(s, s.turnPlayer, `${cardOf(e.inst).name} gets a -1{d} counter (${equipDefense(e)}).`); }
  for (const pl of s.players) for (const e of pl.equipment) if (e.quelled && !e.destroyed) { e.destroyed = true; e.quelled = false; log(s, pl.id, `${cardOf(e.inst).name} is destroyed (quell).`); }
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
  if (p.bonusIntellect) { p.intellect -= p.bonusIntellect; p.bonusIntellect = 0; }
  if (s.phase === 'gameOver') return;
  if (p.deck.length === 0 && p.hand.length === 0 && p.arsenal.length === 0) {
    log(s, p.id, `${p.name} has no cards left.`);
  }
  if (s.extraTurn === s.turnPlayer && !p.eliminated) { s.extraTurn = undefined; log(s, p.id, `${p.name} takes an extra turn (Code of Conduct).`); }
  else s.turnPlayer = nextAlive(s, s.turnPlayer);
  s.turn += 1;
  const outOfCards = (pl: PlayerState) => pl.deck.length + pl.hand.length + pl.arsenal.length === 0;
  if (s.turn > MAX_TURNS || alivePlayers(s).every(outOfCards)) {
    // simulator safeguard against stalled games: higher life total wins
    log(s, null, s.turn > MAX_TURNS ? `Turn limit reached.` : 'Every player is out of cards.');
    // the hero still standing with the most life wins (ties go to the earlier seat)
    const best = alivePlayers(s).reduce((x, y) => (y.life > x.life ? y : x));
    endGame(s, best.id);
    return;
  }
  startTurn(s);
}

// ---------------------------------------------------------------- effects

/** Deal damage to a hero, applying prevention. Returns damage actually dealt. */
export function dealDamage(s: GameState, target: PlayerId, amount: number, arcane: boolean, source: string, unpreventable = false): number {
  const p = s.players[target];
  if (p.eliminated) return 0;
  let dmg = amount;
  // Yoji: the next damage to the protected hero is dealt to Yoji instead, and 1 of it is prevented
  if (p.redirectTo !== undefined && p.redirectTo !== target && !s.players[p.redirectTo].eliminated && amount > 0) {
    const to = p.redirectTo;
    p.redirectTo = undefined;
    log(s, to, `${s.players[to].name} takes the damage for ${p.name}.`);
    dealDamage(s, to, Math.max(0, amount - 1), arcane, source, unpreventable);
    return 0;
  }
  if (unpreventable) {
    p.life -= dmg;
    log(s, target, `${source} deals ${dmg} damage to ${p.name} — it can't be prevented (${p.life} life).`);
    checkWin(s);
    return dmg;
  }
  if (arcane) {
    // spellvoid / arcane barrier (automatic)
    for (const e of p.equipment) {
      if (dmg <= 0 || e.destroyed || e.faceDown) continue;
      const sc = getScript(cardOf(e.inst));
      if (sc.spellvoid > 0) { dmg -= sc.spellvoid; e.destroyed = true; log(s, target, `${cardOf(e.inst).name} (spellvoid) prevents ${sc.spellvoid}.`); }
    }
    for (const pm of [...p.permanents]) {
      const sc = getScript(cardOf(pm.inst));
      if (dmg > 0 && sc.spellvoid > 0) { dmg -= sc.spellvoid; removePermanent(s, p, pm.inst.uid); }
    }
    const barrier = p.equipment.filter((e) => !e.destroyed && !e.faceDown).reduce((a, e) => a + getScript(cardOf(e.inst)).arcaneBarrier, 0);
    const pay = Math.min(barrier, dmg, p.resources);
    if (pay > 0) { p.resources -= pay; dmg -= pay; log(s, target, `${p.name} pays ${pay} for arcane barrier.`, RULES.arcaneBarrier); }
  }
  // "prevent the next N arcane damage"
  if (arcane) for (const e of p.effects) {
    if (dmg <= 0) break;
    if (e.kind === 'preventArcane' && e.amount > 0) { const pr = Math.min(e.amount, dmg); dmg -= pr; e.amount -= pr; log(s, target, `${pr} arcane damage prevented (${e.source}).`); }
  }
  p.effects = p.effects.filter((e) => !(e.kind === 'preventArcane' && e.amount <= 0));
  // prevention effects
  for (const e of p.effects) {
    if (dmg <= 0) break;
    if (e.kind === 'preventNext' && e.amount > 0) {
      const prevented = Math.min(e.amount, dmg);
      dmg -= prevented;
      e.amount = 0;
      log(s, target, `${prevented} damage prevented (${e.source}).`);
      if (prevented > 0 && e.thenToken) createToken(s, p, e.thenToken, 1);
    }
  }
  p.effects = p.effects.filter((e) => !(e.kind === 'preventNext' && e.amount <= 0));
  // Quell N: pay N floating resources to prevent N (the equipment is destroyed at the end phase)
  for (const e of p.equipment) {
    const q = getScript(cardOf(e.inst)).quell;
    if (!q || e.destroyed || dmg <= 0 || p.resources < q) continue;
    p.resources -= q;
    const prevented = Math.min(q, dmg);
    dmg -= prevented;
    e.quelled = true;
    log(s, target, `${p.name} pays ${q} for ${cardOf(e.inst).name} (quell): ${prevented} damage prevented.`, 'Quell N: if you would be dealt damage, you may pay N resources to prevent N of it. If you do, destroy this at the beginning of the end phase.');
  }
  // "If you would be dealt damage, you may banish this to prevent N of that damage" (always worth it)
  for (const e of [...p.equipment]) {
    const bp = getScript(cardOf(e.inst)).banishPrevent;
    if (!bp || e.destroyed || dmg <= 0) continue;
    p.equipment = p.equipment.filter((x) => x !== e);
    p.banished.push(e.inst);
    const prevented = Math.min(bp, dmg);
    dmg -= prevented;
    log(s, target, `${p.name} banishes ${cardOf(e.inst).name} to prevent ${prevented} damage.`);
  }
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
  const opp = s.players[oppOf(s, p.id)];
  const srcName = cardOf(src).name;
  const askedBefore = s.pendingChoices?.length ?? 0;
  for (let ei = 0; ei < effects.length; ei++) {
    const e = effects[ei];
    if (s.phase === 'gameOver') return;
    // an effect asked a player to choose: the rest of this effect waits for the answer
    if ((s.pendingChoices?.length ?? 0) > askedBefore) { deferFrom(s, p, src, effects.slice(ei)); return; }
    const l = currentLink(s);
    switch (e.kind) {
      case 'arcane': {
        const amp = p.effects.filter((x) => x.kind === 'ampArcane').reduce((a, x) => a + (x.kind === 'ampArcane' ? x.amount : 0), 0);
        if (amp) { p.effects = p.effects.filter((x) => x.kind !== 'ampArcane'); log(s, p.id, `Arcane damage amplified by ${amp}.`); }
        if (e.any && allies(opp).length && !p.isBot) {
          ask(s, { player: p.id, kind: 'target', prompt: `${srcName}: choose a target for ${e.amount + amp} arcane damage.`, options: [opp.hero, ...allies(opp).map((pm) => pm.inst)].map((i) => ({ uid: i.uid, cardId: i.cardId })), resume: { type: 'damageTarget', amount: e.amount + amp, arcane: true, source: srcName } });
          break;
        }
        if (e.all) {
          let total = 0;
          for (const t of s.players.filter((q) => q.id !== p.id && !q.eliminated)) total += dealDamage(s, t.id, e.amount + amp, true, srcName);
          p.turn.flags.lastArcane = total; if (total > 0) p.turn.arcaneDealt = true;
          break;
        }
        { const dealt = dealDamage(s, opp.id, e.amount + amp, true, srcName); p.turn.flags.lastArcane = dealt; if (dealt > 0) p.turn.arcaneDealt = true; }
        break;
      }
      case 'ampArcane': p.effects.push({ kind: 'ampArcane', amount: e.amount, source: srcName }); log(s, p.id, `Next arcane damage effect deals +${e.amount}.`); break;
      case 'weakenAttack': if (l) { l.powerMod -= e.amount; log(s, p.id, `${cardOf(l.inst).name} gets -${e.amount} power (${linkPower(l)}).`); } break;
      case 'damage':
        if (e.any && allies(opp).length && !p.isBot) {
          ask(s, { player: p.id, kind: 'target', prompt: `${srcName}: choose a target for ${e.amount} damage.`, options: [opp.hero, ...allies(opp).map((pm) => pm.inst)].map((i) => ({ uid: i.uid, cardId: i.cardId })), resume: { type: 'damageTarget', amount: e.amount, arcane: false, source: srcName } });
          break;
        }
        for (const t of e.all ? s.players.filter((q) => q.id !== p.id && !q.eliminated) : [opp]) dealDamage(s, t.id, e.amount, false, srcName);
        break;
      case 'gainLife': p.life += e.amount; log(s, p.id, `${p.name} gains ${e.amount} life (${p.life}).`); ability(p)?.onGainLife?.(heroCtx(s, p), e.amount); break;
      case 'loseLifeOpp':
        for (const t of e.all ? s.players.filter((q) => q.id !== p.id && !q.eliminated) : [opp]) { t.life -= e.amount; log(s, t.id, `${t.name} loses ${e.amount} life (${t.life}).`); }
        checkWin(s);
        break;
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
      case 'thisGrantOnHit': if (l && l.inst.uid === src.uid) l.extraOnHit = [...l.extraOnHit, ...e.effects]; break;
      case 'setDestination': if (l && l.inst.uid === src.uid && !l.fromWeapon) l.destination = e.dest; break;
      case 'oppNextTurn': {
        const t = l ? s.players[defenderOf(l)] : opp;
        const n = (t.nextTurn ??= {});
        if (e.mod === 'attackPower') n.attackPower = (n.attackPower ?? 0) + (e.amount ?? 0);
        else if (e.mod === 'costMore') n.costMore = (n.costMore ?? 0) + (e.amount ?? 1);
        else n[e.mod] = true;
        const text = { attackPower: `their first attack next turn gets -${e.amount}{p}`, costMore: 'their first action next turn costs {r} more', noDraw: "they can't draw cards during their next action phase", noGoAgain: 'their cards lose go again next action phase', noSmallAttacks: "they can't play attack action cards with 3 or less {p} next action phase" }[e.mod];
        log(s, p.id, `${srcName}: ${t.name} — ${text}.`);
        break;
      }
      case 'oppArsenalBottom': case 'oppArsenalDestroy': {
        const t = l ? s.players[defenderOf(l)] : opp;
        const cards = e.kind === 'oppArsenalBottom' ? t.arsenal.splice(0, 1) : t.arsenal.splice(0);
        for (const x of cards) { if (e.kind === 'oppArsenalBottom') t.deck.push(x); else toGraveyard(t, x); }
        if (cards.length) log(s, p.id, `${srcName}: ${cards.length === 1 ? 'the card' : `${cards.length} cards`} in ${t.name}'s arsenal ${e.kind === 'oppArsenalBottom' ? 'goes to the bottom of their deck' : 'are destroyed'}.`);
        if (e.kind === 'oppArsenalDestroy' && e.goldEach && cards.length) createToken(s, p, 'Gold', cards.length);
        if (e.kind === 'oppArsenalDestroy' && cards.length) destroyedBy(s, p.id, t.id);
        break;
      }
      case 'oppEquipCounter': {
        const t = l ? s.players[defenderOf(l)] : opp;
        const eq = t.equipment.filter((x) => !x.destroyed && (defenseOf(cardOf(x.inst)) ?? 0) > 0).sort((a, b) => equipDefense(b) - equipDefense(a))[0];
        if (eq) { eq.defenseMod -= 1; log(s, p.id, `${srcName}: ${cardOf(eq.inst).name} gets a -1{d} counter (${equipDefense(eq)}).`); }
        break;
      }
      case 'cleanseTop': {
        // look at their top cards and banish the name they have most copies of (ties: the stronger card)
        const t = l ? s.players[defenderOf(l)] : opp;
        const top = t.deck.slice(0, e.n);
        const groups = new Map<string, CardInst[]>();
        for (const x of top) { const k = cardOf(x).name; groups.set(k, [...(groups.get(k) ?? []), x]); }
        const best = [...groups.values()].sort((a, b) => b.length - a.length || powerOf(cardOf(b[0])) - powerOf(cardOf(a[0])))[0];
        if (!best) break;
        if (!p.isBot) {
          ask(s, { player: p.id, kind: 'pick', prompt: `${srcName}: the top ${top.length} cards of ${t.name}'s deck. Pick a card: every card with its name is banished, the rest stay on top.`, confirm: 'Banish these', options: top.map((x) => ({ uid: x.uid, cardId: x.cardId })), resume: { type: 'cleanse', target: t.id, n: e.n } });
          break;
        }
        cleanseName(s, p, t, e.n, cardOf(best[0]).name, srcName);
        break;
      }
      case 'oppDraw': {
        const ts = e.all ? s.players.filter((q) => q.id !== p.id && !q.eliminated) : [l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp];
        for (const t of ts) { draw(s, t, e.amount); log(s, t.id, `${t.name} draws ${e.amount === 1 ? 'a card' : `${e.amount} cards`} (${srcName}).`); }
        break;
      }
      case 'oppCreateToken': {
        const ts = e.all ? s.players.filter((q) => q.id !== p.id && !q.eliminated) : [l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp];
        for (const t of ts) createToken(s, t, e.name, 1);
        break;
      }
      case 'weaponsPowerTurn': {
        p.turn.flags.weaponBonus = (p.turn.flags.weaponBonus ?? 0) + e.amount;
        if (l && l.fromWeapon && !l.ally && l.attacker === p.id) l.powerMod += e.amount;
        log(s, p.id, `${p.name}'s weapons get +${e.amount}{p} until end of turn.`);
        break;
      }
      case 'optDealt': if (p.turn.flags.lastArcane) resolveEffects(s, p, [{ kind: 'opt', amount: p.turn.flags.lastArcane }], src); break;
      case 'banishDefender': {
        if (!l) break;
        const t = s.players[defenderOf(l)];
        const x = [...l.defenders].filter((d) => d.kind !== 'equipment').sort((a, b) => b.defense - a.defense)[0];
        if (!x) break;
        l.defenders = l.defenders.filter((d) => d !== x);
        (s.players[x.inst.owner] ?? t).banished.push(x.inst);
        log(s, p.id, `${srcName}: ${cardOf(x.inst).name} is banished.`);
        banishedFromOpp(s, p, x.inst);
        break;
      }
      case 'destroyIntimidated': {
        const t = l ? s.players[defenderOf(l)] : opp;
        const x = t.intimidated.shift();
        if (x) { toGraveyard(t, x); log(s, p.id, `${srcName}: ${cardOf(x).name} (intimidated) is destroyed.`); }
        break;
      }
      case 'createInBanished': {
        const t = findCard(e.name);
        if (t) { const inst = mk(s, t.id, p.id); p.banished.push(inst); p.turn.flags.lastBanished = inst.uid; log(s, p.id, `${p.name} creates ${t.name} in their banished zone.`); }
        break;
      }
      case 'playLastBanished': {
        const uid = p.turn.flags.lastBanished;
        if (uid && p.banished.some((b) => b.uid === uid)) { p.turn.flags[`playBanished${uid}`] = 1; log(s, p.id, `${p.name} may play ${cardOf(p.banished.find((b) => b.uid === uid)!).name} this turn.`); }
        break;
      }
      case 'banishFromGrave': {
        const g = [...p.graveyard].filter((x) => { const c2 = cardOf(x); return has(c2, e.type) && (e.type !== 'Action' || !has(c2, 'Attack')) && (!e.cls || c2.types.includes(e.cls)); }).sort((a, b) => powerOf(cardOf(b)) - powerOf(cardOf(a)))[0];
        if (!g) break;
        removeFrom(p.graveyard, g.uid); p.banished.push(g); p.turn.flags.lastBanished = g.uid;
        log(s, p.id, `${p.name} banishes ${cardOf(g).name} from their graveyard.`);
        break;
      }
      case 'daggerStrike': {
        const w = p.weapons.find((x) => cardOf(x.inst).types.includes('Dagger'));
        const t = l ? s.players[defenderOf(l)] : opp;
        if (!w) break;
        if (dealDamage(s, t.id, 1, false, cardOf(w.inst).name) > 0) { p.turn.flags.daggerHit = 1; p.turn.weaponHits += 1; }
        p.weapons = p.weapons.filter((x) => x !== w);
        toGraveyard(p, w.inst);
        log(s, p.id, `${cardOf(w.inst).name} deals 1 damage and is destroyed.`);
        break;
      }
      case 'gainAP': p.actionPoints += e.amount; log(s, p.id, `${p.name} gains ${e.amount} action point${e.amount > 1 ? 's' : ''}.`); break;
      case 'arsenalCycle': {
        const a0 = p.arsenal.shift();
        if (!a0) break;
        p.deck.push(a0);
        log(s, p.id, `${p.name} puts their arsenal card on the bottom of their deck and draws a card.`);
        draw(s, p, 1);
        break;
      }
      case 'destroyAtChainClose': { const eq = p.equipment.find((x) => x.inst.uid === src.uid); if (eq) { p.turn.flags[`closeDestroy${src.uid}`] = 1; log(s, p.id, `${srcName} will be destroyed when the combat chain closes.`); } break; }
      case 'payOrWeaken': {
        if (!l || l.inst.uid !== src.uid) break;
        if (!p.isBot) { ask(s, { player: p.id, kind: 'yesno', prompt: `${srcName}: pay ${e.cost} or it gets -${e.amount}{p}?`, options: [], resume: { type: 'event', key: 'payOrWeaken', data: [s.chain.indexOf(l), e.amount, e.cost] } }); break; }
        if (availableResources(p) >= e.cost && (p.resources >= e.cost || e.amount >= 2)) { pay(s, p, e.cost, autoPitch(p, e.cost) ?? []); log(s, p.id, `${p.name} pays ${e.cost} for ${srcName}.`); }
        else { l.powerMod -= e.amount; log(s, p.id, `${srcName} gets -${e.amount}{p} (${linkPower(l)}).`); }
        break;
      }
      case 'runechantsPerNonAttack': {
        const n = p.turn.played.filter((id) => { const c = card(id); return has(c, 'Action') && !has(c, 'Attack'); }).length;
        if (n) createToken(s, p, 'Runechant', n);
        if (e.goAgainAt && n >= e.goAgainAt && l && l.inst.uid === src.uid) { l.goAgain = true; log(s, p.id, `${srcName} gets go again.`); }
        break;
      }
      case 'revealTop': {
        const top = p.deck[0];
        if (!top) break;
        log(s, p.id, `${srcName}: ${p.name} reveals ${cardOf(top).name}.`);
        if (e.minusPitch && l && l.inst.uid === src.uid && pitchOf(cardOf(top))) { l.powerMod -= pitchOf(cardOf(top)); log(s, p.id, `${srcName} gets -${pitchOf(cardOf(top))}{p} (${linkPower(l)}).`); }
        break;
      }
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
      case 'preventNext': p.effects.push({ kind: 'preventNext', amount: e.amount, source: srcName, thenToken: e.thenToken }); break;
      case 'createToken': createToken(s, p, e.name, e.amount); break;
      case 'oppMill': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        for (let i = 0; i < e.amount; i++) { const x = t.deck.shift(); if (x) { t.graveyard.push(x); log(s, t.id, `${cardOf(x).name} is destroyed from the top of ${t.name}'s deck.`); } }
        break;
      }
      case 'ifOppClass': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        if (cardOf(t.hero).types.includes(e.cls)) resolveEffects(s, p, e.then, src);
        break;
      }
      case 'banishOppSoul': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        const x = (t.soul ?? []).shift();
        if (x) { t.banished.push(x); log(s, t.id, `${cardOf(x).name} is banished from ${t.name}'s soul.`); banishedFromOpp(s, p, x); }
        break;
      }
      case 'oppDestroyPerm': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        const pm = [...t.permanents].filter((x) => has(cardOf(x.inst), e.type) && (!e.name || cardOf(x.inst).name.toLowerCase() === e.name.toLowerCase())).sort((a, b) => Number(cardOf(b.inst).cost ?? 0) - Number(cardOf(a.inst).cost ?? 0))[0];
        if (pm) { log(s, p.id, `${srcName} destroys ${t.name}'s ${cardOf(pm.inst).name}.`); removePermanent(s, t, pm.inst.uid); }
        break;
      }
      case 'banishOppGrave': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        const g = t.graveyard.pop();
        if (g) { t.banished.push(g); log(s, t.id, `${cardOf(g).name} is banished from ${t.name}'s graveyard.`); banishedFromOpp(s, p, g); }
        break;
      }
      case 'banishTopOpp':
        for (let i = 0; i < e.amount; i++) { const t = opp.deck.shift(); if (t) { opp.banished.push(t); log(s, opp.id, `${cardOf(t).name} is banished from the top of ${opp.name}'s deck.`); banishedFromOpp(s, p, t); } }
        break;
      case 'oppBanishHand': case 'oppBanishArsenal': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        const zone = e.kind === 'oppBanishHand' ? t.hand : t.arsenal;
        // they choose: the card they'd miss least
        const x = [...zone].sort((a, b) => cardPlayValue(cardOf(a)) - cardPlayValue(cardOf(b)))[0];
        if (x) { removeFrom(zone, x.uid); t.banished.push(x); log(s, t.id, `${t.name} banishes ${cardOf(x).name} from their ${e.kind === 'oppBanishHand' ? 'hand' : 'arsenal'}.`); banishedFromOpp(s, p, x); }
        break;
      }
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
          banishedFromOpp(s, p, d);
        }
        break;
      case 'opt': {
        if (!p.isBot && p.deck.length) {
          const top = p.deck.slice(0, e.amount);
          ask(s, { player: p.id, kind: 'opt', prompt: `Opt ${e.amount}: tap the cards to keep on top, in the order you want to draw them. The rest go to the bottom of your deck.`, options: top.map((t) => ({ uid: t.uid, cardId: t.cardId })), resume: { type: 'opt' } });
          break;
        }
        // bots: blue cards (and defense reactions) stay on top, the rest go to the bottom
        const top = p.deck.splice(0, e.amount);
        const keep = top.filter((t) => pitchOf(cardOf(t)) !== 3 || has(cardOf(t), 'Defense Reaction'));
        const bottom = top.filter((t) => !keep.includes(t));
        p.deck.unshift(...keep);
        p.deck.push(...bottom);
        log(s, p.id, `${p.name} opts ${e.amount}.`);
        ability(p)?.onOpt?.(heroCtx(s, p), top.length);
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
      case 'turnAttackPower':
        p.effects.push({ kind: 'turnAttackPower', amount: e.amount, filter: e.filter, source: srcName });
        if (l && l.attacker === p.id && matchesFilter(e.filter, l)) l.powerMod += e.amount;
        log(s, p.id, `${describeFilter(e.filter)} get +${e.amount}{p} this turn.`);
        break;
      case 'turnAttackDominate': p.effects.push({ kind: 'turnAttackDominate', source: srcName }); if (l && l.attacker === p.id) l.dominate = true; break;
      case 'preventArcane': p.effects.push({ kind: 'preventArcane', amount: e.amount, source: srcName }); log(s, p.id, `The next ${e.amount} arcane damage to ${p.name} this turn will be prevented.`); break;
      case 'lookTop': {
        const t = e.theirs ? (l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp) : p;
        const top = t.deck.slice(0, e.n);
        log(s, p.id, `${p.name} looks at the top ${e.n === 1 ? 'card' : `${e.n} cards`} of ${t.id === p.id ? 'their' : `${t.name}'s`} deck.`);
        if (!p.isBot && top.length) ask(s, { player: p.id, kind: 'pick', prompt: `${srcName}: the top ${top.length === 1 ? 'card' : `${top.length} cards`} of ${t.id === p.id ? 'your' : `${t.name}'s`} deck (look only).`, confirm: 'OK', skippable: true, botPick: null, options: top.map((x) => ({ uid: x.uid, cardId: x.cardId })), resume: { type: 'event', key: 'look' } });
        break;
      }
      case 'rollDie': {
        const n = 1 + Math.floor(rand(s) * 6);
        if (n === 6) p.turn.flags.rolledSix = 1;
        log(s, p.id, `${srcName}: ${p.name} rolls a ${n}.`);
        for (const r of e.then) {
          const half = Math.floor(n / 2);
          if (r.kind === 'resources') { p.resources += r.half ? half : n; log(s, p.id, `${p.name} gains ${r.half ? half : n} resource${(r.half ? half : n) === 1 ? '' : 's'}.`); }
          else if (r.kind === 'actionPoints') { p.actionPoints += r.half ? half : n; log(s, p.id, `${p.name} gains ${r.half ? half : n} action point${(r.half ? half : n) === 1 ? '' : 's'}.`); }
          else if (r.kind === 'prevent') p.effects.push({ kind: 'preventNext', amount: n, source: srcName });
          else if (r.kind === 'thisPower') { const link = s.chain.find((x) => x.inst.uid === src.uid); if (link) { link.powerMod += n; log(s, p.id, `${srcName} gets +${n}{p} (${linkPower(link)}).`); } }
          else if (r.kind === 'nextAttackPower') p.effects.push({ kind: 'nextAttackPower', amount: n, filter: r.filter, source: srcName });
          else if (r.kind === 'ifAtLeast' && n >= r.min) resolveEffects(s, p, r.effects, src);
        }
        break;
      }
      case 'transcend':
        p.turn.flags.transcended = 1;
        log(s, p.id, `${srcName} transcends.`, 'Transcend: the card turns over. "If you\u2019ve transcended this turn" effects now apply.');
        fireTriggers(s, p, 'transcend');
        break;
      case 'powerOrGoAgain': {
        const link = s.chain.find((x) => x.inst.uid === src.uid);
        if (!link) break;
        if (link.goAgain) { link.powerMod += e.amount; log(s, p.id, `${srcName} gets +${e.amount}{p} (${linkPower(link)}).`); break; }
        if (p.isBot) { link.goAgain = true; log(s, p.id, `${srcName} gets go again.`); break; }
        ask(s, { player: p.id, kind: 'yesno', prompt: `${srcName}: go again? (No: +${e.amount}{p} instead)`, options: [{ uid: src.uid, cardId: src.cardId }], resume: { type: 'event', key: 'powerOrGoAgain', data: [s.chain.indexOf(link), e.amount] } });
        break;
      }
      case 'counterUpkeep': case 'removeCounter': {
        const pm = p.permanents.find((x) => x.inst.uid === src.uid);
        if (!pm) break;
        const steam = e.counter === 'steam';
        const have = (steam ? pm.steam : pm.counters) ?? 0;
        if (have > 0) {
          if (steam) pm.steam = have - 1; else pm.counters = have - 1;
          log(s, p.id, `${srcName}: a ${e.counter} counter is removed (${have - 1} left).`);
          if (e.kind === 'removeCounter' && e.then) resolveEffects(s, p, e.then, src);
          if (have - 1 === 0 && getScript(cardOf(pm.inst)).destroyAtZero && p.permanents.includes(pm)) removePermanent(s, p, pm.inst.uid);
        } else if (e.kind === 'counterUpkeep') removePermanent(s, p, pm.inst.uid);
        break;
      }
      case 'selfToSoul': {
        const i = p.permanents.findIndex((x) => x.inst.uid === src.uid);
        if (i < 0) break;
        const [pm] = p.permanents.splice(i, 1);
        (p.soul ??= []).push(pm.inst);
        p.turn.charged = true;
        log(s, p.id, `${srcName} is put into ${p.name}'s soul.`);
        break;
      }
      case 'nextAttackDominate': p.effects.push({ kind: 'nextAttackDominate', source: srcName }); log(s, p.id, `${p.name}'s next attack this turn gets dominate.`); break;
      case 'turnAttackGoAgain':
        p.effects.push({ kind: 'turnAttackGoAgain', filter: e.filter, source: srcName });
        if (l && l.attacker === p.id && matchesFilter(e.filter, l)) l.goAgain = true;
        log(s, p.id, `${describeFilter(e.filter)}s get go again this turn.`);
        break;
      case 'clearWeaponCounters':
        for (const w of p.weapons) if (!e.sub || cardOf(w.inst).types.includes(e.sub)) w.counters = 0;
        log(s, p.id, `${p.name}'s ${e.sub ? 'swords lose' : 'weapons lose'} their +1{p} counters.`);
        break;
      case 'destroyAllOwn':
        for (const pm of [...p.permanents]) if (cardOf(pm.inst).name.toLowerCase() === e.name.toLowerCase()) removePermanent(s, p, pm.inst.uid);
        break;
      case 'tapOpp': {
        const t = l ? s.players[l.attacker === p.id ? defenderOf(l) : l.attacker] : opp;
        t.heroTapped = true;
        log(s, t.id, `${t.name}'s hero is tapped.`, RULES.tap);
        break;
      }
      case 'untap':
        if (e.what === 'hero') { p.heroTapped = false; log(s, p.id, `${p.name}'s hero untaps.`); }
        else if (e.what === 'weapon') { const w = p.weapons.find((x) => x.usedThisTurn); if (w) { w.usedThisTurn = false; log(s, p.id, `${cardOf(w.inst).name} untaps: it can attack again.`); } }
        else {
          const type = e.what === 'ally' ? 'Ally' : 'Cog';
          const tapped = p.permanents.filter((pm) => pm.tapped && cardOf(pm.inst).types.includes(type));
          for (const pm of e.what === 'allCogs' ? tapped : tapped.slice(0, 1)) { pm.tapped = false; log(s, p.id, `${cardOf(pm.inst).name} untaps.`); }
        }
        break;
      case 'destroySelf': {
        if (p.permanents.some((pm) => pm.inst.uid === src.uid)) removePermanent(s, p, src.uid);
        else {
          const eq = p.equipment.find((x) => x.inst.uid === src.uid && !x.destroyed);
          if (eq) { eq.destroyed = true; log(s, p.id, `${srcName} is destroyed.`); }
        }
        break;
      }
      case 'mayThen': {
        if (!mayPayable(p, e.cost, src)) { log(s, p.id, `${srcName}: can't ${e.text.split(' to ')[0]}, so nothing happens.`); break; }
        if (p.isBot) {
          // a sturdy piece of equipment is worth more as a blocker than most of these payoffs
          const eq = e.cost.kind === 'destroySelf' ? p.equipment.find((x) => x.inst.uid === src.uid) : undefined;
          if (botMayJudge ? !botMayJudge(s, p, e, src) : eq && equipDefense(eq) >= 2) { log(s, p.id, `${srcName}: ${p.name} doesn't ${e.text.split(' to ')[0]}.`); break; }
          payMay(s, p, e.cost, src); log(s, p.id, `${srcName}: ${p.name} chooses to ${e.text}.`); resolveEffects(s, p, e.then, src); break;
        }
        ask(s, { player: p.id, kind: 'yesno', prompt: `${srcName}: ${e.text}?`, options: [{ uid: src.uid, cardId: src.cardId }], resume: { type: 'mayThen', cost: e.cost, then: e.then, src, text: e.text } });
        break;
      }
      case 'destroyOwnThen': {
        const pm = p.permanents.find((x) => { const c = cardOf(x.inst); return e.name ? c.name.toLowerCase() === e.name.toLowerCase() : !!e.type && c.types.includes(e.type); });
        if (!pm) { log(s, p.id, `${p.name} has nothing to destroy, so nothing else happens.`); break; }
        removePermanent(s, p, pm.inst.uid);
        resolveEffects(s, p, e.then, src);
        break;
      }
      case 'wager': {
        const li = e.target ? s.chain.length - 1 : s.chain.findIndex((x) => x.inst.uid === src.uid);
        const link = s.chain[li];
        if (!link || link.attacker !== p.id) break;
        if (e.optional && !p.isBot) {
          ask(s, { player: p.id, kind: 'yesno', prompt: `Wager ${e.tokens.length ? e.tokens.map((t) => `a ${t} token`).join(', ') : ''} with ${opp.name}? If ${cardOf(link.inst).name} hits, you create ${e.tokens.length > 1 ? 'them' : 'it'}; otherwise ${opp.name} does.`, options: [], resume: { type: 'wager', tokens: e.tokens, winnerDraw: e.winnerDraw, link: li } });
          break;
        }
        addWager(s, p, li, e.tokens, e.winnerDraw);
        break;
      }
      case 'crowd': {
        const targets = e.who === 'self' ? [p] : e.who === 'opp' ? [opp]
          : s.players.filter((pl) => cardOf(pl.hero).types.includes(e.who === 'revered' ? 'Revered' : 'Reviled'));
        for (const t of targets) crowd(s, t, e.cheer);
        break;
      }
      case 'ifCond': if (evalCondition(s, p, e.cond)) resolveEffects(s, p, e.effects, src); break;
      case 'costLess': p.effects.push({ kind: 'costLess', amount: e.amount, filter: e.filter, source: srcName }); log(s, p.id, `Next ${describeFilter(e.filter)} costs ${e.amount} less.`); break;
      case 'perEvoPower': {
        const n = evoCount(p);
        if (l && l.inst.uid === src.uid && n) { l.powerMod += e.amount * n; log(s, p.id, `${srcName} gets +${e.amount * n} power (${n} Evo${n > 1 ? 's' : ''} equipped).`); }
        break;
      }
      case 'stealGold': {
        const gold = (pl: PlayerState) => pl.permanents.filter((pm) => isA(pm.inst, 'Gold'));
        if (gold(opp).length > gold(p).length) {
          const g = gold(opp)[0];
          opp.permanents = opp.permanents.filter((pm) => pm !== g);
          p.permanents.push(g);
          log(s, p.id, `${p.name} steals a Gold token from ${opp.name}.`, 'To steal a card is to gain control of it.');
          ability(p)?.onSteal?.(heroCtx(s, p), cardOf(g.inst));
        }
        break;
      }
      case 'noDefenseReactions':
        if (l) { l.noDefenseReactions = true; log(s, p.id, `Defense reactions can't be played this chain link.`); }
        break;
      case 'buffDefender': {
        const d = l?.defenders.find((x) => {
          if (x.inst.owner !== p.id || x.kind === 'equipment') return false;
          const c = cardOf(x.inst);
          return e.cards === 'any' || (has(c, 'Action') && (e.cards === 'action' || has(c, 'Attack')));
        });
        if (d) { d.defense += e.amount; log(s, p.id, `${cardOf(d.inst).name} gets +${e.amount} defense.`); }
        break;
      }
      case 'nextWagerPower': p.effects.push({ kind: 'nextWagerPower', amount: e.amount, overpower: e.overpower, source: srcName }); break;
      case 'nextAttackOnAttack': p.effects.push({ kind: 'nextAttackOnAttack', filter: e.filter, effects: e.effects, source: srcName }); break;
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
        if (!p.isBot) {
          ask(s, { player: p.id, kind: 'reload', prompt: 'Reload: choose a card from your hand to put face down into your arsenal, or skip.', options: p.hand.map((h) => ({ uid: h.uid, cardId: h.cardId })), resume: { type: 'reload' } });
          break;
        }
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
    case 'shuffle': { const p = s.players[a.player]; p.deck.splice(0, p.deck.length, ...shuffle(s, p.deck)); log(s, a.player, `[manual] ${pname(s, a.player)} shuffles their deck.`); break; }
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
    if (p.life <= 0 && !p.eliminated) {
      eliminate(s, p);
      if ((s.phase as string) === 'gameOver') return;
    }
  }
}

/** A hero at 0 life (or who concedes) is out; with one hero left, they win. */
function eliminate(s: GameState, p: PlayerState) {
  if (s.players.length === 2) { endGame(s, other(p.id)); return; }
  p.eliminated = true;
  (s.knockedOut ??= []).push(p.id);
  if (s.players[s.turnPlayer].turn.flags.killOrBeKilled && s.turnPlayer !== p.id) s.extraTurn = s.turnPlayer;
  log(s, p.id, `${p.name} is knocked out!`);
  if (s.pendingChoices) { s.pendingChoices = s.pendingChoices.filter((c) => c.player !== p.id); if (!s.pendingChoices.length) s.pendingChoices = undefined; }
  const left = alivePlayers(s);
  if (left.length === 1) { endGame(s, left[0].id); return; }
  // an attack involving them ends; if it was their turn, play moves on
  if (s.chain.some((l) => l.attacker === p.id || defenderOf(l) === p.id)) { closeChain(s); s.phase = 'action'; s.priority = s.turnPlayer; }
  if (s.turnPlayer === p.id) { s.chain = []; s.chainOpen = false; delete s.stack; s.pendingChoices = undefined; s.turnPlayer = nextAlive(s, p.id); startTurn(s); }
  else if (s.players[s.priority].eliminated) s.priority = s.turnPlayer;
}

/** Player `i` concedes, whoever has priority (a player leaving an online game). In a Pit Fight
 * game that goes on, priority and decisions that weren't theirs stay where they were. */
export function concedeSeat(before: GameState, i: PlayerId): GameState {
  const s = applyAction({ ...before, priority: i, pendingChoices: undefined, pendingTriggers: undefined }, { type: 'concede' });
  if (s.phase !== 'gameOver' && s.turnPlayer === before.turnPlayer && s.phase === before.phase && s.chain.length === before.chain.length) {
    if (before.priority !== i && !s.players[before.priority].eliminated) s.priority = before.priority;
    const left = before.pendingChoices?.filter((c) => c.player !== i);
    s.pendingChoices = left?.length ? left : undefined;
    if (before.pendingTriggers && before.pendingTriggers.player !== i) s.pendingTriggers = before.pendingTriggers;
  }
  return s;
}

/** Pit Fight finishing order, best first: the winner, then heroes still standing (most life first), then the knocked out (last out first). */
export function placements(s: GameState): PlayerId[] {
  const out = [...(s.knockedOut ?? [])].reverse();
  const standing = s.players.filter((p) => !p.eliminated && p.id !== s.winner).sort((a, b) => b.life - a.life).map((p) => p.id);
  return [...(s.winner !== null ? [s.winner] : []), ...standing, ...out.filter((id) => id !== s.winner)];
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
    if (e.kind === 'nextAttackOnAttack') return `Next ${describeFilter(e.filter)} gets an on-attack effect (${e.source})`;
    if (e.kind === 'nextWagerPower') return `Next attack that wagers +${e.amount} power (${e.source})`;
    if (e.kind === 'nextAttackOnHit') return `Next ${describeFilter(e.filter)} gets an on-hit effect (${e.source})`;
    if (e.kind === 'nextAttackDominate') return `Next attack gets dominate (${e.source})`;
    if (e.kind === 'turnAttackPower') return `${describeFilter(e.filter)} +${e.amount} power this turn (${e.source})`;
    if (e.kind === 'turnAttackDominate') return `Attacks get dominate this turn (${e.source})`;
    if (e.kind === 'turnAttackGoAgain') return `${describeFilter(e.filter)}s get go again this turn (${e.source})`;
    if (e.kind === 'nextAttackGoldPower') return `Next attack +1 power for each Gold you control (${e.source})`;
    if (e.kind === 'costLess') return `Next ${describeFilter(e.filter)} costs ${e.amount} less (${e.source})`;
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
