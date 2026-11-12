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
import ProfilePage, { Avatar } from './ui/pages/ProfilePage';
import AccountPage from './ui/pages/AccountPage';
import { checkServer, useAuth } from './ui/auth';
import { loadProfile } from './stats/profile';

// [route, label, short label (phones), icon]
const ROUTES = [
  ['', 'Home', 'Home', '🏠'],
  ['learn', 'Learn', 'Learn', '📖'],
  ['play', 'Play', 'Play', '⚔'],
  ['decks', 'Decks', 'Decks', '🃏'],
  ['cards', 'Card Database', 'Cards', '🔎'],
  ['profile', 'Profile', 'Profile', '👤'],
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
  useEffect(() => { void checkServer(); }, []);
  const auth = useAuth();
  const [profile, setProfile] = useState(loadProfile);
  useEffect(() => {
    const on = () => setProfile(loadProfile());
    window.addEventListener('fab-profile', on);
    window.addEventListener('fab-synced', on);
    return () => { window.removeEventListener('fab-profile', on); window.removeEventListener('fab-synced', on); };
  }, []);

  return (
    <>
      <header className="topbar">
        <a href="#" className="brand" style={{ textDecoration: 'none' }}>⚔<span className="brand-name"> FaB Trainer</span></a>
        <nav className="nav">
          {ROUTES.map(([r, label, short, icon]) => (
            <a key={r} href={`#${r}`} className={route === r ? 'active' : ''} aria-label={label}>
              <span className="nav-ic" aria-hidden>{icon}</span>
              <span className="nav-lb">{label}</span>
              <span className="nav-lb-short" aria-hidden>{short}</span>
            </a>
          ))}
        </nav>
        <div className="grow" />
        {db && (
          <a href={auth.user ? '#profile' : '#account'} className="me-chip" title={auth.user ? `Signed in as ${auth.user.username}` : 'Sign in to sync and play online'}>
            <Avatar heroId={profile.avatarHeroId} size={28} />
            <span className="anim-label">{auth.user ? profile.displayName : auth.available ? 'Sign in' : profile.displayName}</span>
          </a>
        )}
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
            {route === 'profile' && <ProfilePage />}
            {route === 'account' && <AccountPage />}
          </div>
        )}
      </main>
      <HoverCardLayer />
    </>
  );
}
