// Armory night: a Swiss tournament against 7 bot heroes (3 rounds), then a Top 4 cut (semifinal and final).
// Tables you're not at are played out bot-vs-bot.
import { useState } from 'react';
import { getDb } from '../../data/cardDb';
import { createGame } from '../../engine/game';
import type { DeckList } from '../../engine/game';
import type { Difficulty, GameState, PlayerId } from '../../engine/types';
import { botDeck } from '../../deck/botDecks';
import { autoBuildDeck, heroesFor, loadDecks, toDeckList } from '../../deck/deck';
import { simulateGame } from '../../ai/simulate';
import { recordMatch } from '../../stats/matches';
import { updateFeats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import GameBoard from '../components/GameBoard';
import CardView from '../components/CardView';
import { DiceRoll } from '../components/MatchFlow';
import { HeroPicker } from './DecksPage';

interface Entrant { id: number; name: string; heroId: string; deck: DeckList; difficulty: Difficulty; you?: boolean; points: number; wins: number; losses: number; opps: number[] }
interface Pairing { a: number; b: number; winner?: number }
interface Tour { entrants: Entrant[]; round: number; stage: 'swiss' | 'semi' | 'final' | 'done'; pairings: Pairing[]; history: { label: string; pairings: Pairing[] }[]; top?: number[]; champion?: number }

const SWISS_ROUNDS = 3;
const KEY = 'fab-trainer.tournament.v1';
const load = (): Tour | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (t: Tour | null) => { try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

/** Opponents' match-win percentage: the usual Swiss tiebreaker. */
function omw(t: Tour, e: Entrant) {
  if (!e.opps.length) return 0;
  return e.opps.reduce((a, id) => { const o = t.entrants[id]; return a + Math.max(0.33, o.wins / Math.max(1, o.wins + o.losses)); }, 0) / e.opps.length;
}
const standings = (t: Tour) => [...t.entrants].sort((x, y) => y.points - x.points || omw(t, y) - omw(t, x) || x.id - y.id);

/** Swiss pairing: players with the same record meet, avoiding rematches where possible. */
function pairSwiss(t: Tour): Pairing[] {
  const left = standings(t).map((e) => e.id);
  const out: Pairing[] = [];
  while (left.length) {
    const a = left.shift()!;
    let k = left.findIndex((b) => !t.entrants[a].opps.includes(b));
    if (k < 0) k = 0;
    out.push({ a, b: left.splice(k, 1)[0] });
  }
  return out;
}

export default function TournamentPage() {
  const [tour, setTourState] = useState<Tour | null>(load);
  const setTour = (t: Tour | null) => { save(t); setTourState(t); };
  const [picking, setPicking] = useState(false);
  const [game, setGame] = useState<{ state: GameState; pairing: Pairing } | null>(null);
  const [dice, setDice] = useState(false);
  const [busy, setBusy] = useState(false);
  const decks = loadDecks().filter((d) => d.format === 'blitz');

  const begin = (heroId: string, deck: DeckList) => {
    const pool = heroesFor('blitz').filter((h) => h.id !== heroId);
    const bots: Entrant[] = Array.from({ length: 7 }, (_, i) => {
      const h = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      return { id: i + 1, name: h.name, heroId: h.id, deck: botDeck(h.id, 'blitz', (Date.now() + i) & 0xffff), difficulty: i < 3 ? 'normal' : 'hard', points: 0, wins: 0, losses: 0, opps: [] };
    });
    const t: Tour = { entrants: [{ id: 0, name: loadProfile().displayName || 'You', heroId, deck, difficulty: 'normal', you: true, points: 0, wins: 0, losses: 0, opps: [] }, ...bots], round: 1, stage: 'swiss', pairings: [], history: [] };
    t.pairings = pairSwiss(t);
    setTour(t);
  };

  const myPairing = tour?.pairings.find((p) => (p.a === 0 || p.b === 0) && p.winner === undefined);
  const oppOf = (p: Pairing) => tour!.entrants[p.a === 0 ? p.b : p.a];

  /** Record a result and, when every table is done, move to the next round / cut. */
  const report = (t: Tour, p: Pairing, winner: number) => {
    p.winner = winner;
    const loser = winner === p.a ? p.b : p.a;
    if (t.stage === 'swiss') {
      t.entrants[winner].points += 3; t.entrants[winner].wins++; t.entrants[loser].losses++;
      t.entrants[p.a].opps.push(p.b); t.entrants[p.b].opps.push(p.a);
    }
  };
  const playOthers = (t: Tour) => {
    for (const p of t.pairings) {
      if (p.winner !== undefined || p.a === 0 || p.b === 0) continue;
      const A = t.entrants[p.a], B = t.entrants[p.b];
      const w = simulateGame(A.deck, B.deck, A.difficulty, B.difficulty, (Date.now() + p.a * 31 + p.b) & 0x7fffffff);
      report(t, p, w === 0 ? p.a : p.b);
    }
  };
  const advance = (t: Tour) => {
    if (t.pairings.some((p) => p.winner === undefined)) return t;
    const label = t.stage === 'swiss' ? `Round ${t.round}` : t.stage === 'semi' ? 'Top 4' : 'Final';
    t.history.push({ label, pairings: t.pairings });
    if (t.stage === 'swiss' && t.round < SWISS_ROUNDS) { t.round++; t.pairings = pairSwiss(t); return t; }
    if (t.stage === 'swiss') {
      t.top = standings(t).slice(0, 4).map((e) => e.id);
      if (t.top.includes(0)) updateFeats((f) => ({ ...f, tournamentTop: (f.tournamentTop ?? 0) + 1 }));
      t.stage = 'semi';
      t.pairings = [{ a: t.top[0], b: t.top[3] }, { a: t.top[1], b: t.top[2] }];
      return t;
    }
    if (t.stage === 'semi') { t.stage = 'final'; t.pairings = [{ a: t.pairings[0].winner!, b: t.pairings[1].winner! }]; return t; }
    t.stage = 'done';
    t.champion = t.pairings[0].winner;
    if (t.champion === 0) updateFeats((f) => ({ ...f, tournamentWins: (f.tournamentWins ?? 0) + 1 }));
    return t;
  };
  /** Bot tables play out, then the round advances (repeatedly, if you're no longer in the event). */
  const simulateRest = () => {
    if (!tour) return;
    setBusy(true);
    setTimeout(() => {
      let t: Tour = structuredClone(tour);
      for (let guard = 0; guard < 6; guard++) {
        playOthers(t);
        const before = t.pairings;
        t = advance(t);
        if (t.stage === 'done' || t.pairings.some((p) => (p.a === 0 || p.b === 0) && p.winner === undefined) || t.pairings === before) break;
      }
      setTour(t);
      setBusy(false);
    }, 40);
  };

  if (game && tour) {
    const myP = game.pairing;
    const opp = oppOf(myP);
    return (
      <GameBoard key={game.state.seed} initial={game.state} tutorial={false} cosmetics={loadProfile().cosmetics}
        onExit={() => setGame(null)} onRematch={() => setGame(null)} rematchLabel="Back to the event"
        onGameOver={(s, stats) => {
          const [me, them] = s.players;
          recordMatch({ format: 'blitz', myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: null, deckName: 'Armory', difficulty: opp.difficulty, won: s.winner === 0, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life, stats });
          const t: Tour = structuredClone(tour);
          const p = t.pairings.find((x) => x.a === myP.a && x.b === myP.b && x.winner === undefined);
          if (p) report(t, p, s.winner === 0 ? 0 : opp.id);
          setTour(t);
        }} />
    );
  }

  if (!tour) {
    return (
      <div className="col" style={{ gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '.2rem' }}>🏅 Armory night</h1>
          <p className="muted" style={{ marginTop: 0 }}>A local-store style event: you and 7 bot heroes, {SWISS_ROUNDS} Swiss rounds (players with the same record are paired), then the Top 4 play a semifinal and final. Blitz, best of one.</p>
        </div>
        <div className="panel col" style={{ gap: '.6rem' }}>
          <h3 style={{ margin: 0 }}>Register a deck</h3>
          <div className="row">
            {decks.map((d) => <button key={d.id} onClick={() => begin(d.heroId, toDeckList(d))}>{d.name}</button>)}
            <button className="gold" onClick={() => setPicking(true)}>Pick a hero (starter deck)</button>
          </div>
        </div>
        {picking && (
          <div className="modal-bg" onClick={() => setPicking(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="close small" onClick={() => setPicking(false)}>✕</button>
              <h2>Choose your hero</h2>
              <HeroPicker format="blitz" onPick={(h) => { setPicking(false); begin(h.id, toDeckList(autoBuildDeck(h.id, 'blitz', Date.now() & 0xffff))); }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const stageLabel = tour.stage === 'swiss' ? `Round ${tour.round} of ${SWISS_ROUNDS}` : tour.stage === 'semi' ? 'Top 4 · semifinals' : tour.stage === 'final' ? 'Final' : 'Event complete';
  const pendingOthers = tour.pairings.some((p) => p.winner === undefined && p.a !== 0 && p.b !== 0);
  const roundDone = tour.pairings.every((p) => p.winner !== undefined);
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>🏅 Armory night · {stageLabel}</h1>
        <button className="small" onClick={() => { if (tour.stage === 'done' || confirm('Drop from this event?')) setTour(null); }}>{tour.stage === 'done' ? 'New event' : 'Drop'}</button>
      </div>
      {tour.stage === 'done' && <h2 className={tour.champion === 0 ? 'ok' : ''} style={{ margin: 0 }}>{tour.champion === 0 ? '🏆 You won the event!' : `🏆 ${tour.entrants[tour.champion!].name} won the event.`}</h2>}
      <div className="tour-grid">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{tour.stage === 'done' ? 'Final table' : 'Pairings'}</h3>
          {tour.pairings.map((p, i) => {
            const A = tour.entrants[p.a], B = tour.entrants[p.b];
            const mine = p.a === 0 || p.b === 0;
            return (
              <div key={i} className={`pairing ${mine ? 'mine' : ''}`}>
                <span className="small muted">Table {i + 1}</span>
                <span className={p.winner === A.id ? 'ok' : ''}>{A.name}</span><span className="muted">vs</span><span className={p.winner === B.id ? 'ok' : ''}>{B.name}</span>
                {mine && p.winner === undefined && <button className="primary small" onClick={() => setDice(true)}>Play</button>}
              </div>
            );
          })}
          {tour.stage !== 'done' && (!myPairing || roundDone) && (
            <button className="play-big" disabled={busy} onClick={simulateRest}>{busy ? 'Playing the other tables…' : roundDone ? 'Next round' : 'Play out the other tables'}</button>
          )}
          {myPairing && pendingOthers && <p className="small muted">The other tables finish after your game.</p>}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Standings</h3>
          <table className="history">
            <thead><tr><th>#</th><th>Player</th><th>Record</th><th>Pts</th><th>OMW%</th></tr></thead>
            <tbody>
              {standings(tour).map((e, i) => (
                <tr key={e.id} className={e.you ? 'me-row' : ''}>
                  <td>{i + 1}{tour.top?.includes(e.id) ? ' ✦' : ''}</td>
                  <td><span className="row" style={{ gap: '.4rem' }}><span className="tour-hero"><CardView card={getDb().byId.get(e.heroId)!} width={28} tilt={false} noPopout /></span>{e.name}{e.you ? ' (you)' : ''}</span></td>
                  <td>{e.wins}–{e.losses}</td><td><b>{e.points}</b></td><td>{Math.round(omw(tour, e) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {dice && myPairing && (
        <DiceRoll names={['You', oppOf(myPairing).name]} onDone={(first) => {
          setDice(false);
          const opp = oppOf(myPairing);
          setGame({ pairing: myPairing, state: createGame([
            { name: 'You', isBot: false, deck: tour.entrants[0].deck },
            { name: `${opp.name} (bot)`, isBot: true, difficulty: opp.difficulty, deck: opp.deck },
          ], Date.now() & 0x7fffffff, 'blitz', first as PlayerId) });
        }} />
      )}
    </div>
  );
}
