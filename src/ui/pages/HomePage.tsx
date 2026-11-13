import InstallPrompt from '../components/InstallPrompt';
import type { CardDb } from '../../data/cardDb';
import { loadDecks } from '../../deck/deck';
import { Embers } from '../components/Fx';

export default function HomePage({ db }: { db: CardDb }) {
  const decks = loadDecks();
  return (
    <div>
      <div className="home-hero">
        <Embers />
        <h1 className="title-shimmer" style={{ fontSize: 'clamp(2rem, 6vw, 3.2rem)' }}>Learn & play Flesh and Blood</h1>
        <p className="muted">Practice against AI bots, build or import decks, and browse all {db.cards.length.toLocaleString()} cards.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <a href="#learn/practice"><button className="primary">New to FaB? Start a guided game</button></a>
          <a href="#play"><button className="gold">Play vs AI</button></a>
        </div>
      </div>
      <InstallPrompt />
      <div className="tiles">
        <a className="panel tile" href="#learn"><h3>📖 Learn</h3><p className="muted">Short lessons on pitching, combat, defending and strategy, plus a keyword glossary.</p></a>
        <a className="panel tile" href="#play"><h3>⚔ Play</h3><p className="muted">Bots from Easy to Mythic, real match rules, hints and undo. Play sideways or upright with one hand.</p></a>
        <a className="panel tile" href="#decks"><h3>🃏 Decks</h3><p className="muted">{decks.length ? `${decks.length} saved deck${decks.length > 1 ? 's' : ''}. ` : ''}Build with live legality checks, import from Fabrary/FaB DB text, export, or auto-build.</p></a>
        <a className="panel tile" href="#cards"><h3>🔎 Card database</h3><p className="muted">Search every card by name, text, class, type, pitch and format.</p></a>
        <a className="panel tile" href="#puzzles"><h3>🧩 Lethal puzzles</h3><p className="muted">Win this turn: positions even the bots can’t solve.</p></a>
        <a className="panel tile" href="#tools"><h3>🧰 Table tools</h3><p className="muted">Life counter, sample hands and a printable decklist for games with real cards.</p></a>
        <a className="panel tile" href="#tournament"><h3>🏅 Armory night</h3><p className="muted">A Swiss tournament against 7 bot heroes, then a Top 4 cut.</p></a>
        <a className="panel tile" href="#gauntlet"><h3>🏟 Gauntlet</h3><p className="muted">Eight opponents in a row, Easy to Hard. One loss ends the run.</p></a>
        <a className="panel tile" href="#limited"><h3>📦 Sealed &amp; Draft</h3><p className="muted">Open packs or draft against bots, build a deck and play it.</p></a>
      </div>
      <p className="muted small" style={{ marginTop: '2rem' }}>
        Fan-made learning tool. Not affiliated with Legend Story Studios. Card data comes from the open-source the-fab-cube project; card images are hosted by LSS. <a href="#privacy">Privacy</a>
      </p>
    </div>
  );
}
