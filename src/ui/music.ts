// A generated soundtrack (Web Audio, no audio files): slow pads and a soft arpeggio in the menus, and a driving
// pulse with drums during games. Off until the player turns it on; pauses while the app is in the background.
type Mood = 'menu' | 'battle';
const KEY = 'fab-trainer.music';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let wet: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let mood: Mood = 'menu';
let nextBar = 0;
let bar = 0;

export function musicEnabled(): boolean { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
function store(on: boolean) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } }

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
// chord roots and qualities, A minor
const PROGRESSIONS: Record<Mood, number[][]> = {
  menu: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
  battle: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], // Am G F E
};
const TEMPO: Record<Mood, number> = { menu: 66, battle: 100 };

function impulse(c: AudioContext, seconds: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  return buf;
}

function setup(): boolean {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return true; }
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);
    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 3);
    wet = ctx.createGain();
    wet.gain.value = 0.55;
    wet.connect(rev).connect(out);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend(); else if (musicEnabled()) void ctx.resume();
    });
    return true;
  } catch { return false; }
}

function voice(freq: number, t: number, dur: number, opts: { type: OscillatorType; gain: number; attack: number; release: number; cutoff: number; detune?: number }) {
  const c = ctx!;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = opts.cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
  g.gain.setValueAtTime(opts.gain, t + Math.max(opts.attack, dur - opts.release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g);
  g.connect(out!);
  g.connect(wet!);
  for (const d of opts.detune !== undefined ? [-opts.detune, opts.detune] : [0]) {
    const o = c.createOscillator();
    o.type = opts.type;
    o.frequency.value = freq;
    o.detune.value = d;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

function drum(t: number, low: boolean) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(low ? 90 : 160, t);
  o.frequency.exponentialRampToValueAtTime(low ? 40 : 70, t + 0.25);
  g.gain.setValueAtTime(low ? 0.55 : 0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g);
  g.connect(out!);
  g.connect(wet!);
  o.start(t);
  o.stop(t + 0.4);
}

/** Schedule one bar (4 beats) starting at time t. */
function scheduleBar(t: number) {
  const beat = 60 / TEMPO[mood];
  const chord = PROGRESSIONS[mood][bar % 4];
  const len = beat * 4;
  // pad
  for (const n of chord) voice(midi(n), t, len + 0.6, { type: 'sawtooth', gain: mood === 'menu' ? 0.035 : 0.03, attack: mood === 'menu' ? 1.4 : 0.4, release: 1.2, cutoff: mood === 'menu' ? 700 : 1100, detune: 7 });
  // bass
  voice(midi(chord[0] - 24), t, len, { type: 'triangle', gain: mood === 'menu' ? 0.07 : 0.1, attack: 0.05, release: 0.4, cutoff: 400 });
  // arpeggio: chord tones an octave up
  const steps = mood === 'menu' ? 4 : 8;
  for (let i = 0; i < steps; i++) {
    const n = chord[i % 3] + 12 + (i >= 3 && i % 4 === 3 ? 12 : 0);
    if (mood === 'menu' && bar % 2 === 1 && i === 3) continue;
    voice(midi(n), t + (i * len) / steps, 0.6, { type: 'triangle', gain: mood === 'menu' ? 0.028 : 0.022, attack: 0.01, release: 0.5, cutoff: 2400 });
  }
  if (mood === 'battle') for (let i = 0; i < 4; i++) { drum(t + i * beat, i % 2 === 0); if (bar % 4 === 3 && i === 3) drum(t + i * beat + beat / 2, false); }
  bar++;
}

function tick() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 1.5) {
    scheduleBar(nextBar);
    nextBar += (60 / TEMPO[mood]) * 4;
  }
}

function fade(to: number, seconds: number) {
  if (!ctx || !out) return;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
  out.gain.linearRampToValueAtTime(to, ctx.currentTime + seconds);
}

export function startMusic() {
  if (!musicEnabled() || timer || !setup()) return;
  nextBar = ctx!.currentTime + 0.1;
  timer = setInterval(tick, 250);
  tick();
  fade(0.9, 2);
}

export function stopMusic() {
  if (timer) { clearInterval(timer); timer = null; }
  fade(0, 0.8);
}

export function setMusicEnabled(on: boolean) {
  store(on);
  if (on) startMusic(); else stopMusic();
}

/** Switch between the menu and battle themes at the next bar. */
export function setMusicMood(m: Mood) {
  if (mood === m) return;
  mood = m;
  bar = 0;
}
