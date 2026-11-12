// Vibration feedback on phones: a heavy thud when you're hit, lighter taps for plays and blocks.
// Uses the native haptics engine in the Android app, the Vibration API in mobile browsers, and does nothing on desktop.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const KEY = 'fab-trainer.haptics';
let enabled = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();

export const hapticsEnabled = () => enabled;
export function setHapticsEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (on) buzz('play');
}

/** Can this device vibrate at all? (Used to hide the setting where it does nothing.) */
export const canVibrate = () => Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && 'vibrate' in navigator && matchMedia?.('(pointer: coarse)').matches);

export type BuzzKind = 'play' | 'block' | 'dealt' | 'hit' | 'bigHit' | 'myTurn' | 'win' | 'lose';

// fallback vibration patterns (ms) for browsers
const PATTERN: Record<BuzzKind, number | number[]> = {
  play: 12, block: 20, dealt: 25, hit: 45, bigHit: [70, 40, 90], myTurn: [10, 60, 10], win: [30, 50, 30, 50, 80], lose: [120, 60, 160],
};

export function buzz(kind: BuzzKind) {
  if (!enabled) return;
  try {
    if (Capacitor.isNativePlatform()) {
      switch (kind) {
        case 'play': void Haptics.impact({ style: ImpactStyle.Light }); break;
        case 'block': void Haptics.impact({ style: ImpactStyle.Medium }); break;
        case 'dealt': void Haptics.impact({ style: ImpactStyle.Medium }); break;
        case 'hit': void Haptics.impact({ style: ImpactStyle.Heavy }); break;
        case 'bigHit': void Haptics.vibrate({ duration: 180 }); break;
        case 'myTurn': void Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd()); break;
        case 'win': void Haptics.notification({ type: NotificationType.Success }); break;
        case 'lose': void Haptics.notification({ type: NotificationType.Error }); break;
      }
      return;
    }
    if (canVibrate()) navigator.vibrate(PATTERN[kind]);
  } catch { /* vibration is optional */ }
}
