import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '../../data/types';
import {
  applyAction, autoPitch, availableResources, cardOf, checkDefense, currentLink, defendOptions,
  equipDefense, linkDefense, linkPower, pendingEffectsText, pitchOf, playOptions,
} from '../../engine/game';
import type { PlayOption } from '../../engine/game';
import type { Action, CardInst, GameState, PlayerId, PlayerState } from '../../engine/types';
import { chooseAction, describeAction } from '../../ai/bot';
import { getScript } from '../../engine/cardScript';
import CardView, { CardBack } from './CardView';
import CardDetail from './CardDetail';

const HUMAN: PlayerId = 0;
const BOT_DELAY = 650;

interface Pending { opt: PlayOption; pitch: number[]; mode?: number }

export default function GameBoard({ initial, tutorial, onExit, onRematch }: { initial: GameState; tutorial: boolean; onExit: () => void; onRematch: () => void }) {
  const [state, setState] = useState(initial);
  const [history, setHistory] = useState<GameState[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [defendSel, setDefendSel] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Card | null>(null);
  const [detail, setDetail] = useState<Card | null>(null);
  const [zone, setZone] = useState<{ title: string; cards: CardInst[] } | null>(null);
  const [showHint, setShowHint] = useState(tutorial);
  const [showManual, setShowManual] = useState(false);
  const [modePick, setModePick] = useState<PlayOption | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const me = state.players[HUMAN];
  const opp = state.players[1];
  const myTurn = state.priority === HUMAN && state.phase !== 'gameOver';
  const options = useMemo(() => (myTurn ? playOptions(state, HUMAN) : []), [state, myTurn]);
  const defOpts = useMemo(() => (myTurn ? defendOptions(state, HUMAN) : []), [state, myTurn]);
  const hint = useMemo(() => (myTurn && showHint ? chooseAction(state, HUMAN, 'hard') : null), [state, myTurn, showHint]);
  const link = currentLink(state);

  const act = (a: Action, snapshot = true) => {
    try {
      if (snapshot) setHistory((h) => [...h.slice(-30), state]);
      setState(applyAction(state, a));
      setPending(null);
      setDefendSel([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // bot turns
  useEffect(() => {
    if (state.phase === 'gameOver') return;
    const p = state.players[state.priority];
    if (!p.isBot) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.phase === 'gameOver' || !s.players[s.priority].isBot) return s;
        try {
          return applyAction(s, chooseAction(s, s.priority).action);
        } catch (e) {
          console.error(e);
          return applyAction(s, { type: 'pass' });
        }
      });
    }, BOT_DELAY);
    return () => clearTimeout(t);
  }, [state]);

  // auto-pass reactions when there is nothing to respond with
  useEffect(() => {
    if (!myTurn || state.phase !== 'reaction' || options.length > 0) return;
    const t = setTimeout(() => setState((s) => (s.priority === HUMAN && s.phase === 'reaction' ? applyAction(s, { type: 'pass' }) : s)), 450);
    return () => clearTimeout(t);
  }, [state, myTurn, options.length]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [state.log.length]);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setState(prev);
    setPending(null);
    setDefendSel([]);
  };

  // ---- interactions
  const optionFor = (uid: number) => options.find((o) => o.uid === uid);
  const modesOf = (opt: PlayOption) => {
    if (opt.kind !== 'card') return [];
    const inst = [...me.hand, ...me.arsenal].find((i) => i.uid === opt.uid);
    return inst ? getScript(cardOf(inst)).modes : [];
  };
  const startPlay = (opt: PlayOption, mode?: number) => {
    if (mode === undefined && modesOf(opt).length > 0) return setModePick(opt);
    setModePick(null);
    const exclude = opt.kind === 'card' ? [opt.uid] : [];
    if (me.resources >= opt.cost) return act(opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch: [], mode } : { type: 'activate', uid: opt.uid, index: opt.index, pitch: [] });
    if (availableResources(me, exclude) < opt.cost) return setError('Not enough resources.');
    setPending({ opt, pitch: [], mode });
  };
  const finishPay = (pitch: number[]) => {
    if (!pending) return;
    const { opt, mode } = pending;
    act(opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch, mode } : { type: 'activate', uid: opt.uid, index: opt.index, pitch });
  };
  const pitchTotal = pending ? me.resources + pending.pitch.reduce((a, u) => a + pitchOf(cardOf(me.hand.find((h) => h.uid === u)!)), 0) : 0;

  const clickHand = (inst: CardInst) => {
    setError(null);
    if (pending) {
      if (pending.opt.kind === 'card' && inst.uid === pending.opt.uid) return setPending(null);
      const sel = pending.pitch.includes(inst.uid) ? pending.pitch.filter((u) => u !== inst.uid) : [...pending.pitch, inst.uid];
      const total = me.resources + sel.reduce((a, u) => a + pitchOf(cardOf(me.hand.find((h) => h.uid === u)!)), 0);
      if (total >= pending.opt.cost && !pending.pitch.includes(inst.uid)) return finishPay(sel);
      return setPending({ ...pending, pitch: sel });
    }
    if (!myTurn) return setDetail(cardOf(inst));
    if (state.phase === 'defend') {
      if (!defOpts.some((d) => d.uid === inst.uid)) return;
      return setDefendSel(defendSel.includes(inst.uid) ? defendSel.filter((u) => u !== inst.uid) : [...defendSel, inst.uid]);
    }
    if (state.phase === 'arsenal') return act({ type: 'arsenal', uid: inst.uid });
    const opt = optionFor(inst.uid);
    if (opt) return startPlay(opt);
    setDetail(cardOf(inst));
  };

  const clickArena = (inst: CardInst) => {
    if (myTurn && state.phase === 'defend' && defOpts.some((d) => d.uid === inst.uid)) {
      return setDefendSel(defendSel.includes(inst.uid) ? defendSel.filter((u) => u !== inst.uid) : [...defendSel, inst.uid]);
    }
    const acts = options.filter((o) => o.uid === inst.uid && o.kind === 'activation');
    if (acts.length && !pending) return startPlay(acts[0]);
    setDetail(cardOf(inst));
  };

  // ---- prompt
  const defendTotal = defendSel.reduce((a, u) => a + (defOpts.find((d) => d.uid === u)?.defense ?? 0), 0);
  const defendErr = state.phase === 'defend' && myTurn ? checkDefense(state, defendSel) : null;
  let prompt: React.ReactNode;
  if (state.phase === 'gameOver') {
    prompt = (
      <>
        <span className="msg"><b>{state.winner === HUMAN ? '🏆 Victory!' : '💀 Defeat.'}</b> {state.players[state.winner ?? 0].name} wins on turn {state.turn}.</span>
        <button className="primary" onClick={onRematch}>Rematch</button>
        <button onClick={onExit}>New game</button>
      </>
    );
  } else if (!myTurn) {
    prompt = <span className="msg muted">{state.players[state.priority].name} is thinking…</span>;
  } else if (pending) {
    prompt = (
      <>
        <span className="msg">Pay <b>{pending.opt.cost}</b> for <b>{pending.opt.label}</b>: click cards in your hand to pitch them ({pitchTotal}/{pending.opt.cost}).</span>
        <button className="gold" onClick={() => { const p = autoPitch(me, pending.opt.cost, pending.opt.kind === 'card' ? [pending.opt.uid] : []); if (p) finishPay(p); }}>Auto-pay</button>
        <button onClick={() => setPending(null)}>Cancel</button>
      </>
    );
  } else if (state.phase === 'defend' && link) {
    const incoming = linkPower(link);
    prompt = (
      <>
        <span className="msg">
          <b>{cardOf(link.inst).name}</b> attacks for <b>{incoming}</b>{link.dominate ? ' (dominate: max 1 card from hand)' : ''}{link.overpower ? ' (overpower: max 1 action card)' : ''}. Select cards from hand or equipment to defend.
          {' '}Blocking {defendTotal} → you take <b>{Math.max(0, incoming - defendTotal)}</b>.
          {defendErr && <span className="err"> {defendErr}</span>}
        </span>
        <button className="primary" disabled={!!defendErr} onClick={() => act({ type: 'defend', uids: defendSel })}>{defendSel.length ? `Defend (${defendTotal})` : 'No block'}</button>
      </>
    );
  } else if (state.phase === 'reaction' && link) {
    const mine = link.attacker === HUMAN;
    prompt = (
      <>
        <span className="msg">
          Reaction step: {cardOf(link.inst).name} {linkPower(link)} vs {linkDefense(link)} defense.{' '}
          {mine ? 'Play an attack reaction or instant, or pass.' : 'Play a defense reaction or instant, or pass.'}
        </span>
        <button className="primary" onClick={() => act({ type: 'pass' })}>Pass</button>
      </>
    );
  } else if (state.phase === 'arsenal') {
    prompt = (
      <>
        <span className="msg">End phase: click a card in your hand to put it face-down in your arsenal, or skip.</span>
        <button className="primary" onClick={() => act({ type: 'arsenal', uid: null })}>Skip</button>
      </>
    );
  } else {
    prompt = (
      <>
        <span className="msg">
          Your action phase. {me.actionPoints > 0 ? `You have ${me.actionPoints} action point${me.actionPoints > 1 ? 's' : ''}.` : 'No action points left (instants only).'}
          {' '}Playable cards glow green.
        </span>
        <button className="primary" onClick={() => act({ type: 'pass' })}>{state.chainOpen ? 'Close chain & end turn' : 'End turn'}</button>
      </>
    );
  }

  const handClass = (inst: CardInst) => {
    if (pending) return pending.pitch.includes(inst.uid) ? 'pitchsel' : pending.opt.uid === inst.uid ? 'sel' : '';
    if (state.phase === 'defend' && myTurn) return defendSel.includes(inst.uid) ? 'sel' : defOpts.some((d) => d.uid === inst.uid) ? '' : 'dim';
    if (myTurn && optionFor(inst.uid)) return 'playable';
    return '';
  };

  return (
    <div className="board">
      <div className="col">
        <PlayerArea p={opp} state={state} isOpp onHover={setHover} onClickArena={(i) => setDetail(cardOf(i))} onZone={setZone} />
        <ChainView state={state} onHover={setHover} onClick={(c) => setDetail(c)} />
        <div className="prompt">{prompt}</div>
        {error && <div className="err small">{error}</div>}
        {hint && showHint && state.phase !== 'gameOver' && (
          <div className="hint">
            <b>💡 Suggested:</b> {describeAction(state, hint.action)}. <span className="muted">{hint.reason}</span>
          </div>
        )}
        <PlayerArea
          p={me}
          state={state}
          onHover={setHover}
          onClickArena={clickArena}
          onZone={setZone}
          arenaClass={(inst) => {
            if (myTurn && state.phase === 'defend') return defendSel.includes(inst.uid) ? 'sel' : defOpts.some((d) => d.uid === inst.uid) ? '' : '';
            return myTurn && options.some((o) => o.uid === inst.uid && o.kind === 'activation') ? 'playable' : '';
          }}
          arsenalClick={clickHand}
          arsenalClass={handClass}
        />
        <div className="hand">
          {me.hand.map((inst) => (
            <CardView key={inst.uid} card={cardOf(inst)} width={118} className={handClass(inst)} onClick={() => clickHand(inst)} onHover={setHover}
              badge={pending && pitchOf(cardOf(inst)) ? `+${pitchOf(cardOf(inst))}` : undefined} />
          ))}
          {me.hand.length === 0 && <span className="muted small">Your hand is empty.</span>}
        </div>
      </div>
      <div className="col">
        <div className="panel col">
          <div className="row">
            <button className="small" onClick={() => setShowHint(!showHint)}>{showHint ? 'Hide hints' : '💡 Hint'}</button>
            <button className="small" disabled={!history.length} onClick={undo}>↶ Undo</button>
            <button className="small" onClick={() => setShowManual(!showManual)}>🛠 Manual</button>
            <button className="small" onClick={() => { if (confirm('Concede this game?')) act({ type: 'concede' }); }} disabled={state.phase === 'gameOver' || !myTurn}>Concede</button>
            <button className="small" onClick={onExit}>Exit</button>
          </div>
          {showManual && <ManualTools state={state} act={act} />}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Game log</h3>
          <div className="log" ref={logRef}>
            {state.log.slice(-200).map((l, i) => (
              <div key={i} className={l.player === HUMAN ? 'me' : l.player === 1 ? 'them' : 'muted'}>{l.text}</div>
            ))}
          </div>
        </div>
      </div>
      {hover && <div className="preview"><CardView card={hover} width={260} /></div>}
      {detail && <CardDetail card={detail} onClose={() => setDetail(null)} />}
      {modePick && (
        <div className="modal-bg" onClick={() => setModePick(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>{modePick.label}: choose 1</h2>
            <div className="col">
              {modesOf(modePick).map((m, i) => (
                <button key={i} onClick={() => startPlay(modePick, i)} style={{ textAlign: 'left' }}>
                  {m.label}{!m.parsed && <span className="muted small"> (not automated, apply manually)</span>}
                </button>
              ))}
              <button className="small" onClick={() => setModePick(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {zone && (
        <div className="modal-bg" onClick={() => setZone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close small" onClick={() => setZone(null)}>✕</button>
            <h2>{zone.title} ({zone.cards.length})</h2>
            <div className="grid">{zone.cards.map((c) => <CardView key={c.uid} card={cardOf(c)} onClick={() => setDetail(cardOf(c))} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerArea({ p, state, isOpp, onHover, onClickArena, onZone, arenaClass, arsenalClick, arsenalClass }: {
  p: PlayerState; state: GameState; isOpp?: boolean; onHover: (c: Card | null) => void; onClickArena: (i: CardInst) => void;
  onZone: (z: { title: string; cards: CardInst[] }) => void; arenaClass?: (i: CardInst) => string;
  arsenalClick?: (i: CardInst) => void; arsenalClass?: (i: CardInst) => string;
}) {
  const active = state.turnPlayer === p.id;
  const effects = pendingEffectsText(p);
  return (
    <div className={`side ${isOpp ? 'opp' : ''}`} style={active ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="zone-row">
        <div className="hero-box">
          <CardView card={cardOf(p.hero)} width={92} onHover={onHover} onClick={() => onClickArena(p.hero)} />
          <div className="col" style={{ gap: '.2rem' }}>
            <div className="life" title="Life">{p.life}</div>
            <b>{p.name}</b>
            <div className="res small">
              <span title="Floating resources">⛀ {p.resources}</span>
              <span title="Action points">⚡ {p.actionPoints}</span>
            </div>
          </div>
        </div>
        {p.weapons.map((w) => (
          <div className="zone" key={w.inst.uid}>
            <CardView card={cardOf(w.inst)} width={80} onHover={onHover} onClick={() => onClickArena(w.inst)} className={`${arenaClass?.(w.inst) ?? ''} ${w.usedThisTurn ? 'dim' : ''}`} />
            weapon
          </div>
        ))}
        {p.equipment.map((e) => (
          <div className="zone" key={e.inst.uid}>
            <CardView card={cardOf(e.inst)} width={70} onHover={onHover} onClick={() => onClickArena(e.inst)}
              className={`${e.destroyed ? 'destroyed' : ''} ${arenaClass?.(e.inst) ?? ''}`}
              badge={e.destroyed ? 'destroyed' : e.defenseMod ? `⛨${equipDefense(e)}` : undefined} />
          </div>
        ))}
        <div className="grow" />
        <div className="zone">
          {p.arsenal.length ? (
            isOpp ? <CardBack width={70} label="A" /> : <CardView card={cardOf(p.arsenal[0])} width={70} onHover={onHover} onClick={() => arsenalClick?.(p.arsenal[0])} className={arsenalClass?.(p.arsenal[0])} />
          ) : <div className="card" style={{ '--w': '70px', opacity: .25, cursor: 'default' } as React.CSSProperties} />}
          arsenal
        </div>
        <div className="zone">
          <CardBack width={60} label={p.deck.length} />deck
        </div>
        <div className="zone" onClick={() => onZone({ title: `${p.name}'s graveyard`, cards: p.graveyard })} style={{ cursor: 'pointer' }}>
          {p.graveyard.length ? <CardView card={cardOf(p.graveyard[p.graveyard.length - 1])} width={60} badge={p.graveyard.length} /> : <div className="card" style={{ '--w': '60px', opacity: .25 } as React.CSSProperties} />}
          graveyard
        </div>
        <div className="zone" onClick={() => onZone({ title: `${p.name}'s pitch zone`, cards: p.pitch })} style={{ cursor: 'pointer' }}>
          {p.pitch.length ? <CardView card={cardOf(p.pitch[p.pitch.length - 1])} width={60} badge={p.pitch.length} /> : <div className="card" style={{ '--w': '60px', opacity: .25 } as React.CSSProperties} />}
          pitch
        </div>
        {p.banished.length > 0 && (
          <div className="zone" onClick={() => onZone({ title: `${p.name}'s banished zone`, cards: p.banished })} style={{ cursor: 'pointer' }}>
            <CardView card={cardOf(p.banished[p.banished.length - 1])} width={50} badge={p.banished.length} />banished
          </div>
        )}
      </div>
      {(p.permanents.length > 0 || effects.length > 0 || isOpp) && (
        <div className="row">
          {isOpp && <span className="muted small">Hand: {p.hand.length} card{p.hand.length === 1 ? '' : 's'}{p.intimidated.length ? ` (+${p.intimidated.length} intimidated)` : ''}</span>}
          {p.permanents.map((pm) => (
            <CardView key={pm.inst.uid} card={cardOf(pm.inst)} width={56} onHover={onHover} onClick={() => onClickArena(pm.inst)} className={arenaClass?.(pm.inst)} />
          ))}
          {effects.map((e, i) => <span key={i} className="tag">{e}</span>)}
        </div>
      )}
    </div>
  );
}

function ChainView({ state, onHover, onClick }: { state: GameState; onHover: (c: Card | null) => void; onClick: (c: Card) => void }) {
  if (!state.chain.length) return <div className="chain muted small" style={{ justifyContent: 'center' }}>Combat chain is empty</div>;
  return (
    <div className="chain">
      {state.chain.map((l, i) => (
        <div key={i} className={`link ${l.damage !== null ? 'done' : ''}`}>
          <CardView card={cardOf(l.inst)} width={84} onHover={onHover} onClick={() => onClick(cardOf(l.inst))} badge={`⚔ ${linkPower(l)}`} />
          {l.defenders.length > 0 && <span className="muted">vs</span>}
          {l.defenders.map((d) => (
            <CardView key={d.inst.uid} card={cardOf(d.inst)} width={64} onHover={onHover} onClick={() => onClick(cardOf(d.inst))} badge={`⛨${d.defense}`} />
          ))}
          <div className="col small" style={{ minWidth: 70 }}>
            <span>{state.players[l.attacker].name}</span>
            {l.goAgain && <span className="tag">go again</span>}
            {l.dominate && <span className="tag">dominate</span>}
            {l.damage !== null && <b className={l.hit ? 'err' : 'muted'}>{l.hit ? `hit for ${l.damage}` : 'blocked'}</b>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ManualTools({ state, act }: { state: GameState; act: (a: Action, snapshot?: boolean) => void }) {
  const [token, setToken] = useState('Runechant');
  const row = (label: string, pid: PlayerId) => (
    <div className="row small" key={pid}>
      <b style={{ width: 70 }}>{label}</b>
      <button className="small" onClick={() => act({ type: 'manual', op: 'life', player: pid, amount: -1 })}>−1 ♥</button>
      <button className="small" onClick={() => act({ type: 'manual', op: 'life', player: pid, amount: 1 })}>+1 ♥</button>
      <button className="small" onClick={() => act({ type: 'manual', op: 'draw', player: pid })}>Draw</button>
      <button className="small" onClick={() => act({ type: 'manual', op: 'resource', player: pid, amount: 1 })}>+1 ⛀</button>
      <button className="small" onClick={() => act({ type: 'manual', op: 'actionPoint', player: pid, amount: 1 })}>+1 ⚡</button>
    </div>
  );
  return (
    <div className="col">
      <p className="muted small" style={{ margin: 0 }}>Use these to apply card text the simulator doesn’t automate yet (hero abilities, unusual effects).</p>
      {row('You', 0)}
      {row(state.players[1].name.slice(0, 10), 1)}
      <div className="row small">
        <b style={{ width: 70 }}>Attack</b>
        <button className="small" disabled={!currentLink(state)} onClick={() => act({ type: 'manual', op: 'power', amount: -1 })}>−1 ⚔</button>
        <button className="small" disabled={!currentLink(state)} onClick={() => act({ type: 'manual', op: 'power', amount: 1 })}>+1 ⚔</button>
      </div>
      <div className="row small">
        <input value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 130 }} />
        <button className="small" onClick={() => act({ type: 'manual', op: 'token', player: 0, name: token })}>Create token</button>
      </div>
    </div>
  );
}
