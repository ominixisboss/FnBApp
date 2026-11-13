/** What a player sees of their draft/sealed table (sent by the server). */
export interface PodView {
  code: string; mode: string; set: string; setName: string; phase: 'lobby' | 'drafting' | 'building'; round: number; isHost: boolean;
  players: { username: string; name: string; bot: boolean; picks: number; ready: boolean }[];
  you: { pack: string[]; pool: string[]; picked: boolean; deckSubmitted: boolean };
  pickDeadline?: number;
}
