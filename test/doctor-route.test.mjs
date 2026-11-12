// Route /doctor: dieselben Pruefungen wie `node install.mjs --doctor`, als JSON fuer die Leerzustand-Karte.
// Laeuft gegen einen echten Server mit eigenem HOME, fasst nie das echte ~/.claude an.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { apply, EVENTS, CODEX_EVENTS } from '../install.mjs'
import { diagnose, publicResults, HINTS } from '../doctor.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((ok, fail) => {
  const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) })
})
const get = (port, path, host = `localhost:${port}`, method = 'GET') => new Promise((ok, fail) => {
  const q = request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }))
  })
  q.on('error', fail); q.end()
})

// Server mit leerem HOME starten; settings = Inhalt von ~/.claude/settings.json (oder keiner)
async function start(t, { settings, codexHooks, extraEnv = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ab-doctor-route-'))
  const data = join(home, 'data')
  mkdirSync(data)
  if (settings) { mkdirSync(join(home, '.claude')); writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings)) }
  if (codexHooks) { mkdirSync(join(home, '.codex')); writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify(codexHooks)) }
  const port = await freePort()
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_BOARD_DATA: data, AGENT_BOARD_PORT: String(port) }
  for (const k of ['CODEX_HOME', 'AGENT_BOARD_BIND', 'AGENT_BOARD_HOSTS', 'AGENT_BOARD_ALLOW_HOST']) delete env[k]
  Object.assign(env, extraEnv)
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { env, stdio: 'ignore' })
  t.after(() => { srv.kill(); rmSync(home, { recursive: true, force: true }) })
  for (let i = 0; ; i++) {
    try { if ((await get(port, '/health')).status === 200) break } catch { /* noch nicht da */ }
    if (i > 80) throw new Error('Server nicht bereit')
    await sleep(100)
  }
  return { port, home, data }
}
const by = (list, id) => list.find((r) => r.id === id)

test('/doctor ohne Hooks: Liste mit ✗ bei den Hooks, Server ok, kein Home-Pfad in der Antwort', async (t) => {
  const { port, home } = await start(t)
  const res = await get(port, '/doctor')
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.deepEqual(body.results.map((r) => r.id), ['node', 'hooks', 'plugin', 'data', 'server', 'last'])
  const hooks = by(body.results, 'hooks')
  assert.equal(hooks.status, 'fail')
  assert.equal(hooks.hintKey, 'run')
  assert.deepEqual(hooks.vars, { cmd: 'node install.mjs' })
  assert.match(hooks.detail, /^~/)
  // der Server prueft sich nicht per HTTP selbst: er laeuft ja
  assert.equal(by(body.results, 'server').status, 'ok')
  assert.equal(by(body.results, 'last').status, 'warn')
  for (const r of body.results) for (const v of [r.detail, r.hint, ...Object.values(r.vars || {})]) assert.ok(!String(v).includes(home), `Home-Ordner in: ${v}`)
  // nur die bekannten Felder
  for (const r of body.results) assert.deepEqual(Object.keys(r).filter((k) => !['status', 'id', 'label', 'detail', 'hint', 'hintKey', 'vars'].includes(k)), [])
})

test('/doctor mit installierten Hooks: Hooks ok; fremder Host-Header und POST bleiben draussen', async (t) => {
  const { port, data } = await start(t, { settings: apply({}, DIR) })
  writeFileSync(join(data, 'events.jsonl'), JSON.stringify({ t: Date.now() - 5000, ev: 'Stop' }) + '\n')
  const body = JSON.parse((await get(port, '/doctor')).body)
  assert.equal(by(body.results, 'hooks').status, 'ok')
  assert.equal(by(body.results, 'last').status, 'ok')
  assert.equal(body.ok, true)
  assert.equal((await get(port, '/doctor', 'evil.example')).status, 403)
  assert.equal((await get(port, '/doctor', undefined, 'POST')).status, 405)
})

test('/doctor nur fuer den eigenen Rechner unter localhost: freigegebener Host-Name bekommt 403', async (t) => {
  const { port } = await start(t, { extraEnv: { AGENT_BOARD_HOSTS: 'board.example' } })
  assert.equal((await get(port, '/health', 'board.example')).status, 200)
  assert.equal((await get(port, '/doctor', 'board.example')).status, 403)
  assert.equal((await get(port, '/doctor', `127.0.0.1:${port}`)).status, 200)
  const { doctorAllowed } = await import('../server.mjs')
  assert.equal(doctorAllowed('localhost:4777', '127.0.0.1', 4777), true)
  assert.equal(doctorAllowed('localhost:4777', '192.168.1.20', 4777), false)
  assert.equal(doctorAllowed('board.example', '::1', 4777), false)
})

test('/doctor: nur Codex-Hooks installiert -> Codex-Ergebnis statt ✗ fuer Claude', async (t) => {
  const { port } = await start(t, { codexHooks: apply({}, DIR, { codex: true }) })
  const body = JSON.parse((await get(port, '/doctor')).body)
  assert.equal(by(body.results, 'hooks').status, 'ok')
  assert.equal(by(body.results, 'plugin'), undefined)
})

test('diagnose: jeder Punkt hat eine id, Hinweise kommen aus HINTS; publicResults ersetzt den Home-Ordner', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-doctor-pub-'))
  try {
    const res = await diagnose({ home, env: {}, port: 4777, nodeVersion: '18.0.0', events: EVENTS, probe: async () => ({ up: false, error: 'ECONNREFUSED' }) })
    for (const r of res) {
      assert.ok(r.id, `${r.label}: id fehlt`)
      if (r.hint) assert.equal(r.hint, HINTS[r.hintKey](r.vars))
      else assert.equal(r.hintKey, undefined)
    }
    assert.deepEqual(res.filter((r) => r.hintKey).map((r) => r.hintKey), ['node', 'run', 'server', 'noevents'])
    const pub = publicResults(res, home)
    assert.ok(!JSON.stringify(pub).includes(home))
    assert.match(by(pub, 'hooks').detail, /^~/)
    // Pfadgrenze: ein laengerer Nachbarordner bleibt, Schreibweise mit / wird ebenfalls ersetzt
    const mask = (detail, h) => publicResults([{ status: 'fail', detail }], h)[0].detail
    assert.equal(mask('/home/alice/data and /home/al/x', '/home/al'), '/home/alice/data and ~/x')
    assert.equal(mask('not found at C:/Users/me/ab/collector.mjs, C:\\Users\\me\\x', 'C:\\Users\\me'), 'not found at ~/ab/collector.mjs, ~\\x')
    assert.equal(mask('/home/al', '/home/al'), '~')
    assert.equal(CODEX_EVENTS.length > 0, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('i18n: jede id und jeder Hinweis aus doctor.mjs hat einen Text mit denselben Platzhaltern', () => {
  const ctx = {
    window: {}, location: { search: '?lang=en' }, navigator: { languages: ['en'], language: 'en' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: () => null }, URLSearchParams,
  }
  vm.runInNewContext(readFileSync(join(DIR, 'public', 'i18n.js'), 'utf8'), ctx)
  const table = ctx.window.AgentBoardI18n.table
  for (const id of ['node', 'hooks', 'plugin', 'data', 'server', 'last']) assert.ok(table['doctor.l.' + id], `doctor.l.${id} fehlt`)
  const probe = { cmd: '<CMD>', path: '<PATH>', port: '<PORT>' }
  for (const [key, fn] of Object.entries(HINTS)) {
    const row = table['doctor.h.' + key]
    assert.ok(row, `doctor.h.${key} fehlt`)
    // welche Platzhalter der englische Terminal-Text benutzt, die braucht auch jede Uebersetzung
    const used = Object.keys(probe).filter((k) => fn(probe).includes(probe[k]))
    for (const text of row) assert.deepEqual(Object.keys(probe).filter((k) => text.includes(`{${k}}`)), used, `doctor.h.${key}: ${text}`)
  }
  // und umgekehrt: kein verwaister Text
  for (const k of Object.keys(table)) if (k.startsWith('doctor.h.')) assert.ok(HINTS[k.slice(9)], `${k} ohne Gegenstueck in doctor.mjs`)
})
