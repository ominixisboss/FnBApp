import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '../../data/types';
import {
  applyAction, autoPitch, availableResources, cardOf, checkDefense, currentLink, defendOptions, HAND_INDEX, optionalPayable,
  equipDefense, linkDefense, linkPower, pendingEffectsText, pitchOf, playOptions,
} from '../../engine/game';
import type { PlayOption } from '../../engine/game';
import type { Action, CardInst, EquipState, GameState, OptionalChoice, PlayerId, PlayerState, Zone } from '../../engine/types';
import { decideOptional, describeAction } from '../../ai/bot';
import type { BotDecision } from '../../ai/bot';
import { askBot } from '../../ai/botClient';
import { getScript } from '../../engine/cardScript';
import { formatName } from '../../deck/deck';
import { getDb } from '../../data/cardDb';
import CardView, { CardBack } from './CardView';
import CardDetail from './CardDetail';
import { GameOverOverlay, TurnBanner, animationsEnabled } from './Fx';
import { setSoundEnabled, sfx, soundEnabled } from '../sound';
import { musicEnabled, setMusicEnabled, setMusicMood } from '../music';
import { buzz, canVibrate, hapticsEnabled, setHapticsEnabled } from '../haptics';
import { hideHover } from './HoverCard';
import { computeProgress, progressDiff } from '../../stats/progress';
import type { MatchStats, Progress } from '../../stats/progress';
import { loadMatches } from '../../stats/matches';
import { addDrill } from '../../learn/drills';
import { HintArrows, MatchIntro, damageSource, themeOf, useVfx } from './Vfx';
import type { Theme } from './Vfx';
import type { ChainLink } from '../../engine/types';

const HUMAN: PlayerId = 0;
const BOT_DELAY = 650;

interface Pending { opt: PlayOption; pitch: number[]; mode?: number; optional?: OptionalChoice }

interface Floater { id: number; player: PlayerId; amount: number }
interface Fx { floaters: Floater[]; lifeAnim: [string, string]; lifeKey: [number, number]; theme: [Theme, Theme]; shakeKey: number; banner: { id: number; text: string; mine: boolean } | null }

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

/** Vibration for the moments that matter to you: being hit, landing hits, blocking, playing, your turn. */
function playHaptics(a: GameState, b: GameState) {
  if (b.phase === 'gameOver' && a.phase !== 'gameOver') return buzz(b.winner === HUMAN ? 'win' : 'lose');
  const myLoss = a.players[HUMAN].life - b.players[HUMAN].life;
  const theirLoss = a.players[1].life - b.players[1].life;
  if (myLoss >= 5) return buzz('bigHit');
  if (myLoss > 0) return buzz('hit');
  if (theirLoss > 0) return buzz('dealt');
  const lastB = b.chain[b.chain.length - 1];
  const defA = a.chain[a.chain.length - 1]?.defenders.length ?? 0;
  if (lastB && b.chain.length === a.chain.length && lastB.defenders.length > defA && lastB.attacker !== HUMAN) return buzz('block');
  if (b.players[HUMAN].turn.played.length > a.players[HUMAN].turn.played.length || (b.chain.length > a.chain.length && b.chain[b.chain.length - 1].attacker === HUMAN)) return buzz('play');
  if (b.turn !== a.turn && b.turnPlayer === HUMAN) buzz('myTurn');
}

/**
 * "Magic move": after every render, any card element that is new in the DOM glides from where the
 * same card was last seen (another zone), or from its source pile (your deck, the opponent's hand).
 */
function useZoneGlide(oppHandRef: React.RefObject<HTMLDivElement | null>, state: GameState) {
  const rects = useRef(new Map<string, DOMRect>());
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.arena [data-flip]'));
    const next = new Map<string, DOMRect>();
    const motion = motionOk();
    const fallback = (from?: string): DOMRect | null => {
      if (from === 'mydeck') return document.querySelector('.mat-side.me [data-area="deck"]')?.getBoundingClientRect() ?? null;
      if (from === 'opphand') return oppHandRef.current?.getBoundingClientRect() ?? null;
      if (from === 'oppdeck') return document.querySelector('.mat-side.opp [data-area="deck"]')?.getBoundingClientRect() ?? null;
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
        { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${fromDeck ? -14 : 0}deg)`, opacity: fromDeck ? 0.4 : 1 },
        { transform: 'translate(0, 0) scale(1.06)', opacity: 1, offset: 0.7 },
        { transform: 'scale(.97)', opacity: 1, offset: 0.86 },
        { transform: 'none', opacity: 1 },
      ], { duration: fromDeck ? 520 : 440, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
    rects.current = next;
    // only when the game changes: measuring every card forces a layout, so skip renders where nothing moved
  }, [state, oppHandRef]);
}

/** Watches state transitions and produces short-lived visual effects. */
function useFx(state: GameState, skip: React.MutableRefObject<boolean>): Fx {
  const prev = useRef<GameState | null>(null);
  const seq = useRef(1);
  const [fx, setFx] = useState<Fx>({ floaters: [], lifeAnim: ['', ''], lifeKey: [0, 0], theme: ['normal', 'normal'], shakeKey: 0, banner: null });
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (skip.current) { skip.current = false; return; }
    const next: Partial<Fx> = {};
    const floaters: Floater[] = [];
    const lifeAnim: [string, string] = [...fx.lifeAnim];
    const lifeKey: [number, number] = [...fx.lifeKey];
    const theme: [Theme, Theme] = [...fx.theme];
    let shake = false;
    if (before) {
      for (const pid of [0, 1] as PlayerId[]) {
        const d = state.players[pid].life - before.players[pid].life;
        if (d === 0) continue;
        floaters.push({ id: seq.current++, player: pid, amount: d });
        lifeAnim[pid] = d < 0 ? 'hurt' : 'heal';
        lifeKey[pid]++;
        if (d < 0) {
          // the hit looks like what caused it: dragon fire, lightning, frost, shadow, earth, light or arcane magic
          const src = damageSource(before, state, pid);
          const t = themeOf(src.card);
          theme[pid] = t === 'normal' && src.arcane ? 'arcane' : t;
        }
        if (d <= -5) shake = true;
      }
    }
    if (before) { playSounds(before, state); playHaptics(before, state); }
    if (!before || before.turn !== state.turn) {
      const mine = state.turnPlayer === HUMAN;
      next.banner = { id: seq.current++, text: mine ? 'Your turn' : `${state.players[state.turnPlayer].name.replace(' (bot)', '')}’s turn`, mine };
    }
    if (floaters.length || next.banner || shake) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFx((f) => ({ ...f, ...next, lifeAnim, lifeKey, theme, floaters: [...f.floaters, ...floaters], shakeKey: shake ? f.shakeKey + 1 : f.shakeKey }));
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
  /** private room where manual moves are allowed (like a tabletop) */
  sandbox?: boolean;
  /** the opponent's latest emote, and sending your own */
  emote?: { id: string; at: number } | null;
  sendEmote?: (id: string) => void;
}

export const EMOTES: [string, string, string][] = [['hello', '👋', 'Hello!'], ['gg', '🤝', 'Good game'], ['nice', '👏', 'Nice play!'], ['thinking', '🤔', 'Hmm…'], ['oops', '😅', 'Oops'], ['wow', '😮', 'Wow!']];
function EmoteBubble({ id, mine }: { id: string; mine?: boolean }) {
  const e = EMOTES.find((x) => x[0] === id);
  if (!e) return null;
  return <div className={`emote-bubble ${mine ? 'mine' : 'theirs'}`}><span>{e[1]}</span> {e[2]}</div>;
}

export default function GameBoard({ initial, tutorial, onExit, onRematch, onGameOver, online, cosmetics, extraResult, watch, rematchLabel, sandbox, clock }: {
  initial: GameState; tutorial: boolean; onExit: () => void; onRematch?: () => void; onGameOver?: (s: GameState, stats: MatchStats, replay?: { initial: GameState; actions: Action[] }) => void;
  /** the player's equipped card sleeve and playmat */
  cosmetics?: { sleeve?: string; mat?: string };
  /** extra content for the result screen (gauntlet / puzzle progress) */
  extraResult?: React.ReactNode;
  /** called with every new game state (puzzles use it to spot a failed attempt) */
  watch?: (s: GameState) => void;
  /** what to call the opponent screen's rematch button */
  rematchLabel?: string;
  /** sandbox: start with manual moves on */
  sandbox?: boolean;
  /** chess clock: minutes per player; your time runs while you have priority, and running out loses */
  clock?: number;
  /** when set, the game is played on the server: state comes from it and actions are sent to it */
  online?: OnlineLink;
}) {
  const [localState, setState] = useState(initial);
  // replay recording: every applied action, keyed by the state it produced (undo truncates the log)
  const applied = useRef(new WeakMap<GameState, { from: GameState; a: Action }>());
  const logApply = (s: GameState, a: Action) => { const n = applyAction(s, a); applied.current.set(n, { from: s, a }); return n; };
  const replayLog = useRef<{ state: GameState; a: Action }[]>([]);
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
  const [optPick, setOptPick] = useState<{ opt: PlayOption; mode?: number } | null>(null);
  const [choosePlay, setChoosePlay] = useState<PlayOption[] | null>(null);
  const [boostSel, setBoostSel] = useState<number[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState<'log' | 'manual' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // phone toolbar overflow menu
  const [pitchOrderOn, setPitchOrderOn] = useState(() => readSetting('pitchorder', false));
  // manual moves (sandbox): tap any card to move it anywhere
  const manualAllowed = !online || !!online.sandbox;
  const [manual, setManual] = useState(!!sandbox);
  const [moveMenu, setMoveMenu] = useState<{ inst: CardInst; player: PlayerId } | null>(null);
  const [ordering, setOrdering] = useState<{ action: Action; order: number[] } | null>(null);
  const [vibrate, setVibrate] = useState(hapticsEnabled);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [myEmote, setMyEmote] = useState<{ id: string; at: number } | null>(null);
  // re-render when bubbles should disappear
  const [, setTick] = useState(0);
  useEffect(() => { const t = setTimeout(() => setTick((n) => n + 1), 3600); return () => clearTimeout(t); }, [myEmote, online?.emote]);
  const [sound, setSound] = useState(soundEnabled);
  const [music, setMusic] = useState(musicEnabled);
  useEffect(() => { setMusicMood('battle'); return () => setMusicMood('menu'); }, []);
  const handRef = useRef<HTMLDivElement>(null);
  const oppHandRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<{ uid: number; x: number; y: number; moved: boolean; el: HTMLElement; handTop?: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // On short landscape touch screens the hand is a strip: the first tap raises it, the next tap plays.
  const [handOpen, setHandOpen] = useState(false);
  const compactTouch = () => !!window.matchMedia?.('(orientation: landscape) and (max-height: 560px) and (pointer: coarse)').matches;
  // Android back button while in a game
  useEffect(() => {
    const back = () => { if (state.phase === 'gameOver' || confirm('Leave this game?')) onExit(); };
    window.addEventListener('fab-back', back);
    return () => window.removeEventListener('fab-back', back);
  }, [state.phase, onExit]);
  useEffect(() => {
    document.documentElement.classList.add('in-game');
    return () => document.documentElement.classList.remove('in-game');
  }, []);
  const skipFx = useRef(false);
  const lastClick = useRef<DOMRect | null>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (online) return;
    const log = replayLog.current;
    const tail = log.length ? log[log.length - 1].state : initial;
    const e = applied.current.get(state);
    if (e && e.from === tail) { log.push({ state, a: e.a }); return; }
    if (state === initial) { log.length = 0; return; }
    const i = log.findIndex((x) => x.state === state); // undo
    if (i >= 0) log.length = i + 1;
  }, [state, online, initial]);
  const fx = useFx(state, skipFx);
  // chess clock (local games)
  const [times, setTimes] = useState<[number, number]>(() => [(clock ?? 0) * 60000, (clock ?? 0) * 60000]);
  useEffect(() => {
    if (!clock || online || state.phase === 'gameOver') return;
    const who = state.priority;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setTimes((ts) => { const n: [number, number] = [...ts]; n[who] = Math.max(0, n[who] - dt); return n; });
    }, 250);
    return () => clearInterval(t);
  }, [clock, online, state.priority, state.phase]);
  useEffect(() => {
    if (!clock || online || state.phase === 'gameOver') return;
    const out = times.findIndex((t) => t <= 0) as PlayerId | -1;
    if (out === -1 || state.priority !== out) return;
    // flag fall: that player loses on time
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => (s.phase !== 'gameOver' && s.priority === out ? logApply(s, { type: 'concede' }) : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, clock, online, state.priority, state.phase]);
  // your decisions this game, for the post-game review
  const decisions = useRef<{ before: GameState; action: Action }[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const watchRef = useRef(watch);
  useEffect(() => { watchRef.current = watch; });
  useEffect(() => { watchRef.current?.(state); }, [state]);
  // per-game numbers for quests and achievements
  const gameStats = useRef<MatchStats & { turnDmg: Record<number, number> }>({ damageDealt: 0, maxTurnDamage: 0, attacks: 0, blocks: 0, cardsPlayed: 0, turnDmg: {} });
  const statPrev = useRef<GameState | null>(null);
  useEffect(() => {
    const b = statPrev.current;
    statPrev.current = state;
    if (!b) return;
    const g = gameStats.current;
    const dmg = b.players[1].life - state.players[1].life;
    if (dmg > 0) { g.damageDealt += dmg; g.turnDmg[state.turn] = (g.turnDmg[state.turn] ?? 0) + dmg; g.maxTurnDamage = Math.max(g.maxTurnDamage, g.turnDmg[state.turn]); }
    if (state.chain.length > b.chain.length && state.chain[state.chain.length - 1].attacker === HUMAN) g.attacks++;
    const lb = b.chain[b.chain.length - 1];
    const la = state.chain[state.chain.length - 1];
    if (la && lb && state.chain.length === b.chain.length) g.blocks += la.defenders.filter((d) => d.inst.owner === HUMAN).length - lb.defenders.filter((d) => d.inst.owner === HUMAN).length;
    if (state.turn === b.turn) g.cardsPlayed += Math.max(0, state.players[HUMAN].turn.played.length - b.players[HUMAN].turn.played.length);
  }, [state]);
  // progress before this game, to show what it earned on the result screen
  const [progressBefore] = useState<Progress>(() => computeProgress(loadMatches()));
  useVfx(state, motionOk);
  // the "VS" intro plays before the first turn of a new game
  const [intro, setIntro] = useState(() => initial.turn === 1 && initial.chain.length === 0 && motionOk());
  const endIntro = useCallback(() => setIntro(false), []);
  // the killing blow plays in slow motion before the result screen
  const [lethalFx, setLethalFx] = useState(false);
  useEffect(() => {
    if (state.phase !== 'gameOver' || !state.players.some((p) => p.life <= 0) || !motionOk()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLethalFx(true);
    const t = setTimeout(() => setLethalFx(false), 1600);
    return () => clearTimeout(t);
  }, [state.phase, state.players]);
  const showcase = useShowcase(state);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHandOpen(false); }, [state]);
  useZoneGlide(oppHandRef, state);
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
    if (!reported.current) { const { turnDmg: _t, ...st } = gameStats.current; void _t; reported.current = true; onGameOver?.(state, st, online ? undefined : { initial, actions: replayLog.current.map((x) => x.a) }); }
    const lethal = state.players.some((p) => p.life <= 0);
    const t = setTimeout(() => setOverlay(true), lethal && motionOk() ? 1700 : 700);
    return () => clearTimeout(t);
  }, [state, onGameOver]);

  const me = state.players[HUMAN];
  const opp = state.players[1];
  const myTurn = state.priority === HUMAN && state.phase !== 'gameOver';
  const dangerClass = state.phase !== 'gameOver' && me.life > 0 && me.life <= 5 ? 'danger' : '';
  const options = useMemo(() => (myTurn ? playOptions(state, HUMAN) : []), [state, myTurn]);
  const defOpts = useMemo(() => (myTurn ? defendOptions(state, HUMAN) : []), [state, myTurn]);
  // hints are worked out in the background (bot worker) and shown once ready for this exact position
  const [hintFor, setHintFor] = useState<{ state: GameState; d: BotDecision } | null>(null);
  useEffect(() => {
    if (!myTurn || !showHint) return;
    let off = false;
    void askBot(state, HUMAN, 'hard').then((d) => { if (!off) setHintFor({ state, d }); });
    return () => { off = true; };
  }, [state, myTurn, showHint]);
  const hint = myTurn && showHint && hintFor?.state === state ? hintFor.d : null;
  // what the hint wants you to do, marked on the cards themselves: numbered steps, cards to pitch, blockers
  const hintMarks = useMemo(() => {
    const m = new Map<number, { kind: 'play' | 'pitch' | 'block' | 'arsenal'; label: string }>();
    if (!hint || state.phase === 'gameOver') return m;
    const a = hint.action;
    if (hint.plan?.length) hint.plan.forEach((uid, i) => { if (!m.has(uid)) m.set(uid, { kind: 'play', label: String(i + 1) }); });
    else if (a.type === 'play' || a.type === 'activate') m.set(a.uid, { kind: 'play', label: '1' });
    for (const uid of hint.planPitch ?? (a.type === 'play' || a.type === 'activate' ? a.pitch : [])) if (!m.has(uid)) m.set(uid, { kind: 'pitch', label: '⛀' });
    if (a.type === 'defend') a.uids.forEach((uid) => m.set(uid, { kind: 'block', label: '🛡' }));
    if (a.type === 'arsenal' && a.uid !== null) m.set(a.uid, { kind: 'arsenal', label: 'A' });
    return m;
  }, [hint, state.phase]);
  const hintClass = (uid: number) => { const k = hintMarks.get(uid); return k ? ` hint-${k.kind}` : ''; };
  const hintMarker = (uid: number) => hintMarks.get(uid)?.label;
  const link = currentLink(state);

  const act = (a: Action, snapshot = true) => {
    try {
      const next = logApply(state, a); // validates the move (throws if illegal)
      if (a.type !== 'manual' && a.type !== 'concede') decisions.current.push({ before: state, action: a });
      if (online) online.send(a);
      else {
        if (snapshot) setHistory((h) => [...h.slice(-30), state]);
        setState(next);
      }
      setPending(null);
      setDefendSel([]);
      setBoostSel([]);
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
    // think in the background while the "thinking" pause plays, then apply the move
    let cancelled = false;
    const decision = askBot(state, state.priority);
    const t = setTimeout(() => {
      void decision.then((d) => {
        if (cancelled) return;
        setState((s) => {
          if (s !== state || s.phase === 'gameOver' || !s.players[s.priority].isBot) return s; // the game moved on
          try {
            return logApply(s, d.action);
          } catch (e) {
            console.error(e);
            return logApply(s, { type: 'pass' });
          }
        });
      });
    }, state.stack?.length ? 350 : BOT_DELAY); // quick when it is only deciding whether to respond
    return () => { cancelled = true; clearTimeout(t); };
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
    if (!autoPass || !myTurn || pending || state.pendingTriggers) return;
    const nothingToPlay = state.phase === 'action' && options.length === 0;
    const nothingToBlock = state.phase === 'defend' && defOpts.length === 0;
    if (!nothingToPlay && !nothingToBlock) return;
    const t = setTimeout(() => {
      if (sendOnline) sendOnline(nothingToBlock ? { type: 'defend', uids: [] } : { type: 'pass' });
      else setState((s) => (s.priority === HUMAN && s.phase === state.phase ? logApply(s, nothingToBlock ? { type: 'defend', uids: [] } : { type: 'pass' }) : s));
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
      else setState((s) => (s.priority === HUMAN && s.phase === 'reaction' ? logApply(s, { type: 'pass' }) : s));
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
  const optionalOf = (opt: PlayOption) => {
    if (opt.kind !== 'card') return undefined;
    const inst = [...me.hand, ...me.arsenal].find((i) => i.uid === opt.uid);
    const oc = inst && getScript(cardOf(inst)).optional;
    return oc && oc.timing !== 'defend' && optionalPayable(me, oc, opt.uid) ? oc : undefined;
  };
  const extraFor = (opt: PlayOption, optional?: OptionalChoice) => {
    const oc = optionalOf(opt);
    return optional?.accept && oc?.cost.kind === 'pay' ? oc.cost.amount : 0;
  };
  const startPlay = (opt: PlayOption, mode?: number, optional?: OptionalChoice) => {
    if (mode === undefined && modesOf(opt).length > 0) return setModePick(opt);
    setModePick(null);
    // "you may <cost>. If you do, <effect>": ask first
    if (optional === undefined && optionalOf(opt)) return setOptPick({ opt, mode });
    setOptPick(null);
    const cost = opt.cost + extraFor(opt, optional);
    const exclude = [...(opt.kind === 'card' ? [opt.uid] : []), ...(optional?.uid !== undefined ? [optional.uid] : [])];
    const build = (pitch: number[]): Action => (opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch, mode, optional } : { type: 'activate', uid: opt.uid, index: opt.index, pitch });
    if (me.resources >= cost) return act(build([]));
    if (availableResources(me, exclude) < cost) return setError('Not enough resources.');
    if (autoPay && !shiftHeld.current) {
      // like auto-tapping mana: pick the cheapest cards to pitch automatically (hold Shift to choose)
      const auto = autoPitch(me, cost, exclude);
      if (auto) return act(build(auto));
    }
    setPending({ opt, pitch: [], mode, optional });
  };
  const pendingCost = pending ? pending.opt.cost + extraFor(pending.opt, pending.optional) : 0;
  const finishPay = (pitch: number[]) => {
    if (!pending) return;
    const { opt, mode, optional } = pending;
    act(opt.kind === 'card' ? { type: 'play', uid: opt.uid, pitch, mode, optional } : { type: 'activate', uid: opt.uid, index: opt.index, pitch });
  };
  const pitchTotal = pending ? me.resources + pending.pitch.reduce((a, u) => a + pitchOf(cardOf(me.hand.find((h) => h.uid === u)!)), 0) : 0;

  const rememberRect = (uid: number) => {
    lastClick.current = document.querySelector(`[data-uid="${uid}"]`)?.getBoundingClientRect() ?? null;
  };
  const clickHand = (inst: CardInst, rect?: DOMRect) => {
    setError(null);
    if (manual && !pending) return setMoveMenu({ inst, player: HUMAN });
    if (rect) lastClick.current = rect;
    else rememberRect(inst.uid);
    if (pending) {
      if (pending.opt.kind === 'card' && inst.uid === pending.opt.uid) return setPending(null);
      if (pending.optional?.uid === inst.uid) return; // that card pays the optional cost
      const sel = pending.pitch.includes(inst.uid) ? pending.pitch.filter((u) => u !== inst.uid) : [...pending.pitch, inst.uid];
      const total = me.resources + sel.reduce((a, u) => a + pitchOf(cardOf(me.hand.find((h) => h.uid === u)!)), 0);
      if (total >= pendingCost && !pending.pitch.includes(inst.uid)) return finishPay(sel);
      return setPending({ ...pending, pitch: sel });
    }
    if (!myTurn) return setDetail(cardOf(inst));
    if (state.phase === 'defend') {
      if (!defOpts.some((d) => d.uid === inst.uid)) return;
      return setDefendSel(defendSel.includes(inst.uid) ? defendSel.filter((u) => u !== inst.uid) : [...defendSel, inst.uid]);
    }
    if (state.phase === 'arsenal') return endTurnAct({ type: 'arsenal', uid: inst.uid });
    const opts = options.filter((o) => o.uid === inst.uid);
    if (opts.length > 1 || (opts.length === 1 && opts[0].index === HAND_INDEX)) return setChoosePlay(opts); // play it, or discard it for its effect?
    if (opts.length === 1) return startPlay(opts[0]);
    setDetail(cardOf(inst));
  };

  const clickArena = (inst: CardInst) => {
    rememberRect(inst.uid);
    if (manual) return setMoveMenu({ inst, player: HUMAN });
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
      d.handTop = handRef.current?.getBoundingClientRect().top ?? window.innerHeight; // measured once, not per move
    }
    d.el.style.setProperty('--dx', `${dx}px`);
    d.el.style.setProperty('--dy', `${dy}px`);
    d.el.classList.toggle('will-play', e.clientY < (d.handTop ?? window.innerHeight) - 30);
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
  // blockers with "When this defends, you may <cost>. If you do, <effect>"
  const boostable = state.phase === 'defend' && myTurn
    ? defendSel.map((u) => {
        const inst = me.hand.find((h) => h.uid === u) ?? me.equipment.find((e) => e.inst.uid === u)?.inst;
        const oc = inst && getScript(cardOf(inst)).optional;
        return inst && oc && oc.timing === 'defend' && (oc.cost.kind === 'pay' || optionalPayable(me, oc, u)) ? { inst, oc } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x)
    : [];
  const activeBoosts = boostSel.filter((u) => boostable.some((b) => b.inst.uid === u));
  const boostPay = boostable.filter((b) => activeBoosts.includes(b.inst.uid)).reduce((a, b) => a + (b.oc.cost.kind === 'pay' ? b.oc.cost.amount : 0), 0);
  const boostBonus = boostable.filter((b) => activeBoosts.includes(b.inst.uid)).reduce((a, b) => a + b.oc.effects.reduce((x, e) => x + (e.kind === 'thisDefense' ? e.amount : 0), 0), 0);
  const boostPitch = boostPay > 0 ? autoPitch(me, boostPay, defendSel) : [];
  const boostErr = boostPay > 0 && !boostPitch ? 'Not enough cards left to pitch for that.' : null;
  // ending the turn: optionally choose the order your pitched cards go to the bottom of your deck
  const endTurnAct = (a: Action) => {
    if (pitchOrderOn && me.pitch.length >= 2 && !(a.type === 'pass' && state.stack?.length)) { setOrdering({ action: a, order: [] }); return; }
    act(a);
  };
  const top = state.stack?.[state.stack.length - 1];
  let prompt: React.ReactNode;
  if (state.phase === 'gameOver') {
    prompt = (
      <>
        <span className="msg"><b>{state.winner === HUMAN ? '🏆 Victory!' : '💀 Defeat.'}</b> {state.players[state.winner ?? 0].name} wins on turn {state.turn}.</span>
        {onRematch && <button className="primary" onClick={onRematch}>{rematchLabel ?? 'Rematch'}</button>}
        <button onClick={onExit}>New game</button>
      </>
    );
  } else if (!myTurn) {
    prompt = (
      <>
        <span className="msg muted">{top ? `${state.players[state.priority].name} may respond to ${top.label}…` : `${state.players[state.priority].name} is thinking…`}</span>
        <button className="primary waiting" disabled>Opponent’s Move</button>
      </>
    );
  } else if (pending) {
    prompt = (
      <>
        <span className="msg">Pitch cards to pay for <b>{pending.opt.label}</b> <span className="pay-meter">{pitchTotal} / {pendingCost}</span></span>
        <button className="gold" onClick={() => { const p = autoPitch(me, pendingCost, [...(pending.opt.kind === 'card' ? [pending.opt.uid] : []), ...(pending.optional?.uid !== undefined ? [pending.optional.uid] : [])]); if (p) finishPay(p); }}>Auto-pay</button>
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
        {boostable.map(({ inst: b, oc }) => (
          <label key={b.uid} className="boost-toggle">
            <input type="checkbox" checked={boostSel.includes(b.uid)} onChange={() => setBoostSel(boostSel.includes(b.uid) ? boostSel.filter((u) => u !== b.uid) : [...boostSel, b.uid])} />
            <span><b>{cardOf(b).name}</b>: {oc.costText} → {oc.effectText}</span>
          </label>
        ))}
        {boostErr && <span className="err small">{boostErr}</span>}
        <button className="primary" disabled={!!defendErr || !!boostErr} onClick={() => act({ type: 'defend', uids: defendSel, boosts: activeBoosts, pitch: boostPitch ?? [] })}>{defendSel.length ? `Block ${defendTotal + boostBonus}` : 'No Blocks'}</button>
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
  } else if (state.phase === 'action' && top) {
    prompt = (
      <>
        <span className="msg"><b>{top.label}</b> is on the stack{top.controller === HUMAN ? '' : ` (${state.players[top.controller].name})`}. Respond with an instant, or let it resolve.</span>
        <button className="primary" onClick={() => act({ type: 'pass' })}>Let it resolve</button>
      </>
    );
  } else if (state.phase === 'arsenal') {
    prompt = (
      <>
        <span className="msg">End phase: choose a card for your arsenal.</span>
        <button className="primary" onClick={() => endTurnAct({ type: 'arsenal', uid: null })}>No Arsenal</button>
      </>
    );
  } else {
    prompt = (
      <>
        <span className="msg">
          {me.actionPoints > 0 ? `${me.actionPoints} action point${me.actionPoints > 1 ? 's' : ''}. Drag or click a glowing card.` : 'No action points left.'}
        </span>
        <button className="primary" onClick={() => endTurnAct({ type: 'pass' })}>{state.chainOpen ? 'Close Chain · End Turn' : 'End Turn'}</button>
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
    <div className={`arena ${dangerClass} ${lethalFx ? 'lethal' : ''} mat-${cosmetics?.mat ?? 'tavern'} sleeve-${cosmetics?.sleeve ?? 'classic'}`}>
      <div className="mat-ambient" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>
      {/* screen readers hear each new line of the game log */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{state.log[state.log.length - 1]?.text}</div>
      <div className="arena-bar">
        <span className="arena-title">{formatName(state.format)} · Turn {state.turn}</span>
        <div className="grow" />
        {!!clock && !online && (
          <span className="chess-clock" title="Chess clock: your time runs while it's your decision">
            {(['You', state.players[1].name.replace(' (bot)', '')] as string[]).map((_n, i) => {
              const t = times[i];
              return <span key={i} className={`clk ${state.priority === i && state.phase !== 'gameOver' ? 'run' : ''} ${t < 60000 ? 'low' : ''}`}>{i === 0 ? '⏱' : ''} {Math.floor(t / 60000)}:{String(Math.floor(t / 1000) % 60).padStart(2, '0')}</span>;
            })}
          </span>
        )}
        {online && (
          <span className={`online-badge ${online.opponent?.connected === false ? 'warn' : ''}`}>
            ● Online{online.opponent?.connected === false ? ' · opponent disconnected (they forfeit in 2 min)' : ''}
          </span>
        )}
        {online?.sendEmote && <button className={`icon-btn ${emoteOpen ? 'on' : ''}`} title="Emotes" onClick={() => setEmoteOpen(!emoteOpen)}>💬<span>Emote</span></button>}
        {!online && <button className={`icon-btn ${showHint ? 'on' : ''}`} title="Move suggestions" onClick={() => setShowHint(!showHint)}>💡<span>Hint</span></button>}
        {!online && <button className="icon-btn" title="Undo" disabled={!history.length} onClick={undo}>↶<span>Undo</span></button>}
        <button className={`icon-btn more-btn ${menuOpen ? 'on' : ''}`} title="More" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰<span>More</span></button>
        <div className={`bar-more ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
          <button className={`icon-btn ${drawer === 'log' ? 'on' : ''}`} title="Game log" onClick={() => setDrawer(drawer === 'log' ? null : 'log')}>📜<span>Log</span></button>
          {!online && <button className={`icon-btn ${drawer === 'manual' ? 'on' : ''}`} title="Manual controls" onClick={() => setDrawer(drawer === 'manual' ? null : 'manual')}>🛠<span>Manual</span></button>}
          <button className={`icon-btn ${autoPay ? 'on' : ''}`} title="Auto-pay: pitch cards automatically when you play something (hold Shift to choose yourself)" onClick={() => { writeSetting('autopay', !autoPay); setAutoPay(!autoPay); }}>⛀<span>Auto-pay</span></button>
          <button className={`icon-btn ${autoPass ? 'on' : ''}`} title="Auto-pass: end your turn / skip blocking automatically when you have nothing to do" onClick={() => { writeSetting('autopass', !autoPass); setAutoPass(!autoPass); }}>⏭<span>Auto-pass</span></button>
          <button className="icon-btn" title="Sound" onClick={() => { setSoundEnabled(!sound); setSound(!sound); }}>{sound ? '🔊' : '🔇'}<span>Sound</span></button>
          <button className={`icon-btn ${music ? 'on' : ''}`} title="Music" onClick={() => { setMusicEnabled(!music); setMusic(!music); }}>{music ? '🎵' : '🔈'}<span>Music</span></button>
          {manualAllowed && <button className={`icon-btn ${manual ? 'on' : ''}`} title="Manual moves: tap any card to move it anywhere (for effects the simulator doesn't automate)" onClick={() => setManual(!manual)}>✋<span>Manual moves</span></button>}
          <button className={`icon-btn ${pitchOrderOn ? 'on' : ''}`} title="Choose the order your pitched cards go to the bottom of your deck" onClick={() => { writeSetting('pitchorder', !pitchOrderOn); setPitchOrderOn(!pitchOrderOn); }}>⇅<span>Pitch order</span></button>
          {canVibrate() && <button className={`icon-btn ${vibrate ? 'on' : ''}`} title="Vibration" onClick={() => { setHapticsEnabled(!vibrate); setVibrate(!vibrate); }}>📳<span>Vibration</span></button>}
          <button className="icon-btn" title="Concede" onClick={() => { if (confirm('Concede this game?')) act({ type: 'concede' }); }} disabled={state.phase === 'gameOver' || (!online && !myTurn)}>⚑<span>Concede</span></button>
        </div>
        <button className="icon-btn" title="Leave game" onClick={() => { if (state.phase === 'gameOver' || confirm('Leave this game?')) onExit(); }}>✕</button>
      </div>

      <div className="opp-hand" ref={oppHandRef} title={`${opp.name}: ${opp.hand.length} cards in hand`}>
        {opp.hand.map((h, i) => {
          const off = i - (opp.hand.length - 1) / 2;
          return <div key={h.uid} data-flip={h.uid} data-from="oppdeck" className="opp-hand-card" style={{ rotate: `${-off * 5}deg`, translate: `0 ${-Math.abs(off) * Math.abs(off) * 3}px` }}><CardBack width="var(--ohw)" /></div>;
        })}
      </div>

      <div className="arena-board" ref={colRef}>
        <div className="mat">
          <div ref={oppRef}>
            <PlayerArea p={opp} state={state} isOpp onHover={setHover} onClickArena={(i) => (manual && !online ? setMoveMenu({ inst: i, player: 1 }) : setDetail(cardOf(i)))} onZone={setZone} fx={fx} onDeck={manual && !online ? () => setMoveMenu({ inst: opp.hero, player: 1 }) : undefined} />
          </div>
          <ChainView state={state} onHover={setHover} onClick={(c) => setDetail(c)} lastClick={lastClick} oppRef={oppHandRef} />
          {!!state.stack?.length && (
            <div className="stack-zone" aria-label="The stack">
              <span className="stack-title">Stack</span>
              {[...state.stack].reverse().map((l, i) => (
                <div key={l.inst.uid + '-' + i} className={`stack-layer ${l.controller === HUMAN ? 'mine' : 'theirs'} ${i === 0 ? 'top' : ''}`}>
                  <CardView card={cardOf(l.inst)} width="calc(var(--slot, 60px) * .8)" onClick={() => setDetail(cardOf(l.inst))} />
                  {i === 0 && <span className="small">resolves next</span>}
                </div>
              ))}
            </div>
          )}
          <PlayerArea
            p={me}
            state={state}
            onHover={setHover}
            onClickArena={clickArena}
            onZone={setZone}
            arenaClass={(inst) => {
              if (myTurn && state.phase === 'defend') return (defendSel.includes(inst.uid) ? 'sel' : '') + hintClass(inst.uid);
              return (myTurn && options.some((o) => o.uid === inst.uid && o.kind === 'activation') ? 'playable' : '') + hintClass(inst.uid);
            }}
            marker={(inst) => hintMarker(inst.uid)}
            arsenalClick={(i) => clickHand(i)}
            onDeck={manual ? () => setMoveMenu({ inst: me.hero, player: HUMAN }) : undefined}
            arsenalClass={(i) => handClass(i) + hintClass(i.uid)}
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
                <CardView card={cardOf(inst)} width="var(--hw)" className={handClass(inst) + hintClass(inst.uid)} marker={hintMarker(inst.uid)} tilt={false}
                  onInspect={() => { if (compactTouch()) setHandOpen(true); }}
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
                <div key={i} className={l.player === HUMAN ? 'me' : l.player === 1 ? 'them' : 'muted'}>
                  {l.text}
                  {l.rule && <details className="rule-tip"><summary>ℹ why?</summary>{l.rule}</details>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {emoteOpen && online?.sendEmote && (
        <div className="emote-picker">
          {EMOTES.map(([id, icon, text]) => <button key={id} onClick={() => { online.sendEmote!(id); setMyEmote({ id, at: Date.now() }); setEmoteOpen(false); }}>{icon} {text}</button>)}
        </div>
      )}
      {online?.emote && Date.now() - online.emote.at < 3500 && <EmoteBubble key={online.emote.at} id={online.emote.id} />}
      {myEmote && Date.now() - myEmote.at < 3500 && <EmoteBubble key={myEmote.at} id={myEmote.id} mine />}
      <AttackArrow state={state} />
      {showHint && <HintArrows marks={hintMarks} deps={[state, handOpen]} />}
      {dangerClass && <div className="danger-vignette" />}
      {intro && <MatchIntro state={state} onDone={endIntro} />}
      {showcase && <Showcase key={`sc${showcase.id}`} cardId={showcase.cardId} mine={showcase.mine} />}
      {fx.lifeAnim[HUMAN] === 'hurt' && fx.lifeKey[HUMAN] > 0 && <div key={`vig${fx.lifeKey[HUMAN]}`} className="hurt-vignette" />}
      {fx.banner && <TurnBanner key={`tb${fx.banner.id}`} text={fx.banner.text} mine={fx.banner.mine} />}
      {overlay && state.phase === 'gameOver' && (
        <GameOverOverlay won={state.winner === HUMAN}>
          <h1>{state.winner === HUMAN ? 'Victory' : 'Defeat'}</h1>
          <p style={{ fontSize: '1.1rem' }}>
            {state.winner === HUMAN ? `You defeated ${opp.name.replace(' (bot)', '')}` : `${opp.name.replace(' (bot)', '')} wins`} on turn {state.turn}
            {' '}· you finished on {Math.max(0, me.life)} life.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            {onRematch && <button className="primary" onClick={onRematch}>{rematchLabel ?? 'Rematch'}</button>}
            <button className="gold" onClick={onExit}>New game</button>
            <button onClick={() => setOverlay(false)}>View board</button>
            {decisions.current.length > 0 && <button onClick={() => setReviewing(true)}>🔍 Review game</button>}
          </div>
          {extraResult}
          {onGameOver && <ProgressGains before={progressBefore} />}
        </GameOverOverlay>
      )}
      {manual && <div className="manual-banner">✋ Manual moves on: tap a card to move it · <button className="small" onClick={() => setManual(false)}>Done</button></div>}
      {moveMenu && (() => {
        const pl = state.players[moveMenu.player];
        const isHero = moveMenu.inst.uid === pl.hero.uid;
        const eq = pl.equipment.find((e) => e.inst.uid === moveMenu.inst.uid);
        const wp = pl.weapons.find((w) => w.inst.uid === moveMenu.inst.uid);
        const pm = pl.permanents.find((x) => x.inst.uid === moveMenu.inst.uid);
        const go = (a: Action) => { act(a); setMoveMenu(null); };
        const move = (to: Zone, bottom?: boolean) => go({ type: 'manual', op: 'move', player: moveMenu.player, uid: moveMenu.inst.uid, to, bottom });
        return (
          <div className="modal-bg" onClick={() => setMoveMenu(null)}>
            <div className="modal move-menu" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: 0 }}>{isHero ? `${pl.name}: deck & hero` : cardOf(moveMenu.inst).name}</h3>
              {isHero ? (
                <div className="row">
                  <button onClick={() => go({ type: 'manual', op: 'draw', player: moveMenu.player })}>Draw a card</button>
                  <button onClick={() => go({ type: 'manual', op: 'shuffle', player: moveMenu.player })}>Shuffle deck</button>
                  <button onClick={() => { setMoveMenu(null); setZone({ title: `${pl.name}'s deck (top first)`, cards: pl.deck }); }}>Search deck</button>
                  <button onClick={() => go({ type: 'manual', op: 'life', player: moveMenu.player, amount: -1 })}>−1 ♥</button>
                  <button onClick={() => go({ type: 'manual', op: 'life', player: moveMenu.player, amount: 1 })}>+1 ♥</button>
                </div>
              ) : eq || wp ? (
                <div className="row">
                  {eq && <button onClick={() => go({ type: 'manual', op: 'equipment', player: moveMenu.player, uid: eq.inst.uid, destroyed: !eq.destroyed })}>{eq.destroyed ? 'Restore' : 'Destroy'}</button>}
                  <button onClick={() => go({ type: 'manual', op: 'counter', player: moveMenu.player, uid: moveMenu.inst.uid, amount: 1 })}>+1 counter</button>
                  <button onClick={() => go({ type: 'manual', op: 'counter', player: moveMenu.player, uid: moveMenu.inst.uid, amount: -1 })}>−1 counter</button>
                </div>
              ) : (
                <>
                  <div className="small muted">Move to</div>
                  <div className="move-grid">
                    {([['hand', '✋ Hand'], ['arsenal', '🎯 Arsenal'], ['pitch', '⛀ Pitch'], ['graveyard', '🪦 Graveyard'], ['banished', '🚫 Banished'], ['arena', '✨ Arena (aura / item / ally)'], ['soul', '☀ Soul']] as [Zone, string][]).map(([z, label]) => (
                      <button key={z} onClick={() => move(z)}>{label}</button>
                    ))}
                    <button onClick={() => move('deck')}>⬆ Top of deck</button>
                    <button onClick={() => move('deck', true)}>⬇ Bottom of deck</button>
                  </div>
                  {pm && (
                    <div className="row"><span className="small">Counters: {pm.counters ?? 0}</span>
                      <button className="small" onClick={() => go({ type: 'manual', op: 'counter', player: moveMenu.player, uid: pm.inst.uid, amount: 1 })}>+1</button>
                      <button className="small" onClick={() => go({ type: 'manual', op: 'counter', player: moveMenu.player, uid: pm.inst.uid, amount: -1 })}>−1</button>
                    </div>
                  )}
                </>
              )}
              <div className="row"><button className="small" onClick={() => { setDetail(cardOf(moveMenu.inst)); setMoveMenu(null); }}>Card details</button><button className="small" onClick={() => setMoveMenu(null)}>Cancel</button></div>
            </div>
          </div>
        );
      })()}
      {state.pendingTriggers && state.pendingTriggers.player === HUMAN && (
        <TriggerOrder uids={state.pendingTriggers.uids} me={me} onDone={(order) => act({ type: 'orderTriggers', order })} />
      )}
      {ordering && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2 style={{ marginBottom: '.2rem' }}>Pitch order</h2>
            <p className="small muted" style={{ marginTop: 0 }}>Tap your pitched cards in the order they go to the bottom of your deck. The first one you tap goes in first, so it is drawn first when the deck cycles round.</p>
            <div className="row" style={{ gap: '.6rem' }}>
              {me.pitch.map((p) => {
                const n = ordering.order.indexOf(p.uid);
                return (
                  <div key={p.uid} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setOrdering({ ...ordering, order: n >= 0 ? ordering.order.filter((u) => u !== p.uid) : [...ordering.order, p.uid] })}>
                    <CardView card={cardOf(p)} width={96} tilt={false} noPopout marker={n >= 0 ? String(n + 1) : undefined} className={n >= 0 ? 'hint-play' : ''} />
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: '1rem' }}>
              <button className="primary" disabled={ordering.order.length !== me.pitch.length} onClick={() => { const a = ordering.action; const order = ordering.order; setOrdering(null); act({ ...a, pitchOrder: order } as Action); }}>Done</button>
              <button onClick={() => { const a = ordering.action; setOrdering(null); act(a); }}>Keep the order I pitched them</button>
            </div>
          </div>
        </div>
      )}
      {reviewing && <GameReview decisions={decisions.current} onClose={() => setReviewing(false)} />}
      {detail && <CardDetail card={detail} onClose={() => setDetail(null)} />}
      {optPick && (() => {
        const inst = [...me.hand, ...me.arsenal].find((i) => i.uid === optPick.opt.uid);
        const oc = inst && getScript(cardOf(inst)).optional;
        if (!inst || !oc) return null;
        const needsCard = ['discard', 'handToBottom', 'banishHand', 'discardOrTop', 'reveal', 'charge'].includes(oc.cost.kind);
        const eligible = me.hand.filter((h) => h.uid !== inst.uid && (oc.cost.kind === 'reveal' ? cardOf(h).types.includes(oc.cost.talent) : (oc.cost.kind !== 'discard' && oc.cost.kind !== 'charge') || !oc.cost.pitch || pitchOf(cardOf(h)) === oc.cost.pitch));
        const advice = decideOptional(state, me, inst.uid, []);
        const yes = (choice: OptionalChoice) => startPlay(optPick.opt, optPick.mode, choice);
        return (
          <div className="modal-bg" onClick={() => setOptPick(null)}>
            <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginBottom: '.3rem' }}>{cardOf(inst).name}</h2>
              <p style={{ marginTop: 0 }}>You may <b>{oc.costText}</b>. If you do: <b>{oc.effectText}</b>{oc.minPower !== undefined ? ` (only if it has ${oc.minPower}+ power)` : ''}.</p>
              {advice && <p className="small muted" style={{ marginTop: 0 }}>💡 Suggested: {advice.accept ? 'yes' : 'no'}{advice.accept && advice.uid !== undefined ? `, using ${cardOf(me.hand.find((h) => h.uid === advice.uid)!).name}` : ''}.</p>}
              {needsCard && eligible.length > 0 && (
                <>
                  <div className="small muted">Choose the card:</div>
                  <div className="row" style={{ gap: '.5rem', margin: '.4rem 0 .8rem' }}>
                    {eligible.map((h) => (
                      <div key={h.uid} onClick={() => yes({ accept: true, uid: h.uid })} style={{ cursor: 'pointer' }}>
                        <CardView card={cardOf(h)} width={92} tilt={false} noPopout className={advice?.uid === h.uid ? 'playable' : ''} />
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="row">
                {oc.cost.kind === 'discardOrTop' && <button onClick={() => yes({ accept: true, top: true })}>Destroy the top card of my deck</button>}
                {!needsCard && <button className="primary" onClick={() => yes({ accept: true })}>Yes</button>}
                <button onClick={() => yes({ accept: false })}>No</button>
                <button className="small" onClick={() => setOptPick(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      {choosePlay && (
        <div className="modal-bg" onClick={() => setChoosePlay(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>What do you want to do?</h2>
            <div className="col">
              {choosePlay.map((o) => (
                <button key={o.index} style={{ textAlign: 'left' }} onClick={() => { setChoosePlay(null); startPlay(o); }}>
                  {o.index === HAND_INDEX ? o.label : `Play ${o.label}`}{o.cost ? ` (cost ${o.cost})` : ''}
                </button>
              ))}
              <button className="small" onClick={() => setChoosePlay(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
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
            <div className="grid">{zone.cards.map((c) => (
              <div key={c.uid}>
                <CardView card={cardOf(c)} onClick={() => setDetail(cardOf(c))} />
                {manual && (c.owner === HUMAN || !online) && <button className="small" style={{ width: '100%', marginTop: 4 }} onClick={() => { setZone(null); setMoveMenu({ inst: c, player: c.owner }); }}>Move…</button>}
              </div>
            ))}</div>
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

function PlayerArea({ p, state, isOpp, onHover, onClickArena, onZone, arenaClass, marker, arsenalClick, arsenalClass, fx, onDeck }: {
  p: PlayerState; state: GameState; isOpp?: boolean; onHover: (c: Card | null) => void; onClickArena: (i: CardInst) => void;
  onZone: (z: { title: string; cards: CardInst[] }) => void; arenaClass?: (i: CardInst) => string; marker?: (i: CardInst) => string | undefined;
  arsenalClick?: (i: CardInst) => void; arsenalClass?: (i: CardInst) => string; fx: Fx; onDeck?: () => void;
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
        <CardView key={`${e.inst.uid}-${e.destroyed}`} card={cardOf(e.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(e.inst)}
          className={`${e.destroyed ? 'destroyed' : ''} ${arenaClass?.(e.inst) ?? ''}`} marker={marker?.(e.inst)}
          badge={e.destroyed ? 'destroyed' : e.defenseMod ? `⛨${equipDefense(e)}` : undefined} />
      )}
      {e && !e.destroyed && e.defenseMod < 0 && <span className={`cracks c${Math.min(3, -e.defenseMod)}`} aria-hidden />}
    </Slot>
  );
  const weaponSlot = (area: string, w?: { inst: CardInst; usedThisTurn: boolean }, e?: EquipState) => (
    <Slot area={area} label="Weapon" filled={!!(w || e)} uid={w?.inst.uid ?? e?.inst.uid}>
      {w && <CardView card={cardOf(w.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(w.inst)} className={`${arenaClass?.(w.inst) ?? ''} ${w.usedThisTurn ? 'dim' : ''}`} marker={marker?.(w.inst)} />}
      {!w && e && <CardView card={cardOf(e.inst)} width={SLOT} onHover={onHover} onClick={() => onClickArena(e.inst)} className={`${e.destroyed ? 'destroyed' : ''} ${arenaClass?.(e.inst) ?? ''}`} marker={marker?.(e.inst)} />}
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
      <Slot area="hero" label="Hero" filled className={`hero-box hero-aura aura-${themeOf(cardOf(p.hero))}`}>
        <CardView card={cardOf(p.hero)} width={SLOT} onHover={onHover} onClick={() => onClickArena(p.hero)} marker={marker?.(p.hero)}
          className={`${state.phase === 'gameOver' && state.winner !== p.id ? 'burn-away' : ''} ${arenaClass?.(p.hero) ?? ''}`} />
        <div key={fx.lifeKey[p.id]} className={`life-orb life ${fx.lifeAnim[p.id]}`} title="Life"><RollingNumber value={p.life} /></div>
        {fx.lifeAnim[p.id] === 'hurt' && fx.lifeKey[p.id] > 0 && <ImpactBurst key={`impact${fx.lifeKey[p.id]}`} theme={fx.theme[p.id]} />}
        {fx.lifeAnim[p.id] === 'heal' && fx.lifeKey[p.id] > 0 && <ImpactBurst key={`heal${fx.lifeKey[p.id]}`} heal />}
        {fx.floaters.filter((f) => f.player === p.id).map((f) => (
          <span key={f.id} className={`floater ${f.amount < 0 ? 'dmg' : 'gain'}`}>{f.amount > 0 ? `+${f.amount}` : f.amount}</span>
        ))}
      </Slot>
      <Slot area="arsenal" label="Arsenal" filled={p.arsenal.length > 0} uid={p.arsenal[0]?.uid}>
        {p.arsenal[0] && (isOpp
          ? <div key={p.arsenal[0].uid} className="flip-wrap" data-flip={p.arsenal[0].uid} data-from="opphand"><CardBack width={SLOT} label="A" /></div>
          : <div key={p.arsenal[0].uid} className="flip-wrap" data-flip={p.arsenal[0].uid}><CardView card={cardOf(p.arsenal[0])} width={SLOT} onHover={onHover} onClick={() => arsenalClick?.(p.arsenal[0])} className={arsenalClass?.(p.arsenal[0])} marker={marker?.(p.arsenal[0])} /></div>)}
      </Slot>
      <Slot area="deck" label="Deck" filled={p.deck.length > 0} onClick={onDeck} className={onDeck ? 'clickable' : ''}>
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
          {(p.soul?.length ?? 0) > 0 && <span title="Cards in soul">✦ {p.soul!.length}</span>}
        </div>
      </div>
      <div className="mat-effects" style={{ gridArea: 'fx' }}>
        {effects.map((e) => <span key={e} className="tag anim-pop">{e}</span>)}
      </div>
      <div className="mat-perms" style={{ gridArea: 'perm' }}>
        {[...extraEquip.map((e) => ({ inst: e.inst, destroyed: e.destroyed })), ...p.permanents.map((pm) => ({ inst: pm.inst, destroyed: false }))].map(({ inst, destroyed }) => (
          <div key={inst.uid} data-uid={inst.uid} data-flip={inst.uid} className="anim-pop perm-card">
            <span className="materialize" aria-hidden />
            <CardView card={cardOf(inst)} width="calc(var(--slot) * .62)" onHover={onHover} onClick={() => onClickArena(inst)} className={`${destroyed ? 'destroyed' : ''} ${arenaClass?.(inst) ?? ''}`} marker={marker?.(inst)} />
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
  // the attack lunges at the defending hero when its damage resolves
  const prevDamage = useRef(l.damage);
  useEffect(() => {
    const was = prevDamage.current;
    prevDamage.current = l.damage;
    const el = cardRef.current;
    if (was !== null || l.damage === null || !el || !el.animate || !motionOk()) return;
    const from = el.getBoundingClientRect();
    const to = document.querySelector(`.mat-side.${l.attacker === HUMAN ? 'opp' : 'me'} .hero-box`)?.getBoundingClientRect();
    if (!to) return;
    const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) * 0.62;
    const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) * 0.62;
    const tilt = l.attacker === HUMAN ? -10 : 10;
    el.animate([
      { transform: 'none' },
      { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.08) rotate(${-tilt / 2}deg)`, offset: 0.25 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.25) rotate(${tilt}deg)`, offset: 0.55 },
      { transform: 'none' },
    ], { duration: l.hit ? 620 : 520, easing: 'cubic-bezier(.3,.7,.2,1)' });
    // a fiery glow while it lunges (a static class, so the browser only moves a layer instead of repainting)
    el.classList.add('lunging');
    const t = setTimeout(() => el.classList.remove('lunging'), l.hit ? 620 : 520);
    return () => clearTimeout(t);
  }, [l.damage, l.attacker, l.hit]);
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
      { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${l.attacker === HUMAN ? -8 : 8}deg)`, zIndex: 30 },
      { transform: 'translate(0,0) scale(1.12) rotate(0deg)', offset: 0.75 },
      { transform: 'none' },
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`link ${l.damage !== null ? 'done' : ''}`}>
      <div ref={cardRef} style={{ position: 'relative', zIndex: 2 }} className="chain-card" data-vfx="chain" data-card={l.inst.cardId} data-owner={l.attacker}>
        <span className="land-ring" />
        <CardView card={cardOf(l.inst)} width="calc(var(--slot) * .86)" onHover={onHover} onClick={() => onClick(cardOf(l.inst))} badge={<span key={linkPower(l)} className="anim-pop">⚔ {linkPower(l)}</span>} />
      </div>
      {l.defenders.length > 0 && <span className="muted anim-pop">vs</span>}
      {l.defenders.map((d) => (
        <div key={d.inst.uid} className="defender" data-flip={d.inst.uid} data-from={d.inst.owner === HUMAN ? undefined : 'opphand'} data-vfx="chain" data-card={d.inst.cardId} data-owner={d.inst.owner}>
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
function ImpactBurst({ heal, theme = 'normal' }: { heal?: boolean; theme?: Theme }) {
  // particles shaped by what hit: embers rise from fire, shards scatter from ice, chunks fall from earth, …
  const sparks = useMemo(() => Array.from({ length: theme === 'shadow' ? 8 : 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const d = 40 + Math.random() * 50;
    let x = Math.cos(a) * d;
    let y = Math.sin(a) * d;
    if (theme === 'fire') { x *= 0.6; y = -Math.abs(y) - 30 * Math.random(); }
    if (theme === 'earth') y = Math.abs(y) * 0.6 + 30;
    return { x, y, s: (theme === 'shadow' ? 18 : theme === 'earth' ? 7 : 4) + Math.random() * 5, delay: Math.random() * 80, r: Math.random() * 360 };
  }), [theme]);
  return (
    <span className={`impact ${heal ? 'heal' : `t-${theme}`}`} aria-hidden>
      <span className="impact-ring" />
      {theme === 'lightning' && !heal && [0, 1, 2].map((i) => <span key={`b${i}`} className="zap" style={{ rotate: `${i * 120 + 20}deg` } as React.CSSProperties} />)}
      {theme === 'light' && !heal && <span className="rays" />}
      {sparks.map((p, i) => (
        <span key={i} className="spark" style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.r}deg`, width: p.s, height: p.s, animationDelay: `${p.delay}ms` } as React.CSSProperties} />
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

/** Cards being played, queued for the "cast" showcase (both players' plays and weapon attacks). */
function useShowcase(state: GameState) {
  const prev = useRef<GameState | null>(null);
  const queue = useRef<{ id: number; cardId: string; mine: boolean }[]>([]);
  const seq = useRef(1);
  const [current, setCurrent] = useState<{ id: number; cardId: string; mine: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = () => {
    const item = queue.current.shift() ?? null;
    setCurrent(item);
    if (item) timer.current = setTimeout(next, item.mine ? 750 : 1150);
    else timer.current = null;
  };
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (!before || !motionOk()) return;
    const found: { id: number; cardId: string; mine: boolean }[] = [];
    state.players.forEach((p, i) => {
      const old = before.turn === state.turn ? before.players[i].turn.played.length : 0;
      for (const id of p.turn.played.slice(old)) found.push({ id: seq.current++, cardId: id, mine: i === HUMAN });
    });
    const newLink = state.chain.length > before.chain.length ? state.chain[state.chain.length - 1] : null;
    if (newLink?.fromWeapon) found.push({ id: seq.current++, cardId: newLink.inst.cardId, mine: newLink.attacker === HUMAN });
    if (!found.length) return;
    queue.current.push(...found);
    if (!timer.current) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return current;
}

/** A played card shown big at the side of the board for a moment; the opponent's flips over as it's revealed. */
function Showcase({ cardId, mine }: { cardId: string; mine: boolean }) {
  const c = getDb().byId.get(cardId);
  if (!c || cardId === '__hidden__') return null;
  return (
    <div className={`showcase ${mine ? 'mine' : 'theirs'}`} aria-hidden>
      <div className="showcase-rays" />
      <div className="showcase-card">
        <div className="sc-face"><CardView card={c} width="var(--sc-w)" tilt={false} noPopout /></div>
        {!mine && <div className="sc-back"><CardBack width="var(--sc-w)" /></div>}
      </div>
    </div>
  );
}

/** Result screen: XP earned, level ups, quests and achievements completed, cosmetics unlocked. */
function ProgressGains({ before }: { before: Progress }) {
  const [after] = useState(() => computeProgress(loadMatches()));
  const d = progressDiff(before, after);
  if (d.xp <= 0) return null;
  const pct = (p: Progress) => Math.round((p.into / p.need) * 100);
  return (
    <div className="gains">
      <div className="gains-xp"><b className="anim-pop">+{d.xp} XP</b>{d.levelUp ? <span className="lvl-up">Level {d.levelUp}!</span> : <span className="muted small">Level {after.level}</span>}</div>
      <div className="xpbar"><span style={{ '--from': `${d.levelUp ? 0 : pct(before)}%`, '--to': `${pct(after)}%` } as React.CSSProperties} /></div>
      {d.quests.map((q) => <div key={q.id} className="gain-row">✅ Quest complete: {q.text} <b>+{q.reward}</b></div>)}
      {d.achievements.map((a) => <div key={a.id} className="gain-row ach">{a.icon} Achievement: <b>{a.name}</b> <b>+{a.reward}</b></div>)}
      {d.unlocks.map((c) => <div key={c.id} className="gain-row unlock">🎁 Unlocked {c.kind === 'mat' ? 'playmat' : c.kind === 'sleeve' ? 'card sleeve' : 'avatar frame'}: <b>{c.name}</b></div>)}
    </div>
  );
}

/** Post-game review: the Hard bot re-checks each of your decisions and points out where it would have played differently. */
function GameReview({ decisions, onClose }: { decisions: { before: GameState; action: Action }[]; onClose: () => void }) {
  const [rows, setRows] = useState<{ turn: number; yours: string; better: string; why: string; before: GameState; a: Action; b: Action }[]>([]);
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState(0);
  const list = useMemo(() => decisions.filter((d) => ['play', 'activate', 'defend', 'pass'].includes(d.action.type) && ['action', 'defend'].includes(d.before.phase)).slice(-60), [decisions]);
  useEffect(() => {
    let off = false;
    void (async () => {
      for (const d of list) {
        const sug = await askBot(d.before, HUMAN, 'hard');
        if (off) return;
        const a = d.action;
        const b = sug.action;
        const same = a.type === b.type && (
          (a.type === 'play' || a.type === 'activate') ? a.uid === (b as typeof a).uid
            : a.type === 'defend' ? [...a.uids].sort().join() === [...(b as typeof a).uids].sort().join() : true);
        if (!same) setRows((r) => [...r, { turn: d.before.turn, yours: describeAction(d.before, a), better: describeAction(d.before, b), why: sug.reason, before: d.before, a, b }]);
        setDone((n) => n + 1);
      }
    })();
    return () => { off = true; };
  }, [list]);
  const matched = done - rows.length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal review" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <button className="close small" onClick={onClose}>✕</button>
        <h2>🔍 Game review</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {done < list.length ? `Checking your decisions… ${done}/${list.length}` : `${matched} of ${list.length} decisions matched what the Hard bot would do.`} The bot isn’t perfect, so treat these as ideas rather than mistakes.
        </p>
        {rows.length === 0 && done === list.length && <p>🎯 No differences: you played this game like the Hard bot would.</p>}
        {rows.length > 0 && done === list.length && (
          <div className="row" style={{ marginBottom: '.6rem' }}>
            <button className="primary" disabled={saved} onClick={() => { rows.forEach((r) => addDrill(r.before, r.a, r.b, r.why)); setSaved(true); }}>{saved ? '✓ Saved to the mistake trainer' : `Save ${rows.length} position${rows.length > 1 ? 's' : ''} to the mistake trainer`}</button>
            {saved && <a className="btn-link small" href="#drills">Open the trainer</a>}
          </div>
        )}
        <div className="col" style={{ gap: '.5rem' }}>
          {rows.map((r, i) => (
            <div key={i} className="review-row">
              <span className="tag">Turn {r.turn}</span>
              <div><span className="muted small">You:</span> {r.yours}</div>
              <div><span className="ok small">Suggested:</span> <b>{r.better}</b></div>
              {r.why && <div className="small muted">{r.why}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Choose the order your start-of-turn triggers resolve in. */
function TriggerOrder({ uids, me, onDone }: { uids: number[]; me: GameState['players'][0]; onDone: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const items = uids.map((u) => me.permanents.find((pm) => pm.inst.uid === u)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div className="modal-bg">
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2 style={{ marginBottom: '.2rem' }}>Order your triggers</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Several of your effects trigger at the start of your turn. Tap them in the order you want them to resolve.</p>
        <div className="row" style={{ gap: '.6rem' }}>
          {items.map((pm) => {
            const n = order.indexOf(pm.inst.uid);
            return (
              <div key={pm.inst.uid} style={{ cursor: 'pointer' }} onClick={() => setOrder(n >= 0 ? order.filter((u) => u !== pm.inst.uid) : [...order, pm.inst.uid])}>
                <CardView card={cardOf(pm.inst)} width={96} tilt={false} noPopout marker={n >= 0 ? String(n + 1) : undefined} className={n >= 0 ? 'hint-play' : ''} />
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="primary" disabled={order.length !== items.length} onClick={() => onDone(order)}>Resolve in this order</button>
          <button onClick={() => onDone(items.map((pm) => pm.inst.uid))}>Any order</button>
        </div>
      </div>
    </div>
  );
}
