// Web push notifications (installed web app / desktop browsers): a friend challenges you, or a friend cup you're
// in starts. The server makes its own VAPID key pair on first start and keeps it in the database, so no
// third-party account is needed. (The Android app's WebView can't receive web push; see README.)
import webpush from 'web-push';
import { store } from './db';

let ready: Promise<string | null> | null = null;

/** The public key browsers need to subscribe (null if push couldn't be set up). */
export function vapidPublicKey(): Promise<string | null> {
  ready ??= (async () => {
    try {
      let raw = await store.getMeta('vapid');
      if (!raw) {
        raw = JSON.stringify(webpush.generateVAPIDKeys());
        await store.setMeta('vapid', raw);
      }
      const k = JSON.parse(raw) as { publicKey: string; privateKey: string };
      webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:admin@localhost', k.publicKey, k.privateKey);
      return k.publicKey;
    } catch (e) {
      console.error('push setup failed', e);
      return null;
    }
  })();
  return ready;
}

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export function validSub(x: unknown): x is PushSub {
  const s = x as PushSub;
  return !!s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
}

/** Send a notification to every device a user subscribed; dead subscriptions are removed. */
export async function notify(userId: number, title: string, body: string, url = '/') {
  if (!(await vapidPublicKey())) return;
  const subs = await store.pushSubs(userId).catch(() => [] as string[]);
  await Promise.all(subs.map(async (json) => {
    const sub = JSON.parse(json) as PushSub;
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body, url }), { TTL: 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await store.removePushSub(sub.endpoint).catch(() => {});
    }
  }));
}
