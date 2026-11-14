import type { AttackFilter, Effect } from './cardScript';

/** seats around the table: 2 players normally, up to 4 in Ultimate Pit Fight */
export type PlayerId = 0 | 1 | 2 | 3;
/** 'goldfish' = an opponent that never acts (for testing decks in the sandbox) */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'mythic' | 'goldfish';

export interface CardInst {
  uid: number;
  cardId: string;
  owner: PlayerId;
  /** an arrow with an aim counter */
  aim?: boolean;
  /** turned face-up in the arsenal */
  faceUp?: boolean;
  /** watery grave: turned face-down in the graveyard */
  faceDown?: boolean;
}

export interface EquipState {
  inst: CardInst;
  defenseMod: number; // negative counters (battleworn / temper)
  destroyed: boolean;
  usedThisTurn: boolean;
  /** quell was used: destroyed at the beginning of the end phase */
  quelled?: boolean;
  /** Cloaked: equipped face-down (can't defend, abilities off, opponents can't see it) */
  faceDown?: boolean;
}

export interface WeaponState {
  inst: CardInst;
  usedThisTurn: boolean;
  /** +1{p} counters (sharpen) */
  counters?: number;
}

export interface PermanentState {
  inst: CardInst;
  ward: number;
  steam?: number; // Mechanologist steam counters
  counters?: number; // sandbox: generic counters
  suspense?: number; // suspense counters
  quelled?: boolean; // quell was used: destroyed at the beginning of the end phase
  /** damage marked on an ally (it's destroyed when this reaches its life) */
  damage?: number;
  /** stolen: goes back to this player at the end of the action phase */
  returnTo?: PlayerId;
  /** {t}: tapped until its controller's next turn */
  tapped?: boolean;
}

export type TurnEffect =
  | { kind: 'nextAttackPower'; amount: number; filter: AttackFilter; source: string }
  | { kind: 'nextAttackGoAgain'; filter: AttackFilter; source: string }
  | { kind: 'nextAttackOnHit'; filter: AttackFilter; effects: import('../engine/cardScript').Effect[]; source: string }
  | { kind: 'preventNext'; amount: number; source: string; thenToken?: string }
  | { kind: 'preventArcane'; amount: number; source: string }
  | { kind: 'ampArcane'; amount: number; source: string }
  | { kind: 'nextAttackOnAttack'; filter: AttackFilter; effects: import('../engine/cardScript').Effect[]; source: string }
  | { kind: 'nextWagerPower'; amount: number; overpower?: boolean; source: string }
  /** "your next Guardian attack action card this turn costs {r} less" (Seismic Surge) */
  | { kind: 'costLess'; amount: number; filter: AttackFilter; source: string }
  | { kind: 'nextAttackDominate'; source: string }
  /** every attack matching the filter this turn */
  | { kind: 'turnAttackPower'; amount: number; filter: AttackFilter; source: string }
  | { kind: 'turnAttackDominate'; source: string }
  | { kind: 'turnAttackGoAgain'; filter: AttackFilter; source: string }
  /** the next attack gets +X{p} when it attacks, X = Gold you control (Benefactor of Bloodworth Goldmane) */
  | { kind: 'nextAttackGoldPower'; source: string };

export interface PlayerState {
  id: PlayerId;
  name: string;
  isBot: boolean;
  difficulty: Difficulty;
  hero: CardInst;
  life: number;
  intellect: number;
  deck: CardInst[];
  hand: CardInst[];
  arsenal: CardInst[];
  pitch: CardInst[];
  graveyard: CardInst[];
  banished: CardInst[];
  intimidated: CardInst[];
  /** {t} your hero: tapped until this player's next turn */
  heroTapped?: boolean;
  /** counters on the hero card (e.g. Blaze's energy counters) */
  heroCounters?: number;
  /** knocked out of a multiplayer game */
  eliminated?: boolean;
  /** the opponent this player has chosen to attack next (multiplayer) */
  focus?: PlayerId;
  /** Shiyana: the hero she is copying until the start of her next turn */
  copyOf?: string;
  /** Arakni, Marionette became an Agent of Chaos: the hero card it returns to ("return to the brood") */
  broodOf?: string;
  /** cards outside the game this player may fetch (unused Classic Constructed pool: equipment, Tomes) */
  inventory?: string[];
  /** Yoji: the next damage to this hero this turn is dealt to that player instead (1 of it prevented) */
  redirectTo?: PlayerId;
  /** extra intellect until the end of this player's next turn (The Librarian) */
  bonusIntellect?: number;
  /** Let Me Buy You a Drink: this player's attacks on `from` get -2{p} until the start of `from`'s next turn */
  drinkFrom?: PlayerId;
  /** Pit Fight memory for the bots: how much each opponent has attacked this player lately */
  attackedBy?: Partial<Record<PlayerId, number>>;
  /** penalties for this player's next turn (Crush cards): applied at the start of it */
  nextTurn?: { attackPower?: number; costMore?: number; noDraw?: boolean; noGoAgain?: boolean; noSmallAttacks?: boolean };
  weapons: WeaponState[];
  equipment: EquipState[];
  permanents: PermanentState[]; // auras, items, allies, tokens
  resources: number;
  actionPoints: number;
  effects: TurnEffect[];
  marked: boolean;
  turn: TurnInfo;
  /** cards put into the soul (Light heroes); public */
  soul?: CardInst[];
}

/** Per-turn bookkeeping (reset for both players at the start of every turn). */
export interface TurnInfo {
  attacks: number;
  attackActionHits: number;
  weaponHits: number;
  played: string[]; // card ids played this turn
  drew: boolean;
  boosted: boolean;
  flags: Record<string, number>;
  auraPlayed?: boolean;
  arcaneDealt?: boolean;
  discardedPower?: number; // highest power discarded this turn
  itemDestroyed?: boolean;
  weaponAttacked?: boolean;
  intimidated?: boolean;
  attackedTimes?: number; // attacks made against this player this turn
  /** order (uids) to put pitched cards on the bottom of the deck at end of turn, first = goes in first */
  pitchOrder?: number[];
  charged?: boolean;
  instantToGrave?: boolean;
  arcaneTaken?: boolean;
  clashesWon?: number;
  cheers?: number;
  beatChest?: boolean;
  boos?: number;
}

export interface Defender {
  kind: 'hand' | 'equipment' | 'reaction';
  inst: CardInst;
  defense: number;
}

export interface ChainLink {
  attacker: PlayerId;
  inst: CardInst; // attack card, weapon or ally
  /** a weapon or an ally attacks (the card stays where it is); see `ally` */
  fromWeapon: boolean;
  /** an ally attacks: like a weapon attack, but it isn't one ("weapon attacks get +1{p}" don't apply) */
  ally?: boolean;
  fromArsenal: boolean;
  basePower: number;
  powerMod: number;
  goAgain: boolean;
  dominate: boolean;
  overpower: boolean;
  piercing: number;
  defenders: Defender[];
  reactions: CardInst[];
  damage: number | null;
  hit: boolean;
  extraOnHit: Effect[];
  noHandDefense?: boolean;
  noEquipDefense?: boolean;
  instants?: number; // instants the attacker played on this link
  reactionCount?: number; // attack reactions played on this link
  destination?: 'soul' | 'deckBottom' | 'hand';
  /** wagers on this attack: when the link resolves, the attacker wins if it hit, otherwise the defender */
  wagers?: { tokens: string[]; winnerDraw?: number; goldSwap?: boolean }[];
  noDefenseReactions?: boolean;
  /** the defending hero (in a two-player game, the attacker's opponent) */
  defender?: PlayerId;
  /** Bolfar: the attack also targets a second hero, who defends it separately */
  also?: { defender: PlayerId; defenders: Defender[]; stage: 'pending' | 'declaring' | 'done'; main?: { defender: PlayerId; defenders: Defender[] } };
  /** attacking an ally (its permanent uid) instead of the hero */
  target?: number;
  unpreventable?: boolean;
}

export type Phase = 'action' | 'defend' | 'reaction' | 'arsenal' | 'gameOver';

/** A card or ability waiting on the stack to resolve (players may respond with instants first). */
export interface Layer {
  controller: PlayerId;
  inst: CardInst;
  kind: 'card' | 'activation';
  index?: number; // activation index
  fromArsenal?: boolean;
  mode?: number;
  /** optional cost paid when it was played: the card used, if any */
  optional?: { accept: boolean; usedId: string | null };
  label: string;
}

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
  /** the rule that explains this event (shown in the log as a tip) */
  rule?: string;
}

/** A decision a player makes in the middle of an effect: which cards to keep on top (opt), what to reload, or yes/no. */
export interface PendingChoice {
  player: PlayerId;
  kind: 'opt' | 'reload' | 'yesno' | 'target' | 'pick';
  /** pick: the confirm button's label, whether it can be skipped, and what a bot picks (null: skip) */
  confirm?: string;
  skippable?: boolean;
  botPick?: number | null;
  /** pick: any number of the options */
  multi?: boolean;
  prompt: string;
  /** the cards involved (opt: the top of your deck; reload: your hand) */
  options: { uid: number; cardId: string }[];
  resume:
    | { type: 'opt' }
    | { type: 'reload' }
    | { type: 'wager'; tokens: string[]; winnerDraw?: number; link: number }
    | { type: 'betsy'; link: number }
    | { type: 'attackTarget'; link: number }
    | { type: 'damageTarget'; amount: number; arcane: boolean; source: string }
    /** a hero ability's "you may": answered by `owner`'s ability (onChoice); bots answer `botYes` */
    | { type: 'hero'; owner: PlayerId; key: string; data?: number[]; botYes: boolean }
    /** "put a card from your hand on the bottom of your deck" as an additional cost (Enlightened Strike) */
    | { type: 'handToBottom' }
    /** a defending card's "you may put a card ... on the bottom. If you do, ..." (Crown of Providence) */
    | { type: 'defendCost'; uid: number }
    /** Righteous Cleansing: banish the cards named like the pick from the top of `target`'s deck */
    | { type: 'cleanse'; target: PlayerId; n: number }
    /** protect `link` with the picked card (skip: don't) */
    | { type: 'protect'; link: number }
    /** Kox: the top of the event deck in the order picked (unpicked ones after) */
    | { type: 'eventOrder' }
    /** a choice an event card asks for (see resolveEventChoice) */
    | { type: 'event'; key: string; data?: number[] }
    /** "you may <cost>. If you do, <then>" (answered yes: pay and resolve) */
    | { type: 'mayThen'; cost: import('../engine/cardScript').OptionalCostKind; then: import('../engine/cardScript').Effect[]; src: CardInst; text: string };
  /** the rest of the effect, run once the choice is made ("Opt 3, then banish the top card") */
  then?: { player: PlayerId; src: CardInst; effects: import('../engine/cardScript').Effect[] }[];
}

export type Macro = 'Treasure Island' | 'Omens of Arcana';

export interface GameState {
  /** an optional table-wide macro card (Treasure Island, Omens of Arcana) */
  macro?: Macro;
  /** Treasure Island's gold counters */
  treasureGold?: number;
  /** Yorick: every hero shares one deck and one graveyard (the players' arrays are the same objects) */
  sharedZones?: boolean;
  /** Pit Fight: the order heroes were knocked out (first out first) */
  knockedOut?: PlayerId[];
  /** Smash Palace event deck (card ids): the turn player reveals the top card at the start of each turn */
  eventDeck?: string[];
  eventDiscard?: string[];
  /** the event revealed this turn */
  lastEvent?: string;
  /** Code of Conduct: this player takes another turn after this one */
  extraTurn?: PlayerId;
  seed: number;
  nextUid: number;
  turn: number;
  turnPlayer: PlayerId;
  phase: Phase;
  priority: PlayerId; // who must act now
  passes: number; // consecutive passes in reaction step
  players: PlayerState[];
  chain: ChainLink[];
  chainOpen: boolean;
  winner: PlayerId | null;
  log: LogEntry[];
  /** layers waiting to resolve, last = top (only used in the action phase) */
  stack?: Layer[];
  format: string;
  /** decisions the game is waiting for (the first one is asked now) */
  pendingChoices?: PendingChoice[];
  /** start-of-turn triggers waiting for their controller to choose an order */
  pendingTriggers?: { player: PlayerId; uids: number[] };
}

export type Action =
  | { type: 'play'; uid: number; pitch: number[]; mode?: number; optional?: OptionalChoice }
  | { type: 'activate'; uid: number; index: number; pitch: number[] }
  | { type: 'pass'; pitchOrder?: number[] }
  | { type: 'defend'; uids: number[]; boosts?: number[]; pitch?: number[] }
  | { type: 'arsenal'; uid: number | null; pitchOrder?: number[] }
  | { type: 'concede' }
  | { type: 'orderTriggers'; order: number[] }
  | { type: 'choose'; picks?: number[]; yes?: boolean }
  /** Heave: at the end of your turn, pay to put a card from hand face-up into your arsenal */
  | { type: 'heave'; uid: number; pitch: number[] }
  /** multiplayer: choose which opponent you'll attack next */
  | { type: 'focus'; player: PlayerId }
  | ManualAction;

export type ManualAction =
  | { type: 'manual'; op: 'draw'; player: PlayerId }
  | { type: 'manual'; op: 'life'; player: PlayerId; amount: number }
  | { type: 'manual'; op: 'resource'; player: PlayerId; amount: number }
  | { type: 'manual'; op: 'actionPoint'; player: PlayerId; amount: number }
  | { type: 'manual'; op: 'power'; amount: number }
  | { type: 'manual'; op: 'discard'; player: PlayerId; uid: number }
  | { type: 'manual'; op: 'returnFromGraveyard'; player: PlayerId; uid: number }
  | { type: 'manual'; op: 'token'; player: PlayerId; name: string }
  /** sandbox: move any card to any zone */
  | { type: 'manual'; op: 'move'; player: PlayerId; uid: number; to: Zone; bottom?: boolean }
  | { type: 'manual'; op: 'shuffle'; player: PlayerId }
  /** sandbox: +/- counters on a permanent, or defense counters on equipment */
  | { type: 'manual'; op: 'counter'; player: PlayerId; uid: number; amount: number }
  /** sandbox: destroy / restore a piece of equipment */
  | { type: 'manual'; op: 'equipment'; player: PlayerId; uid: number; destroyed: boolean };

export type Zone = 'hand' | 'arsenal' | 'pitch' | 'graveyard' | 'banished' | 'deck' | 'soul' | 'arena';

/** The player's answer to a card's "you may <cost>. If you do, <effect>" when playing it. */
export interface OptionalChoice {
  accept: boolean;
  /** the card from hand used to pay (discard / put on the bottom / banish) */
  uid?: number;
  /** for "discard a card or destroy the top card of your deck": true = destroy the top card */
  top?: boolean;
}
