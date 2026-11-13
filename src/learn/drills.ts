// Mistake trainer: positions from your own games where the Hard bot would have played differently, saved from
// the post-game review and replayed as "what would you do?" drills.
import type { Action, GameState } from '../engine/types';

export interface Drill {
  id: string;
  created: number;
  state: GameState;
  yours: Action;
  better: Action;
  why: string;
  /** times answered right in a row; a drill is mastered after 2 */
  streak: number;
}

const KEY = 'fab-trainer.drills.v1';
const MAX = 40;

export function loadDrills(): Drill[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Drill[]; } catch { return []; }
}

function save(ds: Drill[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ds.slice(-MAX))); } catch { /* storage full: keep what we have */ }
}

/** Save a position (the log is trimmed to keep storage small). */
export function addDrill(state: GameState, yours: Action, better: Action, why: string): void {
  const slim: GameState = { ...state, log: state.log.slice(-6) };
  const ds = loadDrills();
  const id = `${state.seed}-${state.turn}-${state.log.length}`;
  if (ds.some((d) => d.id === id)) return;
  save([...ds, { id, created: Date.now(), state: slim, yours, better, why, streak: 0 }]);
}

export function updateDrill(id: string, correct: boolean): void {
  const ds = loadDrills().map((d) => (d.id === id ? { ...d, streak: correct ? d.streak + 1 : 0 } : d)).filter((d) => d.streak < 2);
  save(ds);
}

export function removeDrill(id: string): void { save(loadDrills().filter((d) => d.id !== id)); }
