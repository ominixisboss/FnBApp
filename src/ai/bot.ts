// Heuristic AI for Flesh and Blood. The same evaluator powers the bots and the
// "hint" button in practice games.
import type { Card } from '../data/types';
import { has } from '../data/cardDb';
import { getScript } from '../engine/cardScript';
import type { Effect } from '../engine/cardScript';
import {
  availableResources, cardOf, cardPlayValue, checkDefense, costOf, currentLink, defendOptions,
  defenseOf, effectiveCost, evalCondition, HAND_INDEX, heroCtx, HERO_INDEX, linkDefense, linkPower, optionalPayable, other, pitchOf,
  playOptions, powerOf,
} from '../engine/game';
import { getHeroAbility } from '../engine/heroes';
import type { PlayOption } from '../engine/game';
import type { Action, Difficulty, GameState, OptionalChoice, PlayerId, PlayerState } from '../engine/types';

export interface BotDecision {
  action: Action;
  reason: string;
  /** action phase: the cards/sources the plan uses this turn, in the order to play them (for hint highlights) */
  plan?: number[];
  /** action phase: hand cards the plan pitches to pay for it */
  planPitch?: number[];
}

function effectValue(effects: Effect[]): number {
  let v = 0;
  for (const e of effects) {
    switch (e.kind) {
      case 'arcane': case 'damage': case 'loseLifeOpp': v += e.amount; break;
      case 'draw': v += 2.5 * e.amount; break;
      case 'gainLife': v += 0.8 * e.amount; break;
      case 'gainResource': v += e.amount; break;
      case 'nextAttackPower': case 'targetAttackPower': case 'thisPower': v += e.amount * 0.9; break;
      case 'nextAttackGoAgain': case 'targetAttackGoAgain': case 'thisGoAgain': v += 1.5; break;
      case 'createToken': v += 1 * e.amount; break;
      case 'preventNext': v += 0.6 * e.amount; break;
      case 'ampArcane': v += e.amount * 0.8; break;
      case 'weakenAttack': v += e.amount; break;
      case 'banishTopOpp': v += 0.3; break;
      case 'oppDiscardRandom': case 'intimidate': v += 1.5; break;
      default: v += 0.3;
    }
  }
  return v;
}

/** Value of playing card c now (expected damage / advantage). */
/** Best "Choose 1" mode for a card, by heuristic value. */
export function bestMode(c: Card): number {
  const sc = getScript(c);
  let best = 0;
  let bv = -Infinity;
  sc.modes.forEach((m, i) => {
    const v = effectValue([...m.onPlay, ...m.onAttack]) + effectValue(m.onHit) * 0.6 + (m.parsed ? 0 : -5);
    if (v > bv) { bv = v; best = i; }
  });
  return best;
}

function modeValue(c: Card): number {
  const sc = getScript(c);
  if (!sc.modes.length) return 0;
  const m = sc.modes[bestMode(c)];
  return effectValue([...m.onPlay, ...m.onAttack]) + effectValue(m.onHit) * 0.6;
}

function playValue(c: Card, fromArsenal: boolean): number {
  const sc = getScript(c);
  let v = modeValue(c);
  if (has(c, 'Attack') && has(c, 'Action')) {
    v += powerOf(c) + effectValue(sc.onAttack) + effectValue(sc.onHit) * 0.6 + effectValue(sc.onPlay);
    if (sc.dominate || sc.overpower) v += 0.7;
    if (sc.intimidateOnAttack) v += 1;
    if (fromArsenal) v += sc.conditional.filter((cn) => cn.when === 'fromArsenal').reduce((a, cn) => a + effectValue(cn.effects), 0);
  } else {
    v += effectValue(sc.onPlay) + (sc.ward ? sc.ward * 0.6 : 0);
    if (fromArsenal) v += sc.conditional.filter((cn) => cn.when === 'fromArsenal').reduce((a, cn) => a + effectValue(cn.effects), 0);
    if (v === 0) v = sc.coverage === 'full' ? 0.3 : 0.8; // unscripted effect — some value
  }
  return v;
}

interface Item {
  opt: PlayOption;
  value: number;
  goAgain: boolean;
  usesAP: boolean;
  isAttack: boolean;
  cost: number;
  uidInHand: number | null; // card uid if it's a hand card (so it can't be pitched)
}

function itemsFor(s: GameState, p: PlayerState): Item[] {
  return playOptions(s, p.id).map((opt) => {
    if (opt.kind === 'card') {
      const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === opt.uid)!;
      const c = cardOf(inst);
      const sc = getScript(c);
      const fromArsenal = p.arsenal.some((a) => a.uid === opt.uid);
      const isAttack = has(c, 'Attack') && has(c, 'Action');
      const goAgain = sc.goAgain || (fromArsenal && sc.conditional.some((cn) => cn.when === 'fromArsenal' && cn.effects.some((e) => e.kind === 'thisGoAgain')));
      // conditions that are already true add their payoff ("If you've drawn a card this turn, +1{p}")
      const condValue = sc.conditional.filter((cn) => cn.when === 'if' && cn.cond && evalCondition(s, p, cn.cond)).reduce((a, cn) => a + effectValue(cn.effects), 0);
      const condGoAgain = sc.conditional.some((cn) => cn.when === 'if' && cn.cond && evalCondition(s, p, cn.cond) && cn.effects.some((e) => e.kind === 'thisGoAgain'));
      const opt0 = decideOptional(s, p, opt.uid, []);
      const optValue = opt0?.accept ? effectValue(sc.optional!.effects) * 0.8 : 0;
      return {
        opt, value: playValue(c, fromArsenal) + condValue + optValue, goAgain: goAgain || condGoAgain, usesAP: has(c, 'Action') && !has(c, 'Instant'),
        isAttack, cost: opt.cost, uidInHand: p.hand.some((h) => h.uid === opt.uid) ? opt.uid : null,
      };
    }
    if (opt.index === HAND_INDEX) {
      const c = cardOf(p.hand.find((h) => h.uid === opt.uid)!);
      const ha = getScript(c).handActivation!;
      const value = effectValue(ha.effects) - cardPlayValue(c) * 0.8 - 0.3;
      return { opt, value, goAgain: false, usesAP: false, isAttack: false, cost: opt.cost, uidInHand: opt.uid };
    }
    if (opt.index >= HERO_INDEX) {
      const a = getHeroAbility(cardOf(p.hero))!.activations![opt.index - HERO_INDEX];
      const value = a.botValue?.(heroCtx(s, p)) ?? 0.5;
      return { opt, value, goAgain: !!a.goAgain, usesAP: !a.instant, isAttack: false, cost: opt.cost, uidInHand: null };
    }
    const src = cardOf(findSourceInst(p, opt.uid)!);
    const a = getScript(src).activations[opt.index];
    const value = a.attack ? powerOf(src) : effectValue(a.effects) - (a.destroySelf ? 1 : 0);
    return { opt, value, goAgain: a.goAgain, usesAP: !a.instant, isAttack: a.attack, cost: opt.cost, uidInHand: null };
  });
}

/** Should the bot pay a card's optional cost ("you may discard a card. If you do, ...")? And with what? */
export function decideOptional(s: GameState, p: PlayerState, uid: number, pitch: number[]): OptionalChoice | undefined {
  const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === uid);
  if (!inst) return undefined;
  const oc = getScript(cardOf(inst)).optional;
  if (!oc || oc.timing === 'defend' || !optionalPayable(p, oc, uid)) return undefined;
  const gain = effectValue(oc.effects);
  const pool = p.hand.filter((h) => h.uid !== uid && !pitch.includes(h.uid));
  const cheapest = (filter: (c: Card) => boolean) =>
    pool.filter((h) => filter(cardOf(h))).sort((a, b) => cardPlayValue(cardOf(a)) - cardPlayValue(cardOf(b)))[0];
  const needPower = (c: Card) => oc.minPower === undefined || powerOf(c) >= oc.minPower;
  let choice: OptionalChoice | undefined;
  let cost = 0;
  switch (oc.cost.kind) {
    case 'discard': case 'handToBottom': case 'banishHand': {
      const want = oc.cost.kind === 'discard' ? oc.cost.pitch : undefined;
      const h = cheapest((c) => (!want || pitchOf(c) === want) && needPower(c));
      if (!h) return { accept: false };
      choice = { accept: true, uid: h.uid };
      cost = cardPlayValue(cardOf(h)) * (oc.cost.kind === 'handToBottom' ? 0.6 : 1) + 0.4;
      break;
    }
    case 'discardOrTop': {
      const h = oc.minPower !== undefined ? cheapest(needPower) : undefined;
      if (h) { choice = { accept: true, uid: h.uid }; cost = cardPlayValue(cardOf(h)) + 0.4; }
      else { choice = { accept: true, top: true }; cost = oc.minPower !== undefined ? 99 : 0.4; }
      break;
    }
    case 'pay': {
      const total = effectiveCost(s, p, cardOf(inst)) + oc.cost.amount;
      if (availableResources(p, [uid]) < total) return { accept: false };
      choice = { accept: true };
      cost = oc.cost.amount * 1.1;
      break;
    }
    case 'banishGrave': choice = { accept: true }; cost = oc.cost.n * 0.2 + (oc.minPower !== undefined ? 1.5 : 0); break;
    case 'destroyTop': choice = { accept: true }; cost = 0.4 + (oc.minPower !== undefined ? 1.5 : 0); break;
    case 'destroyOwn': choice = { accept: true }; cost = 1; break;
    case 'reveal': {
      // fusing is free: the revealed card stays in hand
      const talent = oc.cost.talent;
      const h = cheapest((c) => c.types.includes(talent));
      if (!h) return { accept: false };
      return { accept: true, uid: h.uid };
    }
    case 'charge': {
      const want = oc.cost.pitch;
      const h = cheapest((c) => !want || pitchOf(c) === want);
      if (!h) return { accept: false };
      choice = { accept: true, uid: h.uid };
      cost = cardPlayValue(cardOf(h)) * 0.8 + 0.3; // a card in the soul still has value for Light heroes
      break;
    }
  }
  return gain > cost ? choice : { accept: false };
}

/** Build a "play" action including mode and optional-cost decisions, with pitch that covers any extra cost. */
function playAction(s: GameState, p: PlayerState, uid: number, cost: number, pitchPool: number[]): Action | null {
  let optional = decideOptional(s, p, uid, []);
  const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === uid)!;
  const oc = getScript(cardOf(inst)).optional;
  const extra = optional?.accept && oc?.cost.kind === 'pay' ? oc.cost.amount : 0;
  const pool = pitchPool.filter((u) => u !== optional?.uid);
  let pitch = choosePitch(p, cost + extra, pool);
  if (!pitch && extra) { optional = { accept: false }; pitch = choosePitch(p, cost, pitchPool); }
  if (!pitch) return null;
  return { type: 'play', uid, pitch, mode: modeFor(p, uid), optional };
}

function modeFor(p: PlayerState, uid: number): number {
  const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === uid);
  return inst ? bestMode(cardOf(inst)) : 0;
}

function findSourceInst(p: PlayerState, uid: number) {
  if (p.hero.uid === uid) return p.hero;
  return (
    p.weapons.find((w) => w.inst.uid === uid)?.inst ??
    p.equipment.find((e) => e.inst.uid === uid)?.inst ??
    p.permanents.find((e) => e.inst.uid === uid)?.inst
  );
}

/** Value of holding a card in hand for defense / next turn. */
function keepValue(c: Card, threat: number, life: number): number {
  const d = defenseOf(c) ?? 0;
  const w = threat >= life ? 1.3 : life <= 8 ? 1.0 : 0.65;
  return d * w + (has(c, 'Defense Reaction') ? 1 : 0);
}

function opponentThreat(s: GameState, p: PlayerState): number {
  const o = s.players[other(p.id)];
  // rough expectation: ~2.5 damage per card in hand + weapon
  return o.intellect * 2.5 + (o.weapons.length ? 2 : 0);
}

// ---------------------------------------------------------------- action phase

function planAction(s: GameState, p: PlayerState, difficulty: Difficulty): BotDecision {
  const items = itemsFor(s, p).filter((it) => it.value > 0.25 || it.isAttack);
  if (difficulty === 'easy') {
    const attacks = items.filter((i) => i.isAttack || i.value > 1);
    if (attacks.length && Math.random() < 0.85) {
      const it = attacks[Math.floor(Math.random() * attacks.length)];
      return mkPlay(s, p, it, [it], 'Plays a card it can afford.');
    }
    return { action: { type: 'pass' }, reason: 'Nothing worth playing.' };
  }
  const threat = opponentThreat(s, p);
  const opp = s.players[other(p.id)];
  const cands = items.slice(0, 10);
  let best: { plan: Item[]; score: number; pitch: number[] } = { plan: [], score: -Infinity, pitch: [] };
  const handCards = p.hand.map((h) => ({ uid: h.uid, c: cardOf(h) }));
  const evalPlan = (plan: Item[]) => {
    // action point feasibility: every AP-using item except the last must have go again (given AP)
    const ap = plan.filter((i) => i.usesAP);
    const noGa = ap.filter((i) => !i.goAgain).length;
    if (ap.length > 0 && p.actionPoints === 0) return;
    if (noGa > p.actionPoints) return;
    const cost = plan.reduce((a, i) => a + i.cost, 0);
    const inPlan = new Set(plan.map((i) => i.uidInHand).filter((u) => u !== null));
    const rest = handCards.filter((h) => !inPlan.has(h.uid));
    const need = cost - p.resources;
    // choose pitch subset of `rest`
    let bestPitch: { uids: number[]; loss: number } | null = null;
    const m = rest.length;
    for (let mask = 0; mask < 1 << m; mask++) {
      let total = 0;
      let loss = 0;
      const uids: number[] = [];
      for (let i = 0; i < m; i++) {
        if (!(mask & (1 << i))) continue;
        total += pitchOf(rest[i].c);
        loss += keepValue(rest[i].c, threat, p.life);
        uids.push(rest[i].uid);
      }
      if (total < need) continue;
      if (need <= 0 && mask !== 0) continue;
      loss += Math.max(0, total - Math.max(need, 0)) * 0.25;
      if (!bestPitch || loss < bestPitch.loss) bestPitch = { uids, loss };
    }
    if (!bestPitch) return;
    const kept = rest.filter((r) => !bestPitch!.uids.includes(r.uid));
    // holding cards to block has diminishing returns: you rarely need 3-4 blockers, so don't sit on a full hand
    const keptValue = kept.map((k) => keepValue(k.c, threat, p.life)).sort((x, y) => y - x).reduce((a, v, i) => a + v * ([1, 0.75, 0.45, 0.25][i] ?? 0.15), 0);
    const arsenalBonus = p.arsenal.length === 0 && kept.some((k) => pitchOf(k.c) !== 3 && cardPlayValue(k.c) > 1) ? 1 : 0;
    let value = plan.reduce((a, i) => a + i.value, 0);
    // attacks into a hand that can block: big attacks tend to be blocked
    if (difficulty === 'hard') {
      const attacks = plan.filter((i) => i.isAttack);
      const lethal = value >= opp.life;
      if (!lethal && attacks.length === 1 && opp.hand.length >= 2) value -= 0.5;
      if (lethal) value += 20;
    }
    const score = value + keptValue + arsenalBonus;
    if (score > best.score) best = { plan, score, pitch: bestPitch.uids };
  };
  // enumerate subsets up to size 4
  const k = cands.length;
  const rec = (start: number, cur: Item[]) => {
    evalPlan(cur);
    if (cur.length >= 4) return;
    for (let i = start; i < k; i++) rec(i + 1, [...cur, cands[i]]);
  };
  rec(0, []);
  if (best.plan.length === 0) return { action: { type: 'pass' }, reason: 'Keeping the hand to defend is worth more than attacking now.' };
  // pick first step: non-attacks with go again / instants first, then go-again attacks, then the rest
  const order = (i: Item) => (!i.isAttack && (i.goAgain || !i.usesAP) ? 0 : i.isAttack && i.goAgain ? 1 : !i.isAttack ? 2 : 3);
  const sorted = [...best.plan].sort((a, b) => order(a) - order(b) || b.value - a.value);
  const first = sorted[0];
  const pitch = choosePitch(p, first.cost, best.pitch);
  if (!pitch) return { action: { type: 'pass' }, reason: 'Can’t pay.' };
  const pool = [...best.pitch, ...p.hand.filter((h) => !best.plan.some((i) => i.uidInHand === h.uid)).map((h) => h.uid)];
  const playIt = first.opt.kind === 'card' ? playAction(s, p, first.opt.uid, first.cost, [...new Set(pool)]) : null;
  if (first.opt.kind === 'card' && !playIt) return { action: { type: 'pass' }, reason: 'Can’t pay.' };
  return {
    action: playIt ?? { type: 'activate', uid: first.opt.uid, index: first.opt.index, pitch },
    reason: explainPlan(sorted, p),
    plan: sorted.map((i) => i.opt.uid),
    planPitch: [...new Set([...(playIt?.type === 'play' ? playIt.pitch : pitch), ...best.pitch])],
  };
}

function choosePitch(p: PlayerState, cost: number, preferred: number[]): number[] | null {
  const need = cost - p.resources;
  if (need <= 0) return [];
  // take from preferred first (largest pitch first to minimise card usage)
  const pref = preferred
    .map((u) => p.hand.find((h) => h.uid === u))
    .filter((h): h is NonNullable<typeof h> => !!h)
    .sort((a, b) => pitchOf(cardOf(b)) - pitchOf(cardOf(a)));
  const out: number[] = [];
  let got = 0;
  // try to find an exact-or-minimal single card
  const single = pref.filter((h) => pitchOf(cardOf(h)) >= need).sort((a, b) => pitchOf(cardOf(a)) - pitchOf(cardOf(b)))[0];
  if (single) return [single.uid];
  for (const h of pref) {
    if (got >= need) break;
    out.push(h.uid);
    got += pitchOf(cardOf(h));
  }
  return got >= need ? out : null;
}

function mkPlay(s: GameState, p: PlayerState, it: Item, plan: Item[], reason: string): BotDecision {
  const exclude = plan.map((i) => i.uidInHand).filter((u): u is number => u !== null);
  const pitchPool = p.hand.filter((h) => !exclude.includes(h.uid)).map((h) => h.uid);
  const pitch = choosePitch(p, it.cost, pitchPool) ?? [];
  const playIt = it.opt.kind === 'card' ? playAction(s, p, it.opt.uid, it.cost, pitchPool) : null;
  return {
    action: playIt ?? (it.opt.kind === 'card' ? { type: 'play', uid: it.opt.uid, pitch, mode: modeFor(p, it.opt.uid) } : { type: 'activate', uid: it.opt.uid, index: it.opt.index, pitch }),
    reason,
  };
}

function explainPlan(plan: Item[], p: PlayerState): string {
  const names = plan.map((i) => i.opt.label);
  const first = plan[0];
  const parts = [`Plan this turn: ${names.join(' → ')}.`];
  if (plan.length > 1 && first.goAgain) parts.push(`${first.opt.label} has go again, so play it first to keep your action point.`);
  if (!first.isAttack && plan.some((i) => i.isAttack)) parts.push('Play buffs before the attack they boost.');
  if (p.hand.length > plan.length) parts.push('Keep the remaining high-defense cards to block or pitch.');
  return parts.join(' ');
}

// ---------------------------------------------------------------- defending

function defendCost(s: GameState, pid: PlayerId, uid: number): number {
  const p = s.players[pid];
  const h = p.hand.find((x) => x.uid === uid);
  if (h) {
    const c = cardOf(h);
    return Math.max(1.2, cardPlayValue(c) * 0.8 + pitchOf(c) * 0.5);
  }
  const e = p.equipment.find((x) => x.inst.uid === uid)!;
  const sc = getScript(cardOf(e.inst));
  return sc.bladeBreak ? 2.2 : sc.battleworn || sc.temper ? 1.0 : 0.3;
}

function planDefense(s: GameState, pid: PlayerId, difficulty: Difficulty): BotDecision {
  const l = currentLink(s)!;
  const p = s.players[pid];
  const power = linkPower(l);
  const opts = defendOptions(s, pid).slice(0, 11);
  if (difficulty === 'easy') {
    const lethal = power >= p.life;
    if (!lethal && Math.random() < 0.6) return { action: { type: 'defend', uids: [] }, reason: 'Take it.' };
  }
  let best = { uids: [] as number[], score: Infinity };
  const m = opts.length;
  for (let mask = 0; mask < 1 << m; mask++) {
    const uids: number[] = [];
    let def = 0;
    let cost = 0;
    for (let i = 0; i < m; i++) {
      if (!(mask & (1 << i))) continue;
      uids.push(opts[i].uid);
      def += opts[i].defense;
      cost += defendCost(s, pid, opts[i].uid);
    }
    if (checkDefense(s, uids)) continue;
    const taken = Math.max(0, power - def);
    const overkill = Math.max(0, def - power);
    const lifeAfter = p.life - taken;
    let lifeW = p.life <= 10 ? 1.3 : 1;
    if (difficulty === 'hard') lifeW *= lifeAfter <= opponentThreat(s, p) * 0.5 ? 1.3 : 1;
    const score = taken * lifeW + cost + overkill * 0.4 + (lifeAfter <= 0 ? 1000 : 0);
    if (score < best.score) best = { uids, score };
  }
  const names = best.uids.map((u) => {
    const f = p.hand.find((h) => h.uid === u) ?? p.equipment.find((e) => e.inst.uid === u)?.inst;
    return f ? cardOf(f).name : '?';
  });
  // block-time optional costs ("When this defends, you may pay {r}. If you do, this gets +N{d}")
  const { boosts, pitch } = planBoosts(s, p, best.uids, power);
  return {
    action: { type: 'defend', uids: best.uids, boosts, pitch },
    reason: best.uids.length
      ? `Block with ${names.join(', ')}: prevents damage efficiently for what those cards are worth.`
      : `Don’t block: taking ${power} is cheaper than spending cards.`,
  };
}

function planBoosts(s: GameState, p: PlayerState, uids: number[], power: number): { boosts: number[]; pitch: number[] } {
  const boosts: number[] = [];
  let payNeeded = 0;
  let defense = uids.reduce((a, u) => a + (defendOptions(s, p.id).find((o) => o.uid === u)?.defense ?? 0), 0);
  for (const u of uids) {
    const inst = p.hand.find((h) => h.uid === u) ?? p.equipment.find((e) => e.inst.uid === u)?.inst;
    const oc = inst && getScript(cardOf(inst)).optional;
    if (!oc || oc.timing !== 'defend') continue;
    const bonus = oc.effects.reduce((a, e) => a + (e.kind === 'thisDefense' ? e.amount : 0), 0);
    const gain = Math.min(bonus, Math.max(0, power - defense)) + effectValue(oc.effects.filter((e) => e.kind !== 'thisDefense')) * 0.5;
    if (gain < 1) continue;
    if (oc.cost.kind === 'pay') { payNeeded += oc.cost.amount; boosts.push(u); defense += bonus; }
    else if (optionalPayable(p, oc, u)) { boosts.push(u); defense += bonus; }
  }
  if (!payNeeded) return { boosts, pitch: [] };
  // pay with floating resources, or pitch spare (non-blocking) cards if cheap enough
  const spare = p.hand.filter((h) => !uids.includes(h.uid)).sort((a, b) => cardPlayValue(cardOf(a)) - cardPlayValue(cardOf(b)));
  const pitch: number[] = [];
  let have = p.resources;
  for (const h of spare) {
    if (have >= payNeeded) break;
    if (cardPlayValue(cardOf(h)) > 2.5) break;
    pitch.push(h.uid);
    have += pitchOf(cardOf(h));
  }
  if (have < payNeeded) {
    // can't afford the paid ones: keep only boosts that don't cost resources
    const instOf = (u: number) => p.hand.find((h) => h.uid === u) ?? p.equipment.find((e) => e.inst.uid === u)?.inst;
    return { boosts: boosts.filter((u) => getScript(cardOf(instOf(u)!)).optional?.cost.kind !== 'pay'), pitch: [] };
  }
  return { boosts, pitch };
}

// ---------------------------------------------------------------- reactions

function planReaction(s: GameState, pid: PlayerId, difficulty: Difficulty): BotDecision {
  const l = currentLink(s)!;
  const p = s.players[pid];
  const pass: BotDecision = { action: { type: 'pass' }, reason: 'No reaction worth its cost.' };
  if (difficulty === 'easy') return pass;
  const power = linkPower(l);
  const def = linkDefense(l);
  const opts = playOptions(s, pid).filter((o) => o.kind === 'card');
  let best: { opt: PlayOption; gain: number } | null = null;
  for (const o of opts) {
    const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === o.uid)!;
    const c = cardOf(inst);
    const sc = getScript(c);
    let gain = 0;
    if (l.attacker === pid) {
      const bonus = sc.onPlay.reduce((a, e) => a + (e.kind === 'targetAttackPower' ? e.amount : 0), 0);
      const extra = effectValue(sc.onPlay.filter((e) => e.kind !== 'targetAttackPower' && e.kind !== 'weakenAttack'));
      if (sc.onPlay.some((e) => e.kind === 'weakenAttack')) continue;
      gain = Math.max(0, power + bonus - def) - Math.max(0, power - def) + extra * 0.7;
      if (power + bonus - def >= s.players[other(pid)].life) gain += 50;
    } else if (has(c, 'Defense Reaction')) {
      const d = (defenseOf(c) ?? 0) + sc.onPlay.reduce((a, e) => a + (e.kind === 'thisDefense' ? e.amount : 0), 0);
      gain = Math.min(d, Math.max(0, power - def));
      if (power - def >= p.life && power - def - d < p.life) gain += 50;
    } else {
      const weaken = sc.onPlay.reduce((acc, e) => acc + (e.kind === 'weakenAttack' ? e.amount : 0), 0);
      gain = effectValue(sc.onPlay.filter((e) => e.kind === 'preventNext')) * (power > def ? 1 : 0) + Math.min(weaken, Math.max(0, power - def));
    }
    const cardCost = cardPlayValue(c) * 0.5 + o.cost * 0.8;
    const net = gain - cardCost;
    if (gain >= 2 && net > 0 && (!best || net > best.gain)) best = { opt: o, gain: net };
  }
  if (!best) return pass;
  const exclude = [best.opt.uid];
  const pitch = choosePitch(p, best.opt.cost, p.hand.filter((h) => !exclude.includes(h.uid)).sort((a, b) => keepValue(cardOf(a), 0, 20) - keepValue(cardOf(b), 0, 20)).map((h) => h.uid));
  if (!pitch) return pass;
  return { action: playAction(s, p, best.opt.uid, best.opt.cost, p.hand.filter((h) => h.uid !== best!.opt.uid).map((h) => h.uid)) ?? { type: 'play', uid: best.opt.uid, pitch, mode: modeFor(p, best.opt.uid) }, reason: `Play ${best.opt.label}: it changes the damage on this chain link.` };
}

/** Something is on the stack: respond with a damage-prevention instant when an opposing attack is coming, else let it resolve. */
function planStackResponse(s: GameState, pid: PlayerId, difficulty: Difficulty): BotDecision {
  const pass: BotDecision = { action: { type: 'pass' }, reason: 'Let it resolve.' };
  const top = s.stack![s.stack!.length - 1];
  if (difficulty === 'easy' || top.controller === pid || !has(cardOf(top.inst), 'Attack')) return pass;
  const p = s.players[pid];
  for (const o of playOptions(s, pid).filter((x) => x.kind === 'card')) {
    const c = cardOf([...p.hand, ...p.arsenal].find((i) => i.uid === o.uid)!);
    const prevent = getScript(c).onPlay.reduce((a, e) => a + (e.kind === 'preventNext' ? e.amount : 0), 0);
    if (prevent >= 2 && o.cost <= 1) {
      const a = playAction(s, p, o.uid, o.cost, p.hand.filter((h) => h.uid !== o.uid).map((h) => h.uid));
      if (a) return { action: a, reason: `Respond with ${c.name} to prevent damage from ${top.label}.` };
    }
  }
  return pass;
}

// ---------------------------------------------------------------- arsenal

function planArsenal(s: GameState, pid: PlayerId): BotDecision {
  const p = s.players[pid];
  const best = [...p.hand]
    .map((h) => ({ h, v: cardPlayValue(cardOf(h)) + (has(cardOf(h), 'Defense Reaction') ? 1.5 : 0) }))
    .sort((a, b) => b.v - a.v)[0];
  if (!best || best.v <= 0.5) return { action: { type: 'arsenal', uid: null }, reason: 'Keep the cards in hand.' };
  return { action: { type: 'arsenal', uid: best.h.uid }, reason: `Arsenal ${cardOf(best.h).name}: it’s a strong card to have ready next turn (or to defend with).` };
}

// ---------------------------------------------------------------- entry point

export function chooseAction(s: GameState, pid: PlayerId, difficulty?: Difficulty): BotDecision {
  const diff = difficulty ?? s.players[pid].difficulty;
  if (s.phase === 'action' && s.stack?.length) return planStackResponse(s, pid, diff);
  switch (s.phase) {
    case 'defend': return planDefense(s, pid, diff);
    case 'reaction': return planReaction(s, pid, diff);
    case 'arsenal': return planArsenal(s, pid);
    case 'action': return planAction(s, s.players[pid], diff);
    default: return { action: { type: 'pass' }, reason: '' };
  }
}

function modeLabel(p: PlayerState, uid: number, mode: number): string | undefined {
  const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === uid);
  return inst ? getScript(cardOf(inst)).modes[mode]?.label : undefined;
}

/** Human-readable description of an action (for hints and logs). */
export function describeAction(s: GameState, a: Action): string {
  const p = s.players[s.priority];
  const nameOf = (uid: number) => {
    const inst = [...p.hand, ...p.arsenal].find((i) => i.uid === uid) ?? findSourceInst(p, uid);
    return inst ? cardOf(inst).name : '?';
  };
  switch (a.type) {
    case 'play': return `Play ${nameOf(a.uid)}${a.mode !== undefined && modeLabel(p, a.uid, a.mode) ? ` (choose: ${modeLabel(p, a.uid, a.mode)})` : ''}${a.pitch.length ? `, pitching ${a.pitch.map(nameOf).join(' + ')}` : ''}`;
    case 'activate': return `Activate ${nameOf(a.uid)}${a.pitch.length ? `, pitching ${a.pitch.map(nameOf).join(' + ')}` : ''}`;
    case 'defend': return a.uids.length ? `Defend with ${a.uids.map(nameOf).join(', ')}` : 'Don’t defend';
    case 'arsenal': return a.uid === null ? 'Leave arsenal empty' : `Put ${nameOf(a.uid)} in arsenal`;
    case 'pass': return s.phase === 'action' ? 'End your turn' : 'Pass';
    default: return a.type;
  }
}

export { availableResources, costOf, effectiveCost };
