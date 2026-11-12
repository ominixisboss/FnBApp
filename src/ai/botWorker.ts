// Runs the AI (bot moves and hints) off the main thread, so animations never stall while it thinks.
import { makeDb, setDb } from '../data/cardDb';
import type { Card } from '../data/types';
import type { Difficulty, GameState, PlayerId } from '../engine/types';
import { chooseAction } from './bot';

type Msg = { t: 'init'; url: string } | { t: 'ask'; id: number; state: GameState; pid: PlayerId; difficulty?: Difficulty };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage: (m: unknown) => void };
let ready: Promise<void> = Promise.reject(new Error('card database not sent'));
ready.catch(() => {});

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'init') {
    ready = fetch(m.url)
      .then((r) => r.json())
      .then((j: { cards: Card[]; builtAt: string }) => setDb(makeDb(j.cards, j.builtAt)));
    ready.catch(() => {});
    return;
  }
  try {
    await ready;
    ctx.postMessage({ id: m.id, decision: chooseAction(m.state, m.pid, m.difficulty) });
  } catch (err) {
    ctx.postMessage({ id: m.id, error: String(err) });
  }
};
