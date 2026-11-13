// Mistake trainer: replay positions from your own games where the Hard bot would have played differently.
import { useMemo, useState } from 'react';
import { describeAction } from '../../ai/bot';
import { autoPitch, cardOf, checkDefense, currentLink, defendOptions, linkPower, playOptions } from '../../engine/game';
import type { Action, GameState } from '../../engine/types';
import { loadDrills, removeDrill, updateDrill } from '../../learn/drills';
import type { Drill } from '../../learn/drills';
import CardView from '../components/CardView';

const key = (a: Action) => JSON.stringify(a.type === 'defend' ? { ...a, uids: [...a.uids].sort() } : a.type === 'play' || a.type === 'activate' ? { t: a.type, uid: a.uid } : { t: a.type });

/** The right answer, your original move, and up to two other legal moves, in a stable shuffled order. */
function optionsFor(d: Drill): Action[] {
  const s = d.state;
  const p = s.players[0];
  const others: Action[] = [];
  if (s.phase === 'defend') {
    others.push({ type: 'defend', uids: [] });
    for (const o of defendOptions(s, 0)) if (!checkDefense(s, [o.uid])) others.push({ type: 'defend', uids: [o.uid] });
  } else {
    others.push({ type: 'pass' });
    for (const o of playOptions(s, 0)) {
      const pitch = autoPitch(p, Math.max(0, o.cost - p.resources), [o.uid]);
      if (pitch) others.push(o.kind === 'card' ? { type: 'play', uid: o.uid, pitch } : { type: 'activate', uid: o.uid, index: o.index, pitch });
    }
  }
  const seen = new Set<string>();
  const out: Action[] = [];
  for (const a of [d.better, d.yours, ...others]) {
    const k = key(a);
    const label = describeAction(s, a);
    if (seen.has(k) || seen.has(label) || out.length >= 4) continue;
    seen.add(k);
    seen.add(label);
    out.push(a);
  }
  let h = 0;
  for (const c of d.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return out.map((a, i) => ({ a, r: (h ^ (i * 2654435761)) >>> 0 })).sort((x, y) => x.r - y.r).map((x) => x.a);
}

function Situation({ s }: { s: GameState }) {
  const me = s.players[0], opp = s.players[1];
  const l = currentLink(s);
  return (
    <div className="col" style={{ gap: '.6rem' }}>
      <div className="row small">
        <span className="tag">Turn {s.turn}</span>
        <span>You: <b>{me.life}</b> life · {me.resources} resource{me.resources === 1 ? '' : 's'} · {me.actionPoints} action point{me.actionPoints === 1 ? '' : 's'}</span>
        <span>{opp.name}: <b>{opp.life}</b> life · {opp.hand.length} cards in hand</span>
      </div>
      {s.phase === 'defend' && l ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <CardView card={cardOf(l.inst)} width={110} />
          <div><b>You’re being attacked</b> by {cardOf(l.inst).name} for <b>{linkPower(l)}</b>{l.goAgain ? ' (go again)' : ''}{l.dominate ? ' (dominate)' : ''}. How do you defend?</div>
        </div>
      ) : (
        <div><b>Your action phase.</b> What do you do next?</div>
      )}
      <div className="lobby-label">Your hand{me.arsenal.length ? ' & arsenal' : ''}</div>
      <div className="drill-hand">
        {me.hand.map((h) => <CardView key={h.uid} card={cardOf(h)} width="100%" />)}
        {me.arsenal.map((h) => <div key={h.uid} className="drill-arsenal"><CardView card={cardOf(h)} width="100%" /><span className="small muted">arsenal</span></div>)}
      </div>
      {(me.permanents.length > 0 || me.weapons.length > 0) && (
        <div className="small muted">In play: {[...me.weapons.map((w) => cardOf(w.inst).name), ...me.permanents.map((pm) => cardOf(pm.inst).name)].join(', ')}</div>
      )}
    </div>
  );
}

export default function DrillsPage() {
  const [drills, setDrills] = useState(loadDrills);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Action | null>(null);
  const d = drills[i % Math.max(1, drills.length)];
  const options = useMemo(() => (d ? optionsFor(d) : []), [d]);
  if (!drills.length) {
    return (
      <div className="col" style={{ gap: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>🎯 Mistake trainer</h1>
        <div className="panel">No positions saved yet. After a game, open <b>🔍 Review game</b> and save the positions where the Hard bot would have played differently. They come back here as drills until you get each one right twice in a row.</div>
      </div>
    );
  }
  const right = picked && key(picked) === key(d.better);
  const next = () => { updateDrill(d.id, !!right); const ds = loadDrills(); setDrills(ds); setI(right && ds.length < drills.length ? i : i + 1); setPicked(null); };
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>🎯 Mistake trainer</h1>
        <span className="small muted">{drills.length} position{drills.length > 1 ? 's' : ''} to master · get one right twice in a row to clear it</span>
      </div>
      <div className="panel"><Situation s={d.state} /></div>
      <div className="col" style={{ gap: '.4rem' }}>
        {options.map((a) => {
          const k = key(a);
          const cls = picked ? (k === key(d.better) ? 'drill-opt right' : k === key(picked) ? 'drill-opt wrong' : 'drill-opt') : 'drill-opt';
          return <button key={k} className={cls} disabled={!!picked} onClick={() => setPicked(a)}>{describeAction(d.state, a)}{picked && k === key(d.yours) && k !== key(d.better) ? ' (what you did in the game)' : ''}</button>;
        })}
      </div>
      {picked && (
        <div className={`panel ${right ? 'ok' : ''}`}>
          <b>{right ? '✓ Right!' : '✗ Not quite.'}</b> The Hard bot plays: <b>{describeAction(d.state, d.better)}</b>.
          {d.why && <p className="small" style={{ marginBottom: 0 }}>{d.why}</p>}
          <p className="small muted">The bot isn’t perfect either: if you’re sure your move was better, remove this drill.</p>
          <div className="row">
            <button className="primary" onClick={next}>Next</button>
            <button onClick={() => { removeDrill(d.id); setDrills(loadDrills()); setPicked(null); }}>Remove this drill</button>
          </div>
        </div>
      )}
    </div>
  );
}
