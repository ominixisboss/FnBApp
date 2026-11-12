// Watch a finished game again, step by step. AI games are stored in the browser, online games on the server.
import { useEffect, useMemo, useState } from 'react';
import { applyAction } from '../../engine/game';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { viewFor } from '../../online/view';
import { loadLocalReplay } from '../../stats/replays';
import { fetchReplay, useAuth } from '../auth';
import GameBoard from '../components/GameBoard';

interface Loaded { initial: GameState; steps: { a: Action; by?: PlayerId }[]; viewer: PlayerId; title: string }

export default function ReplayPage({ id }: { id?: string }) {
  const auth = useAuth();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const local = loadLocalReplay(id);
    if (local) { setData({ initial: local.initial, steps: local.actions.map((a) => ({ a })), viewer: 0, title: 'Replay' }); return; }
    if (!id.startsWith('online-')) { setError('This replay is no longer stored on this device.'); return; }
    fetchReplay(id).then((r) => {
      const viewer = (Math.max(0, r.users.indexOf(auth.user?.id ?? -1)) as PlayerId);
      setData({ initial: r.initial, steps: r.actions, viewer, title: `${r.names[0]} vs ${r.names[1]}${r.ranked ? ' · ranked' : ''}` });
    }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, auth.user?.id]);

  // every position of the game (bots switched off so the board just shows them)
  const states = useMemo(() => {
    if (!data) return [];
    const quiet = (s: GameState): GameState => ({ ...s, players: s.players.map((p) => ({ ...p, isBot: false })) as GameState['players'] });
    const out: GameState[] = [data.initial];
    let s = data.initial;
    for (const st of data.steps) {
      try { s = st.by !== undefined ? applyAction({ ...s, priority: st.by }, st.a) : applyAction(s, st.a); } catch { break; }
      out.push(s);
    }
    return out.map((x) => quiet(data.viewer === 1 ? viewFor(x, 1) : x));
  }, [data]);

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing || i >= states.length - 1) return;
    const t = setTimeout(() => setI((n) => Math.min(states.length - 1, n + 1)), 900 / speed);
    return () => clearTimeout(t);
  }, [playing, i, states.length, speed]);

  if (error) return <div className="panel">{error} <a href="#profile">Back to your profile</a></div>;
  if (!data || !states.length) return <p className="muted">Loading the replay…</p>;
  const cur = states[Math.min(i, states.length - 1)];
  return (
    <>
      <GameBoard key={id} initial={states[0]} tutorial={false} onExit={() => { location.hash = 'profile'; }}
        online={{ state: cur, send: () => {}, opponent: null, error: null }} />
      <div className="replay-shield" />
      <div className="replay-bar">
        <span className="small"><b>▶ {data.title}</b> · turn {cur.turn} · step {i} / {states.length - 1}</span>
        <div className="row" style={{ gap: '.3rem' }}>
          <button onClick={() => { setI(0); setPlaying(false); }} title="Start">⏮</button>
          <button onClick={() => { setI((n) => Math.max(0, n - 1)); setPlaying(false); }} title="Back">◀</button>
          <button className="primary" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
          <button onClick={() => { setI((n) => Math.min(states.length - 1, n + 1)); setPlaying(false); }} title="Forward">▶▶</button>
          <button onClick={() => { setI(states.length - 1); setPlaying(false); }} title="End">⏭</button>
          <button className="small" onClick={() => setSpeed(speed >= 4 ? 1 : speed * 2)}>{speed}×</button>
          <a className="btn-link small" href="#profile">Close</a>
        </div>
        <input type="range" min={0} max={states.length - 1} value={i} onChange={(e) => { setI(Number(e.target.value)); setPlaying(false); }} />
      </div>
    </>
  );
}
