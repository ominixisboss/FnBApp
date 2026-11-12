// Android app integration (Capacitor). Does nothing in a normal browser.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native');
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
