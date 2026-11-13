// Tunes a Blitz deck for every hero by self-play: starting from the auto-built list, it repeatedly swaps one
// card for another legal card and keeps the swap only if the deck then wins more games (Hard bot vs Hard bot)
// against a fixed field of other heroes' decks. Writes public/data/bot-decks.json, which the bots use.
//
//   npx tsx scripts/tune-decks.mts [iterations=24] [gamesPerEval=16] [shard=0/1]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { makeDb, setDb } from '../src/data/cardDb';

const json = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
setDb(makeDb(json.cards, json.builtAt));
const { simulateGame } = await import('../src/ai/simulate');
const { autoBuildDeck, heroesFor, mainDeckPool, toDeckList } = await import('../src/deck/deck');
type Deck = ReturnType<typeof autoBuildDeck>;

const iterations = Number(process.argv[2] ?? 24);
const games = Number(process.argv[3] ?? 16);
const [shard, shards] = (process.argv[4] ?? '0/1').split('/').map(Number);
const out = new URL(`../public/data/bot-decks${shards > 1 ? `.${shard}` : ''}.json`, import.meta.url);

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const heroes = heroesFor('blitz');
// the field: auto-built decks of a spread of other heroes
const field = heroes.filter((_, i) => i % Math.max(1, Math.floor(heroes.length / 8)) === 0).slice(0, 8).map((h, i) => toDeckList(autoBuildDeck(h.id, 'blitz', 100 + i)));

function winRate(d: Deck, seedBase = 9000): number {
  const me = toDeckList(d);
  let w = 0;
  for (let g = 0; g < games; g++) {
    const opp = field[g % field.length];
    const seat = g % 2;
    const winner = seat === 0 ? simulateGame(me, opp, 'hard', 'hard', seedBase + g, 'blitz') : simulateGame(opp, me, 'hard', 'hard', seedBase + g, 'blitz');
    if (winner === seat) w++;
  }
  return w / games;
}

const result: Record<string, { cards: Record<string, number>; winRate: number; baseline: number }> = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
for (let hi = 0; hi < heroes.length; hi++) {
  if (hi % shards !== shard) continue;
  const hero = heroes[hi];
  if (result[hero.id]) continue;
  const pool = mainDeckPool(hero.id, 'blitz').slice(0, 80);
  let deck = autoBuildDeck(hero.id, 'blitz', 1);
  const baseline = winRate(deck);
  let best = baseline;
  for (let it = 0; it < iterations; it++) {
    const mains = Object.keys(deck.cards).filter((id) => pool.some((c) => c.id === id));
    if (!mains.length) break;
    const out = mains[Math.floor(rnd() * mains.length)];
    const outCard = pool.find((c) => c.id === out)!;
    // swap for a card with the same pitch so the deck's resource balance stays similar
    const options = pool.filter((c) => !deck.cards[c.id] && c.pitch === outCard.pitch);
    if (!options.length) continue;
    const inn = options[Math.floor(rnd() * Math.min(options.length, 30))];
    const trial: Deck = { ...deck, cards: { ...deck.cards } };
    trial.cards[inn.id] = trial.cards[out];
    delete trial.cards[out];
    const wr = winRate(trial);
    if (wr >= best + 1 / games) { best = wr; deck = trial; }
  }
  // check on games the tuning never saw; keep the tuned list only if it still does better
  const start = autoBuildDeck(hero.id, 'blitz', 1);
  const vBase = winRate(start, 50000), vTuned = winRate(deck, 50000);
  const keep = vTuned > vBase;
  result[hero.id] = { cards: (keep ? deck : start).cards, winRate: Math.round((keep ? vTuned : vBase) * 100) / 100, baseline: Math.round(vBase * 100) / 100 };
  writeFileSync(out, JSON.stringify(result));
  console.log(`${hero.name}: fresh games ${Math.round(vBase * 100)}% → ${Math.round(vTuned * 100)}%${keep ? '' : ' (kept the original)'}`);
}
