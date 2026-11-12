// Progression: XP, levels, daily quests, achievements and unlockable cosmetics.
// Everything is computed from the match history (which already syncs between devices) plus a small
// local record of puzzle / gauntlet feats, so there is no separate progress state to keep in sync.
import { getDb } from '../data/cardDb';
import { CLASSES } from '../data/types';
import type { MatchRecord } from './matches';

/** Extra numbers recorded at the end of each game (for quests and achievements). */
export interface MatchStats {
  damageDealt: number;
  maxTurnDamage: number;
  attacks: number;
  blocks: number;
  cardsPlayed: number;
}

// ---------------------------------------------------------------- feats (puzzles, gauntlet)

export interface Feats { puzzles: string[]; gauntletBest: number; gauntletWins: number; sealedWins: number; draftWins: number }
const FEATS_KEY = 'fab-trainer.feats.v1';
export function loadFeats(): Feats {
  try { return { puzzles: [], gauntletBest: 0, gauntletWins: 0, sealedWins: 0, draftWins: 0, ...JSON.parse(localStorage.getItem(FEATS_KEY) ?? '{}') }; } catch { return { puzzles: [], gauntletBest: 0, gauntletWins: 0, sealedWins: 0, draftWins: 0 }; }
}
export function saveFeats(f: Feats) {
  try { localStorage.setItem(FEATS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fab-feats'));
}
export function updateFeats(fn: (f: Feats) => Feats) { saveFeats(fn(loadFeats())); }

// ---------------------------------------------------------------- helpers

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const todayKey = () => dayKey(Date.now());
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function heroClass(heroId: string): string {
  const h = getDb().byId.get(heroId);
  return h?.types.find((t) => CLASSES.includes(t) && t !== 'Generic') ?? 'Generic';
}
const won = (m: MatchRecord) => m.won;

// ---------------------------------------------------------------- XP and levels

export function matchXp(m: MatchRecord): number {
  let xp = 40 + (m.won ? 60 : 0);
  if (m.difficulty === 'hard') xp += 20;
  if (m.mode === 'online') xp += 30;
  return xp;
}
/** XP needed to go from level L to L+1. */
export const levelCost = (L: number) => 150 + 50 * (L - 1);
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = xp;
  while (left >= levelCost(level)) { left -= levelCost(level); level++; }
  return { level, into: left, need: levelCost(level) };
}
const TITLES = ['Novice', 'Apprentice', 'Squire', 'Adept', 'Veteran', 'Champion', 'Warlord', 'Legend', 'Mythic'];
export const levelTitle = (L: number) => TITLES[Math.min(TITLES.length - 1, Math.floor((L - 1) / 4))];

// ---------------------------------------------------------------- daily quests

export interface Quest { id: string; text: string; goal: number; reward: number; progress: (ms: MatchRecord[]) => number }
const QUEST_CLASSES = ['Warrior', 'Ninja', 'Brute', 'Guardian', 'Wizard', 'Runeblade', 'Mechanologist', 'Ranger', 'Illusionist', 'Assassin'];
function questPool(seed: number): Quest[] {
  const cls = QUEST_CLASSES[seed % QUEST_CLASSES.length];
  const st = (m: MatchRecord) => (m as MatchRecord & { stats?: MatchStats }).stats;
  return [
    { id: 'win1', text: 'Win a game', goal: 1, reward: 100, progress: (ms) => ms.filter(won).length },
    { id: 'win2', text: 'Win 2 games', goal: 2, reward: 150, progress: (ms) => ms.filter(won).length },
    { id: 'play3', text: 'Play 3 games', goal: 3, reward: 120, progress: (ms) => ms.length },
    { id: `class-${cls}`, text: `Win with a ${cls} hero`, goal: 1, reward: 150, progress: (ms) => ms.filter((m) => m.won && heroClass(m.myHeroId) === cls).length },
    { id: 'dmg30', text: 'Deal 30 damage', goal: 30, reward: 120, progress: (ms) => ms.reduce((a, m) => a + (st(m)?.damageDealt ?? 0), 0) },
    { id: 'atk8', text: 'Attack 8 times', goal: 8, reward: 100, progress: (ms) => ms.reduce((a, m) => a + (st(m)?.attacks ?? 0), 0) },
    { id: 'blk6', text: 'Block with 6 cards', goal: 6, reward: 100, progress: (ms) => ms.reduce((a, m) => a + (st(m)?.blocks ?? 0), 0) },
    { id: 'hard', text: 'Beat a Normal or Hard bot', goal: 1, reward: 150, progress: (ms) => ms.filter((m) => m.won && (m.difficulty === 'normal' || m.difficulty === 'hard')).length },
    { id: 'burst10', text: 'Deal 10+ damage in one turn', goal: 1, reward: 150, progress: (ms) => ms.filter((m) => (st(m)?.maxTurnDamage ?? 0) >= 10).length },
  ];
}
/** The 3 quests for a given day (the same for everyone, changing at midnight). */
export function questsFor(day: string): Quest[] {
  const seed = hash(day);
  const pool = questPool(seed);
  const picked: Quest[] = [];
  let i = seed;
  while (picked.length < 3) {
    const q = pool[i % pool.length];
    if (!picked.some((p) => p.id === q.id || (p.id.startsWith('win') && q.id.startsWith('win')))) picked.push(q);
    i = Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 0;
  }
  return picked;
}
export function questStatus(day: string, matches: MatchRecord[]) {
  const ms = matches.filter((m) => dayKey(m.date) === day);
  return questsFor(day).map((q) => { const p = Math.min(q.goal, q.progress(ms)); return { ...q, value: p, done: p >= q.goal }; });
}

// ---------------------------------------------------------------- achievements

export interface Achievement { id: string; icon: string; name: string; text: string; reward: number; check: (ms: MatchRecord[], f: Feats) => number; goal: number }
const stats = (m: MatchRecord) => (m as MatchRecord & { stats?: MatchStats }).stats;
const count = (ms: MatchRecord[], f: (m: MatchRecord) => boolean) => ms.filter(f).length;
function maxStreak(ms: MatchRecord[]) { let best = 0; let cur = 0; for (const m of [...ms].sort((a, b) => a.date - b.date)) { cur = m.won ? cur + 1 : 0; best = Math.max(best, cur); } return best; }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', icon: '🏆', name: 'First Blood', text: 'Win your first game', goal: 1, reward: 100, check: (ms) => count(ms, won) },
  { id: 'wins-10', icon: '⚔', name: 'Seasoned', text: 'Win 10 games', goal: 10, reward: 200, check: (ms) => count(ms, won) },
  { id: 'wins-50', icon: '👑', name: 'Conqueror', text: 'Win 50 games', goal: 50, reward: 500, check: (ms) => count(ms, won) },
  { id: 'wins-100', icon: '🐉', name: 'Living Legend', text: 'Win 100 games', goal: 100, reward: 1000, check: (ms) => count(ms, won) },
  { id: 'hard', icon: '💀', name: 'Giant Slayer', text: 'Beat a Hard bot', goal: 1, reward: 200, check: (ms) => count(ms, (m) => m.won && m.difficulty === 'hard') },
  { id: 'online', icon: '🌐', name: 'Proven', text: 'Win an online game', goal: 1, reward: 200, check: (ms) => count(ms, (m) => m.won && m.mode === 'online') },
  { id: 'classes-5', icon: '🎭', name: 'Versatile', text: 'Win with 5 different classes', goal: 5, reward: 300, check: (ms) => new Set(ms.filter(won).map((m) => heroClass(m.myHeroId))).size },
  { id: 'classes-all', icon: '🌈', name: 'Master of All', text: 'Win with 10 different classes', goal: 10, reward: 800, check: (ms) => new Set(ms.filter(won).map((m) => heroClass(m.myHeroId))).size },
  { id: 'burst-20', icon: '🔥', name: 'Overkill', text: 'Deal 20+ damage in a single turn', goal: 1, reward: 300, check: (ms) => count(ms, (m) => (stats(m)?.maxTurnDamage ?? 0) >= 20) },
  { id: 'comeback', icon: '❤️‍🔥', name: 'Comeback', text: 'Win with 3 life or less', goal: 1, reward: 200, check: (ms) => count(ms, (m) => m.won && m.lifeLeft <= 3) },
  { id: 'untouched', icon: '🛡', name: 'Untouchable', text: 'Win a Blitz game without dropping below 15 life', goal: 1, reward: 300, check: (ms) => count(ms, (m) => m.won && m.format === 'blitz' && m.lifeLeft >= 15) },
  { id: 'speed', icon: '⚡', name: 'Blitzkrieg', text: 'Win in 6 turns or fewer', goal: 1, reward: 200, check: (ms) => count(ms, (m) => m.won && m.turns <= 6) },
  { id: 'streak-5', icon: '📈', name: 'On Fire', text: 'Win 5 games in a row', goal: 5, reward: 300, check: (ms) => maxStreak(ms) },
  { id: 'formats', icon: '📚', name: 'All Rounder', text: 'Win in Blitz and Classic Constructed', goal: 2, reward: 200, check: (ms) => new Set(ms.filter((m) => m.won && (m.format === 'blitz' || m.format === 'cc')).map((m) => m.format)).size },
  { id: 'games-25', icon: '🎲', name: 'Regular', text: 'Play 25 games', goal: 25, reward: 200, check: (ms) => ms.length },
  { id: 'puzzle-1', icon: '🧩', name: 'Puzzler', text: 'Solve a lethal puzzle', goal: 1, reward: 150, check: (_m, f) => f.puzzles.length },
  { id: 'puzzle-all', icon: '🧠', name: 'Grandmaster', text: 'Solve 8 lethal puzzles', goal: 8, reward: 500, check: (_m, f) => f.puzzles.length },
  { id: 'gauntlet', icon: '🏟', name: 'Gauntlet Champion', text: 'Beat every opponent in the Gauntlet', goal: 1, reward: 600, check: (_m, f) => f.gauntletWins },
  { id: 'limited', icon: '📦', name: 'Pack Master', text: 'Win a Sealed or Draft game', goal: 1, reward: 300, check: (_m, f) => f.sealedWins + f.draftWins },
];

// ---------------------------------------------------------------- cosmetics

export type CosmeticKind = 'sleeve' | 'mat' | 'frame';
export interface Cosmetic { id: string; kind: CosmeticKind; name: string; unlock: { level?: number; achievement?: string } }
export const COSMETICS: Cosmetic[] = [
  { id: 'classic', kind: 'sleeve', name: 'Crimson', unlock: { level: 1 } },
  { id: 'gold', kind: 'sleeve', name: 'Gilded', unlock: { level: 3 } },
  { id: 'azure', kind: 'sleeve', name: 'Azure', unlock: { level: 5 } },
  { id: 'emerald', kind: 'sleeve', name: 'Emerald', unlock: { level: 8 } },
  { id: 'obsidian', kind: 'sleeve', name: 'Obsidian', unlock: { level: 12 } },
  { id: 'dragon', kind: 'sleeve', name: 'Dragonscale', unlock: { achievement: 'burst-20' } },
  { id: 'champion', kind: 'sleeve', name: 'Champion', unlock: { achievement: 'gauntlet' } },
  { id: 'tavern', kind: 'mat', name: 'Tavern', unlock: { level: 1 } },
  { id: 'ember', kind: 'mat', name: 'Emberforge', unlock: { level: 4 } },
  { id: 'frost', kind: 'mat', name: 'Frostfall', unlock: { level: 7 } },
  { id: 'void', kind: 'mat', name: 'Void', unlock: { level: 10 } },
  { id: 'royal', kind: 'mat', name: 'Royal Court', unlock: { achievement: 'wins-50' } },
  { id: 'storm', kind: 'mat', name: 'Stormfront', unlock: { achievement: 'classes-5' } },
  { id: 'none', kind: 'frame', name: 'Plain', unlock: { level: 1 } },
  { id: 'bronze', kind: 'frame', name: 'Bronze', unlock: { level: 2 } },
  { id: 'silver', kind: 'frame', name: 'Silver', unlock: { level: 6 } },
  { id: 'goldf', kind: 'frame', name: 'Gold', unlock: { level: 10 } },
  { id: 'flame', kind: 'frame', name: 'Phoenix', unlock: { achievement: 'comeback' } },
  { id: 'mythic', kind: 'frame', name: 'Mythic', unlock: { achievement: 'wins-100' } },
];

// ---------------------------------------------------------------- everything together

export interface Progress {
  xp: number; level: number; into: number; need: number; title: string;
  quests: ReturnType<typeof questStatus>;
  achievements: (Achievement & { value: number; done: boolean })[];
  unlocked: Set<string>;
}

export function computeProgress(matches: MatchRecord[], feats: Feats = loadFeats()): Progress {
  let xp = matches.reduce((a, m) => a + matchXp(m), 0);
  for (const day of new Set(matches.map((m) => dayKey(m.date)))) xp += questStatus(day, matches).filter((q) => q.done).reduce((a, q) => a + q.reward, 0);
  const achievements = ACHIEVEMENTS.map((a) => { const v = Math.min(a.goal, a.check(matches, feats)); return { ...a, value: v, done: v >= a.goal }; });
  xp += achievements.filter((a) => a.done).reduce((s, a) => s + a.reward, 0);
  xp += feats.puzzles.length * 50 + feats.gauntletBest * 40;
  const lv = levelOf(xp);
  const done = new Set(achievements.filter((a) => a.done).map((a) => a.id));
  const unlocked = new Set(COSMETICS.filter((c) => (c.unlock.level !== undefined && lv.level >= c.unlock.level) || (c.unlock.achievement && done.has(c.unlock.achievement))).map((c) => c.id));
  return { xp, ...lv, title: levelTitle(lv.level), quests: questStatus(todayKey(), matches), achievements, unlocked };
}

/** What changed between two progress snapshots (shown after a game). */
export function progressDiff(a: Progress, b: Progress) {
  return {
    xp: b.xp - a.xp,
    levelUp: b.level > a.level ? b.level : null,
    quests: b.quests.filter((q, i) => q.done && !a.quests[i]?.done),
    achievements: b.achievements.filter((x, i) => x.done && !a.achievements[i].done),
    unlocks: COSMETICS.filter((c) => b.unlocked.has(c.id) && !a.unlocked.has(c.id)),
  };
}
