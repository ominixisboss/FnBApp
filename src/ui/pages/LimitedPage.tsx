// Sealed and Draft: open packs (or draft them against bots), build a 30+ card deck from your pool, then play it.
import { useEffect, useMemo, useState } from 'react';
import { eligibleForHero, getDb } from '../../data/cardDb';
import type { Card } from '../../data/types';
import { createGame } from '../../engine/game';
import type { GameState } from '../../engine/types';
import { LIMITED_MIN_DECK, LIMITED_SETS, PACK_SIZE, autoBuildLimited, botPick, limitedDeckList, openPack, rngFrom, setHeroes } from '../../deck/limited';
import { isArenaCard } from '../../deck/deck';
import { recordMatch } from '../../stats/matches';
import { updateFeats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import GameBoard from '../components/GameBoard';
import CardView from '../components/CardView';
import { online, useOnline } from '../../online/client';
import { useAuth } from '../auth';
import { PodLive, PodOpponents, PodStart } from './PodTable';

type Mode = 'sealed' | 'draft';
interface Draft { round: number; packs: string[][]; heroes: string[]; picks: string[][] }
interface Session { mode: Mode; set: string; seed: number; step: 'open' | 'hero' | 'draft' | 'build'; pool: string[]; opened: number; heroId?: string; deck: string[]; draft?: Draft; pod?: string }
const KEY = 'fab-trainer.limited.v1';
const load = (): Session | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (s: Session | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };
const SEATS = 8;
const ROUNDS = 3;
const SEALED_PACKS = 6;
const db = () => getDb();
const C = (id: string) => db().byId.get(id)!;

export default function LimitedPage() {
  const [sess, setSessState] = useState<Session | null>(load);
  const setSess = (s: Session | null) => { save(s); setSessState(s); };
  const [game, setGame] = useState<GameState | null>(null);
  const [mode, setMode] = useState<Mode>('sealed');
  const net = useOnline();
  const pod = net.pod;
  // when your table finishes drafting (or opens its sealed packs), build from the pool the server dealt you
  useEffect(() => {
    if (pod?.phase === 'building' && sess?.pod !== pod.code) {
      setSess({ mode: pod.mode === 'sealed' ? 'sealed' : 'draft', set: pod.set, seed: 0, step: 'hero', pool: pod.you.pool, opened: SEALED_PACKS, deck: [], pod: pod.code });
    }
  }, [pod?.phase, pod?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  const auth = useAuth();
  useEffect(() => { if (auth.user && auth.available) online.connect(); }, [auth.user, auth.available]);
  const [set, setSet] = useState(LIMITED_SETS[0][0]);

  const start = () => {
    const seed = Date.now() & 0x7fffffff;
    if (mode === 'sealed') {
      const rng = rngFrom(seed);
      const pool = Array.from({ length: SEALED_PACKS }, () => openPack(set, rng)).flat();
      setSess({ mode, set, seed, step: 'open', pool, opened: 0, deck: [] });
    } else {
      setSess({ mode, set, seed, step: 'hero', pool: [], opened: 0, deck: [] });
    }
  };

  if (game && sess) {
    return (
      <GameBoard key={game.seed} initial={game} tutorial={false} cosmetics={loadProfile().cosmetics}
        onExit={() => setGame(null)} onRematch={() => setGame(null)} rematchLabel="Back to deck"
        onGameOver={(s, stats) => {
          const [me, them] = s.players;
          recordMatch({ format: sess.mode, myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: null, deckName: `${sess.mode === 'sealed' ? 'Sealed' : 'Draft'} deck`, difficulty: 'normal', won: s.winner === 0, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life, stats });
          if (s.winner === 0) updateFeats((f) => (sess.mode === 'sealed' ? { ...f, sealedWins: f.sealedWins + 1 } : { ...f, draftWins: f.draftWins + 1 }));
        }} />
    );
  }

  if (pod && pod.phase !== 'building') return <PodLive />;
  if (!sess) {
    return (
      <div className="col" style={{ gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '.2rem' }}>📦 Sealed &amp; Draft</h1>
          <p className="muted" style={{ marginTop: 0 }}>Build a deck from booster packs, then play it against a bot. <b>Sealed</b>: open {SEALED_PACKS} packs and build from them. <b>Draft</b>: pick one card at a time from packs passed around a table of 7 bots.</p>
        </div>
        <div className="panel col" style={{ gap: '.8rem' }}>
          <div className="seg"><button className={mode === 'sealed' ? 'on' : ''} onClick={() => setMode('sealed')}>Sealed</button><button className={mode === 'draft' ? 'on' : ''} onClick={() => setMode('draft')}>Draft</button></div>
          <label className="row">Set <select value={set} onChange={(e) => setSet(e.target.value)}>{LIMITED_SETS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <button className="play-big" onClick={start}>{mode === 'sealed' ? 'Open packs' : 'Start draft'}</button>
        </div>
        <PodStart />
      </div>
    );
  }

  const setName = LIMITED_SETS.find(([c]) => c === sess.set)?.[1] ?? sess.set;
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>📦 {sess.mode === 'sealed' ? 'Sealed' : 'Draft'} · {setName}</h1>
        <button className="small" onClick={() => { if (confirm('Throw away this pool and start over?')) { if (sess.pod) online.podLeave(); setSess(null); } }}>New {sess.mode}</button>
      </div>
      {sess.step === 'open' && <OpenPacks sess={sess} setSess={setSess} />}
      {sess.step === 'hero' && <PickHero sess={sess} setSess={setSess} />}
      {sess.step === 'draft' && <Drafting sess={sess} setSess={setSess} />}
      {sess.step === 'build' && <Build sess={sess} setSess={setSess} onPlay={(g) => setGame(g)} />}
    </div>
  );
}

function OpenPacks({ sess, setSess }: { sess: Session; setSess: (s: Session) => void }) {
  const shown = sess.pool.slice(Math.max(0, sess.opened - 1) * PACK_SIZE, sess.opened * PACK_SIZE);
  return (
    <div className="panel col" style={{ gap: '.8rem' }}>
      <div className="row">
        <b>Pack {Math.max(1, sess.opened)} of {SEALED_PACKS}</b>
        {sess.opened < SEALED_PACKS && <button className="primary" onClick={() => setSess({ ...sess, opened: sess.opened + 1 })}>{sess.opened ? 'Open next pack' : 'Open first pack'}</button>}
        <button onClick={() => setSess({ ...sess, opened: SEALED_PACKS, step: 'hero' })}>{sess.opened >= SEALED_PACKS ? 'Choose your hero →' : 'Open all & continue'}</button>
      </div>
      <div className="pack-reveal" key={sess.opened}>
        {shown.map((id, i) => <div key={i} className="pack-card" style={{ animationDelay: `${i * 70}ms` }}><CardView card={C(id)} width="100%" /></div>)}
      </div>
    </div>
  );
}

function PickHero({ sess, setSess }: { sess: Session; setSess: (s: Session) => void }) {
  const heroes = setHeroes(sess.set);
  const choose = (h: Card) => {
    if (sess.mode === 'sealed') { setSess({ ...sess, heroId: h.id, step: 'build', deck: autoBuildLimited(sess.pool, h) }); return; }
    // draft: the bots each take another hero from the set (or any young hero if the set has few)
    const rng = rngFrom(sess.seed);
    const others = heroes.filter((x) => x.id !== h.id).map((x) => x.id);
    const botHeroes = Array.from({ length: SEATS - 1 }, (_, i) => others[i % Math.max(1, others.length)] ?? h.id);
    const packs = Array.from({ length: SEATS }, () => openPack(sess.set, rng));
    setSess({ ...sess, heroId: h.id, step: 'draft', draft: { round: 1, packs, heroes: [h.id, ...botHeroes], picks: Array.from({ length: SEATS }, () => []) } });
  };
  return (
    <div className="panel col" style={{ gap: '.6rem' }}>
      <h3 style={{ margin: 0 }}>Choose your hero</h3>
      <p className="small muted" style={{ margin: 0 }}>{sess.mode === 'sealed' ? 'The number shows how many cards in your pool that hero can use.' : 'You’ll draft cards for this hero; the bots draft for theirs.'}</p>
      <div className="hero-choices">
        {heroes.map((h) => {
          const usable = sess.pool.filter((id) => eligibleForHero(C(id), h)).length;
          return (
            <button key={h.id} className="hero-choice" onClick={() => choose(h)}>
              <CardView card={h} width="100%" tilt={false} noPopout />
              <span className="small">{h.name}</span>
              {sess.mode === 'sealed' && <span className="tag">{usable} usable</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Drafting({ sess, setSess }: { sess: Session; setSess: (s: Session) => void }) {
  const d = sess.draft!;
  const pick = (i: number) => {
    const packs = d.packs.map((p) => [...p]);
    const picks = d.picks.map((p) => [...p]);
    picks[0].push(packs[0].splice(i, 1)[0]);
    for (let seat = 1; seat < SEATS; seat++) {
      const k = botPick(packs[seat], C(d.heroes[seat]));
      picks[seat].push(packs[seat].splice(k, 1)[0]);
    }
    // pass the packs: left in rounds 1 and 3, right in round 2
    const dir = d.round === 2 ? -1 : 1;
    const passed = packs.map((_, seat) => packs[(seat - dir + SEATS) % SEATS]);
    if (passed[0].length) { setSess({ ...sess, draft: { ...d, packs: passed, picks } }); return; }
    if (d.round < ROUNDS) {
      const rng = rngFrom(sess.seed + d.round * 7919);
      setSess({ ...sess, draft: { ...d, round: d.round + 1, packs: Array.from({ length: SEATS }, () => openPack(sess.set, rng)), picks } });
      return;
    }
    const hero = C(sess.heroId!);
    setSess({ ...sess, step: 'build', pool: picks[0], deck: autoBuildLimited(picks[0], hero), draft: { ...d, packs: [], picks } });
  };
  const hero = C(sess.heroId!);
  const pickNo = d.picks[0].length - (d.round - 1) * PACK_SIZE + 1;
  return (
    <div className="panel col" style={{ gap: '.6rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>Pack {d.round} of {ROUNDS} · pick {pickNo} of {PACK_SIZE}</b>
        <span className="small muted">Drafting for {hero.name} · {d.picks[0].length} cards picked · cards your hero can’t use are dimmed</span>
      </div>
      <div className="pack-reveal" key={`${d.round}-${pickNo}`}>
        {d.packs[0].map((id, i) => (
          <div key={id + i} className={`pack-card ${eligibleForHero(C(id), hero) ? '' : 'ineligible'}`} style={{ animationDelay: `${i * 40}ms` }}>
            <CardView card={C(id)} width="100%" onClick={() => pick(i)} />
          </div>
        ))}
      </div>
      {d.picks[0].length > 0 && <div className="small muted">Your picks: {d.picks[0].map((id) => C(id).name).join(', ')}</div>}
    </div>
  );
}

function Build({ sess, setSess, onPlay }: { sess: Session; setSess: (s: Session) => void; onPlay: (g: GameState) => void }) {
  const hero = C(sess.heroId!);
  const [showAll, setShowAll] = useState(false);
  // what's left in the pool after the deck takes its copies
  const left = useMemo(() => { const p = [...sess.pool]; for (const id of sess.deck) { const i = p.indexOf(id); if (i >= 0) p.splice(i, 1); } return p; }, [sess.pool, sess.deck]);
  const main = sess.deck.filter((id) => !isArenaCard(C(id))).length;
  const add = (id: string) => setSess({ ...sess, deck: [...sess.deck, id] });
  const remove = (i: number) => setSess({ ...sess, deck: sess.deck.filter((_, k) => k !== i) });
  const pool = left.filter((id) => showAll || eligibleForHero(C(id), hero)).sort((a, b) => C(a).name.localeCompare(C(b).name));
  const play = () => {
    // the opponent: a bot with its own pool (a drafter from your table, or its own sealed packs)
    let oppHero: Card;
    let oppPool: string[];
    if (sess.mode === 'draft' && sess.draft) {
      const seat = 1 + Math.floor(Math.random() * (SEATS - 1));
      oppHero = C(sess.draft.heroes[seat]);
      oppPool = sess.draft.picks[seat];
    } else {
      const rng = rngFrom(Date.now());
      const hs = setHeroes(sess.set).filter((h) => h.id !== hero.id);
      oppHero = hs[Math.floor(rng() * hs.length)] ?? hero;
      oppPool = Array.from({ length: SEALED_PACKS }, () => openPack(sess.set, rng)).flat();
    }
    onPlay(createGame([
      { name: 'You', isBot: false, deck: limitedDeckList(hero, sess.deck) },
      { name: `${oppHero.name.split(',')[0]} (bot)`, isBot: true, difficulty: 'normal', deck: limitedDeckList(oppHero, autoBuildLimited(oppPool, oppHero)) },
    ], Date.now() & 0x7fffffff, 'blitz'));
  };
  return (
    <div className="limited-build">
      <div className="panel col" style={{ gap: '.5rem' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>Your pool ({left.length} left)</b>
          <label className="small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show cards {hero.name.split(',')[0]} can’t use</label>
        </div>
        <div className="grid small-grid">
          {pool.map((id, i) => <div key={id + i} className={eligibleForHero(C(id), hero) ? '' : 'ineligible'}><CardView card={C(id)} width="100%" onClick={() => eligibleForHero(C(id), hero) && add(id)} /></div>)}
        </div>
      </div>
      <div className="panel col decklist" style={{ gap: '.4rem' }}>
        <div className="row"><CardView card={hero} width={70} /><div className="col"><b>{hero.name}</b><span className={`small ${main >= LIMITED_MIN_DECK ? 'ok' : 'err'}`}>{main} / {LIMITED_MIN_DECK}+ cards</span></div></div>
        <div className="row">
          <button onClick={() => setSess({ ...sess, deck: autoBuildLimited(sess.pool, hero) })}>✨ Auto-build</button>
          <button onClick={() => setSess({ ...sess, deck: [] })}>Clear</button>
        </div>
        <div className="col" style={{ gap: 2, maxHeight: 420, overflow: 'auto' }}>
          {[...new Set(sess.deck)].sort((a, b) => C(a).name.localeCompare(C(b).name)).map((id) => (
            <div key={id} className="dl-row">{C(id).pitch && <span className={`pitch-${C(id).pitch}`}><span className="dot" /></span>}<span className="nm">{C(id).name}</span>
              <b>{sess.deck.filter((x) => x === id).length}</b><button onClick={() => remove(sess.deck.indexOf(id))}>−</button></div>
          ))}
        </div>
        {sess.pod && <button className="primary" disabled={main < LIMITED_MIN_DECK} onClick={() => online.podDeck(limitedDeckList(hero, sess.deck))}>Submit deck to table {sess.pod}</button>}
        {sess.pod && <PodOpponents heroId={hero.id} />}
        <button className="play-big" disabled={main < LIMITED_MIN_DECK} onClick={play}>{sess.pod ? 'Play a bot' : 'Play'}</button>
        {main < LIMITED_MIN_DECK && <span className="small muted">Add {LIMITED_MIN_DECK - main} more cards (or use Auto-build).</span>}
      </div>
    </div>
  );
}

