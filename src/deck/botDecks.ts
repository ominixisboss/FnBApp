// Decks the bots play: Blitz lists tuned by self-play (scripts/tune-decks.mts), falling back to the
// auto-builder for heroes and formats without one.
import type { DeckList } from '../engine/game';
import { autoBuildDeck, toDeckList } from './deck';
import type { DeckFormat } from './deck';

type Tuned = Record<string, { cards: Record<string, number>; winRate: number; baseline: number }>;
let tuned: Tuned | null = null;
let loading: Promise<void> | null = null;

/** Load the tuned lists (once). Safe to call anywhere; bots fall back to auto-built decks until it finishes. */
export function loadBotDecks(): Promise<void> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/bot-decks.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Tuned) => { tuned = j; }, () => { tuned = {}; });
  }
  return loading;
}

export function setBotDecks(t: Tuned) { tuned = t; }

/** Is there a self-play tuned list for this hero? */
export function hasTunedDeck(heroId: string): boolean { return !!tuned?.[heroId]; }

/** The deck a bot plays with this hero in this format. */
export function botDeck(heroId: string, format: DeckFormat, seed: number): DeckList {
  const t = format === 'blitz' ? tuned?.[heroId] : undefined;
  if (t) return toDeckList({ ...autoBuildDeck(heroId, 'blitz', seed), cards: t.cards });
  return toDeckList(autoBuildDeck(heroId, format, seed));
}
