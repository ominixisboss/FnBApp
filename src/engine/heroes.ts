// Hero abilities. Each ability is matched by the hero's rules text, so young and
// adult versions of a hero that share text share an implementation.
import type { Card } from '../data/types';
import { card, findCard, has } from '../data/cardDb';
import type { CardInst, ChainLink, GameState, PlayerState } from './types';

/** Engine operations a hero ability may use (provided by game.ts to avoid import cycles). */
export interface HeroApi {
  log(p: PlayerState | null, text: string): void;
  createToken(p: PlayerState, name: string, amount: number): void;
  draw(p: PlayerState, amount: number): void;
  dealDamage(target: PlayerState, amount: number, arcane: boolean, source: string): void;
  startAttack(p: PlayerState, inst: CardInst): void;
  mk(cardId: string, owner: PlayerState): CardInst;
  shuffle<T>(arr: T[]): T[];
  intimidate(target: PlayerState): void;
  /** destroy a permanent you control with this name; false if there is none */
  destroyNamed(p: PlayerState, name: string): boolean;
  discard(p: PlayerState, inst: CardInst): void;
  crowd(p: PlayerState, cheer: boolean): void;
  /** a random number in [0, 1) from the game's seeded generator */
  random(): number;
  /** let a player choose a card from hand for an empty arsenal (Riptide) */
  askReload(p: PlayerState): void;
  /** put an effect on the player's list of "next ..." effects */
  clash(p: PlayerState): PlayerState | null;
  /** ask `chooser` a yes/no question that `owner`'s hero ability answers in onChoice */
  ask(chooser: PlayerState, owner: PlayerState, key: string, prompt: string, botYes: boolean, data?: number[], cards?: string[]): void;
  /** equip an equipment card (replacing what is in its slot) */
  equip(p: PlayerState, cardId: string): void;
  /** the opponents this player may target (Ultimate Pit Fight: only the neighbours) */
  targets(p: PlayerState): PlayerState[];
  /** pay N resources (pitching from hand as needed); false if they can't */
  pay(p: PlayerState, amount: number): boolean;
  /** banish an equipment this player controls */
  removeEquipment(p: PlayerState, uid: number): CardInst | null;
}

export interface HeroCtx {
  s: GameState;
  p: PlayerState; // the hero's controller
  opp: PlayerState;
  api: HeroApi;
}

export interface HeroActivation {
  label: string;
  instant: boolean;
  oncePerTurn: boolean;
  goAgain?: boolean;
  cost(ctx: HeroCtx): number;
  canUse(ctx: HeroCtx): boolean;
  resolve(ctx: HeroCtx): void;
  /** rough value for the AI */
  botValue?(ctx: HeroCtx): number;
}

export interface HeroAbility {
  id: string;
  /** what the simulator does for this hero */
  summary: string;
  /** true if part of the printed text is still not automated */
  partial?: boolean;
  match(text: string): boolean;
  setup?(ctx: HeroCtx): void;
  startOfTurn?(ctx: HeroCtx): void;
  endPhase?(ctx: HeroCtx): void;
  onAttack?(ctx: HeroCtx, link: ChainLink): void;
  onHit?(ctx: HeroCtx, link: ChainLink): void;
  onPlayCard?(ctx: HeroCtx, c: Card): void;
  onDiscard?(ctx: HeroCtx, c: Card): void;
  onOpponentDraw?(ctx: HeroCtx, count: number): void;
  /** card banished from deck by boost; return true if the ability moved it */
  onBoostBanish?(ctx: HeroCtx, inst: CardInst): boolean;
  activationCostMod?(ctx: HeroCtx, source: Card): number;
  onPitch?(ctx: HeroCtx, c: Card): void;
  onCrank?(ctx: HeroCtx): void;
  onCheer?(ctx: HeroCtx): void;
  onBoo?(ctx: HeroCtx): void;
  onWagerWin?(ctx: HeroCtx, link: ChainLink): void;
  onSteal?(ctx: HeroCtx, c: Card): void;
  /** whenever you opt (n = cards looked at) */
  onOpt?(ctx: HeroCtx, n: number): void;
  /** when a chain link you're part of resolves */
  onLinkResolve?(ctx: HeroCtx, link: ChainLink): void;
  /** just before the chain link's damage is worked out (blocks are in) */
  beforeDamage?(ctx: HeroCtx, link: ChainLink): void;
  /** banish the action cards that defended your stealth attacks instead of putting them in the graveyard */
  banishStealthBlockers?: boolean;
  onGainLife?(ctx: HeroCtx, amount: number): void;
  /** change how many tokens are created */
  tokenCount?(ctx: HeroCtx, token: Card, n: number): number;
  onCreateToken?(ctx: HeroCtx, token: Card, n: number): void;
  /** may this card be played as though it were an instant right now? */
  asInstant?(ctx: HeroCtx, c: Card, fromArsenal: boolean): boolean;
  /** does this non-attack action get go again? (consumes the effect) */
  grantGoAgain?(ctx: HeroCtx, c: Card): boolean;
  onActivatePermanent?(ctx: HeroCtx, c: Card): void;
  /** you choose the winner when a clash has none */
  winsTiedClash?: boolean;
  /** extra cost reduction for a card in hand / banished */
  cardCostMod?(ctx: HeroCtx, c: Card): number;
  /** cards you may play from your banished zone */
  playFromBanished?(ctx: HeroCtx, c: Card): boolean;
  /** Levia: skip blood debt this end phase */
  skipBloodDebt?(ctx: HeroCtx): boolean;
  /** Lyath: halve base power / defense */
  halveStats?: boolean;
  pitchToBanished?: boolean;
  activations?: HeroActivation[];
  /** the answer to a question this ability asked with api.ask */
  onChoice?(ctx: HeroCtx, key: string, yes: boolean, data?: number[]): void;
  /** at the start of each opposing hero's turn (Squizzy) */
  opponentStartOfTurn?(ctx: HeroCtx, opp: PlayerState): void;
  /** whenever this player protects another hero (defends an attack that targets them) */
  onProtect?(ctx: HeroCtx): void;
  /** Reya: every card she owns with defense, and equipment with 1+ defense, has protect */
  protectAll?: boolean;
  /** an attack targeting another hero was declared (Taipanis) */
  onOtherAttack?(ctx: HeroCtx, link: ChainLink): void;
  /** another hero destroyed a card they don't control (Theryon) */
  onOtherDestroys?(ctx: HeroCtx, by: PlayerState): void;
  /** equipment you control is banished instead of going to the graveyard (Frankie) */
  banishOwnEquipment?: boolean;
  /** you can't equip weapons (Bolfar) */
  noWeapons?: boolean;
}

const cardOf = (i: CardInst) => card(i.cardId);
const isStealth = (c: Card) => c.keywords.includes('Stealth');
const flag = (p: PlayerState, k: string) => !!p.turn.flags[k];
const setFlag = (p: PlayerState, k: string) => { p.turn.flags[k] = 1; };
const countTokens = (p: PlayerState, name: string) => p.permanents.filter((pm) => cardOf(pm.inst).name === name).length;
const lowestValue = (list: CardInst[]) =>
  [...list].sort((a, b) => (cardOf(b).pitch ?? 0) - (cardOf(a).pitch ?? 0) || Number(cardOf(a).power ?? 0) - Number(cardOf(b).power ?? 0))[0];

export const HERO_ABILITIES: HeroAbility[] = [
  {
    id: 'dorinthea',
    summary: 'The first time your weapon attack hits each turn, that weapon can attack again.',
    match: (t) => t.startsWith('The first time your weapon attack hits each turn, you may attack an additional time'),
    onHit({ p, api }, l) {
      if (!l.fromWeapon || flag(p, 'dori')) return;
      setFlag(p, 'dori');
      const w = p.weapons.find((x) => x.inst.uid === l.inst.uid);
      if (w) { w.usedThisTurn = false; api.log(p, `${p.name}'s hero ability: ${cardOf(w.inst).name} may attack again this turn.`); }
    },
  },
  {
    id: 'stealth-first-go-again',
    summary: 'Your first stealth attack each turn gets go again.',
    match: (t) => /^(your|the) first attack with stealth each turn gets go again/i.test(t),
    onAttack({ p }, l) {
      if (!isStealth(cardOf(l.inst)) || flag(p, 'stealth1')) return;
      setFlag(p, 'stealth1');
      l.goAgain = true;
    },
  },
  {
    id: 'stealth-marked',
    summary: 'Stealth attacks against a marked hero get +1 power and go again on hit.',
    partial: true,
    match: (t) => t.startsWith('Your attacks with stealth that are attacking a marked hero get +1'),
    onAttack({ p, opp, api }, l) {
      if (!isStealth(cardOf(l.inst)) || !opp.marked) return;
      l.powerMod += 1;
      l.extraOnHit.push({ kind: 'thisGoAgain' });
      api.log(p, `${cardOf(l.inst).name} gets +1 power (attacking a marked hero).`);
    },
  },
  {
    id: 'benji',
    summary: 'Attack action cards with 2 or less power can’t be defended by cards from hand; first hit each turn gives your next attack +1 power.',
    match: (t) => t.startsWith('Attack action cards you control with 2 or less {p} can\'t be defended by cards from hand'),
    onAttack(_ctx, l) {
      if (!l.fromWeapon && l.basePower + l.powerMod <= 2) l.noHandDefense = true;
    },
    onHit({ p, api }, l) {
      if (l.fromWeapon || flag(p, 'benji')) return;
      setFlag(p, 'benji');
      p.effects.push({ kind: 'nextAttackPower', amount: 1, filter: { kind: 'any' }, source: 'Benji' });
      api.log(p, 'Benji: your next attack gets +1 power.');
    },
  },
  {
    id: 'bravo',
    summary: 'Action {r}{r}: your attack action cards with cost 3+ get dominate this turn. Go again.',
    match: (t) => t.startsWith('Action - {r}{r}: Until end of turn, your attack action cards with cost 3 or more get dominate'),
    onAttack({ p }, l) {
      if (flag(p, 'bravo') && !l.fromWeapon && Number(cardOf(l.inst).cost ?? 0) >= 3) l.dominate = true;
    },
    activations: [{
      label: 'Cost 3+ attacks get dominate this turn', instant: false, oncePerTurn: false, goAgain: true,
      cost: () => 2,
      canUse: ({ p }) => !flag(p, 'bravo'),
      resolve: ({ p, api }) => { setFlag(p, 'bravo'); api.log(p, 'Bravo: attack action cards with cost 3 or more get dominate this turn.'); },
      botValue: ({ p }) => (p.hand.some((h) => Number(cardOf(h).cost ?? 0) >= 3 && has(cardOf(h), 'Attack')) ? 1.2 : -5),
    }],
  },
  {
    id: 'fealty-on-marked-hit',
    summary: 'Whenever you hit a marked hero, create a Fealty token.',
    partial: true,
    match: (t) => t.startsWith('Whenever you hit a marked hero, create a Fealty token'),
    onHit({ p, opp, api }) {
      if (opp.marked) api.createToken(p, 'Fealty', 1);
    },
    activationCostMod({ p }, source) {
      // Fang: 3+ Fealty → dagger attacks cost 1 less
      return countTokens(p, 'Fealty') >= 3 && cardOf(p.hero).text.includes('dagger attacks cost you') && source.types.includes('Dagger') ? -1 : 0;
    },
  },
  {
    id: 'fai',
    summary: 'Starts with Phoenix Flame in the graveyard; Instant {r}{r}{r} (less per Draconic chain link): return a Phoenix Flame from graveyard to hand.',
    match: (t) => t.startsWith('You may start the game with a Phoenix Flame in your graveyard'),
    setup({ p, api }) {
      const pf = findCard('Phoenix Flame', 1) ?? findCard('Phoenix Flame');
      if (pf) p.graveyard.push(api.mk(pf.id, p));
    },
    activations: [{
      label: 'Return Phoenix Flame to hand', instant: true, oncePerTurn: true,
      cost: ({ s, p }) => Math.max(0, 3 - s.chain.filter((l) => l.attacker === p.id && cardOf(l.inst).types.includes('Draconic')).length),
      canUse: ({ p }) => p.graveyard.some((g) => cardOf(g).name === 'Phoenix Flame'),
      resolve: ({ p, api }) => {
        const i = p.graveyard.findIndex((g) => cardOf(g).name === 'Phoenix Flame');
        if (i >= 0) { p.hand.push(p.graveyard.splice(i, 1)[0]); api.log(p, `${p.name} returns Phoenix Flame to hand.`); }
      },
      botValue: () => 2.5,
    }],
  },
  {
    id: 'ira',
    summary: 'Your second attack each turn gets +1 power.',
    match: (t) => t.startsWith('Your second attack each turn gets +1'),
    onAttack({ p }, l) {
      if (p.turn.attacks === 2) l.powerMod += 1;
    },
  },
  {
    id: 'rhinar',
    summary: 'Whenever you discard a card with 6+ power during your action phase, intimidate.',
    match: (t) => t.startsWith('Whenever you discard a card with 6 or more {p} during your action phase, intimidate'),
    onDiscard({ s, p, opp, api }, c) {
      if (s.turnPlayer === p.id && Number(c.power ?? 0) >= 6) api.intimidate(opp);
    },
  },
  {
    id: 'kayo',
    summary: 'The first time you discard a card with 6+ power each action phase, create a Might token. (Attack cards count +1 power outside the chain.)',
    partial: true,
    match: (t) => t.startsWith('You have 1 weapon zone.\nAttack action cards you own get +1'),
    onDiscard({ s, p, api }, c) {
      const power = Number(c.power ?? 0) + (has(c, 'Attack') && has(c, 'Action') ? 1 : 0);
      if (s.turnPlayer === p.id && power >= 6 && !flag(p, 'kayo')) { setFlag(p, 'kayo'); api.createToken(p, 'Might', 1); }
    },
  },
  {
    id: 'kayo-6',
    summary: 'Instant {r}{r}{r}{r}: your attacking attack action card has 6 base power.',
    partial: true,
    match: (t) => /Instant - \{r\}\{r\}\{r\}\{r\}, \{t\}: Target attack action card you control has 6 base/.test(t),
    activations: [{
      label: 'Attack has 6 base power', instant: true, oncePerTurn: true,
      cost: () => 4,
      canUse: ({ s, p }) => { const l = s.chain[s.chain.length - 1]; return !!l && l.damage === null && l.attacker === p.id && !l.fromWeapon && l.basePower < 6; },
      resolve: ({ s, p, api }) => { const l = s.chain[s.chain.length - 1]; l.basePower = 6; api.log(p, `${cardOf(l.inst).name} now has 6 base power.`); },
      botValue: ({ s }) => { const l = s.chain[s.chain.length - 1]; return l ? (6 - l.basePower) - 2 : -5; },
    }],
  },
  {
    id: 'aurora',
    summary: 'Once per turn Instant {r}{r}: create an Embodiment of Lightning if you played a Lightning card this turn.',
    match: (t) => t.startsWith('Once per Turn Instant - {r}{r}: Create an Embodiment of Lightning token'),
    activations: [{
      label: 'Create Embodiment of Lightning', instant: true, oncePerTurn: true,
      cost: () => 2,
      canUse: ({ p }) => p.turn.played.some((id) => card(id).types.includes('Lightning')),
      resolve: ({ p, api }) => api.createToken(p, 'Embodiment of Lightning', 1),
      botValue: ({ s, p }) => (s.turnPlayer === p.id && p.actionPoints > 0 ? 1.4 : -2),
    }],
  },
  {
    id: 'oscilio',
    summary: 'Once per turn Instant: discard an instant to draw a card.',
    match: (t) => t.startsWith('Once per Turn Instant - Discard an instant: Draw a card'),
    activations: [{
      label: 'Discard an instant: draw a card', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => p.hand.some((h) => has(cardOf(h), 'Instant')),
      resolve: ({ p, api }) => {
        const inst = lowestValue(p.hand.filter((h) => has(cardOf(h), 'Instant')));
        p.hand.splice(p.hand.indexOf(inst), 1);
        p.graveyard.push(inst);
        api.log(p, `${p.name} discards ${cardOf(inst).name}.`);
        api.draw(p, 1);
      },
      botValue: () => 0.4,
    }],
  },
  {
    id: 'terra',
    summary: 'At the beginning of each end phase, if an Earth card is in your pitch zone, pay {r} (from floating resources) to create a Might token.',
    match: (t) => t.startsWith('At the beginning of each end phase, if there is an Earth card in your pitch zone'),
    endPhase({ p, api }) {
      if (p.resources >= 1 && p.pitch.some((x) => cardOf(x).types.includes('Earth'))) {
        p.resources -= 1;
        api.createToken(p, 'Might', 1);
      }
    },
  },
  {
    id: 'vynnset',
    summary: 'At the start of your turn, banish a card from hand (lowest value) to create a Runechant.',
    partial: true,
    match: (t) => t.startsWith('At the start of your turn, banish a card from your hand. If you do, create a Runechant'),
    startOfTurn({ p, api }) {
      if (!p.hand.length) return;
      const inst = lowestValue(p.hand);
      p.hand.splice(p.hand.indexOf(inst), 1);
      p.banished.push(inst);
      api.log(p, `${p.name} banishes ${cardOf(inst).name} from hand.`);
      api.createToken(p, 'Runechant', 1);
    },
  },
  {
    id: 'kavdaen',
    summary: 'Once per turn Action {r}{r}{r}: the hero with the most life loses 1 and creates a Copper; then the hero with the least gains 1. Go again.',
    match: (t) => t.startsWith('Once per Turn Action - {r}{r}{r}: If a hero has more {h} than each other hero'),
    activations: [{
      label: 'Balance life totals', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 3,
      canUse: () => true,
      resolve: ({ p, opp, api }) => {
        if (p.life !== opp.life) {
          const hi = p.life > opp.life ? p : opp;
          hi.life -= 1;
          api.createToken(hi, 'Copper', 1);
          api.log(hi, `${hi.name} loses 1 life (${hi.life}).`);
        }
        if (p.life !== opp.life) {
          const lo = p.life < opp.life ? p : opp;
          lo.life += 1;
          api.log(lo, `${lo.name} gains 1 life (${lo.life}).`);
        }
      },
      botValue: ({ p, opp }) => (opp.life > p.life ? 1.5 : 0.2),
    }],
  },
  {
    id: 'maxx',
    summary: 'Once per turn Action {r}{r}: create a Hyper Driver token if you boosted this turn.',
    partial: true,
    match: (t) => t.startsWith('Once per Turn Action - {r}{r}: Create a Hyper Driver token'),
    activations: [{
      label: 'Create a Hyper Driver', instant: false, oncePerTurn: true,
      cost: () => 2,
      canUse: ({ p }) => p.turn.boosted,
      resolve: ({ p, api }) => api.createToken(p, 'Hyper Driver', 1),
      botValue: () => -1,
    }],
  },
  {
    id: 'data-doll',
    summary: 'Mechanologist items with cost 2 or less banished from your deck (by boost) enter the arena.',
    match: (t) => t.startsWith('Whenever a Mechanologist item with cost 2 or less is put into your banished zone from your deck'),
    onBoostBanish({ p, api }, inst) {
      const c = cardOf(inst);
      if (!(c.types.includes('Mechanologist') && c.types.includes('Item') && Number(c.cost ?? 0) <= 2)) return false;
      p.permanents.push({ inst, ward: 0 });
      api.log(p, `${c.name} enters the arena (Data Doll).`);
      return true;
    },
  },
  {
    id: 'kassai',
    summary: 'If you’ve drawn a card this turn, your sword attacks cost {r} less.',
    partial: true,
    match: (t) => t.startsWith('If you\'ve drawn a card this turn, your sword attacks cost {r} less'),
    activationCostMod: ({ p }, source) => (p.turn.drew && source.types.includes('Sword') ? -1 : 0),
  },
  {
    id: 'tuffnut',
    summary: 'Instant (tap): pitch the top card of your deck; if it has 6+ {p}, the crowd cheers you. Whenever the crowd cheers you, create a Toughness token.',
    onCheer: ({ p, api }) => api.createToken(p, 'Toughness', 1),
    match: (t) => t.startsWith('Instant - {t}: Pitch the top card of your deck'),
    activations: [{
      label: 'Pitch the top card of your deck', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => p.deck.length > 0,
      resolve: ({ p, api }) => {
        const top = p.deck.shift()!;
        p.pitch.push(top);
        p.resources += cardOf(top).pitch ?? 0;
        api.log(p, `${p.name} pitches ${cardOf(top).name} from the top of the deck (+${cardOf(top).pitch ?? 0}).`);
        if (Number(cardOf(top).power ?? 0) >= 6) api.crowd(p, true);
      },
      botValue: ({ s, p }) => (s.turnPlayer === p.id && s.phase === 'action' ? 0.3 : -1),
    }],
  },
  {
    id: 'emperor',
    summary: 'Action {r}{r}{r}: search your deck for Command and Conquer and attack with it.',
    match: (t) => t.includes('Search your deck for Command and Conquer, attack with it'),
    activations: [{
      label: 'Attack with Command and Conquer from your deck', instant: false, oncePerTurn: false,
      cost: () => 3,
      canUse: ({ p }) => p.deck.some((d) => cardOf(d).name === 'Command and Conquer'),
      resolve: ({ p, api }) => {
        const i = p.deck.findIndex((d) => cardOf(d).name === 'Command and Conquer');
        const [inst] = p.deck.splice(i, 1);
        api.shuffle(p.deck);
        api.startAttack(p, inst);
      },
      botValue: () => 5,
    }],
  },
  {
    id: 'lyath',
    summary: 'The base power and defense of your cards are halved (rounded up).',
    partial: true,
    match: (t) => t.startsWith('The base {p} and {d} of cards you control are halved'),
    halveStats: true,
  },
  {
    id: 'valda',
    summary: 'Whenever an opponent draws during an action phase, create that many Seismic Surge tokens; with 3+ at the start of your turn, your crush cards get dominate.',
    match: (t) => t.startsWith('Whenever an opponent draws 1 or more cards during an action phase'),
    onOpponentDraw({ p, api }, n) { api.createToken(p, 'Seismic Surge', n); },
    startOfTurn({ p, api }) {
      if (countTokens(p, 'Seismic Surge') >= 3) { setFlag(p, 'valda'); api.log(p, 'Valda: crush cards get dominate this turn.'); }
    },
    onAttack({ p }, l) { if (flag(p, 'valda') && cardOf(l.inst).keywords.includes('Crush')) l.dominate = true; },
  },
  {
    id: 'dash',
    summary: 'Once per turn: play a Mechanologist item with cost 1 or less from the top of your deck as an instant (costs {r} more).',
    partial: true,
    match: (t) => t.startsWith('You may look at the top card of your deck at any time.\nOnce per turn, you may play a Mechanologist item'),
    activations: [{
      label: 'Play the top-card item', instant: true, oncePerTurn: true,
      cost: ({ p }) => Number(cardOf(p.deck[0]).cost ?? 0) + 1,
      canUse: ({ p }) => { const t = p.deck[0] && cardOf(p.deck[0]); return !!t && t.types.includes('Mechanologist') && t.types.includes('Item') && Number(t.cost ?? 0) <= 1; },
      resolve: ({ p, api }) => { const top = p.deck.shift()!; p.permanents.push({ inst: top, ward: 0 }); api.log(p, `${p.name} plays ${cardOf(top).name} from the top of the deck.`); },
      botValue: () => 1,
    }],
  },
  {
    id: 'genis',
    summary: 'Once per turn Action {r}{r}: (opponent declines to cycle) you draw a card. Go again.',
    partial: true,
    match: (t) => t.startsWith('Once per Turn Action - {r}{r}: Each other hero may put a card from their hand on the bottom'),
    activations: [{
      label: 'Draw a card', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 2,
      canUse: () => true,
      resolve: ({ p, api }) => api.draw(p, 1),
      botValue: () => 1.5,
    }],
  },
  {
    id: 'baalghor',
    summary: 'Cards you pitch are banished instead of going to the bottom of your deck.',
    partial: true,
    match: (t) => t.startsWith('Whenever you pitch a card, banish it'),
    pitchToBanished: true,
  },
  {
    id: 'jarl',
    summary: 'Whenever you play an Ice card, the opponent gets a Frostbite token.',
    partial: true,
    match: (t) => t.startsWith('Whenever you play an Ice card, create a Frostbite token'),
    onPlayCard({ opp, api }, c) { if (c.types.includes('Ice')) api.createToken(opp, 'Frostbite', 1); },
  },
];

// ---------------------------------------------------------------- tokens, soul, chi and Gold heroes

const tokens = (p: PlayerState, name: string) => p.permanents.some((pm) => cardOf(pm.inst).name === name);
const swordOf = (p: PlayerState) => p.weapons.find((w) => cardOf(w.inst).types.includes('Sword'));
/** {c}: chi can only come from pitching a Chi card. Pitch one from hand if the pool is short. */
const chiAvailable = (p: PlayerState) => (p.turn.flags.chi ?? 0) + p.hand.filter((h) => cardOf(h).types.includes('Chi')).reduce((a, h) => a + (cardOf(h).pitch ?? 0), 0);
function spendChi(p: PlayerState, n: number, api: HeroApi) {
  while ((p.turn.flags.chi ?? 0) < n) {
    const i = p.hand.findIndex((h) => cardOf(h).types.includes('Chi'));
    if (i < 0) throw new Error('Not enough chi.');
    const [chi] = p.hand.splice(i, 1);
    p.pitch.push(chi);
    p.turn.flags.chi = (p.turn.flags.chi ?? 0) + (cardOf(chi).pitch ?? 0);
    p.resources += cardOf(chi).pitch ?? 0;
    api.log(p, `${p.name} pitches ${cardOf(chi).name} for chi.`);
  }
  // chi is also a resource: spending it uses up those resource points
  p.turn.flags.chi -= n;
  p.resources = Math.max(0, p.resources - n);
}

HERO_ABILITIES.push(
  {
    id: 'hala',
    summary: 'Action {r}{r}{r}, tap: sharpen target sword you control (+1{p} counter). Go again.',
    match: (t) => t.startsWith('Action - {r}{r}{r}, {t}: Sharpen target sword you control'),
    activations: [{
      label: 'Sharpen your sword', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 3,
      canUse: ({ p }) => !!swordOf(p),
      resolve: ({ p, api }) => { const w = swordOf(p)!; w.counters = (w.counters ?? 0) + 1; api.log(p, `${cardOf(w.inst).name} is sharpened (+1{p} counter).`); },
      botValue: ({ p }) => (p.hand.length <= 2 ? 1.4 : 0.6),
    }],
  },
  {
    id: 'prism-shield',
    summary: 'Once per turn Instant {r}{r}, banish a card from your soul: create a Spectral Shield token.',
    match: (t) => t.startsWith('Once per Turn Instant - {r}{r}, banish a card from your soul: Create a Spectral Shield token'),
    activations: [{
      label: 'Spectral Shield (banish a soul card)', instant: true, oncePerTurn: true,
      cost: () => 2,
      canUse: ({ p }) => (p.soul?.length ?? 0) > 0,
      resolve: ({ p, api }) => { p.banished.push(p.soul!.shift()!); api.createToken(p, 'Spectral Shield', 1); },
      botValue: ({ p }) => ((p.soul?.length ?? 0) > 1 ? 1 : 0.2),
    }],
  },
  {
    id: 'kayo-armed',
    summary: 'Attack action cards you own count +1{p} outside the combat chain; the first time you discard a card with 6+ {p} in your action phase each turn, create a Might token.',
    partial: true,
    match: (t) => t.includes('The first time you discard a card with 6 or more {p} during each of your action phases, create a Might token'),
    onDiscard({ s, p, api }, c) {
      const pw = Number(c.power ?? 0) + (has(c, 'Attack') && has(c, 'Action') ? 1 : 0);
      if (pw < 6 || s.turnPlayer !== p.id || flag(p, 'kayoMight')) return;
      setFlag(p, 'kayoMight');
      api.createToken(p, 'Might', 1);
    },
  },
  {
    id: 'levia',
    summary: 'If a card with 6+ {p} was put into your banished zone this turn, your cards lose blood debt during the end phase.',
    match: (t) => t.startsWith('If a card with 6 or more {p} has been put into your banished zone this turn, cards you own lose blood debt'),
    startOfTurn({ p }) { p.turn.flags.banStart = p.banished.length; },
    skipBloodDebt({ p }) { return p.banished.slice(p.turn.flags.banStart ?? 0).some((b) => Number(cardOf(b).power ?? 0) >= 6); },
  },
  {
    id: 'azalea-ace',
    summary: 'Once per turn Action 0: put your arsenal card on the bottom; put the top card of your deck face-up into your arsenal (an arrow gets dominate). Go again.',
    match: (t) => t.startsWith('Once per Turn Action - 0: Put a card from your arsenal on the bottom of your deck. If you do, put the top card of your deck face-up into your arsenal'),
    activations: [{
      label: 'Swap arsenal for the top card', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => p.arsenal.length > 0 && p.deck.length > 0,
      resolve: ({ p, api }) => {
        p.deck.push(p.arsenal.shift()!);
        const top = p.deck.shift()!;
        p.arsenal.push(top);
        const arrow = cardOf(top).types.includes('Arrow');
        if (arrow) p.turn.flags[`dominate${top.uid}`] = 1;
        api.log(p, `${p.name} puts ${cardOf(top).name} face-up into the arsenal${arrow ? ' — the arrow gets dominate' : ''}.`);
      },
      botValue: ({ p }) => (p.arsenal[0] && cardOf(p.arsenal[0]).types.includes('Arrow') ? -5 : 0.8),
    }],
    onAttack({ p }, l) { if (p.turn.flags[`dominate${l.inst.uid}`]) l.dominate = true; },
  },
  {
    id: 'enigma-ledger',
    summary: 'Once per turn Instant {c}{c}{c} (chi from a pitched Chi card): create a Spectral Shield token with a +1{p} counter.',
    partial: true,
    match: (t) => t.includes('Once per Turn Instant - {c}{c}{c}: Create a Spectral Shield token with a +1{p} counter'),
    activations: [{
      label: 'Spectral Shield (3 chi)', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => chiAvailable(p) >= 3,
      resolve: ({ p, api }) => { spendChi(p, 3, api); api.createToken(p, 'Spectral Shield', 1); const pm = p.permanents[p.permanents.length - 1]; pm.counters = (pm.counters ?? 0) + 1; },
      botValue: () => 1,
    }],
  },
  {
    id: 'dromai',
    summary: 'Whenever you pitch a red card, create an Ash token.',
    partial: true,
    match: (t) => t.startsWith('Whenever you pitch a red card, create an Ash token'),
    onPitch({ p, api }, c) { if (c.pitch === 1) api.createToken(p, 'Ash', 1); },
  },
  {
    id: 'aurora-emissary',
    summary: 'Instant {r}{r}, tap, destroy a Lightning Flow: create an Embodiment of Lightning token.',
    match: (t) => t.startsWith('Instant - {r}{r}, {t}, destroy a Lightning Flow you control: Create an Embodiment of Lightning token'),
    activations: [{
      label: 'Embodiment of Lightning (destroy a Lightning Flow)', instant: true, oncePerTurn: true,
      cost: () => 2,
      canUse: ({ p }) => tokens(p, 'Lightning Flow'),
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Lightning Flow'); api.createToken(p, 'Embodiment of Lightning', 1); },
      botValue: () => 1.2,
    }],
  },
  {
    id: 'arakni-contract',
    summary: 'Whenever you play a card with contract, look at the top card of the opponent’s deck and put it on the bottom if it’s a strong card.',
    partial: true,
    match: (t) => t.startsWith('Whenever you play a card with contract, you may look at the top card of target opponent'),
    onPlayCard({ p, opp, api }, c) {
      if (!/contract/i.test(c.text) || !opp.deck.length) return;
      const top = cardOf(opp.deck[0]);
      const strong = top.pitch === 1 || Number(top.power ?? 0) >= 5;
      if (strong) opp.deck.push(opp.deck.shift()!);
      api.log(p, `${p.name} looks at the top card of ${opp.name}'s deck${strong ? ' and puts it on the bottom' : ' and leaves it'}.`);
    },
  },
  {
    id: 'marlynn',
    summary: 'Action, tap, destroy a Gold: create a Goldfin Harpoon in your hand. Go again.',
    partial: true,
    match: (t) => t.startsWith('Action - {t}, destroy a Gold you control: Create a Goldfin Harpoon in your hand'),
    activations: [{
      label: 'Goldfin Harpoon (destroy a Gold)', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => tokens(p, 'Gold'),
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Gold'); const h = findCard('Goldfin Harpoon'); if (h) { p.hand.push(api.mk(h.id, p)); api.log(p, `${p.name} creates Goldfin Harpoon in their hand.`); } },
      botValue: () => 1,
    }],
  },
  {
    id: 'puffin',
    summary: 'Action, tap, destroy a Gold: create a Golden Cog token. The second time you crank each turn, draw a card.',
    match: (t) => t.startsWith('Action - {t}, destroy a Gold you control: Create a Golden Cog token'),
    activations: [{
      label: 'Golden Cog (destroy a Gold)', instant: false, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => tokens(p, 'Gold'),
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Gold'); api.createToken(p, 'Golden Cog', 1); },
      botValue: () => 0.5,
    }],
    onCrank({ p, api }) { p.turn.flags.cranks = (p.turn.flags.cranks ?? 0) + 1; if (p.turn.flags.cranks === 2) api.draw(p, 1); },
  },
  {
    id: 'gravy-bones',
    summary: 'Instant, tap, destroy a Gold: draw a card, then discard your least useful card.',
    partial: true,
    match: (t) => t.startsWith('Instant - {t}, destroy a Gold you control: Draw a card, then discard a card'),
    activations: [{
      label: 'Loot (destroy a Gold)', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => tokens(p, 'Gold'),
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Gold'); api.draw(p, 1); const d = lowestValue(p.hand); if (d) api.discard(p, d); },
      botValue: () => 1,
    }],
  },
);

// ---------------------------------------------------------------- wagers and the crowd (Heavy Hitters, Super Slam)

HERO_ABILITIES.push(
  {
    id: 'betsy',
    summary: 'Whenever an attack you control wagers, you may pay {r}{r}: it gets +1{p} and overpower.',
    match: (t) => t.startsWith('Whenever an attack you control wagers, you may pay {r}{r}'),
    // handled where the wager is made (addWager), so you're asked at the right moment
  },
  {
    id: 'olympia',
    summary: 'The first time each of your attacks wins a wager, create a Gold token.',
    match: (t) => t.startsWith('The first time each of your attacks wins a wager, create a Gold token'),
    onWagerWin: ({ s, p, api }, l) => {
      if (l.attacker !== p.id || p.turn.flags[`olyWin${l.inst.uid}`]) return;
      p.turn.flags[`olyWin${l.inst.uid}`] = 1;
      api.createToken(p, 'Gold', 1);
      void s;
    },
  },
  {
    id: 'zane',
    summary: 'Whenever you win a wager, the crowd cheers you. The first time the crowd cheers you each turn, each hero draws a card.',
    partial: true, // 2H swords as 1H isn't modelled (decks are built normally)
    match: (t) => t.includes('Whenever you win a wager, the crowd cheers you'),
    onWagerWin: ({ p, api }) => api.crowd(p, true),
    onCheer: ({ s, p, api }) => {
      if (flag(p, 'zaneCheer')) return;
      setFlag(p, 'zaneCheer');
      for (const pl of s.players) api.draw(pl, 1);
    },
  },
  {
    id: 'pleiades',
    summary: 'Whenever the crowd cheers you, create a Confidence token.',
    partial: true, // the suspense-counter ability isn't automated
    match: (t) => t.includes('Whenever the crowd cheers you, create a Confidence token'),
    onCheer: ({ p, api }) => api.createToken(p, 'Confidence', 1),
  },
  {
    id: 'killjoy',
    summary: 'Whenever you steal a Gold, the crowd boos you. The first time the crowd boos you each turn, each hero with more {h} than you loses 1{h}.',
    partial: true, // attacking any opposing hero only matters with more than one opponent
    match: (t) => t.includes('The first time the crowd boos you each turn, each hero with more {h} than you loses 1{h}'),
    onSteal: ({ p, api }, c) => { if (c.name === 'Gold') api.crowd(p, false); },
    onBoo: ({ s, p, api }) => {
      if (flag(p, 'kjBoo')) return;
      setFlag(p, 'kjBoo');
      for (const pl of s.players) if (pl.id !== p.id && pl.life > p.life) { pl.life -= 1; api.log(pl, `${pl.name} loses 1 life (${pl.life}).`); }
    },
  },
);

// ---------------------------------------------------------------- more heroes

const earthBanished = (p: PlayerState) => p.banished.filter((b) => cardOf(b).types.includes('Earth')).length;
const isNonAttackAction = (c: Card) => has(c, 'Action') && !has(c, 'Attack');
const goldCount = (p: PlayerState) => p.permanents.filter((pm) => cardOf(pm.inst).name === 'Gold').length;
/** search your deck for the best card with combo, banish it, and let it be played this turn */
function comboToBanish(p: PlayerState, api: HeroApi) {
  const i = p.deck.findIndex((d) => /combo/i.test(cardOf(d).text) || cardOf(d).keywords.includes('Combo'));
  if (i < 0) { api.log(p, `${p.name} finds no card with combo.`); return; }
  const [c] = p.deck.splice(i, 1);
  p.deck = api.shuffle(p.deck);
  p.banished.push(c);
  p.turn.flags[`playBanished${c.uid}`] = 1;
  api.log(p, `${p.name} banishes ${cardOf(c).name} from the deck: it may be played this turn.`);
}

HERO_ABILITIES.push(
  {
    id: 'blaze-firemind',
    summary: 'Whenever you opt, Blaze gets energy counters equal to the cards looked at. Once per turn Instant, remove X: banish a Wizard non-attack action from hand whose arcane damage is X; play it this turn as an instant.',
    match: (t) => t.startsWith('Whenever you opt, put energy counters on Blaze'),
    onOpt: ({ p, api }, n) => { p.heroCounters = (p.heroCounters ?? 0) + n; api.log(p, `Blaze gets ${n} energy counter${n === 1 ? '' : 's'} (${p.heroCounters}).`); },
    activations: [{
      label: 'Spend energy: banish a Wizard spell to play as an instant', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => p.hand.some((h) => wizardSpellX(cardOf(h)) > 0 && wizardSpellX(cardOf(h)) <= (p.heroCounters ?? 0)),
      resolve: ({ p, api }) => {
        const h = [...p.hand].filter((x) => wizardSpellX(cardOf(x)) > 0 && wizardSpellX(cardOf(x)) <= (p.heroCounters ?? 0)).sort((a, b) => wizardSpellX(cardOf(b)) - wizardSpellX(cardOf(a)))[0];
        if (!h) return;
        p.heroCounters = (p.heroCounters ?? 0) - wizardSpellX(cardOf(h));
        p.hand = p.hand.filter((x) => x !== h);
        p.banished.push(h);
        p.turn.flags[`playBanished${h.uid}`] = 1;
        p.turn.flags[`asInstant${h.uid}`] = 1;
        api.log(p, `Blaze banishes ${cardOf(h).name}: it may be played this turn as though it were an instant.`);
      },
      botValue: () => 1,
    }],
  },
  {
    id: 'boltyn',
    summary: 'If you’ve charged this turn, your attacks get +1{p} while defended by an attack action card. Attack Reaction, banish a soul card: an attack with {p} above its base gets go again.',
    match: (t) => t.startsWith("If you've charged this turn, your attacks get +1{p} while defended by an attack action card"),
    beforeDamage: ({ p, api }, l) => {
      if (l.attacker !== p.id || !p.turn.charged || !l.defenders.some((d) => has(cardOf(d.inst), 'Attack') && has(cardOf(d.inst), 'Action'))) return;
      l.powerMod += 1;
      api.log(p, `${cardOf(l.inst).name} gets +1{p} (Boltyn).`);
    },
    activations: [{
      label: 'Go again (banish a card from your soul)', instant: true, oncePerTurn: false,
      cost: () => 0,
      canUse: ({ s, p }) => { const l = s.chain[s.chain.length - 1]; return s.phase === 'reaction' && !!l && l.attacker === p.id && l.powerMod > 0 && !l.goAgain && (p.soul?.length ?? 0) > 0; },
      resolve: ({ s, p, api }) => { const l = s.chain[s.chain.length - 1]; p.banished.push(p.soul!.shift()!); l.goAgain = true; api.log(p, `${cardOf(l.inst).name} gets go again.`); },
      botValue: () => 1.5,
    }],
  },
  {
    id: 'bravo-showman',
    summary: 'Action {r}{r}, tap: turn your face-down arsenal card face-up; if it has crush, it gets +2{p} and dominate this turn. Go again.',
    match: (t) => t.startsWith('Action - {r}{r}, {t}: Turn a face-down card in your arsenal face-up. If it has crush'),
    activations: [{
      label: 'Turn your arsenal card face-up', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 2,
      canUse: ({ p }) => p.arsenal.some((a) => !a.faceUp),
      resolve: ({ p, api }) => {
        const a = p.arsenal.find((x) => !x.faceUp)!;
        a.faceUp = true;
        const crush = /crush/i.test(cardOf(a).text);
        if (crush) p.turn.flags[`showman${a.uid}`] = 1;
        api.log(p, `${p.name} turns ${cardOf(a).name} face-up${crush ? ': it gets +2{p} and dominate this turn' : ''}.`);
      },
      botValue: ({ p }) => (p.arsenal.some((a) => /crush/i.test(cardOf(a).text)) ? 1.5 : -2),
    }],
    onAttack: ({ p, api }, l) => { if (p.turn.flags[`showman${l.inst.uid}`]) { l.powerMod += 2; l.dominate = true; api.log(p, `${cardOf(l.inst).name} gets +2{p} and dominate.`); } },
  },
  {
    id: 'bravo-star',
    summary: 'At the start of your turn, if you can reveal an Earth, an Ice and a Lightning card from hand, your next attack action card with cost 3+ this turn gets +2{p}, dominate and go again.',
    match: (t) => t.includes('you may reveal an Earth, an Ice, and a Lightning card from your hand'),
    startOfTurn: ({ p, api }) => {
      const hasT = (t: string) => p.hand.some((h) => cardOf(h).types.includes(t));
      if (hasT('Earth') && hasT('Ice') && hasT('Lightning')) { setFlag(p, 'star'); api.log(p, `${p.name} reveals an Earth, an Ice and a Lightning card.`); }
    },
    onAttack: ({ p, api }, l) => {
      if (!flag(p, 'star') || l.fromWeapon || Number(cardOf(l.inst).cost ?? 0) < 3) return;
      p.turn.flags.star = 0;
      l.powerMod += 2; l.dominate = true; l.goAgain = true;
      api.log(p, `${cardOf(l.inst).name} gets +2{p}, dominate and go again.`);
    },
  },
  {
    id: 'briar',
    summary: 'The first time an attack action card you control deals damage to an opposing hero each turn, create an Embodiment of Earth. The second time you play a non-attack action each turn, create an Embodiment of Lightning.',
    match: (t) => t.includes('The first time an attack action card you control deals damage to an opposing hero each turn, create an Embodiment of Earth'),
    onHit: ({ p, api }, l) => { if (!l.fromWeapon && !flag(p, 'briarHit')) { setFlag(p, 'briarHit'); api.createToken(p, 'Embodiment of Earth', 1); } },
    onPlayCard: ({ p, api }, c) => { if (isNonAttackAction(c)) { p.turn.flags.briarNA = (p.turn.flags.briarNA ?? 0) + 1; if (p.turn.flags.briarNA === 2) api.createToken(p, 'Embodiment of Lightning', 1); } },
  },
  {
    id: 'brutus',
    summary: 'If all heroes in a clash would fail to win, you choose the winner (you).',
    partial: true, // deck building with clash cards of any class isn't enforced either way
    match: (t) => t.includes('If all heroes in a clash would fail to win, instead choose which hero wins the clash'),
    winsTiedClash: true,
  },
  {
    id: 'chane',
    summary: 'Once per turn Action: create a Soul Shackle token; your next Runeblade or Shadow action this turn gets go again. Go again.',
    match: (t) => t.startsWith('Once per Turn Action - Create a Soul Shackle token: Your next Runeblade or Shadow action this turn gets go again'),
    activations: [{
      label: 'Soul Shackle: next Runeblade/Shadow action gets go again', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: () => true,
      resolve: ({ p, api }) => { api.createToken(p, 'Soul Shackle', 1); setFlag(p, 'chane'); },
      botValue: ({ p }) => (p.hand.filter((h) => has(cardOf(h), 'Action') && (cardOf(h).types.includes('Runeblade') || cardOf(h).types.includes('Shadow'))).length >= 2 ? 1.2 : -1),
    }],
    grantGoAgain: ({ p }, c) => { if (!flag(p, 'chane') || !(c.types.includes('Runeblade') || c.types.includes('Shadow'))) return false; p.turn.flags.chane = 0; return true; },
    onAttack: ({ p }, l) => { const c = cardOf(l.inst); if (flag(p, 'chane') && !l.fromWeapon && (c.types.includes('Runeblade') || c.types.includes('Shadow'))) { p.turn.flags.chane = 0; l.goAgain = true; } },
  },
  {
    id: 'dash-young',
    summary: 'Starts the game with a Mechanologist item with cost 2 or less from the deck in the arena.',
    match: (t) => t.startsWith('You may start the game with a Mechanologist item with cost 2 or less in the arena'),
    setup: ({ p, api }) => {
      const i = p.deck.findIndex((d) => { const c = cardOf(d); return c.types.includes('Mechanologist') && has(c, 'Item') && Number(c.cost ?? 0) <= 2; });
      if (i < 0) return;
      const [it] = p.deck.splice(i, 1);
      p.permanents.push({ inst: it, ward: 0 });
      api.log(p, `${p.name} starts with ${cardOf(it).name} in the arena.`);
    },
  },
  {
    id: 'dorinthea-qp',
    summary: 'The first time Dawnblade, Resplendent’s attack gets go again each turn, it may attack an additional time.',
    match: (t) => t.startsWith("The first time your Dawnblade, Resplendent's attack gets go again each turn"),
    onLinkResolve: ({ p, api }, l) => {
      if (l.attacker !== p.id || !l.fromWeapon || !l.goAgain || flag(p, 'qp') || !cardOf(l.inst).name.startsWith('Dawnblade, Resplendent')) return;
      setFlag(p, 'qp');
      const w = p.weapons.find((x) => x.inst.uid === l.inst.uid);
      if (w) { w.usedThisTurn = false; api.log(p, 'Dawnblade, Resplendent may attack an additional time this turn.'); }
    },
  },
  {
    id: 'mortimer',
    summary: 'Instant, tap: cure a disease an opponent controls and create a Silver token. Attack Reaction, tap, destroy 2 Silver: target Assassin attack gets go again.',
    match: (t) => t.startsWith('Instant - {t}: Cure a disease an opponent controls'),
    activations: [
      {
        label: 'Cure a disease (Silver token)', instant: true, oncePerTurn: true,
        cost: () => 0,
        canUse: ({ opp }) => opp.permanents.some((pm) => cardOf(pm.inst).types.includes('Disease')),
        resolve: ({ p, opp, api }) => {
          const d = opp.permanents.find((pm) => cardOf(pm.inst).types.includes('Disease'))!;
          opp.permanents = opp.permanents.filter((x) => x !== d);
          api.log(p, `${p.name} cures ${cardOf(d.inst).name}.`);
          api.createToken(p, 'Silver', 1);
        },
        botValue: () => 1,
      },
      {
        label: 'Go again for an Assassin attack (destroy 2 Silver)', instant: true, oncePerTurn: true,
        cost: () => 0,
        canUse: ({ s, p }) => { const l = s.chain[s.chain.length - 1]; return s.phase === 'reaction' && !!l && l.attacker === p.id && !l.goAgain && cardOf(l.inst).types.includes('Assassin') && countTokens(p, 'Silver') >= 2; },
        resolve: ({ s, p, api }) => { api.destroyNamed(p, 'Silver'); api.destroyNamed(p, 'Silver'); s.chain[s.chain.length - 1].goAgain = true; api.log(p, 'The attack gets go again.'); },
        botValue: () => 1.2,
      },
    ],
  },
  {
    id: 'enigma-new-moon',
    summary: 'Instant {c}{c}{c}: turn a face-down equipment with ward face-up and create 3 Spectral Shield tokens.',
    partial: true, // equipment is shown face-up in this app; each ward equipment can be "turned up" once
    match: (t) => t.startsWith('Equipment you own get cloaked'),
    activations: [{
      label: 'Turn up a ward equipment (3 Spectral Shields)', instant: true, oncePerTurn: false,
      cost: () => 0,
      canUse: ({ p }) => p.hand.some((h) => cardOf(h).types.includes('Chi')) && p.equipment.some((e) => !e.destroyed && /ward/i.test(cardOf(e.inst).text) && !p.turn.flags[`up${e.inst.uid}`] && !(e as { up?: boolean }).up),
      resolve: ({ p, api }) => {
        const chi = p.hand.find((h) => cardOf(h).types.includes('Chi'));
        if (chi) { p.hand = p.hand.filter((x) => x !== chi); p.pitch.push(chi); }
        const e = p.equipment.find((x) => !x.destroyed && /ward/i.test(cardOf(x.inst).text) && !(x as { up?: boolean }).up)!;
        (e as { up?: boolean }).up = true;
        api.log(p, `${p.name} turns ${cardOf(e.inst).name} face-up.`);
        api.createToken(p, 'Spectral Shield', 3);
      },
      botValue: () => 1.5,
    }],
  },
  {
    id: 'florian',
    summary: 'With 4 (young) or 8 (adult) Earth cards in your banished zone, whenever you create aura tokens you create one more of each.',
    match: (t) => /^If there are (4|8) or more Earth cards in your banished zone, Florian gets "If you would create 1 or more aura tokens/.test(t),
    tokenCount: ({ p }, token, n) => (has(token, 'Aura') && earthBanished(p) >= (/8 or more/.test(cardOf(p.hero).text) ? 8 : 4) ? n + 1 : n),
  },
  {
    id: 'iyslander',
    summary: 'On an opponent’s turn you may play blue non-attack actions from your arsenal as instants. Whenever you play an Ice card on an opponent’s turn, they get a Frostbite token.',
    match: (t) => t.includes('you may play blue non-attack action cards from your arsenal as though they were instants'),
    asInstant: ({ s, p }, c, fromArsenal) => s.turnPlayer !== p.id && fromArsenal && c.pitch === 3 && isNonAttackAction(c),
    onPlayCard: ({ s, p, opp, api }, c) => { if (s.turnPlayer !== p.id && c.types.includes('Ice')) api.createToken(opp, 'Frostbite', 1); },
  },
  {
    id: 'kano',
    summary: 'Instant {r}{r}{r}: look at the top card of your deck; if it’s a non-attack action, banish it and you may play it this turn as an instant.',
    match: (t) => t.startsWith("Instant - {r}{r}{r}: Look at the top card of your deck. If it's a non-attack action card, you may banish it"),
    activations: [{
      label: 'Look at the top card (banish a spell to play it)', instant: true, oncePerTurn: false,
      cost: () => 3,
      canUse: ({ p }) => p.deck.length > 0,
      resolve: ({ p, api }) => {
        const top = p.deck[0];
        if (!isNonAttackAction(cardOf(top))) { api.log(p, `${p.name} looks at the top card of their deck.`); return; }
        p.deck.shift();
        p.banished.push(top);
        p.turn.flags[`playBanished${top.uid}`] = 1;
        p.turn.flags[`asInstant${top.uid}`] = 1;
        api.log(p, `${p.name} banishes ${cardOf(top).name}: it may be played this turn as an instant.`);
      },
      botValue: ({ s, p }) => (s.turnPlayer === p.id && p.resources >= 3 ? 0.8 : -1),
    }],
  },
  {
    id: 'kassai-cintari',
    summary: 'Your second sword attack each turn costs {r} less. End phase: if you attacked 2+ times with weapons, create a Copper token for each weapon attack that hit.',
    match: (t) => t.startsWith('Your second sword attack each turn costs {r} less to activate'),
    activationCostMod: ({ p }, src) => (src.types.includes('Sword') && p.turn.attacks >= 1 && !flag(p, 'kc2') ? -1 : 0),
    onAttack: ({ p }, l) => { if (l.fromWeapon) p.turn.flags.weaponAttacks = (p.turn.flags.weaponAttacks ?? 0) + 1; if (l.fromWeapon && (p.turn.flags.weaponAttacks ?? 0) >= 2) setFlag(p, 'kc2'); },
    endPhase: ({ s, p, api }) => { if (s.turnPlayer === p.id && (p.turn.flags.weaponAttacks ?? 0) >= 2 && p.turn.weaponHits > 0) api.createToken(p, 'Copper', p.turn.weaponHits); },
  },
  {
    id: 'katsu-young',
    summary: 'The first time an attack action card you control hits each turn, you may discard a card with cost 0 to search your deck for a combo card, banish it and play it this turn.',
    match: (t) => t.startsWith('The first time an attack action card you control hits each turn, you may discard a card with cost 0'),
    onHit: ({ p, api }, l) => {
      if (l.fromWeapon || flag(p, 'katsu')) return;
      setFlag(p, 'katsu');
      const zero = lowestValue(p.hand.filter((h) => Number(cardOf(h).cost ?? 1) === 0));
      if (!zero || !p.deck.some((d) => /combo/i.test(cardOf(d).text))) return;
      api.discard(p, zero);
      comboToBanish(p, api);
    },
  },
  {
    id: 'kayo-runt',
    summary: 'Whenever you play an attack action card with 6+ base {p}, roll a die: 1–4 halves its base {p}, 5–6 doubles it.',
    match: (t) => t.startsWith('Whenever you play an attack action card with 6 or more base {p}, roll a 6 sided die'),
    onAttack: ({ p, api }, l) => {
      if (l.fromWeapon || l.basePower < 6) return;
      const roll = 1 + Math.floor(api.random() * 6);
      l.basePower = roll >= 5 ? l.basePower * 2 : Math.floor(l.basePower / 2);
      api.log(p, `${p.name} rolls a ${roll}: ${cardOf(l.inst).name}'s base power ${roll >= 5 ? 'doubles' : 'is halved'} (${l.basePower}).`);
    },
  },
  {
    id: 'lexi',
    summary: 'Once per turn Action: turn your face-down arsenal card face-up. Lightning: your next attack gets go again. Ice: the opponent gets a Frostbite token. Go again.',
    match: (t) => t.includes('Once per Turn Action - Turn a face-down card in your arsenal face-up: If it\'s a Lightning card'),
    activations: [{
      label: 'Turn your arsenal card face-up', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => p.arsenal.some((a) => !a.faceUp && (cardOf(a).types.includes('Lightning') || cardOf(a).types.includes('Ice'))),
      resolve: ({ p, opp, api }) => {
        const a = p.arsenal.find((x) => !x.faceUp)!;
        a.faceUp = true;
        const c = cardOf(a);
        api.log(p, `${p.name} turns ${c.name} face-up.`);
        if (c.types.includes('Lightning')) p.effects.push({ kind: 'nextAttackGoAgain', filter: { kind: 'any' }, source: 'Lexi' });
        if (c.types.includes('Ice')) api.createToken(opp, 'Frostbite', 1);
      },
      botValue: () => 1.2,
    }],
  },
  {
    id: 'melody',
    summary: 'Whenever you play a song, create a Copper token for each other hero.',
    match: (t) => t.startsWith('Whenever you play a song, create Copper tokens equal to the number of other heroes'),
    onPlayCard: ({ s, p, api }, c) => { if (c.types.includes('Song')) api.createToken(p, 'Copper', s.players.length - 1); },
  },
  {
    id: 'nuu',
    summary: 'Your attacks with stealth banish the action cards that defended them when the chain link resolves.',
    partial: true, // the {c}{c}{c} look-and-play ability isn't automated
    match: (t) => t.startsWith('Your attacks with stealth get "When this chain link resolves, banish all action cards defending this."'),
    banishStealthBlockers: true,
  },
  {
    id: 'oldhim',
    summary: 'Once per turn Defense Reaction {r}{r}{r}: if an Earth card was pitched, prevent the next 2 damage; if an Ice card was pitched, the attacking hero puts a card from hand on top of their deck.',
    partial: true, // checks the cards in your pitch zone rather than exactly the ones pitched for this
    match: (t) => t.includes('Once per Turn Defense Reaction - {r}{r}{r}: If an Earth card is pitched this way, prevent the next 2 damage'),
    activations: [{
      label: 'Defense reaction (Earth: prevent 2, Ice: they lose a card to the deck)', instant: true, oncePerTurn: true,
      cost: () => 3,
      canUse: ({ s, p }) => { const l = s.chain[s.chain.length - 1]; return s.phase === 'reaction' && !!l && l.attacker !== p.id; },
      resolve: ({ p, opp, api }) => {
        if (p.pitch.some((x) => cardOf(x).types.includes('Earth'))) { p.effects.push({ kind: 'preventNext', amount: 2, source: 'Oldhim' }); api.log(p, 'Oldhim: the next 2 damage is prevented.'); }
        if (p.pitch.some((x) => cardOf(x).types.includes('Ice')) && opp.hand.length) { const c = lowestValue(opp.hand)!; opp.hand = opp.hand.filter((x) => x !== c); opp.deck.unshift(c); api.log(opp, `${opp.name} puts a card from hand on top of their deck.`); }
      },
      botValue: () => 1,
    }],
  },
  {
    id: 'oscilio-forked',
    summary: 'Instant {r}, tap, destroy a Lightning Flow: discard a card and create a Ponder token; an instant discarded this way may be played this turn.',
    match: (t) => t.startsWith('Instant - {r}, {t}, destroy a Lightning Flow you control: Discard a card and create a Ponder token'),
    activations: [{
      label: 'Discard a card for a Ponder (destroy a Lightning Flow)', instant: true, oncePerTurn: true,
      cost: () => 1,
      canUse: ({ p }) => countTokens(p, 'Lightning Flow') > 0 && p.hand.length > 0,
      resolve: ({ p, api }) => {
        api.destroyNamed(p, 'Lightning Flow');
        const inst = p.hand.find((h) => has(cardOf(h), 'Instant')) ?? lowestValue(p.hand)!;
        api.discard(p, inst);
        api.createToken(p, 'Ponder', 1);
        if (has(cardOf(inst), 'Instant')) { p.turn.flags[`playGrave${inst.uid}`] = 1; api.log(p, `${cardOf(inst).name} may be played from the graveyard this turn.`); }
      },
      botValue: () => 0.8,
    }],
  },
  {
    id: 'teklovossen',
    summary: 'You may play Evos from your banished zone (Professor Teklovossen: Evos cost {r} less for each opponent).',
    match: (t) => t.includes('You may play Evos from your banished zone'),
    playFromBanished: (_ctx, c) => c.types.includes('Evo'),
    cardCostMod: ({ s, p }, c) => (c.types.includes('Evo') && cardOf(p.hero).text.startsWith('Evos cost {r} less') ? s.players.length - 1 : 0),
  },
  {
    id: 'riptide',
    summary: 'Whenever you play a card from hand, you may put a card from your hand face down into your empty arsenal.',
    partial: true, // traps triggering isn't automated
    match: (t) => t.startsWith('Whenever you play a card from hand, you may put a card from hand face-down into your arsenal'),
    onPlayCard: ({ p, api }) => { if (!p.arsenal.length && p.hand.length) api.askReload(p); },
  },
  {
    id: 'scurv',
    summary: 'Action, tap, destroy a Gold: create a Goldkiss Rum token. Go again. Whenever you activate a Goldkiss Rum, gain {r}.',
    match: (t) => t.startsWith('Action - {t}, destroy a Gold you control: Create a Goldkiss Rum token'),
    activations: [{
      label: 'Goldkiss Rum (destroy a Gold)', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => goldCount(p) > 0,
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Gold'); api.createToken(p, 'Goldkiss Rum', 1); },
      botValue: () => 0.6,
    }],
    onActivatePermanent: ({ p, api }, c) => { if (c.name === 'Goldkiss Rum') { p.resources += 1; api.log(p, `${p.name} gains 1 resource.`); } },
  },
  {
    id: 'verdance',
    summary: 'With 4 (young) or 8 (adult) Earth cards in your banished zone, whenever you gain life on your turn, deal 1 arcane damage to the opponent.',
    match: (t) => /^If there are (4|8) or more Earth cards in your banished zone, Verdance gets "Whenever you gain \{h\} during your turn/.test(t),
    onGainLife: ({ s, p, opp, api }) => {
      if (s.turnPlayer !== p.id || earthBanished(p) < (/8 or more/.test(cardOf(p.hero).text) ? 8 : 4)) return;
      api.dealDamage(opp, 1, true, 'Verdance');
    },
  },
  {
    id: 'victor-goldmane',
    summary: 'The first time each turn you create a Gold token from your own effect, draw a card.',
    partial: true, // the clash re-roll with a Gold isn't automated
    match: (t) => t.startsWith('The first time each turn you create a Gold token from an effect you control, draw a card'),
    onCreateToken: ({ p, api }, t) => { if (t.name === 'Gold' && !flag(p, 'victorGold')) { setFlag(p, 'victorGold'); api.draw(p, 1); } },
  },
  {
    id: 'viserai',
    summary: 'Whenever you play a Runeblade card, if you’ve played another non-attack action this turn, create a Runechant.',
    match: (t) => t.startsWith("Whenever you play a Runeblade card, if you've played another non-attack action card this turn, create a Runechant token"),
    onPlayCard: ({ p, api }, c) => {
      if (!c.types.includes('Runeblade')) return;
      const nonAttack = p.turn.played.filter((id) => isNonAttackAction(card(id))).length - (isNonAttackAction(c) ? 1 : 0);
      if (nonAttack > 0) api.createToken(p, 'Runechant', 1);
    },
  },
  {
    id: 'zen',
    summary: 'Once per turn Instant {c}{c}{c}: create a Crouching Tiger in your hand; search your deck for a combo card, banish it, and you may play it this turn.',
    match: (t) => t.startsWith('Once per Turn Instant - {c}{c}{c}: Create a Crouching Tiger in your hand'),
    activations: [{
      label: 'Crouching Tiger + a combo card (3 chi)', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ p }) => chiAvailable(p) >= 3,
      resolve: ({ p, api }) => {
        spendChi(p, 3, api);
        const t = findCard('Crouching Tiger');
        if (t) { p.hand.push(api.mk(t.id, p)); api.log(p, `${p.name} creates Crouching Tiger in their hand.`); }
        comboToBanish(p, api);
      },
      botValue: () => 1.5,
    }],
  },
  {
    id: 'crix',
    summary: 'Your attacks get +1{p} against a hero with a Seismic Surge token. Whenever you attack a Guardian hero, clash; the winner creates a Seismic Surge token.',
    match: (t) => t.startsWith('Your attacks get +1{p} while attacking a hero who controls a Seismic Surge token'),
    onAttack: ({ p, opp, api }, l) => {
      if (countTokens(opp, 'Seismic Surge')) { l.powerMod += 1; api.log(p, `${cardOf(l.inst).name} gets +1{p}.`); }
      if (cardOf(opp.hero).types.includes('Guardian')) { const w = api.clash(p); if (w) api.createToken(w, 'Seismic Surge', 1); }
    },
  },
  {
    id: 'victor-match-fixer',
    summary: 'Whenever you attack, you may destroy 3 Gold for +3{p} and dominate.',
    partial: true, // the clash-fixing instant isn't automated
    match: (t) => t.includes('Whenever you attack, you may destroy 3 Gold you control. If you do, the attack gets +3{p} and dominate'),
    onAttack: ({ p, api }, l) => {
      if (goldCount(p) < 3) return;
      for (let i = 0; i < 3; i++) api.destroyNamed(p, 'Gold');
      l.powerMod += 3; l.dominate = true;
      api.log(p, `${p.name} spends 3 Gold: +3{p} and dominate.`);
    },
  },
);

HERO_ABILITIES.push(
  {
    id: 'shiyana',
    summary: 'At the beginning of your action phase, Shiyana becomes a copy of the opposing hero (and uses their ability) until the start of your next turn.',
    partial: true, // specialization cards of any hero and the class sharing aren't checked by the deck builder
    match: (t) => t.includes('Shiyana becomes a copy of target hero until the start of your next turn'),
  },
  {
    id: 'uzuri',
    summary: 'Once per turn Attack Reaction: banish a card from hand; if it’s an attack action card with cost 2 or less, it replaces your attacking stealth card on the chain link (that card goes to the bottom of your deck).',
    match: (t) => t.startsWith('Once per Turn Attack Reaction - Banish a card from your hand face-down: Turn the banished card face-up'),
    activations: [{
      label: 'Swap your stealth attack for a cheap attack from hand', instant: true, oncePerTurn: true,
      cost: () => 0,
      canUse: ({ s, p }) => {
        const l = s.chain[s.chain.length - 1];
        return s.phase === 'reaction' && !!l && l.attacker === p.id && !l.fromWeapon && cardOf(l.inst).keywords.includes('Stealth')
          && p.hand.some((h) => has(cardOf(h), 'Attack') && has(cardOf(h), 'Action') && Number(cardOf(h).cost ?? 0) <= 2);
      },
      resolve: ({ s, p, api }) => {
        const l = s.chain[s.chain.length - 1];
        const pick = [...p.hand].filter((h) => has(cardOf(h), 'Attack') && has(cardOf(h), 'Action') && Number(cardOf(h).cost ?? 0) <= 2)
          .sort((a, b) => Number(cardOf(b).power ?? 0) - Number(cardOf(a).power ?? 0))[0];
        p.hand = p.hand.filter((x) => x !== pick);
        p.deck.push(l.inst);
        api.log(p, `${p.name} turns ${cardOf(pick).name} face-up: it replaces ${cardOf(l.inst).name} on the chain link.`);
        l.inst = pick;
        l.basePower = Number(cardOf(pick).power ?? 0);
      },
      botValue: ({ s, p }) => { const l = s.chain[s.chain.length - 1]; return l && p.hand.some((h) => Number(cardOf(h).power ?? 0) > l.basePower) ? 1.2 : -1; },
    }],
  },
  {
    id: 'zyggy',
    summary: 'Instant {r}{r}, tap, destroy a Lightning Flow, banish another Lightning aura with no holo counters: return it to the arena with a holo counter.',
    partial: true, // "when this enters" effects of the returned aura aren't re-triggered
    match: (t) => t.startsWith('Instant - {r}{r}, {t}, destroy a Lightning Flow you control, banish another Lightning aura permanent'),
    activations: [{
      label: 'Flicker a Lightning aura with a holo counter', instant: true, oncePerTurn: true,
      cost: () => 2,
      canUse: ({ p }) => countTokens(p, 'Lightning Flow') > 0 && p.permanents.some((pm) => cardOf(pm.inst).name !== 'Lightning Flow' && cardOf(pm.inst).types.includes('Lightning') && has(cardOf(pm.inst), 'Aura') && !pm.counters),
      resolve: ({ p, api }) => {
        api.destroyNamed(p, 'Lightning Flow');
        const pm = p.permanents.find((x) => cardOf(x.inst).name !== 'Lightning Flow' && cardOf(x.inst).types.includes('Lightning') && has(cardOf(x.inst), 'Aura') && !x.counters);
        if (pm) { pm.counters = 1; api.log(p, `${cardOf(pm.inst).name} returns to the arena with a holo counter.`); }
      },
      botValue: () => 0.3,
    }],
  },
  {
    id: 'prism-figments',
    summary: 'Whenever a Herald card is put into your soul during an action phase, search your deck for a figment and put it into the arena.',
    partial: true, // awakening figments isn't automated
    match: (t) => t.startsWith('Whenever a card with Herald in its name is put into your soul during an action phase'),
    onLinkResolve: ({ s, p, api }) => {
      const herald = (p.soul ?? []).filter((x) => cardOf(x).name.includes('Herald')).length;
      if (s.phase !== 'reaction' || herald <= (p.turn.flags.heralds ?? 0)) return;
      p.turn.flags.heralds = herald;
      const i = p.deck.findIndex((d) => cardOf(d).types.includes('Figment'));
      if (i < 0) return;
      const [f] = p.deck.splice(i, 1);
      p.deck = api.shuffle(p.deck);
      p.permanents.push({ inst: f, ward: 0 });
      api.log(p, `${p.name} searches for ${cardOf(f).name} and puts it into the arena.`);
    },
  },
);

/** the arcane damage a spell deals (its X for Blaze), 0 if it isn't a Wizard non-attack action with one */
function wizardSpellX(c: Card): number {
  if (!c.types.includes('Wizard') || !isNonAttackAction(c)) return 0;
  const m = c.text.match(/[Dd]eal (\d+) arcane damage/);
  return m ? +m[1] : 0;
}

const cache = new Map<string, HeroAbility | null>();

export function getHeroAbility(hero: Card): HeroAbility | null {
  if (!cache.has(hero.id)) cache.set(hero.id, HERO_ABILITIES.find((a) => a.match(hero.text)) ?? null);
  return cache.get(hero.id)!;
}

export function heroAutomation(hero: Card): { level: 'full' | 'partial' | 'none'; summary: string } {
  const a = getHeroAbility(hero);
  if (!a) return { level: 'none', summary: 'Hero ability not automated yet. Use the Manual tools.' };
  return { level: a.partial ? 'partial' : 'full', summary: a.summary };
}

// ---------------------------------------------------------------- multiplayer, inventory and joke heroes

const isCrush = (c: Card) => /\bcrush\b/i.test(c.text);
const slotOf = (c: Card) => ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand'].find((t) => c.types.includes(t));
const lowestLife = (list: PlayerState[]) => [...list].sort((a, b) => a.life - b.life)[0];

HERO_ABILITIES.push(
  {
    id: 'bolfar',
    summary: 'Bolfar can’t equip weapons. Action {r}{r}{r}: your next crush attack this turn also hits another hero you can attack, for the same damage (they don’t get to defend it separately). Go again.',
    partial: true,
    noWeapons: true,
    match: (t) => t.includes('The next attack action card with crush you play this turn may attack an additional hero'),
    onLinkResolve: ({ p, api }, l) => {
      if (l.attacker !== p.id || !flag(p, 'bolfarExtra') || !isCrush(cardOf(l.inst))) return;
      p.turn.flags.bolfarExtra = 0;
      const extra = api.targets(p).filter((q) => q.id !== (l.defender ?? -1));
      if (!l.hit || !l.damage || !extra.length) return;
      const q = lowestLife(extra);
      api.log(p, `${cardOf(l.inst).name} also attacks ${q.name} (Bolfar).`);
      api.dealDamage(q, l.damage, false, cardOf(l.inst).name);
    },
    activations: [{
      label: 'Next crush attack hits an additional hero', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 3,
      canUse: ({ p }) => p.hand.some((h) => isCrush(cardOf(h))),
      resolve: ({ p, api }) => { setFlag(p, 'bolfarExtra'); api.log(p, 'Bolfar: the next crush attack this turn may attack an additional hero.'); },
      botValue: ({ s }) => (s.players.length > 2 ? 1 : 0),
    }],
  },
  {
    id: 'brevant',
    summary: 'Any number of Chivalry in the deck. Whenever you protect another hero (Ultimate Pit Fight), create a Might token.',
    match: (t) => t.includes('You may have any number of Chivalry in your deck'),
    onProtect: ({ p, api }) => api.createToken(p, 'Might', 1),
  },
  {
    id: 'kox',
    summary: 'Action, destroy a Gold: go again. There is no event deck in this simulator, so looking at it does nothing.',
    match: (t) => t.includes('Look at the top 3 cards of the event deck'),
    activations: [{
      label: 'Destroy a Gold: look at the event deck', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => goldCount(p) > 0,
      resolve: ({ p, api }) => { api.destroyNamed(p, 'Gold'); api.log(p, 'Fightmaster Kox looks at the event deck (none in this game).'); },
      botValue: () => -1,
    }],
  },
  {
    id: 'frankie',
    summary: 'Your equipment is banished instead of going to the graveyard. Action {r}{r}{r}: equip the best destroyed equipment from another hero’s graveyard (it replaces yours in that slot). Go again.',
    banishOwnEquipment: true,
    match: (t) => t.includes('Whenever an equipment you control would be put into a graveyard, instead banish it'),
    activations: [{
      label: 'Equip an equipment from a graveyard', instant: false, oncePerTurn: false, goAgain: true,
      cost: () => 3,
      canUse: ({ s, p }) => !!graveEquipment(s, p),
      resolve: ({ s, p, api }) => {
        const g = graveEquipment(s, p);
        if (!g) return;
        g.owner.equipment = g.owner.equipment.filter((e) => e !== g.e);
        api.equip(p, g.e.inst.cardId);
      },
      botValue: ({ s, p }) => { const g = graveEquipment(s, p); return g ? (card(g.e.inst.cardId).defense as number ?? 0) - 1 : 0; },
    }],
  },
  {
    id: 'reya',
    summary: 'Your blocks and equipment with 1+{d} have protect: in Ultimate Pit Fight you may defend attacks on other heroes. Whenever you protect another hero, create a Gold token.',
    protectAll: true,
    match: (t) => t.includes('Blocks you own and equipment you control with 1 or greater {d} get protect'),
    onProtect: ({ p, api }) => api.createToken(p, 'Gold', 1),
  },
  {
    id: 'ruudi',
    summary: 'Once per turn Action {r}: reveal the top card. No card in this simulator is graded Gem Mint 10, so each opponent draws a card. Go again.',
    match: (t) => t.includes('If it\'s graded Gem Mint 10, put it into your hand'),
    activations: [{
      label: 'Reveal the top card (Gem Mint 10?)', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 1,
      canUse: ({ p }) => p.deck.length > 0,
      resolve: ({ s, p, api }) => {
        api.log(p, `Ruu'di reveals ${cardOf(p.deck[0]).name}: not graded Gem Mint 10.`);
        for (const q of s.players) if (q.id !== p.id && !q.eliminated) api.draw(q, 1);
      },
      botValue: () => -1,
    }],
  },
  {
    id: 'squizzy',
    summary: 'At the start of each opposing hero’s turn, they may create a Cracked Bauble in their hand. If they do, you create a Gold token.',
    match: (t) => t.includes('they may create a Cracked Bauble in their hand'),
    opponentStartOfTurn: ({ p, api }, opp) => api.ask(opp, p, 'squizzy', `Squizzy & Floof: create a Cracked Bauble in your hand? (${p.name} gets a Gold token.)`, true, [opp.id], [baubleId()]),
    onChoice: ({ s, p, api }, key, yes, data) => {
      if (key !== 'squizzy' || !yes) return;
      const opp = s.players[data![0]];
      opp.hand.push(api.mk(baubleId(), opp));
      api.log(opp, `${opp.name} creates a Cracked Bauble in their hand.`);
      api.createToken(p, 'Gold', 1);
    },
  },
  {
    id: 'taipanis',
    summary: 'The first time each turn another hero is attacked for lethal damage, you may discard a red card to send the attack at another hero the attacker can attack (Ultimate Pit Fight).',
    match: (t) => t.includes('becomes the target of a source that would deal lethal damage'),
    onOtherAttack: ({ s, p, api }, l) => {
      if (flag(p, 'taipanis')) return;
      const def = s.players[l.defender ?? -1];
      const red = p.hand.find((h) => cardOf(h).pitch === 1);
      if (!def || !red || l.basePower + l.powerMod < def.life) return;
      const others = s.players.filter((q) => !q.eliminated && q.id !== l.attacker && q.id !== def.id && api.targets(s.players[l.attacker]).includes(q));
      if (!others.length) return;
      const to = others.find((q) => q.id !== p.id) ?? others[0];
      api.ask(p, p, 'taipanis', `Taipanis: discard ${cardOf(red).name} to send ${cardOf(l.inst).name} at ${to.name} instead of ${def.name}?`, to.id !== p.id, [s.chain.indexOf(l), to.id, red.uid], [red.cardId]);
    },
    onChoice: ({ s, p, api }, key, yes, data) => {
      if (key !== 'taipanis' || !yes) return;
      const [li, to, uid] = data!;
      const l = s.chain[li];
      const red = p.hand.find((h) => h.uid === uid);
      if (!l || l.damage !== null || !red) return;
      setFlag(p, 'taipanis');
      api.discard(p, red);
      l.defender = to as ChainLink['defender'];
      if (s.phase === 'defend') s.priority = to as GameState['priority'];
      api.log(p, `Taipanis sends ${cardOf(l.inst).name} at ${s.players[to].name}.`);
    },
  },
  {
    id: 'taylor',
    summary: 'At the start of your turn, you may banish an equipment you control to equip one of the same type from your inventory (the Classic Constructed pool you didn’t pick, or extra equipment in the deck list).',
    match: (t) => t.includes('If you do, equip a card of the same subtype from your inventory'),
    startOfTurn: ({ p, api }) => {
      const swap = taylorSwap(p);
      if (!swap) return;
      api.ask(p, p, 'taylor', `Taylor: banish ${cardOf(swap.e.inst).name} and equip ${card(swap.cid).name}?`, swap.gain > 0, [swap.e.inst.uid, swap.idx], [swap.e.inst.cardId, swap.cid]);
    },
    onChoice: ({ p, api }, key, yes, data) => {
      if (key !== 'taylor' || !yes) return;
      const [uid, idx] = data!;
      const cid = p.inventory?.[idx];
      const old = api.removeEquipment(p, uid);
      if (!cid || !old) return;
      p.inventory!.splice(idx, 1);
      p.banished.push(old);
      api.log(p, `Taylor banishes ${cardOf(old).name}.`);
      api.equip(p, cid);
    },
  },
  {
    id: 'librarian',
    summary: 'Action, reveal a Tome from your inventory: put it into your hand; another hero (the one with the least life) gets +1 intellect until the end of their next turn. Go again.',
    match: (t) => t.includes('reveal a card with Tome in its name from your inventory'),
    activations: [{
      label: 'Fetch a Tome from your inventory', instant: false, oncePerTurn: true, goAgain: true,
      cost: () => 0,
      canUse: ({ p }) => (p.inventory ?? []).some((id) => card(id).name.includes('Tome')),
      resolve: ({ s, p, api }) => {
        const i = (p.inventory ?? []).findIndex((id) => card(id).name.includes('Tome'));
        if (i < 0) return;
        const [cid] = p.inventory!.splice(i, 1);
        p.hand.push(api.mk(cid, p));
        const q = lowestLife(s.players.filter((x) => x.id !== p.id && !x.eliminated));
        api.log(p, `The Librarian puts ${card(cid).name} into their hand.`);
        if (q) { q.intellect += 1; q.bonusIntellect = (q.bonusIntellect ?? 0) + 1; api.log(q, `${q.name} gets +1 intellect until the end of their next turn.`); }
      },
      botValue: () => 2,
    }],
  },
  {
    id: 'theryon',
    summary: 'The first time each turn another hero destroys a card they don’t control (an ally killed by their damage), you may pay {r}{r}: they destroy a non-hero permanent they control.',
    partial: true,
    match: (t) => t.includes('another hero destroys a card they don\'t control'),
    onOtherDestroys: ({ p, api }, by) => {
      if (flag(p, 'theryon')) return;
      setFlag(p, 'theryon');
      api.ask(p, p, 'theryon', `Theryon: pay 2 to make ${by.name} destroy a permanent they control?`, by.permanents.length > 0 || by.equipment.some((e) => !e.destroyed), [by.id]);
    },
    onChoice: ({ s, p, api }, key, yes, data) => {
      if (key !== 'theryon' || !yes || !api.pay(p, 2)) return;
      const by = s.players[data![0]];
      const pm = by.permanents[0];
      if (pm) { api.destroyNamed(by, cardOf(pm.inst).name); return; }
      const e = by.equipment.find((x) => !x.destroyed);
      if (e) { e.destroyed = true; api.log(by, `${cardOf(e.inst).name} is destroyed.`); }
    },
  },
  {
    id: 'yoji',
    summary: 'Once per turn Instant {r}{r}{r}: the next time another hero (the one being attacked, else the one you face) would be dealt damage this turn, Yoji takes it instead and 1 of it is prevented.',
    match: (t) => t.includes('instead that damage is dealt to Yoji'),
    activations: [{
      label: 'Take the next damage for another hero', instant: true, oncePerTurn: true,
      cost: () => 3,
      canUse: ({ s, p }) => s.players.some((q) => q.id !== p.id && !q.eliminated),
      resolve: ({ s, p, opp, api }) => {
        const l = s.chain[s.chain.length - 1];
        const q = l && l.damage === null && l.defender !== undefined && l.defender !== p.id ? s.players[l.defender] : opp;
        q.redirectTo = p.id;
        api.log(p, `Yoji will take the next damage dealt to ${q.name} this turn.`);
      },
      botValue: () => -1,
    }],
  },
  {
    id: 'yorick',
    summary: 'At the start of the game, every hero’s deck is shuffled together and dealt back out evenly. (The shared graveyard isn’t simulated: each hero keeps their own.)',
    partial: true,
    match: (t) => t.includes('all heroes shuffle their starting decks together'),
    setup: ({ s, api }) => {
      const all = api.shuffle(s.players.flatMap((q) => q.deck));
      const n = s.players.length;
      s.players.forEach((q, i) => { q.deck = all.filter((_, j) => j % n === i); });
      api.log(null, 'Yorick: every hero’s deck is shuffled together and shared out.');
    },
  },
);

function graveEquipment(s: GameState, p: PlayerState) {
  let best: { owner: PlayerState; e: PlayerState['equipment'][number] } | null = null;
  for (const owner of s.players) {
    if (owner.id === p.id || getHeroAbility(cardOf(owner.hero))?.banishOwnEquipment) continue;
    for (const e of owner.equipment) {
      if (!e.destroyed) continue;
      if (!best || (card(e.inst.cardId).defense as number ?? 0) > (card(best.e.inst.cardId).defense as number ?? 0)) best = { owner, e };
    }
  }
  return best;
}

function taylorSwap(p: PlayerState) {
  let best: { e: PlayerState['equipment'][number]; cid: string; idx: number; gain: number } | null = null;
  (p.inventory ?? []).forEach((cid, idx) => {
    const c = card(cid);
    const slot = slotOf(c);
    if (!slot || c.types.includes('Weapon')) return;
    const e = p.equipment.find((x) => !x.destroyed && cardOf(x.inst).types.includes(slot));
    if (!e) return;
    const gain = (typeof c.defense === 'number' ? c.defense : 0) - ((cardOf(e.inst).defense as number ?? 0) + e.defenseMod);
    if (!best || gain > best.gain) best = { e, cid, idx, gain };
  });
  return best as { e: PlayerState['equipment'][number]; cid: string; idx: number; gain: number } | null;
}

const baubleId = () => findCard('Cracked Bauble')!.id;
