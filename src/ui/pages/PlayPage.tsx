import { useEffect, useMemo, useState } from 'react';
import { card } from '../../data/cardDb';
import type { DeckFormat } from '../../deck/deck';
import { botDeck } from '../../deck/botDecks';
import { FORMATS, FORMAT_RULES, autoBuildDeck, formatName, heroesFor, loadDecks, toDeckList, validateDeck } from '../../deck/deck';
import { createGame } from '../../engine/game';
import type { Difficulty, GameState } from '../../engine/types';
import GameBoard from '../components/GameBoard';
import { loadMatches, recordMatch } from '../../stats/matches';
import type { MatchStats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import { personalityOf } from '../../ai/bot';
import { DiceRoll, Loadout, poolHasChoices } from '../components/MatchFlow';
import type { DeckList } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
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
  /** sandbox: manual moves on, results not recorded */
  sandbox?: boolean;
  /** best of 1 or best of 3 (with sideboarding between games) */
  bestOf?: 1 | 3;
  /** chess clock: minutes per player (0 = off) */
  clock?: number;
  /** Ultimate Pit Fight: how many bot opponents (2 or 3) */
  pitBots?: 2 | 3;
}

interface Opponent { heroId: string; name: string; deck: DeckList }

/** The pool cards left out of the chosen loadout are the inventory (Taylor's equipment, The Librarian's Tomes). */
function withInventory(pool: DeckList, chosen?: DeckList): DeckList {
  if (!chosen) return pool;
  const left = [...pool.equipmentIds, ...pool.cardIds];
  for (const id of [...chosen.equipmentIds, ...chosen.cardIds]) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
  return { ...chosen, inventoryIds: left.filter((id) => { const c = card(id); return c.types.includes('Equipment') || c.name.includes('Tome'); }) };
}

/** Games from a draft/sealed table use the deck the server holds for you; this placeholder is replaced there. */
export const TABLE_DECK = { heroId: '', weaponIds: [], equipmentIds: [], cardIds: [] };

export default function PlayPage({ preselect, tutorial }: { preselect?: string; tutorial?: boolean }) {
  const hashParts = location.hash.slice(1).split('/');
  const hashDeck = preselect ?? hashParts[1];
  // #play/as/<heroId> plays that hero's starter deck; #play/vs/<heroId> picks the opponent
  const asHero = hashParts[1] === 'as' ? hashParts[2] : undefined;
  const vsHero = hashParts[1] === 'vs' ? hashParts[2] : undefined;
  const decks = loadDecks();
  const preDeck = decks.find((d) => d.id === hashDeck);
  const [setup, setSetup] = useState<Setup>({
    format: preDeck?.format ?? 'blitz',
    myDeckId: preDeck?.id ?? (asHero ? `auto:${asHero}` : ''),
    oppHeroId: vsHero ?? 'random',
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
  const [roomSandbox, setRoomSandbox] = useState(false);
  useEffect(() => { if (auth.user && auth.available && mode === 'online') myRating().then(setRating, () => setRating(null)); }, [auth.user, auth.available, mode, net.status]);
  // (re)connect when signed in, so an online game in progress resumes after a reload
  useEffect(() => { if (auth.user && auth.available) online.connect(); }, [auth.user, auth.available]);

  const heroes = useMemo(() => heroesFor(setup.format === 'casual' ? 'blitz' : setup.format), [setup.format]);
  const myDeck = decks.find((d) => d.id === setup.myDeckId);
  const myAutoHero = setup.myDeckId.startsWith('auto:') ? setup.myDeckId.slice(5) : null;

  // a match: your card pool and the opponent stay the same across games; between games you sideboard
  const [ctx, setCtx] = useState<{ pool: DeckList; opp: Opponent; more?: Opponent[] } | null>(null);
  const [match, setMatch] = useState<{ wins: [number, number]; lastLoser?: PlayerId } | null>(null);
  const [pre, setPre] = useState<{ step: 'loadout' | 'dice'; chosen?: DeckList; chooser?: PlayerId } | null>(null);
  const diceNames = useMemo(() => (ctx ? ['You', ctx.opp.name, ...(ctx.more ?? []).map((o) => o.name)] : []), [ctx]);
  const rules = FORMAT_RULES[setup.format === 'casual' ? 'blitz' : setup.format];
  const start = () => {
    const fmt = setup.format;
    const pool = myDeck ? toDeckList(myDeck) : myAutoHero ? botDeck(myAutoHero, fmt, Date.now() & 0xffff) : null;
    if (!pool) return;
    const oppHero = setup.oppHeroId === 'random' ? heroes[Math.floor(Math.random() * heroes.length)].id : setup.oppHeroId;
    const opp = { heroId: oppHero, name: `${card(oppHero).name.split(',')[0]} (bot)`, deck: botDeck(oppHero, fmt === 'casual' ? 'blitz' : fmt, Date.now() & 0xffff) };
    // Ultimate Pit Fight: more bots around the table, each a different random hero
    const more: Opponent[] = [];
    if (fmt === 'upf') {
      const used = new Set([oppHero, pool.heroId]);
      for (let i = 1; i < (setup.pitBots ?? 3); i++) {
        const left = heroes.filter((h) => !used.has(h.id));
        const h = (left.length ? left : heroes)[Math.floor(Math.random() * (left.length || heroes.length))].id;
        used.add(h);
        more.push({ heroId: h, name: `${card(h).name.split(',')[0]} (bot)`, deck: botDeck(h, fmt, (Date.now() + i * 977) & 0xffff) });
      }
    }
    setCtx({ pool, opp, more });
    setMatch(setup.bestOf === 3 && fmt !== 'upf' ? { wins: [0, 0] } : null);
    setPre({ step: poolHasChoices(pool, rules.minDeck) && !setup.tutorial ? 'loadout' : 'dice' });
  };
  const begin = (first: PlayerId) => {
    if (!ctx || !pre) return;
    setGame(createGame([
      { name: 'You', isBot: false, deck: withInventory(ctx.pool, pre.chosen) },
      { name: ctx.opp.name, isBot: true, difficulty: setup.difficulty, deck: ctx.opp.deck },
      ...(ctx.more ?? []).map((o) => ({ name: o.name, isBot: true, difficulty: setup.difficulty, deck: o.deck })),
    ], Date.now() & 0x7fffffff, setup.format, first));
    setPre(null);
  };
  const matchOver = match && (match.wins[0] >= 2 || match.wins[1] >= 2);
  const nextGame = () => {
    setGame(null);
    if (match && !matchOver) setPre({ step: 'loadout', chooser: match.lastLoser }); // sideboard, then the loser chooses
    else start();
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
    if (match) setMatch((m) => m && { wins: [m.wins[0] + (s.winner === 0 ? 1 : 0), m.wins[1] + (s.winner === 1 ? 1 : 0)], lastLoser: s.winner === 0 ? 1 : 0 });
  };

  const deckForOnline = () => {
    const fmt = setup.format;
    if (myDeck) return toDeckList(myDeck);
    if (myAutoHero) return toDeckList(autoBuildDeck(myAutoHero, fmt, 1));
    return null;
  };

  if (net.spectating && net.status !== 'playing') {
    const sp = net.spectating;
    return (
      <>
        <GameBoard key={`spec-${sp.names.join('-')}`} initial={sp.state} tutorial={false} onExit={() => online.unspectate()}
          online={{ state: sp.state, send: () => {}, opponent: null, error: null }} />
        <div className="replay-shield" />
        <div className="replay-bar"><span className="small"><b>👁 Watching {sp.names[0]}</b> vs {sp.names[1]} · you see {sp.watching}’s side</span><button className="small" onClick={() => online.unspectate()}>Stop watching</button></div>
      </>
    );
  }
  if (net.status === 'playing' && net.game) {
    const g = net.game;
    return (
      <GameBoard
        key={net.matchId ?? 'online'}
        initial={g}
        tutorial={false}
        cosmetics={loadProfile().cosmetics}
        online={{ state: g, send: online.act, opponent: net.opponent, error: net.error, emote: net.emote, sendEmote: online.emote, sandbox: net.sandbox }}
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

  if (pre && ctx) {
    return pre.step === 'loadout'
      ? <Loadout pool={ctx.pool} minDeck={rules.minDeck} maxDeck={rules.maxDeck} title={match && (match.wins[0] + match.wins[1] > 0) ? `Sideboarding · game ${match.wins[0] + match.wins[1] + 1}` : 'Your loadout'} onDone={(d) => setPre({ ...pre, chosen: d, step: 'dice' })} />
      : <DiceRoll names={diceNames} chooser={pre.chooser} onDone={begin} />;
  }
  if (game) {
    const practice = setup.sandbox || setup.difficulty === 'goldfish';
    const score = match && <div className="match-score">Best of 3 · You <b>{match.wins[0]}</b> – <b>{match.wins[1]}</b> {ctx?.opp.name}{matchOver ? (match.wins[0] >= 2 ? ' · 🏆 You win the match!' : ' · Match lost') : ''}</div>;
    return <GameBoard key={game.seed} initial={game} tutorial={setup.tutorial} sandbox={setup.sandbox} onExit={() => { setGame(null); setMatch(null); }}
      onRematch={nextGame} rematchLabel={match && !matchOver ? 'Next game' : match ? 'New match' : 'Rematch'} extraResult={score}
      onGameOver={practice ? undefined : onGameOver} cosmetics={loadProfile().cosmetics} clock={setup.clock || undefined} />;
  }

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
            {FORMATS.map(([f, label]) => (
              <button key={f} className={setup.format === f ? 'on' : ''} onClick={() => setSetup({ ...setup, format: f, myDeckId: '', oppHeroId: 'random' })}>{label}</button>
            ))}
          </div>
        </div>
        {!tutorial && (
          <div className="more-modes">
            <a href="#campaign">🗺 Campaigns</a>
            <a href="#tournament">🏅 Armory night</a>
            <a href="#cups">🏆 Friend cups</a>
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
                  ) : <div className="searching">{net.table && net.table.size > 2 ? 'Finding a Pit Fight table' : 'Searching for an opponent'}<span className="dots" /></div>}
                  {net.table && net.table.size > 2 && (
                    <>
                      <div className="pit-wait">{Array.from({ length: net.table.size }, (_, i) => <span key={i} className={net.table!.seats[i] ? 'in' : ''}>{net.table!.seats[i] ?? 'empty seat'}</span>)}</div>
                      <div className="small muted">{net.code ? 'The game starts when every seat is taken.' : 'Bots take the empty seats 30 seconds after a second player joins.'}</div>
                      {(net.table.host || !net.code) && <button className="primary" onClick={() => online.fillBots()}>Start now with bots in the empty seats</button>}
                    </>
                  )}
                  <button onClick={() => online.cancel()}>Cancel</button>
                </div>
              ) : (
                <>
                  {net.challenge && (
                    <div className="panel challenge-box">
                      <b>⚔ {net.challenge.from} challenges you</b> <span className="small muted">({/table/.test(net.challenge.format) ? net.challenge.format : formatName(net.challenge.format)})</span>
                      <div className="row" style={{ marginTop: '.4rem' }}>
                        {/table/.test(net.challenge.format)
                          ? <button className="primary" onClick={() => online.accept(TABLE_DECK)}>Accept with your table deck</button>
                          : <button className="primary" disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.accept(d); }}>Accept with this deck</button>}
                        <button onClick={() => online.decline()}>Decline</button>
                      </div>
                      {!selectedHero && !/table/.test(net.challenge.format) && <div className="small muted">Pick a deck on the left first.</div>}
                    </div>
                  )}
                  {rating && <div className="rank-line"><span className={`tier tier-${rating.tier.toLowerCase()}`}>{rating.tier}</span> <b>{rating.rating}</b> <span className="small muted">rating · {rating.games} ranked games</span></div>}
                  {setup.format === 'upf' ? (
                    <>
                      <div className="seg">{([2, 3] as const).map((n) => <button key={n} className={(setup.pitBots ?? 3) === n ? 'on' : ''} onClick={() => setSetup({ ...setup, pitBots: n })}>{n + 1} seats</button>)}</div>
                      <button className="play-big" disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.queue(d, setup.format); }}>Ranked Pit Fight table</button>
                      <button disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.host(d, setup.format, roomSandbox, setup.pitBots === 2 ? 3 : 4); }}>Create a Pit Fight room ({setup.pitBots === 2 ? 3 : 4} seats)</button>
                      <div className="small muted">The public table is ranked on its own Pit Fight ladder (your finishing place against the other players); rooms are unranked. Share the room code with up to {setup.pitBots === 2 ? 2 : 3} friends; the host can fill empty seats with bots.</div>
                    </>
                  ) : (
                    <>
                      <button className="play-big" disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.queue(d, setup.format); }}>Ranked match</button>
                      <button disabled={!selectedHero} onClick={() => { const d = deckForOnline(); if (d) online.host(d, setup.format, roomSandbox); }}>Create private room</button>
                    </>
                  )}
                  <label className="row small" title="Both players can move cards by hand, like a tabletop (for cards the simulator doesn't automate). Every move shows in the log."><input type="checkbox" checked={roomSandbox} onChange={(e) => setRoomSandbox(e.target.checked)} /> Allow manual moves in my room</label>
                  <div className="row">
                    <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={5} style={{ flex: 1, letterSpacing: '.2em', textTransform: 'uppercase' }} />
                    <button disabled={!selectedHero || joinCode.length < 5} onClick={() => { const d = deckForOnline(); if (d) online.join(joinCode, d); }}>Join</button>
                  </div>
                  <div className="small muted">Format: {formatName(setup.format)}. Every format except Casual needs a legal deck. Ranked matches move your rating; private rooms and friend challenges don’t.</div>
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
            <span>{setup.oppHeroId !== 'random' ? card(setup.oppHeroId).name : 'Random opponent'}{setup.oppHeroId !== 'random' && <span className={`tag persona ${personalityOf(card(setup.oppHeroId))}`} title="How this bot plays">{({ aggressive: '🔥 Aggressive', balanced: '⚖ Balanced', patient: '🛡 Patient' } as const)[personalityOf(card(setup.oppHeroId))]}</span>} <button className="small" onClick={(e) => { e.stopPropagation(); setPicking('opp'); }}>change</button></span>
          </div>
        </div>
        {setup.oppHeroId !== 'random' && <button className="small" onClick={() => setSetup({ ...setup, oppHeroId: 'random' })}>🎲 Random opponent</button>}
        <div className="lobby-label">Difficulty</div>
        <div className="seg">
          {(['easy', 'normal', 'hard', 'mythic', 'goldfish'] as Difficulty[]).map((d) => (
            <button key={d} className={setup.difficulty === d ? 'on' : ''} title={d === 'goldfish' ? 'A practice dummy that never plays or blocks' : d === 'mythic' ? 'Plays out many possible futures before each big decision. Takes about a second to think.' : undefined} onClick={() => setSetup({ ...setup, difficulty: d })}>{d === 'goldfish' ? '🐟 Goldfish' : d === 'mythic' ? '🔮 Mythic' : d[0].toUpperCase() + d.slice(1)}</button>
          ))}
        </div>
        {setup.format === 'upf' && (
          <div className="row small">
            <span className="lobby-label">Table</span>
            <div className="seg">{([2, 3] as const).map((n) => <button key={n} className={(setup.pitBots ?? 3) === n ? 'on' : ''} onClick={() => setSetup({ ...setup, pitBots: n })}>{n + 1} heroes</button>)}</div>
            <span className="muted">Offline vs bots. You can attack the heroes on your left and right; last one standing wins.</span>
          </div>
        )}
        <div className="row small">
          <span className="lobby-label">Match</span>
          <div className="seg">{([1, 3] as const).map((b) => <button key={b} className={(setup.bestOf ?? 1) === b ? 'on' : ''} onClick={() => setSetup({ ...setup, bestOf: b })}>{b === 1 ? 'Single game' : 'Best of 3'}</button>)}</div>
        </div>
        <div className="row small">
          <span className="lobby-label">Clock</span>
          <div className="seg">{[0, 10, 20].map((m) => <button key={m} className={(setup.clock ?? 0) === m ? 'on' : ''} onClick={() => setSetup({ ...setup, clock: m })}>{m ? `${m} min` : 'Off'}</button>)}</div>
        </div>
        <label className="row small" title="Tap any card to move it anywhere: play cards the simulator doesn't automate, test lines, set up positions. Sandbox games aren't recorded.">
          <input type="checkbox" checked={!!setup.sandbox} onChange={(e) => setSetup({ ...setup, sandbox: e.target.checked })} /> 🛠 Sandbox (manual moves, not recorded)
        </label>
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
          {f.status === 'in-game'
            ? <button className="small" title="Watch their game" onClick={() => online.spectate(f.username)}>👁 Watch</button>
            : <button className="small" disabled={!canChallenge || f.status !== 'online'} title={f.status === 'online' ? 'Challenge with your selected deck' : 'Offline'} onClick={() => onChallenge(f.username)}>⚔ Challenge</button>}
        </div>
      ))}
    </div>
  );
}
