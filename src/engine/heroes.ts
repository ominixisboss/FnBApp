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
  /** Levia: skip blood debt this end phase */
  skipBloodDebt?(ctx: HeroCtx): boolean;
  /** Lyath: halve base power / defense */
  halveStats?: boolean;
  pitchToBanished?: boolean;
  activations?: HeroActivation[];
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
    summary: 'The first time the crowd boos you each turn, each hero with more {h} than you loses 1{h}.',
    partial: true, // stealing Gold isn't automated
    match: (t) => t.includes('The first time the crowd boos you each turn, each hero with more {h} than you loses 1{h}'),
    onBoo: ({ s, p, api }) => {
      if (flag(p, 'kjBoo')) return;
      setFlag(p, 'kjBoo');
      for (const pl of s.players) if (pl.id !== p.id && pl.life > p.life) { pl.life -= 1; api.log(pl, `${pl.name} loses 1 life (${pl.life}).`); }
    },
  },
);

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
