// Board effects that travel between zones: pitch gems, go-again orbs, arcane bolts, the combat chain
// sweeping into graveyards, shattering equipment. They are short-lived DOM nodes in one overlay layer and
// only animate transform/opacity, so they stay smooth on phones.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../../data/types';
import { getDb } from '../../data/cardDb';
import type { GameState, PlayerId } from '../../engine/types';
import CardView from './CardView';

const HUMAN: PlayerId = 0;
const side = (p: PlayerId) => (p === HUMAN ? 'me' : 'opp');
const cardById = (id: string): Card | undefined => getDb().byId.get(id);

// ---------------------------------------------------------------- themes

export type Theme = 'fire' | 'lightning' | 'ice' | 'shadow' | 'earth' | 'light' | 'arcane' | 'normal';

/** Which effect style fits a card: its talent (Draconic fire, Lightning sparks, …) or arcane magic. */
export function themeOf(c: Card | undefined): Theme {
  if (!c) return 'normal';
  const t = c.types;
  if (t.includes('Draconic')) return 'fire';
  if (t.includes('Lightning')) return 'lightning';
  if (t.includes('Ice')) return 'ice';
  if (t.includes('Shadow')) return 'shadow';
  if (t.includes('Earth')) return 'earth';
  if (t.includes('Light')) return 'light';
  if (c.arcane !== null || t.includes('Wizard') || t.includes('Runeblade')) return 'arcane';
  return 'normal';
}

/** Where damage to `pid` came from in this step: the combat link that just resolved, or the latest spell. */
export function damageSource(before: GameState, after: GameState, pid: PlayerId): { card?: Card; arcane: boolean; caster: PlayerId } {
  const caster = (1 - pid) as PlayerId;
  const link = after.chain[after.chain.length - 1];
  const linkBefore = before.chain[after.chain.length - 1];
  if (link && link.damage !== null && (!linkBefore || linkBefore.damage === null)) return { card: cardById(link.inst.cardId), arcane: false, caster: link.attacker };
  const played = after.players[caster].turn.played;
  const last = played[played.length - 1];
  const card = last ? cardById(last) : undefined;
  return { card, arcane: !!card && (card.arcane !== null || themeOf(card) === 'arcane'), caster };
}

// ---------------------------------------------------------------- layer helpers

let layerEl: HTMLDivElement | null = null;
function layer(): HTMLDivElement {
  if (layerEl && document.body.contains(layerEl)) return layerEl;
  layerEl = document.createElement('div');
  layerEl.className = 'vfx-layer';
  document.body.appendChild(layerEl);
  return layerEl;
}
const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
const mid = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function spawn(cls: string, x: number, y: number, html = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = html;
  layer().appendChild(el);
  return el;
}
function run(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  const a = el.animate(frames, { fill: 'both', ...opts });
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
}

const PITCH_GEM = ['', '#ff5a4a', '#ffd34a', '#5aa8ff'];

/** Resource gems burst out of the pitched card and fly into the resource counter. */
export function pitchGems(p: PlayerId, pitch: number, n: number, delay = 0) {
  const from = rect(`.mat-side.${side(p)} [data-area="pitch"]`);
  const to = rect(`.mat-side.${side(p)} .res [title="Floating resources"]`);
  if (!from || !to) return;
  const a = mid(from);
  const b = mid(to);
  for (let i = 0; i < n; i++) {
    const g = spawn('vfx-gem', a.x, a.y);
    g.style.setProperty('--gc', PITCH_GEM[pitch] ?? PITCH_GEM[3]);
    const spread = (i - (n - 1) / 2) * 26;
    run(g, [
      { transform: 'translate(-50%, -50%) scale(.2)', opacity: 0 },
      { transform: `translate(calc(-50% + ${spread}px), calc(-50% - 34px)) scale(1.2)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.55)`, opacity: 0.9 },
    ], { duration: 700, delay: delay + i * 90, easing: 'cubic-bezier(.3,.6,.3,1)' });
  }
}

/** A lightning orb flies from the card that had go again to the action point counter. */
export function goAgainOrb(p: PlayerId) {
  const from = rect('.chain-links .link:last-child .chain-card') ?? rect(`.mat-side.${side(p)} .hero-box`);
  const to = rect(`.mat-side.${side(p)} .res [title="Action points"]`);
  if (!from || !to) return;
  const a = mid(from);
  const b = mid(to);
  const o = spawn('vfx-orb', a.x, a.y, '⚡');
  run(o, [
    { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 1, offset: 0.25 },
    { transform: `translate(calc(-50% + ${(b.x - a.x) * 0.5}px), calc(-50% + ${(b.y - a.y) * 0.5 - 50}px)) scale(1.1)`, opacity: 1, offset: 0.6 },
    { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.5)`, opacity: 0.2 },
  ], { duration: 800, easing: 'ease-in-out' });
}

/** An arcane bolt streaks from the caster to the hero it hits. */
export function arcaneBolt(caster: PlayerId, target: PlayerId, theme: Theme) {
  const from = rect(`.mat-side.${side(caster)} .hero-box`);
  const to = rect(`.mat-side.${side(target)} .hero-box`);
  if (!from || !to) return;
  const a = mid(from);
  const b = mid(to);
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const bolt = spawn(`vfx-bolt t-${theme}`, a.x, a.y);
  bolt.style.rotate = `${angle}deg`;
  run(bolt, [
    { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.15 },
    { transform: `translate(calc(-50% + ${Math.hypot(b.x - a.x, b.y - a.y)}px), -50%) scale(1)`, opacity: 1 },
  ], { duration: 300, easing: 'cubic-bezier(.5,0,.9,.6)' });
}

export interface ChainSnap { cardId: string; owner: PlayerId; rect: DOMRect }

/** When the chain closes, its cards sweep off into their owners' graveyards one after another. */
export function chainCascade(items: ChainSnap[]) {
  items.forEach((it, i) => {
    const to = rect(`.mat-side.${side(it.owner)} [data-area="grave"]`);
    const c = cardById(it.cardId);
    if (!to) return;
    const el = spawn('vfx-card', it.rect.left, it.rect.top);
    el.style.width = `${it.rect.width}px`;
    el.style.height = `${it.rect.height}px`;
    if (c?.image) el.style.backgroundImage = `url("${c.image}")`;
    const dx = to.left + to.width / 2 - (it.rect.left + it.rect.width / 2);
    const dy = to.top + to.height / 2 - (it.rect.top + it.rect.height / 2);
    const sc = Math.max(0.3, to.width / it.rect.width);
    run(el, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 18}px) rotate(${i % 2 ? 6 : -6}deg) scale(1.05)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${i % 2 ? 14 : -14}deg) scale(${sc})`, opacity: 0.15 },
    ], { duration: 620, delay: i * 85, easing: 'cubic-bezier(.4,0,.6,1)' });
  });
}

/** Equipment shatters into shards when it is destroyed (blade break and the like). */
export function shatter(r: DOMRect, image: string) {
  const shards = [
    '0 0, 55% 0, 35% 45%', '55% 0, 100% 0, 100% 35%, 35% 45%', '0 0, 35% 45%, 0 60%', '100% 35%, 100% 75%, 50% 60%, 35% 45%',
    '0 60%, 35% 45%, 50% 60%, 30% 100%, 0 100%', '50% 60%, 100% 75%, 100% 100%, 30% 100%',
  ];
  shards.forEach((poly, i) => {
    const el = spawn('vfx-card shard', r.left, r.top);
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    if (image) el.style.backgroundImage = `url("${image}")`;
    el.style.clipPath = `polygon(${poly})`;
    const ang = (i / shards.length) * Math.PI * 2 + 0.4;
    const d = 40 + (i % 3) * 22;
    run(el, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${Math.cos(ang) * d}px, ${Math.sin(ang) * d + 40}px) rotate(${(i % 2 ? 1 : -1) * (25 + i * 9)}deg)`, opacity: 0 },
    ], { duration: 750, delay: 60, easing: 'cubic-bezier(.2,.6,.4,1)' });
  });
}

// ---------------------------------------------------------------- the hook that triggers them

/** Watches each state change and launches the travelling effects that belong to it. */
export function useVfx(state: GameState, enabled: () => boolean) {
  const prev = useRef<GameState | null>(null);
  const chainSnap = useRef<ChainSnap[]>([]);
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = state;
    const lastChain = chainSnap.current;
    // remember where the chain's cards are now, for when it closes
    chainSnap.current = [...document.querySelectorAll<HTMLElement>('[data-vfx="chain"]')].map((el) => ({
      cardId: el.dataset.card!, owner: Number(el.dataset.owner) as PlayerId, rect: el.getBoundingClientRect(),
    }));
    if (!before || !enabled()) return;
    if (before.chain.length > 0 && state.chain.length === 0) chainCascade(lastChain);
    state.players.forEach((p, i) => {
      const pid = i as PlayerId;
      const b = before.players[i];
      if (before.turn === state.turn) {
        // pitched cards pay out gems
        p.pitch.slice(b.pitch.length).forEach((inst, k) => {
          const c = cardById(inst.cardId);
          if (c?.pitch) pitchGems(pid, c.pitch, c.pitch, k * 160);
        });
        // go again gives back an action point
        if (p.actionPoints > b.actionPoints && state.turnPlayer === pid) goAgainOrb(pid);
      }
      // arcane damage arrives as a bolt
      if (p.life < b.life) {
        const src = damageSource(before, state, pid);
        if (src.arcane) arcaneBolt(src.caster, pid, themeOf(src.card) === 'normal' ? 'arcane' : themeOf(src.card));
      }
      // destroyed equipment shatters
      for (const e of p.equipment) {
        const was = b.equipment.find((x) => x.inst.uid === e.inst.uid);
        if (e.destroyed && was && !was.destroyed) {
          const r = document.querySelector(`[data-uid="${e.inst.uid}"]`)?.getBoundingClientRect();
          if (r) shatter(r, cardById(e.inst.cardId)?.image ?? '');
        }
      }
    });
  }, [state, enabled]);
}

// ---------------------------------------------------------------- match intro

/** MTGA-style "VS" intro: both heroes slide in before the first turn. */
export function MatchIntro({ state, onDone }: { state: GameState; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2300);
    return () => clearTimeout(t);
  }, [onDone]);
  const me = state.players[HUMAN];
  const opp = state.players[1];
  const hero = (id: string) => cardById(id);
  const name = (n: string) => n.replace(' (bot)', '');
  return (
    <div className="match-intro" onClick={onDone} role="presentation">
      <div className="mi-side mi-me">
        {hero(me.hero.cardId) && <CardView card={hero(me.hero.cardId)!} width="var(--mi-w)" tilt={false} noPopout />}
        <div className="mi-name">{name(me.name)}</div>
        <div className="mi-sub">{hero(me.hero.cardId)?.name}</div>
      </div>
      <div className="mi-vs">VS</div>
      <div className="mi-side mi-opp">
        {hero(opp.hero.cardId) && <CardView card={hero(opp.hero.cardId)!} width="var(--mi-w)" tilt={false} noPopout />}
        <div className="mi-name">{name(opp.name)}</div>
        <div className="mi-sub">{hero(opp.hero.cardId)?.name}</div>
      </div>
      <div className="mi-flash" />
    </div>
  );
}

// ---------------------------------------------------------------- hint arrows

/** Dotted arrows from the suggested card(s) to where they go: step 1 to the combat chain, blockers to the attack. */
export function HintArrows({ marks, deps }: { marks: Map<number, { kind: string; label: string }>; deps: unknown[] }) {
  const [paths, setPaths] = useState<{ d: string; tip: [number, number]; angle: number; kind: string }[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      const out: typeof paths = [];
      const targetChain = rect('.chain-links .link:last-child .chain-card');
      const chainBand = rect('.mat-chain');
      for (const [uid, m] of marks) {
        if (!(m.kind === 'play' && m.label === '1') && m.kind !== 'block') continue;
        const el = [...document.querySelectorAll<HTMLElement>(`[data-uid="${uid}"]`)].map((e) => e.querySelector('.card') ?? e).find(Boolean);
        const from = el?.getBoundingClientRect();
        const to = m.kind === 'block' ? targetChain : chainBand;
        if (!from || !to || from.width === 0) continue;
        const x1 = from.left + from.width / 2;
        const y1 = from.top + 4;
        const x2 = to.left + to.width / 2;
        const y2 = to.top + to.height / 2;
        if (Math.hypot(x2 - x1, y2 - y1) < 40) continue;
        const cx = (x1 + x2) / 2 + (x2 > x1 ? -60 : 60);
        const cy = Math.min(y1, y2) - 30;
        out.push({ d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, tip: [x2, y2], angle: Math.atan2(y2 - cy, x2 - cx) * 180 / Math.PI, kind: m.kind });
      }
      setPaths(out);
    };
    // the attacking card may still be flying onto the chain: wait for it to land before aiming at it
    const blocking = [...marks.values()].some((m) => m.kind === 'block');
    setPaths([]);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (!blocking) measure(); }));
    const late = setTimeout(measure, blocking ? 650 : 500);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(id); clearTimeout(late); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, ...deps]);
  if (!paths.length) return null;
  return (
    <svg className="hint-arrows" aria-hidden>
      {paths.map((p, i) => (
        <g key={i} className={`ha ${p.kind}`}>
          <path d={p.d} className="ha-line" />
          <polygon points="0,-7 14,0 0,7" transform={`translate(${p.tip[0]} ${p.tip[1]}) rotate(${p.angle})`} className="ha-head" />
        </g>
      ))}
    </svg>
  );
}
