// Accounts & cloud sync (client side). Works fully offline when no server is reachable.
import { useSyncExternalStore } from 'react';
import type { Deck } from '../deck/deck';
import { loadDecks, saveDecksLocal } from '../deck/deck';
import { loadMatches, saveMatchesLocal } from '../stats/matches';
import type { MatchRecord } from '../stats/matches';
import type { Profile } from '../stats/profile';
import { loadProfile, saveProfile } from '../stats/profile';

export interface User { id: number; username: string; createdAt: number }

interface AuthState {
  serverUrl: string;          // '' = same origin
  available: boolean | null;  // null = still checking
  ephemeral: boolean;         // server keeps no data between restarts (free hosting)
  user: User | null;
  token: string | null;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
}

const K = { token: 'fab-trainer.token', user: 'fab-trainer.user', server: 'fab-trainer.server', deleted: 'fab-trainer.deletedDecks' };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

let state: AuthState = {
  serverUrl: read(K.server) ?? (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  available: null,
  ephemeral: false,
  user: (() => { try { return JSON.parse(read(K.user) ?? 'null'); } catch { return null; } })(),
  token: read(K.token),
  syncing: false,
  lastSync: null,
  error: null,
};
const subs = new Set<() => void>();
const set = (patch: Partial<AuthState>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };

export const apiBase = () => state.serverUrl.replace(/\/$/, '');
export const wsUrl = () => {
  const base = apiBase() || location.origin;
  return `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(state.token ?? '')}`;
};
export const authToken = () => state.token;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !path.startsWith('/api/login')) signOut();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function checkServer(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${apiBase()}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    const body = res.ok ? await res.json() : null;
    const ok = body?.ok === true;
    set({ available: ok, ephemeral: !!body?.ephemeral });
    if (ok && state.token) void syncAll();
    return ok;
  } catch {
    set({ available: false });
    return false;
  }
}

export function setServerUrl(url: string) {
  write(K.server, url.trim() || null);
  set({ serverUrl: url.trim(), available: null });
  void checkServer();
}

async function authenticate(kind: 'login' | 'register', username: string, password: string) {
  set({ error: null });
  const r = await call<{ token: string; user: User }>(`/api/${kind}`, { method: 'POST', body: JSON.stringify({ username, password }) });
  write(K.token, r.token);
  write(K.user, JSON.stringify(r.user));
  set({ token: r.token, user: r.user });
  await syncAll(kind === 'register');
}
export const signIn = (u: string, p: string) => authenticate('login', u, p);
export const register = (u: string, p: string) => authenticate('register', u, p);

export function signOut() {
  write(K.token, null);
  write(K.user, null);
  set({ token: null, user: null });
}

// ---------------------------------------------------------------- sync

const deletedIds = (): string[] => { try { return JSON.parse(read(K.deleted) ?? '[]'); } catch { return []; } };

/** Merge local and server data (newest wins), then push the result. */
export async function syncAll(fresh = false) {
  if (!state.token || state.syncing) return;
  set({ syncing: true, error: null });
  try {
    // profile: server copy wins unless this is a brand-new account
    const me = await call<{ profile: Profile | null }>('/api/me');
    if (me.profile && !fresh) saveProfile(me.profile, false);
    else {
      const local = loadProfile();
      // a brand-new account starts with its username as the display name
      const p = local.displayName === 'Player' && state.user ? { ...local, displayName: state.user.username } : local;
      saveProfile(p, false);
      await call('/api/profile', { method: 'PUT', body: JSON.stringify(p) });
    }
    // decks
    const remote = await call<{ decks: Deck[] }>('/api/decks');
    const byId = new Map<string, Deck>();
    const deleted = new Set(deletedIds());
    for (const d of [...remote.decks, ...loadDecks()]) {
      if (deleted.has(d.id)) continue;
      const cur = byId.get(d.id);
      if (!cur || d.updatedAt > cur.updatedAt) byId.set(d.id, d);
    }
    const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const pushed = await call<{ decks: Deck[] }>('/api/decks', { method: 'PUT', body: JSON.stringify({ decks: merged, deleted: [...deleted] }) });
    write(K.deleted, '[]');
    saveDecksLocal(pushed.decks);
    // matches
    await call('/api/matches', { method: 'POST', body: JSON.stringify({ matches: loadMatches().filter((m) => m.mode !== 'online') }) });
    const rm = await call<{ matches: MatchRecord[] }>('/api/matches');
    const all = new Map(loadMatches().map((m) => [m.id, m]));
    rm.matches.forEach((m) => all.set(m.id, m));
    saveMatchesLocal([...all.values()].sort((a, b) => a.date - b.date));
    set({ lastSync: Date.now() });
    window.dispatchEvent(new Event('fab-synced'));
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ syncing: false });
  }
}

let deckTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDeckPush() {
  if (!state.token || !state.available) return;
  if (deckTimer) clearTimeout(deckTimer);
  deckTimer = setTimeout(async () => {
    try {
      await call('/api/decks', { method: 'PUT', body: JSON.stringify({ decks: loadDecks(), deleted: deletedIds() }) });
      write(K.deleted, '[]');
      set({ lastSync: Date.now() });
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  }, 800);
}

// react to local changes made elsewhere in the app
if (typeof window !== 'undefined') {
  window.addEventListener('fab-decks', ((e: CustomEvent<{ removed: string[] }>) => {
    if (e.detail?.removed?.length) write(K.deleted, JSON.stringify([...new Set([...deletedIds(), ...e.detail.removed])]));
    scheduleDeckPush();
  }) as EventListener);
  window.addEventListener('fab-match', ((e: CustomEvent<MatchRecord>) => {
    if (state.token && state.available && e.detail.mode !== 'online') {
      call('/api/matches', { method: 'POST', body: JSON.stringify({ matches: [e.detail] }) }).catch(() => {});
    }
  }) as EventListener);
}

export function pushProfile(p: Profile) {
  if (!state.token || !state.available) return;
  call('/api/profile', { method: 'PUT', body: JSON.stringify(p) }).catch(() => {});
}

export interface LeaderRow { name: string; username: string; avatarHeroId: string | null; wins: number; games: number }
export const leaderboard = () => call<LeaderRow[]>('/api/leaderboard');
export interface LadderRow { name: string; username: string; avatarHeroId: string | null; rating: number; games: number; tier: string }
export const ladder = (format?: string, season?: string) =>
  call<LadderRow[]>(`/api/ladder${format ? `?format=${encodeURIComponent(format)}${season ? `&season=${encodeURIComponent(season)}` : ''}` : ''}`);
export interface SeasonRow { season: string; format: string; rating: number; games: number; peak: number; tier: string; peakTier: string }
export interface SeasonInfo { id: string; ends: number }
export const mySeasons = async () => {
  const r = await call<{ seasons?: SeasonRow[]; season?: SeasonInfo }>('/api/me');
  return { seasons: r.seasons ?? [], season: r.season ?? null };
};
export interface MyRating { rating: number; games: number; tier: string }
export const myRating = async () => (await call<{ rating: MyRating | null }>('/api/me')).rating;
export interface FriendRow { username: string; name: string; avatarHeroId: string | null; status: 'offline' | 'online' | 'in-game' }
export const friends = {
  list: () => call<FriendRow[]>('/api/friends'),
  add: (username: string) => call('/api/friends', { method: 'POST', body: JSON.stringify({ username }) }),
  remove: (username: string) => call(`/api/friends?username=${encodeURIComponent(username)}`, { method: 'DELETE' }),
};
export interface ServerReplay { matchId: string; date: number; format: string; ranked: boolean; users: number[]; names: string[]; initial: import('../engine/types').GameState; actions: { a: import('../engine/types').Action; by?: 0 | 1 }[] }
export interface FriendCup { id: string; name: string; format: string; owner: number; created: number; players: { id: number; username: string; name: string }[]; games: { a: number; b: number; winner?: number; matchId?: string }[];
  /** Pit Fight cup: one table of all the players per round; points by finishing place */
  pit?: { rounds: number; results: { order: number[]; matchId: string }[] } }
export const cups = {
  list: () => call<FriendCup[]>('/api/tournaments'),
  create: (name: string, format: string, usernames: string[]) => call<FriendCup>('/api/tournaments', { method: 'POST', body: JSON.stringify({ name, format, usernames }) }),
  result: (id: string, a: number, b: number, winner: number | null) => call<FriendCup>('/api/tournaments/result', { method: 'POST', body: JSON.stringify({ id, a, b, winner }) }),
};
export const fetchReplay = (matchId: string) => call<ServerReplay>(`/api/replay?match=${encodeURIComponent(matchId)}`);

export function useAuth() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
  return { ...s, signIn, register, signOut, syncAll, pushProfile, setServerUrl, checkServer };
}

// ---------------------------------------------------------------- push notifications (web / installed web app)

export const pushApi = {
  key: () => call<{ key: string | null }>('/api/push/key'),
  subscribe: (subscription: PushSubscriptionJSON) => call<{ ok: boolean }>('/api/push', { method: 'POST', body: JSON.stringify({ subscription }) }),
  unsubscribe: (endpoint: string) => call<{ ok: boolean }>('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};

