// Android app integration (Capacitor). Does nothing in a normal browser.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ScreenOrientation } from '@capacitor/screen-orientation';

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native');
  void applyOrientation(orientationPref());
  // Android back button: leave a game with confirmation, otherwise go back a page, or close the app
  void App.addListener('backButton', ({ canGoBack }) => {
    if (document.documentElement.classList.contains('in-game')) {
      window.dispatchEvent(new Event('fab-back'));
      return;
    }
    if (canGoBack && location.hash && location.hash !== '#') history.back();
    else void App.exitApp();
  });
}

// ---------------------------------------------------------------- screen orientation (Android app)

export type OrientationPref = 'auto' | 'portrait' | 'landscape';
const OKEY = 'fab-trainer.orientation';

export const isNative = () => Capacitor.isNativePlatform();

export function orientationPref(): OrientationPref {
  try { const v = localStorage.getItem(OKEY); return v === 'portrait' || v === 'landscape' ? v : 'auto'; } catch { return 'auto'; }
}

/** Auto follows the phone (and its rotation lock); portrait suits one-handed play. */
export async function applyOrientation(pref: OrientationPref) {
  try { localStorage.setItem(OKEY, pref); } catch { /* ignore */ }
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (pref === 'auto') await ScreenOrientation.unlock();
    else await ScreenOrientation.lock({ orientation: pref });
  } catch { /* older Android: keep the manifest's setting */ }
}
