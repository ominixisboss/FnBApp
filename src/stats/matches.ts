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
}

const KEY = 'fab-trainer.matches.v1';

export function loadMatches(): MatchRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function recordMatch(m: Omit<MatchRecord, 'id' | 'date'>) {
  const all = loadMatches();
  all.push({ ...m, id: Math.random().toString(36).slice(2, 10), date: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-1000))); } catch { /* storage unavailable */ }
}
