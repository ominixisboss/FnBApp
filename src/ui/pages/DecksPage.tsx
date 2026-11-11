import { useMemo, useState } from 'react';
import { card, eligibleForHero, getDb, isHero, supertypes } from '../../data/cardDb';
import type { Card } from '../../data/types';
import { PITCH_COLOR } from '../../data/types';
import type { Deck, DeckFormat } from '../../deck/deck';
import {
  FORMAT_RULES, autoBuildDeck, deckCounts, exportDecklist, heroesFor, importDecklist, isArenaCard,
  loadDecks, newDeck, saveDecks, validateDeck,
} from '../../deck/deck';
import CardView from '../components/CardView';
import CardDetail from '../components/CardDetail';
import CardFilters from '../components/CardFilters';
import { emptyFilter, filterCards } from '../search';

export function useDecks() {
  const [decks, setDecksState] = useState<Deck[]>(() => loadDecks());
  const setDecks = (d: Deck[]) => {
    setDecksState(d);
    saveDecks(d);
  };
  return [decks, setDecks] as const;
}

export default function DecksPage({ deckId }: { deckId?: string }) {
  const [decks, setDecks] = useDecks();
  const deck = decks.find((d) => d.id === deckId);
  const update = (d: Deck) => setDecks(decks.map((x) => (x.id === d.id ? { ...d, updatedAt: Date.now() } : x)));
  if (deckId && deck) return <DeckEditor deck={deck} onChange={update} onDelete={() => { setDecks(decks.filter((d) => d.id !== deck.id)); location.hash = 'decks'; }} />;
  return <DeckList decks={decks} setDecks={setDecks} />;
}

function DeckList({ decks, setDecks }: { decks: Deck[]; setDecks: (d: Deck[]) => void }) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const add = (d: Deck) => {
    setDecks([d, ...decks]);
    location.hash = `decks/${d.id}`;
  };
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Your Decks</h1>
        <div className="row">
          <button className="primary" onClick={() => setCreating(true)}>+ New deck</button>
          <button onClick={() => setImporting(true)}>Import decklist</button>
        </div>
      </div>
      {decks.length === 0 && (
        <div className="panel">
          <p>You don’t have any decks yet. Build one from the card database, import a list from Fabrary or FaB DB, or let the app auto-build a starter deck for any hero.</p>
        </div>
      )}
      <div className="col">
        {decks.map((d) => {
          const hero = getDb().byId.get(d.heroId);
          const errs = validateDeck(d).filter((e) => !e.startsWith('No weapon'));
          const { main, arena } = deckCounts(d);
          return (
            <a key={d.id} href={`#decks/${d.id}`} className="panel deck-tile tile">
              {hero && <CardView card={hero} width={70} />}
              <div className="grow">
                <h3 style={{ margin: 0 }}>{d.name}</h3>
                <div className="muted small">{hero?.name} · {d.format === 'cc' ? 'Classic Constructed' : d.format === 'blitz' ? 'Blitz' : 'Casual'} · {main} cards + {arena} equipment/weapons</div>
                <div className={`small ${errs.length ? 'err' : 'ok'}`}>{errs.length ? `${errs.length} issue${errs.length > 1 ? 's' : ''}` : '✓ Legal'}</div>
              </div>
            </a>
          );
        })}
      </div>
      {creating && <NewDeckDialog onClose={() => setCreating(false)} onCreate={add} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onImport={add} />}
    </div>
  );
}

export function HeroPicker({ format, value, onPick }: { format: DeckFormat; value?: string; onPick: (h: Card) => void }) {
  const [q, setQ] = useState('');
  const heroes = useMemo(() => {
    const list = format === 'casual' ? getDb().cards.filter((c) => isHero(c) && !c.types.includes('Demi-Hero')) : heroesFor(format);
    return list.filter((h) => h.name.toLowerCase().includes(q.toLowerCase()));
  }, [format, q]);
  return (
    <div className="col">
      <input type="search" placeholder="Search heroes…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="hero-pick">
        {heroes.map((h) => (
          <div key={h.id} className="col" style={{ alignItems: 'center' }}>
            <CardView card={h} width="100%" className={value === h.id ? 'sel' : ''} onClick={() => onPick(h)} />
            <span className="small" style={{ textAlign: 'center' }}>{h.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewDeckDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (d: Deck) => void }) {
  const [format, setFormat] = useState<DeckFormat>('blitz');
  const [hero, setHero] = useState<Card | null>(null);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close small" onClick={onClose}>✕</button>
        <h2>New deck</h2>
        <div className="row" style={{ marginBottom: '.8rem' }}>
          <label>Format </label>
          <select value={format} onChange={(e) => { setFormat(e.target.value as DeckFormat); setHero(null); }}>
            <option value="blitz">Blitz (young hero, 40 cards, max 2 copies)</option>
            <option value="cc">Classic Constructed (adult hero, 60+ cards, max 3 copies)</option>
            <option value="casual">Casual (no restrictions)</option>
          </select>
        </div>
        <HeroPicker format={format} value={hero?.id} onPick={setHero} />
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button disabled={!hero} onClick={() => hero && onCreate(newDeck(hero.id, format))}>Start empty</button>
          <button className="primary" disabled={!hero} onClick={() => hero && onCreate({ ...autoBuildDeck(hero.id, format, Date.now() & 0xffff), name: `${hero.name} starter` })}>
            Auto-build starter deck
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (d: Deck) => void }) {
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? importDecklist(text) : null), [text]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close small" onClick={onClose}>✕</button>
        <h2>Import a decklist</h2>
        <p className="muted small">
          Paste a text decklist. On Fabrary use <i>Copy → Copy as text</i> (FaB DB and Talishar text exports also work). Lines like
          <code> Hero: Name</code>, <code>(3) Card Name (red)</code>, <code>3x Card Name (blue)</code> and <code>Equipment: A, B</code> are recognised.
        </p>
        <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Hero: Dorinthea\nWeapons: Dawnblade\nEquipment: Braveforge Bracers\n\n(2) Ironsong Response (red)\n(2) Warrior\'s Valor (yellow)\n...'} />
        {result && (
          <div className="small" style={{ marginTop: '.5rem' }}>
            {result.deck && <div className="ok">Found {card(result.deck.heroId).name} with {Object.values(result.deck.cards).reduce((a, b) => a + b, 0)} cards.</div>}
            {result.warnings.map((w, i) => <div key={i} className="err">{w}</div>)}
          </div>
        )}
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button className="primary" disabled={!result?.deck} onClick={() => result?.deck && onImport(result.deck)}>Import</button>
        </div>
      </div>
    </div>
  );
}

function DeckEditor({ deck, onChange, onDelete }: { deck: Deck; onChange: (d: Deck) => void; onDelete: () => void }) {
  const hero = card(deck.heroId);
  const [f, setF] = useState(emptyFilter);
  const [limit, setLimit] = useState(48);
  const [open, setOpen] = useState<Card | null>(null);
  const [showExport, setShowExport] = useState(false);
  const rules = FORMAT_RULES[deck.format];
  const pool = useMemo(
    () => getDb().cards.filter((c) => eligibleForHero(c, hero) && (!rules.legalKey || c.legal.includes(rules.legalKey as never))),
    [hero, rules.legalKey],
  );
  const results = useMemo(() => filterCards(pool, f), [pool, f]);
  const errs = validateDeck(deck);
  const { main, arena } = deckCounts(deck);
  const setCount = (id: string, cnt: number) => {
    const cards = { ...deck.cards };
    if (cnt <= 0) delete cards[id];
    else cards[id] = cnt;
    onChange({ ...deck, cards });
  };
  const entries = Object.entries(deck.cards).map(([id, cnt]) => ({ c: card(id), cnt }));
  const groups: [string, typeof entries][] = [
    ['Weapons & equipment', entries.filter((e) => isArenaCard(e.c))],
    ['Red (pitch 1)', entries.filter((e) => !isArenaCard(e.c) && e.c.pitch === 1)],
    ['Yellow (pitch 2)', entries.filter((e) => !isArenaCard(e.c) && e.c.pitch === 2)],
    ['Blue (pitch 3)', entries.filter((e) => !isArenaCard(e.c) && e.c.pitch === 3)],
    ['Other', entries.filter((e) => !isArenaCard(e.c) && !e.c.pitch)],
  ];
  const curve = [0, 1, 2, 3, 4].map((cost) => entries.filter((e) => !isArenaCard(e.c) && (cost === 4 ? Number(e.c.cost) >= 4 : Number(e.c.cost) === cost)).reduce((a, e) => a + e.cnt, 0));
  const exportText = exportDecklist(deck);
  return (
    <div>
      <div className="row" style={{ marginBottom: '.8rem' }}>
        <a href="#decks">← Decks</a>
        <input value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value })} style={{ fontSize: '1.2rem', flex: 1, minWidth: 200 }} />
        <select value={deck.format} onChange={(e) => onChange({ ...deck, format: e.target.value as DeckFormat })}>
          <option value="blitz">Blitz</option>
          <option value="cc">Classic Constructed</option>
          <option value="casual">Casual</option>
        </select>
        <a href={`#play/${deck.id}`}><button className="primary">▶ Play with this deck</button></a>
      </div>
      <div className="editor">
        <div>
          <CardFilters f={f} set={(nf) => { setF(nf); setLimit(48); }} hideFormat classOptions={['Generic', ...supertypes(hero)]} />
          <p className="muted small">{results.length} cards available to {hero.name}. Click a card to add it, right-click (or open details) to remove.</p>
          <div className="grid">
            {results.slice(0, limit).map((c) => (
              <div key={c.id} onContextMenu={(e) => { e.preventDefault(); setCount(c.id, (deck.cards[c.id] ?? 0) - 1); }}>
                <CardView
                  card={c}
                  width="100%"
                  count={deck.cards[c.id] || undefined}
                  onClick={() => setCount(c.id, (deck.cards[c.id] ?? 0) + 1)}
                />
                <button className="small" style={{ width: '100%', marginTop: 4 }} onClick={() => setOpen(c)}>Details</button>
              </div>
            ))}
          </div>
          {results.length > limit && <div style={{ textAlign: 'center', margin: '1rem' }}><button onClick={() => setLimit(limit + 96)}>Show more</button></div>}
        </div>
        <div className="panel decklist">
          <div className="row">
            <CardView card={hero} width={90} onClick={() => setOpen(hero)} />
            <div className="col grow">
              <b>{hero.name}</b>
              <span className="small muted">Life {hero.health} · Intellect {hero.intellect}</span>
              <span className={`small ${main >= rules.minDeck && main <= rules.maxDeck ? 'ok' : 'err'}`}>
                {main} / {rules.minDeck === rules.maxDeck ? rules.minDeck : `${rules.minDeck}+`} deck cards · {arena} arena
              </span>
            </div>
          </div>
          <div className="small muted" style={{ margin: '.5rem 0' }}>
            Cost curve: {curve.map((n, i) => `${i === 4 ? '4+' : i}:${n}`).join('  ')}
          </div>
          {groups.map(([label, list]) => list.length > 0 && (
            <div key={label}>
              <h4 style={{ margin: '.8rem 0 .2rem' }}>{label} <span className="muted">({list.reduce((a, e) => a + e.cnt, 0)})</span></h4>
              {list.sort((a, b) => a.c.name.localeCompare(b.c.name)).map(({ c, cnt }) => (
                <div key={c.id} className="dl-row">
                  {c.pitch && <span className={`pitch-${c.pitch}`}><span className="dot" /></span>}
                  <span className="nm" onClick={() => setOpen(c)}>{c.name}</span>
                  <button onClick={() => setCount(c.id, cnt - 1)}>−</button>
                  <b>{cnt}</b>
                  <button onClick={() => setCount(c.id, cnt + 1)}>+</button>
                </div>
              ))}
            </div>
          ))}
          <div style={{ marginTop: '1rem' }}>
            {errs.length === 0 ? <div className="ok small">✓ Deck is legal for {deck.format === 'cc' ? 'Classic Constructed' : deck.format}.</div> : errs.map((e, i) => <div key={i} className="small err">• {e}</div>)}
          </div>
          <div className="row" style={{ marginTop: '1rem' }}>
            <button onClick={() => setShowExport(!showExport)}>Export</button>
            <button onClick={() => { if (confirm('Replace this deck’s cards with an auto-built list?')) onChange({ ...deck, cards: autoBuildDeck(deck.heroId, deck.format, Date.now() & 0xffff).cards }); }}>Auto-build</button>
            <button onClick={() => { if (confirm(`Delete “${deck.name}”?`)) onDelete(); }}>Delete</button>
          </div>
          {showExport && (
            <div className="col" style={{ marginTop: '.6rem' }}>
              <textarea rows={12} readOnly value={exportText} />
              <button onClick={() => navigator.clipboard?.writeText(exportText)}>Copy to clipboard</button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <CardDetail
          card={open}
          onClose={() => setOpen(null)}
          actions={!isHero(open) && (
            <div className="row">
              <button onClick={() => setCount(open.id, (deck.cards[open.id] ?? 0) - 1)}>− Remove</button>
              <b>{deck.cards[open.id] ?? 0} in deck</b>
              <button onClick={() => setCount(open.id, (deck.cards[open.id] ?? 0) + 1)}>+ Add</button>
              {open.pitch && <span className="muted small">({PITCH_COLOR[open.pitch]})</span>}
            </div>
          )}
        />
      )}
    </div>
  );
}
