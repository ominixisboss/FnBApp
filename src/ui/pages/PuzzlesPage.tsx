// Lethal puzzles: win this turn from a fixed position.
import { useMemo, useState } from 'react';
import { getDb } from '../../data/cardDb';
import { applyAction } from '../../engine/game';
import { describeAction } from '../../ai/bot';
import { PUZZLES } from '../../learn/puzzles';
import { buildPuzzle, puzzleFailed, settle, solve } from '../../learn/puzzleEngine';
import type { PuzzleDef } from '../../learn/puzzleEngine';
import { loadFeats, updateFeats } from '../../stats/progress';
import type { GameState } from '../../engine/types';
import GameBoard from '../components/GameBoard';
import CardView from '../components/CardView';

const heroName = (id: string) => getDb().byId.get(id)?.name.split(',')[0] ?? '?';

export default function PuzzlesPage({ id }: { id?: string }) {
  const [solved, setSolved] = useState(() => new Set(loadFeats().puzzles));
  const idx = PUZZLES.findIndex((p) => p.id === id);
  if (idx >= 0) {
    const next = PUZZLES[idx + 1];
    return <PuzzleRun key={id} def={PUZZLES[idx]} next={next} onSolved={() => setSolved(new Set(loadFeats().puzzles))} />;
  }
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '.2rem' }}>🧩 Lethal puzzles</h1>
        <p className="muted" style={{ marginTop: 0 }}>Win this turn. Each position has exactly enough damage, if you play your cards in the right order, pitch the right ones and attack where the opponent can’t block well. The bots can’t solve these. Can you?</p>
        <p className="small">Solved {solved.size} / {PUZZLES.length}</p>
      </div>
      <div className="puzzle-grid">
        {PUZZLES.map((p, i) => {
          const blockers = p.opp.hand?.length ?? 0;
          return (
            <a key={p.id} href={`#puzzles/${p.id}`} className={`puzzle-tile panel ${solved.has(p.id) ? 'solved' : ''}`}>
              <div className="pt-hero"><CardView card={getDb().byId.get(p.me.hero)!} width={64} tilt={false} noPopout /></div>
              <div className="col" style={{ gap: '.15rem' }}>
                <b>{i + 1}. {p.title}</b>
                <span className="small muted">{heroName(p.me.hero)} vs {heroName(p.opp.hero)}</span>
                <span className="small">Opponent at <b>{p.opp.life}</b> life{blockers ? ` · ${blockers} card${blockers > 1 ? 's' : ''} to block with` : ' · no cards in hand'}</span>
                <span className="small muted">{p.me.hand.length} cards in hand{p.me.arsenal ? ' + 1 in arsenal' : ''}</span>
              </div>
              {solved.has(p.id) && <span className="pt-done">✓</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function PuzzleRun({ def, next, onSolved }: { def: PuzzleDef; next?: PuzzleDef; onSolved: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const start = useMemo(() => buildPuzzle(def), [def, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [failed, setFailed] = useState(false);
  const [solution, setSolution] = useState<string[] | 'working' | null>(null);
  const retry = () => { setFailed(false); setAttempt((a) => a + 1); };
  const showSolution = () => {
    setSolution('working');
    setTimeout(() => {
      const s0 = buildPuzzle(def);
      const line = solve(s0, 30000);
      if (!line) { setSolution(['No line found.']); return; }
      // describe each step in the position it was played from
      const steps: string[] = [];
      let s: GameState = settle(s0);
      for (const a of line) {
        if (a.type === 'play' || a.type === 'activate') steps.push(describeAction(s, a));
        try { s = settle(applyAction(s, a)); } catch { break; }
      }
      setSolution(steps.length ? steps : ['Just pass to the damage.']);
    }, 30);
  };
  return (
    <>
      <GameBoard
        key={attempt}
        initial={start}
        tutorial={false}
        onExit={() => { location.hash = 'puzzles'; }}
        onRematch={retry}
        rematchLabel="Play again"
        watch={(s) => { if (!failed && puzzleFailed(s, start)) setFailed(true); }}
        onGameOver={(s) => {
          if (s.winner !== 0) return;
          updateFeats((f) => ({ ...f, puzzles: [...new Set([...f.puzzles, def.id])] }));
          onSolved();
        }}
        extraResult={<div className="row" style={{ justifyContent: 'center', marginTop: '.6rem' }}>
          <b className="ok">🧩 Puzzle solved!</b>
          {next && <a className="btn-link" href={`#puzzles/${next.id}`}>Next puzzle →</a>}
          <a className="btn-link" href="#puzzles">All puzzles</a>
        </div>}
      />
      <div className="puzzle-banner">
        <b>🧩 {def.title}</b>
        <span>Win this turn: deal {def.opp.life} damage.</span>
      </div>
      {failed && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: 480 }}>
            <h2>Not this time</h2>
            <p>Your turn ended and {heroName(def.opp.hero)} survived. Think about which cards give you an extra action point, what to pitch to pay for everything, and the order that gets the most damage through.</p>
            {solution === 'working' && <p className="muted">Working out the solution…</p>}
            {Array.isArray(solution) && <ol className="solution">{solution.map((t, i) => <li key={i}>{t}</li>)}</ol>}
            <div className="row">
              <button className="primary" onClick={retry}>Try again</button>
              {solution === null && <button onClick={showSolution}>Show solution</button>}
              <a className="btn-link" href="#puzzles">All puzzles</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
