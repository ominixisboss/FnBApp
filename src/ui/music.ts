// A generated soundtrack (Web Audio, no audio files). Moods:
// - menu: slow pads, a soft bell melody and arpeggios, two alternating sections
// - battle: a driving pulse with kick, snare and hats, a melody that develops over 8-bar sections
// - tense: faster, darker, with a pounding low pulse and timpani rolls (someone is close to dying)
// - victory / defeat: a short fanfare or lament that then settles back into the menu theme
// Off until the player turns it on; pauses while the app is in the background.
export type Mood = 'menu' | 'battle' | 'tense';
const KEY = 'fab-trainer.music';
const VOL_KEY = 'fab-trainer.musicVolume';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let bus: GainNode | null = null;
let wet: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let mood: Mood = 'menu';
let nextBar = 0;
let bar = 0;
let seed = 1;

export function musicEnabled(): boolean { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
function store(on: boolean) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } }
export function musicVolume(): number { try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && localStorage.getItem(VOL_KEY) !== null ? Math.min(1, Math.max(0, v)) : 0.7; } catch { return 0.7; } }
export function setMusicVolume(v: number) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* ignore */ }
  if (bus && ctx) bus.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
}

/** a small seeded random so the melody repeats its motifs */
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// chords as midi notes; each mood has an A and a B section that alternate every 8 bars
const SECTIONS: Record<Mood, number[][][]> = {
  menu: [
    [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
    [[50, 53, 57], [53, 57, 60], [52, 55, 59], [52, 56, 59]], // Dm F Em E
  ],
  battle: [
    [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], // Am G F E
    [[53, 57, 60], [55, 59, 62], [57, 60, 64], [57, 60, 64]], // F G Am Am
  ],
  tense: [
    [[57, 60, 64], [58, 62, 65], [57, 60, 64], [52, 56, 59]], // Am Bb Am E
    [[53, 57, 60], [52, 56, 59], [53, 57, 60], [52, 56, 59]], // F E F E
  ],
};
const TEMPO: Record<Mood, number> = { menu: 68, battle: 104, tense: 122 };
// A minor pentatonic (with the 9th) for melodies
const SCALE = [57, 60, 62, 64, 67, 69, 72, 74, 76];

function impulse(c: AudioContext, seconds: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  return buf;
}
let noiseBuf: AudioBuffer | null = null;

function setup(): boolean {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return true; }
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    bus = ctx.createGain();
    bus.gain.value = musicVolume();
    bus.connect(ctx.destination);
    out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);
    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 3);
    wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(rev).connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend(); else if (musicEnabled()) void ctx.resume();
    });
    return true;
  } catch { return false; }
}

function voice(freq: number, t: number, dur: number, opts: { type: OscillatorType; gain: number; attack: number; release: number; cutoff: number; detune?: number; wetMix?: number }) {
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
  if (opts.wetMix !== 0) g.connect(wet!);
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

/** a bell: a sine with a quiet inharmonic partial */
function bell(freq: number, t: number, gain: number) {
  voice(freq, t, 1.6, { type: 'sine', gain, attack: 0.005, release: 1.5, cutoff: 6000 });
  voice(freq * 2.76, t, 0.6, { type: 'sine', gain: gain * 0.25, attack: 0.005, release: 0.55, cutoff: 8000 });
}

function kick(t: number, gain = 0.6) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + 0.35);
}

function hiss(t: number, dur: number, gain: number, freq: number, type: BiquadFilterType, q = 0.7, toWet = false) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out!);
  if (toWet) g.connect(wet!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}
const snare = (t: number, gain = 0.22) => { hiss(t, 0.18, gain, 1800, 'bandpass', 0.6, true); voice(190, t, 0.12, { type: 'triangle', gain: gain * 0.6, attack: 0.002, release: 0.1, cutoff: 900, wetMix: 0 }); };
const hat = (t: number, gain = 0.05, open = false) => hiss(t, open ? 0.18 : 0.04, gain, 8000, 'highpass', 0.8);
const timpani = (t: number, n: number, gain = 0.3) => voice(midi(n), t, 1.2, { type: 'sine', gain, attack: 0.01, release: 1.1, cutoff: 500 });

/** the melody of a bar: a 2-bar motif from the scale that repeats, varied every other time */
let motif: number[] = [];
function melodyFor(chord: number[], steps: number): (number | null)[] {
  if (bar % 4 === 0 || motif.length !== steps) {
    let i = 2 + Math.floor(rnd() * 3);
    motif = Array.from({ length: steps }, (_, k) => { if (k > 0 && rnd() < 0.35) return -1; i = Math.max(0, Math.min(SCALE.length - 1, i + Math.floor(rnd() * 5) - 2)); return i; });
  }
  return motif.map((ix, k) => {
    if (ix < 0) return null;
    // lean on chord tones on strong beats
    if (k % (steps / 2) === 0) { const ct = chord[(k / (steps / 2)) % 3] + 12; return ct < 69 ? ct + 12 : ct; }
    return SCALE[Math.min(SCALE.length - 1, ix + (bar % 2 && k === steps - 1 ? 1 : 0))] + (mood === 'menu' ? 12 : 0);
  });
}

/** Schedule one bar (4 beats) starting at time t. */
function scheduleBar(t: number) {
  const beat = 60 / TEMPO[mood];
  const len = beat * 4;
  const section = SECTIONS[mood][Math.floor(bar / 8) % 2];
  const chord = section[bar % 4];
  const fill = bar % 8 === 7;
  if (mood === 'menu') {
    for (const n of chord) voice(midi(n), t, len + 0.8, { type: 'sawtooth', gain: 0.03, attack: 1.4, release: 1.3, cutoff: 650, detune: 8 });
    voice(midi(chord[0] - 24), t, len, { type: 'triangle', gain: 0.07, attack: 0.08, release: 0.5, cutoff: 380 });
    for (let i = 0; i < 4; i++) { if (bar % 2 === 1 && i === 3) continue; voice(midi(chord[i % 3] + 12), t + i * beat, 0.7, { type: 'triangle', gain: 0.024, attack: 0.01, release: 0.6, cutoff: 2200 }); }
    if (Math.floor(bar / 4) % 2 === 1) melodyFor(chord, 4).forEach((n, i) => { if (n) bell(midi(n), t + i * beat + beat * 0.5, 0.03); });
  } else if (mood === 'battle') {
    for (const n of chord) voice(midi(n), t, len + 0.4, { type: 'sawtooth', gain: 0.026, attack: 0.3, release: 1.1, cutoff: 1200, detune: 7 });
    for (let i = 0; i < 8; i++) voice(midi(chord[0] - 24 + (i % 4 === 3 ? 12 : 0)), t + (i * len) / 8, beat * 0.45, { type: 'square', gain: 0.045, attack: 0.005, release: 0.15, cutoff: 520, wetMix: 0 });
    melodyFor(chord, 8).forEach((n, i) => { if (n && (Math.floor(bar / 4) % 2 === 1 || i % 2 === 0)) voice(midi(n), t + (i * len) / 8, beat * 0.6, { type: 'triangle', gain: 0.028, attack: 0.008, release: 0.35, cutoff: 2600 }); });
    for (let i = 0; i < 4; i++) {
      kick(t + i * beat, i % 2 === 0 ? 0.55 : 0.4);
      if (i % 2 === 1) snare(t + i * beat);
      hat(t + i * beat + beat / 2, 0.05, i === 3);
      hat(t + i * beat, 0.03);
    }
    if (fill) for (let k = 0; k < 4; k++) snare(t + 3 * beat + (k * beat) / 4, 0.12 + k * 0.04);
  } else {
    // tense: darker and faster, a pounding pulse and timpani
    for (const n of chord) voice(midi(n - 12), t, len + 0.3, { type: 'sawtooth', gain: 0.028, attack: 0.15, release: 0.8, cutoff: 900, detune: 12 });
    for (let i = 0; i < 16; i++) voice(midi(chord[0] - 24), t + (i * len) / 16, beat * 0.2, { type: 'sawtooth', gain: i % 4 === 0 ? 0.06 : 0.035, attack: 0.004, release: 0.1, cutoff: 420, wetMix: 0 });
    for (let i = 0; i < 4; i++) { kick(t + i * beat, 0.6); hat(t + i * beat + beat / 2, 0.04); if (i === 3) snare(t + i * beat, 0.25); }
    timpani(t, chord[0] - 24, 0.32);
    if (fill) for (let k = 0; k < 8; k++) timpani(t + 3 * beat + (k * beat) / 8, chord[0] - 24, 0.08 + k * 0.03);
    melodyFor(chord, 8).forEach((n, i) => { if (n && i % 2 === 0) voice(midi(n), t + (i * len) / 8, beat * 0.9, { type: 'sawtooth', gain: 0.018, attack: 0.02, release: 0.4, cutoff: 1800 }); });
  }
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
  seed = Math.floor(Math.random() * 100000) + 1;
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

/** Switch theme at the next bar (tense <-> battle switches keep the bar count so the music flows). */
export function setMusicMood(m: Mood) {
  if (mood === m) return;
  const fromGame = mood !== 'menu' && m !== 'menu';
  mood = m;
  if (!fromGame) bar = 0;
}

/** A short fanfare (victory) or lament (defeat) over the music, which then returns to the menu theme. */
export function musicSting(kind: 'victory' | 'defeat') {
  if (!musicEnabled() || !setup() || !ctx) return;
  const t = ctx.currentTime + 0.15;
  setMusicMood('menu');
  nextBar = Math.max(nextBar, t + (kind === 'victory' ? 3.2 : 3.6)); // let the sting breathe before the loop returns
  if (kind === 'victory') {
    const notes = [[69, 0], [72, 0.18], [76, 0.36], [81, 0.62]] as const;
    for (const [n, d] of notes) { voice(midi(n), t + d, d === 0.62 ? 2.4 : 0.5, { type: 'sawtooth', gain: 0.05, attack: 0.01, release: 0.4, cutoff: 3200, detune: 6 }); bell(midi(n + 12), t + d, 0.03); }
    for (const n of [57, 64, 69, 73]) voice(midi(n), t + 0.62, 2.6, { type: 'sawtooth', gain: 0.03, attack: 0.05, release: 1.6, cutoff: 1800, detune: 9 });
    kick(t + 0.62, 0.7); timpani(t + 0.62, 45, 0.35);
    for (let k = 0; k < 6; k++) hat(t + 0.62 + k * 0.09, 0.05 + k * 0.01);
  } else {
    const notes = [[69, 0], [67, 0.45], [65, 0.9], [64, 1.4]] as const;
    for (const [n, d] of notes) voice(midi(n - 12), t + d, d === 1.4 ? 2.6 : 0.7, { type: 'triangle', gain: 0.06, attack: 0.02, release: 0.6, cutoff: 1200 });
    for (const n of [52, 56, 59]) voice(midi(n - 12), t + 1.4, 2.8, { type: 'sawtooth', gain: 0.026, attack: 0.4, release: 2, cutoff: 700, detune: 10 });
    timpani(t + 1.4, 40, 0.4);
  }
}
