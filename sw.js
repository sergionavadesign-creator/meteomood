// ══════════════════════════════════════════════════════════════
// MeteoMood Service Worker v2
// Cache strategy: network-first per API, cache-first per assets
// ══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'meteomood-v2';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(STATIC_CACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH STRATEGY ────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: sempre rete, mai cache
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('api.open-meteo.com') ||
    url.hostname.includes('news.google.com') ||
    url.hostname.includes('reddit.com') ||
    url.hostname.includes('overpass-api.de') ||
    url.pathname.startsWith('/.netlify/functions/')
  ) {
    return; // Lascia passare senza intercettare
  }

  // Assets statici: cache-first con fallback rete
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback per navigazione
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── NOTIFICHE PUSH ────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_ALARM') {
    const {time, label} = e.data;
    const delay = time - Date.now();
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // max 24h
      setTimeout(() => {
        self.registration.showNotification('🌦️ MeteoMood', {
          body: label || 'Come ti senti adesso? Tocca per aggiornare il tuo mood.',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'meteomood-checkin',
          requireInteraction: false,
          silent: false,
          vibrate: [200, 100, 200],
          actions: [
            {action: 'checkin', title: '✅ Aggiorna mood'},
            {action: 'dismiss', title: '✕ Dopo'},
          ],
        });
      }, delay);
    }
  }

  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(wins => {
      const existing = wins.find(w => w.url.includes(self.registration.scope));
      if (existing) {
        existing.focus();
        existing.postMessage({type: 'SHOW_CHECKIN'});
      } else {
        clients.openWindow('/?action=checkin');
      }
    })
  );
});
