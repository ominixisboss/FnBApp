import { getDb } from '../../data/cardDb';

/** A hero portrait in a cosmetic frame (header, profile, leaderboards). */
export function Avatar({ heroId, size = 64, frame }: { heroId: string | null; size?: number; frame?: string }) {
  const hero = heroId ? getDb().byId.get(heroId) : undefined;
  return (
    <div className={`avatar frame-${frame ?? 'none'}`} style={{ width: size, height: size, backgroundImage: hero?.image ? `url(${hero.image})` : undefined }}>
      {!hero && <span>?</span>}
    </div>
  );
}
