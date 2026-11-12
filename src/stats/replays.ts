// Replays of games against the AI, kept in the browser (the starting position plus every action, ~20 kB each).
// Online games are replayed from the server instead.
import type { Action, GameState } from '../engine/types';

export interface LocalReplay { initial: GameState; actions: Action[] }
const KEY = 'fab-trainer.replays.v1';
const MAX = 15;

function all(): Record<string, LocalReplay> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function saveLocalReplay(id: string, r: LocalReplay) {
  const map = all();
  map[id] = r;
  const ids = Object.keys(map);
  for (let keep = Math.min(MAX, ids.length); keep > 0; keep--) {
    const kept = Object.fromEntries(Object.keys(map).slice(-keep).map((k) => [k, map[k]]));
    try { localStorage.setItem(KEY, JSON.stringify(kept)); return; } catch { /* storage full: keep fewer */ }
  }
}
export const loadLocalReplay = (id: string): LocalReplay | undefined => all()[id];
export const localReplayIds = () => new Set(Object.keys(all()));
