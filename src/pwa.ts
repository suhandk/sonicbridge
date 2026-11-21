export interface OfflineState { message: string; update?: () => void }
export function registerOffline(update: (state: OfflineState) => void, beforeReload: () => void) {
  if (!import.meta.env.PROD) { update({ message: 'Offline caching is enabled in production builds. Development uses live assets.' }); return () => {}; }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { update({ message: 'Offline support unavailable: use a supported browser over trusted HTTPS.' }); return () => {}; }
  let disposed = false, applying = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => { if (applying) location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', changed);
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(async registration => {
    const show = () => {
      if (disposed) return;
      if (registration.waiting) update({ message: 'App update available. Stop audio and reload to apply it.', update: () => { beforeReload(); applying = true; registration.waiting?.postMessage('ACTIVATE_UPDATE'); } });
    };
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', show));
    try {
      await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_resolve, reject) => { readyTimer = setTimeout(() => reject(new Error('Offline install did not finish within 30 seconds. Check asset loading, storage and HTTPS, then reload online.')), 30000); })]);
    } finally { if (readyTimer) clearTimeout(readyTimer); }
    if (!disposed) update({ message: 'Offline app ready. First load/install uses HTTPS; later payloads and replies travel only as sound. Browser storage can be evicted.' });
    show();
  }).catch(error => { if (!disposed) update({ message: `Offline caching failed: ${String(error)}. Keep the app online until a successful installation.` }); });
  return () => { disposed = true; if (readyTimer) clearTimeout(readyTimer); navigator.serviceWorker.removeEventListener('controllerchange', changed); };
}
