import type { Card } from '../data/types';
import { CLASSES, TALENTS } from '../data/types';

export interface CardFilter {
  q: string;
  cls: string;
  type: string;
  pitch: string;
  format: string;
}

export const emptyFilter: CardFilter = { q: '', cls: '', type: '', pitch: '', format: '' };

export const TYPE_OPTIONS = [
  'Hero', 'Attack Action', 'Non-attack Action', 'Attack Reaction', 'Defense Reaction', 'Instant',
  'Weapon', 'Equipment', 'Aura', 'Item', 'Ally', 'Block', 'Resource', 'Token',
];

export const CLASS_OPTIONS = [...CLASSES, ...TALENTS];

export function matchType(c: Card, t: string): boolean {
  switch (t) {
    case 'Attack Action': return c.types.includes('Action') && c.types.includes('Attack');
    case 'Non-attack Action': return c.types.includes('Action') && !c.types.includes('Attack');
    default: return c.types.includes(t);
  }
}

export function filterCards(cards: Card[], f: CardFilter): Card[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((c) => {
    if (f.cls && !c.types.includes(f.cls)) return false;
    if (f.type && !matchType(c, f.type)) return false;
    if (f.pitch && String(c.pitch ?? '') !== f.pitch) return false;
    if (f.format && !c.legal.includes(f.format as never)) return false;
    if (terms.length) {
      const hay = `${c.name} ${c.typeText} ${c.text} ${c.keywords.join(' ')}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}
