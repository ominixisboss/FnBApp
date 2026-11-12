// Play a whole game between two bots (used for the other tables in a tournament).
import { applyAction, createGame } from '../engine/game';
import type { DeckList } from '../engine/game';
import type { Difficulty, PlayerId } from '../engine/types';
import { chooseAction } from './bot';

export function simulateGame(a: DeckList, b: DeckList, da: Difficulty, db: Difficulty, seed: number, format = 'blitz'): PlayerId {
  let s = createGame([{ name: 'A', isBot: true, difficulty: da, deck: a }, { name: 'B', isBot: true, difficulty: db, deck: b }], seed, format);
  for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
    try { s = applyAction(s, chooseAction(s, s.priority).action); } catch { s = applyAction(s, { type: 'pass' }); }
  }
  if (s.phase === 'gameOver' && s.winner !== null) return s.winner;
  return s.players[0].life >= s.players[1].life ? 0 : 1;
}
