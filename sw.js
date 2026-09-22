cd/*
 * Minimal service worker.
 *
 * Its job is to make the app installable and to survive a flaky connection on
 * the way in — not to work offline. Attendance is deliberately network-only:
 * a check-in that "succeeded" from a cache would be a lie, and the server owns
 * both the clock and the decision.
 *
 * Strategy:
 *   - the app shell is precached and served cache-first, so opening the
 *     installed icon is instant;
 *   - navigations fall back to the cached shell when the network fails, so the
 *     app opens and can show its own error rather than the browser's;
 *   - anything under /api is never cached or intercepted.
 */

/*
 * Bumped to v2 with the typeface change: `activate` deletes every cache whose
 * name is not the current one, so raising the version is what clears an
 * existing install of the old hashed bundles and the three Google font
 * stylesheets it had cached.
 */
const VERSION = 'v2';
const SHELL_CACHE = `shell-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/logo_mark.png',
  '/favicon.png',
  /*
   * The typeface, precached with the shell. Unlike the build assets these two
   * paths are not content-hashed — which is exactly why they can be named
   * here, and why `index.html` can preload the Arabic one. Replacing a font
   * therefore means bumping VERSION above.
   */
  '/fonts/rubik-arabic.woff2',
  '/fonts/rubik-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A missing asset must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch the API or anything off-origin. Attendance must always hit the
  // server: a cached "checked in" would be worse than an error.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  // Navigations: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );

    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (!response.ok || response.type !== 'basic') return response;

          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));

          return response;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
