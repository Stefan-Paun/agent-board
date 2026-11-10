// GET /replay (replay.mjs + server.mjs): a window of events.jsonl as NDJSON, hard caps, host check,
// broken lines in the log.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWindow, scanWindow, serveWindow, LIMITS } from '../replay.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ev = (t, extra = {}) => JSON.stringify({ t, ev: 'PreToolUse', sid: 's', tool: 'Read', what: `f${t}`, ...extra }) + '\n'
const chunks = async function* (buf, size) { for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size) }
const scan = async (text, from, to, limits = LIMITS, size = 7) => {
  const out = []
  const r = await scanWindow(chunks(Buffer.from(text), size), from, to, (s) => out.push(s), limits)
  return { ...r, lines: out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

test('parseWindow: needs numeric from < to, at most two days', () => {
  const q = (s) => parseWindow(new URLSearchParams(s))
  assert.deepEqual(q('from=1000&to=2000'), { from: 1000, to: 2000 })
  assert.equal(q(''), null)
  assert.equal(q('from=1000'), null)
  assert.equal(q('from=a&to=5'), null)
  assert.equal(q('from=&to=5'), null)
  assert.equal(q('from=5&to=5'), null)
  assert.equal(q('from=9&to=5'), null)
  assert.equal(q('from=0&to=Infinity'), null)
  assert.equal(q(`from=0&to=${2 * 86400e3 + 1}`), null)
  assert.deepEqual(q(`from=0&to=${2 * 86400e3}`), { from: 0, to: 2 * 86400e3 })
})

test('window: from inclusive, to exclusive, log order kept, lines split over chunks', async () => {
  const text = ev(100) + ev(200) + ev(300) + ev(150) + ev(400)
  const r = await scan(text, 200, 400)
  assert.deepEqual(r.lines.map((e) => e.t), [200, 300])
  assert.equal(r.truncated, false)
  assert.deepEqual(r.lines[0], { t: 200, ev: 'PreToolUse', sid: 's', tool: 'Read', what: 'f200' }) // fields untouched
  assert.equal((await scan(text, 0, 1000, LIMITS, 3)).n, 5)
})

test('broken lines, non-events and a half written last line are skipped', async () => {
  const text = ev(100) + '{"t":150,"ev":\n' + 'not json\n' + '[1,2]\n' + '"str"\n' + '{"t":"x","ev":"a"}\n' + '{"t":160}\n' + '\n' + '{"t":170,"ev":"Stop"}\r\n' + ev(180) + '{"t":190,"ev":"Sto'
  const r = await scan(text, 0, 1000)
  assert.deepEqual(r.lines.map((e) => e.t), [100, 170, 180])
  // the same last line complete (no newline at the end) still counts
  assert.equal((await scan(ev(100).trim(), 0, 1000)).n, 1)
})

test('cap on the number of events: cut and flagged, exactly full is not flagged', async () => {
  const text = [1, 2, 3, 4, 5].map((t) => ev(t)).join('')
  const lim = { ...LIMITS, maxEvents: 3 }
  const r = await scan(text, 0, 100, lim)
  assert.equal(r.n, 3); assert.equal(r.truncated, true)
  assert.deepEqual(r.lines.map((e) => e.t), [1, 2, 3])
  const exact = await scan([1, 2, 3].map((t) => ev(t)).join(''), 0, 100, lim)
  assert.equal(exact.n, 3); assert.equal(exact.truncated, false)
  // events outside the window do not count against the cap
  const out = await scan(ev(500) + ev(600) + ev(1) + ev(2) + ev(3), 0, 100, lim)
  assert.equal(out.n, 3); assert.equal(out.truncated, false)
})

test('cap on bytes: stops before the limit is exceeded', async () => {
  const text = Array.from({ length: 50 }, (_, i) => ev(i + 1)).join('')
  const one = Buffer.byteLength(ev(1))
  const r = await scan(text, 0, 1000, { ...LIMITS, maxBytes: one * 10 + 5 })
  assert.equal(r.n, 10); assert.equal(r.truncated, true)
})

test('oversized lines are skipped without being buffered, the following events survive', async () => {
  const huge = JSON.stringify({ t: 150, ev: 'PreToolUse', what: 'x'.repeat(5000) }) + '\n'
  const lim = { ...LIMITS, maxLine: 1000 }
  const r = await scan(ev(100) + huge + ev(200) + huge.repeat(3) + ev(300), 0, 1000, lim, 64)
  assert.deepEqual(r.lines.map((e) => e.t), [100, 200, 300])
  // a never-ending line without newline: skipped, nothing else to report
  const r2 = await scan(ev(100) + 'y'.repeat(100000), 0, 1000, lim, 4096)
  assert.deepEqual(r2.lines.map((e) => e.t), [100])
})

test('too many concurrent scans get 503 instead of piling up', async () => {
  const got = {}
  const res = { writeHead(code) { got.code = code; return { end: (b) => { got.body = b } } } }
  await serveWindow(res, join(DIR, 'package.json'), 0, 1, { ...LIMITS, maxActive: 0 })
  assert.equal(got.code, 503)
})

// ---- real server ----
const PORT = 48000 + Math.floor(Math.random() * 1000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function get(path, { host = `localhost:${PORT}`, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const q = request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: host } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    q.on('error', reject); q.end()
  })
}
const ndjson = (body) => body.split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('server: /replay answers a window, rejects bad ranges, wrong hosts and writes', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-replay-'))
  const lines = ev(1000) + 'garbage\n' + ev(2000, { sid: 'b' }) + ev(3000) + '{"t":2500,"ev":\n' + ev(4000)
  writeFileSync(join(data, 'events.jsonl'), lines)
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { env: { ...process.env, AGENT_BOARD_DATA: data, AGENT_BOARD_PORT: String(PORT) }, stdio: 'ignore' })
  t.after(() => { srv.kill(); rmSync(data, { recursive: true, force: true }) })
  for (let i = 0; i < 80; i++) { try { await get('/health'); break } catch { await sleep(100) } }

  const ok = await get('/replay?from=1500&to=4000')
  assert.equal(ok.status, 200)
  assert.match(ok.headers['content-type'], /application\/x-ndjson/)
  assert.equal(ok.headers['cache-control'], 'no-store')
  const rows = ndjson(ok.body)
  assert.deepEqual(rows.map((e) => e.t), [2000, 3000, undefined])
  assert.deepEqual(rows.at(-1), { ev: '__end', n: 2, truncated: false })
  assert.deepEqual(Object.keys(rows[0]).sort(), ['ev', 'sid', 't', 'tool', 'what']) // nothing added

  assert.equal((await get('/replay')).status, 400)
  assert.equal((await get('/replay?from=5&to=1')).status, 400)
  assert.equal((await get(`/replay?from=0&to=${3 * 86400e3}`)).status, 400)
  assert.equal((await get('/replay?from=1500&to=4000', { host: 'evil.example' })).status, 403)
  assert.equal((await get('/replay?from=1500&to=4000', { host: `localhost:${PORT + 1}` })).status, 403)
  assert.equal((await get('/replay?from=1500&to=4000', { method: 'POST' })).status, 405)
  const empty = ndjson((await get('/replay?from=9000&to=9500')).body)
  assert.deepEqual(empty, [{ ev: '__end', n: 0, truncated: false }])
})

test('server: more events than the cap are cut and flagged; a missing log is an empty answer', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-replay-'))
  const port = PORT + 1
  const total = LIMITS.maxEvents + 50
  let big = ''
  for (let i = 0; i < total; i++) big += ev(1000 + i)
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { env: { ...process.env, AGENT_BOARD_DATA: data, AGENT_BOARD_PORT: String(port) }, stdio: 'ignore' })
  t.after(() => { srv.kill(); rmSync(data, { recursive: true, force: true }) })
  const getP = (path) => new Promise((resolve, reject) => {
    const q = request({ host: '127.0.0.1', port, path, headers: { Host: `localhost:${port}` } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c }); res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    q.on('error', reject); q.end()
  })
  for (let i = 0; i < 80; i++) { try { await getP('/health'); break } catch { await sleep(100) } }
  const none = ndjson((await getP('/replay?from=0&to=99999999')).body)
  assert.deepEqual(none, [{ ev: '__end', n: 0, truncated: false }])
  writeFileSync(join(data, 'events.jsonl'), big)
  const r = ndjson((await getP('/replay?from=0&to=99999999')).body)
  assert.equal(r.length, LIMITS.maxEvents + 1)
  assert.deepEqual(r.at(-1), { ev: '__end', n: LIMITS.maxEvents, truncated: true })
  assert.equal(r[0].t, 1000)
})
