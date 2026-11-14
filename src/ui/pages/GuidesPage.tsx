// Hero guides: how each hero wins, its key cards, and how to beat it, with buttons to try it out.
import { useMemo } from 'react';
import { card } from '../../data/cardDb';
import { archetypeFor } from '../../deck/archetypes';
import { botDeck, hasTunedDeck } from '../../deck/botDecks';
import { heroesFor } from '../../deck/deck';
import { cardPlayValue } from '../../engine/game';
import { heroAutomation } from '../../engine/heroes';
import { ARCHETYPE_GUIDES, GENERAL_TIPS } from '../../learn/heroGuides';
import CardView from '../components/CardView';
import { SymText } from '../symbols';

export default function GuidesPage({ heroId }: { heroId?: string }) {
  const heroes = useMemo(() => heroesFor('blitz').sort((a, b) => a.name.localeCompare(b.name)), []);
  if (heroId) return <Guide heroId={heroId} />;
  const byArch = new Map<string, typeof heroes>();
  for (const h of heroes) { const a = archetypeFor(h).label; byArch.set(a, [...(byArch.get(a) ?? []), h]); }
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '.2rem' }}>📚 Hero guides</h1>
        <p className="muted" style={{ marginTop: 0 }}>How each hero wins, the cards that matter, and how to beat them. Every guide ends with a game against that hero.</p>
      </div>
      {[...byArch.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([arch, hs]) => (
        <div key={arch}>
          <div className="lobby-label">{arch}</div>
          <div className="guide-grid">
            {hs.map((h) => (
              <a key={h.id} href={`#guides/${h.id}`} className="guide-hero">
                <CardView card={h} width="100%" tilt={false} noPopout />
                <span className="small">{h.name.split(',')[0]}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Guide({ heroId }: { heroId: string }) {
  const hero = card(heroId);
  const arch = archetypeFor(hero);
  const guide = ARCHETYPE_GUIDES[arch.id] ?? ARCHETYPE_GUIDES.midrange;
  const auto = heroAutomation(hero);
  const deck = useMemo(() => botDeck(heroId, 'blitz', 1), [heroId]);
  const key = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of deck.cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const sig = new Set(arch.signature.map((x) => x.toLowerCase()));
    return [...counts.keys()].map(card)
      .sort((a, b) => Number(sig.has(b.name.toLowerCase())) - Number(sig.has(a.name.toLowerCase())) || cardPlayValue(b) - cardPlayValue(a))
      .filter((c, i, all) => all.findIndex((x) => x.name === c.name) === i)
      .slice(0, 8);
  }, [deck, arch]);
  const arena = [...deck.weaponIds, ...deck.equipmentIds].map(card);
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <a className="btn-link small" href="#guides">← All heroes</a>
      <div className="guide-head">
        <CardView card={hero} width={200} />
        <div className="col" style={{ gap: '.4rem' }}>
          <h1 style={{ margin: 0 }}>{hero.name}</h1>
          <div className="muted">{arch.label} · {hero.health ?? '?'} life · intellect {hero.intellect ?? '?'}</div>
          <p className="guide-ability"><SymText text={hero.text} /></p>
          <div className={`small ${auto.level === 'none' ? 'err' : 'muted'}`}>In this app: {auto.summary}{auto.level === 'partial' ? ' (partly automated)' : ''}</div>
          <div className="row" style={{ marginTop: '.4rem' }}>
            <a className="btn-link primary" href={`#play/as/${hero.id}`}>Play as {hero.name.split(',')[0]}</a>
            <a className="btn-link" href={`#play/vs/${hero.id}`}>Practice against {hero.name.split(',')[0]}</a>
          </div>
        </div>
      </div>
      <div className="panel">
        <h3>How {hero.name.split(',')[0]} wins</h3>
        <p>{guide.plan}</p>
        <ul>{guide.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <div className="panel">
        <h3>Key cards</h3>
        <p className="small muted" style={{ marginTop: 0 }}>From the {hasTunedDeck(heroId) ? 'bots’ self-play tuned' : 'auto-built'} Blitz deck.</p>
        <div className="guide-cards">{key.map((c) => <CardView key={c.id} card={c} width="100%" />)}</div>
        {arena.length > 0 && <p className="small muted">Weapons &amp; equipment: {arena.map((c) => c.name).join(', ')}</p>}
      </div>
      <div className="panel">
        <h3>How to beat {hero.name.split(',')[0]}</h3>
        <ul>{guide.against.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <div className="panel">
        <h3>Basics</h3>
        <ul>{GENERAL_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <div className="row">
        <a className="btn-link primary" href={`#play/vs/${hero.id}`}>Practice against {hero.name.split(',')[0]} →</a>
      </div>
    </div>
  );
}
