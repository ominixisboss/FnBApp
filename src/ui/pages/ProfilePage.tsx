import { useEffect, useMemo, useState } from 'react';
import { getDb } from '../../data/cardDb';
import { loadMatches, summarize } from '../../stats/matches';
import type { StatLine } from '../../stats/matches';
import { loadProfile, saveProfile } from '../../stats/profile';
import { HeroPicker } from './DecksPage';
import { leaderboard, useAuth } from '../auth';
import type { LeaderRow } from '../auth';

const heroName = (id: string) => getDb().byId.get(id)?.name ?? 'Unknown hero';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const FORMAT: Record<string, string> = { blitz: 'Blitz', cc: 'Classic Constructed', casual: 'Casual' };
const DIFF: Record<string, string> = { easy: 'Easy bot', normal: 'Normal bot', hard: 'Hard bot', online: 'Online players' };

export function Avatar({ heroId, size = 64 }: { heroId: string | null; size?: number }) {
  const hero = heroId ? getDb().byId.get(heroId) : undefined;
  return (
    <div className="avatar" style={{ width: size, height: size, backgroundImage: hero?.image ? `url(${hero.image})` : undefined }}>
      {!hero && <span>?</span>}
    </div>
  );
}

/** Single-series horizontal bars: one hue, values labelled, full numbers in the table beside. */
function WinRateBars({ lines, label }: { lines: StatLine[]; label: (k: string) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!lines.length) return <p className="muted small">No games yet.</p>;
  return (
    <div className="bars" role="table" aria-label="Win rate">
      {lines.slice(0, 10).map((l) => {
        const rate = l.games ? l.wins / l.games : 0;
        return (
          <div key={l.key} className="bar-row" role="row" onMouseEnter={() => setHover(l.key)} onMouseLeave={() => setHover(null)}>
            <span className="bar-label" role="cell">{label(l.key)}</span>
            <span className="bar-track" role="cell">
              <span className="bar-fill" style={{ width: `${Math.max(rate * 100, 1.5)}%` }} />
              {hover === l.key && (
                <span className="bar-tip" role="tooltip">{label(l.key)} · {l.wins}W {l.games - l.wins}L · {pct(rate)}</span>
              )}
            </span>
            <span className="bar-value" role="cell">{pct(rate)}</span>
            <span className="bar-games muted" role="cell">{l.wins}–{l.games - l.wins}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState(loadProfile);
  const [picking, setPicking] = useState(false);
  const auth = useAuth();
  const [tick, setTick] = useState(0);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    const on = () => { setTick((t) => t + 1); setProfile(loadProfile()); };
    window.addEventListener('fab-synced', on);
    return () => window.removeEventListener('fab-synced', on);
  }, []);
  useEffect(() => { if (auth.available) leaderboard().then(setBoard, () => setBoard(null)); }, [auth.available]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => loadMatches(), [tick]);
  const st = useMemo(() => summarize(matches), [matches]);
  const update = (p: typeof profile) => { setProfile(p); saveProfile(p); auth.pushProfile(p); };

  return (
    <div className="col profile" style={{ gap: '1.2rem' }}>
      <div className="profile-head panel">
        <button className="avatar-btn" onClick={() => setPicking(true)} title="Change avatar"><Avatar heroId={profile.avatarHeroId} size={96} /></button>
        <div className="col grow" style={{ gap: '.3rem' }}>
          <input className="name-input" value={profile.displayName} maxLength={24} onChange={(e) => update({ ...profile, displayName: e.target.value })} aria-label="Display name" />
          <div className="muted small">
            {auth.user ? <>Signed in as <b>{auth.user.username}</b>. Your profile, decks and stats sync to the server.</> : <>Playing offline. <a href="#account">Sign in</a> to sync across devices and play online.</>}
          </div>
          <div className="small muted">Playing since {new Date(profile.createdAt).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="tiles stat-tiles">
        <div className="panel stat-tile"><small>Games</small><b>{st.games}</b></div>
        <div className="panel stat-tile"><small>Record</small><b>{st.wins}–{st.losses}</b></div>
        <div className="panel stat-tile"><small>Win rate</small><b>{st.games ? pct(st.winRate) : '–'}</b></div>
        <div className="panel stat-tile"><small>Current streak</small><b>{st.streak > 0 ? `${st.streak}W` : st.streak < 0 ? `${-st.streak}L` : '–'}</b></div>
        <div className="panel stat-tile"><small>Best win streak</small><b>{st.bestStreak}</b></div>
        <div className="panel stat-tile"><small>Avg. game length</small><b>{st.games ? `${st.avgTurns.toFixed(1)} turns` : '–'}</b></div>
      </div>

      {st.games === 0 && <div className="panel">No games recorded yet. <a href="#play">Play a game</a> and your stats will appear here.</div>}

      {st.games > 0 && (
        <>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Recent form</h3>
            <div className="form-row" aria-label="Most recent games, newest first">
              {st.recent.map((m) => (
                <span key={m.id} className={`form-pip ${m.won ? 'w' : 'l'}`} title={`${m.won ? 'Win' : 'Loss'} · ${heroName(m.myHeroId)} vs ${heroName(m.oppHeroId)} · ${new Date(m.date).toLocaleString()}`}>{m.won ? 'W' : 'L'}</span>
              ))}
            </div>
          </div>
          <div className="profile-grid">
            <div className="panel"><h3 style={{ marginTop: 0 }}>Win rate by your hero</h3><WinRateBars lines={st.byHero} label={heroName} /></div>
            <div className="panel"><h3 style={{ marginTop: 0 }}>Win rate vs opponent hero</h3><WinRateBars lines={st.byOpponent} label={heroName} /></div>
            <div className="panel"><h3 style={{ marginTop: 0 }}>By opponent type</h3><WinRateBars lines={st.byDifficulty} label={(k) => DIFF[k] ?? k} /></div>
            <div className="panel"><h3 style={{ marginTop: 0 }}>By format</h3><WinRateBars lines={st.byFormat} label={(k) => FORMAT[k] ?? k} /></div>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Match history</h3>
            <table className="history">
              <thead><tr><th>Date</th><th>Result</th><th>Your hero</th><th>Opponent</th><th>Mode</th><th>Turns</th><th>Life left</th></tr></thead>
              <tbody>
                {st.recent.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.date).toLocaleDateString()}</td>
                    <td className={m.won ? 'ok' : 'err'}>{m.won ? 'Win' : 'Loss'}</td>
                    <td>{heroName(m.myHeroId)}</td>
                    <td>{m.opponentName ? `${m.opponentName} (${heroName(m.oppHeroId)})` : heroName(m.oppHeroId)}</td>
                    <td>{m.mode === 'online' ? 'Online' : `${m.difficulty} bot`} · {FORMAT[m.format] ?? m.format}</td>
                    <td>{m.turns}</td>
                    <td>{Math.max(0, m.lifeLeft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {board && board.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Online leaderboard</h3>
          <table className="history">
            <thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Games</th><th>Win rate</th></tr></thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.username} className={auth.user?.username === r.username ? 'me-row' : ''}>
                  <td>{i + 1}</td>
                  <td><span className="row" style={{ gap: '.4rem' }}><Avatar heroId={r.avatarHeroId} size={22} />{r.name}</span></td>
                  <td>{r.wins}</td><td>{r.games}</td><td>{pct(r.wins / r.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking && (
        <div className="modal-bg" onClick={() => setPicking(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close small" onClick={() => setPicking(false)}>✕</button>
            <h2>Choose your avatar</h2>
            <HeroPicker format="casual" value={profile.avatarHeroId ?? undefined} onPick={(h) => { update({ ...profile, avatarHeroId: h.id }); setPicking(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}
