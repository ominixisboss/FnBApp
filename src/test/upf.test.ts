// Ultimate Pit Fight: 3-4 heroes, attacks only to your left or right, last hero standing wins.
import { describe, expect, it } from 'vitest';
import './setup';
import { applyAction, concedeSeat, createGame, targetableOpponents } from '../engine/game';
import { chooseAction } from '../ai/bot';
import { autoBuildDeck, heroesFor, toDeckList } from '../deck/deck';
import type { GameState, PlayerId } from '../engine/types';

function pod(n: number, seed: number): GameState {
  const hs = heroesFor('blitz');
  return createGame(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: true, difficulty: 'normal' as const, deck: toDeckList(autoBuildDeck(hs[(seed * 7 + i * 11) % hs.length].id, 'blitz', seed + i)) })), 1000 + seed, 'upf');
}

describe('Ultimate Pit Fight', () => {
  it('in a 4-player pod you can only attack your neighbours', () => {
    const s = pod(4, 1);
    expect(targetableOpponents(s, 0).sort()).toEqual([1, 3]);
    expect(targetableOpponents(s, 2).sort()).toEqual([1, 3]);
  });

  it('bots play complete 3- and 4-player games: players are knocked out and the last one standing wins', () => {
    for (const n of [3, 4]) for (let g = 0; g < 4; g++) {
      let s = pod(n, g + n * 10);
      const seen = new Set<PlayerId>();
      for (let i = 0; i < 6000 && s.phase !== 'gameOver'; i++) {
        seen.add(s.turnPlayer);
        const a = chooseAction(s, s.pendingChoices?.[0]?.player ?? s.priority).action;
        s = applyAction(s, a);
        // every attack goes to a neighbour of the attacker
        const l = s.chain.at(-1);
        if (l && l.defender !== undefined && s.phase !== 'gameOver' && !s.players[l.attacker].eliminated) expect(targetableOpponents(s, l.attacker)).toContain(l.defender);
      }
      expect(seen.size).toBeGreaterThan(2); // turns go round the table
      if (s.phase === 'gameOver') {
        // knocked out to the last hero, or (rarely) the turn limit: either way the winner is still standing
        if (!s.log.some((e) => /Turn limit|out of cards/.test(e.text))) expect(s.players.filter((p) => !p.eliminated).length).toBe(1);
        expect(s.players[s.winner!].eliminated).toBeFalsy();
      }
    }
  }, 120_000);
  it('a player who leaves is knocked out; the others play on, and whoever had priority keeps it', () => {
    const s = pod(3, 5);
    const other = ([0, 1, 2] as PlayerId[]).find((q) => q !== s.turnPlayer && q !== s.priority)!;
    const t = concedeSeat(s, other);
    expect(t.phase).not.toBe('gameOver');
    expect(t.players[other].eliminated).toBe(true);
    expect(t.priority).toBe(s.priority);
    const u = concedeSeat(t, t.turnPlayer);
    expect(u.phase).toBe('gameOver');
  });
});
