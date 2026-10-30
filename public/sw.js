// Service Worker: cacht nur statische Dateien (network-first), nie /events, /health oder SSE.
'use strict'
const CACHE = 'agent-board-v3'
const PRECACHE = ['./', 'index.html', 'i18n.js', 'labels.js', 'app.js', 'city-logic.js', 'city.js', 'manifest.webmanifest', 'icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .catch(() => {})
    .then(() => self.clients.claim()))
})

// nur eigene, statische GET-Anfragen: Seite, i18n.js, app.js, fx/*, CSS, Manifest, Icon
function statisch(req) {
  if (req.method !== 'GET') return false
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return false
  if ((req.headers.get('accept') || '').includes('text/event-stream')) return false
  const p = url.pathname
  if (p.endsWith('/events') || p.endsWith('/health') || p.endsWith('/sw.js')) return false
  return p.endsWith('/') || /\/(index\.html|i18n\.js|labels\.js|app\.js|city\.js|city-logic\.js|manifest\.webmanifest|icon\.svg)$/.test(p) ||
    /\/fx\/[\w-]+\.(js|css)$/.test(p) || p.endsWith('.css')
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (!statisch(req)) return // Browser macht es selbst (SSE bleibt unberuehrt)
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
      }
      return res
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  )
})
