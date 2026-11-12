// Ask the AI for a move without blocking the page: the work happens in a Web Worker.
// Falls back to thinking on the main thread if workers aren't available or the worker fails.
import type { Difficulty, GameState, PlayerId } from '../engine/types';
import { chooseAction } from './bot';
import type { BotDecision } from './bot';

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, { resolve: (d: BotDecision) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof document === 'undefined') return (worker = null);
    const w = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ t: 'init', url: new URL('data/cards.json', document.baseURI).href });
    w.onmessage = (e: MessageEvent<{ id: number; decision?: BotDecision; error?: string }>) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.decision) p.resolve(e.data.decision);
      else p.reject(new Error(e.data.error ?? 'bot worker failed'));
    };
    w.onerror = () => {
      worker = null; // stop using it; pending requests fall back below
      for (const p of waiting.values()) p.reject(new Error('bot worker crashed'));
      waiting.clear();
    };
    return (worker = w);
  } catch {
    return (worker = null);
  }
}

export function askBot(state: GameState, pid: PlayerId, difficulty?: Difficulty): Promise<BotDecision> {
  const w = getWorker();
  if (!w) return Promise.resolve(chooseAction(state, pid, difficulty));
  const id = ++seq;
  const asked = new Promise<BotDecision>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ t: 'ask', id, state, pid, difficulty });
    // never leave a game stuck: if the worker hasn't answered in time, think here instead
    setTimeout(() => { if (waiting.delete(id)) reject(new Error('bot worker timed out')); }, 10_000);
  });
  return asked.catch(() => chooseAction(state, pid, difficulty));
}
