import { useEffect, useMemo, useState } from 'react';
import { card } from '../../data/cardDb';
import type { DeckFormat } from '../../deck/deck';
import { autoBuildDeck, heroesFor, loadDecks, toDeckList, validateDeck } from '../../deck/deck';
import { createGame } from '../../engine/game';
import type { Difficulty, GameState } from '../../engine/types';
import GameBoard from '../components/GameBoard';
import { loadMatches, recordMatch } from '../../stats/matches';
import type { MatchStats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import { friends as friendsApi, myRating } from '../auth';
import type { FriendRow, MyRating } from '../auth';
import { saveLocalReplay } from '../../stats/replays';
import type { LocalReplay } from '../../stats/replays';
import { sfx } from '../sound';
import { archetypeFor } from '../../deck/archetypes';
import { getHeroAbility } from '../../engine/heroes';
import type { Card } from '../../data/types';
import { HeroPicker } from './DecksPage';
import CardView from '../components/CardView';
import { online, useOnline } from '../../online/client';
import { useAuth } from '../auth';

interface Setup {
  format: DeckFormat;
  myDeckId: string; // saved deck id or 'auto:<heroId>'
  oppHeroId: string; // hero id or 'random'
  difficulty: Difficulty;
  tutorial: boolean;
}

export default function PlayPage({ preselect, tutorial }: { preselect?: string; tutorial?: boolean }) {
  const hashDeck = preselect ?? location.hash.split('/')[1];
  const decks = loadDecks();
  const pre = decks.find((d) => d.id === hashDeck);
  const [setup, setSetup] = useState<Setup>({
    format: pre?.format ?? 'blitz',
    myDeckId: pre?.id ?? '',
    oppHeroId: 'random',
    difficulty: tutorial ? 'easy' : 'normal',
    tutorial: !!tutorial,
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [picking, setPicking] = useState<'me' | 'opp' | null>(null);
  const [heroQ, setHeroQ] = useState('');
  const [mode, setMode] = useState<'ai' | 'online'>(location.hash.includes('online') ? 'online' : 'ai');
  const [joinCode, setJoinCode] = useState('');
  const net = useOnline();
  const auth = useAuth();
  const [rating, setRating] = useState<MyRating | null>(null);
  useEffect(() => { if (auth.user && auth.available && mode === 'online') myRating().then(setRating, () => setRating(null)); }, [auth.user, auth.available, mode, net.status]);
  // (re)connect when signed in, so an online game in progress resumes after a reload
  useEffect(() => { if (auth.user && auth.available) online.connect(); }, [auth.user, auth.available]);

  const heroes = useMemo(() => heroesFor(setup.format === 'casual' ? 'blitz' : setup.format), [setup.format]);
  const myDeck = decks.find((d) => d.id === setup.myDeckId);
  const myAutoHero = setup.myDeckId.startsWith('auto:') ? setup.myDeckId.slice(5) : null;

  const start = () => {
    const fmt = setup.format;
    const mine = myDeck ? toDeckList(myDeck) : myAutoHero ? toDeckList(autoBuildDeck(myAutoHero, fmt, Date.now() & 0xffff)) : null;
    if (!mine) return;
    const oppHero = setup.oppHeroId === 'random' ? heroes[Math.floor(Math.random() * heroes.length)].id : setup.oppHeroId;
    const oppDeck = toDeckList(autoBuildDeck(oppHero, fmt === 'casual' ? 'blitz' : fmt, Date.now() & 0xffff));
    setGame(createGame([
      { name: 'You', isBot: false, deck: mine },
      { name: `${card(oppHero).name.split(',')[0]} (bot)`, isBot: true, difficulty: setup.difficulty, deck: oppDeck },
    ], Date.now() & 0x7fffffff, fmt));
  };

  const onGameOver = (s: GameState, stats: MatchStats, replay?: LocalReplay) => {
    const [me, them] = s.players;
    const id = Math.random().toString(36).slice(2, 10);
    if (replay) saveLocalReplay(id, replay);
    recordMatch({
      id,
      format: s.format, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: myDeck?.id ?? null,
      deckName: myDeck?.name ?? `${card(me.hero.cardId).name} (auto)`, difficulty: setup.difficulty,
      won: s.winner === 0, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life, stats,
    });
  };

  const deckForOnline = () => {
    const fmt = setup.format;
    if (myDeck) return toDeckList(myDeck);
    if (myAutoHero) return toDeckList(autoBuildDeck(myAutoHero, fmt, 1));
    return null;
  };

  if (net.status === 'playing' && net.game) {
    const g = net.game;
    return (
      <GameBoard
        key={net.matchId ?? 'online'}
        initial={g}
        tutorial={false}
        cosmetics={loadProfile().cosmetics}
        online={{ state: g, send: online.act, opponent: net.opponent, error: net.error, emote: net.emote, sendEmote: online.emote }}
        extraResult={net.rated ? <div className="rated-result">{net.matchId?.startsWith('online-') ? 'Ranked' : ''} rating {net.rated.before} → <b className={net.rated.after >= net.rated.before ? 'ok' : 'err'}>{net.rated.after}</b> ({net.rated.after >= net.rated.before ? '+' : ''}{net.rated.after - net.rated.before})</div> : undefined}
        onExit={() => { if (g.phase === 'gameOver') online.done(); else online.leave(); }}
        onGameOver={(s, stats) => {
          const [me, them] = s.players;
          recordMatch({
            id: net.matchId ?? undefined, format: s.format, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: myDeck?.id ?? null,
            deckName: myDeck?.name ?? 'Online deck', difficulty: 'online', won: s.winner === 0, turns: s.turn,
            lifeLeft: me.life, oppLifeLeft: them.life, mode: 'online', opponentName: net.opponent?.name, stats,
          });
        }}
      />
    );
  }

  if (game) return <GameBoard key={game.seed} initial={game} tutorial={setup.tutorial} onExit={() => setGame(null)} onRematch={start} onGameOver={onGameOver} cosmetics={loadProfile().cosmetics} />;

  const deckErrs = myDeck ? validateDeck(myDeck).filter((e) => !e.startsWith('No weapon')) : [];
  const formatDecks = decks.filter((d) => d.format === setup.format || setup.format === 'casual');
  const starterHeroes = heroes.filter((h) => h.name.toLowerCase().includes(heroQ.toLowerCase()));
  const selectedHero = myDeck ? card(myDeck.heroId) : myAutoHero ? card(myAutoHero) : null;
  const record = loadMatches();
  const wins = record.filter((m) => m.won).length;
  return (
    <div className="lobby">
      <div className="lobby-main">
        <div className="lobby-head">
          <h1>{tutorial ? 'Guided practice' : 'Play'}</h1>
          <div className="seg">
            {([['blitz', 'Blitz'], ['cc', 'Classic Constructed'], ['casual', 'Casual']] as [DeckFormat, string][]).map(([f, label]) => (
              <button key={f} className={setup.format === f ? 'on' : ''} onClick={() => setSetup({ ...setup, format: f, myDeckId: '', oppHeroId: 'random' })}>{label}</button>
            ))}
          </div>
        </div>
        {!tutorial && (
          <div className="more-modes">
            <a href="#gauntlet">🏟 Gauntlet</a>
            <a href="#limited">📦 Sealed &amp; Draft</a>
            <a href="#puzzles">🧩 Lethal puzzles</a>
          </div>
        )}
        {tutorial && (
          <div className="panel small">
            A relaxed game against an <b>easy</b> bot with hints on. Each time it’s your move, a suggestion explains the best play. You can undo any move.
          </div>
        )}
        <h3 className="lobby-sub">Your decks</h3>
        <div className="deckbox-grid">
          {formatDecks.map((d) => (
            <DeckBox key={d.id} hero={card(d.heroId)} title={d.name} sub={validateDeck(d).filter((e) => !e.startsWith('No weapon')).length ? 'Casual only' : 'Legal'}
              selected={setup.myDeckId === d.id} onClick={() => setSetup({ ...setup, myDeckId: d.id })} />
          ))}
          <a className="deckbox deckbox-new" href="#decks"><span>＋</span>Build a deck</a>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 className="lobby-sub">Starter decks</h3>
          <input type="search" placeholder="Find a hero…" value={heroQ} onChange={(e) => setHeroQ(e.target.value)} style={{ maxWidth: 220 }} />
        </div>
        <div className="deckbox-grid">
          {starterHeroes.map((h) => (
            <DeckBox key={h.id} hero={h} title={h.name} sub={`Starter · ${archetypeFor(h).label}${getHeroAbility(h) ? '' : ' · ability manual'}`} selected={myAutoHero === h.id} onClick={() => setSetup({ ...setup, myDeckId: `auto:${h.id}` })} />
          ))}
        </div>
      </div>

      <aside className="lobby-side">
        <div className="seg" style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
          <button className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>🤖 vs AI</button>
          <button className={mode === 'online' ? 'on' : ''} onClick={() => setMode('online')}>🌐 Online</button>
        </div>
        {mode === 'online' ? (
          <div className="col" style={{ gap: '.7rem' }}>
            <div className="matchup-hero" style={{ maxWidth: 160, alignSelf: 'center' }}>
              {selectedHero ? <CardView card={selectedHero} width="100%" /> : <div className="matchup-empty">Choose a deck</div>}
              <span>{selectedHero ? (myDeck?.name ?? `${selectedHero.name} starter`) : 'Pick a deck on the left'}</span>
            </div>
            {auth.available === false && <div className="small err">No game server reachable. Online play needs the FaB Trainer server (see Account → Server settings).</div>}
            {auth.available && !auth.user && <div className="small">Online play needs an account. <a href="#account">Sign in or create one</a>, it’s free.</div>}
            {auth.available && auth.user && (
              net.status === 'waiting' ? (
                <div className="panel col" style={{ gap: '.5rem', textAlign: 'center' }}>
                  {net.code ? (
                    <>
                      <div className="small muted">Share this code with your friend:</div>
                      <div className="room-code">{net.code}</div>
                      <button className="small" onClick={() => navigator.clipboard?.writeText(net.code!)}>Copy code</button>
                    </>
                  ) : <div className="searching">Searching for an opponent<span className="dots" /></div>}
                  <button onClick={() => online.cancel()}>Cancel</button>
                </div>
              ) : (
                <>
                  {net.challenge && (
                    <div className="panel challenge-box">
                      <b>⚔ {net.challenge.from} challenges you</b> <span className="small muted">({net.challenge.format === 'cc' ? 'Classic Constructed' : net.challenge.format})</span>
                      <div className="row" style={{ marginTop: '.4rem' }}>
                        <button className="primary" disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.accept(d); }}>Accept with this deck</button>
                        <button onClick={() => online.decline()}>Decline</button>
                      </div>
                      {!selectedHero && <div className="small muted">Pick a deck on the left first.</div>}
                    </div>
                  )}
                  {rating && <div className="rank-line"><span className={`tier tier-${rating.tier.toLowerCase()}`}>{rating.tier}</span> <b>{rating.rating}</b> <span className="small muted">rating · {rating.games} ranked games</span></div>}
                  <button className="play-big" disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.queue(d, setup.format); }}>Ranked match</button>
                  <button disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.host(d, setup.format); }}>Create private room</button>
                  <div className="row">
                    <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={5} style={{ flex: 1, letterSpacing: '.2em', textTransform: 'uppercase' }} />
                    <button disabled={!selectedHero || joinCode.length < 5} onClick={() => { const d = deckForOnline(); if (d) online.join(joinCode, d); }}>Join</button>
                  </div>
                  <div className="small muted">Format: {setup.format === 'cc' ? 'Classic Constructed' : setup.format === 'blitz' ? 'Blitz' : 'Casual'}. Blitz and CC need a legal deck. Ranked matches move your rating; private rooms and friend challenges don’t.</div>
                  <FriendsPanel canChallenge={!!selectedHero} onChallenge={(u) => { const d = deckForOnline(); if (d) online.challenge(u, d, setup.format); }} />
                </>
              )
            )}
            {net.error && <div className="small err">{net.error} <button className="small" onClick={() => online.clearError()}>✕</button></div>}
            {net.notice && <div className="small">{net.notice} <button className="small" onClick={() => online.clearError()}>✕</button></div>}
          </div>
        ) : (<>
        <div className="lobby-matchup">
          <div className="matchup-hero">
            {selectedHero ? <CardView card={selectedHero} width="100%" /> : <div className="matchup-empty">Choose a deck</div>}
            <span>{selectedHero ? (myDeck?.name ?? `${selectedHero.name} starter`) : 'You'}</span>
          </div>
          <div className="vs">VS</div>
          <div className="matchup-hero" onClick={() => setPicking('opp')} style={{ cursor: 'pointer' }} title="Choose opponent">
            {setup.oppHeroId !== 'random' ? <CardView card={card(setup.oppHeroId)} width="100%" /> : <div className="matchup-empty">?<small>Random hero</small></div>}
            <span>{setup.oppHeroId !== 'random' ? card(setup.oppHeroId).name : 'Random opponent'} <button className="small" onClick={(e) => { e.stopPropagation(); setPicking('opp'); }}>change</button></span>
          </div>
        </div>
        {setup.oppHeroId !== 'random' && <button className="small" onClick={() => setSetup({ ...setup, oppHeroId: 'random' })}>🎲 Random opponent</button>}
        <div className="lobby-label">Difficulty</div>
        <div className="seg">
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
            <button key={d} className={setup.difficulty === d ? 'on' : ''} onClick={() => setSetup({ ...setup, difficulty: d })}>{d[0].toUpperCase() + d.slice(1)}</button>
          ))}
        </div>
        <label className="row small">
          <input type="checkbox" checked={setup.tutorial} onChange={(e) => setSetup({ ...setup, tutorial: e.target.checked })} /> Show move suggestions
        </label>
        {deckErrs.length > 0 && <div className="small" style={{ color: 'var(--yellow)' }}>This deck isn’t tournament-legal ({deckErrs[0]}). You can still play it.</div>}
        {record.length > 0 && <div className="small muted">Record vs AI: <b className="ok">{wins}W</b> – <b className="err">{record.length - wins}L</b></div>}
        <button className="play-big" disabled={!myDeck && !myAutoHero} onClick={start}>Play</button>
        </>)}
      </aside>

      {picking && (
        <div className="modal-bg" onClick={() => setPicking(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close small" onClick={() => setPicking(null)}>✕</button>
            <h2>{picking === 'me' ? 'Pick your hero (deck is auto-built)' : 'Pick the opponent hero'}</h2>
            <HeroPicker format={setup.format === 'casual' ? 'blitz' : setup.format} onPick={(h) => {
              setSetup(picking === 'me' ? { ...setup, myDeckId: `auto:${h.id}` } : { ...setup, oppHeroId: h.id });
              setPicking(null);
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function DeckBox({ hero, title, sub, selected, onClick }: { hero: Card; title: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button className={`deckbox ${selected ? 'sel' : ''}`} onClick={() => { sfx('click'); onClick(); }}>
      <div className="deckbox-art" style={{ backgroundImage: hero.image ? `url(${hero.image})` : undefined }} />
      <div className="deckbox-label">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
    </button>
  );
}

/** Friends with online status; challenge one to a game with your selected deck. */
function FriendsPanel({ canChallenge, onChallenge }: { canChallenge: boolean; onChallenge: (username: string) => void }) {
  const [list, setList] = useState<FriendRow[] | null>(null);
  useEffect(() => {
    let off = false;
    const load = () => friendsApi.list().then((l) => { if (!off) setList(l); }, () => {});
    load();
    const t = setInterval(load, 15000);
    return () => { off = true; clearInterval(t); };
  }, []);
  if (!list) return null;
  return (
    <div className="friends-panel">
      <div className="lobby-label">Friends</div>
      {list.length === 0 && <div className="small muted">No friends yet. Add them by username on your <a href="#profile">Profile</a>.</div>}
      {list.map((f) => (
        <div key={f.username} className="friend-row">
          <span className={`presence ${f.status}`} title={f.status} />
          <span className="grow">{f.name}</span>
          <button className="small" disabled={!canChallenge || f.status !== 'online'} title={f.status === 'online' ? 'Challenge with your selected deck' : f.status === 'in-game' ? 'In a game' : 'Offline'} onClick={() => onChallenge(f.username)}>⚔ Challenge</button>
        </div>
      ))}
    </div>
  );
}
