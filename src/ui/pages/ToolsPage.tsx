// Companion tools for real tabletop play: a life counter, sample hands, and a printable decklist.
import { useEffect, useMemo, useRef, useState } from 'react';
import { card, getDb, isHero } from '../../data/cardDb';
import type { Card } from '../../data/types';
import { formatName, isArenaCard, loadDecks } from '../../deck/deck';
import type { Deck } from '../../deck/deck';
import { loadProfile } from '../../stats/profile';
import CardView from '../components/CardView';

export default function ToolsPage({ tool }: { tool?: string }) {
  if (tool === 'life') return <LifeCounter />;
  if (tool === 'hands') return <SampleHands />;
  if (tool === 'sheet') return <DeckSheet />;
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <h1 style={{ marginBottom: 0 }}>🧰 Table tools</h1>
      <p className="muted" style={{ marginTop: 0 }}>For games with real cards.</p>
      <div className="tiles">
        <a className="panel tile" href="#tools/life"><h3>❤ Life counter</h3><p className="muted">Big buttons for both players, facing each other across the table. Keeps the screen awake.</p></a>
        <a className="panel tile" href="#tools/hands"><h3>🃏 Sample hands</h3><p className="muted">Draw opening hands from any of your decks to see how it plays, or goldfish a whole game.</p></a>
        <a className="panel tile" href="#tools/sheet"><h3>📝 Deck registration</h3><p className="muted">A printable decklist for tournament registration.</p></a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- life counter

function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const get = () => { void nav.wakeLock?.request('screen').then((l) => { lock = l; }, () => {}); };
    get();
    const vis = () => { if (document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release().catch(() => {}); };
  }, []);
}

function LifeCounter() {
  useWakeLock();
  const heroes = useMemo(() => getDb().cards.filter((c) => isHero(c) && !c.types.includes('Demi-Hero')).sort((a, b) => a.name.localeCompare(b.name)), []);
  const [players, setPlayers] = useState(() => [0, 1].map(() => ({ heroId: '', life: 20, res: 0, ap: 0 })));
  const set = (i: number, patch: Partial<(typeof players)[0]>) => setPlayers((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = (i: number, d: number) => ({
    onPointerDown: () => { hold.current = setTimeout(() => { set(i, { life: players[i].life + d * 5 }); hold.current = null; }, 450); },
    onPointerUp: () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; set(i, { life: players[i].life + d }); } },
    onPointerLeave: () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } },
  });
  return (
    <div className="life-counter">
      {players.map((p, i) => {
        const hero = p.heroId ? card(p.heroId) : null;
        return (
          <div key={i} className={`lc-side ${i === 1 ? 'flip' : ''} ${p.life <= 5 ? 'low' : ''}`} style={hero?.image ? { backgroundImage: `linear-gradient(#000a, #000d), url(${hero.image})` } : undefined}>
            <select value={p.heroId} onChange={(e) => { const h = e.target.value; set(i, { heroId: h, life: h ? card(h).health ?? 20 : 20 }); }}>
              <option value="">{i === 0 ? 'Your hero' : 'Opponent’s hero'}</option>
              {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}{h.types.includes('Young') ? ' (young)' : ''}</option>)}
            </select>
            <div className="lc-life">
              <button className="lc-btn" {...press(i, -1)} aria-label="Lose 1 life (hold for 5)">−</button>
              <span className="lc-num">{p.life}</span>
              <button className="lc-btn" {...press(i, 1)} aria-label="Gain 1 life (hold for 5)">+</button>
            </div>
            <div className="lc-small">
              <span>⛀ <button onClick={() => set(i, { res: Math.max(0, p.res - 1) })}>−</button> {p.res} <button onClick={() => set(i, { res: p.res + 1 })}>+</button></span>
              <span>⚡ <button onClick={() => set(i, { ap: Math.max(0, p.ap - 1) })}>−</button> {p.ap} <button onClick={() => set(i, { ap: p.ap + 1 })}>+</button></span>
            </div>
          </div>
        );
      })}
      <div className="lc-bar">
        <a className="btn-link small" href="#tools">← Tools</a>
        <button className="small" onClick={() => setPlayers((ps) => ps.map((p) => ({ ...p, life: p.heroId ? card(p.heroId).health ?? 20 : 20, res: 0, ap: 0 })))}>New game</button>
        <span className="small muted">Tap ± for 1 · hold for 5</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sample hands

function shuffled<T>(xs: T[]) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function SampleHands() {
  const decks = loadDecks();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const deck = decks.find((d) => d.id === deckId);
  const [order, setOrder] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const intellect = deck ? card(deck.heroId).intellect ?? 4 : 4;
  const newHand = () => {
    if (!deck) return;
    const ids = Object.entries(deck.cards).flatMap(([id, n]) => (isArenaCard(card(id)) ? [] : Array(n).fill(id) as string[]));
    setOrder(shuffled(ids));
    setShown(intellect);
  };
  useEffect(newHand, [deckId]); // eslint-disable-line react-hooks/exhaustive-deps
  const hand = order.slice(0, shown);
  const pitch = hand.reduce((a, id) => a + (card(id).pitch ?? 0), 0);
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>🃏 Sample hands</h1>
        <a className="btn-link small" href="#tools">← Tools</a>
      </div>
      {!decks.length && <div className="panel">Build or import a deck first. <a href="#decks">Decks</a></div>}
      {deck && (
        <>
          <div className="row">
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>{decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <button className="primary" onClick={newHand}>New hand</button>
            <button onClick={() => setShown(Math.min(order.length, shown + intellect))}>Draw next turn ({intellect})</button>
            <button onClick={() => setShown(Math.min(order.length, shown + 1))}>Draw 1</button>
            <a className="btn-link" href={`#play/${deck.id}`}>🐟 Goldfish a game</a>
          </div>
          <div className="small muted">{shown} cards seen · this hand pitches for {pitch} resources · {hand.filter((id) => card(id).types.includes('Attack')).length} attacks</div>
          <div className="sample-hand">{hand.map((id, i) => <div key={i} className="pack-card" style={{ animationDelay: `${(i % intellect) * 80}ms` }}><CardView card={card(id)} width="100%" /></div>)}</div>
          <p className="small muted">“Goldfish a game” opens the Play page with this deck: choose the 🐟 Goldfish opponent there to play turns against a dummy.</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- printable decklist

function DeckSheet() {
  const decks = loadDecks();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const [player, setPlayer] = useState(() => loadProfile().displayName);
  const [gemId, setGemId] = useState('');
  const [event, setEvent] = useState('');
  const deck: Deck | undefined = decks.find((d) => d.id === deckId);
  const rows = deck ? Object.entries(deck.cards).map(([id, n]) => ({ c: card(id), n })) : [];
  const arena = rows.filter((r) => isArenaCard(r.c));
  const main = rows.filter((r) => !isArenaCard(r.c));
  const byPitch = (p: number | null) => main.filter((r) => (r.c.pitch ?? null) === p).sort((a, b) => a.c.name.localeCompare(b.c.name));
  const total = main.reduce((a, r) => a + r.n, 0);
  const list = (title: string, rs: { c: Card; n: number }[]) => rs.length > 0 && (
    <div className="sheet-group"><b>{title} ({rs.reduce((a, r) => a + r.n, 0)})</b>{rs.map((r) => <div key={r.c.id}>{r.n} × {r.c.name}</div>)}</div>
  );
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row no-print" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>📝 Deck registration</h1>
        <a className="btn-link small" href="#tools">← Tools</a>
      </div>
      {!decks.length && <div className="panel no-print">Build or import a deck first. <a href="#decks">Decks</a></div>}
      {deck && (
        <>
          <div className="row no-print">
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>{decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Player name" />
            <input value={gemId} onChange={(e) => setGemId(e.target.value)} placeholder="GEM ID" style={{ width: 120 }} />
            <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Event" />
            <button className="primary" onClick={() => window.print()}>🖨 Print</button>
          </div>
          <div className="deck-sheet">
            <h2>Flesh and Blood decklist</h2>
            <div className="sheet-head">
              <span><b>Player:</b> {player || '__________'}</span><span><b>GEM ID:</b> {gemId || '__________'}</span>
              <span><b>Event:</b> {event || '__________'}</span><span><b>Date:</b> {new Date().toLocaleDateString()}</span>
              <span><b>Format:</b> {formatName(deck.format)}</span><span><b>Hero:</b> {card(deck.heroId).name}</span>
            </div>
            <div className="sheet-cols">
              {list('Weapons & equipment', arena.sort((a, b) => a.c.name.localeCompare(b.c.name)))}
              {list('Red', byPitch(1))}
              {list('Yellow', byPitch(2))}
              {list('Blue', byPitch(3))}
              {list('No pitch', byPitch(null))}
            </div>
            <div className="sheet-foot"><b>Deck: {total} cards</b> · Equipment & weapons: {arena.reduce((a, r) => a + r.n, 0)} · Signature: ________________</div>
          </div>
        </>
      )}
    </div>
  );
}
