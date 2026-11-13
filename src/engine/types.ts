import type { AttackFilter, Effect } from './cardScript';

export type PlayerId = 0 | 1;
/** 'goldfish' = an opponent that never acts (for testing decks in the sandbox) */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'mythic' | 'goldfish';

export interface CardInst {
  uid: number;
  cardId: string;
  owner: PlayerId;
}

export interface EquipState {
  inst: CardInst;
  defenseMod: number; // negative counters (battleworn / temper)
  destroyed: boolean;
  usedThisTurn: boolean;
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
}

export type TurnEffect =
  | { kind: 'nextAttackPower'; amount: number; filter: AttackFilter; source: string }
  | { kind: 'nextAttackGoAgain'; filter: AttackFilter; source: string }
  | { kind: 'nextAttackOnHit'; filter: AttackFilter; effects: import('../engine/cardScript').Effect[]; source: string }
  | { kind: 'preventNext'; amount: number; source: string }
  | { kind: 'ampArcane'; amount: number; source: string };

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
}

export interface Defender {
  kind: 'hand' | 'equipment' | 'reaction';
  inst: CardInst;
  defense: number;
}

export interface ChainLink {
  attacker: PlayerId;
  inst: CardInst; // attack card or weapon
  fromWeapon: boolean;
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
  destination?: 'soul' | 'deckBottom';
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

export interface GameState {
  seed: number;
  nextUid: number;
  turn: number;
  turnPlayer: PlayerId;
  phase: Phase;
  priority: PlayerId; // who must act now
  passes: number; // consecutive passes in reaction step
  players: [PlayerState, PlayerState];
  chain: ChainLink[];
  chainOpen: boolean;
  winner: PlayerId | null;
  log: LogEntry[];
  /** layers waiting to resolve, last = top (only used in the action phase) */
  stack?: Layer[];
  format: string;
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
