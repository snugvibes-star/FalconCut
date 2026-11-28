/* Development-only service worker for PWA installability on localhost.
 * It intentionally does NOT cache anything: Vite HMR must stay live.
 */
self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => { /* no interception in dev */ });
