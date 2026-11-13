// Accessibility settings, applied as classes on <html>: colour-blind pitch markers and larger text.
type A11yKey = 'cb' | 'bigText';
const KEY = 'fab-trainer.a11y';

export function a11y(): Record<A11yKey, boolean> {
  try { return { cb: false, bigText: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { cb: false, bigText: false }; }
}

export function applyA11y() {
  const s = a11y();
  document.documentElement.classList.toggle('cb', s.cb);
  document.documentElement.classList.toggle('big-text', s.bigText);
}

export function setA11y(k: A11yKey, on: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...a11y(), [k]: on })); } catch { /* ignore */ }
  applyA11y();
}
