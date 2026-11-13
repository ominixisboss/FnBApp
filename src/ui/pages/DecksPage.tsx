import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { card, eligibleForHero, getDb, isHero, supertypes } from '../../data/cardDb';
import type { Card } from '../../data/types';
import { PITCH_COLOR } from '../../data/types';
import type { Deck, DeckFormat } from '../../deck/deck';
import {
  FORMATS, FORMAT_RULES, autoBuildDeck, formatName, chanceToSee, deckCounts, deckSiteLink, exportDecklist, heroesFor, importDecklist, isArenaCard,
  loadDecks, newDeck, saveDecks, validateDeck,
} from '../../deck/deck';
import CardView from '../components/CardView';
import CardDetail from '../components/CardDetail';
import CardFilters from '../components/CardFilters';
import { emptyFilter, filterCards } from '../search';
import { downloadText, readFile, safeFileName, setNavGuard } from '../navGuard';
import { Toast } from '../components/Fx';
import { offlineImagesSupported, saveImagesForOffline } from '../offline';

export function useDecks() {
  const [decks, setDecksState] = useState<Deck[]>(() => loadDecks());
  useEffect(() => {
    const reload = () => setDecksState(loadDecks());
    window.addEventListener('fab-synced', reload);
    return () => window.removeEventListener('fab-synced', reload);
  }, []);
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
  const saveAs = (d: Deck) => {
    const copy = { ...d, id: Math.random().toString(36).slice(2, 10), name: `${d.name} (copy)`, updatedAt: Date.now() };
    setDecks([copy, ...decks]);
    return copy;
  };
  if (deckId && deck) return <DeckEditor key={deck.id} deck={deck} onChange={update} onSaveAs={saveAs} onDelete={() => { setDecks(decks.filter((d) => d.id !== deck.id)); location.hash = 'decks'; }} />;
  if (deckId && !deck) return <div className="panel">That deck doesn’t exist any more. <a href="#decks">Back to your decks</a></div>;
  return <DeckList decks={decks} setDecks={setDecks} />;
}

function DeckList({ decks, setDecks }: { decks: Deck[]; setDecks: (d: Deck[]) => void }) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const backup = () => {
    downloadText(`fab-decks-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'fab-trainer', version: 1, decks }, null, 2), 'application/json');
  };
  const restore = async (file: File) => {
    try {
      const json = JSON.parse(await readFile(file));
      const incoming: Deck[] = (Array.isArray(json) ? json : json.decks).filter((d: Deck) => d && d.id && d.heroId && getDb().byId.has(d.heroId));
      const byId = new Map(decks.map((d) => [d.id, d]));
      incoming.forEach((d) => byId.set(d.id, d));
      setDecks([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt));
      flash(`Restored ${incoming.length} deck${incoming.length === 1 ? '' : 's'}`);
    } catch {
      alert('That file isn’t a FaB Trainer deck backup.');
    }
  };
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2300); };
  // pre-download the art of every card in your decks so it shows without a connection
  const [offline, setOffline] = useState<string | null>(null);
  const saveOffline = async () => {
    const ids = new Set(decks.flatMap((d) => [d.heroId, ...Object.keys(d.cards)]));
    const urls = [...ids].map((id) => getDb().byId.get(id)?.image ?? '').filter(Boolean);
    setOffline(`0 / ${urls.length}`);
    const ok = await saveImagesForOffline(urls, (n, total) => setOffline(`${n} / ${total}`));
    setOffline(null);
    flash(ok === urls.length ? `Saved ${ok} card images for offline` : `Saved ${ok} of ${urls.length} card images (check your connection)`);
  };
  const duplicate = (d: Deck) => {
    setDecks([{ ...d, id: Math.random().toString(36).slice(2, 10), name: `${d.name} (copy)`, updatedAt: Date.now() }, ...decks]);
    flash('Deck duplicated');
  };
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
          <button onClick={backup} disabled={!decks.length} title="Download all decks as a backup file">⬇ Backup all</button>
          <button onClick={() => restoreRef.current?.click()} title="Load decks from a backup file">⬆ Restore</button>
          {offlineImagesSupported() && (
            <button onClick={saveOffline} disabled={!decks.length || offline !== null} title="Download the card images of all your decks so they show without a connection">
              {offline !== null ? `Saving images… ${offline}` : '📥 Save images for offline'}
            </button>
          )}
          <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </div>
      </div>
      <p className="muted small">Decks are saved in this browser. Use <b>Backup all</b> to keep a copy or move decks to another device. Card images you’ve seen are kept for offline play.</p>
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
            <a key={d.id} href={`#decks/${d.id}`} className="panel deck-tile tile anim-fade-up">
              {hero && <CardView card={hero} width={70} />}
              <div className="grow">
                <h3 style={{ margin: 0 }}>{d.name}</h3>
                <div className="muted small">{hero?.name} · {formatName(d.format)} · {main} cards + {arena} equipment/weapons</div>
                <div className={`small ${errs.length ? 'err' : 'ok'}`}>{errs.length ? `${errs.length} issue${errs.length > 1 ? 's' : ''}` : '✓ Legal'} <span className="muted">· saved {new Date(d.updatedAt).toLocaleString()}</span></div>
              </div>
              <div className="row" onClick={(e) => e.preventDefault()}>
                <button className="small" onClick={() => duplicate(d)}>Duplicate</button>
                <button className="small" onClick={() => downloadText(`${safeFileName(d.name)}.txt`, exportDecklist(d))}>⬇ .txt</button>
                <button className="small primary" onClick={() => { location.hash = `play/${d.id}`; }}>▶ Play</button>
              </div>
            </a>
          );
        })}
      </div>
      {creating && <NewDeckDialog onClose={() => setCreating(false)} onCreate={add} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onImport={add} />}
      {toast && <Toast text={toast} />}
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
            {FORMATS.map(([f, name, rule]) => <option key={f} value={f}>{name} ({rule})</option>)}
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
  const link = deckSiteLink(text);
  const result = useMemo(() => (text.trim() && !deckSiteLink(text) ? importDecklist(text) : null), [text]);
  const paste = async () => { try { setText(await navigator.clipboard.readText()); } catch { /* clipboard blocked: paste by hand */ } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close small" onClick={onClose}>✕</button>
        <h2>Import a decklist</h2>
        <p className="muted small">
          Paste a text decklist. On Fabrary use <i>Copy → Copy as text</i> (FaB DB and Talishar text exports also work). Lines like
          <code> Hero: Name</code>, <code>(3) Card Name (red)</code>, <code>3x Card Name (blue)</code> and <code>Equipment: A, B</code> are recognised.
        </p>
        <div className="row" style={{ marginBottom: '.5rem' }}>
          <label className="small">Or load a file (.txt): <input type="file" accept=".txt,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readFile(f)); }} /></label>
        </div>
        <div className="row" style={{ marginBottom: '.5rem' }}><button className="small" onClick={paste}>📋 Paste from clipboard</button></div>
        {link && (
          <div className="link-help">
            <b>That’s a {link.site} link.</b> {link.site} doesn’t let other apps download decks, so copy the list as text instead:
            <ol>
              <li>Open the deck: <a href={link.url} target="_blank" rel="noreferrer">{link.site} ↗</a></li>
              <li>{link.site === 'Fabrary' ? <>Press <i>Copy</i> → <i>Copy as text</i></> : link.site === 'FaB DB' ? <>Use <i>Export</i> → <i>Copy to clipboard</i></> : <>Use the deck’s <i>Export</i> → <i>Text</i></>}</li>
              <li>Come back and press <b>📋 Paste from clipboard</b>.</li>
            </ol>
          </div>
        )}
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

function DeckEditor({ deck: saved, onChange: onSave, onSaveAs, onDelete }: { deck: Deck; onChange: (d: Deck) => void; onSaveAs: (d: Deck) => Deck; onDelete: () => void }) {
  // Edits happen on a draft; nothing is stored until you press Save.
  const [deck, onChange] = useState<Deck>(saved);
  const [toast, setToast] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const sig = (d: Deck) => JSON.stringify([d.name, d.format, Object.entries(d.cards).sort()]);
  const dirty = sig(deck) !== sig(saved);
  const dirtyRef = useRef(dirty);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2300); };
  const save = () => { onSave(deck); flash('Deck saved ✓'); };
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
    saveRef.current = save;
  });
  useEffect(() => {
    setNavGuard(() => !dirtyRef.current || confirm('You have unsaved changes to this deck. Leave without saving?'));
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirtyRef.current) saveRef.current(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', keys);
    return () => { setNavGuard(null); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keys); };
  }, []);
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
    setFlashId(`${id}:${cnt}`);
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
          {FORMATS.map(([f, name]) => <option key={f} value={f}>{name}</option>)}
        </select>
        {dirty ? <span className="dirty">● Unsaved changes</span> : <span className="small ok">✓ Saved</span>}
        <button className="gold" disabled={!dirty} onClick={save} title="Save (Ctrl+S)">💾 Save</button>
        <button disabled={!dirty} onClick={() => onChange(saved)}>Revert</button>
        <button onClick={() => { const c = onSaveAs(deck); onChange(saved); dirtyRef.current = false; flash('Saved as a new deck'); location.hash = `decks/${c.id}`; }}>Save as copy</button>
        <a href={`#play/${deck.id}`}><button className="primary">▶ Play</button></a>
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
          <DrawOdds entries={entries} intellect={hero.intellect ?? 4} />
          {groups.map(([label, list]) => list.length > 0 && (
            <div key={label}>
              <h4 style={{ margin: '.8rem 0 .2rem' }}>{label} <span className="muted">({list.reduce((a, e) => a + e.cnt, 0)})</span></h4>
              {list.sort((a, b) => a.c.name.localeCompare(b.c.name)).map(({ c, cnt }) => (
                <div key={flashId?.startsWith(c.id + ':') ? flashId : c.id} className={`dl-row ${flashId?.startsWith(c.id + ':') ? 'flash' : ''}`}>
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
            {errs.length === 0 ? <div className="ok small">✓ Deck is legal for {formatName(deck.format)}.</div> : errs.map((e, i) => <div key={i} className="small err">• {e}</div>)}
          </div>
          <div className="row" style={{ marginTop: '1rem' }}>
            <button onClick={() => setShowExport(!showExport)}>Export</button>
            <button onClick={() => downloadText(`${safeFileName(deck.name)}.txt`, exportText)}>⬇ Download .txt</button>
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
      {toast && <Toast text={toast} />}
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

/** Pitch balance and the chance to draw each card: in your opening hand, and by your 2nd / 3rd turn. */
function DrawOdds({ entries, intellect }: { entries: { c: Card; cnt: number }[]; intellect: number }) {
  const [open, setOpen] = useState(false);
  const deck = entries.filter((e) => !isArenaCard(e.c));
  const size = deck.reduce((a, e) => a + e.cnt, 0);
  if (!size) return null;
  const byPitch = [1, 2, 3].map((p) => deck.filter((e) => e.c.pitch === p).reduce((a, e) => a + e.cnt, 0));
  const avgPitch = deck.reduce((a, e) => a + (e.c.pitch ?? 0) * e.cnt, 0) / size;
  const blueHand = chanceToSee(size, byPitch[2], intellect);
  const pctf = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="draw-odds">
      <div className="pitch-bar" title="Red / yellow / blue cards in the deck">
        {byPitch.map((n, i) => n > 0 && <span key={i} className={`pitch-${i + 1}`} style={{ flex: n }}>{n}</span>)}
      </div>
      <div className="small muted">Average pitch {avgPitch.toFixed(2)} · about {(avgPitch * intellect).toFixed(1)} resources in a full hand · {pctf(blueHand)} of opening hands have a blue</div>
      <button className="small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} draw odds</button>
      {open && (
        <table className="odds">
          <thead><tr><th>Card</th><th>#</th><th>Opening hand</th><th>By turn 2</th><th>By turn 3</th></tr></thead>
          <tbody>
            {[...deck].sort((a, b) => b.cnt - a.cnt || a.c.name.localeCompare(b.c.name)).map(({ c, cnt }) => (
              <tr key={c.id}><td>{c.pitch ? <span className={`pitch-${c.pitch}`}><span className="dot" /></span> : null} {c.name}</td><td>{cnt}</td>
                <td>{pctf(chanceToSee(size, cnt, intellect))}</td><td>{pctf(chanceToSee(size, cnt, intellect * 2))}</td><td>{pctf(chanceToSee(size, cnt, intellect * 3))}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="small muted">Assumes you see {intellect} new cards per turn (your intellect).</div>
    </div>
  );
}
