// Bot-vs-bot soak test: every hero plays full games (1v1 and Pit Fight, with and without macros).
// Any rules crash or a game that never ends fails the build.
import { describe, expect, it } from 'vitest';
import './setup';
import { applyAction, createGame } from '../engine/game';
import { chooseAction } from '../ai/bot';
import { autoBuildDeck, heroesFor, toDeckList } from '../deck/deck';
import type { GameState, Macro } from '../engine/types';

function play(s: GameState): GameState {
  for (let i = 0; i < 5000 && s.phase !== 'gameOver'; i++) {
    const pid = s.pendingChoices?.[0]?.player ?? s.pendingTriggers?.player ?? s.priority;
    s = applyAction(s, chooseAction(s, pid).action);
  }
  return s;
}

const MACROS: (Macro | undefined)[] = [undefined, 'Treasure Island', 'Omens of Arcana'];

describe('soak: bots play every hero to the end', () => {
  for (const fmt of ['blitz', 'cc'] as const) {
    it(`1v1 ${fmt}: no crash, every game ends`, () => {
      const hs = heroesFor(fmt);
      const failures: string[] = [];
      hs.forEach((h, i) => {
        const opp = hs[(i * 7 + 3) % hs.length];
        const seed = 7000 + i;
        try {
          const s = play(createGame([
            { name: 'A', isBot: true, difficulty: 'hard', deck: toDeckList(autoBuildDeck(h.id, fmt, seed)) },
            { name: 'B', isBot: true, difficulty: 'normal', deck: toDeckList(autoBuildDeck(opp.id, fmt, seed + 1)) },
          ], seed, fmt, undefined, { macro: MACROS[i % 3] }));
          if (s.phase !== 'gameOver') failures.push(`${h.name} vs ${opp.name} (seed ${seed}) never ended`);
        } catch (e) { failures.push(`${h.name} vs ${opp.name} (seed ${seed}): ${(e as Error).message}`); }
      });
      expect(failures).toEqual([]);
    }, 300_000);
  }
  it('3-player Pit Fight: no crash, every game ends', () => {
    const hs = heroesFor('blitz');
    const failures: string[] = [];
    hs.forEach((h, i) => {
      const seed = 8000 + i;
      const heroes = [h, hs[(i + 11) % hs.length], hs[(i + 23) % hs.length]];
      try {
        const s = play(createGame(heroes.map((x, k) => ({ name: 'P' + k, isBot: true, difficulty: 'normal' as const, deck: toDeckList(autoBuildDeck(x.id, 'blitz', seed + k)) })), seed, 'upf', undefined, { macro: MACROS[i % 3], events: i % 2 === 0 }));
        if (s.phase !== 'gameOver') failures.push(`${heroes.map((x) => x.name).join(', ')} (seed ${seed}) never ended`);
      } catch (e) { failures.push(`${heroes.map((x) => x.name).join(', ')} (seed ${seed}): ${(e as Error).message}`); }
    });
    expect(failures).toEqual([]);
  }, 300_000);
});
