import { describe, expect, it } from 'vitest';
import './setup';
import { autoBuildDeck, heroesFor, validateDeck } from '../deck/deck';
import type { DeckFormat } from '../deck/deck';

describe('formats', () => {
  for (const f of ['ll', 'sage', 'commoner'] as DeckFormat[]) {
    it(`${f}: has heroes, and auto-built decks are legal for most of them`, () => {
      const heroes = heroesFor(f);
      expect(heroes.length).toBeGreaterThan(3);
      const bad = heroes.filter((h) => validateDeck(autoBuildDeck(h.id, f)).filter((e) => !e.startsWith('No weapon')).length > 0);
      console.log(f, heroes.length, 'heroes;', bad.length, 'without a full legal auto deck:', bad.slice(0, 5).map((h) => `${h.name}: ${validateDeck(autoBuildDeck(h.id, f))[0]}`).join(' | '));
      expect(bad.length).toBeLessThan(heroes.length / 2);
    });
  }
});
