// Local match history. Groundwork for the future stats board / player profile:
// every finished game vs the AI is recorded here (browser storage only for now).
export interface MatchRecord {
  id: string;
  date: number;
  format: string;
  myHeroId: string;
  oppHeroId: string;
  deckId: string | null;
  deckName: string;
  difficulty: string;
  won: boolean;
  turns: number;
  lifeLeft: number;
  oppLifeLeft: number;
  mode?: 'ai' | 'online';
  opponentName?: string;
}

export interface StatLine { key: string; games: number; wins: number }

export function summarize(matches: MatchRecord[]) {
  const sorted = [...matches].sort((a, b) => a.date - b.date);
  let streak = 0;
  let best = 0;
  let run = 0;
  for (const m of sorted) {
    run = m.won ? run + 1 : 0;
    best = Math.max(best, run);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const w = sorted[i].won;
    if (i === sorted.length - 1) streak = w ? 1 : -1;
    else if (w === sorted[sorted.length - 1].won) streak += w ? 1 : -1;
    else break;
  }
  const group = (f: (m: MatchRecord) => string): StatLine[] => {
    const map = new Map<string, StatLine>();
    for (const m of matches) {
      const k = f(m);
      const l = map.get(k) ?? { key: k, games: 0, wins: 0 };
      l.games++;
      if (m.won) l.wins++;
      map.set(k, l);
    }
    return [...map.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
  };
  const wins = matches.filter((m) => m.won).length;
  return {
    games: matches.length,
    wins,
    losses: matches.length - wins,
    winRate: matches.length ? wins / matches.length : 0,
    streak,
    bestStreak: best,
    avgTurns: matches.length ? matches.reduce((a, m) => a + m.turns, 0) / matches.length : 0,
    byHero: group((m) => m.myHeroId),
    byOpponent: group((m) => m.oppHeroId),
    byDifficulty: group((m) => (m.mode === 'online' ? 'online' : m.difficulty)),
    byFormat: group((m) => m.format),
    recent: sorted.slice(-20).reverse(),
  };
}

const KEY = 'fab-trainer.matches.v1';

export function loadMatches(): MatchRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function saveMatchesLocal(all: MatchRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-1000))); } catch { /* storage unavailable */ }
}

export function recordMatch(m: Omit<MatchRecord, 'id' | 'date'> & { id?: string }) {
  const all = loadMatches();
  const rec: MatchRecord = { ...m, id: m.id ?? Math.random().toString(36).slice(2, 10), date: Date.now() };
  if (all.some((x) => x.id === rec.id)) return;
  all.push(rec);
  saveMatchesLocal(all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fab-match', { detail: rec }));
}
