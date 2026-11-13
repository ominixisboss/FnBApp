// Turn web push notifications on or off for this browser (challenges from friends, friend cups).
import { Capacitor } from '@capacitor/core';
import { pushApi } from './auth';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Ask permission, subscribe this browser and register it with the server. Returns an error message or null. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return 'This browser can’t receive notifications.';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'Notifications need the installed web app (or a page reload once it has loaded).';
  if ((await Notification.requestPermission()) !== 'granted') return 'Notifications are blocked for this site in your browser settings.';
  const { key } = await pushApi.key();
  if (!key) return 'The server can’t send notifications right now.';
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  await pushApi.subscribe(sub.toJSON());
  return null;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await pushApi.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
