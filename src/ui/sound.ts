// Tiny synthesized sound effects (Web Audio, no audio files).
export type SfxName = 'draw' | 'play' | 'hit' | 'bigHit' | 'block' | 'pitch' | 'turn' | 'myTurn' | 'win' | 'lose' | 'click' | 'hover'
  | 'attack' | 'goAgain' | 'lifeGain' | 'token' | 'gold' | 'shatter' | 'arcane' | 'reaction' | 'shuffle' | 'discard' | 'knockout'
  | 'cheer' | 'boo' | 'event' | 'dice' | 'heartbeat' | 'open' | 'deal' | 'error' | 'banish' | 'aura';

const KEY = 'fab-trainer.sound';
const VOL_KEY = 'fab-trainer.sfxVolume';
export function sfxVolume(): number { try { const v = localStorage.getItem(VOL_KEY); return v === null ? 0.8 : Math.min(1, Math.max(0, Number(v) || 0)); } catch { return 0.8; } }
export function setSfxVolume(v: number) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(0.42 * v, ctx.currentTime, 0.05);
}
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let room: GainNode | null = null; // a short reverb send so effects sound like they happen in a room

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
      master.gain.value = 0.42 * sfxVolume();
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.9);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      room = ctx.createGain();
      room.gain.value = 0.22;
      room.connect(conv).connect(master);
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
  if (room) g.connect(room);
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
  if (room) g.connect(room);
  src.start(t0);
}

let lastHover = 0;
const lastPlayed: Partial<Record<SfxName, number>> = {};

export function sfx(name: SfxName) {
  // the same sound twice within a moment is just noise
  const now = performance.now();
  if (now - (lastPlayed[name] ?? 0) < 70) return;
  lastPlayed[name] = now;
  switch (name) {
    case 'attack': // a whoosh as an attack flies onto the chain
      noise(0.32, { freq: 600, sweepTo: 3200, gain: 0.22, q: 1.4 });
      tone(220, 0.25, { type: 'sawtooth', gain: 0.05, slideTo: 440, delay: 0.05 });
      break;
    case 'goAgain':
      [784, 988, 1318].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.1, delay: i * 0.05 }));
      break;
    case 'lifeGain':
      [880, 1175, 1568, 2093].forEach((f, i) => tone(f, 0.35, { type: 'sine', gain: 0.08, delay: i * 0.06 }));
      noise(0.4, { freq: 7000, gain: 0.04, q: 3 });
      break;
    case 'token':
      tone(520, 0.12, { type: 'sine', gain: 0.22, slideTo: 980 });
      noise(0.05, { freq: 3000, gain: 0.08, q: 2 });
      break;
    case 'gold': // coins
      tone(2637, 0.25, { type: 'square', gain: 0.03 });
      tone(3520, 0.3, { type: 'sine', gain: 0.07, delay: 0.04 });
      tone(2960, 0.35, { type: 'sine', gain: 0.06, delay: 0.09 });
      break;
    case 'shatter': // equipment breaks
      noise(0.45, { freq: 5200, sweepTo: 1800, gain: 0.3, q: 0.6, type: 'highpass' });
      [1661, 2217, 2960].forEach((f, i) => tone(f, 0.2, { type: 'triangle', gain: 0.05, delay: 0.02 + i * 0.04 }));
      tone(120, 0.2, { type: 'sine', gain: 0.25, slideTo: 60 });
      break;
    case 'arcane': // a crackling zap
      tone(1400, 0.28, { type: 'sawtooth', gain: 0.07, slideTo: 180 });
      noise(0.25, { freq: 2600, sweepTo: 600, gain: 0.16, q: 4 });
      tone(660, 0.18, { type: 'square', gain: 0.03, delay: 0.06, slideTo: 1320 });
      break;
    case 'reaction': // a quick snap (reactions, instants)
      noise(0.05, { freq: 3200, gain: 0.28, q: 1.5 });
      tone(880, 0.1, { type: 'triangle', gain: 0.12, slideTo: 1320 });
      break;
    case 'shuffle':
      for (let i = 0; i < 9; i++) noise(0.05, { freq: 3000 + (i % 3) * 500, gain: 0.07, q: 1.5, delay: i * 0.035 });
      break;
    case 'deal':
      noise(0.12, { freq: 4200, sweepTo: 1600, gain: 0.12, q: 1 });
      break;
    case 'discard':
      noise(0.2, { freq: 2200, sweepTo: 700, gain: 0.14, q: 0.9 });
      tone(180, 0.12, { type: 'sine', gain: 0.12, slideTo: 120, delay: 0.1 });
      break;
    case 'banish':
      noise(0.5, { freq: 900, sweepTo: 6000, gain: 0.12, q: 2 });
      tone(330, 0.5, { type: 'sine', gain: 0.07, slideTo: 1320 });
      break;
    case 'aura':
      [523, 659, 784].forEach((f, i) => tone(f, 0.7, { type: 'sine', gain: 0.07, delay: i * 0.03, attack: 0.08 }));
      break;
    case 'knockout': // a deep gong
      tone(98, 2.2, { type: 'sine', gain: 0.5, attack: 0.005 });
      tone(147, 1.6, { type: 'sine', gain: 0.16 });
      tone(233, 1.1, { type: 'triangle', gain: 0.08 });
      noise(0.6, { freq: 300, sweepTo: 80, gain: 0.25, type: 'lowpass' });
      break;
    case 'event': // a bright gong for Smash Palace events
      tone(196, 1.6, { type: 'sine', gain: 0.32 });
      tone(311, 1.2, { type: 'sine', gain: 0.12 });
      tone(523, 0.9, { type: 'triangle', gain: 0.06, delay: 0.02 });
      noise(0.3, { freq: 1500, sweepTo: 400, gain: 0.1 });
      break;
    case 'cheer': { // a crowd swell
      noise(0.9, { freq: 900, sweepTo: 1600, gain: 0.16, q: 0.5 });
      noise(0.7, { freq: 2400, gain: 0.08, q: 0.8, delay: 0.1 });
      for (let i = 0; i < 5; i++) noise(0.04, { freq: 3500, gain: 0.08, q: 3, delay: 0.1 + i * 0.09 + Math.random() * 0.04 }); // claps
      break;
    }
    case 'boo':
      noise(0.9, { freq: 420, sweepTo: 260, gain: 0.18, q: 1.2 });
      tone(150, 0.8, { type: 'sawtooth', gain: 0.04, slideTo: 110 });
      break;
    case 'dice':
      for (let i = 0; i < 6; i++) { noise(0.03, { freq: 2500 + Math.random() * 2500, gain: 0.14, q: 3, delay: i * (0.06 + i * 0.012) }); }
      break;
    case 'heartbeat':
      tone(60, 0.18, { type: 'sine', gain: 0.6, slideTo: 45 });
      tone(58, 0.22, { type: 'sine', gain: 0.5, slideTo: 42, delay: 0.24 });
      break;
    case 'open':
      noise(0.18, { freq: 700, sweepTo: 2600, gain: 0.07, q: 0.8 });
      break;
    case 'error':
      tone(220, 0.12, { type: 'square', gain: 0.06 });
      tone(185, 0.16, { type: 'square', gain: 0.06, delay: 0.1 });
      break;
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
