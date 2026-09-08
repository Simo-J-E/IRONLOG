const PREFIX = `ironlog-${new URL(self.registration.scope).pathname}-`
const CACHE = PREFIX + '__BUILD_HASH__'
const APP_SHELL = __PRECACHE__
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)))
  // Wait for old tabs to close: an update must not replace code mid-workout.
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  const scope = new URL(self.registration.scope)
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || /\/api(?:\/|$)/.test(url.pathname)) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(new URL('./index.html', scope).href, copy))) }
      return response
    }).catch(async () => (await caches.open(CACHE)).match(new URL('./index.html', scope).href)))
    return
  }
  if (!APP_SHELL.some(path => new URL(path, scope).href === url.href)) return
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)))
})
