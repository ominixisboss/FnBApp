import { useMemo, useState } from 'react';
import { card } from '../../data/cardDb';
import type { DeckFormat } from '../../deck/deck';
import { autoBuildDeck, heroesFor, loadDecks, toDeckList, validateDeck } from '../../deck/deck';
import { createGame } from '../../engine/game';
import type { Difficulty, GameState } from '../../engine/types';
import GameBoard from '../components/GameBoard';
import { recordMatch } from '../../stats/matches';
import { HeroPicker } from './DecksPage';
import CardView from '../components/CardView';

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

  const onGameOver = (s: GameState) => {
    const [me, them] = s.players;
    recordMatch({
      format: s.format, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: myDeck?.id ?? null,
      deckName: myDeck?.name ?? `${card(me.hero.cardId).name} (auto)`, difficulty: setup.difficulty,
      won: s.winner === 0, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life,
    });
  };

  if (game) return <GameBoard key={game.seed} initial={game} tutorial={setup.tutorial} onExit={() => setGame(null)} onRematch={start} onGameOver={onGameOver} />;

  const deckErrs = myDeck ? validateDeck(myDeck).filter((e) => !e.startsWith('No weapon')) : [];
  const formatDecks = decks.filter((d) => d.format === setup.format || setup.format === 'casual');
  return (
    <div className="col" style={{ maxWidth: 900 }}>
      <h1>{tutorial ? 'Guided practice' : 'Play vs AI'}</h1>
      {tutorial && (
        <div className="panel small">
          A relaxed game against an <b>easy</b> bot with hints switched on. Each time it’s your move, a suggestion appears with the reasoning behind it.
          You can undo any move. Read the lessons first if you haven’t: <a href="#learn">Learn</a>.
        </div>
      )}
      <div className="panel col">
        <div className="row">
          <b style={{ width: 120 }}>Format</b>
          <select value={setup.format} onChange={(e) => setSetup({ ...setup, format: e.target.value as DeckFormat, myDeckId: '', oppHeroId: 'random' })}>
            <option value="blitz">Blitz (young heroes, ~20 life, fast games)</option>
            <option value="cc">Classic Constructed (adult heroes, 40 life)</option>
            <option value="casual">Casual (any deck)</option>
          </select>
        </div>
        <div className="row">
          <b style={{ width: 120 }}>Your deck</b>
          <select value={myDeck ? setup.myDeckId : myAutoHero ? 'auto' : ''} onChange={(e) => {
            const v = e.target.value;
            if (v === 'auto') setPicking('me');
            else setSetup({ ...setup, myDeckId: v });
          }}>
            <option value="">— choose —</option>
            {formatDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="auto">Auto-built deck for a hero…</option>
          </select>
          {myAutoHero && <span>{card(myAutoHero).name} (auto-built) <button className="small" onClick={() => setPicking('me')}>change</button></span>}
          <a href="#decks" className="small">Manage decks</a>
        </div>
        {deckErrs.length > 0 && <div className="small" style={{ color: 'var(--yellow)' }}>Note: this deck isn’t tournament-legal ({deckErrs[0]}). You can still play with it.</div>}
        <div className="row">
          <b style={{ width: 120 }}>Opponent</b>
          <select value={setup.oppHeroId === 'random' ? 'random' : 'pick'} onChange={(e) => (e.target.value === 'random' ? setSetup({ ...setup, oppHeroId: 'random' }) : setPicking('opp'))}>
            <option value="random">Random hero</option>
            <option value="pick">Choose hero…</option>
          </select>
          {setup.oppHeroId !== 'random' && <span>{card(setup.oppHeroId).name} <button className="small" onClick={() => setPicking('opp')}>change</button></span>}
        </div>
        <div className="row">
          <b style={{ width: 120 }}>Bot difficulty</b>
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
            <label key={d} className="row" style={{ gap: '.25rem' }}>
              <input type="radio" checked={setup.difficulty === d} onChange={() => setSetup({ ...setup, difficulty: d })} /> {d}
            </label>
          ))}
        </div>
        <label className="row">
          <input type="checkbox" checked={setup.tutorial} onChange={(e) => setSetup({ ...setup, tutorial: e.target.checked })} /> Show move suggestions (hints)
        </label>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {myDeck && <CardView card={card(myDeck.heroId)} width={80} />}
            {myAutoHero && <CardView card={card(myAutoHero)} width={80} />}
            {(myDeck || myAutoHero) && <b>vs</b>}
            {setup.oppHeroId !== 'random' && <CardView card={card(setup.oppHeroId)} width={80} />}
          </div>
          <button className="primary" disabled={!myDeck && !myAutoHero} onClick={start} style={{ fontSize: '1.1rem' }}>Start game ▶</button>
        </div>
      </div>
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
