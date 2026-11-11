export type Format = 'blitz' | 'cc' | 'sage' | 'commoner' | 'll';

export interface Card {
  id: string;
  name: string;
  pitch: number | null;
  cost: number | string | null;
  power: number | string | null;
  defense: number | string | null;
  health: number | null;
  intellect: number | null;
  arcane: number | null;
  types: string[];
  traits: string[];
  keywords: string[];
  text: string;
  typeText: string;
  legal: Format[];
  rarity: string;
  sets: string[];
  printId: string;
  image: string;
}

export const CLASSES = [
  'Generic', 'Warrior', 'Guardian', 'Mechanologist', 'Runeblade', 'Ninja', 'Brute', 'Assassin',
  'Illusionist', 'Wizard', 'Ranger', 'Pirate', 'Necromancer', 'Shapeshifter', 'Adjudicator',
  'Bard', 'Merchant', 'Thief',
];
export const TALENTS = [
  'Light', 'Shadow', 'Draconic', 'Elemental', 'Ice', 'Earth', 'Lightning', 'Mystic', 'Royal',
  'Revered', 'Reviled', 'Chaos',
];
export const ELEMENTS = ['Ice', 'Earth', 'Lightning'];

export const FORMAT_NAMES: Record<string, string> = {
  blitz: 'Blitz',
  cc: 'Classic Constructed',
  casual: 'Casual (anything goes)',
};

export const PITCH_COLOR: Record<number, string> = { 1: 'red', 2: 'yellow', 3: 'blue' };
