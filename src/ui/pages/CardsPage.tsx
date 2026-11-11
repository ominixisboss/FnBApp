import { useMemo, useState } from 'react';
import { getDb } from '../../data/cardDb';
import type { Card } from '../../data/types';
import CardView from '../components/CardView';
import CardDetail from '../components/CardDetail';
import CardFilters from '../components/CardFilters';
import { emptyFilter, filterCards } from '../search';

const PAGE = 60;

export default function CardsPage() {
  const db = getDb();
  const [f, setF] = useState(emptyFilter);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Card | null>(null);
  const results = useMemo(() => filterCards(db.cards, f), [db, f]);
  return (
    <div>
      <h1>Card Database</h1>
      <p className="muted small">
        {db.cards.length.toLocaleString()} cards from the open-source{' '}
        <a href="https://github.com/the-fab-cube/flesh-and-blood-cards" target="_blank" rel="noreferrer">the-fab-cube</a> dataset
        {db.builtAt && <> (updated {new Date(db.builtAt).toLocaleDateString()})</>}.
      </p>
      <CardFilters f={f} set={(nf) => { setF(nf); setLimit(PAGE); }} />
      <p className="muted small">{results.length.toLocaleString()} matching cards</p>
      <div className="grid">
        {results.slice(0, limit).map((c) => <CardView key={c.id} card={c} onClick={() => setOpen(c)} />)}
      </div>
      {results.length > limit && (
        <div style={{ textAlign: 'center', margin: '1rem' }}>
          <button onClick={() => setLimit(limit + PAGE * 2)}>Show more</button>
        </div>
      )}
      {open && <CardDetail card={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
