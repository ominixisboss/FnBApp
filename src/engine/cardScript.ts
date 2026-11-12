// Turns a card's printed rules text into a small script the engine can execute.
// Flesh and Blood has thousands of unique effects; this compiler recognises the
// most common templated sentences. Anything it does not understand is reported in
// `unparsed` so the UI can tell the player which text needs manual handling.
import type { Card } from '../data/types';

export type AttackFilter =
  | { kind: 'any' }
  | { kind: 'attackAction' }
  | { kind: 'weapon' }
  | { kind: 'subtype'; value: string } // dagger, sword, arrow, ...
  | { kind: 'class'; value: string } // Warrior, Ninja, ...
  | { kind: 'anyClass'; values: string[] }; // "Assassin or Mystic"

export type Effect =
  | { kind: 'arcane'; amount: number }
  | { kind: 'damage'; amount: number }
  | { kind: 'gainLife'; amount: number }
  | { kind: 'loseLifeOpp'; amount: number }
  | { kind: 'draw'; amount: number }
  | { kind: 'gainResource'; amount: number }
  | { kind: 'nextAttackPower'; amount: number; filter: AttackFilter }
  | { kind: 'nextAttackGoAgain'; filter: AttackFilter }
  | { kind: 'targetAttackPower'; amount: number; filter: AttackFilter }
  | { kind: 'targetAttackGoAgain'; filter: AttackFilter }
  | { kind: 'thisPower'; amount: number }
  | { kind: 'thisGoAgain' }
  | { kind: 'thisDominate' }
  | { kind: 'thisDefense'; amount: number }
  | { kind: 'preventNext'; amount: number }
  | { kind: 'createToken'; name: string; amount: number }
  | { kind: 'banishTopOpp'; amount: number }
  | { kind: 'oppDiscardRandom'; amount: number }
  | { kind: 'intimidate' }
  | { kind: 'opt'; amount: number }
  | { kind: 'mark' }
  | { kind: 'ampArcane'; amount: number }
  | { kind: 'weakenAttack'; amount: number };

export interface Conditional {
  when: 'fromArsenal' | 'combo' | 'crush';
  /** combo: name of the card that must have been the previous attack */
  comboWith?: string;
  effects: Effect[];
}

export interface Activation {
  cost: number;
  attack: boolean;
  instant: boolean;
  oncePerTurn: boolean;
  destroySelf: boolean;
  goAgain: boolean;
  effects: Effect[];
  text: string;
}

export interface Mode {
  label: string;
  onPlay: Effect[];
  onAttack: Effect[];
  onHit: Effect[];
  parsed: boolean;
}

export interface CardScript {
  goAgain: boolean;
  dominate: boolean;
  overpower: boolean;
  piercing: number;
  ward: number;
  arcaneBarrier: number;
  spellvoid: number;
  battleworn: boolean;
  bladeBreak: boolean;
  temper: boolean;
  boost: boolean;
  phantasm: boolean;
  steam: number; // enters the arena with N steam counters
  steamUpkeep: boolean; // start of turn: destroy unless you remove a steam counter
  destroyAt?: 'actionPhase' | 'startOfTurn';
  bloodDebt: boolean;
  costLessPer?: string; // token name: "costs {r} less for each X you control"
  intimidateOnAttack: boolean;
  additionalCost: { discardRandom?: number; banishRandomHand?: number; banishGraveyard?: number };
  onPlay: Effect[]; // resolution of non-attacks, or "when you play this" for attacks
  onAttack: Effect[];
  onHit: Effect[];
  conditional: Conditional[];
  activations: Activation[];
  modes: Mode[]; // "Choose 1;" options
  unparsed: string[];
  coverage: 'full' | 'partial' | 'none';
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const toNum = (s: string) => (s in NUM ? NUM[s] : Number(s));

const SUBTYPES = [
  'dagger', 'sword', 'arrow', 'axe', 'hammer', 'club', 'claw', 'scepter', 'staff', 'bow', 'gun',
  'pistol', 'flail', 'polearm', 'scythe',
];
const CLASS_WORDS = [
  'Warrior', 'Guardian', 'Ninja', 'Brute', 'Assassin', 'Ranger', 'Runeblade', 'Mechanologist',
  'Wizard', 'Illusionist', 'Pirate', 'Draconic', 'Light', 'Shadow', 'Earth', 'Ice', 'Lightning', 'Mystic', 'Royal',
];

function parseFilter(words: string): AttackFilter | null {
  const w = words.trim();
  if (w === '') return { kind: 'any' };
  if (/^weapon$/i.test(w)) return { kind: 'weapon' };
  const sub = SUBTYPES.find((s) => w.toLowerCase() === s);
  if (sub) return { kind: 'subtype', value: sub };
  const cls = CLASS_WORDS.find((c) => w === c);
  if (cls) return { kind: 'class', value: cls };
  const either = w.split(/\s+or\s+/);
  if (either.length > 1 && either.every((x) => CLASS_WORDS.includes(x))) return { kind: 'anyClass', values: either };
  return null;
}

/** Parse one effect clause such as "Draw a card" into effects. */
export function parseEffect(raw: string): Effect[] | null {
  const s = raw.trim().replace(/\.$/, '').trim();
  let m: RegExpMatchArray | null;
  if (!s) return [];
  // compound "X and Y" / "X, then Y"
  const parts = s.split(/,? then |\. Then /i);
  if (parts.length > 1) {
    const out: Effect[] = [];
    for (const p of parts) {
      const e = parseEffect(p);
      if (!e) return null;
      out.push(...e);
    }
    return out;
  }
  if ((m = s.match(/^deal (\d+) arcane damage to (?:any target|target hero|target opposing hero|each opposing hero|each hero|the defending hero)$/i)))
    return [{ kind: 'arcane', amount: +m[1] }];
  if ((m = s.match(/^deal (\d+) damage to (?:target hero|target opposing hero|any target|the defending hero|each opposing hero)$/i)))
    return [{ kind: 'damage', amount: +m[1] }];
  if ((m = s.match(/^(?:you )?gain (\d+)\{h\}$/i))) return [{ kind: 'gainLife', amount: +m[1] }];
  if ((m = s.match(/^(?:target|each) (?:opposing )?hero loses (\d+)\{h\}$/i)))
    return [{ kind: 'loseLifeOpp', amount: +m[1] }];
  if ((m = s.match(/^(?:you )?draw (a|an|one|two|three|\d+) cards?$/i)))
    return [{ kind: 'draw', amount: toNum(m[1].toLowerCase()) }];
  if ((m = s.match(/^gain ((?:\{r\})+)$/i)))
    return [{ kind: 'gainResource', amount: m[1].length / 3 }];
  if ((m = s.match(/^your next (?:(\w+) )?attack this turn gets \+(\d+)\{p\}(?: and go again)?$/i))) {
    const f = parseFilter(m[1] ?? '');
    if (!f) return null;
    const out: Effect[] = [{ kind: 'nextAttackPower', amount: +m[2], filter: f }];
    if (/and go again$/i.test(s)) out.push({ kind: 'nextAttackGoAgain', filter: f });
    return out;
  }
  if ((m = s.match(/^the next attack action card you play this turn gets \+(\d+)\{p\}$/i)))
    return [{ kind: 'nextAttackPower', amount: +m[1], filter: { kind: 'attackAction' } }];
  if ((m = s.match(/^your next (?:(\w+) )?attack this turn gets go again$/i))) {
    const f = parseFilter(m[1] ?? '');
    return f ? [{ kind: 'nextAttackGoAgain', filter: f }] : null;
  }
  if ((m = s.match(/^target (?:(\w+(?: or \w+)?) )?attack(?: action card)? gets \+(\d+)\{p\}(?: and go again)?$/i))) {
    const f = parseFilter(m[1] ?? '');
    if (!f) return null;
    const out: Effect[] = [{ kind: 'targetAttackPower', amount: +m[2], filter: f }];
    if (/and go again$/i.test(s)) out.push({ kind: 'targetAttackGoAgain', filter: f });
    return out;
  }
  if ((m = s.match(/^target (?:(\w+) )?attack(?: action card)? gets go again$/i))) {
    const f = parseFilter(m[1] ?? '');
    return f ? [{ kind: 'targetAttackGoAgain', filter: f }] : null;
  }
  if ((m = s.match(/^(?:this|it) gets \+(\d+)\{p\}(?: and go again)?$/i))) {
    const out: Effect[] = [{ kind: 'thisPower', amount: +m[1] }];
    if (/go again$/i.test(s)) out.push({ kind: 'thisGoAgain' });
    return out;
  }
  if (/^(?:this|it) gets go again$/i.test(s)) return [{ kind: 'thisGoAgain' }];
  if (/^(?:this|it) gets dominate$/i.test(s)) return [{ kind: 'thisDominate' }];
  if ((m = s.match(/^(?:this|it) gets \+(\d+)\{d\}$/i))) return [{ kind: 'thisDefense', amount: +m[1] }];
  if ((m = s.match(/^the next time you would be dealt damage this turn, prevent (\d+) of that damage$/i)))
    return [{ kind: 'preventNext', amount: +m[1] }];
  if ((m = s.match(/^prevent the next (\d+) damage that would be dealt to you this turn$/i)))
    return [{ kind: 'preventNext', amount: +m[1] }];
  if ((m = s.match(/^create (a|an|two|three|\d+) ([A-Z][\w' ]*?) tokens?$/i)))
    return [{ kind: 'createToken', name: m[2], amount: toNum(m[1].toLowerCase()) }];
  if ((m = s.match(/^banish the top (?:(\d+) )?cards? of (?:their|the defending hero's|target hero's) deck$/i)))
    return [{ kind: 'banishTopOpp', amount: m[1] ? +m[1] : 1 }];
  if ((m = s.match(/^(?:they|the defending hero|target hero|target opposing hero|each opposing hero) discards? (a|two|\d+) (?:random )?cards?$/i)))
    return [{ kind: 'oppDiscardRandom', amount: toNum(m[1].toLowerCase()) }];
  if (/^intimidate$/i.test(s)) return [{ kind: 'intimidate' }];
  if ((m = s.match(/^opt (\d+)$/i))) return [{ kind: 'opt', amount: +m[1] }];
  if (/^mark (?:them|the defending hero|target hero)$/i.test(s)) return [{ kind: 'mark' }];
  if ((m = s.match(/^the next card you play this turn with an arcane damage effect,? (?:instead )?deals that much arcane damage plus (\d+)$/i)))
    return [{ kind: 'ampArcane', amount: +m[1] }];
  if ((m = s.match(/^your next arcane damage effect this turn deals \+?(\d+) more$/i))) return [{ kind: 'ampArcane', amount: +m[1] }];
  if ((m = s.match(/^target attack(?: action card)? gets -(\d+)\{p\}$/i))) return [{ kind: 'weakenAttack', amount: +m[1] }];
  // "X and Y"
  const and = s.split(/ and (?=(?:draw|gain|create|deal|you gain|you draw)\b)/i);
  if (and.length > 1) {
    const out: Effect[] = [];
    for (const p of and) {
      const e = parseEffect(p);
      if (!e) return null;
      out.push(...e);
    }
    return out;
  }
  return null;
}

function emptyScript(): CardScript {
  return {
    goAgain: false, dominate: false, overpower: false, piercing: 0, ward: 0, arcaneBarrier: 0,
    spellvoid: 0, battleworn: false, bladeBreak: false, temper: false, boost: false, phantasm: false, bloodDebt: false, steam: 0, steamUpkeep: false,
    intimidateOnAttack: false, additionalCost: {}, onPlay: [], onAttack: [], onHit: [],
    conditional: [], activations: [], modes: [], unparsed: [], coverage: 'full',
  };
}

const cache = new Map<string, CardScript>();

export function getScript(c: Card): CardScript {
  let s = cache.get(c.id);
  if (!s) {
    s = compile(c);
    cache.set(c.id, s);
  }
  return s;
}

function keywordSentence(sc: CardScript, sentence: string): boolean {
  let m: RegExpMatchArray | null;
  const s = sentence.replace(/\.$/, '').trim();
  if (/^go again$/i.test(s)) return (sc.goAgain = true);
  if (/^dominate$/i.test(s)) return (sc.dominate = true);
  if (/^overpower$/i.test(s)) return (sc.overpower = true);
  if (/^battleworn$/i.test(s)) return (sc.battleworn = true);
  if (/^blade break$/i.test(s)) return (sc.bladeBreak = true);
  if (/^temper$/i.test(s)) return (sc.temper = true);
  if (/^boost$/i.test(s)) return (sc.boost = true);
  if (/^intimidate$/i.test(s)) return (sc.intimidateOnAttack = true);
  if (/^legendary$/i.test(s) || /^specialization$/i.test(s) || /specialization$/i.test(s)) return true;
  if (/^stealth$/i.test(s)) return true; // only referenced by other effects
  if (/^phantasm$/i.test(s)) return (sc.phantasm = true);
  if (/^blood debt$/i.test(s)) return (sc.bloodDebt = true);
  if ((m = s.match(/^this enters the arena with (a|an|one|two|three|\d+) steam counters?$/i))) return !!(sc.steam = toNum(m[1].toLowerCase()));
  if (/^at the start of your turn, destroy this unless you remove a steam counter from it$/i.test(s)) return (sc.steamUpkeep = true);
  if (/^at the beginning of your action phase, destroy this$/i.test(s)) { sc.destroyAt = 'actionPhase'; return true; }
  if (/^at the start of your turn, destroy this$/i.test(s)) { sc.destroyAt = 'startOfTurn'; return true; }
  if ((m = s.match(/^piercing (\d+)$/i))) return !!(sc.piercing = +m[1]);
  if ((m = s.match(/^ward (\d+)$/i))) return !!(sc.ward = +m[1]);
  if ((m = s.match(/^arcane barrier (\d+)$/i))) return !!(sc.arcaneBarrier = +m[1]);
  if ((m = s.match(/^spellvoid (\d+)$/i))) return !!(sc.spellvoid = +m[1]);
  if ((m = s.match(/^opt (\d+)$/i))) {
    sc.onPlay.push({ kind: 'opt', amount: +m[1] });
    return true;
  }
  return false;
}

function compile(c: Card): CardScript {
  const sc = emptyScript();
  const isAttack = c.types.includes('Attack') && c.types.includes('Action');
  const isPermanentLike = ['Equipment', 'Weapon', 'Hero', 'Token', 'Aura', 'Item', 'Ally'].some((t) =>
    c.types.includes(t),
  );
  for (const k of c.keywords) keywordSentence(sc, k);

  // strip reminder text
  const text = c.text.replace(/\([^)]*\)/g, '').trim();
  if (!text) return finish(sc, c);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // modal cards: "Choose 1;" followed by one option per line
    if (/^choose 1;?$/i.test(line)) {
      while (li + 1 < lines.length && /[.!]$/.test(lines[li + 1])) {
        const opt = lines[++li];
        const tmp = emptyScript();
        handleSentence(tmp, opt, false, false);
        const parsed = tmp.unparsed.length === 0;
        sc.modes.push({ label: opt.replace(/\.$/, ''), onPlay: tmp.onPlay, onAttack: tmp.onAttack, onHit: tmp.onHit, parsed });
        if (!parsed) sc.unparsed.push(`(mode) ${opt}`);
      }
      continue;
    }
    // activated abilities: "Once per Turn Action - {r}{r}: Attack", "Instant - Destroy this: ..."
    const act = line.match(/^(once per turn )?(action|instant)\s*[-–]\s*([^:]*):\s*(.+)$/i);
    if (act) {
      const costPart = act[3];
      const extra = costPart.replace(/\{r\}/gi, '').replace(/[,\s]+/g, ' ').trim().toLowerCase();
      const destroySelf = /destroy this/.test(extra);
      const extraOk = ['', 'destroy this', '{t}', '{t} your hero', '{t} your hero destroy this', '{t} destroy this', '0'].includes(extra);
      let body = act[4].trim();
      let goAgain = false;
      if (/\.?\s*go again\.?$/i.test(body) && !/^attack/i.test(body)) {
        goAgain = true;
        body = body.replace(/\.?\s*go again\.?$/i, '');
      }
      const attack = /^attack\b/i.test(body);
      const tail = attack ? body.replace(/^attack\.?/i, '').trim() : '';
      const effects = attack ? [] : parseEffect(body);
      if (extraOk && (attack || effects)) {
        sc.activations.push({
          cost: (costPart.match(/\{r\}/gi) ?? []).length,
          attack,
          instant: /instant/i.test(act[2]),
          oncePerTurn: !!act[1] || attack,
          destroySelf,
          goAgain: goAgain || /go again/i.test(tail),
          effects: effects ?? [],
          text: line,
        });
        if (tail && !/^go again\.?$/i.test(tail)) sc.unparsed.push(tail);
        continue;
      }
      sc.unparsed.push(line);
      continue;
    }
    const sentences = line.split(/(?<=\.)\s+(?=[A-Z])/);
    for (const sent of sentences) handleSentence(sc, sent.trim(), isAttack, isPermanentLike);
  }
  return finish(sc, c);
}

function handleSentence(sc: CardScript, sent: string, isAttack: boolean, isPermanentLike: boolean) {
  if (!sent) return;
  if (keywordSentence(sc, sent)) return;
  let m: RegExpMatchArray | null;
  // keyword lists like "Go again, Dominate"
  if (/^[A-Z][a-z]+( [a-z0-9]+)?(, [A-Z][a-z]+( [a-z0-9]+)?)+\.?$/.test(sent)) {
    const parts = sent.replace(/\.$/, '').split(', ');
    if (parts.every((p) => keywordSentence(emptyScript(), p))) {
      parts.forEach((p) => keywordSentence(sc, p));
      return;
    }
  }
  if ((m = sent.match(/^(?:when|if) this hits(?: a hero)?, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onHit.push(...e);
  }
  if ((m = sent.match(/^(?:when this attacks|when you attack with this|when this attacks a hero), (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onAttack.push(...e);
  }
  if ((m = sent.match(/^when you play this,? (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onPlay.push(...e);
  }
  if ((m = sent.match(/^combo - if (.+?) was the last attack this combat chain, (.+)$/i))) {
    const e = parseEffect(m[2]);
    if (e) return void sc.conditional.push({ when: 'combo', comboWith: m[1].trim(), effects: e });
  }
  if ((m = sent.match(/^crush - when this deals 4 or more damage to a hero, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.conditional.push({ when: 'crush', effects: e });
  }
  if (/^this costs \{r\} less to play for each runechant you control\.?$/i.test(sent)) {
    sc.costLessPer = 'Runechant';
    return;
  }
  if ((m = sent.match(/^as an additional cost to play this, banish (a|two|three|\d+) random cards? from your graveyard\.?$/i))) {
    sc.additionalCost.banishGraveyard = toNum(m[1].toLowerCase());
    return;
  }
  if ((m = sent.match(/^if this (?:was|is) played from (?:your )?arsenal, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.conditional.push({ when: 'fromArsenal', effects: e });
  }
  if ((m = sent.match(/^as an additional cost to play this, discard (a|two|\d+) random cards?\.?$/i))) {
    sc.additionalCost.discardRandom = toNum(m[1].toLowerCase());
    return;
  }
  if ((m = sent.match(/^as an additional cost to play this, banish (a|two|\d+) random cards? from your hand\.?$/i))) {
    sc.additionalCost.banishRandomHand = toNum(m[1].toLowerCase());
    return;
  }
  if (!isAttack && !isPermanentLike) {
    const e = parseEffect(sent);
    if (e) return void sc.onPlay.push(...e);
  }
  sc.unparsed.push(sent);
}

function finish(sc: CardScript, c: Card): CardScript {
  const meaningful = c.text.trim().length > 0;
  if (!meaningful || sc.unparsed.length === 0) sc.coverage = 'full';
  else {
    const parsedSomething =
      sc.onPlay.length + sc.onHit.length + sc.onAttack.length + sc.conditional.length + sc.activations.length + sc.modes.length > 0 ||
      sc.goAgain || sc.dominate || sc.ward > 0;
    sc.coverage = parsedSomething ? 'partial' : 'none';
  }
  return sc;
}

export function describeFilter(f: AttackFilter): string {
  switch (f.kind) {
    case 'any': return 'attack';
    case 'attackAction': return 'attack action card';
    case 'weapon': return 'weapon attack';
    case 'subtype': return `${f.value} attack`;
    case 'class': return `${f.value} attack`;
    case 'anyClass': return `${f.values.join(' or ')} attack`;
  }
}
