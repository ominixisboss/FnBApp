// Draft and Sealed with friends: a table on the game server. Shown on the Sealed & Draft page.
import { useEffect, useState } from 'react';
import { eligibleForHero, getDb } from '../../data/cardDb';
import { LIMITED_SETS, setHeroes } from '../../deck/limited';
import { online, useOnline } from '../../online/client';
import { useAuth } from '../auth';
import CardView from '../components/CardView';

const C = (id: string) => getDb().byId.get(id)!;

/** Before joining a table: create one or join with a code. */
export function PodStart() {
  const auth = useAuth();
  const net = useOnline();
  const [mode, setMode] = useState<'draft' | 'sealed'>('draft');
  const [set, setSet] = useState(LIMITED_SETS[LIMITED_SETS.length - 1][0]);
  const [code, setCode] = useState('');
  if (!auth.available) return null;
  if (!auth.user) return <div className="panel small">🌐 <b>Draft with friends:</b> <a href="#account">sign in</a> to open a table on the game server.</div>;
  return (
    <div className="panel col" style={{ gap: '.6rem' }}>
      <h3 style={{ margin: 0 }}>🌐 Draft or Sealed with friends</h3>
      <p className="small muted" style={{ margin: 0 }}>Open a table and share its code. Empty draft seats are filled with bots. When the packs are done, everyone builds a deck from their own pool and plays the others at the table.</p>
      <div className="row">
        <div className="seg"><button className={mode === 'draft' ? 'on' : ''} onClick={() => setMode('draft')}>Draft</button><button className={mode === 'sealed' ? 'on' : ''} onClick={() => setMode('sealed')}>Sealed</button></div>
        <select value={set} onChange={(e) => setSet(e.target.value)}>{LIMITED_SETS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        <button className="primary" onClick={() => online.podCreate(mode, set)}>Open a table</button>
      </div>
      <div className="row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Table code" maxLength={5} style={{ width: 120 }} />
        <button disabled={code.length < 5} onClick={() => online.podJoin(code)}>Join</button>
        {net.error && <span className="small err">{net.error}</span>}
      </div>
    </div>
  );
}

/** At a table: the lobby, then the draft itself. Building and playing are handled by the page. */
export function PodLive() {
  const net = useOnline();
  const pod = net.pod!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = pod.pickDeadline ? Math.max(0, Math.ceil((pod.pickDeadline - now) / 1000)) : null;
  // which hero you're drafting for (only used to dim cards it can't use; you choose for real when building)
  const [forHero, setForHero] = useState('');
  const fh = forHero ? C(forHero) : null;
  const humans = pod.players.filter((p) => !p.bot);
  return (
    <div className="col" style={{ gap: '.8rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{pod.mode === 'draft' ? 'Draft' : 'Sealed'} · {pod.setName} <span className="tag">Table {pod.code}</span></h2>
        <button className="small" onClick={() => { if (confirm('Leave this table? A bot will take your seat.')) online.podLeave(); }}>Leave table</button>
      </div>
      {net.error && <div className="small err">{net.error}</div>}
      {pod.phase === 'lobby' && (
        <div className="panel col" style={{ gap: '.5rem' }}>
          <div>Share the code <b className="code-big">{pod.code}</b> with your friends. They join from <i>Learn → Sealed &amp; Draft</i>.</div>
          <div className="row">{humans.map((p) => <span key={p.username} className="tag">👤 {p.name}</span>)}</div>
          {pod.mode === 'draft' && <div className="small muted">{8 - humans.length} seat{8 - humans.length === 1 ? '' : 's'} will be filled with bots.</div>}
          {pod.isHost ? <button className="play-big" onClick={() => online.podStart()}>Start {pod.mode}</button> : <div className="small muted">Waiting for the host to start…</div>}
        </div>
      )}
      {pod.phase === 'drafting' && (
        <div className="panel col" style={{ gap: '.6rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>Pack {pod.round} of 3 · {pod.you.pack.length} cards left in this pack</b>
            <span className={`small ${left !== null && left <= 15 ? 'err' : 'muted'}`}>{pod.you.picked ? 'Waiting for the others…' : left !== null ? `${left}s to pick` : ''}</span>
          </div>
          <div className="row small">{pod.players.map((p) => <span key={p.username} className="tag">{p.bot ? '🤖' : '👤'} {p.name}: {p.picks}</span>)}</div>
          <label className="row small">Drafting for
            <select value={forHero} onChange={(e) => setForHero(e.target.value)}>
              <option value="">any hero</option>
              {setHeroes(pod.set).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <span className="muted">cards your hero can’t use are dimmed</span>
          </label>
          <div className={`pack-reveal ${pod.you.picked ? 'dim' : ''}`} key={`${pod.round}-${pod.you.pack.length}`}>
            {pod.you.pack.map((id, i) => (
              <div key={id + i} className={`pack-card ${fh && !eligibleForHero(C(id), fh) ? 'ineligible' : ''}`} style={{ animationDelay: `${i * 35}ms` }}>
                <CardView card={C(id)} width="100%" onClick={() => !pod.you.picked && online.podPick(i)} />
              </div>
            ))}
          </div>
          {pod.you.pool.length > 0 && <div className="small muted">Your picks ({pod.you.pool.length}): {pod.you.pool.map((id) => C(id).name).join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

/** After building: who's ready, and buttons to play them. */
export function PodOpponents({ heroId }: { heroId: string }) {
  const net = useOnline();
  const auth = useAuth();
  const pod = net.pod;
  if (!pod) return null;
  const others = pod.players.filter((p) => !p.bot && p.username !== auth.user?.username);
  return (
    <div className="panel col" style={{ gap: '.4rem' }}>
      <b>Table {pod.code}</b>
      {!pod.you.deckSubmitted && <span className="small muted">Submit your deck to play the others at the table.</span>}
      {others.length === 0 && <span className="small muted">Nobody else is at this table.</span>}
      {others.map((p) => (
        <div key={p.username} className="row">
          <span>👤 {p.name}</span>
          {p.ready ? <button className="small primary" disabled={!pod.you.deckSubmitted} onClick={() => { online.podPlay(p.username); location.hash = '#play/online'; }}>Play</button> : <span className="small muted">still building…</span>}
        </div>
      ))}
      <span className="small muted">Or practise {C(heroId).name.split(',')[0]} against a bot with the button below.</span>
    </div>
  );
}
