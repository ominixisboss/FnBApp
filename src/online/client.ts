// WebSocket client for online games. A single connection, shared by the UI through a tiny store.
import { useSyncExternalStore } from 'react';
import type { DeckList } from '../engine/game';
import type { Action, GameState } from '../engine/types';
import type { DeckFormat } from '../deck/deck';
import { wsUrl } from '../ui/auth';

export interface OnlineState {
  status: 'offline' | 'connecting' | 'idle' | 'waiting' | 'playing';
  code: string | null;
  queue: boolean;
  format: string | null;
  game: GameState | null;
  matchId: string | null;
  opponent: { name: string; avatar: string | null; connected: boolean } | null;
  error: string | null;
}

let ws: WebSocket | null = null;
let state: OnlineState = { status: 'offline', code: null, queue: false, format: null, game: null, matchId: null, opponent: null, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<OnlineState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
let pending: object | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let wanted = false;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  wanted = true;
  set({ status: state.status === 'offline' ? 'connecting' : state.status, error: null });
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => {
    if (pending) { sock.send(JSON.stringify(pending)); pending = null; }
  };
  sock.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    switch (msg.t) {
      case 'hello': if (!msg.inGame && state.status === 'connecting') set({ status: 'idle' }); break;
      case 'waiting': set({ status: 'waiting', code: msg.code ?? null, queue: !!msg.queue, format: msg.format, error: null }); break;
      case 'state': set({ status: 'playing', game: msg.state, opponent: msg.opponent, matchId: msg.matchId, code: msg.code, error: null }); break;
      case 'opponent': if (state.opponent) set({ opponent: { ...state.opponent, connected: msg.connected } }); break;
      case 'cancelled': set({ status: 'idle', code: null, queue: false, game: null, opponent: null }); break;
      case 'error': set({ error: msg.message, status: state.status === 'connecting' ? 'idle' : state.status }); break;
    }
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    if (ev.code === 4000) { set({ status: 'offline', error: 'You opened this game somewhere else.' }); return; }
    if (wanted) {
      set({ error: state.status === 'playing' ? 'Connection lost, reconnecting…' : state.error });
      retry = setTimeout(connect, 1500);
    } else set({ status: 'offline' });
  };
}

function sendMsg(msg: object) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else { pending = msg; connect(); }
}

export const online = {
  connect,
  disconnect() {
    wanted = false;
    if (retry) clearTimeout(retry);
    ws?.close();
    set({ status: 'offline', game: null, code: null, opponent: null });
  },
  host: (deck: DeckList, format: DeckFormat) => sendMsg({ t: 'host', deck, format }),
  queue: (deck: DeckList, format: DeckFormat) => sendMsg({ t: 'queue', deck, format }),
  join: (code: string, deck: DeckList) => sendMsg({ t: 'join', code, deck }),
  cancel: () => sendMsg({ t: 'cancel' }),
  act: (action: Action) => sendMsg({ t: 'act', action }),
  leave: () => { sendMsg({ t: 'leave' }); set({ status: 'idle', game: null, opponent: null, code: null }); },
  clearError: () => set({ error: null }),
  /** after a finished game, go back to the lobby */
  done: () => set({ status: 'idle', game: null, opponent: null, code: null, matchId: null }),
};

export function useOnline(): OnlineState {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}
