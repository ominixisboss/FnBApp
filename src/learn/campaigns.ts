// Story campaigns: a run of battles for one hero, each with a short scene and a twist, getting harder as it goes.
// The stories are original to this app (Flesh and Blood has no official single-player campaign).
import type { Difficulty } from '../engine/types';

export interface Chapter {
  id: string;
  title: string;
  /** the scene before the battle (two or three sentences) */
  story: string;
  /** the opponent, by hero name (first matching Blitz hero) */
  opponent: string;
  difficulty: Difficulty;
  twist?: { oppLife?: number; myLife?: number; goSecond?: boolean; label: string };
}

export interface Campaign {
  id: string;
  title: string;
  hero: string;
  blurb: string;
  /** cosmetic sleeve unlocked by finishing it */
  reward: { id: string; name: string };
  chapters: Chapter[];
}

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'proving-grounds', title: 'The Proving Grounds', hero: 'Dorinthea', reward: { id: 'proving', name: 'Proving Grounds' },
    blurb: 'A young swordswoman with a borrowed blade enters the arena circuit of a city that worships champions.',
    chapters: [
      { id: 'pg1', title: 'Sand and Splinters', opponent: 'Bravo', difficulty: 'easy',
        story: 'The first bout is meant to be a joke: a nobody against the crowd’s favourite wall of a man. The crowd laughs as you step onto the sand. Make them stop.' },
      { id: 'pg2', title: 'The Quiet Fist', opponent: 'Katsu', difficulty: 'easy',
        story: 'Your next opponent never speaks and never wastes a motion. Every strike leads into the next. Break the rhythm before it breaks you.' },
      { id: 'pg3', title: 'Something Wild', opponent: 'Tuffnut', difficulty: 'normal', twist: { oppLife: 4, label: 'The beast is bloodied but furious: it starts with 4 extra life.' },
        story: 'They let something out of the pens tonight. It hits like a landslide and never thinks twice. Keep your blade between you and it.' },
      { id: 'pg4', title: 'Spellfire at Noon', opponent: 'Oscilio', difficulty: 'normal', twist: { goSecond: true, label: 'The mage strikes first: you go second.' },
        story: 'A scholar of storms has bought a place on the card. Steel can’t parry lightning. You’ll have to be faster than the next bolt.' },
      { id: 'pg5', title: 'The Gilded Blade', opponent: 'Kassai', difficulty: 'hard',
        story: 'The semifinal is against a duelist who fights for gold and never loses it. Her blade sings the same song as yours, only louder.' },
      { id: 'pg6', title: 'Champion of the Sand', opponent: 'Boltyn', difficulty: 'mythic', twist: { oppLife: 2, label: 'The reigning champion starts with 2 extra life.' },
        story: 'The champion’s armour shines brighter than the sun on the sand. Every hero who ever stood here is watching. Finish what you started.' },
    ],
  },
  {
    id: 'embers', title: 'Embers Rising', hero: 'Fai', reward: { id: 'embers', name: 'Ember Oath' },
    blurb: 'A wandering fire-dancer follows a trail of scorched shrines, looking for whoever is stealing the dragons’ flame.',
    chapters: [
      { id: 'em1', title: 'Ash on the Wind', opponent: 'Zen', difficulty: 'easy',
        story: 'A mountain monk blocks the shrine road and won’t let anyone carrying fire pass. Show him your flame is a friend.' },
      { id: 'em2', title: 'Cold Hearth', opponent: 'Lexi', difficulty: 'easy', twist: { myLife: -2, label: 'The frost bites: you start with 2 less life.' },
        story: 'The second shrine is frozen solid. An archer of ice and lightning stands over it, arrow already nocked.' },
      { id: 'em3', title: 'Smoke and Mirrors', opponent: 'Dromai', difficulty: 'normal',
        story: 'The thief is an artist who paints dragons out of ash and sets them loose. Her creatures are illusions, but their claws are real.' },
      { id: 'em4', title: 'The Scaled Court', opponent: 'Cindra', difficulty: 'normal', twist: { goSecond: true, label: 'You arrive late: you go second.' },
        story: 'The trail leads to a court where dragons are bargained for like horses. Its enforcer doesn’t like strangers asking about stolen fire.' },
      { id: 'em5', title: 'Iron and Cinders', opponent: 'Fang', difficulty: 'hard',
        story: 'The court sends its sharpest blade after you. He has hunted fire-dancers before and kept their embers in a jar.' },
      { id: 'em6', title: 'The Emperor’s Flame', opponent: 'Emperor', difficulty: 'mythic', twist: { oppLife: 3, label: 'Burning with stolen fire, the Emperor starts with 3 extra life.' },
        story: 'At the top of the last shrine, the thief wears the dragons’ flame like a crown. Take it back, one blow at a time.' },
    ],
  },
  {
    id: 'knives', title: 'Night of Knives', hero: 'Arakni', reward: { id: 'knives', name: 'Silk Shadows' },
    blurb: 'An assassin is handed a list of names and one rule: nobody may see the knife.',
    chapters: [
      { id: 'kn1', title: 'The First Name', opponent: 'Genis Wotchuneed', difficulty: 'easy',
        story: 'The first mark is a merchant who talks too much. Tonight he’ll talk to someone who listens very carefully.' },
      { id: 'kn2', title: 'A Guarded Door', opponent: 'Brevant', difficulty: 'easy', twist: { oppLife: 3, label: 'The bodyguard is ready: 3 extra life.' },
        story: 'The second name hides behind a guardian who has never let a blade past his shield. There is always a gap.' },
      { id: 'kn3', title: 'Rival Contract', opponent: 'Uzuri', difficulty: 'normal',
        story: 'Someone else was paid for the same name. Two shadows in one alley is one too many.' },
      { id: 'kn4', title: 'The Masked Ball', opponent: 'Nuu', difficulty: 'normal', twist: { goSecond: true, label: 'She saw you first: you go second.' },
        story: 'The fourth mark dances in a hall of masks, and her smile is a weapon. Everyone here is lying, including you.' },
      { id: 'kn5', title: 'The Bonecollector', opponent: 'Dr. Mortimer', difficulty: 'hard',
        story: 'The man who wrote your list wants it back, and he’s brought something that used to be alive.' },
      { id: 'kn6', title: 'The Last Name', opponent: 'Levia', difficulty: 'mythic', twist: { oppLife: 2, label: 'The thing in the dark starts with 2 extra life.' },
        story: 'The last name on the list isn’t a person any more. It waits in the dark under the city, and it knows you are coming.' },
    ],
  },
  {
    id: 'storm', title: 'The Storm Scholar', hero: 'Oscilio', reward: { id: 'storm-scholar', name: 'Storm Scholar' },
    blurb: 'A mage’s thesis on lightning is rejected by the academy. So he goes out to prove it in the field.',
    chapters: [
      { id: 'st1', title: 'A Practical Exam', opponent: 'Kayo', difficulty: 'easy',
        story: 'A brawler outside the academy gates wants to know if books can punch. Today you test the first theorem.' },
      { id: 'st2', title: 'Steam and Sparks', opponent: 'Dash', difficulty: 'easy',
        story: 'An inventor claims her engines are faster than any spell. Faster isn’t the same as smarter.' },
      { id: 'st3', title: 'The Rune Thief', opponent: 'Vynnset', difficulty: 'normal', twist: { oppLife: 3, label: 'Fed on stolen runes: 3 extra life.' },
        story: 'Someone is stealing the academy’s rune stones and burning them for power. The trail smells of blood magic.' },
      { id: 'st4', title: 'Mirror Match', opponent: 'Blaze', difficulty: 'normal', twist: { goSecond: true, label: 'Your old classmate casts first: you go second.' },
        story: 'Your old classmate got the professorship you wanted. Now she’s been sent to bring you back.' },
      { id: 'st5', title: 'Living Storm', opponent: 'Aurora', difficulty: 'hard',
        story: 'In the mountains you find someone who doesn’t study lightning: she is lightning. Your theorems are going to need revising.' },
      { id: 'st6', title: 'The Defense', opponent: 'Prism', difficulty: 'mythic', twist: { oppLife: 2, label: 'The examiner’s light shields her: 2 extra life.' },
        story: 'The academy’s greatest mind agrees to judge your work in the only test that matters. Every spell is a sentence of your thesis.' },
    ],
  },
];

// ---------------------------------------------------------------- progress

const KEY = 'fab-trainer.campaigns.v1';
export function campaignProgress(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function completeChapter(campaignId: string, chapterId: string) {
  const p = campaignProgress();
  p[campaignId] = [...new Set([...(p[campaignId] ?? []), chapterId])];
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
/** campaigns with every chapter won */
export function finishedCampaigns(): string[] {
  const p = campaignProgress();
  return CAMPAIGNS.filter((c) => c.chapters.every((ch) => p[c.id]?.includes(ch.id))).map((c) => c.id);
}
