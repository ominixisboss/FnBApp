// "Mythic" bot: for each sensible move, play out many possible futures (with the hidden cards reshuffled each
// time, so it can't cheat) using the Hard bot for both players, and pick the move that does best on average.
import { alivePlayers, applyAction, autoPitch, checkDefense, defendOptions, oppOf, playOptions } from '../engine/game';
import type { Action, GameState, PlayerId } from '../engine/types';
import { chooseAction, decideOptional } from './bot';
import type { BotDecision } from './bot';

const key = (a: Action) => JSON.stringify(a);

/** Small seeded RNG for determinization. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function shuffleInPlace<T>(a: T[], r: () => number) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
}

/** Replace everything `pid` can't see with a random but consistent guess: the opponent's hand and deck are
 *  redealt from the cards they could be, and both decks are reshuffled. */
export function determinize(s: GameState, pid: PlayerId, r: () => number): GameState {
  const t: GameState = structuredClone(s);
  const me = t.players[pid];
  for (const opp of t.players) {
    if (opp.id === pid) continue;
    const hidden = [...opp.hand, ...opp.deck];
    shuffleInPlace(hidden, r);
    opp.hand = hidden.slice(0, opp.hand.length);
    opp.deck = hidden.slice(opp.hand.length);
  }
  shuffleInPlace(me.deck, r);
  t.seed = Math.floor(r() * 0x7fffffff);
  for (const pl of t.players) { pl.isBot = true; pl.difficulty = 'hard'; }
  return t;
}

/** a card in hand or arsenal is worth about two damage */
const CARD_WEIGHT = 2;
/** how much better (in evaluation points) another move must look before overruling the Hard bot */
const MARGIN = 1.5;
/** How good a position is for `pid` (life, cards and the end of the game). */
export function evaluate(s: GameState, pid: PlayerId): number {
  const me = s.players[pid];
  const cards = (p: typeof me) => p.hand.length + p.arsenal.length;
  if (s.players.length <= 2) {
    if (s.phase === 'gameOver') return s.winner === pid ? 100 : -100;
    const op = s.players[oppOf(s, pid)];
    return me.life - op.life + CARD_WEIGHT * (cards(me) - cards(op));
  }
  // Pit Fight: outlasting matters most. Knocked out: worse the earlier it happened; otherwise my life and
  // cards against the average opponent still standing, plus a bonus for every opponent already out.
  if (s.phase === 'gameOver' && s.winner === pid) return 100;
  if (me.eliminated || s.phase === 'gameOver') return -100 + 25 * (s.knockedOut ?? []).indexOf(pid);
  const rivals = alivePlayers(s).filter((p) => p.id !== pid);
  const avg = rivals.reduce((a, p) => a + p.life + CARD_WEIGHT * cards(p), 0) / Math.max(1, rivals.length);
  return me.life + CARD_WEIGHT * cards(me) - avg + 15 * (s.players.length - 1 - rivals.length);
}

/** Whoever must act: the player making a choice or ordering triggers, else the one with priority. */
const actor = (t: GameState): PlayerId => t.pendingChoices?.[0]?.player ?? t.pendingTriggers?.player ?? t.priority;

function rollout(s: GameState, pid: PlayerId, first: Action, horizon: number): number {
  let t: GameState;
  try { t = applyAction(s, first); } catch { return -999; }
  for (let i = 0; i < 400 && t.phase !== 'gameOver' && t.turn < horizon; i++) {
    let a: Action;
    try { a = chooseAction(t, actor(t), 'hard').action; } catch { a = { type: 'pass' }; }
    try { t = applyAction(t, a); } catch { try { t = applyAction(t, { type: 'pass' }); } catch { break; } }
  }
  return evaluate(t, pid);
}

/** The moves worth comparing right now. */
function candidates(s: GameState, pid: PlayerId, hard: Action): Action[] {
  const out = new Map<string, Action>([[key(hard), hard]]);
  const p = s.players[pid];
  if (s.phase === 'defend') {
    out.set(key({ type: 'defend', uids: [] }), { type: 'defend', uids: [] });
    const opts = defendOptions(s, pid);
    for (const o of opts) if (!checkDefense(s, [o.uid])) out.set(key({ type: 'defend', uids: [o.uid] }), { type: 'defend', uids: [o.uid] });
    for (let i = 0; i < opts.length && out.size < 12; i++) for (let j = i + 1; j < opts.length && out.size < 12; j++) {
      const uids = [opts[i].uid, opts[j].uid];
      if (!checkDefense(s, uids)) out.set(key({ type: 'defend', uids }), { type: 'defend', uids });
    }
    return [...out.values()];
  }
  out.set(key({ type: 'pass' }), { type: 'pass' });
  for (const o of playOptions(s, pid)) {
    if (out.size >= 10) break;
    const pitch = autoPitch(p, Math.max(0, o.cost - p.resources), [o.uid]);
    if (pitch === null) continue;
    const a: Action = o.kind === 'card'
      ? { type: 'play', uid: o.uid, pitch, optional: decideOptional(s, p, o.uid, pitch) }
      : { type: 'activate', uid: o.uid, index: o.index, pitch };
    out.set(key(a), a);
  }
  return [...out.values()];
}

export function chooseMythic(s: GameState, pid: PlayerId, budgetMs = 900): BotDecision {
  const hard = chooseAction(s, pid, 'hard');
  // only the big decisions are simulated: what to play in the action phase and how to defend
  if (!((s.phase === 'action' && !s.stack?.length && s.turnPlayer === pid) || s.phase === 'defend')) return hard;
  const cands = candidates(s, pid, hard.action);
  if (cands.length <= 1) return hard;
  // look a full round of the table ahead (two turns one-on-one)
  const horizon = s.turn + Math.max(2, alivePlayers(s).length);
  const stats = cands.map(() => ({ sum: 0, n: 0 }));
  const r = rng(s.seed ^ (s.turn * 7919) ^ (s.log.length * 104729));
  const deadline = Date.now() + budgetMs;
  let round = 0;
  while (round < 4 || (Date.now() < deadline && round < 60)) {
    const seed = Math.floor(r() * 0x7fffffff);
    for (let i = 0; i < cands.length; i++) {
      // every candidate sees the same guessed hidden cards in a round, so they're compared fairly
      const world = determinize(s, pid, rng(seed));
      const v = rollout(world, pid, cands[i], horizon);
      stats[i].sum += v; stats[i].n++;
    }
    round++;
  }
  const means = stats.map((x) => x.sum / Math.max(1, x.n));
  // stick with the Hard bot's move unless another one is clearly better (simulations are noisy)
  const hardIdx = cands.findIndex((c) => key(c) === key(hard.action));
  let best = hardIdx;
  for (let i = 0; i < cands.length; i++) if (i !== hardIdx && means[i] > means[best]) best = i;
  if (best !== hardIdx && means[best] - means[hardIdx] < MARGIN) best = hardIdx;
  if (key(cands[best]) === key(hard.action)) return { ...hard, reason: `${hard.reason} (Checked ${round} possible futures for ${cands.length} options.)` };
  return { action: cands[best], reason: `Simulated ${round} possible futures for each of ${cands.length} options; this one came out best (${means[best].toFixed(1)} vs ${means[cands.findIndex((c) => key(c) === key(hard.action))].toFixed(1)}).` };
}
