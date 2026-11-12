import { useEffect, useState } from 'react';
import { loadCardDb } from './data/cardDb';
import type { CardDb } from './data/cardDb';
import HomePage from './ui/pages/HomePage';
import CardsPage from './ui/pages/CardsPage';
import DecksPage from './ui/pages/DecksPage';
import PlayPage from './ui/pages/PlayPage';
import LearnPage from './ui/pages/LearnPage';
import { animationsEnabled, setAnimations } from './ui/components/Fx';
import { canLeave } from './ui/navGuard';
import { HoverCardLayer } from './ui/components/HoverCard';

const ROUTES = [
  ['', 'Home'],
  ['learn', 'Learn'],
  ['play', 'Play'],
  ['decks', 'Decks'],
  ['cards', 'Card Database'],
] as const;

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const on = (e: HashChangeEvent) => {
      if (!canLeave()) {
        history.replaceState(null, '', e.oldURL); // stay on the page
        return;
      }
      setHash(window.location.hash.slice(1));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const [db, setDb] = useState<CardDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hash = useHash();
  const [route, ...rest] = hash.split('/');
  const [anim, setAnim] = useState(animationsEnabled);
  useEffect(() => {
    loadCardDb().then(setDb, (e) => setError(String(e)));
  }, []);
  useEffect(() => setAnimations(anim), [anim]);

  return (
    <>
      <header className="topbar">
        <a href="#" className="brand" style={{ textDecoration: 'none' }}>⚔ FaB Trainer</a>
        <nav className="nav">
          {ROUTES.map(([r, label]) => (
            <a key={r} href={`#${r}`} className={route === r ? 'active' : ''}>{label}</a>
          ))}
        </nav>
        <div className="grow" />
        <button className="small" title="Toggle animations" onClick={() => setAnim(!anim)}>{anim ? '✨' : '◻'}<span className="anim-label"> Animations {anim ? 'on' : 'off'}</span></button>
      </header>
      <main className="page">
        {error && <p className="err">Couldn’t load the card database: {error}</p>}
        {!db && !error && <p className="muted">Loading the card database…</p>}
        {db && (
          <div key={route} className="page-anim">
            {route === '' && <HomePage db={db} />}
            {route === 'learn' && <LearnPage lesson={rest[0]} />}
            {route === 'play' && <PlayPage />}
            {route === 'decks' && <DecksPage deckId={rest[0]} />}
            {route === 'cards' && <CardsPage />}
          </div>
        )}
      </main>
      <HoverCardLayer />
    </>
  );
}
