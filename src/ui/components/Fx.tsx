// Decorative animation pieces: particles, banners, overlays.
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function Embers({ count = 28 }: { count?: number }) {
  const parts = useMemo(() => Array.from({ length: count }, () => ({
    left: `${rnd(0, 100)}%`, size: rnd(3, 7), dur: rnd(6, 13), delay: rnd(-13, 0), dx: `${rnd(-80, 80)}px`,
  })), [count]);
  return (
    <div className="embers" aria-hidden>
      {parts.map((p, i) => (
        <span key={i} className="ember" style={{ left: p.left, width: p.size, height: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, '--dx': p.dx } as CSSProperties} />
      ))}
    </div>
  );
}

const CONFETTI = ['#f6d58e', '#d9a441', '#ff6b5a', '#5fae6b', '#3f8ad8', '#fff6d5'];

export function Confetti({ count = 90, colors = CONFETTI }: { count?: number; colors?: string[] }) {
  const parts = useMemo(() => Array.from({ length: count }, () => ({
    left: `${rnd(0, 100)}%`, dur: rnd(2.2, 4.5), delay: rnd(0, 1.2), dx: `${rnd(-120, 120)}px`, rot: `${rnd(-720, 720)}deg`,
    color: colors[Math.floor(rnd(0, colors.length))], w: rnd(6, 12), h: rnd(8, 16),
  })), [count, colors]);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="particle" style={{ left: p.left, width: p.w, height: p.h, background: p.color, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, '--dx': p.dx, '--rot': p.rot } as CSSProperties} />
      ))}
    </>
  );
}

export function TurnBanner({ text, mine }: { text: string; mine: boolean }) {
  return (
    <div className="banner-wrap" aria-hidden>
      <div className={`banner ${mine ? 'mine' : 'theirs'}`}>{text}</div>
    </div>
  );
}

export function GameOverOverlay({ won, children }: { won: boolean; children: ReactNode }) {
  return (
    <div className={`gameover ${won ? 'win' : 'lose'}`}>
      {won ? <Confetti /> : <div style={{ position: 'absolute', inset: 0 }}><Embers count={40} /></div>}
      <div className="box">{children}</div>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return <div className="toast" role="status">{text}</div>;
}

// ---- global animation preference
const KEY = 'fab-trainer.animations';
export function animationsEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setAnimations(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  document.documentElement.classList.toggle('no-anim', !on);
}
