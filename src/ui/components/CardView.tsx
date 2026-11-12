import { useEffect, useRef, useState } from 'react';
import { hideHover, isPinnedFor, newHoverOwner, showHover } from './HoverCard';
import type { CSSProperties, ReactNode } from 'react';
import type { Card } from '../../data/types';

interface Props {
  card: Card;
  width?: number | string;
  className?: string;
  badge?: ReactNode;
  count?: number;
  onClick?: () => void;
  onHover?: (c: Card | null) => void;
  title?: string;
  tilt?: boolean;
  /** don't show the readable pop-out for this card */
  noPopout?: boolean;
  /** called when a tap opens this card's details (touch screens) */
  onInspect?: () => void;
}

function onTilt(e: React.MouseEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
  el.style.setProperty('--rx', `${(0.5 - y) * 18}deg`);
  el.style.setProperty('--mx', `${x * 100}%`);
  el.style.setProperty('--my', `${y * 100}%`);
}

export default function CardView({ card, width = 150, className = '', badge, count, onClick, onHover, title, tilt = true, noPopout, onInspect }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const style = { '--w': typeof width === 'number' ? `${width}px` : width } as CSSProperties;
  const [owner] = useState(newHoverOwner);
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; fired: boolean }>({ t: null, fired: false });
  useEffect(() => () => hideHover(owner), [owner]);
  const popout = !noPopout;
  const lastPointer = useRef<string>('mouse');
  return (
    <div
      tabIndex={popout ? 0 : undefined}
      onPointerEnter={(e) => { if (popout && e.pointerType === 'mouse') showHover(card, e.currentTarget, owner); }}
      onPointerLeave={(e) => { if (popout && e.pointerType === 'mouse') hideHover(owner); }}
      onFocus={(e) => { if (popout && e.currentTarget.matches(':focus-visible')) showHover(card, e.currentTarget, owner, { delay: 0 }); }}
      onBlur={() => popout && hideHover(owner)}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      onTouchStart={(e) => {
        if (!popout) return;
        const el = e.currentTarget;
        press.current.fired = false;
        press.current.t = setTimeout(() => { press.current.fired = true; showHover(card, el, owner, { delay: 0, pinned: true }); }, 420);
      }}
      onTouchMove={() => { if (press.current.t) clearTimeout(press.current.t); }}
      onTouchEnd={(e) => {
        if (press.current.t) clearTimeout(press.current.t);
        if (press.current.fired) e.preventDefault(); // long-press: don't also "click" the card
      }}
      onContextMenu={(e) => { if (press.current.fired) e.preventDefault(); }}
      className={`card ${tilt ? 'tilt' : ''} ${card.pitch ? `pitch-${card.pitch}` : ''} ${className}`}
      style={style}
      onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
      onClick={(e) => {
        if (press.current.fired) { press.current.fired = false; return; }
        // touch: the first tap shows the card's details; tapping it again does its normal action
        if (popout && lastPointer.current === 'touch' && !isPinnedFor(owner)) {
          showHover(card, e.currentTarget, owner, { delay: 0, pinned: true });
          onInspect?.();
          return;
        }
        onClick?.();
      }}
      onMouseMove={tilt ? onTilt : undefined}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      title={popout ? undefined : title ?? card.name}
      aria-label={title ?? card.name}
    >
      {!loaded && <TextCard card={card} />}
      {card.image && !failed && (
        <img src={card.image} alt={card.name} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          style={loaded ? undefined : { position: 'absolute', inset: 0, opacity: 0 }} />
      )}
      {tilt && <span className="shine" />}
      {count !== undefined && <span key={count} className="count anim-pop">{count}</span>}
      {badge !== undefined && badge !== null && <span className="badge">{badge}</span>}
    </div>
  );
}

export function TextCard({ card }: { card: Card }) {
  return (
    <div className="fallback">
      <div className="st">
        <span>{card.pitch ? `◆${card.pitch}` : ''}</span>
        <span>{card.cost !== null ? `⛀${card.cost}` : ''}</span>
      </div>
      <div className="nm">{card.name}</div>
      <div className="small">{card.typeText}</div>
      <div className="tx">{card.text}</div>
      <div className="st">
        <span>{card.power !== null ? `⚔${card.power}` : ''}</span>
        <span>{card.health !== null ? `♥${card.health}` : ''}</span>
        <span>{card.defense !== null ? `⛨${card.defense}` : ''}</span>
      </div>
    </div>
  );
}

export function CardBack({ width = 80, label }: { width?: number | string; label?: ReactNode }) {
  return (
    <div className="card card-back" style={{ '--w': typeof width === 'number' ? `${width}px` : width, cursor: 'default' } as CSSProperties}>
      {label}
    </div>
  );
}
