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
  | { kind: 'weakenAttack'; amount: number }
  | { kind: 'thisOverpower' }
  | { kind: 'tutor'; name: string }
  | { kind: 'sharpen'; times: number };

/** A game-state condition from "If <condition>, ..." sentences. */
export type Condition =
  | { kind: 'auraThisTurn' }
  | { kind: 'lessLife' }
  | { kind: 'draconicLinks'; n: number }
  | { kind: 'arcaneThisTurn' }
  | { kind: 'powerAboveBase' }
  | { kind: 'instantThisLink' }
  | { kind: 'defendedByFewer'; n: number }
  | { kind: 'powerAtLeast'; n: number }
  | { kind: 'reactionsThisLink'; n: number }
  | { kind: 'discardedPower'; n: number }
  | { kind: 'hitWithDagger' }
  | { kind: 'defendedByAction' }
  | { kind: 'earthBanished'; n: number }
  | { kind: 'drew' }
  | { kind: 'itemDestroyed' }
  | { kind: 'pitchColor'; pitch: number }
  | { kind: 'pitchPower'; n: number }
  | { kind: 'lastDraconic' }
  | { kind: 'controls'; name: string }
  | { kind: 'aurasAtLeast'; n: number }
  | { kind: 'anotherBlue' }
  | { kind: 'attackingMarked' }
  | { kind: 'weaponAttacked' }
  | { kind: 'intimidated' }
  | { kind: 'attackedTimes'; n: number }
  | { kind: 'playedNonAttack' };

/** Conditions that depend on how the chain link went: checked just before damage. */
export const LINK_CONDITIONS = new Set<Condition['kind']>(['powerAboveBase', 'instantThisLink', 'defendedByFewer', 'powerAtLeast', 'reactionsThisLink', 'defendedByAction']);

export type OptionalCostKind =
  | { kind: 'reveal'; talent: string } // Fusion: reveal an Ice / Earth / Lightning card from hand
  | { kind: 'charge'; pitch?: number } // put a card from hand into your hero's soul
  | { kind: 'discard'; pitch?: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'banishGrave'; n: number }
  | { kind: 'destroyTop' }
  | { kind: 'handToBottom' }
  | { kind: 'banishHand' }
  | { kind: 'discardOrTop' }
  | { kind: 'destroyOwn'; name?: string; type?: string };

/** "When this attacks, you may <cost>. If you do, <effects>." */
export interface OptionalCost {
  timing: 'play' | 'attack' | 'defend';
  cost: OptionalCostKind;
  /** "If a card with N or more {p} is discarded this way" */
  minPower?: number;
  effects: Effect[];
  costText: string;
  effectText: string;
}

export interface Conditional {
  when: 'fromArsenal' | 'fromBanished' | 'combo' | 'crush' | 'if' | 'ifLink' | 'surge';
  cond?: Condition;
  /** surge: "if this deals more than N damage" */
  threshold?: number;
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
  costLessPer?: string; // token name ("Runechant") or 'draconicLink': "costs {r} less for each X you control"
  intimidateOnAttack: boolean;
  additionalCost: { discardRandom?: number; banishRandomHand?: number; banishGraveyard?: number };
  onPlay: Effect[]; // resolution of non-attacks, or "when you play this" for attacks
  onAttack: Effect[];
  onHit: Effect[];
  conditional: Conditional[];
  activations: Activation[];
  modes: Mode[]; // "Choose 1;" options
  optional?: OptionalCost;
  /** "Instant - Discard this: <effect>" usable from hand */
  handActivation?: { cost: number; effects: Effect[]; text: string };
  /** "(If <condition>, ) you may play this from your banished zone" */
  fromBanished?: { cond?: Condition };
  onDestroy: Effect[];
  noEquipDefense: boolean;
  /** where the attack card goes when it hits ("put it into your soul" / "on the bottom of its owner's deck") */
  hitDestination?: 'soul' | 'deckBottom';
  costLessIf?: string; // "If you control a <X>, this costs {r} less"
  unity: number; // "Unity - ... this gets +N{d}"
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
  const parts = s.split(/,? then |\. Then |\.\s+(?=[A-Z])/i);
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
  if ((m = s.match(/^your next (?:([\w ]+?) )?attack this turn gets \+(\d+)\{p\}(?: and go again)?$/i))) {
    const f = parseFilter(m[1] ?? '');
    if (!f) return null;
    const out: Effect[] = [{ kind: 'nextAttackPower', amount: +m[2], filter: f }];
    if (/and go again$/i.test(s)) out.push({ kind: 'nextAttackGoAgain', filter: f });
    return out;
  }
  if ((m = s.match(/^the next attack action card you play this turn gets \+(\d+)\{p\}$/i)))
    return [{ kind: 'nextAttackPower', amount: +m[1], filter: { kind: 'attackAction' } }];
  if ((m = s.match(/^your next (?:([\w ]+?) )?attack this turn gets go again$/i))) {
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
  if (/^(?:this|it) gets overpower$/i.test(s)) return [{ kind: 'thisOverpower' }];
  if ((m = s.match(/^(?:they|the defending hero|that hero) loses? (\d+)\{h\}$/i))) return [{ kind: 'loseLifeOpp', amount: +m[1] }];
  if ((m = s.match(/^search your deck for (?:a|an) ([A-Z][\w' ,:-]+?), reveal it, put it into your hand,? (?:and|then) shuffle$/i)))
    return [{ kind: 'tutor', name: m[1].trim() }];
  if ((m = s.match(/^amp (\d+)$/i))) return [{ kind: 'ampArcane', amount: +m[1] }];
  if (/^mark target opposing hero$/i.test(s)) return [{ kind: 'mark' }];
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
  if ((m = s.match(/^sharpen target sword you control( twice)?$/i))) return [{ kind: 'sharpen', times: m[1] ? 2 : 1 }];
  if ((m = s.match(/^the next (?:([\w ]+?) )?attack action card you play this turn gets \+(\d+)\{p\}$/i))) {
    const f = m[1] ? parseFilter(m[1]) : { kind: 'attackAction' as const };
    if (f) return [{ kind: 'nextAttackPower', amount: +m[2], filter: f }];
  }
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

const titleCase = (x: string) => x.trim().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseCondition(raw: string): Condition | null {
  const t = raw.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if (/^you've played or created an aura this turn$/.test(t)) return { kind: 'auraThisTurn' };
  if (/^you have less \{h\} than an opposing hero$/.test(t)) return { kind: 'lessLife' };
  if ((m = t.match(/^you control (\d+) or more draconic chain links$/))) return { kind: 'draconicLinks', n: +m[1] };
  if (/^you've dealt arcane damage(?: to an opponent| to an opposing hero)? this turn$/.test(t)) return { kind: 'arcaneThisTurn' };
  if (/^this(?: card's)? (?:has )?\{p\} (?:is )?greater than its base$/.test(t) || /^this has \{p\} greater than its base$/.test(t)) return { kind: 'powerAboveBase' };
  if (/^you've played an instant card this chain link$/.test(t)) return { kind: 'instantThisLink' };
  if ((m = t.match(/^this is defended by fewer than (\d+) non-equipment cards$/))) return { kind: 'defendedByFewer', n: +m[1] };
  if ((m = t.match(/^this has (\d+) or more \{p\}$/))) return { kind: 'powerAtLeast', n: +m[1] };
  if ((m = t.match(/^you've played or activated (an|\d+ or more) attack reactions? this chain link$/))) return { kind: 'reactionsThisLink', n: m[1] === 'an' ? 1 : parseInt(m[1], 10) };
  if ((m = t.match(/^you've discarded a card with (\d+) or more \{p\} this turn$/))) return { kind: 'discardedPower', n: +m[1] };
  if (/^you've hit with a dagger this combat chain$/.test(t)) return { kind: 'hitWithDagger' };
  if (/^this is defended by an action card$/.test(t)) return { kind: 'defendedByAction' };
  if ((m = t.match(/^there are (\d+) or more earth cards in your banished zone$/))) return { kind: 'earthBanished', n: +m[1] };
  if (/^you've drawn a card this turn$/.test(t)) return { kind: 'drew' };
  if (/^an item you control has been destroyed this turn$/.test(t)) return { kind: 'itemDestroyed' };
  if ((m = t.match(/^you have a (red|yellow|blue) card in your pitch zone$/))) return { kind: 'pitchColor', pitch: { red: 1, yellow: 2, blue: 3 }[m[1] as 'red'] };
  if (/^you've pitched a blue card this turn$/.test(t)) return { kind: 'pitchColor', pitch: 3 };
  if ((m = t.match(/^there is a card with (\d+) or more \{p\} in your pitch zone$/))) return { kind: 'pitchPower', n: +m[1] };
  if (/^a draconic attack was the last attack this combat chain$/.test(t)) return { kind: 'lastDraconic' };
  if ((m = t.match(/^you control (\d+) or more auras$/))) return { kind: 'aurasAtLeast', n: +m[1] };
  if ((m = t.match(/^you control (?:a|an) ([a-z' ]+)$/))) return { kind: 'controls', name: titleCase(m[1]) };
  if (/^you've played another blue card this turn$/.test(t)) return { kind: 'anotherBlue' };
  if (/^this is attacking a marked hero$/.test(t)) return { kind: 'attackingMarked' };
  if (/^you've attacked with a weapon this turn$/.test(t)) return { kind: 'weaponAttacked' };
  if (/^you've intimidated an opponent this turn$/.test(t)) return { kind: 'intimidated' };
  if ((m = t.match(/^you've been attacked (\d+) or more times this turn$/))) return { kind: 'attackedTimes', n: +m[1] };
  if (/^you've played a non-attack action card this turn$/.test(t)) return { kind: 'playedNonAttack' };
  return null;
}

function parseOptionalCost(raw: string): OptionalCostKind | null {
  const t = raw.trim().toLowerCase().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^discard (?:a|an) (?:(red|yellow|blue) )?card$/))) return { kind: 'discard', pitch: m[1] ? { red: 1, yellow: 2, blue: 3 }[m[1] as 'red'] : undefined };
  if ((m = t.match(/^pay ((?:\{r\})+)$/))) return { kind: 'pay', amount: m[1].length / 3 };
  if ((m = t.match(/^banish (a|an|two|three|\d+) cards? from your graveyard$/))) return { kind: 'banishGrave', n: toNum(m[1]) };
  if (/^destroy the top card of your deck$/.test(t)) return { kind: 'destroyTop' };
  if (/^charge your (?:hero's )?soul$/.test(t)) return { kind: 'charge' };
  if (/^put a card from your hand on the bottom of your deck$/.test(t)) return { kind: 'handToBottom' };
  if (/^banish a card from your hand$/.test(t)) return { kind: 'banishHand' };
  if (/^discard a card or destroy the top card of your deck$/.test(t)) return { kind: 'discardOrTop' };
  if ((m = t.match(/^destroy (?:a|an) (item|aura) you control$/))) return { kind: 'destroyOwn', type: m[1] === 'item' ? 'Item' : 'Aura' };
  if ((m = t.match(/^destroy (?:a|an) ([a-z' ]+) you control$/))) return { kind: 'destroyOwn', name: titleCase(m[1]) };
  return null;
}

/** "When this attacks, you may discard a card." + "If you do, this gets go again." */
export function parseOptional(a: string, b: string): OptionalCost | null {
  const ma = a.replace(/^(galvanize|decompose) - /i, '').match(/^(when this attacks|when you play this|as an additional cost to play this|when this defends),? you may (.+?)\.?$/i);
  if (!ma) return null;
  const cost = parseOptionalCost(ma[2]);
  if (!cost) return null;
  const mb = b.match(/^if (you do|the additional cost (?:was|is) paid|a card with (\d+) or more \{p\} is (?:discarded|banished) this way|the discarded card has (\d+) or more \{p\}|an? (red|yellow|blue) card is charged this way|you charged your (?:hero's )?soul this way),? (.+?)\.?$/i);
  if (!mb) return null;
  const effectText = mb[5];
  const effects = parseEffect(effectText);
  if (!effects) return null;
  const minPower = mb[2] ? +mb[2] : mb[3] ? +mb[3] : undefined;
  // "If a yellow card is charged this way": the charged card must be that colour
  const finalCost: OptionalCostKind = mb[4] && cost.kind === 'charge' ? { kind: 'charge', pitch: { red: 1, yellow: 2, blue: 3 }[mb[4].toLowerCase() as 'red'] } : cost;
  return {
    timing: /defends/i.test(ma[1]) ? 'defend' : /attacks/i.test(ma[1]) ? 'attack' : 'play', cost: finalCost, minPower, effects,
    costText: ma[2].replace(/\.$/, ''), effectText: effectText.replace(/\.$/, ''),
  };
}

function emptyScript(): CardScript {
  return {
    goAgain: false, dominate: false, overpower: false, piercing: 0, ward: 0, arcaneBarrier: 0,
    spellvoid: 0, battleworn: false, bladeBreak: false, temper: false, boost: false, phantasm: false, bloodDebt: false, steam: 0, steamUpkeep: false,
    intimidateOnAttack: false, additionalCost: {}, onPlay: [], onAttack: [], onHit: [],
    conditional: [], activations: [], modes: [], unparsed: [], coverage: 'full',
    onDestroy: [], noEquipDefense: false, unity: 0,
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
  if ((m = s.match(/^amp (\d+)$/i))) {
    sc.onPlay.push({ kind: 'ampArcane', amount: +m[1] });
    return true;
  }
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
  let fusion: string | null = null;

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
      if (/^(\{r\}\s*)*discard this$/i.test(costPart.replace(/,/g, ' ').trim())) {
        const body = act[4].trim().replace(/\.$/, '');
        const effects = parseEffect(body);
        if (effects && /instant/i.test(act[2])) {
          sc.handActivation = { cost: (costPart.match(/\{r\}/gi) ?? []).length, effects, text: line };
          continue;
        }
      }
      const extraOk = ['', 'destroy this', '{t}', '{t} your hero', '{t} your hero destroy this', '{t} destroy this', '0'].includes(extra);
      // "Activate this only while ..." timing limits are simplified away (the ability can be used at any instant speed)
      let body = act[4].trim().replace(/\s*Activate this only (?:while|if|during) [^.]*\.?$/i, '');
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
    // Fusion keyword line ("Ice Fusion"): the payoff is the "If this was fused, ..." sentence
    const fus = line.match(/^(ice|earth|lightning) fusion$/i);
    if (fus) { fusion = fus[1][0].toUpperCase() + fus[1].slice(1).toLowerCase(); continue; }
    const fused = line.match(/^if this (?:was|is) fused, (.+?)\.?$/i);
    if (fused && fusion && !sc.optional) {
      const effects = parseEffect(fused[1]);
      if (effects) {
        sc.optional = { timing: 'play', cost: { kind: 'reveal', talent: fusion }, effects, costText: `reveal ${/^[aeiou]/i.test(fusion) ? 'an' : 'a'} ${fusion} card from your hand (fuse)`, effectText: fused[1] };
        continue;
      }
    }
    const sentences = line.split(/(?<=\.)\s+(?=[A-Z])/).map((x) => x.trim());
    // an optional cost on one line and its "If you do, ..." on the next
    if (li + 1 < lines.length && !sc.optional) {
      const nextFirst = lines[li + 1].split(/(?<=\.)\s+(?=[A-Z])/)[0];
      const crossed = parseOptional(sentences[sentences.length - 1], nextFirst);
      if (crossed) {
        sc.optional = crossed;
        sentences.pop();
        lines[li + 1] = lines[li + 1].slice(nextFirst.length).trim();
        if (!lines[li + 1]) lines.splice(li + 1, 1);
      }
    }
    for (let i = 0; i < sentences.length; i++) {
      const opt = i + 1 < sentences.length ? parseOptional(sentences[i], sentences[i + 1]) : null;
      if (opt && !sc.optional) {
        sc.optional = opt;
        i++;
        continue;
      }
      handleSentence(sc, sentences[i], isAttack, isPermanentLike);
    }
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
  if ((m = sent.match(/^(?:if (.+?), )?you may play this from your banished zone\.?$/i))) {
    const cond = m[1] ? parseCondition(m[1]) : undefined;
    if (!m[1] || cond) return void (sc.fromBanished = { cond: cond ?? undefined });
  }
  if ((m = sent.match(/^when this is played from your banished zone, (.+)$/i))) {
    const e = parseEffect(m[1].replace(/^it gets/i, 'this gets'));
    if (e) return void sc.conditional.push({ when: 'fromBanished', effects: e });
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
  if ((m = sent.match(/^surge - if this deals more than (\d+) damage, (.+)$/i))) {
    const e = parseEffect(m[2]);
    if (e) return void sc.conditional.push({ when: 'surge', threshold: +m[1], effects: e });
  }
  if ((m = sent.match(/^unity - when this defends together with a card from hand, this gets \+(\d+)\{d\}(?: until end of turn)?\.?$/i))) {
    sc.unity = +m[1];
    return;
  }
  if (/^when this hits(?: a hero)?, put it into your soul\.?$/i.test(sent)) { sc.hitDestination = 'soul'; return; }
  if (/^when this hits(?: a hero)?, put it on the bottom of its owner's deck\.?$/i.test(sent)) { sc.hitDestination = 'deckBottom'; return; }
  if (/^this can't be defended by equipment\.?$/i.test(sent)) { sc.noEquipDefense = true; return; }
  if (/^this costs \{r\} less to play for each draconic chain link you control\.?$/i.test(sent)) { sc.costLessPer = 'draconicLink'; return; }
  if ((m = sent.match(/^if you control (?:a|an) ([a-z' ]+), this costs \{r\} less to play\.?$/i))) { sc.costLessIf = titleCase(m[1]); return; }
  if ((m = sent.match(/^when this is destroyed, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onDestroy.push(...e);
  }
  if ((m = sent.match(/^at the beginning of your action phase, destroy this,? then (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) { sc.destroyAt = 'actionPhase'; return void sc.onDestroy.push(...e); }
  }
  if ((m = sent.match(/^(?:when this is played, )?if (.+?), (.+)$/i))) {
    const cond = parseCondition(m[1]);
    const e = cond && parseEffect(m[2]);
    if (cond && e) return void sc.conditional.push({ when: LINK_CONDITIONS.has(cond.kind) ? 'ifLink' : 'if', cond, effects: e });
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
      sc.onPlay.length + sc.onHit.length + sc.onAttack.length + sc.conditional.length + sc.activations.length + sc.modes.length + sc.onDestroy.length > 0 ||
      !!sc.optional || !!sc.handActivation ||
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
