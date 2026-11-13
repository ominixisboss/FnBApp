// Friend cups: private round-robin tournaments for your friend group. Every pair plays once online; results
// fill in automatically when a game between two members finishes (the organiser can also enter them by hand).
import { useEffect, useState } from 'react';
import { FORMATS, formatName } from '../../deck/deck';
import { cups, friends as friendsApi, useAuth } from '../auth';
import type { FriendCup, FriendRow } from '../auth';
import { online } from '../../online/client';

export default function CupsPage() {
  const auth = useAuth();
  const [list, setList] = useState<FriendCup[] | null>(null);
  const [friendList, setFriendList] = useState<FriendRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Friday cup');
  const [format, setFormat] = useState('blitz');
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { cups.list().then(setList, (e) => setErr(String(e.message ?? e))); friendsApi.list().then(setFriendList, () => {}); };
  useEffect(() => { if (auth.user && auth.available) load(); }, [auth.user, auth.available]);

  if (!auth.available) return <div className="panel">Friend cups need the game server. See Account → Server settings.</div>;
  if (!auth.user) return <div className="panel">Friend cups need an account. <a href="#account">Sign in or create one</a>.</div>;

  const create = async () => {
    try { await cups.create(name, format, picked); setCreating(false); setPicked([]); load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ marginBottom: '.2rem' }}>🏆 Friend cups</h1>
          <p className="muted" style={{ marginTop: 0 }}>A private round robin for your friends: everyone plays everyone once, online. Results fill in by themselves when you challenge each other from the Play page.</p>
        </div>
        <button className="primary" onClick={() => setCreating(!creating)}>+ New cup</button>
      </div>
      {err && <div className="small err">{err}</div>}
      {creating && (
        <div className="panel col" style={{ gap: '.6rem' }}>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Cup name" />
            <select value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map(([f, n]) => <option key={f} value={f}>{n}</option>)}</select>
          </div>
          <div className="small muted">{format === 'upf' ? 'Ultimate Pit Fight cup: pick 2 or 3 friends. You play 3 tables together; 1st place scores 3 points, 2nd 2, 3rd 1.' : 'Invite friends (up to 7):'}</div>
          <div className="row">
            {friendList.length === 0 && <span className="small">Add friends on your <a href="#profile">Profile</a> first.</span>}
            {friendList.map((f) => (
              <label key={f.username} className="row small"><input type="checkbox" checked={picked.includes(f.username)} disabled={!picked.includes(f.username) && picked.length >= 7} onChange={(e) => setPicked(e.target.checked ? [...picked, f.username] : picked.filter((u) => u !== f.username))} />{f.name}</label>
            ))}
          </div>
          <div><button className="primary" disabled={!picked.length || (format === 'upf' && (picked.length < 2 || picked.length > 3))} onClick={() => void create()}>Create cup</button></div>
        </div>
      )}
      {list?.length === 0 && !creating && <div className="panel">No cups yet. Create one and invite your friends.</div>}
      {list?.map((t) => {
        if (t.pit) return <PitCup key={t.id} t={t} me={auth.user!.id} />;
        const nameOf = (id: number) => t.players.find((p) => p.id === id)?.name ?? '?';
        const table = t.players.map((p) => ({ ...p, wins: t.games.filter((g) => g.winner === p.id).length, played: t.games.filter((g) => g.winner !== undefined && (g.a === p.id || g.b === p.id)).length }))
          .sort((x, y) => y.wins - x.wins || x.played - y.played);
        const done = t.games.every((g) => g.winner !== undefined);
        const isOwner = t.owner === auth.user!.id;
        return (
          <div key={t.id} className="panel cup">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{t.name} <span className="small muted">· {formatName(t.format)} · {t.players.length} players</span></h3>
              {done && <b className="ok">🏆 {table[0].name} wins!</b>}
            </div>
            <div className="cup-grid">
              <table className="history">
                <thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Played</th></tr></thead>
                <tbody>{table.map((p, i) => <tr key={p.id} className={p.id === auth.user!.id ? 'me-row' : ''}><td>{i + 1}</td><td>{p.name}</td><td><b>{p.wins}</b></td><td>{p.played}/{t.players.length - 1}</td></tr>)}</tbody>
              </table>
              <div className="col" style={{ gap: '.25rem' }}>
                {t.games.map((g) => {
                  const mine = g.a === auth.user!.id || g.b === auth.user!.id;
                  return (
                    <div key={`${g.a}-${g.b}`} className={`pairing ${mine && g.winner === undefined ? 'mine' : ''}`}>
                      <span className={g.winner === g.a ? 'ok' : ''}>{nameOf(g.a)}</span><span className="muted">vs</span><span className={g.winner === g.b ? 'ok' : ''}>{nameOf(g.b)}</span>
                      {g.winner !== undefined && g.matchId && <a className="small" href={`#replay/${g.matchId}`}>▶ Replay</a>}
                      {g.winner === undefined && mine && <a className="small btn-link" href="#play/online" onClick={() => online.connect()}>Challenge</a>}
                      {isOwner && g.winner === undefined && (
                        <select className="small" value="" onChange={(e) => { void cups.result(t.id, g.a, g.b, Number(e.target.value)).then(load); }}>
                          <option value="">Enter result…</option><option value={g.a}>{nameOf(g.a)} won</option><option value={g.b}>{nameOf(g.b)} won</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A Pit Fight cup: points by finishing place over a few tables with all the players. */
function PitCup({ t, me }: { t: FriendCup; me: number }) {
  const pit = t.pit!;
  const points = (id: number) => pit.results.reduce((a, r) => { const i = r.order.indexOf(id); return a + (i < 0 ? 0 : Math.max(0, t.players.length - 1 - i)); }, 0);
  const table = [...t.players].map((p) => ({ ...p, pts: points(p.id), wins: pit.results.filter((r) => r.order[0] === p.id).length })).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  const done = pit.results.length >= pit.rounds;
  const nameOf = (id: number) => t.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="panel cup">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{t.name} <span className="small muted">· Ultimate Pit Fight · {t.players.length} players · table {Math.min(pit.results.length + 1, pit.rounds)} of {pit.rounds}</span></h3>
        {done && <b className="ok">🏆 {table[0].name} wins!</b>}
      </div>
      <div className="cup-grid">
        <table className="history">
          <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Tables won</th></tr></thead>
          <tbody>{table.map((p, i) => <tr key={p.id} className={p.id === me ? 'me-row' : ''}><td>{i + 1}</td><td>{p.name}</td><td><b>{p.pts}</b></td><td>{p.wins}</td></tr>)}</tbody>
        </table>
        <div className="col" style={{ gap: '.25rem' }}>
          {pit.results.map((r, i) => (
            <div key={r.matchId} className="pairing"><span className="muted">Table {i + 1}:</span><span>{r.order.map(nameOf).join(' › ')}</span><a className="small" href={`#replay/${r.matchId}`}>▶ Replay</a></div>
          ))}
          {!done && <div className="small muted">Play the next table: one of you creates a Pit Fight room on the Play page (Online) and invites the others. The result fills in when exactly this cup's players finish a game.</div>}
          {!done && <a className="small btn-link" href="#play/online" onClick={() => online.connect()}>Go to online play</a>}
        </div>
      </div>
    </div>
  );
}
