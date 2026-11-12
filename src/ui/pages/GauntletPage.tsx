// Gauntlet: beat 8 bot heroes in a row, from Easy to Hard. One loss ends the run.
import { useState } from 'react';
import { card, getDb } from '../../data/cardDb';
import { createGame } from '../../engine/game';
import type { Difficulty, GameState } from '../../engine/types';
import { autoBuildDeck, heroesFor, loadDecks, toDeckList } from '../../deck/deck';
import { recordMatch } from '../../stats/matches';
import { loadFeats, updateFeats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import GameBoard from '../components/GameBoard';
import CardView from '../components/CardView';
import { HeroPicker } from './DecksPage';

const STAGES: Difficulty[] = ['easy', 'easy', 'normal', 'normal', 'normal', 'hard', 'hard', 'hard'];
const KEY = 'fab-trainer.gauntlet.v1';
interface Run { deckId: string | null; heroId: string; opponents: string[]; stage: number; alive: boolean }
const loadRun = (): Run | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const saveRun = (r: Run | null) => { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

export default function GauntletPage() {
  const [run, setRunState] = useState<Run | null>(loadRun);
  const setRun = (r: Run | null) => { saveRun(r); setRunState(r); };
  const [game, setGame] = useState<GameState | null>(null);
  const [picking, setPicking] = useState(false);
  const decks = loadDecks().filter((d) => d.format === 'blitz');
  const best = loadFeats().gauntletBest;

  const begin = (heroId: string, deckId: string | null) => {
    const pool = heroesFor('blitz').filter((h) => h.id !== heroId);
    const opponents: string[] = [];
    while (opponents.length < STAGES.length && pool.length) opponents.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
    setRun({ deckId, heroId, opponents, stage: 0, alive: true });
  };

  const play = () => {
    if (!run) return;
    const deck = loadDecks().find((d) => d.id === run.deckId);
    const mine = deck ? toDeckList(deck) : toDeckList(autoBuildDeck(run.heroId, 'blitz', Date.now() & 0xffff));
    const opp = run.opponents[run.stage];
    setGame(createGame([
      { name: 'You', isBot: false, deck: mine },
      { name: `${card(opp).name.split(',')[0]} (bot)`, isBot: true, difficulty: STAGES[run.stage], deck: toDeckList(autoBuildDeck(opp, 'blitz', (Date.now() + run.stage) & 0xffff)) },
    ], Date.now() & 0x7fffffff, 'blitz'));
  };

  if (game && run) {
    return (
      <GameBoard
        key={game.seed}
        initial={game}
        tutorial={false}
        cosmetics={loadProfile().cosmetics}
        onExit={() => setGame(null)}
        onRematch={() => setGame(null)}
        rematchLabel="Back to the Gauntlet"
        onGameOver={(s, stats) => {
          const [me, them] = s.players;
          const won = s.winner === 0;
          recordMatch({
            format: 'blitz', myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: run.deckId, deckName: 'Gauntlet', difficulty: STAGES[run.stage],
            won, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life, stats,
          });
          const stage = won ? run.stage + 1 : run.stage;
          const champion = won && stage >= STAGES.length;
          updateFeats((f) => ({ ...f, gauntletBest: Math.max(f.gauntletBest, stage), gauntletWins: f.gauntletWins + (champion ? 1 : 0) }));
          setRun({ ...run, stage, alive: won && !champion ? true : won });
        }}
        extraResult={<GauntletResult run={run} />}
      />
    );
  }

  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '.2rem' }}>🏟 The Gauntlet</h1>
        <p className="muted" style={{ marginTop: 0 }}>Eight opponents in a row, from Easy bots up to Hard. Lose once and the run is over. Best run: <b>{best}/{STAGES.length}</b></p>
      </div>
      {!run && (
        <div className="panel col" style={{ gap: '.7rem' }}>
          <h3 style={{ margin: 0 }}>Choose your deck</h3>
          <div className="row">
            {decks.map((d) => <button key={d.id} onClick={() => begin(d.heroId, d.id)}>{d.name}</button>)}
            <button className="gold" onClick={() => setPicking(true)}>Pick a hero (starter deck)</button>
          </div>
          {decks.length === 0 && <p className="small muted">You have no Blitz decks yet, so pick a hero and you get a tuned starter deck.</p>}
        </div>
      )}
      {run && (
        <div className="panel col" style={{ gap: '.8rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Playing <b>{card(run.heroId).name}</b>{run.deckId ? ` · ${loadDecks().find((d) => d.id === run.deckId)?.name ?? ''}` : ' · starter deck'}</span>
            <button className="small" onClick={() => { if (!run.alive || run.stage >= STAGES.length || confirm('Abandon this run?')) setRun(null); }}>{run.alive && run.stage < STAGES.length ? 'Abandon run' : 'New run'}</button>
          </div>
          <div className="gauntlet-ladder">
            {run.opponents.map((h, i) => {
              const state = i < run.stage ? 'beaten' : i === run.stage && run.alive ? 'next' : i === run.stage ? 'lost' : 'locked';
              return (
                <div key={h + i} className={`g-stage ${state}`}>
                  <CardView card={getDb().byId.get(h)!} width="100%" tilt={false} noPopout />
                  <span className="small"><b>{i + 1}.</b> {card(h).name.split(',')[0]}</span>
                  <span className={`g-diff ${STAGES[i]}`}>{STAGES[i]}</span>
                  {state === 'beaten' && <span className="g-mark">✓</span>}
                  {state === 'lost' && <span className="g-mark lost">✕</span>}
                </div>
              );
            })}
          </div>
          {run.stage >= STAGES.length && <h2 className="ok" style={{ margin: 0 }}>🏆 Gauntlet Champion! You beat all {STAGES.length}.</h2>}
          {!run.alive && run.stage < STAGES.length && <p className="err" style={{ margin: 0 }}>Run over at stage {run.stage + 1}. Start a new run to try again.</p>}
          {run.alive && run.stage < STAGES.length && <button className="play-big" onClick={play}>Fight {card(run.opponents[run.stage]).name.split(',')[0]}</button>}
        </div>
      )}
      {picking && (
        <div className="modal-bg" onClick={() => setPicking(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close small" onClick={() => setPicking(false)}>✕</button>
            <h2>Choose your hero</h2>
            <HeroPicker format="blitz" onPick={(h) => { setPicking(false); begin(h.id, null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function GauntletResult({ run }: { run: Run }) {
  // `run` here is the state when the game started; the page shows the updated ladder afterwards
  return <p className="small muted" style={{ marginTop: '.6rem' }}>Gauntlet stage {run.stage + 1} of {STAGES.length}</p>;
}
