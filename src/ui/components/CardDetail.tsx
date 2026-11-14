import type { Card } from '../../data/types';
import { PITCH_COLOR } from '../../data/types';
import { getScript } from '../../engine/cardScript';
import { heroAutomation } from '../../engine/heroes';
import CardView from './CardView';
import { SymText } from '../symbols';
import { useEffect, useState } from 'react';

// official keyword definitions (public/data/keywords.json, from the card data source), loaded once
let kwDefs: Record<string, string> | null = null;
let kwLoading: Promise<Record<string, string>> | null = null;
function useKeywordDefs() {
  const [defs, setDefs] = useState(kwDefs);
  useEffect(() => {
    if (kwDefs) return;
    kwLoading ??= fetch(`${import.meta.env.BASE_URL}data/keywords.json`).then((r) => r.json()).catch(() => ({}));
    let on = true;
    void kwLoading.then((d) => { kwDefs = d; if (on) setDefs(d); });
    return () => { on = false; };
  }, []);
  return defs;
}
const baseKw = (k: string) => k.replace(/\s+(\d+|X)$/, '');

const FORMAT_LABEL: Record<string, string> = { blitz: 'Blitz', cc: 'Classic Constructed', sage: 'Silver Age', commoner: 'Commoner', ll: 'Living Legend' };

export default function CardDetail({ card, onClose, actions }: { card: Card; onClose: () => void; actions?: React.ReactNode }) {
  const sc = getScript(card);
  const defs = useKeywordDefs();
  const official = (card.keywords ?? []).map((k) => [k, defs?.[k] ?? defs?.[baseKw(k)]] as const).filter(([, d]) => !!d);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close small" onClick={onClose}>✕</button>
        <div className="detail">
          <CardView card={card} width="100%" />
          <div className="col">
            <h2 style={{ marginBottom: 0 }}>
              {card.name} {card.pitch ? <span className={`pitch-${card.pitch}`}><span className="dot" /> <span className="small muted">{PITCH_COLOR[card.pitch]}</span></span> : null}
            </h2>
            <div className="muted">{card.typeText}</div>
            <div className="stats">
              {card.pitch !== null && <span className="stat">Pitch {card.pitch}</span>}
              {card.cost !== null && <span className="stat">Cost {card.cost}</span>}
              {card.power !== null && <span className="stat">Power {card.power}</span>}
              {card.defense !== null && <span className="stat">Defense {card.defense}</span>}
              {card.health !== null && <span className="stat">Life {card.health}</span>}
              {card.intellect !== null && <span className="stat">Intellect {card.intellect}</span>}
              {card.arcane !== null && <span className="stat">Arcane {card.arcane}</span>}
            </div>
            {card.text && <div className="rules-text"><SymText text={card.text} /></div>}
            <div className="row">
              {card.keywords.map((k) => <span key={k} className="tag">{k}</span>)}
            </div>
            {official.length > 0 && (
              <div className="official-rules">
                <b className="small">Official rules</b>
                {official.map(([k, d]) => <div key={k} className="small"><b>{k}</b>: {d}</div>)}
              </div>
            )}
            <div className="small">
              <a href={`https://rules.fabtcg.com/`} target="_blank" rel="noreferrer">Comprehensive rules ↗</a>
              {' · '}
              <a href={`https://www.google.com/search?q=${encodeURIComponent(`site:fabtcg.com "${card.name}" ruling OR errata`)}`} target="_blank" rel="noreferrer">Search official rulings &amp; errata ↗</a>
            </div>
            <div className="small">
              <b>Legal in:</b> {card.legal.length ? card.legal.map((f) => FORMAT_LABEL[f]).join(', ') : 'none (banned / rotated / living legend)'}
            </div>
            <div className="small muted">Sets: {card.sets.join(', ')} · {card.printId}</div>
            {!card.types.includes('Hero') && (
              <div className="small">
                <b>Simulator support: </b>
                {sc.coverage === 'full' && <span className="ok">fully automated</span>}
                {sc.coverage === 'partial' && <span style={{ color: 'var(--yellow)' }}>partly automated</span>}
                {sc.coverage === 'none' && <span className="err">stats only — use manual controls for its text</span>}
                {sc.unparsed.length > 0 && (
                  <ul className="muted" style={{ margin: '.3em 0' }}>
                    {sc.unparsed.map((u, i) => <li key={i}>Not automated: “{u}”</li>)}
                  </ul>
                )}
              </div>
            )}
            {card.types.includes('Hero') && <div className="small"><b>Simulator support: </b>{heroAutomation(card).summary}</div>}
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
