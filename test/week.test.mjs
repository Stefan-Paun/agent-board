// Route /week (server.mjs): Host-Pruefung wie /day, gestreamtes Lesen mit Obergrenze, nur Zahlen und Namen in der Antwort.
process.env.TZ = 'Europe/Vienna'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = mkdtempSync(join(tmpdir(), 'agent-board-week-'))
process.env.AGENT_BOARD_DATA = data
const { weekSummary } = await import('../server.mjs')
after(() => rmSync(data, { recursive: true, force: true }))

const now = Date.now()
const at = (back, hh, mm = 0) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, hh, mm).getTime() }
const line = (o) => JSON.stringify(o)
function log(extra = []) {
  return [
    line({ t: at(1, 9), ev: 'UserPromptSubmit', sid: 'a', proj: 'demo-app', msg: 'GEHEIMER PROMPT', cwd: '/Users/jemand/privat/demo-app' }),
    line({ t: at(1, 9, 1), ev: 'PreToolUse', sid: 'a', tool: 'Bash', what: 'rm -rf /Users/jemand/privat', tid: '1' }),
    line({ t: at(1, 9, 2), ev: 'PostToolUse', sid: 'a', tool: 'Bash', tid: '1' }),
    'das ist keine json-zeile',
    '{"t":',
    line({ t: at(1, 9, 30), ev: 'Stop', sid: 'a', msg: 'Fertig in /Users/jemand/privat' }),
    ...extra,
  ].join('\n') + '\n'
}

test('weekSummary: streamt das Log, keine Pfade, Prompts oder Befehle in der Antwort', async () => {
  const f = join(data, 'a.jsonl')
  writeFileSync(f, log())
  const r = await weekSummary(now, f)
  assert.equal(r.days.length, 7)
  assert.equal(r.days[5].active, 30 * 60000)
  assert.equal(r.days[5].tools, 1)
  assert.deepEqual(r.projects.map((p) => p.proj), ['demo-app'])
  assert.equal(r.truncated, false)
  const txt = JSON.stringify(r)
  for (const bad of ['GEHEIMER', 'rm -rf', '/Users', 'privat', 'cwd', 'msg']) assert.ok(!txt.includes(bad), bad)
})

test('weekSummary: fehlende Datei und leere Datei ergeben eine leere Woche', async () => {
  const r = await weekSummary(now, join(data, 'gibt-es-nicht.jsonl'))
  assert.equal(r.totals.active, 0); assert.equal(r.truncated, false)
  writeFileSync(join(data, 'leer.jsonl'), '')
  assert.equal((await weekSummary(now, join(data, 'leer.jsonl'))).totals.sessions, 0)
})

test('weekSummary: Obergrenze in Bytes liest nur das Ende der Datei', async () => {
  const f = join(data, 'gross.jsonl')
  const old = line({ t: at(1, 8), ev: 'PreToolUse', sid: 'alt', tool: 'Read' }) + '\n'
  const newer = line({ t: at(0, 0), ev: 'PreToolUse', sid: 'neu', tool: 'Read' }) + '\n'
  writeFileSync(f, old.repeat(50) + newer.repeat(5))
  const all = await weekSummary(now, f)
  assert.equal(all.truncated, false)
  assert.equal(all.totals.tools, 55)
  const cut = await weekSummary(now, f, newer.length * 5 + 10) // schneidet mitten in eine alte Zeile
  assert.equal(cut.truncated, true)
  assert.equal(cut.totals.tools, 5 + 0)
  assert.equal(cut.days[6].tools, 5)
})

test('weekSummary: Obergrenze bei der Zahl der Ereignisse', async () => {
  const f = join(data, 'viele.jsonl')
  writeFileSync(f, (line({ t: at(1, 8), ev: 'PreToolUse', sid: 'x', tool: 'Read' }) + '\n').repeat(100))
  const r = await weekSummary(now, f, 1e9, 10)
  assert.equal(r.truncated, true)
  assert.equal(r.totals.tools, 10)
})

function port() {
  return new Promise((ok, fail) => { const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) })
}
const get = (p, path, host, method = 'GET') => new Promise((ok, fail) => {
  const r = request({ host: '127.0.0.1', port: p, path, method, headers: { Host: host } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => ok({ status: res.statusCode, body: b, headers: res.headers }))
  })
  r.on('error', fail); r.end()
})

test('Route /week: Host-Pruefung wie /day, nur lesend, JSON ohne Pfade', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-week-srv-'))
  writeFileSync(join(dir, 'events.jsonl'), log())
  const p = await port()
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { stdio: 'ignore', env: { ...process.env, AGENT_BOARD_PORT: String(p), AGENT_BOARD_DATA: dir, AGENT_BOARD_BIND: '', AGENT_BOARD_HOSTS: '' } })
  try {
    let ok = null
    for (let i = 0; i < 60 && !ok; i++) {
      try { const r = await get(p, '/week', `localhost:${p}`); if (r.status === 200) ok = r } catch { await new Promise((r) => setTimeout(r, 100)) }
    }
    assert.ok(ok, 'Server antwortet')
    assert.match(ok.headers['content-type'], /application\/json/)
    const j = JSON.parse(ok.body)
    assert.equal(j.days.length, 7)
    assert.equal(j.totals.tools, 1)
    for (const bad of ['GEHEIMER', '/Users', 'rm -rf']) assert.ok(!ok.body.includes(bad), bad)
    assert.equal((await get(p, '/week', 'evil.example')).status, 403)
    assert.equal((await get(p, '/week', `evil.example:${p}`)).status, 403)
    assert.equal((await get(p, '/week', `localhost:${p}`, 'POST')).status, 405)
    assert.equal((await get(p, '/day', 'evil.example')).status, 403)
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }) }
})
