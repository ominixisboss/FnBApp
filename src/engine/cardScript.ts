// Turns a card's printed rules text into a small script the engine can execute.
// Flesh and Blood has thousands of unique effects; this compiler recognises the
// most common templated sentences. Anything it does not understand is reported in
// `unparsed` so the UI can tell the player which text needs manual handling.
import type { Card } from '../data/types';

export type AttackFilter =
  | { kind: 'any' }
  | { kind: 'attackAction' }
  /** an ally's attack */
  | { kind: 'ally' }
  | { kind: 'weapon' }
  | { kind: 'subtype'; value: string } // dagger, sword, arrow, ...
  | { kind: 'class'; value: string } // Warrior, Ninja, ...
  | { kind: 'anyClass'; values: string[] } // "Assassin or Mystic"
  | { kind: 'boosted' } // "the next attack you boost"
  | { kind: 'runeGated' } // "the next attack action card you rune gate"
  | { kind: 'classAttackAction'; value: string } // "your next Guardian attack action card"
  | { kind: 'keyword'; value: string }; // "the next attack with stealth"

export type Effect =
  /** any: "to any target" (allies too), otherwise a hero */
  /** all: each opposing hero (Pit Fight: every opponent) */
  | { kind: 'arcane'; amount: number; any?: boolean; all?: boolean }
  | { kind: 'damage'; amount: number; any?: boolean; all?: boolean }
  | { kind: 'gainLife'; amount: number }
  | { kind: 'loseLifeOpp'; amount: number; all?: boolean }
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
  | { kind: 'preventNext'; amount: number; thenToken?: string }
  | { kind: 'createToken'; name: string; amount: number }
  | { kind: 'banishTopOpp'; amount: number }
  /** destroy the top card(s) of their deck */
  | { kind: 'oppMill'; amount: number }
  /** destroy an item / aura they control */
  | { kind: 'oppDestroyPerm'; type: 'Item' | 'Aura' | 'Ally' | 'Token'; name?: string }
  /** banish a card from their soul */
  | { kind: 'banishOppSoul' }
  /** "When this hits a Brute hero, ...": only against heroes of that class */
  | { kind: 'ifOppClass'; cls: string; then: Effect[] }
  /** banish a card from their graveyard */
  | { kind: 'banishOppGrave' }
  | { kind: 'oppDiscardRandom'; amount: number }
  | { kind: 'intimidate' }
  | { kind: 'opt'; amount: number }
  | { kind: 'mark' }
  | { kind: 'ampArcane'; amount: number }
  | { kind: 'weakenAttack'; amount: number }
  | { kind: 'thisOverpower' }
  | { kind: 'tutor'; name: string }
  | { kind: 'sharpen'; times: number }
  /** discard random cards from your own hand; "If a card with N or more {p} is discarded this way, <then>" */
  | { kind: 'discardRandom'; amount: number; ifPower?: number; then?: Effect[] }
  /** Reload: if your arsenal is empty, put a card from your hand face down into it */
  | { kind: 'reload' }
  /** "Destroy an aura you control. If you do, <then>" */
  | { kind: 'destroyOwnThen'; type?: string; name?: string; then: Effect[] }
  /** "You may <cost>. If you do, <then>." anywhere (on hit, on attack, on defend, on play) */
  /** every attack matching the filter this turn gets +N{p} */
  | { kind: 'turnAttackPower'; amount: number; filter: AttackFilter }
  | { kind: 'turnAttackDominate' }
  /** destroy the permanent (aura, item, ally, equipment) that has the ability */
  | { kind: 'destroySelf' }
  /** "destroy this unless you remove a steam / balance / doom counter from it" */
  /** "This gets +1{p} or go again" (the attack card's own ability) */
  | { kind: 'powerOrGoAgain'; amount: number }
  | { kind: 'counterUpkeep'; counter: string }
  /** "remove a verse counter from this" (+ "If you do, <then>") */
  | { kind: 'removeCounter'; counter: string; then?: Effect[] }
  /** "put this into your soul" (a Light aura) */
  | { kind: 'selfToSoul' }
  | { kind: 'nextAttackDominate' }
  /** "your dagger attacks get go again this turn" */
  | { kind: 'turnAttackGoAgain'; filter: AttackFilter }
  /** "remove all +1{p} counters from weapons / swords you control" */
  | { kind: 'clearWeaponCounters'; sub?: string }
  /** "destroy all Runechants you control" */
  | { kind: 'destroyAllOwn'; name: string }
  /** {t} the opposing hero ("{t} them", "{t} target hero or ally") */
  | { kind: 'tapOpp' }
  /** {u} your hero / a cog / all cogs you control */
  | { kind: 'untap'; what: 'hero' | 'cog' | 'allCogs' | 'ally' | 'weapon' }
  | { kind: 'mayThen'; cost: OptionalCostKind; then: Effect[]; text: string }
  | { kind: 'banishTopSelf'; amount: number }
  /** create a card (e.g. Crouching Tiger) in your hand */
  | { kind: 'createInHand'; name: string }
  /** your next X attack this turn gets "When this hits, <effects>" */
  | { kind: 'nextAttackOnHit'; filter: AttackFilter; effects: Effect[] }
  | { kind: 'nextAttackOnAttack'; filter: AttackFilter; effects: Effect[] }
  /** wager with the defending hero (on the current attack); the winner creates the tokens / draws */
  | { kind: 'wager'; tokens: string[]; winnerDraw?: number; optional: boolean; target?: boolean }
  | { kind: 'crowd'; cheer: boolean; who: 'self' | 'opp' | 'revered' | 'reviled' }
  /** "if <condition>, <effects>" checked when the effect resolves */
  | { kind: 'ifCond'; cond: Condition; effects: Effect[] }
  | { kind: 'nextWagerPower'; amount: number; overpower?: boolean }
  | { kind: 'noDefenseReactions' }
  | { kind: 'costLess'; amount: number; filter: AttackFilter }
  /** "This gets +N{p} for each Evo you have equipped" */
  | { kind: 'perEvoPower'; amount: number }
  /** steal a Gold token from each hero that controls more Gold than you */
  | { kind: 'stealGold' }
  /** "Target defending (attack) action card gets +N{d}" */
  | { kind: 'buffDefender'; amount: number; cards: 'attackAction' | 'action' | 'any' }
  /** Clash: each hero reveals the top card of their deck; the greater {p} wins */
  | { kind: 'clash'; winnerToken?: string; ifWin?: Effect[]; guardianOnly?: boolean }
  /** a penalty for the opposing hero's next turn (Crush cards) */
  | { kind: 'oppNextTurn'; mod: 'attackPower' | 'costMore' | 'noDraw' | 'noGoAgain' | 'noSmallAttacks'; amount?: number }
  | { kind: 'oppArsenalBottom' }
  | { kind: 'oppArsenalDestroy'; goldEach?: boolean }
  /** put a -1{d} counter on an equipment the opposing hero controls */
  | { kind: 'oppEquipCounter' }
  /** look at the top 5 of their deck, banish the cards sharing a name (Righteous Cleansing) */
  | { kind: 'cleanseTop'; n: number }
  /** all: every other living hero ("each other hero", "each opponent") */
  | { kind: 'oppDraw'; amount: number; all?: boolean }
  | { kind: 'oppCreateToken'; name: string; all?: boolean }
  /** the current attack gets "When this hits, <effects>" */
  | { kind: 'thisGrantOnHit'; effects: Effect[] }
  /** where this attack card goes when the chain closes (granted "When this hits, put it ...") */
  | { kind: 'setDestination'; dest: 'soul' | 'deckBottom' | 'hand' }
  /** "weapons you control get +N{p} until end of turn" */
  | { kind: 'weaponsPowerTurn'; amount: number }
  /** Opt X, where X is the damage this dealt */
  | { kind: 'optDealt' }
  /** reveal the top card of your deck; with `minusPitch` this gets -X{p} for its pitch */
  | { kind: 'revealTop'; minusPitch?: boolean }
  /** create a Runechant for each non-attack action card played this turn; with 3+ this gets go again (Douse in Runeblood) */
  | { kind: 'runechantsPerNonAttack'; goAgainAt?: number }
  /** this defending equipment is destroyed when the combat chain closes */
  | { kind: 'destroyAtChainClose' }
  | { kind: 'gainAP'; amount: number }
  /** create a card (Crouching Tiger) in your banished zone */
  | { kind: 'createInBanished'; name: string }
  /** "You may play it this turn": the card the effect just banished can be played from the banished zone */
  | { kind: 'playLastBanished' }
  /** banish a card of this class and type from your graveyard (Rattle Bones) */
  | { kind: 'banishFromGrave'; cls?: string; type: string }
  /** Bite: a dagger you control deals 1 damage to the hero; if it does, the dagger has hit; destroy the dagger */
  | { kind: 'daggerStrike' }
  /** put a card from your arsenal on the bottom of your deck; if you do, draw a card */
  | { kind: 'arsenalCycle' }
  /** banish a card defending this chain link (the best one) */
  | { kind: 'banishDefender' }
  /** destroy a card of theirs that intimidate banished */
  | { kind: 'destroyIntimidated' }
  /** "this gets -N{p} unless you pay {r}" */
  | { kind: 'payOrWeaken'; amount: number; cost: number };

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
  | { kind: 'playedNonAttack' }
  | { kind: 'charged' }
  | { kind: 'instantToGrave' }
  | { kind: 'highTide'; n: number }
  | { kind: 'reprise' }
  | { kind: 'defendedByAttackAction' }
  | { kind: 'chainLinkAtLeast'; n: number }
  | { kind: 'arcaneTaken' }
  | { kind: 'moreLife' }
  | { kind: 'oppTalent'; talent: string }
  | { kind: 'wageredThisLink' }
  | { kind: 'cheered' }
  | { kind: 'hasAim' }
  | { kind: 'scrapped' }
  | { kind: 'beatChest' }
  | { kind: 'noChest' }
  | { kind: 'evoEquipped'; n: number }
  | { kind: 'all'; conds: Condition[] }
  | { kind: 'booed' }
  | { kind: 'anotherRed' }
  | { kind: 'emptyHand' }
  | { kind: 'emptyDeck' }
  | { kind: 'boostedTimes'; n: number }
  | { kind: 'oppSoul' }
  | { kind: 'phantasmDestroyed' }
  | { kind: 'createdToken'; name: string }
  | { kind: 'lastAttackColor'; pitch: number }
  | { kind: 'lastAttackName'; name: string }
  /** the last arcane damage effect of this card dealt damage */
  | { kind: 'dealtArcane' };

/** Conditions that depend on how the chain link went: checked just before damage. */
export const LINK_CONDITIONS = new Set<Condition['kind']>(['reprise', 'defendedByAttackAction', 'powerAboveBase', 'instantThisLink', 'defendedByFewer', 'powerAtLeast', 'reactionsThisLink', 'defendedByAction']);

export type OptionalCostKind =
  | { kind: 'reveal'; talent: string } // Fusion: reveal an Ice / Earth / Lightning card from hand
  | { kind: 'charge'; pitch?: number } // put a card from hand into your hero's soul
  | { kind: 'discard'; pitch?: number; power?: number; type?: string }
  /** destroy the card that has the ability (an equipment, aura or item) */
  | { kind: 'destroySelf' }
  /** banish a card from your hero's soul */
  | { kind: 'banishSoul' }
  /** {t} your hero */
  | { kind: 'tapHero' }
  /** {t} a cog / an ally you control, or {t} this */
  | { kind: 'tapOwn'; what: 'cog' | 'ally' | 'this' }
  /** "X and Y": pay every part (only in "you may ... If you do" abilities) */
  | { kind: 'all'; costs: OptionalCostKind[] }
  | { kind: 'pay'; amount: number }
  | { kind: 'banishGrave'; n: number }
  | { kind: 'destroyTop' }
  | { kind: 'handToBottom' }
  | { kind: 'banishHand' }
  | { kind: 'discardOrTop' }
  | { kind: 'discardOrItem' }
  | { kind: 'destroyOwn'; name?: string; type?: string }
  | { kind: 'arsenalToBottom' }
  /** banish a specific kind of card from your graveyard ("an aura", "a Nimblism") */
  | { kind: 'banishGraveMatch'; name?: string; type?: string; types?: string[] }
  /** Decompose: banish N Earth cards and an action card from your graveyard */
  | { kind: 'decompose'; earth: number };

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
  when: 'fromArsenal' | 'fromBanished' | 'combo' | 'crush' | 'if' | 'ifLink' | 'surge' | 'instead' | 'additional';
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
  /** "Twice / Thrice per Turn" (with oncePerTurn) */
  perTurn?: number;
  destroySelf: boolean;
  /** {t} costs: this card, your hero, a cog you control */
  tapSelf?: boolean;
  tapHero?: boolean;
  tapCog?: boolean;
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
  /** "This enters the arena with N verse / balance / doom / energy counters" */
  startCounters?: { counter: string; n: number };
  /** "When this has none, destroy it" (its counters) */
  destroyAtZero?: boolean;
  steamUpkeep: boolean; // start of turn: destroy unless you remove a steam counter
  destroyAt?: 'actionPhase' | 'startOfTurn';
  bloodDebt: boolean;
  costLessPer?: string; // token name ("Runechant") or 'draconicLink': "costs {r} less for each X you control"
  intimidateOnAttack: boolean;
  additionalCost: { discardRandom?: number; banishRandomHand?: number; banishGraveyard?: number; handToBottom?: number; banishSoul?: number };
  /** Contract: banishing an opponent's card of this kind (while this is on the combat chain) creates a Silver */
  contract?: 'nonAction' | 'attackAction' | 'nonAttackAction' | 'red' | 'yellow' | 'blue' | 'reaction' | 'lowDefense' | 'cheap' | 'costly' | 'goAgain';
  /** Graven equipment: from the graveyard, at the start of your turn, destroy N Silver to equip it again */
  graveEquip?: number;
  /** "When this is equipped from anywhere other than your graveyard, put a -1{d} counter on it" */
  equipCounter?: boolean;
  /** destroyed at the beginning of its controller's end phase */
  destroyAtEnd?: boolean;
  /** "If you would be dealt damage, you may banish this to prevent N of that damage" */
  banishPrevent?: number;
  /** Dawnblade: the second time this hits each turn it gets a +1{p} counter; they go if it didn't hit */
  secondHitCounter?: boolean;
  /** at the beginning of your end phase, put a -1{d} counter on this */
  endPhaseWear?: boolean;
  /** "This may only defend an attack if the attack's controller has destroyed a Might token / drawn a card this turn" */
  defendIf?: { token?: string; drew?: boolean };
  /** an ally that "can only attack if you've attacked with a weapon this turn" */
  attackIfWeapon?: boolean;
  /** "When the combat chain closes, if this didn't hit, the defending hero creates a <X> token" */
  closeMissToken?: string;
  /** "Play this only if <condition>" */
  playIf?: Condition;
  onPlay: Effect[]; // resolution of non-attacks, or "when you play this" for attacks
  onAttack: Effect[];
  onHit: Effect[];
  conditional: Conditional[];
  activations: Activation[];
  modes: Mode[]; // "Choose 1;" options
  optional?: OptionalCost;
  /** "When this is pitched, <effects>" */
  onPitch?: Effect[];
  /** a permanent's "when / whenever / at the beginning of ..." abilities */
  triggers?: Trigger[];
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
  /** "When this defends, <effects>" */
  onDefend: Effect[];
  /** Crank: when this enters the arena, you may remove a steam counter from it to gain an action point */
  crank: boolean;
  /** Ephemeral: ceases to exist instead of going to the graveyard */
  ephemeral: boolean;
  /** "Whenever the crowd cheers / boos you, ..." (permanents) */
  onCheer: Effect[];
  onBoo: Effect[];
  /** keywords */
  fragment?: boolean;
  onFragment: Effect[];
  runeGate?: boolean;
  wateryGrave?: boolean;
  heave?: number;
  quell?: number;
  suspense?: boolean;
  mirage?: boolean;
  guardwell?: boolean;
  spectra?: boolean;
  /** an Evo equipment card: played from hand, it replaces your base equipment in that slot */
  evoSlot?: string;
  /** lasting effects */
  unpreventable?: boolean;
  noFromHand?: boolean;
  /** "+N{d} while defending a weapon attack" / "if an attack reaction has been played this chain link, +N{d}" */
  defendBonus?: { amount: number; when: 'weaponAttack' | 'reactionThisLink' };
  /** a permanent: "Your (non-)attack action cards get +N{d} while defending" */
  grantDefend?: { amount: number; cards: 'attackAction' | 'nonAttackAction' };
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

/** hero classes and talents a "When this hits a <X> hero" clause can name */
const HERO_CLASSES = ['Brute', 'Guardian', 'Warrior', 'Ninja', 'Wizard', 'Pirate', 'Thief', 'Revered', 'Reviled', 'Bard', 'Necromancer', 'Merchant'];

function parseFilter(words: string): AttackFilter | null {
  const w = words.trim();
  if (w === '') return { kind: 'any' };
  if (/^ally$/i.test(w)) return { kind: 'ally' };
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
  if (/^put a card from your arsenal on the bottom of your deck\. if you do, draw a card$/i.test(s)) return [{ kind: 'arsenalCycle' }];
  // compound "X and Y" / "X, then Y"
  // "wager with the defending hero. The winner draws a card" is one effect, not two
  const wm = s.match(/^(you may )?wager with (?:them|the defending hero)\. the winner (draws (a|two|\d+) cards?|creates (?:a|an) ([A-Z][\w ]*?) token)$/i);
  if (wm) return [{ kind: 'wager', tokens: wm[4] ? [wm[4]] : [], winnerDraw: wm[3] ? toNum(wm[3].toLowerCase()) : undefined, optional: !!wm[1] }];
  const parts = /"/.test(s) ? [s] : s.split(/,? then |\. Then |\.\s+(?=[A-Z])/i); // never split inside a quoted grant
  if (parts.length > 1) {
    const out: Effect[] = [];
    for (const p of parts) {
      const pt = p.match(/^(?:if|the first time) you prevent damage this way, create (?:a|an) ([A-Z][\w' ]*?) token\.?$/i);
      const prev = out[out.length - 1];
      if (pt && prev?.kind === 'preventNext') { prev.thenToken = pt[1]; continue; }
      const e = parseEffect(p);
      if (!e) return null;
      out.push(...e);
    }
    return out;
  }
  if ((m = s.match(/^deal (\d+) arcane damage(?: to (any target|target hero|target opposing hero|each opposing hero|each hero|the defending hero))?$/i)))
    return [{ kind: 'arcane', amount: +m[1], ...(m[2]?.toLowerCase() === 'any target' ? { any: true } : {}), ...(/^each (opposing )?hero$/i.test(m[2] ?? '') ? { all: true } : {}) }];
  if ((m = s.match(/^deal (\d+) damage to (target hero|target opposing hero|any target|the defending hero|each opposing hero)$/i)))
    return [{ kind: 'damage', amount: +m[1], ...(m[2].toLowerCase() === 'any target' ? { any: true } : {}), ...(/^each opposing hero$/i.test(m[2]) ? { all: true } : {}) }];
  if ((m = s.match(/^(?:you )?gain (\d+)\{h\}$/i))) return [{ kind: 'gainLife', amount: +m[1] }];
  if ((m = s.match(/^(target|each) (?:opposing )?hero loses (\d+)\{h\}$/i)))
    return [{ kind: 'loseLifeOpp', amount: +m[2], ...(m[1].toLowerCase() === 'each' ? { all: true } : {}) }];
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
  if ((m = s.match(/^(?:this|it) gets \+(\d+)\{d\}(?: until end of turn)?$/i))) return [{ kind: 'thisDefense', amount: +m[1] }];
  if ((m = s.match(/^the next time you would be dealt damage this turn, prevent (\d+) of that damage\. if you prevent damage this way, create (?:a|an) ([A-Z][\w' ]*?) token$/i)))
    return [{ kind: 'preventNext', amount: +m[1], thenToken: m[2] }];
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
  if (/^intimidate(?: them| the defending hero| target hero)?$/i.test(s)) return [{ kind: 'intimidate' }];
  if ((m = s.match(/^gain (a|an|one|two|\d+) action points?$/i))) return [{ kind: 'gainAP', amount: toNum(m[1].toLowerCase()) }];
  if ((m = s.match(/^[Cc]reate (?:a|an) ([A-Z][\w' ]+?) in your banished zone$/))) return [{ kind: 'createInBanished', name: m[1] }];
  if (/^you may play it this turn$/i.test(s)) return [{ kind: 'playLastBanished' }];
  if ((m = s.match(/^banish target (\w+) (attack action|action) card from your graveyard$/i))) return [{ kind: 'banishFromGrave', cls: titleCase(m[1]), type: m[2].toLowerCase() === 'attack action' ? 'Attack' : 'Action' }];
  if (/^you may have target dagger you control deal 1 damage to them\. if damage is dealt this way, the dagger has hit\. destroy the dagger$/i.test(s)) return [{ kind: 'daggerStrike' }];
  if ((m = s.match(/^the next attack action card you play this turn costs ((?:\{r\})+) less to play$/i))) return [{ kind: 'costLess', amount: m[1].length / 3, filter: { kind: 'attackAction' } }];
  if ((m = s.match(/^banish the top card of their deck and a defending card$/i))) return [{ kind: 'banishTopOpp', amount: 1 }, { kind: 'banishDefender' }];
  if (/^destroy an intimidated card they own$/i.test(s)) return [{ kind: 'destroyIntimidated' }];
  if ((m = s.match(/^it gets \+(\d+)\{d\} and "when the combat chain closes, destroy this\.?"$/i))) return [{ kind: 'thisDefense', amount: +m[1] }, { kind: 'destroyAtChainClose' }];
  if ((m = s.match(/^(?:it|this) gets -(\d+)\{p\} unless you pay ((?:\{r\})+)$/i))) return [{ kind: 'payOrWeaken', amount: +m[1], cost: m[2].length / 3 }];
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
  if ((m = s.match(/^the next attack you boost this turn gets \+(\d+)\{p\}$/i))) return [{ kind: 'nextAttackPower', amount: +m[1], filter: { kind: 'boosted' } }];
  if ((m = s.match(/^draw (a|two|\d+) cards?,? then discard (a|two|\d+) random cards?$/i)))
    return [{ kind: 'draw', amount: toNum(m[1].toLowerCase()) }, { kind: 'discardRandom', amount: toNum(m[2].toLowerCase()) }];
  if ((m = s.match(/^discard (a|two|\d+) random cards?$/i))) return [{ kind: 'discardRandom', amount: toNum(m[1].toLowerCase()) }];
  if (/^reload$/i.test(s)) return [{ kind: 'reload' }];
  if ((m = s.match(/^(you may )?wager (?:a|an) ([A-Z]\w*(?:, [A-Z]\w*)*(?:,? and [A-Z]\w*)?) tokens? with (?:them|the defending hero)$/))) {
    const tokens = m[2].split(/,? and |, /).map((x) => x.trim()).filter(Boolean);
    return [{ kind: 'wager', tokens, optional: !!m[1] }];
  }
  if ((m = s.match(/^(you may )?wager with (?:them|the defending hero)(?:\. the winner (draws (a|two|\d+) cards?|creates (?:a|an) ([A-Z][\w ]*?) token))?$/i))) {
    return [{ kind: 'wager', tokens: m[4] ? [m[4]] : [], winnerDraw: m[3] ? toNum(m[3].toLowerCase()) : undefined, optional: !!m[1] }];
  }
  if ((m = s.match(/^the crowd (cheers|boos) (you|them|each revered hero|each reviled hero)$/i))) {
    const who = { you: 'self', them: 'opp', 'each revered hero': 'revered', 'each reviled hero': 'reviled' }[m[2].toLowerCase()] as 'self';
    return [{ kind: 'crowd', cheer: m[1].toLowerCase() === 'cheers', who }];
  }
  if (/^defense reactions?(?: cards)? can't be played this chain link$/i.test(s)) return [{ kind: 'noDefenseReactions' }];
  if ((m = s.match(/^your next (\w+) attack action card this turn costs \{r\} less to play$/i))) return [{ kind: 'costLess', amount: 1, filter: { kind: 'classAttackAction', value: m[1] } }];
  if ((m = s.match(/^the next attack action card you rune gate this turn gets \+(\d+)\{p\}$/i))) return [{ kind: 'nextAttackPower', amount: +m[1], filter: { kind: 'runeGated' } }];
  if ((m = s.match(/^this gets \+(\d+)\{p\} for each evo you have equipped$/i))) return [{ kind: 'perEvoPower', amount: +m[1] }];
  if (/^for each hero that controls more gold than you, steal a gold token they control$/i.test(s)) return [{ kind: 'stealGold' }];
  if ((m = s.match(/^target defending (attack action|action)? ?card gets \+(\d+)\{d\}(?: this chain link)?$/i)))
    return [{ kind: 'buffDefender', amount: +m[2], cards: m[1]?.toLowerCase() === 'attack action' ? 'attackAction' : m[1] ? 'action' : 'any' }];
  if ((m = s.match(/^the next time an attack you control wagers this turn, it gets \+(\d+)\{p\}$/i))) return [{ kind: 'nextWagerPower', amount: +m[1] }];
  if ((m = s.match(/^the next attack that wagers this turn gets \+(\d+)\{p\}( and overpower)?$/i))) return [{ kind: 'nextWagerPower', amount: +m[1], overpower: !!m[2] }];
  if ((m = s.match(/^target (?:([\w]+) )?attack gets \+(\d+)\{p\} and wagers with the defending hero$/i))) {
    const f = parseFilter(m[1] ?? '');
    return f ? [{ kind: 'targetAttackPower', amount: +m[2], filter: f }, { kind: 'wager', tokens: [], optional: false, target: true }] : null;
  }
  if ((m = s.match(/^their first attack during their next turn gets -(\d+)\{p\}$/i))) return [{ kind: 'oppNextTurn', mod: 'attackPower', amount: +m[1] }];
  if (/^their first action during their next turn costs an additional \{r\} to play or activate$/i.test(s)) return [{ kind: 'oppNextTurn', mod: 'costMore', amount: 1 }];
  if (/^they can't draw cards during their next action phase$/i.test(s)) return [{ kind: 'oppNextTurn', mod: 'noDraw' }];
  if (/^action cards, activated abilities, and attacks they control lose and can't gain go again during their next action phase$/i.test(s)) return [{ kind: 'oppNextTurn', mod: 'noGoAgain' }];
  if (/^they can't play attack action cards with 3 or less base \{p\} during their next action phase$/i.test(s)) return [{ kind: 'oppNextTurn', mod: 'noSmallAttacks' }];
  if (/^put a card from their arsenal on the bottom of its owner's deck$/i.test(s)) return [{ kind: 'oppArsenalBottom' }];
  if (/^destroy all cards in their arsenal$/i.test(s)) return [{ kind: 'oppArsenalDestroy' }];
  if (/^put a -1\{d\} counter on target equipment they control$/i.test(s)) return [{ kind: 'oppEquipCounter' }];
  if ((m = s.match(/^look at the top (\d+) cards of their deck$/i))) return [{ kind: 'cleanseTop', n: +m[1] }];
  if ((m = s.match(/^(?:they|the defending hero|another target hero|target opposing hero) draws? (a|two|\d+) cards?$/i))) return [{ kind: 'oppDraw', amount: toNum(m[1].toLowerCase()) }];
  if ((m = s.match(/^create (?:a|an) ([A-Z][\w' ]*?) token under another hero's control$/))) return [{ kind: 'oppCreateToken', name: m[1] }];
  if ((m = s.match(/^weapons you control get \+(\d+)\{p\} until end of turn$/i))) return [{ kind: 'weaponsPowerTurn', amount: +m[1] }];
  if (/^opt x, where x is the damage dealt by this$/i.test(s)) return [{ kind: 'optDealt' }];
  if (/^reveal the top card of your deck$/i.test(s)) return [{ kind: 'revealTop' }];
  // "this gets +1{p}, go again, and "When this hits, draw a card."" (combo grants)
  if ((m = s.match(/^(?:this|it) gets (.+)$/i)) && /,|"| and /.test(m[1])) {
    const items = m[1].match(/"[^"]*"|[^,"]+/g)?.map((x) => x.trim().replace(/^and /i, '').trim()).filter((x) => x && x !== 'and') ?? [];
    const flat = items.flatMap((x) => (x.startsWith('"') ? [x] : x.split(/(?:^|\s+)and(?:\s+|$)/i).map((y) => y.trim()).filter(Boolean)));
    const out: Effect[] = [];
    for (const it of flat) {
      let k: RegExpMatchArray | null;
      if ((k = it.match(/^\+(\d+)\{p\}$/))) out.push({ kind: 'thisPower', amount: +k[1] });
      else if (/^go again$/i.test(it)) out.push({ kind: 'thisGoAgain' });
      else if (/^dominate$/i.test(it)) out.push({ kind: 'thisDominate' });
      else if (/^overpower$/i.test(it)) out.push({ kind: 'thisOverpower' });
      else if ((k = it.match(/^"(?:when|if) this hits(?: a hero)?, (.+?)\.?"$/i))) {
        const dest = /^put it on the bottom of its owner's deck$/i.test(k[1]) ? 'deckBottom' : /^put it into your hand$/i.test(k[1]) ? 'hand' : /^put it into your soul$/i.test(k[1]) ? 'soul' : null;
        const e = dest ? [{ kind: 'setDestination' as const, dest: dest as 'hand' }] : parseEffect(k[1]);
        if (!e) { out.length = 0; break; }
        out.push({ kind: 'thisGrantOnHit', effects: e });
      } else { out.length = 0; break; } // not a list of "this gets" items: let the rules below try
    }
    if (out.length) return out;
  }
  // "the next Runeblade attack action card you play this turn gets go again and "When this hits, ...""
  if ((m = s.match(/^the next (\w+) attack action card you play this turn gets (.+)$/i))) {
    const f = { kind: 'classAttackAction' as const, value: titleCase(m[1]) };
    const items = m[2].match(/"[^"]*"|[^,"]+/g)?.flatMap((x) => (x.startsWith('"') ? [x.trim()] : x.split(/(?:^|\s+)and(?:\s+|$)/i).map((y) => y.trim()))).filter((x) => x && x !== 'and') ?? [];
    const out: Effect[] = [];
    for (const it of items) {
      let k: RegExpMatchArray | null;
      if ((k = it.match(/^\+(\d+)\{p\}$/))) out.push({ kind: 'nextAttackPower', amount: +k[1], filter: f });
      else if (/^go again$/i.test(it)) out.push({ kind: 'nextAttackGoAgain', filter: f });
      else if ((k = it.match(/^"when this hits(?: a hero)?, (.+?)\.?"$/i))) { const e = parseEffect(k[1]); if (!e) return null; out.push({ kind: 'nextAttackOnHit', filter: f, effects: e }); }
      else return null;
    }
    if (out.length) return out;
  }
  if ((m = s.match(/^if (.+?), (.+)$/i))) {
    const cond = parseCondition(m[1]);
    const e = cond && parseEffect(m[2]);
    if (cond && e) return [{ kind: 'ifCond', cond, effects: e }];
  }
  if ((m = s.match(/^banish the top (?:(\d+) )?cards? of your deck$/i))) return [{ kind: 'banishTopSelf', amount: m[1] ? +m[1] : 1 }];
  if ((m = s.match(/^create (?:a|an) ([A-Z][\w' ]*?) in your hand$/))) return [{ kind: 'createInHand', name: m[1] }];
  if ((m = s.match(/^(?:your next (?:([\w ]+?) )?attack|the next attack action card you play) this turn gets (?:\+(\d+)\{p\} and )?"when this attacks(?: a hero)?, (.+?)\.?"$/i))) {
    const f = /^the next attack action card/i.test(s) ? { kind: 'attackAction' as const } : parseFilter(m[1] ?? '');
    const e = parseEffect(m[3]);
    if (!f || !e) return null;
    const out: Effect[] = [];
    if (m[2]) out.push({ kind: 'nextAttackPower', amount: +m[2], filter: f });
    out.push({ kind: 'nextAttackOnAttack', filter: f, effects: e });
    return out;
  }
  if ((m = s.match(/^your next (?:([\w ]+?) )?attack this turn gets (?:\+(\d+)\{p\} and )?"(?:when|if) this hits(?: a hero)?, (.+?)\.?"$/i))) {
    const f = parseFilter(m[1] ?? '');
    const e = parseEffect(m[3]);
    if (!f || !e) return null;
    const out: Effect[] = [];
    if (m[2]) out.push({ kind: 'nextAttackPower', amount: +m[2], filter: f });
    out.push({ kind: 'nextAttackOnHit', filter: f, effects: e });
    return out;
  }
  if ((m = s.match(/^target hero gains (\d+)\{h\}$/i))) return [{ kind: 'gainLife', amount: +m[1] }];
  if ((m = s.match(/^deal (\d+) arcane damage to them$/i))) return [{ kind: 'arcane', amount: +m[1] }];
  if ((m = s.match(/^your hero deals (\d+) arcane damage to (any target|target hero|them)$/i))) return [{ kind: 'arcane', amount: +m[1], ...(m[2].toLowerCase() === 'any target' ? { any: true } : {}) }];
  // "create a Frailty token under their control" and the like: the opposing hero on this chain link gets it
  if ((m = s.match(/^[Cc]reate (a|an|one|two|three|\d+) ([A-Z][\w' ]*?) tokens? under (?:their|the attacking hero's|the defending hero's|target hero's|target opposing hero's|target opponent's|each opponent's|each other hero's|another target hero's) control$/)))
    return Array.from({ length: toNum(m[1].toLowerCase()) }, () => ({ kind: 'oppCreateToken' as const, name: m![2], ...(/each (?:opponent|other hero)'s control$/.test(s) ? { all: true } : {}) }));
  // "Daggers you control get +1{p} this turn" / "Draconic attacks get +2{p} this turn"
  if ((m = s.match(/^(?:your )?(\w+?)s?(?: attacks)? (?:you control )?get \+(\d+)\{p\} (?:this turn|until end of turn)$/i))) {
    const f = parseFilter(/^weapon$/i.test(m[1]) ? 'weapon' : /^[a-z]/.test(m[1]) ? m[1].toLowerCase() : m[1]);
    if (f && f.kind !== 'any') return [{ kind: 'turnAttackPower', amount: +m[2], filter: f }];
  }
  if (/^your attacks this turn get dominate$/i.test(s)) return [{ kind: 'turnAttackDominate' }];
  if ((m = s.match(/^[Ee]ach hero creates (?:a|an) ([A-Z][\w' ]*?) token$/))) return [{ kind: 'createToken', name: m[1], amount: 1 }, { kind: 'oppCreateToken', name: m[1], all: true }];
  if ((m = s.match(/^each (?:other hero|opponent) draws (a|two|\d+) cards?$/i))) return [{ kind: 'oppDraw', amount: toNum(m[1].toLowerCase()), all: true }];
  if ((m = s.match(/^each hero draws (a|two|\d+) cards?$/i))) return [{ kind: 'draw', amount: toNum(m[1].toLowerCase()) }, { kind: 'oppDraw', amount: toNum(m[1].toLowerCase()), all: true }];
  // "the attack gets ..." (a reaction or equipment boosting the current attack)
  if ((m = s.match(/^the attack gets \+(\d+)\{p\}$/i))) return [{ kind: 'targetAttackPower', amount: +m[1], filter: { kind: 'any' } }];
  if (/^the attack gets go again$/i.test(s)) return [{ kind: 'targetAttackGoAgain', filter: { kind: 'any' } }];
  if ((m = s.match(/^(?:this|it) gets \+(\d+)\{d\} this chain link$/i))) return [{ kind: 'thisDefense', amount: +m[1] }];
  if ((m = s.match(/^(?:this|it) gets \+(\d+)\{p\} and \+(\d+)\{d\}$/i))) return [{ kind: 'thisPower', amount: +m[1] }, { kind: 'thisDefense', amount: +m[2] }];
  if (/^destroy this$/i.test(s)) return [{ kind: 'destroySelf' }];
  if ((m = s.match(/^destroy the top (?:(\d+) cards|card) of their deck$/i))) return [{ kind: 'oppMill', amount: m[1] ? +m[1] : 1 }];
  if ((m = s.match(/^destroy (?:an|target) (item|aura|ally)( token)? (?:they|that hero) controls?$/i))) return [{ kind: 'oppDestroyPerm', type: m[2] ? 'Token' : ({ item: 'Item', aura: 'Aura', ally: 'Ally' } as const)[m[1].toLowerCase() as 'item'] }];
  if ((m = s.match(/^destroy (?:a|an|target) ([A-Z][\w' ]*?) token (?:they|that hero) controls?$/))) return [{ kind: 'oppDestroyPerm', type: 'Token', name: m[1] }];
  if (/^banish a card from their soul$/i.test(s)) return [{ kind: 'banishOppSoul' }];
  if (/^mark (?:the attacking hero|them|that hero)$/i.test(s)) return [{ kind: 'mark' }];
  if (/^banish a card from their graveyard$/i.test(s)) return [{ kind: 'banishOppGrave' }];
  if ((m = s.match(/^this gets \+(\d+)\{p\} or go again$/i))) return [{ kind: 'powerOrGoAgain', amount: +m[1] }];
  if (/^\{t\} (?:them|target hero|target opposing hero|target hero or ally|target [A-Z]\w+ hero(?: or ally)?|them or an ally they control|them or a weapon they control|them and all allies they control)$/.test(s)) return [{ kind: 'tapOpp' }];
  if (/^(?:you may )?\{u\} your hero$/i.test(s)) return [{ kind: 'untap', what: 'hero' }];
  if (/^(?:you may )?\{u\} (?:a|target) cog you control$/i.test(s)) return [{ kind: 'untap', what: 'cog' }];
  if (/^(?:you may )?\{u\} (?:all|up to \d+) cogs you control$/i.test(s)) return [{ kind: 'untap', what: 'allCogs' }];
  if (/^(?:you may )?\{u\} (?:a|target) (?:gun|bow|staff|weapon) you control$/i.test(s)) return [{ kind: 'untap', what: 'weapon' }];
  if (/^\{u\} (?:an|target) ally you control$/i.test(s)) return [{ kind: 'untap', what: 'ally' }];
  if ((m = s.match(/^destroy (?:this|it) unless you remove (?:a|an) (\w+) counter from (?:it|this)$/i))) return [{ kind: 'counterUpkeep', counter: m[1].toLowerCase() }];
  if ((m = s.match(/^remove (?:a|an) (\w+) counter from this$/i))) return [{ kind: 'removeCounter', counter: m[1].toLowerCase() }];
  if (/^put this into your (?:hero's )?soul$/i.test(s)) return [{ kind: 'selfToSoul' }];
  if (/^your next attack this turn gets dominate$/i.test(s)) return [{ kind: 'nextAttackDominate' }];
  if ((m = s.match(/^your (\w+?)s? attacks get go again this turn$/i))) { const f = parseFilter(m[1].toLowerCase()); if (f) return [{ kind: 'turnAttackGoAgain', filter: f }]; }
  if ((m = s.match(/^remove all \+1\{p\} counters from (weapons|swords) you control$/i))) return [{ kind: 'clearWeaponCounters', sub: m[1].toLowerCase() === 'swords' ? 'Sword' : undefined }];
  if ((m = s.match(/^destroy all ([A-Z][\w' ]*?)s? you control$/))) return [{ kind: 'destroyAllOwn', name: m[1] }];
  if (/^sharpen all swords you control$/i.test(s)) return [{ kind: 'sharpen', times: 1 }];
  // "destroy this, then <effect>" / "destroy this and <effect>"
  if ((m = s.match(/^destroy this,? (?:and|then) (.+)$/i))) { const e = parseEffect(m[1]); return e ? [{ kind: 'destroySelf' }, ...e] : null; }
  // "X and Y"
  const and = s.split(/ and (?=(?:draw|gain|create|deal|you gain|you draw|this gets|it gets|the attack gets|amp \d)\b)/i);
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
  if (/^you've charged(?: your hero's soul)? this turn$/.test(t)) return { kind: 'charged' };
  if (/^you've intimidated this turn$/.test(t)) return { kind: 'intimidated' };
  if (/^an instant card has been put into your graveyard this turn$/.test(t)) return { kind: 'instantToGrave' };
  if ((m = t.match(/^there are (\d+) or more blue cards in your pitch zone$/))) return { kind: 'highTide', n: +m[1] };
  if (/^the defending hero has defended with a card from their hand this chain link$/.test(t)) return { kind: 'reprise' };
  if (/^(?:it's|it is|this is) defended by an attack action card$/.test(t)) return { kind: 'defendedByAttackAction' };
  if ((m = t.match(/^this is played (?:on|as|at) chain link (\d+) or higher$/))) return { kind: 'chainLinkAtLeast', n: +m[1] };
  if (/^you've been dealt arcane damage this turn$/.test(t)) return { kind: 'arcaneTaken' };
  if (/^you have less \{h\} than (?:them|each other hero|the defending hero)$/.test(t)) return { kind: 'lessLife' };
  if (/^you have more \{h\} than (?:them|each other hero|the defending hero|an opposing hero)$/.test(t)) return { kind: 'moreLife' };
  if (/^you've wagered this chain link$/.test(t)) return { kind: 'wageredThisLink' };
  if (/^this has an aim counter$/.test(t) || /^it has an aim counter$/.test(t)) return { kind: 'hasAim' };
  if (/^it scrapped a card$/.test(t)) return { kind: 'scrapped' };
  if (/^you've beaten chest this turn$/.test(t)) return { kind: 'beatChest' };
  if (/^you don't control a chest equipment$/.test(t)) return { kind: 'noChest' };
  if ((m = t.match(/^you have (\d+) or more evos equipped$/))) return { kind: 'evoEquipped', n: +m[1] };
  if (/ and /.test(t)) {
    const parts = t.split(/ and /).map((x) => parseCondition(x));
    if (parts.every(Boolean)) return { kind: 'all', conds: parts as Condition[] };
  }
  if (/^you've been cheered this turn$/.test(t) || /^the crowd has cheered you this turn$/.test(t)) return { kind: 'cheered' };
  if (/^you've been booed this turn$/.test(t) || /^the crowd has booed you this turn$/.test(t)) return { kind: 'booed' };
  if ((m = t.match(/^there are fewer than (\d+) non-equipment cards defending this$/))) return { kind: 'defendedByFewer', n: +m[1] };
  if (/^you've played another red card this turn$/.test(t)) return { kind: 'anotherRed' };
  if ((m = t.match(/^an? (red|yellow|blue) attack action card was the last attack this combat chain$/))) return { kind: 'lastAttackColor', pitch: { red: 1, yellow: 2, blue: 3 }[m[1] as 'red'] };
  if ((m = t.match(/^([a-z' ]+) was the last attack this combat chain$/))) return { kind: 'lastAttackName', name: titleCase(m[1]) };
  if ((m = t.match(/^you've created (?:a|an) ([a-z' ]+) token this turn$/))) return { kind: 'createdToken', name: titleCase(m[1]) };
  if (/^you have no cards in (?:your )?hand$/.test(t)) return { kind: 'emptyHand' };
  if (/^you have no cards in your deck$/.test(t)) return { kind: 'emptyDeck' };
  if ((m = t.match(/^you've boosted (\d+) or more times this turn$/))) return { kind: 'boostedTimes', n: +m[1] };
  if (/^the defending hero is marked$/.test(t)) return { kind: 'attackingMarked' };
  if (/^the defending hero has 1 or more cards in their soul$/.test(t)) return { kind: 'oppSoul' };
  if (/^an illusionist attack action card you control has been destroyed by phantasm this turn$/.test(t)) return { kind: 'phantasmDestroyed' };
  return null;
}

function parseOptionalCost(raw: string): OptionalCostKind | null {
  const t = raw.trim().toLowerCase().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^discard (?:a|an) (?:(red|yellow|blue) )?card$/))) return { kind: 'discard', pitch: m[1] ? { red: 1, yellow: 2, blue: 3 }[m[1] as 'red'] : undefined };
  if ((m = t.match(/^pay ((?:\{r\})+)$/))) return { kind: 'pay', amount: m[1].length / 3 };
  if (/^destroy this$/.test(t)) return { kind: 'destroySelf' };
  if (/^banish a card from your hero's soul$/.test(t)) return { kind: 'banishSoul' };
  if (/^\{t\} your hero$/.test(t)) return { kind: 'tapHero' };
  if (/^\{t\} this$/.test(t)) return { kind: 'tapOwn', what: 'this' };
  if ((m = t.match(/^\{t\} (?:a|an) (cog|ally) you control$/))) return { kind: 'tapOwn', what: m[1] as 'cog' | 'ally' };
  if ((m = t.match(/^(.+?) and (.+)$/))) {
    const a = parseOptionalCost(m[1]);
    const b = a && parseOptionalCost(m[2]);
    if (a && b) return { kind: 'all', costs: [a, b] };
  }
  if ((m = t.match(/^discard (?:a|an) (instant|attack action|action|non-attack action) card$/))) return { kind: 'discard', type: { instant: 'Instant', 'attack action': 'Attack', action: 'Action', 'non-attack action': 'NonAttack' }[m[1]] };
  if ((m = t.match(/^banish (a|an|two|three|\d+) cards? from your graveyard$/))) return { kind: 'banishGrave', n: toNum(m[1]) };
  if (/^destroy the top card of your deck$/.test(t)) return { kind: 'destroyTop' };
  if (/^charge your (?:hero's )?soul$/.test(t)) return { kind: 'charge' };
  if (/^put a card from your hand(?: or arsenal)? on the bottom of your deck$/.test(t)) return { kind: 'handToBottom' };
  if (/^banish a card from your hand$/.test(t)) return { kind: 'banishHand' };
  if (/^discard a card or destroy the top card of your deck$/.test(t)) return { kind: 'discardOrTop' };
  if (/^discard a card or destroy an item you control$/.test(t)) return { kind: 'discardOrItem' };
  if ((m = t.match(/^destroy (?:a|an) (item|aura) you control$/))) return { kind: 'destroyOwn', type: m[1] === 'item' ? 'Item' : 'Aura' };
  if (/^put a card from your arsenal on the bottom of your deck$/.test(t)) return { kind: 'arsenalToBottom' };
  if ((m = t.match(/^banish (\d+) earth cards and an action card from your graveyard$/))) return { kind: 'decompose', earth: +m[1] };
  if ((m = t.match(/^banish (?:a|an) (aura|item|attack action card|action card|[a-z][a-z' ]+?) from your graveyard$/))) {
    const types: Record<string, string> = { aura: 'Aura', item: 'Item', 'attack action card': 'Attack', 'action card': 'Action' };
    return types[m[1]] ? { kind: 'banishGraveMatch', type: types[m[1]] } : { kind: 'banishGraveMatch', name: titleCase(m[1]) };
  }
  if ((m = t.match(/^destroy (?:a|an) ([a-z' ]+?)(?: token)? you control$/))) return { kind: 'destroyOwn', name: titleCase(m[1]) };
  return null;
}

/** "When this attacks, you may discard a card." + "If you do, this gets go again." */
export function parseOptional(a: string, b: string): OptionalCost | null {
  const ma = a.replace(/^(galvanize|decompose) - /i, '').match(/^(when this attacks|when you play this|as an additional cost to play this|when this defends),? you may (.+?)\.?$/i);
  if (!ma) return null;
  const cost = parseOptionalCost(ma[2]);
  if (!cost || cost.kind === 'all') return null; // combined costs only in "you may ... If you do" abilities
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
    onDestroy: [], noEquipDefense: false, unity: 0, onDefend: [], crank: false, ephemeral: false, onCheer: [], onBoo: [], onFragment: [],
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
  if (/^crank$/i.test(s)) return (sc.crank = true);
  if (/^fragment$/i.test(s)) return (sc.fragment = true);
  if (/^rune gate$/i.test(s)) return (sc.runeGate = true);
  if (/^watery grave$/i.test(s)) return (sc.wateryGrave = true);
  if (/^suspense$/i.test(s)) return (sc.suspense = true);
  if (/^mirage$/i.test(s)) return (sc.mirage = true);
  if (/^guardwell$/i.test(s)) return (sc.guardwell = true);
  if (/^spectra$/i.test(s)) return (sc.spectra = true);
  if (/^cloaked$/i.test(s)) return true; // equipped face-down: no effect on play here
  if ((m = s.match(/^heave (\d+)$/i))) return !!(sc.heave = +m[1]);
  if ((m = s.match(/^quell (\d+)$/i))) return !!(sc.quell = +m[1]);
  if (/^ephemeral$/i.test(s)) return (sc.ephemeral = true);
  if (/^reload$/i.test(s)) { sc.onPlay.push({ kind: 'reload' }); return true; }
  if (/^blood debt$/i.test(s)) return (sc.bloodDebt = true);
  if ((m = s.match(/^this enters the arena with (a|an|one|two|three|\d+) steam counters?$/i))) return !!(sc.steam = toNum(m[1].toLowerCase()));
  if ((m = s.match(/^this enters the arena with (a|an|one|two|three|\d+) (balance|doom|verse|energy|frost|endurance|suspense|bind|flow|lesson) counters?(?: on it)?$/i))) { sc.startCounters = { counter: m[2].toLowerCase(), n: toNum(m[1].toLowerCase()) }; return true; }
  if (/^when (?:this|it) has none, destroy it$/i.test(s)) return (sc.destroyAtZero = true);
  if (/^this can only attack if you've attacked with a weapon this turn$/i.test(s)) return (sc.attackIfWeapon = true);
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
  // the keyword list repeats effect keywords that are also in the text (intimidate, opt, amp, reload): only take static ones from it
  for (const k of c.keywords) if (!/^(intimidate|amp \d+|opt \d+|reload)$/i.test(k)) keywordSentence(sc, k);
  let fusion: string | null = null;

  // strip reminder text; an ally's or weapon's own name in its text means "this" ("When Aegis attacks", "Whenever Kyloria hits a hero")
  let text = c.text.replace(/\([^)]*\)/g, '').trim();
  if (c.types.includes('Ally') || c.types.includes('Weapon')) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = [...new Set([c.name, c.name.split(',')[0]])].filter((x) => x.length > 2).map(esc).join('|');
    text = text.replace(new RegExp(`\\b(?:${names})(?= (?:attacks|hits|is|enters|leaves|deals|gets|has|can)\\b)`, 'g'), 'this');
    text = text.replace(/\bWhenever this (attacks|hits)\b/g, 'When this $1').replace(/\bWhen this dies\b/g, 'When this is destroyed')
      .replace(/\b(?:he|she|it) deals (\d+) arcane damage to them\b/g, 'deal $1 arcane damage to them');
  }
  if (!text) return finish(sc, c);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (/^scrap$/i.test(line) && !sc.optional) {
      sc.optional = { timing: 'play', cost: { kind: 'banishGraveMatch', types: ['Item', 'Equipment'] }, effects: [], costText: 'scrap: banish an item or equipment from your graveyard', effectText: 'scrapped' };
      continue;
    }
    if (/^beat chest$/i.test(line) && !sc.optional) {
      sc.optional = { timing: 'play', cost: { kind: 'discard', power: 6 }, effects: [], costText: 'beat chest: discard a card with 6 or more {p}', effectText: 'beaten chest' };
      continue;
    }
    // modal cards: "Choose 1;" followed by one option per line
    // "Choose 1 or both;", "Choose 2;", "Choose any number;": each allowed combination becomes one mode
    const modal = line.match(/^choose (1|2|3|1 or both|any number);?$/i);
    if (modal) {
      const single: Mode[] = [];
      while (li + 1 < lines.length && /[.!"]$/.test(lines[li + 1])) {
        const opt = lines[++li].replace(/^[-•]\s*/, '');
        const tmp = emptyScript();
        handleSentence(tmp, opt, false, false);
        const parsed = tmp.unparsed.length === 0;
        single.push({ label: opt.replace(/\.$/, ''), onPlay: tmp.onPlay, onAttack: tmp.onAttack, onHit: tmp.onHit, parsed });
        if (!parsed) sc.unparsed.push(`(mode) ${opt}`);
      }
      const how = modal[1].toLowerCase();
      const sizes = how === '1' ? [1] : how === '2' ? [2] : how === '3' ? [3] : how === '1 or both' ? [1, 2] : single.map((_, i) => i + 1);
      const combos: Mode[][] = [];
      const pick = (start: number, acc: Mode[]) => { if (sizes.includes(acc.length)) combos.push(acc); for (let i = start; i < single.length; i++) pick(i + 1, [...acc, single[i]]); };
      pick(0, []);
      for (const set of combos.filter((x) => x.length)) {
        sc.modes.push(set.length === 1 ? set[0] : {
          label: set.map((m) => m.label).join(' + '),
          onPlay: set.flatMap((m) => m.onPlay), onAttack: set.flatMap((m) => m.onAttack), onHit: set.flatMap((m) => m.onHit), parsed: set.every((m) => m.parsed),
        });
      }
      continue;
    }
    // activated abilities: "Once per Turn Action - {r}{r}: Attack", "Instant - Destroy this: ..."
    const act = line.match(/^((?:once|twice|thrice) per turn )?(action|instant)\s*[-–]\s*([^:]*):\s*(.+)$/i);
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
      const tapHero = /\{t\}(?: this and)? your hero/.test(extra);
      const tapCog = /\{t\} a cog you control/.test(extra);
      const tapSelf = /\{t\}(?! your hero| a cog)/.test(extra.replace(/\{t\} this and your hero/, '{t} this'));
      const extraOk = extra.replace(/\{t\} this and your hero|\{t\} your hero|\{t\} a cog you control|\{t\} this|\{t\}|destroy this|\band\b|^0$/g, '').trim() === '';
      // "Activate this only while ..." timing limits are simplified away (the ability can be used at any instant speed)
      let body = act[4].trim().replace(/\s*Activate this only (?:while|if|during) [^.]*\.?$/i, '');
      let goAgain = false;
      if (/\.?\s*go again\.?$/i.test(body) && !/^attack/i.test(body) && !/\bor go again\.?$/i.test(body)) {
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
          perTurn: /^twice/i.test(act[1] ?? '') ? 2 : /^thrice/i.test(act[1] ?? '') ? 3 : undefined,
          destroySelf,
          tapSelf: tapSelf || undefined,
          tapHero: tapHero || undefined,
          tapCog: tapCog || undefined,
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
    const fused = line.match(/^(?:when this attacks, )?if (?:this|it) (?:was|is) fused, (.+?)\.?$/i);
    if (fused && fusion && !sc.optional) {
      const effects = parseEffect(fused[1]);
      if (effects) {
        sc.optional = { timing: 'play', cost: { kind: 'reveal', talent: fusion }, effects, costText: `reveal ${/^[aeiou]/i.test(fusion) ? 'an' : 'a'} ${fusion} card from your hand (fuse)`, effectText: fused[1] };
        continue;
      }
    }
    const sentences = joinQuotes(line.split(/(?<=\.)\s+(?=[A-Z])/).map((x) => x.trim()));
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
      const dm = i + 1 < sentences.length ? sentences[i].match(/^destroy (?:a|an) (item|aura|[a-z' ]+?) you control\.?$/i) : null;
      const dthen = dm && sentences[i + 1].match(/^if you do, (.+?)\.?$/i);
      const deff = dthen && parseEffect(dthen[1]);
      if (dm && deff && !isAttack) {
        const w = dm[1].toLowerCase();
        sc.onPlay.push({ kind: 'destroyOwnThen', type: w === 'item' ? 'Item' : w === 'aura' ? 'Aura' : undefined, name: w === 'item' || w === 'aura' ? undefined : titleCase(dm[1]), then: deff });
        i++;
        continue;
      }
      const cl = i + 1 < sentences.length ? parseClash(sentences[i], sentences[i + 1]) : null;
      if (cl) {
        (cl.timing === 'defend' ? sc.onDefend : sc.onAttack).push(cl.effect);
        i++;
        continue;
      }
      // allies attack through an activated ability, so their "you may" costs are on-attack abilities, not play costs
      const opt = i + 1 < sentences.length && !c.types.includes('Ally') ? parseOptional(sentences[i], sentences[i + 1]) : null;
      if (opt && !sc.optional) {
        sc.optional = opt;
        i++;
        continue;
      }
      // "If this deals damage, you may <cost>." + "If you do, <effect>." (an attack: when it hits; a spell: if its arcane damage got through)
      const dd = i + 1 < sentences.length ? sentences[i].match(/^if this deals damage, (you may .+)$/i) : null;
      const ddMay = dd && parseMayThen(dd[1], sentences[i + 1]);
      if (ddMay) {
        if (isAttack) sc.onHit.push(ddMay.effect);
        else sc.conditional.push({ when: 'if', cond: { kind: 'dealtArcane' }, effects: [ddMay.effect] });
        i++;
        continue;
      }
      const may = i + 1 < sentences.length ? parseMayThen(sentences[i], sentences[i + 1]) : null;
      if (may && (may.list !== 'onHit' || isAttack || c.types.includes('Ally'))) {
        sc[may.list].push(may.effect);
        i++;
        continue;
      }
      const before = sc.unparsed.length;
      handleSentence(sc, sentences[i], isAttack, isPermanentLike);
      // a permanent's triggered ability nothing else understood
      const lastHere = i + 1 >= sentences.length;
      const nextLineFirst = lastHere && li + 1 < lines.length ? lines[li + 1].split(/(?<=\.)\s+(?=[A-Z])/)[0] : undefined;
      const trig = sc.unparsed.length > before && isPermanentLike && !isAttack ? parseTrigger(sentences[i], sentences[i + 1] ?? nextLineFirst) : null;
      if (trig) {
        sc.unparsed.length = before;
        (sc.triggers ??= []).push(...trig.triggers);
        if (trig.usedNext && !lastHere) i++;
        else if (trig.usedNext && nextLineFirst) {
          // the payoff was the next line's first sentence
          lines[li + 1] = lines[li + 1].slice(nextLineFirst.length).trim();
          if (!lines[li + 1]) lines.splice(li + 1, 1);
        }
      }
    }
  }
  return finish(sc, c);
}

/** what a permanent's "when / whenever / at the beginning of ..." ability waits for */
export type TriggerEvent =
  | 'startTurn' | 'actionPhase' | 'endPhase' | 'chainClose' | 'leaves'
  | 'playAttackAction' | 'weaponAttack' | 'playAction' | 'playNonAttackAction' | 'playAura'
  | 'hit' | 'beatChest' | 'winWager' | 'boost';

export interface Trigger {
  on: TriggerEvent;
  /** 'hit' / attacks: which attacks count ("a sword attack you control hits") */
  filter?: AttackFilter;
  /** "Once per turn, ..." */
  once?: boolean;
  effects: Effect[];
  text: string;
}

const PLAY_EVENTS: Record<string, TriggerEvent> = {
  'an attack action card': 'playAttackAction', 'an action card': 'playAction', 'a non-attack action card': 'playNonAttackAction', 'an aura': 'playAura',
};

/** "Whenever you play an attack action card" -> the events it waits for, or null */
export function parseTriggerHead(raw: string): { on: TriggerEvent[]; filter?: AttackFilter; once?: boolean } | null {
  let h = raw.trim().toLowerCase().replace(/\.$/, '');
  let once: boolean | undefined;
  if (h.startsWith('once per turn, ')) { once = true; h = h.slice('once per turn, '.length); }
  let m: RegExpMatchArray | null;
  const one = (on: TriggerEvent, filter?: AttackFilter) => ({ on: [on], filter, once });
  if (/^at the start of your turn$/.test(h)) return one('startTurn');
  if (/^at the (?:beginning|start) of your action phase$/.test(h)) return one('actionPhase');
  if (/^at the beginning of your end phase$/.test(h)) return one('endPhase');
  if (/^when the combat chain closes$/.test(h)) return one('chainClose');
  if (/^when this leaves the arena$/.test(h)) return one('leaves');
  if (/^whenever you beat chest$/.test(h)) return one('beatChest');
  if (/^whenever you win a wager$/.test(h)) return one('winWager');
  if (/^whenever you boost$/.test(h)) return one('boost');
  if (/^when(?:ever)? you activate a weapon attack$/.test(h)) return one('weaponAttack');
  if (/^when(?:ever)? you play an attack action card or activate a weapon attack$/.test(h)) return { on: ['playAttackAction', 'weaponAttack'], once };
  if (/^at the beginning of your action phase or when you play an attack action card$/.test(h)) return { on: ['actionPhase', 'playAttackAction'], once };
  if ((m = h.match(/^when(?:ever)? you play (an attack action card|an action card|a non-attack action card|an aura)$/))) return one(PLAY_EVENTS[m[1]]);
  // "when an attack action card you control hits", "whenever a weapon attack you control hits", "when your sword attack hits", "whenever a dagger you own hits a hero"
  if ((m = h.match(/^when(?:ever)? (?:an?|your) (?:([a-z]+) )?(attack action card|attack|[a-z]+) (?:you (?:control|own) )?hits(?: a hero)?$/))) {
    const word = m[2] === 'attack' || m[2] === 'attack action card' ? (m[1] ?? '') : m[2];
    if (m[2] === 'attack action card' && !m[1]) return one('hit', { kind: 'attackAction' });
    const f = parseFilter(/^[a-z]/.test(word) && CLASS_WORDS.some((c) => c.toLowerCase() === word) ? CLASS_WORDS.find((c) => c.toLowerCase() === word)! : word);
    if (f) return one('hit', f);
  }
  return null;
}

/** A permanent's triggered ability: "<head>, <effects>" (or "<head>, you may <cost>." + "If you do, <effects>.") */
export function parseTrigger(sent: string, next?: string): { triggers: Trigger[]; usedNext: boolean } | null {
  const ms = sent.match(/^((?:once per turn, )?(?:when|whenever|at the beginning of|at the start of) [^,]+?), (.+?)\.?$/i);
  if (!ms) return null;
  const head = parseTriggerHead(ms[1]);
  if (!head) return null;
  let effects = parseEffect(ms[2]);
  let usedNext = false;
  if (effects && next && /^remove (?:a|an) \w+ counter from this\.?$/i.test(ms[2]) && /^if you do/i.test(next)) effects = null; // its payoff is on the next sentence
  const rc = ms[2].match(/^remove (?:a|an) (\w+) counter from this\.?$/i);
  const rcThen = rc && next?.match(/^if you do,? (.+?)\.?$/i);
  const rcEff = rcThen && parseEffect(rcThen[1]);
  if (rc && rcEff) { effects = [{ kind: 'removeCounter', counter: rc[1].toLowerCase(), then: rcEff }]; usedNext = true; }
  if (!effects && next) {
    const may = parseMayThen(ms[2], next);
    if (may && may.list === 'onPlay') { effects = [may.effect]; usedNext = true; }
  }
  if (!effects) return null;
  const text = ms[2].replace(/\.$/, '');
  return { triggers: head.on.map((on) => ({ on, filter: head.filter, once: head.once, effects: effects!, text })), usedNext };
}

/** "When this hits, you may <cost>." + "If you do, <effects>." as an effect on the matching trigger */
export function parseMayThen(a: string, b: string): { list: 'onHit' | 'onAttack' | 'onDefend' | 'onPlay'; effect: Effect } | null {
  const ma = a.match(/^(?:(when this hits(?: a hero)?|when this attacks|when this defends|when you play this),? )?(you may )?(.+?)\.?$/i);
  if (!ma) return null;
  if (!ma[2] && !/^when this defends/i.test(ma[1] ?? '')) return null; // without "you may" only the defend cost lines (Sunkwater)
  const mb = b.match(/^if you do,? (.+?)\.?$/i);
  if (!mb) return null;
  const cost = parseOptionalCost(ma[3]);
  const then = cost && parseEffect(mb[1]);
  if (!cost || !then) return null;
  const w = (ma[1] ?? '').toLowerCase();
  const list = w.startsWith('when this hits') ? 'onHit' : w === 'when this attacks' ? 'onAttack' : w === 'when this defends' ? 'onDefend' : 'onPlay';
  return { list, effect: { kind: 'mayThen', cost, then, text: `${ma[3].replace(/\.$/, '')} to ${mb[1].replace(/\.$/, '')}` } };
}

/** "When this defends, clash with the attacking hero." + "The winner creates a Vigor token." / "If you win, ..." */
function parseClash(a: string, b: string): { timing: 'attack' | 'defend'; effect: Effect } | null {
  const ma = a.match(/^when this (attacks|defends)( a guardian attack)?, clash with the (?:attacking|defending) hero\.?$/i);
  if (!ma) return null;
  const timing = ma[1].toLowerCase() === 'defends' ? 'defend' : 'attack';
  const guardianOnly = !!ma[2] || undefined;
  let m: RegExpMatchArray | null;
  if ((m = b.match(/^[Tt]he winner creates (?:a|an) ([A-Z][\w' ]*?) token\.?$/))) return { timing, effect: { kind: 'clash', winnerToken: m[1], guardianOnly } };
  if ((m = b.match(/^if you win, (.+?)\.?$/i))) {
    const e = parseEffect(m[1]);
    if (e) return { timing, effect: { kind: 'clash', ifWin: e, guardianOnly } };
  }
  return null;
}

/** Keep a quoted grant ("When this attacks, ... . The winner ...") in one sentence. */
function joinQuotes(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.match(/"/g) ?? []).length % 2 === 1) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

function handleSentence(sc: CardScript, sent: string, isAttack: boolean, isPermanentLike: boolean) {
  if (!sent) return;
  if (keywordSentence(sc, sent)) return;
  let m: RegExpMatchArray | null;
  if (/^damage that would be dealt by this can't be prevented\.?$/i.test(sent)) { sc.unpreventable = true; return; }
  sent = sent.replace(/^evo upgrade - /i, '');
  if ((m = sent.match(/^whenever this fragments, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onFragment.push(...e);
  }
  if ((m = sent.match(/^if you have a base (head|chest|arms|legs) equipped, transform it into this, then equip this\.?$/i))) { sc.evoSlot = titleCase(m[1]); return; }
  if ((m = sent.match(/^this gets \+(\d+)\{p\} for each evo you have equipped\.?$/i)) && isAttack) { sc.onAttack.push({ kind: 'perEvoPower', amount: +m[1] }); return; }
  if (/^defense reactions?(?: cards)? can't be played this chain link\.?$/i.test(sent) && isAttack) { sc.onAttack.push({ kind: 'noDefenseReactions' }); return; }
  if (/^this can't be played from (?:your )?hand\.?$/i.test(sent)) { sc.noFromHand = true; return; }
  if ((m = sent.match(/^(?:this gets \+(\d+)\{d\} while defending a weapon attack|while this is defending a weapon attack, this gets \+(\d+)\{d\})\.?$/i))) {
    sc.defendBonus = { amount: +(m[1] ?? m[2]), when: 'weaponAttack' }; return;
  }
  if ((m = sent.match(/^if an attack reaction has been played or activated this chain link, this gets \+(\d+)\{d\}\.?$/i))) {
    sc.defendBonus = { amount: +m[1], when: 'reactionThisLink' }; return;
  }
  if ((m = sent.match(/^(?:your )?(attack action|non-attack action) cards(?: you control)? get \+(\d+)\{d\} while defending\.?$/i))) {
    sc.grantDefend = { amount: +m[2], cards: m[1].toLowerCase() === 'attack action' ? 'attackAction' : 'nonAttackAction' }; return;
  }
  if ((m = sent.match(/^whenever the crowd (cheers|boos) you, (.+)$/i))) {
    const e = parseEffect(m[2]);
    if (e) return void (m[1].toLowerCase() === 'cheers' ? sc.onCheer : sc.onBoo).push(...e);
  }
  // "The winner creates a Flurry token." belongs to the wager before it
  if ((m = sent.match(/^the winner (draws (a|two|\d+) cards?|creates (?:a|an) ([a-z][\w ]*?) token)\.?$/i))) {
    const w = [...sc.onPlay, ...sc.onAttack].reverse().find((x) => x.kind === 'wager');
    if (w && w.kind === 'wager') { if (m[3]) w.tokens.push(m[3]); else w.winnerDraw = toNum(m[2].toLowerCase()); return; }
  }
  if ((m = sent.match(/^when this attacks or defends, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) { sc.onAttack.push(...e); sc.onDefend.push(...e); return; }
  }
  if ((m = sent.match(/^when this (attacks|hits) an? (revered|reviled) hero, (.+)$/i))) {
    const e = parseEffect(m[3]);
    if (e) return void (m[1].toLowerCase() === 'attacks' ? sc.onAttack : sc.onHit).push({ kind: 'ifCond', cond: { kind: 'oppTalent', talent: titleCase(m[2]) }, effects: e });
  }
  if ((m = sent.match(/^when this attacks a marked hero, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onAttack.push({ kind: 'ifCond', cond: { kind: 'attackingMarked' }, effects: e });
  }
  if ((m = sent.match(/^whenever this defends, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onDefend.push(...e);
  }
  if (/^at the beginning of your end phase, put a -1\{d\} counter on this\.?$/i.test(sent)) { sc.endPhaseWear = true; return; }
  if (/^at the beginning of your end phase, destroy this\.?$/i.test(sent)) { sc.destroyAtEnd = true; return; }
  if (/^you may equip this\.?$/i.test(sent)) return; // event equipment: the event deck offers to equip it
  // "You may play it this turn." belongs to the effect before it that banished or created the card
  if (/^you may play it this turn\.?$/i.test(sent)) {
    const host = findHost(sc, (e) => e.kind === 'createInBanished' || e.kind === 'banishFromGrave');
    if (host) { host.push({ kind: 'playLastBanished' }); return; }
  }
  if (/^when this attacks a hero, you may have target dagger you control deal 1 damage to them\.?$/i.test(sent)) { sc.onAttack.push({ kind: 'daggerStrike' }); return; }
  if (/^(if damage is dealt this way, the dagger has hit|destroy the dagger)\.?$/i.test(sent) && sc.onAttack.some((e) => e.kind === 'daggerStrike')) return;
  if ((m = sent.match(/^while this is in your graveyard, at the start of your turn, you may destroy (\d+) silver you control\.?$/i))) { sc.graveEquip = +m[1]; return; }
  if (/^if you do, equip this\.?$/i.test(sent) && sc.graveEquip) return;
  if (/^when this is equipped from anywhere other than your graveyard, put a -1\{d\} counter on it\.?$/i.test(sent)) { sc.equipCounter = true; return; }
  if ((m = sent.match(/^[Ii]f you prevent damage this way, create (?:a|an) ([A-Z][\w' ]*?) token\.?$/))) {
    const last = [...sc.onPlay, ...sc.activations.flatMap((a) => a.effects)].reverse().find((e) => e.kind === 'preventNext');
    if (last && last.kind === 'preventNext') { last.thenToken = m[1]; return; }
  }
  if ((m = sent.match(/^when this is pitched, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void (sc.onPitch ??= []).push(...e);
  }
  if ((m = sent.match(/^when this enters the arena, (.+)$/i)) && isPermanentLike) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onPlay.push(...e);
  }
  if ((m = sent.match(/^if you would be dealt damage, you may banish this to prevent (\d+) of that damage\.?$/i))) { sc.banishPrevent = +m[1]; return; }
  if ((m = sent.match(/^contract - you are contracted to banish opponents' (non-action cards|attack action cards|non-attack action cards|red cards|yellow cards|blue cards|reaction cards|cards with 2 or less \{d\}|cards with cost 1 or less|cards with cost 2 or more|cards with base go again)\.?$/i))) {
    sc.contract = ({ 'non-action cards': 'nonAction', 'attack action cards': 'attackAction', 'non-attack action cards': 'nonAttackAction', 'red cards': 'red', 'yellow cards': 'yellow', 'blue cards': 'blue', 'reaction cards': 'reaction', 'cards with 2 or less {d}': 'lowDefense', 'cards with cost 1 or less': 'cheap', 'cards with cost 2 or more': 'costly', 'cards with base go again': 'goAgain' } as const)[m[1].toLowerCase() as 'red cards'];
    return;
  }
  if (/^whenever you complete this contract, create a silver token\.?$/i.test(sent) && sc.contract) return;
  if ((m = sent.match(/^when this attacks, the next attack with (\w+) you play this combat chain gets go again\.?$/i))) { sc.onAttack.push({ kind: 'nextAttackGoAgain', filter: { kind: 'keyword', value: titleCase(m[1]) } }); return; }
  if (/^when this attacks, create runechant tokens equal to the number of non-attack action cards you've played this turn\.?$/i.test(sent)) { sc.onAttack.push({ kind: 'runechantsPerNonAttack' }); return; }
  if (/^if 3 or more runechants are created this way, this gets go again\.?$/i.test(sent)) {
    const r = sc.onAttack.find((x) => x.kind === 'runechantsPerNonAttack');
    if (r && r.kind === 'runechantsPerNonAttack') { r.goAgainAt = 3; return; }
  }
  if (/^the second time this hits each turn, put a \+1\{p\} counter on it\.?$/i.test(sent)) { sc.secondHitCounter = true; return; }
  if (/^at the beginning of your end phase, if this hasn't hit this turn, remove all \+1\{p\} counters from it\.?$/i.test(sent) && sc.secondHitCounter) return;
  if ((m = sent.match(/^as an additional cost to play this, banish (\d+) cards from your hero's soul\.?$/i))) { sc.additionalCost.banishSoul = +m[1]; return; }
  if ((m = sent.match(/^this may only defend an attack if the attack's controller has (?:destroyed (?:a|an) (might|agility|vigor) token|(drawn a card)) this turn\.?$/i))) {
    sc.defendIf = m[1] ? { token: titleCase(m[1]) } : { drew: true }; return;
  }
  if (/^as an additional cost to play this, put a card from your hand on the bottom of your deck\.?$/i.test(sent)) { sc.additionalCost.handToBottom = 1; return; }
  if (/^this gets -x\{p\}, where x is the pitch value of the card revealed this way\.?$/i.test(sent)) {
    const r = sc.onAttack.find((x) => x.kind === 'revealTop');
    if (r && r.kind === 'revealTop') { r.minusPitch = true; return; }
  }
  // Righteous Cleansing's second sentence belongs to "look at the top 5 cards of their deck"
  if (/^banish 1 or more cards with the same name from among them, then put the rest on top in any order\.?$/i.test(sent) && sc.conditional.some((c) => c.effects.some((e) => e.kind === 'cleanseTop'))) return;
  if ((m = sent.match(/^when this attacks a hero, (.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onAttack.push(...e);
  }
  // keyword-labelled conditions ("Rupture - If ...", "Starfall - If ...", "High Tide - If ...", "Reprise - If ...")
  sent = sent.replace(/^(?:rupture|starfall|high tide|reprise) - (?=if )/i, '');
  if ((m = sent.match(/^when this defends, (.+)$/i)) && !/^when this defends, (?:you may|clash)/i.test(sent)) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onDefend.push(...e);
  }
  if ((m = sent.match(/^play this only if (.+?)\.?$/i))) {
    const t = m[1].toLowerCase();
    const pm = t.match(/^you've pitched a card with (\d+) or more \{p\} this turn$/);
    const cond = pm ? { kind: 'pitchPower' as const, n: +pm[1] } : parseCondition(m[1]);
    if (cond) return void (sc.playIf = cond);
  }
  if ((m = sent.match(/^as an additional cost to play this, you may charge your hero's soul\.?$/i)) && !sc.optional) {
    sc.optional = { timing: 'play', cost: { kind: 'charge' }, effects: [], costText: "charge your hero's soul", effectText: 'charged' };
    return;
  }
  if (/^you may put your revealed card on the bottom of its owner's deck\.?$/i.test(sent)) return; // clash: the card stays on top
  if ((m = sent.match(/^if (?:a card with (\d+) or more \{p\} is banished this way|the discarded card has (\d+) or more \{p\}), (.+)$/i)) && (sc.additionalCost.banishGraveyard || sc.additionalCost.discardRandom)) {
    const e = parseEffect(m[3]);
    if (e) return void sc.conditional.push({ when: 'additional', threshold: +(m[1] ?? m[2]), effects: e });
  }
  if ((m = sent.match(/^if (.+?), instead (.+)$/i))) {
    const cond = parseCondition(m[1]);
    const e = cond && parseEffect(m[2]);
    if (cond && e && !isAttack) return void sc.conditional.push({ when: 'instead', cond, effects: e });
  }
  if ((m = sent.replace(/^combo - /i, '').match(/^when this attacks, if (.+?), (.+)$/i))) {
    const cond = parseCondition(m[1]);
    const e = cond && parseEffect(m[2]);
    if (cond && e) return void sc.conditional.push({ when: LINK_CONDITIONS.has(cond.kind) ? 'ifLink' : 'if', cond, effects: e });
  }
  if ((m = sent.match(/^if a card with (\d+) or more \{p\} is discarded this way, (.+)$/i))) {
    const host = [...sc.onAttack, ...sc.onPlay].reverse().find((x) => x.kind === 'discardRandom');
    const e = parseEffect(m[2]);
    if (host && host.kind === 'discardRandom' && e) { host.ifPower = +m[1]; host.then = e; return; }
  }
  if ((m = sent.match(/^at the start of your turn, destroy this,? (?:and |then )(.+)$/i))) {
    const e = parseEffect(m[1]);
    if (e) { sc.destroyAt = 'startOfTurn'; return void sc.onDestroy.push(...e); }
  }
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
  if ((m = sent.match(/^when this hits(?: a hero)?, put it into your soul and (.+?)\.?$/i))) {
    const e = parseEffect(m[1]);
    if (e) { sc.hitDestination = 'soul'; sc.onHit.push(...e); return; }
  }
  if ((m = sent.match(/^when this hits an? ([A-Z][a-z]+) hero, (.+?)\.?$/)) && isAttack && (CLASS_WORDS.includes(m[1]) || HERO_CLASSES.includes(m[1]))) {
    const e = parseEffect(m[2]);
    if (e) return void sc.onHit.push({ kind: 'ifOppClass', cls: m[1], then: e });
  }
  if ((m = sent.match(/^[Ww]hen the combat chain closes, if this didn't hit, the defending hero creates (?:a|an) ([A-Z][\w' ]*?) token\.?$/)) && isAttack) { sc.closeMissToken = m[1]; return; }
  if ((m = sent.match(/^the first time this deals damage to a hero, (.+?)\.?$/i)) && isAttack) {
    const e = parseEffect(m[1]);
    if (e) return void sc.onHit.push(...e);
  }
  if (/^when this hits(?: a hero)?, put it on the bottom of its owner's deck\.?$/i.test(sent)) { sc.hitDestination = 'deckBottom'; return; }
  if (/^this can't be defended by equipment\.?$/i.test(sent)) { sc.noEquipDefense = true; return; }
  if (/^this costs \{r\} less to play for each draconic chain link you control\.?$/i.test(sent)) { sc.costLessPer = 'draconicLink'; return; }
  if ((m = sent.match(/^if you control (?:a|an) ([a-z' ]+), this costs \{r\} less to play\.?$/i))) { sc.costLessIf = titleCase(m[1]); return; }
  if ((m = sent.match(/^when this (?:is destroyed|leaves the arena), (.+)$/i))) {
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

/** The effect list (anywhere in the script, including conditionals) whose last effect matches. */
function findHost(sc: CardScript, pred: (e: Effect) => boolean): Effect[] | null {
  const lists: Effect[][] = [sc.onPlay, sc.onAttack, sc.onHit, ...sc.conditional.map((c) => c.effects), ...sc.activations.map((a) => a.effects)];
  const walk = (list: Effect[]): Effect[] | null => {
    for (const e of list) if (e.kind === 'ifCond') { const r = walk(e.effects); if (r) return r; }
    return list.length && pred(list[list.length - 1]) ? list : null;
  };
  for (const l of lists.reverse()) { const r = walk(l); if (r) return r; }
  return null;
}

function finish(sc: CardScript, c: Card): CardScript {
  const meaningful = c.text.trim().length > 0;
  if (!meaningful || sc.unparsed.length === 0) sc.coverage = 'full';
  else {
    const parsedSomething =
      sc.onPlay.length + sc.onHit.length + sc.onAttack.length + sc.conditional.length + sc.activations.length + sc.modes.length + sc.onDestroy.length > 0 ||
      !!sc.optional || !!sc.handActivation || !!sc.triggers?.length || !!sc.onPitch?.length || sc.onDefend.length > 0 ||
      sc.goAgain || sc.dominate || sc.ward > 0;
    sc.coverage = parsedSomething ? 'partial' : 'none';
  }
  return sc;
}

export function describeFilter(f: AttackFilter): string {
  switch (f.kind) {
    case 'any': return 'attack';
    case 'keyword': return `attack with ${f.value.toLowerCase()}`;
    case 'attackAction': return 'attack action card';
    case 'ally': return 'ally attack';
    case 'weapon': return 'weapon attack';
    case 'subtype': return `${f.value} attack`;
    case 'class': return `${f.value} attack`;
    case 'anyClass': return `${f.values.join(' or ')} attack`;
    case 'boosted': return 'attack you boost';
    case 'runeGated': return 'attack action card you rune gate';
    case 'classAttackAction': return `${f.value} attack action card`;
  }
}
