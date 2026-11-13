// What one player is allowed to see of a game, rotated so that player is always index 0.
// Used by the server for online games; the client renders it like a local game.
import { HIDDEN_ID } from '../data/cardDb';
import type { CardInst, GameState, PlayerId } from '../engine/types';

const hide = (list: CardInst[]): CardInst[] => list.map((c) => ({ ...c, cardId: HIDDEN_ID }));
const flip = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function viewFor(full: GameState, viewer: PlayerId): GameState {
  const s: GameState = structuredClone(full);
  const me = s.players[viewer];
  const them = s.players[flip(viewer)];
  // hidden information
  me.deck = hide(me.deck);
  them.deck = hide(them.deck);
  them.hand = hide(them.hand);
  them.arsenal = hide(them.arsenal);
  them.intimidated = hide(them.intimidated);
  s.seed = 0; // don't leak the RNG
  if (viewer === 0) return s;
  // rotate so the viewer is player 0 (objects can be shared, e.g. a weapon on the chain: flip each once)
  const r = (p: PlayerId): PlayerId => flip(p);
  const seen = new WeakSet<CardInst>();
  const swap = (c: CardInst) => { if (!seen.has(c)) { seen.add(c); c.owner = r(c.owner); } };
  for (const p of s.players) {
    [p.hero, ...p.deck, ...p.hand, ...p.arsenal, ...p.pitch, ...p.graveyard, ...p.banished, ...p.intimidated, ...(p.soul ?? []),
      ...p.weapons.map((w) => w.inst), ...p.equipment.map((e) => e.inst), ...p.permanents.map((x) => x.inst)].forEach(swap);
  }
  for (const l of s.chain) {
    l.attacker = r(l.attacker);
    swap(l.inst);
    l.defenders.forEach((d) => swap(d.inst));
  }
  for (const layer of s.stack ?? []) { layer.controller = r(layer.controller); swap(layer.inst); }
  s.players = [me, them];
  me.id = 0;
  them.id = 1;
  s.turnPlayer = r(s.turnPlayer);
  s.priority = r(s.priority);
  if (s.pendingTriggers) s.pendingTriggers = { ...s.pendingTriggers, player: r(s.pendingTriggers.player) };
  if (s.winner !== null) s.winner = r(s.winner);
  s.log = s.log.map((e) => ({ ...e, player: e.player === null ? null : r(e.player) }));
  return s;
}
