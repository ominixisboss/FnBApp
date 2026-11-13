import { describe, expect, it } from 'vitest';
import './setup';
import { heroesFor } from '../deck/deck';
import { CAMPAIGNS } from '../learn/campaigns';

describe('campaigns', () => {
  it('every hero and opponent in every campaign is a Blitz hero in the card database', () => {
    const hs = heroesFor('blitz');
    const found = (name: string) => hs.some((h) => h.name === name || h.name.startsWith(name + ',') || h.name.startsWith(name));
    for (const c of CAMPAIGNS) {
      expect(found(c.hero), c.hero).toBe(true);
      for (const ch of c.chapters) expect(found(ch.opponent), `${c.id}: ${ch.opponent}`).toBe(true);
    }
  });
  it('chapters have unique ids and end on a Mythic battle', () => {
    const ids = CAMPAIGNS.flatMap((c) => c.chapters.map((ch) => ch.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAMPAIGNS) expect(c.chapters.at(-1)!.difficulty).toBe('mythic');
  });
});
