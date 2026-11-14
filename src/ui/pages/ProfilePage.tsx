import { ACHIEVEMENTS, COSMETICS, computeProgress } from '../../stats/progress';
import { localReplayIds } from '../../stats/replays';
import { online } from '../../online/client';
import { friends as friendsApi, ladder, mySeasons } from '../auth';
import type { FriendRow, LadderRow, SeasonInfo, SeasonRow } from '../auth';
import { FORMATS, formatName } from '../../deck/deck';
import { updateFeats } from '../../stats/progress';
import type { CosmeticKind } from '../../stats/progress';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '../../data/cardDb';
import { loadMatches, summarize } from '../../stats/matches';
import type { StatLine } from '../../stats/matches';
import { loadProfile, saveProfile } from '../../stats/profile';
import { HeroPicker } from './DecksPage';
import { leaderboard, useAuth } from '../auth';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push';
import { a11y, setA11y } from '../a11y';
import { applyOrientation, isNative, orientationPref } from '../../native';
import type { OrientationPref } from '../../native';
import type { LeaderRow } from '../auth';
import AudioSettings from '../components/AudioSettings';

const heroName = (id: string) => getDb().byId.get(id)?.name ?? 'Unknown hero';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const FORMAT: Record<string, string> = { blitz: 'Blitz', cc: 'Classic Constructed', casual: 'Casual' };
const DIFF: Record<string, string> = { easy: 'Easy bot', normal: 'Normal bot', hard: 'Hard bot', online: 'Online players' };

export function Avatar({ heroId, size = 64, frame }: { heroId: string | null; size?: number; frame?: string }) {
  const hero = heroId ? getDb().byId.get(heroId) : undefined;
  return (
    <div className={`avatar frame-${frame ?? 'none'}`} style={{ width: size, height: size, backgroundImage: hero?.image ? `url(${hero.image})` : undefined }}>
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
  const [ladderRows, setLadderRows] = useState<LadderRow[] | null>(null);
  const [ladderFormat, setLadderFormat] = useState('blitz');
  const [seasons, setSeasons] = useState<{ seasons: SeasonRow[]; season: SeasonInfo | null }>({ seasons: [], season: null });
  useEffect(() => { if (auth.available) ladder(ladderFormat).then(setLadderRows, () => setLadderRows(null)); }, [auth.available, ladderFormat]);
  useEffect(() => {
    if (!auth.available || !auth.user) return;
    mySeasons().then((r) => {
      setSeasons(r);
      // season rewards are unlocked by your best season peak
      const peak = Math.max(0, ...r.seasons.map((x) => x.peak));
      updateFeats((f) => (peak > (f.seasonPeak ?? 0) ? { ...f, seasonPeak: peak } : f));
    }, () => {});
  }, [auth.available, auth.user]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const replayIds = useMemo(() => localReplayIds(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => loadMatches(), [tick]);
  const st = useMemo(() => summarize(matches), [matches]);
  const update = (p: typeof profile) => { setProfile(p); saveProfile(p); auth.pushProfile(p); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prog = useMemo(() => computeProgress(matches), [matches, tick]);
  const equipped = { sleeve: 'classic', mat: 'tavern', frame: 'none', ...profile.cosmetics };
  const equip = (kind: CosmeticKind, id: string) => update({ ...profile, cosmetics: { ...equipped, [kind]: id } });

  return (
    <div className="col profile" style={{ gap: '1.2rem' }}>
      <div className="profile-head panel">
        <button className="avatar-btn" onClick={() => setPicking(true)} title="Change avatar"><Avatar heroId={profile.avatarHeroId} size={96} frame={equipped.frame} /></button>
        <div className="col grow" style={{ gap: '.3rem' }}>
          <input className="name-input" value={profile.displayName} maxLength={24} onChange={(e) => update({ ...profile, displayName: e.target.value })} aria-label="Display name" />
          <div className="muted small">
            {auth.user ? <>Signed in as <b>{auth.user.username}</b>. Your profile, decks and stats sync to the server.</> : <>Playing offline. <a href="#account">Sign in</a> to sync across devices and play online.</>}
          </div>
          <div className="small muted">Playing since {new Date(profile.createdAt).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="panel progress-panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Level {prog.level} <span className="muted small">· {prog.title}</span></h3>
          <span className="small muted">{prog.into} / {prog.need} XP</span>
        </div>
        <div className="xpbar big"><span style={{ '--from': '0%', '--to': `${Math.round((prog.into / prog.need) * 100)}%` } as React.CSSProperties} /></div>
        <h4>Daily quests <span className="muted small">· new quests every day</span></h4>
        <div className="quests">
          {prog.quests.map((q) => (
            <div key={q.id} className={`quest ${q.done ? 'done' : ''}`}>
              <span>{q.done ? '✅' : '◻'} {q.text}</span>
              <span className="small muted">{q.value}/{q.goal} · +{q.reward} XP</span>
              <span className="qbar"><span style={{ width: `${(q.value / q.goal) * 100}%` }} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Achievements <span className="muted small">· {prog.achievements.filter((a) => a.done).length}/{prog.achievements.length}</span></h3>
        <div className="achievements">
          {prog.achievements.map((a) => (
            <div key={a.id} className={`ach-tile ${a.done ? 'done' : ''}`} title={`${a.text} · +${a.reward} XP`}>
              <span className="ach-icon">{a.icon}</span>
              <b>{a.name}</b>
              <span className="small muted">{a.text}</span>
              {!a.done && a.goal > 1 && <span className="qbar"><span style={{ width: `${(a.value / a.goal) * 100}%` }} /></span>}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Cosmetics</h3>
        {(['sleeve', 'mat', 'frame'] as CosmeticKind[]).map((kind) => (
          <div key={kind} className="cosmetic-row">
            <div className="lobby-label">{kind === 'sleeve' ? 'Card sleeves' : kind === 'mat' ? 'Playmats' : 'Avatar frames'}</div>
            <div className="cosmetics">
              {COSMETICS.filter((c) => c.kind === kind).map((c) => {
                const open = prog.unlocked.has(c.id);
                const how = c.unlock.level ? `Reach level ${c.unlock.level}` : `Achievement: ${ACHIEVEMENTS.find((a) => a.id === c.unlock.achievement)?.name}`;
                return (
                  <button key={c.id} className={`cosmetic ${equipped[kind] === c.id ? 'on' : ''} ${open ? '' : 'locked'}`} disabled={!open} onClick={() => equip(kind, c.id)} title={open ? c.name : `Locked · ${how}`}>
                    {kind === 'sleeve' && <span className={`swatch card-back sleeve-${c.id}`} />}
                    {kind === 'mat' && <span className={`swatch mat-swatch mat-${c.id}`} />}
                    {kind === 'frame' && <Avatar heroId={profile.avatarHeroId} size={40} frame={c.id} />}
                    <span className="small">{c.name}</span>
                    {!open && <span className="lock">🔒 <small>{how}</small></span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
              <thead><tr><th>Date</th><th>Result</th><th>Your hero</th><th>Opponent</th><th>Mode</th><th>Turns</th><th>Life left</th><th></th></tr></thead>
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
                    <td>{(replayIds.has(m.id) || m.mode === 'online') && <a className="small" href={`#replay/${m.id}`} title="Watch the replay">▶ Replay</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="panel col" style={{ gap: ".5rem" }}><b>🎚 Music &amp; sound</b><AudioSettings /></div>
      <AccessibilityPanel />
      {auth.user && auth.available && <NotificationsToggle />}
      {auth.user && auth.available && <FriendsManager />}
      {ladderRows && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Ranked season{seasons.season ? ` ${seasons.season.id}` : ''}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Quick matches are ranked, with a separate ladder for each format. Seasons last a month{seasons.season ? `; this one ends in ${Math.max(1, Math.ceil((seasons.season.ends - Date.now()) / 864e5))} day${Math.ceil((seasons.season.ends - Date.now()) / 864e5) === 1 ? '' : 's'}` : ''}. Reaching Gold unlocks the Season Laurel sleeve; Diamond unlocks the Grand Arena playmat and a Diamond frame.
          </p>
          <div className="season-tabs" style={{ marginBottom: '.5rem' }}>
            {FORMATS.filter(([f]) => f !== 'casual').map(([f, n]) => <button key={f} className={`small ${ladderFormat === f ? 'on' : ''}`} onClick={() => setLadderFormat(f)}>{n}</button>)}
          </div>
          {seasons.seasons.length > 0 && (
            <div className="small" style={{ marginBottom: '.5rem' }}>
              Your seasons: {seasons.seasons.slice(0, 6).map((x) => <span key={x.season + x.format} className={`tier tier-${x.peakTier.toLowerCase()}`} style={{ marginRight: '.3rem' }}>{x.season} {formatName(x.format)}: {x.rating} (peak {x.peakTier})</span>)}
            </div>
          )}
          {ladderRows.length === 0 && <p className="small muted">No ranked games in {formatName(ladderFormat)} this season yet.</p>}
          <table className="history">
            <thead><tr><th>#</th><th>Player</th><th>Tier</th><th>Rating</th><th>Ranked games</th></tr></thead>
            <tbody>
              {ladderRows.map((r, i) => (
                <tr key={r.username} className={auth.user?.username === r.username ? 'me-row' : ''}>
                  <td>{i + 1}</td>
                  <td><span className="row" style={{ gap: '.4rem' }}><Avatar heroId={r.avatarHeroId} size={22} />{r.name}</span></td>
                  <td><span className={`tier tier-${r.tier.toLowerCase()}`}>{r.tier}</span></td>
                  <td><b>{r.rating}</b></td><td>{r.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

/** Add friends by username, see who is online, remove them. */
function FriendsManager() {
  const [list, setList] = useState<FriendRow[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => friendsApi.list().then(setList, () => {});
  useEffect(() => { void load(); }, []);
  const add = async () => {
    try { await friendsApi.add(name.trim()); setName(''); setMsg(null); void load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Friends</h3>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friend’s username" onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <button className="primary" disabled={!name.trim()} onClick={() => void add()}>Add friend</button>
      </div>
      {msg && <div className="small err">{msg}</div>}
      <div className="col" style={{ gap: '.3rem', marginTop: '.6rem' }}>
        {list.length === 0 && <span className="small muted">Add a friend to see when they’re online and challenge them from the Play page.</span>}
        {list.map((f) => (
          <div key={f.username} className="friend-row">
            <span className={`presence ${f.status}`} title={f.status} /><Avatar heroId={f.avatarHeroId} size={26} />
            <span className="grow">{f.name} <span className="small muted">@{f.username} · {f.status === 'in-game' ? 'in a game' : f.status}</span></span>
            {f.status === 'in-game' && <button className="small" onClick={() => { online.spectate(f.username); location.hash = 'play/online'; }}>👁 Watch</button>}
            <button className="small" onClick={() => { void friendsApi.remove(f.username).then(load); }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void pushEnabled().then(setOn); }, []);
  if (!pushSupported()) return null;
  return (
    <div className="panel row" style={{ justifyContent: 'space-between' }}>
      <div><b>🔔 Notifications</b> <span className="small muted">when a friend challenges you or adds you to a friend cup, even with the app closed.</span>{msg && <div className="small err">{msg}</div>}</div>
      <button className={on ? '' : 'primary'} disabled={on === null} onClick={async () => {
        setMsg(null);
        if (on) { await disablePush(); setOn(false); return; }
        const e = await enablePush().catch((x: Error) => x.message);
        if (e) setMsg(e); else setOn(true);
      }}>{on ? 'Turn off' : 'Turn on'}</button>
    </div>
  );
}

function AccessibilityPanel() {
  const [s, setS] = useState(a11y);
  const [orient, setOrient] = useState(orientationPref);
  const toggle = (k: 'cb' | 'bigText') => { setA11y(k, !s[k]); setS(a11y()); };
  return (
    <div className="panel col" style={{ gap: '.4rem' }}>
      <b>♿ Accessibility &amp; display</b>
      <label className="row small"><input type="checkbox" checked={s.cb} onChange={() => toggle('cb')} /> Colour-blind pitch markers: ▲1 red, ■2 yellow, ●3 blue on every card</label>
      <label className="row small"><input type="checkbox" checked={s.bigText} onChange={() => toggle('bigText')} /> Larger text</label>
      {isNative() && (
        <label className="row small">Screen
          <select value={orient} onChange={(e) => { const v = e.target.value as OrientationPref; setOrient(v); void applyOrientation(v); }}>
            <option value="auto">Turns with the phone</option>
            <option value="portrait">Portrait (one-handed)</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
      )}
      <span className="small muted">Animations can be turned off in the top bar, and they switch off by themselves if your device asks for reduced motion. Screen readers announce each move in a game.</span>
    </div>
  );
}

