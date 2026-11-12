// Pre-game steps of a real match: choosing your loadout (equipment and cards from your pool, i.e. sideboarding)
// and the die roll for who goes first.
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '../../data/cardDb';
import type { Card } from '../../data/types';
import type { DeckList } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
import CardView from './CardView';

const C = (id: string) => getDb().byId.get(id)!;
const SLOTS = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'];
const slotOf = (c: Card) => SLOTS.find((t) => c.types.includes(t)) ?? 'Other';

/** Does this pool offer any choice (extra equipment for a slot, too many weapons, or more cards than the minimum)? */
export function poolHasChoices(pool: DeckList, minDeck: number): boolean {
  const slots = new Map<string, number>();
  for (const id of pool.equipmentIds) slots.set(slotOf(C(id)), (slots.get(slotOf(C(id))) ?? 0) + 1);
  const hands = pool.weaponIds.reduce((a, id) => a + (C(id).types.includes('2H') ? 2 : 1), 0) + (slots.get('Off-Hand') ?? 0);
  return [...slots.values()].some((n) => n > 1) || hands > 2 || pool.cardIds.length > minDeck;
}

/** Choose the equipment, weapons and main-deck cards for this game from your card pool. */
export function Loadout({ pool, minDeck, maxDeck, title, onDone }: { pool: DeckList; minDeck: number; maxDeck: number; title: string; onDone: (d: DeckList) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of pool.cardIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [pool]);
  const [inDeck, setInDeck] = useState<Map<string, number>>(() => {
    // start with the whole pool (up to the maximum), the usual choice
    const m = new Map<string, number>();
    let n = 0;
    for (const [id, c] of counts) { const take = Math.min(c, Math.max(0, maxDeck - n)); if (take) m.set(id, take); n += take; }
    return m;
  });
  const [equip, setEquip] = useState<Set<string>>(() => {
    const chosen = new Set<string>();
    const taken = new Set<string>();
    for (const id of pool.equipmentIds) { const sl = slotOf(C(id)); if (sl === 'Other' || !taken.has(sl)) { chosen.add(id); taken.add(sl); } }
    return chosen;
  });
  const [weapons, setWeapons] = useState<string[]>(() => {
    const out: string[] = [];
    let hands = 0;
    for (const id of pool.weaponIds) { const h = C(id).types.includes('2H') ? 2 : 1; if (hands + h <= 2) { out.push(id); hands += h; } }
    return out;
  });
  const total = [...inDeck.values()].reduce((a, b) => a + b, 0);
  const hands = weapons.reduce((a, id) => a + (C(id).types.includes('2H') ? 2 : 1), 0) + [...equip].filter((id) => slotOf(C(id)) === 'Off-Hand').length;
  const ok = total >= minDeck && total <= maxDeck && hands <= 2;
  const toggleEquip = (id: string) => {
    const sl = slotOf(C(id));
    const next = new Set([...equip].filter((x) => sl === 'Other' || slotOf(C(x)) !== sl));
    if (!equip.has(id)) next.add(id);
    setEquip(next);
  };
  const setCount = (id: string, n: number) => { const m = new Map(inDeck); if (n <= 0) m.delete(id); else m.set(id, n); setInDeck(m); };
  const done = () => onDone({
    heroId: pool.heroId, weaponIds: weapons, equipmentIds: [...equip],
    cardIds: [...inDeck.entries()].flatMap(([id, n]) => Array(n).fill(id) as string[]),
  });
  return (
    <div className="modal-bg">
      <div className="modal loadout" style={{ maxWidth: 980 }}>
        <h2 style={{ marginBottom: '.2rem' }}>{title}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Choose your equipment (one per slot), your weapons (two hands) and the cards for this game. Cards you leave out stay in your sideboard.</p>
        <div className="lobby-label">Weapons &amp; equipment <span className={hands > 2 ? 'err' : 'muted'}>({hands}/2 hands)</span></div>
        <div className="loadout-row">
          {pool.weaponIds.map((id, i) => (
            <button key={id + i} className={`lo-card ${weapons.includes(id) ? 'on' : ''}`} onClick={() => setWeapons(weapons.includes(id) ? weapons.filter((w) => w !== id) : [...weapons, id])}>
              <CardView card={C(id)} width={86} tilt={false} noPopout /><span className="small">Weapon</span>
            </button>
          ))}
          {pool.equipmentIds.map((id, i) => (
            <button key={id + i} className={`lo-card ${equip.has(id) ? 'on' : ''}`} onClick={() => toggleEquip(id)}>
              <CardView card={C(id)} width={86} tilt={false} noPopout /><span className="small">{slotOf(C(id))}</span>
            </button>
          ))}
        </div>
        <div className="lobby-label">Deck <span className={ok ? 'ok' : 'err'}>{total} cards (need {minDeck === maxDeck ? minDeck : `${minDeck}–${maxDeck}`})</span></div>
        <div className="loadout-cards">
          {[...counts.entries()].sort((a, b) => C(a[0]).name.localeCompare(C(b[0]).name)).map(([id, max]) => {
            const n = inDeck.get(id) ?? 0;
            return (
              <div key={id} className={`dl-row ${n === 0 ? 'sideboard' : ''}`}>
                {C(id).pitch && <span className={`pitch-${C(id).pitch}`}><span className="dot" /></span>}
                <span className="nm">{C(id).name}</span>
                <button onClick={() => setCount(id, n - 1)} disabled={n === 0}>−</button>
                <b>{n}</b><span className="small muted">/{max}</span>
                <button onClick={() => setCount(id, n + 1)} disabled={n >= max}>+</button>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: '.8rem', justifyContent: 'flex-end' }}>
          <button className="primary" disabled={!ok} onClick={done}>Ready</button>
        </div>
      </div>
    </div>
  );
}

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** Roll a die each; the winner chooses to go first or second. `chooser` skips the roll (the loser of the last game chooses). */
export function DiceRoll({ names, chooser, onDone }: { names: [string, string]; chooser?: PlayerId; onDone: (first: PlayerId) => void }) {
  const [rolls, setRolls] = useState<[number, number] | null>(null);
  const [spinning, setSpinning] = useState(chooser === undefined);
  const [face, setFace] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (chooser !== undefined) return;
    const spin = setInterval(() => setFace([Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)]), 70);
    const stop = setTimeout(() => {
      clearInterval(spin);
      let a = 0, b = 0;
      while (a === b) { a = 1 + Math.floor(Math.random() * 6); b = 1 + Math.floor(Math.random() * 6); } // ties are re-rolled
      setRolls([a, b]);
      setFace([a - 1, b - 1]);
      setSpinning(false);
    }, 1100);
    return () => { clearInterval(spin); clearTimeout(stop); };
  }, [chooser]);
  const winner: PlayerId | null = chooser ?? (rolls ? (rolls[0] > rolls[1] ? 0 : 1) : null);
  // the bot always chooses to go first
  useEffect(() => {
    if (winner !== 1) return;
    const t = setTimeout(() => onDone(1), 1300);
    return () => clearTimeout(t);
  }, [winner, onDone]);
  return (
    <div className="modal-bg">
      <div className="modal dice" style={{ maxWidth: 440, textAlign: 'center' }}>
        <h2 style={{ marginBottom: '.4rem' }}>{chooser === undefined ? 'Roll for first turn' : 'Next game'}</h2>
        {chooser === undefined && (
          <div className="dice-row">
            <div><div className={`die ${spinning ? 'spin' : ''}`}>{FACES[face[0]]}</div><span className="small">{names[0]}</span></div>
            <div><div className={`die ${spinning ? 'spin' : ''}`}>{FACES[face[1]]}</div><span className="small">{names[1]}</span></div>
          </div>
        )}
        {winner === 0 && (
          <>
            <p>{chooser === undefined ? 'You rolled higher!' : 'You lost the last game, so you choose.'} Go first or second?</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="primary" onClick={() => onDone(0)}>Go first</button>
              <button onClick={() => onDone(1)}>Go second</button>
            </div>
          </>
        )}
        {winner === 1 && <p>{names[1]} {chooser === undefined ? 'rolled higher' : 'lost the last game'} and chooses to go first.</p>}
      </div>
    </div>
  );
}
