// Training positions: short guided puzzles that show one newer mechanic each (tapping, allies, abilities on
// the attacking card, "counts as a Runechant"). Unlike the lethal puzzles they're meant to be easy.
import type { PuzzleDef } from './puzzleEngine';

export const TRAINING: PuzzleDef[] = [
  {
    id: 't1', title: 'Allies attack', text: '',
    guide: 'Your allies can attack. Tap Limpit (pay 1 – it has go again), then tap Barnacle. Each ally taps when it attacks.',
    me: { hero: 'Fq9Cg9pKGFKrTbfHq9mBb', hand: ['nGQcDzcjQ8gw8HGzwCGnF'], permanents: ['cw7GLPjtPFqMHJthzJCbw', 'bmQzdmzHNfjGj6Qtf9cbJ'] },
    opp: { hero: 'Dz6FcRBNMFdBt9fJPMB7d', life: 6, hand: [] },
  },
  {
    id: 't2', title: 'The attacking card\u2019s ability', text: '',
    guide: 'Play Cloud Skiff. While it\u2019s the attack on the combat chain, tap it to use its ability: tap your Copper Cog for +1 power (choose +1 power, not go again).',
    me: { hero: 'z7bLz9hhPDcwmTdQGf6TK', hand: ['mbNRPd7D9TN76C8wbBRrL', 'nGQcDzcjQ8gw8HGzwCGnF'], permanents: ['kzBc7Bmrk7TfHNwhQK6Lj'] },
    opp: { hero: 'Dz6FcRBNMFdBt9fJPMB7d', life: 6, hand: [] },
  },
  {
    id: 't3', title: 'It counts as a Runechant', text: '',
    guide: 'Runechant of Pride counts as a Runechant. Attack with Wounding Blow: the Runechant deals 1 arcane damage, and its usurp bonus gives the attack +1 power.',
    me: { hero: 'TKbRWjjBLJThMmLkTFb6q', hand: ['rLN8wNfkTtF9zBg8zwGzW'], permanents: ['HqGFdH8tMH6fR8bNMkTjq'] },
    opp: { hero: 'Dz6FcRBNMFdBt9fJPMB7d', life: 6, hand: [] },
  },
  {
    id: 't4', title: 'Watery grave payoffs', text: '',
    guide: 'Angry Bones lets you discard a card as it attacks; if that card has watery grave, it gets +1 power. Pitch Wounding Blow to pay, then discard Beneath the Surface (it has watery grave).',
    me: { hero: 'Fq9Cg9pKGFKrTbfHq9mBb', hand: ['jGn7mnKcjTLRfgQH9kChJ', 'nGQcDzcjQ8gw8HGzwCGnF', 'h9LPFJG86fdMPQmqwWNQw'] },
    opp: { hero: 'Dz6FcRBNMFdBt9fJPMB7d', life: 6, hand: [] },
  },
  {
    id: 't5', title: 'Another way to pay', text: '',
    guide: 'You can\u2019t pitch enough for Moon Wish, but it lets you put a card from your hand on top of your deck instead of paying its cost. Tap Moon Wish and choose that option.',
    me: { hero: 'RHnFkKb8FKdFzp9rdzGjF', hand: ['mhLrKM6RbWGGHNrTGjtMw', 'rLN8wNfkTtF9zBg8zwGzW'] },
    opp: { hero: 'Dz6FcRBNMFdBt9fJPMB7d', life: 5, hand: [] },
  },
];
