// A fantasy soundtrack, generated with Web Audio (no audio files). Each part of the app has its own theme:
// - menu      "The Hearth Hall": D dorian, rolling harp, a flute melody over warm strings, a low drone
// - explore   "The Archive" (decks, cards, learning, profile): lute picking, celesta and soft strings
// - campaign  "The Road" (campaigns, gauntlet, tournaments): a marching frame drum, horns and strings
// - battle    "Clash of Steel": taiko, a driving string ostinato, horn calls, choir in the second section
// - tense     "The Brink" (someone is close to dying): faster, choir and low brass, rolling taiko
// - stings: a victory horn fanfare with a harp glissando, or a lament for strings and choir
// Themes crossfade when you move around the app. Off until the player turns it on; pauses in the background.
export type Mood = 'menu' | 'explore' | 'campaign' | 'battle' | 'tense';
const KEY = 'fab-trainer.music';
const VOL_KEY = 'fab-trainer.musicVolume';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let bus: GainNode | null = null;
let wet: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let mood: Mood = 'menu';
let baseMood: Mood = 'menu';
let nextBar = 0;
let bar = 0;

export function musicEnabled(): boolean { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
function store(on: boolean) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } }
export function musicVolume(): number { try { const v = localStorage.getItem(VOL_KEY); return v === null ? 0.7 : Math.min(1, Math.max(0, Number(v) || 0)); } catch { return 0.7; } }
export function setMusicVolume(v: number) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* ignore */ }
  if (bus && ctx) bus.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
}

const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
/** loudness balance between the themes (measured: each lands around -23 to -26 dB) */
const THEME_GAIN: Record<Mood | 'victory' | 'defeat', number> = { menu: 1.6, explore: 1.6, campaign: 2.0, battle: 0.95, tense: 0.75, victory: 1.5, defeat: 1.7 };
let level = 1;

// ---------------------------------------------------------------- the score
// chords per bar (midi notes, root first) and melodies as [note, beats] (0 = rest), 8 bars of 4/4 each
interface Theme { tempo: number; chords: number[][]; melody: [number, number][]; counter?: [number, number][] }
const THEMES: Record<Mood, Theme> = {
  menu: { // D dorian: Dm C Bb C | Dm F C Am
    tempo: 74,
    chords: [[50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [48, 55, 60, 64], [50, 57, 62, 65], [53, 57, 60, 65], [48, 55, 60, 64], [45, 52, 57, 60]],
    melody: [[69, 1], [74, 1], [76, 1], [77, 1], [76, 2], [74, 1], [72, 1], [74, 3], [77, 1], [76, 4],
      [81, 1.5], [79, 0.5], [77, 1], [76, 1], [77, 2], [81, 1], [84, 1], [79, 2], [76, 1], [72, 1], [76, 2], [69, 2]],
    counter: [[62, 2], [65, 2], [64, 4], [62, 4], [64, 2], [60, 2], [62, 4], [65, 4], [67, 4], [64, 2], [60, 2]],
  },
  explore: { // F lydian, gentle: F G/F Am C | Dm G/B C F
    tempo: 66,
    chords: [[41, 53, 57, 60], [41, 55, 59, 62], [45, 52, 57, 60], [48, 52, 55, 60], [50, 53, 57, 62], [47, 55, 59, 62], [48, 52, 55, 60], [41, 53, 57, 60]],
    melody: [[0, 2], [72, 1], [74, 1], [76, 3], [74, 1], [72, 2], [69, 2], [67, 4],
      [0, 2], [69, 1], [72, 1], [74, 2], [71, 2], [72, 2], [76, 2], [77, 4]],
  },
  campaign: { // E minor march: Em D C B | Em G D B
    tempo: 96,
    chords: [[40, 52, 55, 59], [38, 50, 54, 57], [36, 48, 52, 55], [35, 47, 51, 54], [40, 52, 55, 59], [43, 50, 55, 59], [38, 50, 54, 57], [35, 47, 51, 54]],
    melody: [[64, 1.5], [64, 0.5], [67, 1], [71, 1], [69, 2], [66, 2], [67, 1.5], [67, 0.5], [64, 1], [60, 1], [63, 4],
      [64, 1.5], [67, 0.5], [71, 1], [76, 1], [74, 2], [71, 2], [69, 1.5], [71, 0.5], [69, 1], [66, 1], [71, 4]],
  },
  battle: { // A minor, driving: Am F G E | Am F Dm E
    tempo: 116,
    chords: [[45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62], [40, 52, 56, 59], [45, 57, 60, 64], [41, 53, 57, 60], [38, 50, 53, 57], [40, 52, 56, 59]],
    melody: [[69, 2], [72, 1], [76, 1], [77, 2], [76, 1], [72, 1], [74, 2], [71, 2], [68, 4],
      [69, 1], [72, 1], [76, 2], [81, 2], [77, 2], [74, 2], [77, 1], [76, 1], [71, 2], [68, 2]],
  },
  tense: { // D phrygian, relentless: Dm Eb Dm A | Bb Eb A A
    tempo: 132,
    chords: [[38, 50, 53, 57], [39, 51, 55, 58], [38, 50, 53, 57], [45, 52, 57, 61], [46, 53, 58, 62], [39, 51, 55, 58], [45, 52, 57, 61], [45, 52, 57, 61]],
    melody: [[62, 3], [63, 1], [62, 2], [60, 2], [62, 4], [61, 4], [58, 3], [63, 1], [62, 2], [58, 2], [61, 4], [57, 4]],
  },
};

/** the notes of a melody that start in bar b: [note, startBeatInBar, beats] */
function notesIn(m: [number, number][], b: number): [number, number, number][] {
  const total = m.reduce((a, [, d]) => a + d, 0);
  const from = (b * 4) % total;
  const outN: [number, number, number][] = [];
  let at = 0;
  for (const [n, d] of m) { if (at >= from && at < from + 4 && n) outN.push([n, at - from, d]); at += d; }
  return outN;
}

// ---------------------------------------------------------------- the instruments
function impulse(c: AudioContext, seconds: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.2;
  }
  return buf;
}

function setup(): boolean {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return true; }
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    bus = ctx.createGain();
    bus.gain.value = musicVolume();
    bus.connect(ctx.destination);
    const limiter = ctx.createDynamicsCompressor(); // keeps the loud moments (fanfares, taiko rolls) from clipping
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.005; limiter.release.value = 0.25;
    limiter.connect(bus);
    out = ctx.createGain();
    out.gain.value = 0;
    out.connect(limiter);
    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 3.6); // a stone hall
    wet = ctx.createGain();
    wet.gain.value = 0.6;
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

/** an envelope into the dry mix and the hall */
function env(t: number, peak: number, attack: number, hold: number, release: number, wetAmt = 1): GainNode {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  peak *= level;
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  g.connect(out!);
  if (wetAmt > 0) { const w = c.createGain(); w.gain.value = wetAmt; g.connect(w).connect(wet!); }
  return g;
}
function osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, detune = 0) {
  const o = ctx!.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function lowpass(f: number, dest: AudioNode, q = 0.7) { const b = ctx!.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; b.connect(dest); return b; }

/** harp: a bright pluck with a long ring */
function harp(n: number, t: number, gain = 0.05) {
  const g = env(t, gain, 0.003, 0, 1.8, 0.9);
  const f = lowpass(3200, g);
  osc('triangle', hz(n), t, 1.9, f);
  osc('sine', hz(n) * 2, t, 0.6, env(t, gain * 0.3, 0.002, 0, 0.5, 0.5));
}
/** lute: a shorter, woodier pluck */
function lute(n: number, t: number, gain = 0.05) {
  const g = env(t, gain, 0.004, 0, 0.7, 0.6);
  const f = lowpass(1700, g, 2);
  osc('sawtooth', hz(n), t, 0.8, f);
}
/** celesta / bell */
function celesta(n: number, t: number, gain = 0.035) {
  osc('sine', hz(n), t, 1.4, env(t, gain, 0.003, 0, 1.3, 1));
  osc('sine', hz(n) * 4.0, t, 0.4, env(t, gain * 0.2, 0.002, 0, 0.35, 1));
}
/** flute: a breathy sine with vibrato */
function flute(n: number, t: number, dur: number, gain = 0.05) {
  const c = ctx!;
  const g = env(t, gain, 0.09, Math.max(0, dur - 0.25), 0.25, 1.1);
  const o = osc('sine', hz(n), t, dur + 0.1, g);
  osc('triangle', hz(n), t, dur + 0.1, env(t, gain * 0.15, 0.09, Math.max(0, dur - 0.25), 0.25, 0.5));
  const lfo = c.createOscillator(); const depth = c.createGain();
  lfo.frequency.value = 5.2; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(hz(n) * 0.006, t + Math.min(0.5, dur));
  lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
  // breath
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz(n) * 2; bp.Q.value = 6;
  s.connect(bp).connect(env(t, gain * 0.25, 0.05, Math.max(0, dur - 0.2), 0.2, 0.6)); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
}
/** horn: a warm brass swell */
function horn(n: number, t: number, dur: number, gain = 0.045) {
  const g = env(t, gain, 0.07, Math.max(0, dur - 0.3), 0.3, 1);
  const f = lowpass(950, g, 1.2);
  const o = osc('sawtooth', hz(n), t, dur + 0.1, f);
  o.frequency.setValueAtTime(hz(n) * 0.97, t); o.frequency.exponentialRampToValueAtTime(hz(n), t + 0.08);
  osc('sawtooth', hz(n), t, dur + 0.1, f, 8);
}
/** strings: a section pad */
function strings(notes: number[], t: number, dur: number, gain = 0.018, attack = 0.7, cutoff = 1500) {
  for (const n of notes) {
    const g = env(t, gain, attack, Math.max(0, dur - attack - 0.6), 0.9, 1);
    const f = lowpass(cutoff, g);
    osc('sawtooth', hz(n), t, dur + 0.5, f, -7);
    osc('sawtooth', hz(n), t, dur + 0.5, f, 7);
  }
}
/** a short bowed string note (ostinati) */
function bow(n: number, t: number, dur: number, gain = 0.028) {
  const g = env(t, gain, 0.02, Math.max(0, dur * 0.6), dur * 0.4, 0.4);
  osc('sawtooth', hz(n), t, dur + 0.05, lowpass(1300, g));
}
/** choir: "aah", two vowel formants over a voice-like source */
function choir(notes: number[], t: number, dur: number, gain = 0.02) {
  const c = ctx!;
  for (const n of notes) {
    const g = env(t, gain, 0.9, Math.max(0, dur - 1.5), 0.9, 1.3);
    for (const [fq, q, a] of [[730, 8, 1], [1090, 9, 0.6], [2440, 10, 0.25]] as const) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
      const amp = c.createGain(); amp.gain.value = a * 3;
      bp.connect(amp).connect(g);
      for (const dt of [-9, 0, 9]) osc('sawtooth', hz(n), t, dur + 0.5, bp, dt);
    }
  }
}
/** a low drone (an open fifth) */
function drone(root: number, t: number, dur: number, gain = 0.03) {
  for (const n of [root, root + 7]) osc('triangle', hz(n), t, dur + 0.5, lowpass(500, env(t, gain, 1.2, Math.max(0, dur - 1.6), 1.2, 0.8)));
}
/** taiko: a deep drum */
function taiko(t: number, gain = 0.5) {
  const c = ctx!;
  const o = c.createOscillator(); const g = env(t, gain, 0.003, 0, 0.5, 0.5);
  o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
  o.connect(g); o.start(t); o.stop(t + 0.6);
  hit(t, 0.12, gain * 0.5, 400, 'lowpass');
}
/** frame drum / snare-ish skin */
function frame(t: number, gain = 0.12) { hit(t, 0.12, gain, 260, 'bandpass', 1.5); hit(t, 0.05, gain * 0.5, 2400, 'bandpass', 1); }
function shaker(t: number, gain = 0.03) { hit(t, 0.06, gain, 7000, 'highpass'); }
function hit(t: number, dur: number, gain: number, f: number, type: BiquadFilterType, q = 0.7) {
  const c = ctx!;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const bf = c.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
  s.connect(bf).connect(env(t, gain, 0.002, 0, dur, 0.4)); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function timpani(n: number, t: number, gain = 0.3) { osc('sine', hz(n), t, 1.3, env(t, gain, 0.008, 0, 1.2, 0.8)); hit(t, 0.08, gain * 0.3, 300, 'lowpass'); }

// ---------------------------------------------------------------- arrangement: one bar at a time
function scheduleBar(t: number) {
  level = THEME_GAIN[mood];
  const th = THEMES[mood];
  const beat = 60 / th.tempo;
  const len = beat * 4;
  const i = bar % 8;
  const section = Math.floor(bar / 8) % 2; // A then B
  const chord = th.chords[i];
  const [root, ...upper] = chord;
  const mel = notesIn(th.melody, bar);
  switch (mood) {
    case 'menu': {
      if (i === 0) drone(root - 12, t, len * 8 - 0.5);
      strings(upper.map((n) => n + 12), t, len + 0.3, 0.012, 1.2, 1200);
      // rolling harp: up and down the chord in eighths
      const roll = [root, ...upper, upper[upper.length - 1] + 12, ...upper.slice().reverse()].map((n) => n + 12);
      for (let k = 0; k < 8; k++) harp(roll[k % roll.length], t + (k * len) / 8, k % 4 === 0 ? 0.05 : 0.035);
      if (section === 0) mel.forEach(([n, at, d]) => flute(n, t + at * beat, d * beat * 0.95));
      else {
        notesIn(th.counter!, bar).forEach(([n, at, d]) => horn(n, t + at * beat, d * beat * 0.95, 0.025));
        mel.forEach(([n, at]) => celesta(n + 12, t + at * beat, 0.025));
      }
      break;
    }
    case 'explore': {
      strings(upper, t, len + 0.3, 0.01, 1.4, 1000);
      osc('triangle', hz(root - 12), t, len, lowpass(400, env(t, 0.05, 0.05, len - 0.6, 0.5, 0.3)));
      // lute picking pattern
      const pat = [root + 12, upper[1] + 12, upper[0] + 12, upper[2] + 12, upper[1] + 12, upper[0] + 12, upper[2] + 12, upper[1] + 12];
      pat.forEach((n, k) => lute(n, t + (k * len) / 8, k % 2 ? 0.03 : 0.04));
      mel.forEach(([n, at, d]) => (section === 0 ? celesta(n + 12, t + at * beat) : flute(n, t + at * beat, d * beat * 0.9, 0.04)));
      break;
    }
    case 'campaign': {
      strings(upper, t, len, 0.014, 0.25, 1600);
      for (let k = 0; k < 8; k++) bow(root + (k % 2 ? 12 : 0), t + (k * len) / 8, beat * 0.45, 0.025);
      // march: frame drum on every beat, a roll into the next phrase
      for (let k = 0; k < 4; k++) { frame(t + k * beat, k % 2 ? 0.09 : 0.14); shaker(t + k * beat + beat / 2); }
      if (i === 7) for (let k = 0; k < 6; k++) frame(t + 3 * beat + (k * beat) / 6, 0.05 + k * 0.02);
      if (i % 4 === 0) timpani(root - 12, t, 0.25);
      mel.forEach(([n, at, d]) => (section === 0 ? horn(n, t + at * beat, d * beat * 0.92) : flute(n + 12, t + at * beat, d * beat * 0.92, 0.04)));
      break;
    }
    case 'battle': {
      strings(upper, t, len, 0.016, 0.15, 1700);
      // driving ostinato in sixteenths: root, fifth, octave, fifth
      const ost = [root, root + 7, root + 12, root + 7];
      for (let k = 0; k < 16; k++) bow(ost[k % 4] + 12, t + (k * len) / 16, beat * 0.22, k % 4 === 0 ? 0.03 : 0.02);
      // taiko pattern: boom . boom-boom . | boom . . boom
      const hits = i % 2 === 0 ? [0, 1.5, 2, 3] : [0, 2, 2.5, 3.5];
      hits.forEach((b, k) => taiko(t + b * beat, k === 0 ? 0.55 : 0.38));
      for (let k = 0; k < 8; k++) shaker(t + (k * len) / 8, 0.025);
      if (i === 7) for (let k = 0; k < 8; k++) taiko(t + 3 * beat + (k * beat) / 8, 0.15 + k * 0.04);
      mel.forEach(([n, at, d]) => horn(n, t + at * beat, d * beat * 0.9, 0.04));
      if (section === 1) choir(upper.map((n) => n + 12), t, len + 0.2, 0.012);
      break;
    }
    case 'tense': {
      // tremolo strings, low choir, relentless taiko
      for (let k = 0; k < 16; k++) for (const n of upper) bow(n, t + (k * len) / 16, beat * 0.2, 0.011);
      choir([root, upper[1]], t, len + 0.2, 0.016);
      for (let k = 0; k < 8; k++) taiko(t + (k * len) / 8, k % 2 ? 0.25 : 0.5);
      timpani(root - 12, t, 0.3);
      if (i === 7) for (let k = 0; k < 12; k++) timpani(root - 12, t + 3 * beat + (k * beat) / 12, 0.06 + k * 0.025);
      mel.forEach(([n, at, d]) => horn(n - 12, t + at * beat, d * beat * 0.95, 0.05));
      break;
    }
  }
  bar++;
}

function tick() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 0.8) {
    scheduleBar(nextBar);
    nextBar += (60 / THEMES[mood].tempo) * 4;
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
  bar = 0;
  timer = setInterval(tick, 200);
  tick();
  fade(0.9, 2.5);
}

export function stopMusic() {
  if (timer) { clearInterval(timer); timer = null; }
  fade(0, 0.8);
}

export function setMusicEnabled(on: boolean) {
  store(on);
  if (on) startMusic(); else stopMusic();
}

/** Change theme with a short crossfade: the old theme dips, the new one starts on its first bar. */
export function setMusicMood(m: Mood) {
  if (mood === m) return;
  const keepBar = (mood === 'battle' && m === 'tense') || (mood === 'tense' && m === 'battle');
  mood = m;
  if (!keepBar) bar = 0;
  if (ctx && timer) {
    fade(0.25, 0.5);
    setTimeout(() => { if (timer) fade(0.9, 1.6); }, 550);
  }
}

/** The theme of the screen you're on (games set battle / tense themselves and return here afterwards). */
export function setBaseMood(m: Mood) {
  baseMood = m;
  if (mood !== 'battle' && mood !== 'tense') setMusicMood(m);
}
export const currentBaseMood = () => baseMood;

/** A victory fanfare or a lament over the music, which then returns to the theme of the screen. */
export function musicSting(kind: 'victory' | 'defeat') {
  if (!musicEnabled() || !setup() || !ctx) return;
  const t = ctx.currentTime + 0.15;
  mood = baseMood;
  bar = 0;
  nextBar = Math.max(nextBar, t + (kind === 'victory' ? 4 : 4.4)); // let the sting breathe before the theme returns
  stingAt(kind, t);
}

function stingAt(kind: 'victory' | 'defeat', t: number) {
  level = THEME_GAIN[kind];
  if (kind === 'victory') {
    // a harp glissando up, then a horn fanfare on A major
    for (let k = 0; k < 14; k++) harp(57 + [0, 2, 4, 5, 7, 9, 11][k % 7] + 12 * Math.floor(k / 7), t + k * 0.035, 0.035);
    const fan: [number, number, number][] = [[69, 0.5, 0.3], [69, 0.8, 0.15], [73, 0.95, 0.3], [76, 1.25, 0.3], [81, 1.55, 2.2]];
    for (const [n, at, d] of fan) { horn(n, t + at, d, 0.06); horn(n - 12, t + at, d, 0.035); }
    strings([57, 61, 64, 69], t + 1.55, 2.4, 0.02, 0.2, 2200);
    choir([69, 73, 76], t + 1.55, 2.6, 0.012);
    taiko(t + 1.55, 0.6); timpani(45, t + 1.55, 0.35);
  } else {
    const lam: [number, number, number][] = [[69, 0, 0.9], [67, 0.9, 0.9], [65, 1.8, 0.9], [64, 2.7, 1.8]];
    for (const [n, at, d] of lam) flute(n, t + at, d, 0.045);
    strings([50, 57, 62, 65], t, 2.7, 0.016, 0.8, 900);
    strings([52, 56, 59, 64], t + 2.7, 2.2, 0.016, 0.4, 900);
    choir([52, 59], t + 2.7, 2.4, 0.014);
    timpani(40, t + 2.7, 0.35);
  }
}

/** Render a theme (or a sting) to an audio buffer without playing it: for previews and listening tests. */
export async function renderTheme(m: Mood | 'victory' | 'defeat', bars = 16, sampleRate = 44100): Promise<AudioBuffer> {
  const saved = { ctx, out, bus, wet, noiseBuf, mood, bar, nextBar };
  const tempo = m === 'victory' || m === 'defeat' ? 120 : THEMES[m].tempo;
  const seconds = m === 'victory' || m === 'defeat' ? 7 : (60 / tempo) * 4 * bars + 3;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  ctx = off as unknown as AudioContext;
  const lim = off.createDynamicsCompressor();
  lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 8; lim.attack.value = 0.005; lim.release.value = 0.25;
  lim.connect(off.destination);
  out = off.createGain(); out.gain.value = 0.9; out.connect(lim);
  const rev = off.createConvolver(); rev.buffer = impulse(ctx, 3.6);
  wet = off.createGain(); wet.gain.value = 0.6; wet.connect(rev).connect(out);
  noiseBuf = off.createBuffer(1, sampleRate, sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  try {
    if (m === 'victory' || m === 'defeat') {
      const prevBase = baseMood; baseMood = 'menu';
      const t0 = 0.05; nextBar = 99;
      // musicSting schedules from ctx.currentTime (0 here)
      stingAt(m, t0);
      baseMood = prevBase;
    } else {
      mood = m; bar = 0;
      let t = 0.05;
      for (let i = 0; i < bars; i++) { scheduleBar(t); t += (60 / tempo) * 4; }
    }
    return await off.startRendering();
  } finally {
    ({ ctx, out, bus, wet, noiseBuf, mood, bar, nextBar } = saved);
  }
}
