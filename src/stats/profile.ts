// Local player profile (synced to the server when signed in).
export interface Profile {
  displayName: string;
  avatarHeroId: string | null;
  createdAt: number;
  /** equipped cosmetics (unlocked through progression) */
  cosmetics?: { sleeve?: string; mat?: string; frame?: string };
}

const KEY = 'fab-trainer.profile.v1';

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p) return p;
  } catch { /* ignore */ }
  return { displayName: 'Player', avatarHeroId: null, createdAt: Date.now() };
}

export function saveProfile(p: Profile, _fromUser = true) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('fab-profile'));
}
