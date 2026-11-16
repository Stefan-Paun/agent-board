// Service Worker: Cache-Liste muss zu public/index.html passen (sonst bleiben neue Dateien ungecacht/veraltet).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ORIGIN = 'http://127.0.0.1:4777'
const ctx = { self: { addEventListener() {}, location: { origin: ORIGIN } }, URL }
const { statisch, PRECACHE } = vm.runInNewContext(readFileSync(join(PUB, 'sw.js'), 'utf8') + '\n;({ statisch, PRECACHE })', ctx)

const req = (path, method = 'GET', accept = '') => ({ method, url: ORIGIN + path, headers: { get: () => accept } })
const html = readFileSync(join(PUB, 'index.html'), 'utf8')
const local = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"|<link[^>]*\shref="([^"]+)"/g)]
  .map((m) => m[1] || m[2]).filter((u) => /\.(js|css)$/.test(u) && !/^(https?:)?\/\//.test(u))

test('index.html laedt lokale Skripte und CSS', () => assert.ok(local.length > 10))

test('statisch() erfasst jede lokal geladene .js/.css aus index.html', () => {
  for (const u of local) assert.ok(statisch(req('/' + u)), u + ' fehlt in statisch()')
})

test('PRECACHE: Dateien existieren und decken index.html ab', () => {
  for (const f of PRECACHE) if (f !== './') assert.ok(existsSync(join(PUB, f)), f + ' fehlt auf der Platte')
  for (const u of local) assert.ok(PRECACHE.includes(u), u + ' fehlt in PRECACHE')
})

test('statisch() laesst Events, Health, SSE, POST und fremde Hosts aus', () => {
  assert.equal(statisch(req('/events')), false)
  assert.equal(statisch(req('/health')), false)
  assert.equal(statisch(req('/sw.js')), false)
  assert.equal(statisch(req('/app.js', 'POST')), false)
  assert.equal(statisch(req('/app.js', 'GET', 'text/event-stream')), false)
  assert.equal(statisch({ method: 'GET', url: 'https://x.example/app.js', headers: { get: () => '' } }), false)
})
