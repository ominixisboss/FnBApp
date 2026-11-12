// Tiny synthesized sound effects (Web Audio, no audio files).
type SfxName = 'draw' | 'play' | 'hit' | 'bigHit' | 'block' | 'pitch' | 'turn' | 'myTurn' | 'win' | 'lose' | 'click' | 'hover';

const KEY = 'fab-trainer.sound';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

function ac(): AudioContext | null {
  if (!soundEnabled()) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number; attack?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; q?: number; type?: BiquadFilterType; sweepTo?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq ?? 2000, t0);
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur);
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

let lastHover = 0;

export function sfx(name: SfxName) {
  switch (name) {
    case 'draw': noise(0.18, { freq: 3500, sweepTo: 1200, gain: 0.18, q: 1.2 }); break;
    case 'click': tone(660, 0.06, { type: 'triangle', gain: 0.12 }); break;
    case 'hover': {
      const now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      noise(0.06, { freq: 5000, gain: 0.05, q: 2 });
      break;
    }
    case 'play':
      noise(0.22, { freq: 1800, sweepTo: 300, gain: 0.25 });
      tone(140, 0.25, { type: 'sine', gain: 0.5, slideTo: 60, delay: 0.12 });
      break;
    case 'hit':
      tone(110, 0.35, { type: 'sine', gain: 0.6, slideTo: 40 });
      noise(0.25, { freq: 800, sweepTo: 150, gain: 0.35, type: 'lowpass' });
      break;
    case 'bigHit':
      tone(90, 0.6, { type: 'sine', gain: 0.8, slideTo: 30 });
      tone(180, 0.3, { type: 'sawtooth', gain: 0.12, slideTo: 60 });
      noise(0.5, { freq: 600, sweepTo: 80, gain: 0.5, type: 'lowpass' });
      break;
    case 'block':
      tone(523, 0.35, { type: 'triangle', gain: 0.25 });
      tone(787, 0.3, { type: 'square', gain: 0.06 });
      noise(0.08, { freq: 4000, gain: 0.25, q: 3 });
      break;
    case 'pitch':
      tone(1046, 0.4, { type: 'sine', gain: 0.18 });
      tone(1568, 0.5, { type: 'sine', gain: 0.1, delay: 0.05 });
      break;
    case 'turn':
      tone(392, 0.35, { type: 'triangle', gain: 0.15 });
      tone(330, 0.45, { type: 'triangle', gain: 0.12, delay: 0.14 });
      break;
    case 'myTurn':
      tone(523, 0.3, { type: 'triangle', gain: 0.18 });
      tone(784, 0.5, { type: 'triangle', gain: 0.18, delay: 0.13 });
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.22, delay: i * 0.13 }));
      tone(1046, 1.2, { type: 'sine', gain: 0.15, delay: 0.55 });
      break;
    case 'lose':
      [392, 349, 311, 262].forEach((f, i) => tone(f, 0.6, { type: 'triangle', gain: 0.2, delay: i * 0.2 }));
      break;
  }
}
