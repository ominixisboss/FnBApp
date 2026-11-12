// Hero-tuned deck building: signature cards plus a scoring bonus that fits each hero's plan.
// Used for the AI opponents' decks and for starter decks.
import type { Card } from '../data/types';
import { has, n } from '../data/cardDb';
import { getScript } from '../engine/cardScript';

export interface Archetype {
  id: string;
  label: string;
  signature: string[];
  bonus(c: Card): number;
}

const isAttackAction = (c: Card) => has(c, 'Attack') && has(c, 'Action');
const text = (c: Card) => c.text.toLowerCase();
const goAgain = (c: Card) => getScript(c).goAgain;

const GENERIC = ['Command and Conquer', 'Enlightened Strike', 'Sink Below', 'Fate Foreseen', 'Snatch', 'Scar for a Scar', 'Wounding Blow', 'Raging Onslaught', 'Nimble Strike', 'Brutal Assault', 'Sigil of Solace', 'Down and Dirty', 'Lunging Press'];

const ARCHETYPES: (Archetype & { heroes: string[] })[] = [
  {
    id: 'weapon-warrior', label: 'Weapon Warrior', heroes: ['Dorinthea', 'Kassai', 'Hala', 'Olympia', 'Boltyn', 'Zane'],
    signature: ['Warrior\'s Valor', 'Ironsong Response', 'Driving Blade', 'Steelblade Supremacy', 'Sharpen Steel', 'En Garde', 'Biting Blade', 'Singing Steelblade', 'Hit and Run', 'Blade Flash', 'Run Through', 'Thrust', 'Glint the Quicksilver', 'Out for Blood'],
    bonus: (c) => (/(weapon|sword) attack/.test(text(c)) ? 3 : 0) + (has(c, 'Attack Reaction') ? 1.5 : 0),
  },
  {
    id: 'guardian-crush', label: 'Guardian Crush', heroes: ['Bravo', 'Brevant', 'Valda', 'Terra', 'Yoji', 'Pleiades', 'Betsy', 'Lyath'],
    signature: ['Crippling Crush', 'Spinal Crush', 'Cranial Crush', 'Pummel', 'Disable', 'Buckling Blow', 'Cartilage Crush', 'Macho Grande', 'Righteous Cleansing', 'Sink Below', 'Unmovable', 'Tear Asunder', 'Debilitate'],
    bonus: (c) => (isAttackAction(c) && n(c.cost) >= 3 ? 3 : 0) + (c.keywords.includes('Crush') ? 2 : 0) + (has(c, 'Defense Reaction') ? 1 : 0),
  },
  {
    id: 'ninja-combo', label: 'Ninja Combo', heroes: ['Katsu', 'Benji', 'Zen'],
    signature: ['Head Jab', 'Leg Tap', 'Surging Strike', 'Whelming Gustwave', 'Blackout Kick', 'Open the Center', 'Rising Knee Thrust', 'Lord of Wind', 'Hurricane Technique', 'Pounding Gale', 'Fluster Fist', 'Crane Dance', 'Flic Flak', 'Torrent of Tempo', 'Wax On', 'Spinning Wheel Kick'],
    bonus: (c) => (c.keywords.includes('Combo') || /combo/.test(text(c)) ? 2.5 : 0) + (isAttackAction(c) && goAgain(c) ? 2 : 0) + (isAttackAction(c) && n(c.power) <= 2 ? 1 : 0),
  },
  {
    id: 'brute-big', label: 'Brute Big Hits', heroes: ['Rhinar', 'Kayo', 'Levia', 'Tuffnut'],
    signature: ['Barraging Beatdown', 'Beast Within', 'Bloodrush Bellow', 'Pack Hunt', 'Smash Instinct', 'Wild Ride', 'Wrecker Romp', 'Savage Swing', 'Alpha Rampage', 'Reckless Swing', 'Breakneck Battery', 'Pulping', 'Bone Head Barrier', 'Awakening Bellow', 'Barraging Brawnhide'],
    bonus: (c) => (n(c.power) >= 6 ? 3 : 0) + (/discard/.test(text(c)) ? 1.5 : 0) + (c.keywords.includes('Intimidate') ? 1.5 : 0),
  },
  {
    id: 'draconic-aggro', label: 'Draconic Aggro', heroes: ['Fai', 'Cindra', 'Fang', 'Ira', 'Dromai', 'Emperor'],
    signature: ['Phoenix Flame', 'Brand with Cinderclaw', 'Lava Burst', 'Searing Emberblade', 'Ronin Renegade', 'Rising Resentment', 'Spreading Flames', 'Blaze Headlong', 'Belittle', 'Command and Conquer'],
    bonus: (c) => (c.types.includes('Draconic') ? 2.5 : 0) + (goAgain(c) ? 1.5 : 0) + (c.pitch === 1 ? 0.8 : 0),
  },
  {
    id: 'stealth-assassin', label: 'Stealth Assassin', heroes: ['Arakni', 'Uzuri', 'Nuu'],
    signature: [],
    bonus: (c) => (c.keywords.includes('Stealth') ? 3.5 : 0) + (/mark/.test(text(c)) ? 2 : 0) + (goAgain(c) ? 1 : 0),
  },
  {
    id: 'arcane-wizard', label: 'Arcane Wizard', heroes: ['Oscilio', 'Blaze', 'Verdance', 'Kano'],
    signature: ['Aether Spindle', 'Snapback', 'Blazing Aether', 'Lesson in Lava', 'Stir the Aetherwinds', 'Overflow the Aetherwell', 'Absorb in Aether', 'Aether Flare', 'Sonic Boom', 'Arcanic Crackle', 'Voltic Bolt', 'Foreboding Bolt', 'Chain Lightning', 'Kindle', 'Zap'],
    bonus: (c) => (/arcane damage/.test(text(c)) ? 3.5 : 0) + (has(c, 'Instant') ? 1 : 0),
  },
  {
    id: 'runechant', label: 'Runechant Runeblade', heroes: ['Vynnset', 'Viserai', 'Aurora', 'Florian', 'Chane'],
    signature: ['Consuming Volition', 'Rattle Bones', 'Mauvrion Skies', 'Reduce to Runechant', 'Arcanic Spike', 'Bloodspill Invocation', 'Rune Flash', 'Read the Runes', 'Shrill of Skullform', 'Condemn to Slaughter', 'Revel in Runeblood'],
    bonus: (c) => (/runechant/.test(text(c)) ? 3.5 : 0) + (/arcane damage/.test(text(c)) ? 1.5 : 0) + (goAgain(c) ? 1 : 0),
  },
  {
    id: 'mech-boost', label: 'Mechanologist Boost', heroes: ['Dash', 'Data Doll', 'Maxx', 'Teklovossen', 'Professor Teklovossen', 'Puffin'],
    signature: [],
    bonus: (c) => (getScript(c).boost ? 3 : 0) + (c.types.includes('Mechanologist') ? 1.5 : 0),
  },
];

const FALLBACK: Archetype = {
  id: 'midrange', label: 'Midrange', signature: GENERIC,
  bonus: (c) => (isAttackAction(c) && goAgain(c) ? 1 : 0),
};

export function archetypeFor(hero: Card): Archetype {
  const name = hero.name.toLowerCase();
  const a = ARCHETYPES.find((x) => x.heroes.some((h) => name.startsWith(h.toLowerCase())));
  if (!a) return FALLBACK;
  return { ...a, signature: [...a.signature, ...GENERIC] };
}
