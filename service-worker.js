// Fetch current application files; retain a fallback for offline use.
const APP_CACHE = 'centauri-dashboard-v2';
const APP_FILES = ['/', '/dashboard.html', '/dashboard.css', '/dashboard.js', '/themes.js', '/themes.css', '/star-wars.css', '/x-wing.svg', '/lightsaber-cursor.svg', '/lightsaber-cursor-active.svg', '/magic.css', '/magic.js', '/cc2.js', '/replay.js'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(APP_CACHE).then(async cache => {
        await Promise.allSettled(APP_FILES.map(url => cache.add(new Request(url, { cache: 'reload' }))));
        await self.skipWaiting();
    }));
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await caches.delete('pwa-cache');
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || !APP_FILES.includes(url.pathname)) return;
    event.respondWith((async () => {
        const cache = await caches.open(APP_CACHE);
        try {
            const response = await fetch(event.request, { cache: 'no-cache' });
            if (response.ok) await cache.put(event.request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(event.request);
            if (cached) return cached;
            throw error;
        }
    })());
});
