import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '../../data/types';
import {
  applyAction, autoPitch, availableResources, cardOf, checkDefense, currentLink, defendOptions,
  equipDefense, linkDefense, linkPower, pendingEffectsText, pitchOf, playOptions,
} from '../../engine/game';
import type { PlayOption } from '../../engine/game';
import type { Action, CardInst, EquipState, GameState, PlayerId, PlayerState } from '../../engine/types';
import { chooseAction, describeAction } from '../../ai/bot';
import { getScript } from '../../engine/cardScript';
import CardView, { CardBack } from './CardView';
import CardDetail from './CardDetail';
import { GameOverOverlay, TurnBanner, animationsEnabled } from './Fx';
import { setSoundEnabled, sfx, soundEnabled } from '../sound';
import { hideHover } from './HoverCard';
import type { ChainLink } from '../../engine/types';

const HUMAN: PlayerId = 0;
const BOT_DELAY = 650;

interface Pending { opt: PlayOption; pitch: number[]; mode?: number }

interface Floater { id: number; player: PlayerId; amount: number }
interface Fx { floaters: Floater[]; lifeAnim: [string, string]; lifeKey: [number, number]; shakeKey: number; banner: { id: number; text: string; mine: boolean } | null }

const readSetting = (k: string, def: boolean) => { try { const v = localStorage.getItem(`fab-trainer.${k}`); return v === null ? def : v === '1'; } catch { return def; } };
const writeSetting = (k: string, v: boolean) => { try { localStorage.setItem(`fab-trainer.${k}`, v ? '1' : '0'); } catch { /* ignore */ } };

const motionOk = () => animationsEnabled() && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function playSounds(a: GameState, b: GameState) {
  if (b.phase === 'gameOver' && a.phase !== 'gameOver') return sfx(b.winner === HUMAN ? 'win' : 'lose');
  const lifeLoss = Math.max(a.players[0].life - b.players[0].life, a.players[1].life - b.players[1].life);
  if (lifeLoss >= 5) sfx('bigHit');
  else if (lifeLoss > 0) sfx('hit');
  if (b.chain.length > a.chain.length) sfx('play');
  const defA = a.chain[a.chain.length - 1]?.defenders.length ?? 0;
  const lastB = b.chain[b.chain.length - 1];
  if (lastB && b.chain.length === a.chain.length && lastB.defenders.length > defA) sfx('block');
  if (b.players.some((p, i) => p.pitch.length > a.players[i].pitch.length)) sfx('pitch');
  if (b.turn !== a.turn) sfx(b.turnPlayer === HUMAN ? 'myTurn' : 'turn');
  else if (b.players[HUMAN].hand.length > a.players[HUMAN].hand.length) sfx('draw');
}

/**
 * "Magic move": after every render, any card element that is new in the DOM glides from where the
 * same card was last seen (another zone), or from its source pile (your deck, the opponent's hand).
 */
function useZoneGlide(oppHandRef: React.RefObject<HTMLDivElement | null>) {
  const rects = useRef(new Map<string, DOMRect>());
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.arena [data-flip]'));
    const next = new Map<string, DOMRect>();
    const motion = motionOk();
    const fallback = (from?: string): DOMRect | null => {
      if (from === 'mydeck') return document.querySelector('.mat-side.me [data-area="deck"]')?.getBoundingClientRect() ?? null;
      if (from === 'opphand') return oppHandRef.current?.getBoundingClientRect() ?? null;
      return null;
    };
    let drawn = 0;
    for (const el of els) {
      const key = el.dataset.flip!;
      const r = el.getBoundingClientRect();
      next.set(key, r);
      if (seen.current.has(el)) continue;
      seen.current.add(el);
      if (!motion || !el.animate || r.width === 0) continue;
      const fromDeck = !rects.current.has(key) && el.dataset.from === 'mydeck';
      const prev = rects.current.get(key) ?? fallback(el.dataset.from);
      if (!prev || prev.width === 0) continue;
      const dx = prev.left + prev.width / 2 - (r.left + r.width / 2);
      const dy = prev.top + prev.height / 2 - (r.top + r.height / 2);
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) continue;
      const sc = Math.max(0.25, Math.min(2.5, prev.width / r.width));
      const delay = fromDeck ? 90 * drawn++ : 0;
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${fromDeck ? -14 : 0}deg)`, filter: 'brightness(1.5)', opacity: fromDeck ? 0.4 : 1 },
        { transform: 'translate(0, 0) scale(1.06)', filter: 'brightness(1.15)', opacity: 1, offset: 0.8 },
        { transform: 'none', filter: 'none', opacity: 1 },
      ], { duration: fromDeck ? 520 : 440, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
    rects.current = next;
  });
}

/** Watches state transitions and produces short-lived visual effects. */
function useFx(state: GameState, skip: React.MutableRefObject<boolean>): Fx {
  const prev = useRef<GameState | null>(null);
  const seq = useRef(1);
  const [fx, setFx] = useState<Fx>({ floaters: [], lifeAnim: ['', ''], lifeKey: [0, 0], shakeKey: 0, banner: null });
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (skip.current) { skip.current = false; return; }
    const next: Partial<Fx> = {};
    const floaters: Floater[] = [];
    const lifeAnim: [string, string] = [...fx.lifeAnim];
    const lifeKey: [number, number] = [...fx.lifeKey];
    let shake = false;
    if (before) {
      for (const pid of [0, 1] as PlayerId[]) {
        const d = state.players[pid].life - before.players[pid].life;
        if (d === 0) continue;
        floaters.push({ id: seq.current++, player: pid, amount: d });
        lifeAnim[pid] = d < 0 ? 'hurt' : 'heal';
        lifeKey[pid]++;
        if (d <= -5) shake = true;
      }
    }
    if (before) playSounds(before, state);
    if (!before || before.turn !== state.turn) {
      const mine = state.turnPlayer === HUMAN;
      next.banner = { id: seq.current++, text: mine ? 'Your turn' : `${state.players[state.turnPlayer].name.replace(' (bot)', '')}’s turn`, mine };
    }
    if (floaters.length || next.banner || shake) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFx((f) => ({ ...f, ...next, lifeAnim, lifeKey, floaters: [...f.floaters, ...floaters], shakeKey: shake ? f.shakeKey + 1 : f.shakeKey }));
      if (floaters.length) {
        const ids = floaters.map((f) => f.id);
        setTimeout(() => setFx((f) => ({ ...f, floaters: f.floaters.filter((x) => !ids.includes(x.id)) })), 1500);
      }
      if (next.banner) {
        const id = next.banner.id;
        setTimeout(() => setFx((f) => (f.banner?.id === id ? { ...f, banner: null } : f)), 1600);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return fx;
}

export interface OnlineLink {
  state: GameState;
  send(a: Action): void;
  opponent: { name: string; connected: boolean } | null;
  error: string | null;
}

export default function GameBoard({ initial, tutorial, onExit, onRematch, onGameOver, online }: {
  initial: GameState; tutorial: boolean; onExit: () => void; onRematch?: () => void; onGameOver?: (s: GameState) => void;
  /** when set, the game is played on the server: state comes from it and actions are sent to it */
  online?: OnlineLink;
}) {
  const [localState, setState] = useState(initial);
  const state = online ? online.state : localState;
  const [history, setHistory] = useState<GameState[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [defendSel, setDefendSel] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const setHover = (c: Card | null) => void c; // hover pop-outs are handled globally by HoverCardLayer
  const [detail, setDetail] = useState<Card | null>(null);
  const [zone, setZone] = useState<{ title: string; cards: CardInst[] } | null>(null);
  const [showHint, setShowHint] = useState(tutorial);
  const [modePick, setModePick] = useState<PlayOption | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState<'log' | 'manual' | null>(null);
  const [sound, setSound] = useState(soundEnabled);
  const handRef = useRef<HTMLDivElement>(null);
  const oppHandRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<{ uid: number; x: number; y: number; moved: boolean; el: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  // On short landscape touch screens the hand is a strip: the first tap raises it, the next tap plays.
  const [handOpen, setHandOpen] = useState(false);
  const compactTouch = () => !!window.matchMedia?.('(orientation: landscape) and (max-height: 560px) and (pointer: coarse)').matches;
  useEffect(() => {
    document.documentElement.classList.add('in-game');
    return () => document.documentElement.classList.remove('in-game');
  }, []);
  const skipFx = useRef(false);
  const lastClick = useRef<DOMRect | null>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  const fx = useFx(state, skipFx);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHandOpen(false); }, [state]);
  useZoneGlide(oppHandRef);
  const colRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = colRef.current;
    if (!el || !fx.shakeKey) return;
    el.classList.remove('shake');
    void el.offsetWidth; // restart the animation
    el.classList.add('shake');
  }, [fx.shakeKey]);
  const [overlay, setOverlay] = useState(false);
  const reported = useRef(false);
  useEffect(() => {
    if (state.phase !== 'gameOver') return;
    if (!reported.current) { reported.current = true; onGameOver?.(state); }
    const t = setTimeout(() => setOverlay(true), 700);
    return () => clearTimeout(t);
  }, [state, onGameOver]);

  const me = state.players[HUMAN];
  const opp = state.players[1];
  const myTurn = state.priority === HUMAN && state.phase !== 'gameOver';
  const options = useMemo(() => (myTurn ? playOptions(state, HUMAN) : []), [state, myTurn]);
  const defOpts = useMemo(() => (myTurn ? defendOptions(state, HUMAN) : []), [state, myTurn]);
  const hint = useMemo(() => (myTurn && showHint ? chooseAction(state, HUMAN, 'hard') : null), [state, myTurn, showHint]);
  const link = currentLink(state);

  const act = (a: Action, snapshot = true) => {
    try {
      const next = applyAction(state, a); // validates the move (throws if illegal)
      if (online) online.send(a);
      else {
        if (snapshot) setHistory((h) => [...h.slice(-30), state]);
        setState(next);
      }
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

  // settings: auto-pay (pick pitch automatically) and auto-pass (skip steps with nothing to do)
  const [autoPay, setAutoPay] = useState(() => readSetting('autopay', true));
  const [autoPass, setAutoPass] = useState(() => readSetting('autopass', true));
  const shiftHeld = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { shiftHeld.current = e.shiftKey; };
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => { window.removeEventListener('keydown', on); window.removeEventListener('keyup', on); };
  }, []);
  // auto end turn when nothing can be played, and auto "no block" when nothing can block
  useEffect(() => {
    if (!autoPass || !myTurn || pending) return;
    const nothingToPlay = state.phase === 'action' && options.length === 0;
    const nothingToBlock = state.phase === 'defend' && defOpts.length === 0;
    if (!nothingToPlay && !nothingToBlock) return;
    const t = setTimeout(() => {
      if (sendOnline) sendOnline(nothingToBlock ? { type: 'defend', uids: [] } : { type: 'pass' });
      else setState((s) => (s.priority === HUMAN && s.phase === state.phase ? applyAction(s, nothingToBlock ? { type: 'defend', uids: [] } : { type: 'pass' }) : s));
    }, nothingToPlay ? 1100 : 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, myTurn, options.length, defOpts.length, autoPass, pending]);

  // auto-pass reactions when there is nothing to respond with
  const sendOnline = online?.send;
  useEffect(() => {
    if (!myTurn || state.phase !== 'reaction' || options.length > 0) return;
    const t = setTimeout(() => {
      if (sendOnline) sendOnline({ type: 'pass' });
      else setState((s) => (s.priority === HUMAN && s.phase === 'reaction' ? applyAction(s, { type: 'pass' }) : s));
    }, 450);
    return () => clearTimeout(t);
  }, [state, myTurn, options.length, sendOnline]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [state.log.length, drawer]);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    skipFx.current = true;
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
    if (autoPay && !shiftHeld.current) {
      // like auto-tapping mana: pick the cheapest cards to pitch automatically (hold Shift to choose)
      const auto = autoPitch(me, opt.cost, exclude);
      if (auto) return act(opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch: auto, mode } : { type: 'activate', uid: opt.uid, index: opt.index, pitch: auto });
    }
    setPending({ opt, pitch: [], mode });
  };
  const finishPay = (pitch: number[]) => {
    if (!pending) return;
    const { opt, mode } = pending;
    act(opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch, mode } : { type: 'activate', uid: opt.uid, index: opt.index, pitch });
  };
  const pitchTotal = pending ? me.resources + pending.pitch.reduce((a, u) => a + pitchOf(cardOf(me.hand.find((h) => h.uid === u)!)), 0) : 0;

  const rememberRect = (uid: number) => {
    lastClick.current = document.querySelector(`[data-uid="${uid}"]`)?.getBoundingClientRect() ?? null;
  };
  const clickHand = (inst: CardInst, rect?: DOMRect) => {
    setError(null);
    if (rect) lastClick.current = rect;
    else rememberRect(inst.uid);
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
    rememberRect(inst.uid);
    if (myTurn && state.phase === 'defend' && defOpts.some((d) => d.uid === inst.uid)) {
      return setDefendSel(defendSel.includes(inst.uid) ? defendSel.filter((u) => u !== inst.uid) : [...defendSel, inst.uid]);
    }
    const acts = options.filter((o) => o.uid === inst.uid && o.kind === 'activation');
    if (acts.length && !pending) return startPlay(acts[0]);
    setDetail(cardOf(inst));
  };

  // ---- drag a card out of the hand onto the battlefield to play it
  const dragStart = (e: React.PointerEvent<HTMLDivElement>, inst: CardInst) => {
    if (e.button !== 0) return;
    dragRef.current = { uid: inst.uid, x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget };
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 10) return;
    if (!d.moved) {
      d.moved = true;
      hideHover();
      d.el.setPointerCapture(e.pointerId);
      d.el.classList.add('dragging');
      setDragging(true);
    }
    d.el.style.setProperty('--dx', `${dx}px`);
    d.el.style.setProperty('--dy', `${dy}px`);
    const top = handRef.current?.getBoundingClientRect().top ?? window.innerHeight;
    d.el.classList.toggle('will-play', e.clientY < top - 30);
  };
  const dragReset = (el: HTMLElement) => {
    el.classList.remove('dragging', 'will-play');
    el.style.removeProperty('--dx');
    el.style.removeProperty('--dy');
    setDragging(false);
  };
  const dragEnd = (e: React.PointerEvent<HTMLDivElement>, inst: CardInst) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 50);
    const rect = d.el.querySelector('.card')?.getBoundingClientRect();
    const top = handRef.current?.getBoundingClientRect().top ?? window.innerHeight;
    dragReset(d.el);
    if (e.clientY < top - 30) clickHand(inst, rect);
  };
  const dragCancel = () => {
    if (dragRef.current) dragReset(dragRef.current.el);
    dragRef.current = null;
  };

  // ---- prompt
  const defendTotal = defendSel.reduce((a, u) => a + (defOpts.find((d) => d.uid === u)?.defense ?? 0), 0);
  const defendErr = state.phase === 'defend' && myTurn ? checkDefense(state, defendSel) : null;
  let prompt: React.ReactNode;
  if (state.phase === 'gameOver') {
    prompt = (
      <>
        <span className="msg"><b>{state.winner === HUMAN ? '🏆 Victory!' : '💀 Defeat.'}</b> {state.players[state.winner ?? 0].name} wins on turn {state.turn}.</span>
        {onRematch && <button className="primary" onClick={onRematch}>Rematch</button>}
        <button onClick={onExit}>New game</button>
      </>
    );
  } else if (!myTurn) {
    prompt = (
      <>
        <span className="msg muted">{state.players[state.priority].name} is thinking…</span>
        <button className="primary waiting" disabled>Opponent’s Move</button>
      </>
    );
  } else if (pending) {
    prompt = (
      <>
        <span className="msg">Pitch cards to pay for <b>{pending.opt.label}</b> <span className="pay-meter">{pitchTotal} / {pending.opt.cost}</span></span>
        <button className="gold" onClick={() => { const p = autoPitch(me, pending.opt.cost, pending.opt.kind === 'card' ? [pending.opt.uid] : []); if (p) finishPay(p); }}>Auto-pay</button>
        <button onClick={() => setPending(null)}>Cancel</button>
      </>
    );
  } else if (state.phase === 'defend' && link) {
    const incoming = linkPower(link);
    prompt = (
      <>
        <span className="msg">
          <b>{cardOf(link.inst).name}</b> attacks for <b>{incoming}</b>{link.dominate ? ' · dominate (max 1 from hand)' : ''}{link.overpower ? ' · overpower (max 1 action)' : ''}.
          {' '}Pick blockers. You take <b className="pay-meter">{Math.max(0, incoming - defendTotal)}</b>
          {defendErr && <span className="err"> {defendErr}</span>}
        </span>
        <button className="primary" disabled={!!defendErr} onClick={() => act({ type: 'defend', uids: defendSel })}>{defendSel.length ? `Block ${defendTotal}` : 'No Blocks'}</button>
      </>
    );
  } else if (state.phase === 'reaction' && link) {
    const mine = link.attacker === HUMAN;
    prompt = (
      <>
        <span className="msg">
          Reactions · {cardOf(link.inst).name} <b>{linkPower(link)}</b> vs <b>{linkDefense(link)}</b>.{' '}
          {mine ? 'Attack reactions or instants?' : 'Defense reactions or instants?'}
        </span>
        <button className="primary" onClick={() => act({ type: 'pass' })}>Pass</button>
      </>
    );
  } else if (state.phase === 'arsenal') {
    prompt = (
      <>
        <span className="msg">End phase: choose a card for your arsenal.</span>
        <button className="primary" onClick={() => act({ type: 'arsenal', uid: null })}>No Arsenal</button>
      </>
    );
  } else {
    prompt = (
      <>
        <span className="msg">
          {me.actionPoints > 0 ? `${me.actionPoints} action point${me.actionPoints > 1 ? 's' : ''}. Drag or click a glowing card.` : 'No action points left.'}
        </span>
        <button className="primary" onClick={() => act({ type: 'pass' })}>{state.chainOpen ? 'Close Chain · End Turn' : 'End Turn'}</button>
      </>
    );
  }

  const handClass = (inst: CardInst) => {
    if (pending) return pending.pitch.includes(inst.uid) ? 'pitchsel' : pending.opt.uid === inst.uid ? 'sel' : '';
    if (state.phase === 'defend' && myTurn) return defendSel.includes(inst.uid) ? 'sel' : defOpts.some((d) => d.uid === inst.uid) ? '' : 'dim';
    if (myTurn && optionFor(inst.uid)) return 'playable';
    return '';
  };

  const phaseStep = state.phase === 'action' ? 1 : state.phase === 'defend' ? 2 : state.phase === 'reaction' ? 3 : state.phase === 'arsenal' ? 4 : -1;
  const n = me.hand.length;

  return (
    <div className="arena">
      <div className="arena-bar">
        <span className="arena-title">{state.format === 'cc' ? 'Classic Constructed' : state.format === 'blitz' ? 'Blitz' : 'Casual'} · Turn {state.turn}</span>
        <div className="grow" />
        {online && (
          <span className={`online-badge ${online.opponent?.connected === false ? 'warn' : ''}`}>
            ● Online{online.opponent?.connected === false ? ' · opponent disconnected (they forfeit in 2 min)' : ''}
          </span>
        )}
        {!online && <button className={`icon-btn ${showHint ? 'on' : ''}`} title="Move suggestions" onClick={() => setShowHint(!showHint)}>💡<span>Hint</span></button>}
        {!online && <button className="icon-btn" title="Undo" disabled={!history.length} onClick={undo}>↶<span>Undo</span></button>}
        <button className={`icon-btn ${drawer === 'log' ? 'on' : ''}`} title="Game log" onClick={() => setDrawer(drawer === 'log' ? null : 'log')}>📜<span>Log</span></button>
        {!online && <button className={`icon-btn ${drawer === 'manual' ? 'on' : ''}`} title="Manual controls" onClick={() => setDrawer(drawer === 'manual' ? null : 'manual')}>🛠<span>Manual</span></button>}
        <button className={`icon-btn ${autoPay ? 'on' : ''}`} title="Auto-pay: pitch cards automatically when you play something (hold Shift to choose yourself)" onClick={() => { writeSetting('autopay', !autoPay); setAutoPay(!autoPay); }}>⛀<span>Auto-pay</span></button>
        <button className={`icon-btn ${autoPass ? 'on' : ''}`} title="Auto-pass: end your turn / skip blocking automatically when you have nothing to do" onClick={() => { writeSetting('autopass', !autoPass); setAutoPass(!autoPass); }}>⏭<span>Auto-pass</span></button>
        <button className="icon-btn" title="Sound" onClick={() => { setSoundEnabled(!sound); setSound(!sound); }}>{sound ? '🔊' : '🔇'}</button>
        <button className="icon-btn" title="Concede" onClick={() => { if (confirm('Concede this game?')) act({ type: 'concede' }); }} disabled={state.phase === 'gameOver' || (!online && !myTurn)}>⚑<span>Concede</span></button>
        <button className="icon-btn" title="Leave game" onClick={() => { if (state.phase === 'gameOver' || confirm('Leave this game?')) onExit(); }}>✕</button>
      </div>

      <div className="opp-hand" ref={oppHandRef} title={`${opp.name}: ${opp.hand.length} cards in hand`}>
        {opp.hand.map((h, i) => {
          const off = i - (opp.hand.length - 1) / 2;
          return <div key={h.uid} className="opp-hand-card anim-fade-up" style={{ rotate: `${-off * 5}deg`, translate: `0 ${-Math.abs(off) * Math.abs(off) * 3}px` }}><CardBack width="var(--ohw)" /></div>;
        })}
      </div>

      <div className="arena-board" ref={colRef}>
        <div className="mat">
          <div ref={oppRef}>
            <PlayerArea p={opp} state={state} isOpp onHover={setHover} onClickArena={(i) => setDetail(cardOf(i))} onZone={setZone} fx={fx} />
          </div>
          <ChainView state={state} onHover={setHover} onClick={(c) => setDetail(c)} lastClick={lastClick} oppRef={oppHandRef} />
          <PlayerArea
            p={me}
            state={state}
            onHover={setHover}
            onClickArena={clickArena}
            onZone={setZone}
            arenaClass={(inst) => {
              if (myTurn && state.phase === 'defend') return defendSel.includes(inst.uid) ? 'sel' : '';
              return myTurn && options.some((o) => o.uid === inst.uid && o.kind === 'activation') ? 'playable' : '';
            }}
            arsenalClick={(i) => clickHand(i)}
            arsenalClass={handClass}
            fx={fx}
          />
        </div>
      </div>

      {handOpen && !pending && <div className="hand-scrim" onClick={() => setHandOpen(false)} />}
      <div className={`hand-fan ${dragging ? 'is-dragging' : ''} ${handOpen || pending ? 'open' : ''}`} ref={handRef}>
        {me.hand.map((inst, i) => {
          const off = i - (n - 1) / 2;
          return (
            <div
              key={inst.uid}
              data-uid={inst.uid}
              data-flip={inst.uid}
              data-from="mydeck"
              className="fan-card"
              style={{ rotate: `${off * Math.min(5, 26 / Math.max(n, 1))}deg`, translate: `0 ${Math.abs(off) * Math.abs(off) * 4}px`, zIndex: i + 1 }}
              onPointerDown={(e) => dragStart(e, inst)}
              onPointerMove={dragMove}
              onPointerUp={(e) => dragEnd(e, inst)}
              onPointerCancel={dragCancel}
              onMouseEnter={() => sfx('hover')}
            >
              <div className={motionOk() ? '' : 'anim-deal'}>
                <CardView card={cardOf(inst)} width="var(--hw)" className={handClass(inst)} tilt={false}
                  onClick={() => {
                    if (suppressClick.current) { suppressClick.current = false; return; }
                    if (!handOpen && compactTouch()) { setHandOpen(true); return; }
                    clickHand(inst);
                  }}
                  onHover={setHover}
                  badge={pending && pitchOf(cardOf(inst)) ? `+${pitchOf(cardOf(inst))}` : undefined} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="dock">
        <div className="phase-ladder" title="Turn structure">
          {['Start', 'Action', 'Defend', 'Reaction', 'End'].map((label, i) => (
            <span key={label} className={`${i === phaseStep ? 'now' : ''} ${state.turnPlayer === HUMAN ? 'mine' : 'theirs'}`}>{label}</span>
          ))}
        </div>
        <div className={`prompt ${myTurn ? 'your-move' : ''}`}>{prompt}</div>
        {(error || online?.error) && <div className="dock-error">{error ?? online?.error}</div>}
      </div>

      {hint && showHint && state.phase !== 'gameOver' && (
        <div className="hint arena-hint">
          <b>💡 {describeAction(state, hint.action)}</b>
          <div className="muted small">{hint.reason}</div>
        </div>
      )}

      {drawer && (
        <div className="drawer">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{drawer === 'log' ? 'Game log' : 'Manual controls'}</h3>
            <button className="small" onClick={() => setDrawer(null)}>✕</button>
          </div>
          {drawer === 'manual' && <ManualTools state={state} act={act} />}
          {drawer === 'log' && (
            <div className="log" ref={logRef}>
              {state.log.slice(-250).map((l, i) => (
                <div key={i} className={l.player === HUMAN ? 'me' : l.player === 1 ? 'them' : 'muted'}>{l.text}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <AttackArrow state={state} />
      {fx.lifeAnim[HUMAN] === 'hurt' && fx.lifeKey[HUMAN] > 0 && <div key={`vig${fx.lifeKey[HUMAN]}`} className="hurt-vignette" />}
      {fx.banner && <TurnBanner key={fx.banner.id} text={fx.banner.text} mine={fx.banner.mine} />}
      {overlay && state.phase === 'gameOver' && (
        <GameOverOverlay won={state.winner === HUMAN}>
          <h1>{state.winner === HUMAN ? 'Victory' : 'Defeat'}</h1>
          <p style={{ fontSize: '1.1rem' }}>
            {state.winner === HUMAN ? `You defeated ${opp.name.replace(' (bot)', '')}` : `${opp.name.replace(' (bot)', '')} wins`} on turn {state.turn}
            {' '}· you finished on {Math.max(0, me.life)} life.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            {onRematch && <button className="primary" onClick={onRematch}>Rematch</button>}
            <button className="gold" onClick={onExit}>New game</button>
            <button onClick={() => setOverlay(false)}>View board</button>
          </div>
        </GameOverOverlay>
      )}
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

const SLOT = 'var(--slot)';

/** A framed zone on the playmat. Shows its label when empty. */
function Slot({ area, label, filled, onClick, className = '', children, uid, count }: {
  area: string; label: string; filled: boolean; onClick?: () => void; className?: string; children?: React.ReactNode; uid?: number; count?: number;
}) {
  return (
    <div className={`slot ${filled ? 'filled' : ''} ${className}`} style={{ gridArea: area }} onClick={onClick} data-uid={uid} data-flip={uid} data-area={area}>
      {!filled && <span className="slot-label">{label}</span>}
      {children}
      {filled && <span className="slot-tag">{label}{count !== undefined ? ` · ${count}` : ''}</span>}
    </div>
  );
}

function PlayerArea({ p, state, isOpp, onHover, onClickArena, onZone, arenaClass, arsenalClick, arsenalClass, fx }: {
  p: PlayerState; state: GameState; isOpp?: boolean; onHover: (c: Card | null) => void; onClickArena: (i: CardInst) => void;
  onZone: (z: { title: string; cards: CardInst[] }) => void; arenaClass?: (i: CardInst) => string;
  arsenalClick?: (i: CardInst) => void; arsenalClass?: (i: CardInst) => string; fx: Fx;
}) {
  const active = state.turnPlayer === p.id;
  const effects = pendingEffectsText(p);
  // map equipment / weapons onto the mat's fixed slots
  const used = new Set<number>();
  const eq = (t: string) => {
    const e = p.equipment.find((x) => !used.has(x.inst.uid) && cardOf(x.inst).types.includes(t));
    if (e) used.add(e.inst.uid);
    return e;
  };
  const head = eq('Head');
  const chest = eq('Chest');
  const arms = eq('Arms');
  const legs = eq('Legs');
  const offHand = eq('Off-Hand');
  const extraEquip = p.equipment.filter((e) => !used.has(e.inst.uid));
  const [w1, w2] = p.weapons;

  const equipSlot = (area: string, label: string, e?: EquipState) => (
    <Slot area={area} label={label} filled={!!e} uid={e?.inst.uid}>
      {e && (
        <CardView card={cardOf(e.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(e.inst)}
          className={`${e.destroyed ? 'destroyed' : ''} ${arenaClass?.(e.inst) ?? ''}`}
          badge={e.destroyed ? 'destroyed' : e.defenseMod ? `⛨${equipDefense(e)}` : undefined} />
      )}
    </Slot>
  );
  const weaponSlot = (area: string, w?: { inst: CardInst; usedThisTurn: boolean }, e?: EquipState) => (
    <Slot area={area} label="Weapon" filled={!!(w || e)} uid={w?.inst.uid ?? e?.inst.uid}>
      {w && <CardView card={cardOf(w.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(w.inst)} className={`${arenaClass?.(w.inst) ?? ''} ${w.usedThisTurn ? 'dim' : ''}`} />}
      {!w && e && <CardView card={cardOf(e.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(e.inst)} className={`${e.destroyed ? 'destroyed' : ''} ${arenaClass?.(e.inst) ?? ''}`} />}
    </Slot>
  );
  const pile = (area: string, label: string, cards: CardInst[], anim: string, title: string) => {
    const top = cards[cards.length - 1];
    return (
      <Slot area={area} label={label} filled={!!top} count={cards.length} onClick={() => onZone({ title, cards })} className="clickable">
        {top && (
          <div key={top.uid} className="flip-wrap" data-flip={top.uid} data-from={isOpp ? 'opphand' : undefined}>
            <CardView card={cardOf(top)} width={SLOT} className={anim} tilt={false} />
          </div>
        )}
      </Slot>
    );
  };

  return (
    <div className={`mat-side ${isOpp ? 'opp' : 'me'} ${active ? 'active' : ''}`}>
      {equipSlot('head', 'Head', head)}
      {equipSlot('chest', 'Chest', chest)}
      {equipSlot('arms', 'Arms', arms)}
      {equipSlot('legs', 'Legs', legs)}
      {weaponSlot('weapL', w1, w1 ? undefined : offHand)}
      {weaponSlot('weapR', w2, w1 ? offHand : undefined)}
      <Slot area="hero" label="Hero" filled className="hero-box">
        <CardView card={cardOf(p.hero)} width={SLOT} onHover={onHover} onClick={() => onClickArena(p.hero)} />
        <div key={fx.lifeKey[p.id]} className={`life-orb life ${fx.lifeAnim[p.id]}`} title="Life"><RollingNumber value={p.life} /></div>
        {fx.lifeAnim[p.id] === 'hurt' && fx.lifeKey[p.id] > 0 && <ImpactBurst key={`impact${fx.lifeKey[p.id]}`} />}
        {fx.lifeAnim[p.id] === 'heal' && fx.lifeKey[p.id] > 0 && <ImpactBurst key={`heal${fx.lifeKey[p.id]}`} heal />}
        {fx.floaters.filter((f) => f.player === p.id).map((f) => (
          <span key={f.id} className={`floater ${f.amount < 0 ? 'dmg' : 'gain'}`}>{f.amount > 0 ? `+${f.amount}` : f.amount}</span>
        ))}
      </Slot>
      <Slot area="arsenal" label="Arsenal" filled={p.arsenal.length > 0} uid={p.arsenal[0]?.uid}>
        {p.arsenal[0] && (isOpp
          ? <div key={p.arsenal[0].uid} className="flip-wrap" data-flip={p.arsenal[0].uid} data-from="opphand"><CardBack width={SLOT} label="A" /></div>
          : <div key={p.arsenal[0].uid} className="flip-wrap" data-flip={p.arsenal[0].uid}><CardView card={cardOf(p.arsenal[0])} width={SLOT} onHover={onHover} onClick={() => arsenalClick?.(p.arsenal[0])} className={arsenalClass?.(p.arsenal[0])} /></div>)}
      </Slot>
      <Slot area="deck" label="Deck" filled={p.deck.length > 0}>
        {p.deck.length > 0 && <CardBack width={SLOT} label={p.deck.length} />}
      </Slot>
      {pile('pitch', 'Pitch', p.pitch, 'anim-pitch', `${p.name}'s pitch zone`)}
      {pile('grave', 'Graveyard', p.graveyard, '', `${p.name}'s graveyard`)}
      {pile('banish', 'Banished', p.banished, '', `${p.name}'s banished zone`)}

      <div className="mat-info" style={{ gridArea: 'info' }}>
        <div className="mat-name">{active && <span className="turn-dot" title="Their turn" />}{p.name}</div>
        <div className="res small">
          <span key={`r${p.resources}`} className={p.resources ? 'anim-pulse' : ''} title="Floating resources">⛀ {p.resources}</span>
          <span key={`a${p.actionPoints}`} className={p.actionPoints ? 'anim-pulse' : ''} style={{ '--pulse': '#f2e14e' } as React.CSSProperties} title="Action points">⚡ {p.actionPoints}</span>
          {isOpp && <span title="Cards in hand">✋ {p.hand.length}{p.intimidated.length ? ` (+${p.intimidated.length})` : ''}</span>}
        </div>
      </div>
      <div className="mat-effects" style={{ gridArea: 'fx' }}>
        {effects.map((e) => <span key={e} className="tag anim-pop">{e}</span>)}
      </div>
      <div className="mat-perms" style={{ gridArea: 'perm' }}>
        {[...extraEquip.map((e) => ({ inst: e.inst, destroyed: e.destroyed })), ...p.permanents.map((pm) => ({ inst: pm.inst, destroyed: false }))].map(({ inst, destroyed }) => (
          <div key={inst.uid} data-uid={inst.uid} data-flip={inst.uid} className="anim-pop">
            <CardView card={cardOf(inst)} width="calc(var(--slot) * .62)" onHover={onHover} onClick={() => onClickArena(inst)} className={`${destroyed ? 'destroyed' : ''} ${arenaClass?.(inst) ?? ''}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainView({ state, onHover, onClick, lastClick, oppRef }: {
  state: GameState; onHover: (c: Card | null) => void; onClick: (c: Card) => void;
  lastClick: React.MutableRefObject<DOMRect | null>; oppRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="mat-chain">
      <div className="chain-title flip">Combat Chain</div>
      <div className="chain-track">
        <span className="chain-start">Chain link 1 starts here</span>
        <div className="chain-links">
          {state.chain.map((l, i) => (
            <ChainLinkView key={l.inst.uid + '-' + i} l={l} state={state} onHover={onHover} onClick={onClick} lastClick={lastClick} oppRef={oppRef} />
          ))}
        </div>
      </div>
      <div className="chain-title">Combat Chain</div>
    </div>
  );
}

function ChainLinkView({ l, state, onHover, onClick, lastClick, oppRef }: {
  l: ChainLink; state: GameState; onHover: (c: Card | null) => void; onClick: (c: Card) => void;
  lastClick: React.MutableRefObject<DOMRect | null>; oppRef: React.RefObject<HTMLDivElement | null>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // FLIP: fly the attacking card from where it was played (hand, weapon, or the opponent's side)
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !motionOk() || !el.animate) return;
    const to = el.getBoundingClientRect();
    let from: DOMRect | null = null;
    const src = document.querySelector(`.side [data-uid="${l.inst.uid}"]`);
    if (src) from = src.getBoundingClientRect();
    else if (l.attacker === HUMAN) from = lastClick.current;
    else from = oppRef.current?.getBoundingClientRect() ?? null;
    if (!from) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sc = Math.max(0.5, Math.min(1.6, from.width / to.width));
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${l.attacker === HUMAN ? -8 : 8}deg)`, filter: 'brightness(1.6)', zIndex: 30 },
      { transform: 'translate(0,0) scale(1.15) rotate(0deg)', filter: 'brightness(1.3)', offset: 0.75 },
      { transform: 'none', filter: 'none' },
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`link ${l.damage !== null ? 'done' : ''}`}>
      <div ref={cardRef} style={{ position: 'relative', zIndex: 2 }} className="chain-card">
        <span className="land-ring" />
        <CardView card={cardOf(l.inst)} width="calc(var(--slot) * .86)" onHover={onHover} onClick={() => onClick(cardOf(l.inst))} badge={<span key={linkPower(l)} className="anim-pop">⚔ {linkPower(l)}</span>} />
      </div>
      {l.defenders.length > 0 && <span className="muted anim-pop">vs</span>}
      {l.defenders.map((d) => (
        <div key={d.inst.uid} className="defender" data-flip={d.inst.uid} data-from={d.inst.owner === HUMAN ? undefined : 'opphand'}>
          <CardView card={cardOf(d.inst)} width="calc(var(--slot) * .7)" onHover={onHover} onClick={() => onClick(cardOf(d.inst))} badge={`⛨${d.defense}`} />
        </div>
      ))}
      <div className="col small" style={{ minWidth: 70 }}>
        <span>{state.players[l.attacker].name}</span>
        {l.goAgain && <span className="tag anim-pop">⚡ go again</span>}
        {l.dominate && <span className="tag anim-pop">dominate</span>}
        {l.damage !== null && <b className={`anim-pop ${l.hit ? 'err' : 'muted'}`}>{l.hit ? `💥 hit for ${l.damage}` : '🛡 blocked'}</b>}
      </div>
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

/** Number that counts toward its new value (life totals). */
function RollingNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || !motionOk()) { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    const dur = Math.min(900, 120 * Math.abs(value - start) + 200);
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <>{shown}</>;
}

/** Sparks bursting out of a hero when it takes damage (or soft motes when it heals). */
function ImpactBurst({ heal }: { heal?: boolean }) {
  const sparks = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const d = 40 + Math.random() * 50;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: 4 + Math.random() * 5, delay: Math.random() * 80 };
  }), []);
  return (
    <span className={`impact ${heal ? 'heal' : ''}`} aria-hidden>
      <span className="impact-ring" />
      {sparks.map((p, i) => (
        <span key={i} className="spark" style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, width: p.s, height: p.s, animationDelay: `${p.delay}ms` } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** Curved targeting arrow from the attacking card to the hero it attacks, while the attack is pending. */
function AttackArrow({ state }: { state: GameState }) {
  const link = currentLink(state);
  const [path, setPath] = useState<{ d: string; tip: [number, number]; angle: number } | null>(null);
  const active = !!link && (state.phase === 'defend' || state.phase === 'reaction');
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active || !link) { setPath(null); return; }
    const measure = () => {
      const from = document.querySelector('.chain-links .link:last-child .chain-card')?.getBoundingClientRect();
      const to = document.querySelector(`.mat-side.${link.attacker === HUMAN ? 'opp' : 'me'} .hero-box`)?.getBoundingClientRect();
      if (!from || !to) return setPath(null);
      const x1 = from.left + from.width / 2;
      const y1 = link.attacker === HUMAN ? from.top + 6 : from.bottom - 6;
      const x2 = to.left + to.width / 2;
      const y2 = link.attacker === HUMAN ? to.bottom - to.height * 0.25 : to.top + to.height * 0.25;
      const cx = (x1 + x2) / 2 + (x2 > x1 ? -1 : 1) * Math.min(160, Math.abs(y2 - y1) * 0.4);
      const cy = (y1 + y2) / 2;
      const angle = Math.atan2(y2 - cy, x2 - cx) * 180 / Math.PI;
      setPath({ d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, tip: [x2, y2], angle });
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(measure)); // after glide animations settle
    const late = setTimeout(measure, 600);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(id); clearTimeout(late); window.removeEventListener('resize', measure); };
  }, [active, link, state]);
  if (!path) return null;
  const mine = link?.attacker === HUMAN;
  return (
    <svg className={`attack-arrow ${mine ? 'mine' : 'theirs'}`} aria-hidden>
      <defs>
        <linearGradient id="arrowGrad" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mine ? '#ffb347' : '#7fb3ff'} stopOpacity="0.15" />
          <stop offset="1" stopColor={mine ? '#ff5a3a' : '#4a8bff'} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={path.d} className="arrow-glow" />
      <path d={path.d} className="arrow-line" />
      <g transform={`translate(${path.tip[0]} ${path.tip[1]}) rotate(${path.angle})`}>
        <path d="M 0 0 L -22 -12 L -16 0 L -22 12 Z" className="arrow-head" />
      </g>
    </svg>
  );
}
