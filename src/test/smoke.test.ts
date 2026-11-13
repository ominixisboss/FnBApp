import { expect, it } from 'vitest';
import './setup';
import { simulateGame } from '../ai/simulate';
import { autoBuildDeck, heroesFor, toDeckList } from '../deck/deck';
it('many bot games run without errors', () => {
  const heroes = heroesFor('blitz');
  const errs: string[] = [];
  let n = 0;
  for (let i = 0; i < heroes.length; i++) {
    const a = toDeckList(autoBuildDeck(heroes[i].id, 'blitz', i + 1));
    const b = toDeckList(autoBuildDeck(heroes[(i * 7 + 3) % heroes.length].id, 'blitz', i + 9));
    try { simulateGame(a, b, 'hard', 'normal', 1000 + i); n++; } catch (e) { errs.push(`${heroes[i].name}: ${(e as Error).message}`); }
  }
  expect(errs).toEqual([]);
  expect(n).toBe(heroes.length);
}, 600000);
