// Offline card images: the service worker (public/sw.js) caches every card image the app shows.
// This module registers it and can pre-download the images for a set of cards.

export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => { /* offline images are optional */ }); });
}

export const offlineImagesSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

/** Download (and so cache) these images, a few at a time. Resolves with how many were saved. */
export async function saveImagesForOffline(urls: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const list = [...new Set(urls.filter(Boolean))];
  let done = 0;
  let ok = 0;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const url = list[next++];
      try { await fetch(url, { mode: 'no-cors', credentials: 'omit' }); ok++; } catch { /* skip */ }
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return ok;
}
