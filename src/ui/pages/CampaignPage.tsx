// Story campaigns: pick a campaign, follow the path of battles, read each scene, then fight it.
import { useEffect, useState } from 'react';
import type { Card } from '../../data/types';
import { botDeck } from '../../deck/botDecks';
import { heroesFor, loadDecks, toDeckList } from '../../deck/deck';
import { createGame } from '../../engine/game';
import type { GameState } from '../../engine/types';
import { CAMPAIGNS, campaignProgress, completeChapter, finishedCampaigns } from '../../learn/campaigns';
import type { Campaign, Chapter } from '../../learn/campaigns';
import { recordMatch } from '../../stats/matches';
import { updateFeats } from '../../stats/progress';
import { loadProfile } from '../../stats/profile';
import { saveLocalReplay } from '../../stats/replays';
import GameBoard from '../components/GameBoard';
import CardView from '../components/CardView';

/** A campaign names heroes; play the Blitz version (young hero) of each. */
function heroByName(name: string): Card | undefined {
  const hs = heroesFor('blitz');
  return hs.find((h) => h.name === name) ?? hs.find((h) => h.name.startsWith(name + ',')) ?? hs.find((h) => h.name.startsWith(name));
}

const DIFF_LABEL: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', mythic: 'Mythic' };

export default function CampaignPage({ id }: { id?: string }) {
  const c = CAMPAIGNS.find((x) => x.id === id);
  return c ? <CampaignPath c={c} /> : <CampaignList />;
}

function CampaignList() {
  const prog = campaignProgress();
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '.2rem' }}>🗺 Campaigns</h1>
        <p className="muted" style={{ marginTop: 0 }}>Story battles for one hero, each with a twist, from Easy up to a Mythic finale. Finish a campaign to unlock its card sleeve.</p>
      </div>
      <div className="campaign-grid">
        {CAMPAIGNS.map((c, i) => {
          const hero = heroByName(c.hero);
          const done = prog[c.id]?.length ?? 0;
          return (
            <a key={c.id} className="campaign-card" href={`#campaign/${c.id}`} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="cc-art" style={hero?.image ? { backgroundImage: `url(${hero.image})` } : undefined} />
              <div className="cc-body">
                <h3>{c.title}</h3>
                <div className="small muted">{hero?.name ?? c.hero}</div>
                <p className="small">{c.blurb}</p>
                <div className="cc-progress"><i style={{ width: `${(done / c.chapters.length) * 100}%` }} /></div>
                <div className="small muted">{done === c.chapters.length ? '✓ Complete' : `${done} / ${c.chapters.length} battles`} · reward: {c.reward.name} sleeve</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => setN((k) => { if (k >= text.length) { clearInterval(t); return k; } return k + 2; }), 16);
    return () => clearInterval(t);
  }, [text]);
  return <p className="cs-text" onClick={() => setN(text.length)}>{text.slice(0, n)}<span className="cs-caret">{n < text.length ? '▍' : ''}</span></p>;
}

function CampaignPath({ c }: { c: Campaign }) {
  const [prog, setProg] = useState(campaignProgress);
  const done = prog[c.id] ?? [];
  const nextIdx = c.chapters.findIndex((ch) => !done.includes(ch.id));
  const [sel, setSel] = useState(Math.max(0, nextIdx === -1 ? c.chapters.length - 1 : nextIdx));
  const [game, setGame] = useState<GameState | null>(null);
  const [result, setResult] = useState<'won' | 'lost' | null>(null);
  const hero = heroByName(c.hero);
  const ch = c.chapters[sel];
  const opp = heroByName(ch.opponent);
  const unlocked = (i: number) => i === 0 || done.includes(c.chapters[i - 1].id);

  const fight = (chapter: Chapter) => {
    const me = heroByName(c.hero);
    const them = heroByName(chapter.opponent);
    if (!me || !them) return;
    // your own Blitz deck for this hero if you have one, otherwise its tuned starter deck
    const own = loadDecks().find((d) => d.heroId === me.id && d.format === 'blitz');
    const s = createGame([
      { name: 'You', isBot: false, deck: own ? toDeckList(own) : botDeck(me.id, 'blitz', Date.now() & 0xffff) },
      { name: `${them.name.split(',')[0]} (bot)`, isBot: true, difficulty: chapter.difficulty, deck: botDeck(them.id, 'blitz', (Date.now() >> 3) & 0xffff) },
    ], Date.now() & 0x7fffffff, 'blitz', chapter.twist?.goSecond ? 1 : 0);
    if (chapter.twist?.oppLife) s.players[1].life += chapter.twist.oppLife;
    if (chapter.twist?.myLife) s.players[0].life += chapter.twist.myLife;
    setResult(null);
    setGame(s);
  };

  if (game) {
    return (
      <GameBoard key={game.seed} initial={game} tutorial={false} cosmetics={loadProfile().cosmetics}
        onExit={() => setGame(null)} onRematch={() => setGame(null)} rematchLabel="Back to the campaign"
        onGameOver={(s, stats, replay) => {
          const [me, them] = s.players;
          const won = s.winner === 0;
          const mid = Math.random().toString(36).slice(2, 10);
          if (replay) saveLocalReplay(mid, replay);
          recordMatch({ id: mid, format: 'blitz', myHeroId: me.hero.cardId, oppHeroId: them.hero.cardId, deckId: null, deckName: c.title, difficulty: ch.difficulty, won, turns: s.turn, lifeLeft: me.life, oppLifeLeft: them.life, stats });
          if (won && them.life <= 0) {
            completeChapter(c.id, ch.id);
            const p = campaignProgress();
            setProg(p);
            updateFeats((f) => ({ ...f, campaigns: finishedCampaigns() }));
            if (sel < c.chapters.length - 1) setSel(sel + 1);
          }
          setResult(won ? 'won' : 'lost');
        }}
        extraResult={<div className="small">{result === 'won' ? (sel === c.chapters.length - 1 && finishedCampaigns().includes(c.id) ? `🏆 Campaign complete! The ${c.reward.name} sleeve is yours.` : '✓ Battle won. The next chapter is unlocked.') : 'Not this time: try the battle again from the campaign.'}</div>}
      />
    );
  }

  return (
    <div className="col" style={{ gap: '1rem' }}>
      <a className="btn-link small" href="#campaign">← Campaigns</a>
      <div className="campaign-head">
        {hero && <CardView card={hero} width={110} />}
        <div>
          <h1 style={{ margin: 0 }}>{c.title}</h1>
          <p className="muted" style={{ margin: '.2rem 0' }}>{c.blurb}</p>
          <div className="small muted">{done.length} / {c.chapters.length} battles won · reward: {c.reward.name} sleeve</div>
        </div>
      </div>
      <div className="campaign-path" role="list">
        {c.chapters.map((x, i) => {
          const st = done.includes(x.id) ? 'done' : unlocked(i) ? 'open' : 'locked';
          return (
            <button key={x.id} role="listitem" className={`cp-node ${st} ${i === sel ? 'sel' : ''}`} disabled={st === 'locked'} onClick={() => setSel(i)} style={{ animationDelay: `${i * 80}ms` }}>
              <span className="cp-dot">{st === 'done' ? '✓' : st === 'locked' ? '🔒' : i + 1}</span>
              <span className="cp-title">{x.title}</span>
              <span className="cp-diff">{DIFF_LABEL[x.difficulty] ?? x.difficulty}</span>
            </button>
          );
        })}
      </div>
      <div className="panel chapter-scene" key={ch.id}>
        <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
          {opp && <div className="cs-opp"><CardView card={opp} width={130} /></div>}
          <div className="col" style={{ gap: '.4rem', flex: 1, minWidth: 0 }}>
            <div className="small muted">Chapter {sel + 1} · vs {opp?.name ?? ch.opponent} · {DIFF_LABEL[ch.difficulty] ?? ch.difficulty}</div>
            <h2 style={{ margin: 0 }}>{ch.title}</h2>
            <Typewriter text={ch.story} />
            {ch.twist && <div className="cs-twist">⚡ {ch.twist.label}</div>}
            <div className="row">
              <button className="play-big cs-fight" disabled={!unlocked(sel) || !opp || !hero} onClick={() => fight(ch)}>{done.includes(ch.id) ? 'Fight again' : 'Fight'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
