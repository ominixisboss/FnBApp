import { describe, expect, it } from 'vitest';
import './setup';
import { TRAINING } from '../learn/training';
import { buildPuzzle, solve } from '../learn/puzzleEngine';
import { getDb } from '../data/cardDb';

describe('training positions', () => {
  for (const p of TRAINING) {
    it(`${p.id} ${p.title} uses real cards and can be won`, () => {
      for (const id of [p.me.hero, p.opp.hero, ...p.me.hand, ...(p.me.permanents ?? [])]) expect(getDb().byId.get(id), id).toBeTruthy();
      expect(solve(buildPuzzle(p), 20000)).not.toBeNull();
    }, 60000);
  }
});
