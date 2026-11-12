import { describe, expect, it } from 'vitest';
import './setup';
import { PUZZLES } from '../learn/puzzles';
import { buildPuzzle, solve } from '../learn/puzzleEngine';

describe('lethal puzzles', () => {
  for (const p of PUZZLES) {
    it(`${p.id} ${p.title} has a winning line`, () => {
      expect(solve(buildPuzzle(p), 20000)).not.toBeNull();
    }, 60000);
  }
});
