import { describe, expect, it } from 'vitest';
import './setup';
import { applyAction, createGame } from '../engine/game';
import { chooseAction } from '../ai/bot';
import { autoBuildDeck, heroesFor, toDeckList, validateDeck } from '../deck/deck';
import type { Difficulty, GameState } from '../engine/types';

function playOut(s: GameState, maxSteps = 4000): GameState {
  for (let i = 0; i < maxSteps && s.phase !== 'gameOver'; i++) {
    const d = chooseAction(s, s.priority);
    s = applyAction(s, d.action);
    if (s.turn > 120) break;
  }
  return s;
}

describe('bot vs bot simulations', () => {
  const heroes = heroesFor('blitz');
  it('auto-built blitz decks are valid for every young hero', () => {
    const bad: string[] = [];
    for (const h of heroes) {
      const errs = validateDeck(autoBuildDeck(h.id, 'blitz')).filter((e) => !e.startsWith('No weapon'));
      if (errs.length) bad.push(`${h.name}: ${errs.join('; ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('plays many complete games without errors', () => {
    let finished = 0;
    const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
    const games = 60;
    for (let g = 0; g < games; g++) {
      const a = heroes[(g * 7) % heroes.length];
      const b = heroes[(g * 13 + 5) % heroes.length];
      const s0 = createGame([
        { name: 'A', isBot: true, difficulty: diffs[g % 3], deck: toDeckList(autoBuildDeck(a.id, 'blitz', g)) },
        { name: 'B', isBot: true, difficulty: diffs[(g + 1) % 3], deck: toDeckList(autoBuildDeck(b.id, 'blitz', g + 1)) },
      ], g + 1);
      const s = playOut(s0);
      if (s.phase === 'gameOver') finished++;
    }
    expect(finished).toBeGreaterThan(games * 0.8);
  });

  it('cc decks play too', () => {
    const hs = heroesFor('cc');
    for (let g = 0; g < 10; g++) {
      const a = hs[(g * 5) % hs.length];
      const b = hs[(g * 11 + 3) % hs.length];
      const s = playOut(createGame([
        { name: 'A', isBot: true, deck: toDeckList(autoBuildDeck(a.id, 'cc', g)) },
        { name: 'B', isBot: true, deck: toDeckList(autoBuildDeck(b.id, 'cc', g)) },
      ], g + 100, 'cc'));
      expect(s.players.every((p) => p.life <= 40 + 20)).toBe(true);
    }
  });
});

describe('background bot', () => {
  it('askBot gives the same decision as the bot itself (main-thread fallback when workers are unavailable)', async () => {
    const { askBot } = await import('../ai/botClient');
    const heroes = heroesFor('blitz');
    const a = toDeckList(autoBuildDeck(heroes[0].id, 'blitz'));
    const b = toDeckList(autoBuildDeck(heroes[1].id, 'blitz'));
    const s = createGame([{ name: 'A', isBot: true, deck: a }, { name: 'B', isBot: true, deck: b }], 7, 'blitz');
    const d = await askBot(s, s.priority, 'hard');
    expect(d.action).toEqual(chooseAction(s, s.priority, 'hard').action);
    expect(() => applyAction(s, d.action)).not.toThrow();
  });
});
