// Lethal puzzles: a fixed board where you must win this turn. Includes a brute-force solver used to
// verify every puzzle (and to show the solution on request).
import { card } from '../data/cardDb';
import { applyAction, createGame, playOptions } from '../engine/game';
import { getScript } from '../engine/cardScript';
import type { Action, CardInst, GameState, PlayerId } from '../engine/types';
import { chooseAction } from '../ai/bot';

export interface PuzzleDef {
  id: string;
  title: string;
  /** what the player is told */
  text: string;
  me: { hero: string; hand: string[]; arsenal?: string; weapons?: string[]; equipment?: string[]; life?: number };
  opp: { hero: string; life: number; hand?: string[]; equipment?: string[] };
  /** the winning line, as card names in order (shown after a reveal) */
  solution?: string[];
}

const inst = (s: GameState, cardId: string, owner: PlayerId): CardInst => ({ uid: s.nextUid++, cardId, owner });

/** Set up the puzzle position: your turn, 1 action point, the given cards, the opponent at the given life. */
export function buildPuzzle(def: PuzzleDef): GameState {
  const filler = [...def.me.hand, ...(def.opp.hand ?? []), def.me.hand[0]].filter(Boolean);
  const deck = (hero: string, weapons: string[] = [], equipment: string[] = []) => ({ heroId: hero, cardIds: Array.from({ length: 24 }, (_, i) => filler[i % filler.length]), weaponIds: weapons, equipmentIds: equipment });
  const s = createGame([
    { name: 'You', isBot: false, deck: deck(def.me.hero, def.me.weapons, def.me.equipment) },
    { name: `${card(def.opp.hero).name.split(',')[0]} (bot)`, isBot: true, difficulty: 'hard', deck: deck(def.opp.hero, [], def.opp.equipment) },
  ], 4242, 'blitz');
  const [me, opp] = s.players;
  s.turn = 3; s.turnPlayer = 0; s.priority = 0; s.phase = 'action'; s.passes = 0; s.chain = []; s.chainOpen = false; s.winner = null;
  s.log = [{ turn: 3, player: null, text: `Puzzle: ${def.title}` }];
  for (const p of s.players) {
    p.pitch = []; p.graveyard = []; p.banished = []; p.arsenal = []; p.resources = 0; p.effects = []; p.permanents = [];
    p.turn = { attacks: 0, attackActionHits: 0, weaponHits: 0, played: [], drew: false, boosted: false, flags: {} };
  }
  me.hand = def.me.hand.map((c) => inst(s, c, 0));
  if (def.me.arsenal) me.arsenal = [inst(s, def.me.arsenal, 0)];
  if (def.me.life) me.life = def.me.life;
  me.actionPoints = 1;
  opp.actionPoints = 0;
  opp.life = def.opp.life;
  opp.hand = (def.opp.hand ?? []).map((c) => inst(s, c, 1));
  return s;
}

export const puzzleWon = (s: GameState) => s.phase === 'gameOver' && s.winner === 0;
/** The turn is over (or lost) without the win. */
export const puzzleFailed = (s: GameState, start: GameState) => (s.phase === 'gameOver' && s.winner !== 0) || s.turn !== start.turn;

/** Every action the player could take here (plays with each sensible way to pay, activations, pass). */
export function candidateActions(s: GameState): Action[] {
  const p = s.players[0];
  // a decision in the middle of an effect: try each sensible answer
  const pc = s.pendingChoices?.[0];
  if (pc) {
    if (pc.player !== 0) return [];
    if (pc.kind === 'yesno') return [{ type: 'choose', yes: true }, { type: 'choose', yes: false }];
    if (pc.kind === 'target') return pc.options.map((o) => ({ type: 'choose' as const, picks: [o.uid] }));
    if (pc.kind === 'reload') return [...pc.options.map((o) => ({ type: 'choose' as const, picks: [o.uid] })), { type: 'choose', picks: [] }];
    return [{ type: 'choose', picks: pc.options.map((o) => o.uid) }, { type: 'choose', picks: [] }];
  }
  if (s.priority !== 0) return [];
  if (s.phase === 'arsenal') return [{ type: 'arsenal', uid: null }];
  if (s.phase === 'defend') return [{ type: 'defend', uids: [] }];
  const out: Action[] = [];
  for (const o of playOptions(s, 0)) {
    const need = o.cost - p.resources;
    const pool = p.hand.filter((h) => h.uid !== o.uid);
    const pitches: number[][] = [];
    if (need <= 0) pitches.push([]);
    else {
      for (let m = 1; m < 1 << pool.length; m++) {
        const pick = pool.filter((_, i) => m & (1 << i));
        const total = pick.reduce((a, h) => a + (card(h.cardId).pitch ?? 0), 0);
        if (total < need) continue;
        // only minimal ways to pay: dropping any card would no longer cover the cost
        if (pick.some((h) => total - (card(h.cardId).pitch ?? 0) >= need)) continue;
        pitches.push(pick.map((h) => h.uid));
      }
    }
    for (const pitch of pitches) {
      if (o.kind === 'activation') { out.push({ type: 'activate', uid: o.uid, index: o.index, pitch }); continue; }
      const c = card([...p.hand, ...p.arsenal].find((h) => h.uid === o.uid)!.cardId);
      const modes = getScript(c).modes.length || 1;
      for (let mode = 0; mode < modes; mode++) out.push({ type: 'play', uid: o.uid, pitch, mode });
    }
  }
  out.push({ type: 'pass' });
  return out;
}

/** Let the opponent (and the engine) act until it's the player's decision again. */
export function settle(s: GameState): GameState {
  for (let i = 0; i < 50 && s.phase !== 'gameOver' && s.priority === 1 && !s.pendingChoices?.length; i++) s = applyAction(s, chooseAction(s, 1, 'hard').action);
  return s;
}

/** Depth-first search for a winning line. Returns the player's actions, or null if none was found. */
export function solve(start: GameState, maxNodes = 40000): Action[] | null {
  let nodes = 0;
  const dfs = (s: GameState, path: Action[]): Action[] | null => {
    if (puzzleWon(s)) return path;
    if (puzzleFailed(s, start) || ++nodes > maxNodes) return null;
    for (const a of candidateActions(s)) {
      let next: GameState;
      try { next = settle(applyAction(s, a)); } catch { continue; }
      const r = dfs(next, [...path, a]);
      if (r) return r;
    }
    return null;
  };
  return dfs(settle(start), []);
}

/** The most damage the player can deal this turn (used when generating puzzles). */
export function maxDamage(start: GameState, maxNodes = 40000): number {
  let nodes = 0;
  let best = 0;
  const life0 = start.players[1].life;
  const dfs = (s: GameState) => {
    best = Math.max(best, life0 - s.players[1].life);
    if (s.phase === 'gameOver' || s.turn !== start.turn || ++nodes > maxNodes) return;
    for (const a of candidateActions(s)) {
      if (a.type === 'pass' && s.phase === 'action') continue; // ending the turn adds nothing
      try { dfs(settle(applyAction(s, a))); } catch { /* illegal */ }
    }
  };
  dfs(settle(start));
  return best;
}

/** Does a bot playing your side find the win? (puzzles are only interesting if it doesn't) */
export function botSolves(start: GameState, difficulty: 'normal' | 'hard'): boolean {
  let s = settle(start);
  for (let i = 0; i < 80 && !puzzleWon(s) && !puzzleFailed(s, start); i++) s = settle(applyAction(s, chooseAction(s, 0, difficulty).action));
  return puzzleWon(s);
}
