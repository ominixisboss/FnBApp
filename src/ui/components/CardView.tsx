import { useState } from 'react';
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

export default function CardView({ card, width = 150, className = '', badge, count, onClick, onHover, title, tilt = true }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const style = { '--w': typeof width === 'number' ? `${width}px` : width } as CSSProperties;
  return (
    <div
      className={`card ${tilt ? 'tilt' : ''} ${card.pitch ? `pitch-${card.pitch}` : ''} ${className}`}
      style={style}
      onClick={onClick}
      onMouseMove={tilt ? onTilt : undefined}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      title={title ?? card.name}
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
