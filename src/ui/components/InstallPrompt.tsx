// "Install the app" offer for the web version: the browser's install prompt on Android/desktop Chrome and Edge,
// and Share → Add to Home Screen instructions on iPhone/iPad. Hidden inside the Android app and once installed.
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; });

const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const DISMISS = 'fab-trainer.install-dismissed';

export default function InstallPrompt() {
  const [can, setCan] = useState(!!deferred);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS) === '1'; } catch { return false; } });
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const on = () => setCan(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (hidden || standalone() || Capacitor.isNativePlatform() || (!can && !isIos())) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } };
  return (
    <div className="install-banner panel">
      <span>📲 <b>Install FaB Trainer</b>: full screen, its own icon, and games against the bots work offline.</span>
      {can ? (
        <button className="primary" onClick={async () => { await deferred?.prompt(); deferred = null; setCan(false); }}>Install</button>
      ) : (
        <button className="primary" onClick={() => setIosHelp(!iosHelp)}>How?</button>
      )}
      <button className="small" onClick={dismiss}>Not now</button>
      {iosHelp && <div className="small" style={{ flexBasis: '100%' }}>On iPhone or iPad, open this page in <b>Safari</b>, tap the <b>Share</b> button (the square with an arrow), then <b>Add to Home Screen</b>.</div>}
    </div>
  );
}
