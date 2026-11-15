import { lazy, Suspense, useEffect, useState } from 'react';
import { loadCardDb } from './data/cardDb';
import type { CardDb } from './data/cardDb';
import HomePage from './ui/pages/HomePage';
import { TABLE_DECK } from './online/tableDeck';
import { animationsEnabled, setAnimations } from './ui/components/Fx';
import { musicEnabled, setBaseMood, setMusicEnabled, startMusic } from './ui/music';
import { canLeave } from './ui/navGuard';
import { HoverCardLayer } from './ui/components/HoverCard';
import { Avatar } from './ui/components/Avatar';
import { checkServer, useAuth } from './ui/auth';
import { loadProfile } from './stats/profile';
import { loadMatches } from './stats/matches';
import { online, useOnline } from './online/client';
import { computeProgress } from './stats/progress';

const PAGE_LOADERS = {
  CardsPage: () => import('./ui/pages/CardsPage'),
  DecksPage: () => import('./ui/pages/DecksPage'),
  LearnPage: () => import('./ui/pages/LearnPage'),
  AccountPage: () => import('./ui/pages/AccountPage'),
  PuzzlesPage: () => import('./ui/pages/PuzzlesPage'),
  GauntletPage: () => import('./ui/pages/GauntletPage'),
  LimitedPage: () => import('./ui/pages/LimitedPage'),
  TournamentPage: () => import('./ui/pages/TournamentPage'),
  ToolsPage: () => import('./ui/pages/ToolsPage'),
  CupsPage: () => import('./ui/pages/CupsPage'),
  ReplayPage: () => import('./ui/pages/ReplayPage'),
  PrivacyPage: () => import('./ui/pages/PrivacyPage'),
  GuidesPage: () => import('./ui/pages/GuidesPage'),
  DrillsPage: () => import('./ui/pages/DrillsPage'),
  CampaignPage: () => import('./ui/pages/CampaignPage'),
  PlayPage: () => import('./ui/pages/PlayPage'),
  ProfilePage: () => import('./ui/pages/ProfilePage'),
};
/** once the app is up, fetch the other pages in the background so they're ready (and cached for offline use) */
function preloadPages() {
  const go = () => { for (const load of Object.values(PAGE_LOADERS)) void load().catch(() => {}); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(go); else setTimeout(go, 2000);
}
// pages load when they're first opened (a smaller first download)
const CardsPage = lazy(PAGE_LOADERS.CardsPage);
const DecksPage = lazy(PAGE_LOADERS.DecksPage);
const LearnPage = lazy(PAGE_LOADERS.LearnPage);
const AccountPage = lazy(PAGE_LOADERS.AccountPage);
const PuzzlesPage = lazy(PAGE_LOADERS.PuzzlesPage);
const GauntletPage = lazy(PAGE_LOADERS.GauntletPage);
const LimitedPage = lazy(PAGE_LOADERS.LimitedPage);
const TournamentPage = lazy(PAGE_LOADERS.TournamentPage);
const ToolsPage = lazy(PAGE_LOADERS.ToolsPage);
const CupsPage = lazy(PAGE_LOADERS.CupsPage);
const ReplayPage = lazy(PAGE_LOADERS.ReplayPage);
const PrivacyPage = lazy(PAGE_LOADERS.PrivacyPage);
const GuidesPage = lazy(PAGE_LOADERS.GuidesPage);
const DrillsPage = lazy(PAGE_LOADERS.DrillsPage);
const CampaignPage = lazy(PAGE_LOADERS.CampaignPage);
const PlayPage = lazy(PAGE_LOADERS.PlayPage);
const ProfilePage = lazy(PAGE_LOADERS.ProfilePage);

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
    loadCardDb().then((d) => { setDb(d); preloadPages(); }, (e) => setError(String(e)));
  }, []);
  useEffect(() => setAnimations(anim), [anim]);
  const [music, setMusic] = useState(musicEnabled);
  // browsers only start audio after a tap: begin the soundtrack on the first one if it's turned on
  useEffect(() => {
    const go = () => { startMusic(); window.removeEventListener('pointerdown', go); };
    window.addEventListener('pointerdown', go);
    return () => window.removeEventListener('pointerdown', go);
  }, []);
  useEffect(() => { void checkServer(); }, []);
  // each part of the app has its own theme (games switch to the battle theme themselves)
  useEffect(() => {
    const r = route || 'home';
    setBaseMood(['decks', 'cards', 'learn', 'profile', 'tools', 'guides', 'drills', 'account', 'privacy', 'replay', 'puzzles'].includes(r) ? 'explore'
      : ['campaign', 'gauntlet', 'tournament', 'cups', 'limited'].includes(r) ? 'campaign' : 'menu');
  }, [route]);
  const auth = useAuth();
  // stay connected while signed in, so friends see you online and challenges reach you on any page
  const net = useOnline();
  useEffect(() => { if (auth.user && auth.available) online.connect(); }, [auth.user, auth.available]);
  const [profile, setProfile] = useState(loadProfile);
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!db) return;
    const on = () => setLevel(computeProgress(loadMatches()).level);
    on();
    for (const e of ['fab-match', 'fab-synced', 'fab-feats']) window.addEventListener(e, on);
    return () => { for (const e of ['fab-match', 'fab-synced', 'fab-feats']) window.removeEventListener(e, on); };
  }, [db]);
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
            <Avatar heroId={profile.avatarHeroId} size={28} frame={profile.cosmetics?.frame} />
            {level !== null && <span className="lvl-badge" title={`Level ${level}`}>{level}</span>}
            <span className="anim-label">{auth.user ? profile.displayName : auth.available ? 'Sign in' : profile.displayName}</span>
          </a>
        )}
        <button className="small" title="Music" onClick={() => { setMusicEnabled(!music); setMusic(!music); }}>{music ? '🎵' : '🔈'}<span className="anim-label"> Music {music ? 'on' : 'off'}</span></button>
        <button className="small" title="Toggle animations" onClick={() => setAnim(!anim)}>{anim ? '✨' : '◻'}<span className="anim-label"> Animations {anim ? 'on' : 'off'}</span></button>
      </header>
      <main className="page">
        {error && <p className="err">Couldn’t load the card database: {error}</p>}
        {!db && !error && <p className="muted">Loading the card database…</p>}
        {db && (
          <div key={route} className="page-anim">
            <Suspense fallback={<p className="muted">Loading…</p>}>
            {route === '' && <HomePage db={db} />}
            {route === 'learn' && <LearnPage lesson={rest[0]} />}
            {route === 'play' && <PlayPage />}
            {route === 'decks' && <DecksPage deckId={rest[0]} />}
            {route === 'cards' && <CardsPage />}
            {route === 'profile' && <ProfilePage />}
            {route === 'account' && <AccountPage />}
            {route === 'puzzles' && <PuzzlesPage id={rest[0]} />}
            {route === 'gauntlet' && <GauntletPage />}
            {route === 'limited' && <LimitedPage />}
            {route === 'tournament' && <TournamentPage />}
            {route === 'tools' && <ToolsPage tool={rest[0]} />}
            {route === 'cups' && <CupsPage />}
            {route === 'replay' && <ReplayPage id={rest[0]} />}
            {route === 'privacy' && <PrivacyPage />}
            {route === 'guides' && <GuidesPage heroId={rest[0]} />}
            {route === 'drills' && <DrillsPage />}
            {route === 'campaign' && <CampaignPage id={rest[0]} />}
            </Suspense>
          </div>
        )}
      </main>
      {net.challenge && route !== 'play' && (
        <div className="challenge-toast" role="alert">
          <b>⚔ {net.challenge.from}</b> challenges you!
          {/table/.test(net.challenge.format)
            ? <a className="btn-link" href="#play/online" onClick={() => online.accept(TABLE_DECK)}>Accept</a>
            : <a className="btn-link" href="#play/online">Open</a>}
          <button className="small" onClick={() => online.decline()}>Decline</button>
        </div>
      )}
      <HoverCardLayer />
    </>
  );
}
