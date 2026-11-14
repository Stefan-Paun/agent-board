// Service Worker: cacht nur statische Dateien (network-first), nie /events, /health oder SSE.
'use strict'
const CACHE = 'agent-board-v8'
// Eine Liste fuer alles Statische im Wurzelordner: PRECACHE und statisch() leiten beide davon ab.
const ROOT_FILES = ['index.html', 'i18n.js', 'labels.js', 'empty-logic.js', 'agent-types.js', 'machine-logic.js', 'app.js', 'city-logic.js', 'city.js', 'city.css', 'manifest.webmanifest', 'icon.svg']
const FX_FILES = ['people.js', 'sound.js', 'crew.js', 'status.js', 'kino.js', 'attention.js', 'health.js', 'daynight.js', 'inspect.js', 'timeline.js', 'daystats.js', 'day.js', 'keys.js', 'pwa.js',
  'timecore.js', 'timemachine.js', 'weekstats.js', 'week.js', 'daycard.js', 'machines.js',
  'crew.css', 'kino.css', 'attention.css', 'health.css', 'inspect.css', 'timeline.css', 'day.css', 'keys.css', 'timemachine.css', 'week.css', 'machines.css']
const PRECACHE = ['./', ...ROOT_FILES, ...FX_FILES.map((f) => 'fx/' + f)]

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
  const parts = p.split('/')
  const name = parts[parts.length - 1]
  if (p.endsWith('/')) return true
  if (parts[parts.length - 2] === 'fx') return /^[\w-]+\.(js|css)$/.test(name)
  return ROOT_FILES.includes(name) || p.endsWith('.css')
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
