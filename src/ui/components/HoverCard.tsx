// A readable pop-out for any card: big image + enlarged rules text + keyword help.
// Shown on mouse hover, keyboard focus, or long-press on touch screens.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Card } from '../../data/types';
import { PITCH_COLOR } from '../../data/types';
import { getScript } from '../../engine/cardScript';
import { GLOSSARY } from '../../learn/lessons';
import CardView from './CardView';

interface HoverState { card: Card; rect: DOMRect; owner: number; pinned: boolean }

let current: HoverState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let nextOwner = 1;
export const newHoverOwner = () => nextOwner++;

export function showHover(card: Card, el: Element, owner: number, opts: { delay?: number; pinned?: boolean } = {}) {
  if (document.querySelector('.fan-card.dragging')) return;
  if (timer) clearTimeout(timer);
  const go = () => {
    current = { card, rect: el.getBoundingClientRect(), owner, pinned: !!opts.pinned };
    emit();
  };
  if (opts.delay === 0 || current) go(); // moving between cards: no delay
  else timer = setTimeout(go, opts.delay ?? 160);
}

export function hideHover(owner?: number) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!current || (owner !== undefined && current.owner !== owner)) return;
  if (current.pinned && owner !== undefined) return; // long-press pop-outs stay until tapped away
  current = null;
  emit();
}

function useHover() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current);
}

// ---------------------------------------------------------------- text formatting

const SYMBOLS: Record<string, [string, string]> = {
  p: ['⚔', 'power'], d: ['⛨', 'defense'], r: ['●', 'resource'], h: ['♥', 'life'], i: ['✦', 'intellect'], t: ['↷', 'tap'], u: ['↶', 'untap'],
};

const TEXT_TERMS = GLOSSARY.filter(([k]) => !['Arsenal', 'Pitch', 'Intellect', 'Legendary', 'Specialization'].includes(k));
const baseKeyword = (k: string) => k.replace(/ (\d+|X)$/, ' N');

export function keywordHelp(card: Card): [string, string][] {
  const out = new Map<string, string>();
  for (const k of card.keywords) {
    const g = GLOSSARY.find(([key]) => key.toLowerCase() === baseKeyword(k).toLowerCase() || key.toLowerCase() === k.toLowerCase());
    const num = k.match(/ (\d+|X)$/)?.[1];
    if (g) out.set(k, num ? g[1].replace(/\bN\b/g, num) : g[1]);
  }
  const lower = card.text.toLowerCase();
  for (const [k, v] of TEXT_TERMS) {
    const term = k.replace(/ N$/, '').toLowerCase();
    if (![...out.keys()].some((x) => x.toLowerCase().startsWith(term)) && new RegExp(`\\b${term}\\b`).test(lower)) out.set(k.replace(/ N$/, ''), v);
  }
  return [...out.entries()];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render rules text with resource symbols and bolded keywords. */
export function RulesText({ card }: { card: Card }) {
  const kws = [...new Set([...card.keywords, ...GLOSSARY.map(([k]) => k.replace(/ N$/, ''))])].filter((k) => k.length > 2);
  const kwRe = kws.length ? new RegExp(`\\b(${kws.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi') : null;
  const renderLine = (line: string, li: number) => {
    const parts: ReactNode[] = [];
    // split on {x} symbols first
    line.split(/(\{[a-z]\})/g).forEach((chunk, ci) => {
      const sym = chunk.match(/^\{([a-z])\}$/);
      if (sym && SYMBOLS[sym[1]]) {
        parts.push(<span key={`${li}-${ci}`} className={`sym sym-${sym[1]}`} title={SYMBOLS[sym[1]][1]}>{SYMBOLS[sym[1]][0]}</span>);
        return;
      }
      if (!kwRe) { parts.push(chunk); return; }
      let last = 0;
      for (const m of chunk.matchAll(kwRe)) {
        if (m.index! > last) parts.push(chunk.slice(last, m.index));
        parts.push(<b key={`${li}-${ci}-${m.index}`} className="kw">{m[0]}</b>);
        last = m.index! + m[0].length;
      }
      if (last < chunk.length) parts.push(chunk.slice(last));
    });
    return <p key={li}>{parts}</p>;
  };
  const lines = card.text.split(/\n+/).filter((l) => l.trim());
  if (!lines.length) return <p className="muted"><i>No rules text.</i></p>;
  return <>{lines.map(renderLine)}</>;
}

// ---------------------------------------------------------------- layer

export function HoverCardLayer() {
  const h = useHover();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!h || !el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = el.offsetWidth;
    const H = el.offsetHeight;
    const r = h.rect;
    const gap = 14;
    let left = r.right + gap;
    if (left + W > vw - 8) left = r.left - gap - W;
    if (left < 8) left = Math.max(8, Math.min(vw - W - 8, r.left + r.width / 2 - W / 2));
    let top = r.top + r.height / 2 - H / 2;
    // when it had to centre over the card, put it above/below instead of on top of it
    if (left + W > r.left && left < r.right) top = r.top - H - gap >= 8 ? r.top - H - gap : r.bottom + gap;
    top = Math.max(8, Math.min(vh - H - 8, top));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({ left, top });
  }, [h]);

  // dismiss pinned (long-press) pop-outs on the next tap / scroll / key
  useLayoutEffect(() => {
    if (!h) return;
    const off = () => { current = null; emit(); };
    const onDown = (e: Event) => { if (!ref.current?.contains(e.target as Node)) off(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') off(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', off, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [h]);

  if (!h) return null;
  const c = h.card;
  const sc = c.types.includes('Hero') ? null : getScript(c);
  const help = keywordHelp(c);
  const stats: [string, ReactNode][] = [];
  if (c.pitch !== null) stats.push(['Pitch', <><span className={`dot pitch-${c.pitch}`} /> {c.pitch}</>]);
  if (c.cost !== null) stats.push(['Cost', c.cost]);
  if (c.power !== null) stats.push(['Power', c.power]);
  if (c.defense !== null) stats.push(['Defense', c.defense]);
  if (c.health !== null) stats.push(['Life', c.health]);
  if (c.intellect !== null) stats.push(['Intellect', c.intellect]);
  return (
    <div
      ref={ref}
      className={`hovercard ${h.pinned ? 'pinned' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
      role="tooltip"
      key={c.id}
    >
      <div className="hc-img"><CardView card={c} width="100%" tilt={false} noPopout /></div>
      <div className="hc-body">
        <div className="hc-name">
          {c.name}
          {c.pitch ? <span className={`hc-pitch pitch-${c.pitch}`}>{PITCH_COLOR[c.pitch]}</span> : null}
        </div>
        <div className="hc-type">{c.typeText}</div>
        {stats.length > 0 && (
          <div className="hc-stats">
            {stats.map(([k, v]) => <span key={k}><small>{k}</small><b>{v}</b></span>)}
          </div>
        )}
        <div className="hc-text"><RulesText card={c} /></div>
        {help.length > 0 && (
          <div className="hc-help">
            {help.map(([k, v]) => <div key={k}><b>{k}</b> — {v}</div>)}
          </div>
        )}
        {sc && (
          <div className={`hc-auto ${sc.coverage}`}>
            {sc.coverage === 'full' ? '✓ Fully automated in games' : sc.coverage === 'partial' ? '◐ Partly automated in games' : '○ Stats only in games: use Manual for its text'}
          </div>
        )}
      </div>
    </div>
  );
}
