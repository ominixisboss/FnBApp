// What one player is allowed to see of a game, rotated so that player is always index 0.
// Seats keep their order round the table (in Ultimate Pit Fight your left neighbour is 1 and
// your right neighbour is the last seat). Used by the server for online games; the client
// renders it like a local game.
import { HIDDEN_ID } from '../data/cardDb';
import type { CardInst, GameState, PlayerId } from '../engine/types';

const hide = (list: CardInst[]): CardInst[] => list.map((c) => ({ ...c, cardId: HIDDEN_ID }));

/** a seat as `viewer` sees it */
export const toView = (seat: PlayerId, viewer: PlayerId, n: number): PlayerId => ((seat - viewer + n) % n) as PlayerId;
/** a seat the viewer named, as the server knows it */
export const fromView = (seat: PlayerId, viewer: PlayerId, n: number): PlayerId => ((seat + viewer) % n) as PlayerId;

export function viewFor(full: GameState, viewer: PlayerId): GameState {
  const s: GameState = structuredClone(full);
  const n = s.players.length;
  // hidden information
  for (const p of s.players) {
    p.deck = hide(p.deck);
    if (p.id === viewer) continue;
    p.hand = hide(p.hand);
    p.arsenal = p.arsenal.map((c) => (c.faceUp ? c : { ...c, cardId: HIDDEN_ID }));
    p.intimidated = hide(p.intimidated);
    p.inventory = p.inventory?.map(() => HIDDEN_ID);
    // Cloaked equipment equipped face-down: only its owner sees what it is
    p.equipment = p.equipment.map((e) => (e.faceDown ? { ...e, inst: { ...e.inst, cardId: HIDDEN_ID } } : e));
  }
  s.seed = 0; // don't leak the RNG
  if (s.eventDeck) s.eventDeck = s.eventDeck.map(() => HIDDEN_ID); // only how many are left
  // decisions: the other players only see that one is being made, not the cards involved
  if (s.pendingChoices) s.pendingChoices = s.pendingChoices.map((c) => (c.player === viewer ? c : { ...c, options: c.options.map((o) => ({ ...o, cardId: HIDDEN_ID })) }));
  if (viewer === 0) return s;
  // rotate so the viewer is player 0 (objects can be shared, e.g. a weapon on the chain: move each once)
  const r = (p: PlayerId): PlayerId => toView(p, viewer, n);
  const seen = new WeakSet<CardInst>();
  const swap = (c: CardInst) => { if (!seen.has(c)) { seen.add(c); c.owner = r(c.owner); } };
  for (const p of s.players) {
    [p.hero, ...p.deck, ...p.hand, ...p.arsenal, ...p.pitch, ...p.graveyard, ...p.banished, ...p.intimidated, ...(p.soul ?? []),
      ...p.weapons.map((w) => w.inst), ...p.equipment.map((e) => e.inst), ...p.permanents.map((x) => x.inst)].forEach(swap);
    if (p.focus !== undefined) p.focus = r(p.focus);
    if (p.redirectTo !== undefined) p.redirectTo = r(p.redirectTo);
  }
  for (const l of s.chain) {
    l.attacker = r(l.attacker);
    if (l.defender !== undefined) l.defender = r(l.defender);
    swap(l.inst);
    l.defenders.forEach((d) => swap(d.inst));
  }
  for (const layer of s.stack ?? []) { layer.controller = r(layer.controller); swap(layer.inst); }
  const rotated: GameState['players'] = [];
  for (const p of s.players) { const v = r(p.id); rotated[v] = p; p.id = v; }
  s.players = rotated;
  s.turnPlayer = r(s.turnPlayer);
  s.priority = r(s.priority);
  if (s.pendingTriggers) s.pendingTriggers = { ...s.pendingTriggers, player: r(s.pendingTriggers.player) };
  if (s.pendingChoices) s.pendingChoices = s.pendingChoices.map((c) => ({ ...c, player: r(c.player), resume: c.resume.type === 'hero' ? { ...c.resume, owner: r(c.resume.owner) } : c.resume }));
  if (s.winner !== null) s.winner = r(s.winner);
  s.log = s.log.map((e) => ({ ...e, player: e.player === null ? null : r(e.player) }));
  return s;
}
