// Second machine, receiver side: POST /ingest is off without a token, checks the token, the limits and every field,
// and a remote sender can never write into a local session or pose as local.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'test-token-0123456789-abcdefghij-XYZ' // placeholder, 36 characters
const CFG_PORT = 48000 + Math.floor(Math.random() * 1000)
const dataDir = mkdtempSync(join(tmpdir(), 'agent-board-ingest-'))
process.env.AGENT_BOARD_DATA = dataDir
process.env.AGENT_BOARD_PORT = String(CFG_PORT)
process.env.AGENT_BOARD_INGEST_TOKEN = TOKEN
process.env.AGENT_BOARD_INGEST_MACHINES = 'pc-two, laptop'
delete process.env.AGENT_BOARD_BIND
delete process.env.AGENT_BOARD_HOSTS
delete process.env.AGENT_BOARD_ALLOW_HOST

const { ingestConfig, tokenOk, bearer, createLimiter, cleanEvent, stampEvent, createIngest, machineOk, LIMITS, EVENT_FIELDS } = await import('../ingest.mjs')
const { reduce } = await import('../collector.mjs')
const EVENTS_FILE = join(dataDir, 'events.jsonl')
const logLines = () => (existsSync(EVENTS_FILE) ? readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

let server, port
before(async () => {
  ;({ server } = await import('../server.mjs'))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
})
after(async () => {
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  rmSync(dataDir, { recursive: true, force: true })
})

// POST (or any method) to a server; returns { status, json, headers }
function call(toPort, { method = 'POST', path = '/ingest', token = TOKEN, machine = 'pc-two', type = 'application/json', body, host = `localhost:${CFG_PORT}`, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    const h = { Host: host, Connection: 'close', ...headers }
    if (token) h.Authorization = `Bearer ${token}`
    if (machine) h['X-Agent-Board-Machine'] = machine
    if (type) h['Content-Type'] = type
    if (data) h['Content-Length'] = data.length
    const q = request({ host: '127.0.0.1', port: toPort, method, path, headers: h }, (res) => {
      let txt = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { txt += c })
      res.on('end', () => { let json = null; try { json = JSON.parse(txt) } catch { /* plain text */ } resolve({ status: res.statusCode, json, headers: res.headers }) })
    })
    q.on('error', (e) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? resolve({ status: 0 }) : reject(e)))
    q.end(data || undefined)
  })
}
const ev = (over = {}) => ({ t: Date.now(), ev: 'PreToolUse', sid: 'abcd1234', tool: 'Bash', what: 'npm test', ...over })

// ---------- configuration ----------
test('config: off without a token, on with a long token, default machine name', () => {
  assert.deepEqual(ingestConfig({}), { enabled: false, token: '', machines: [], error: null })
  const c = ingestConfig({ AGENT_BOARD_INGEST_TOKEN: TOKEN })
  assert.equal(c.enabled, true)
  assert.deepEqual(c.machines, ['remote'])
  assert.deepEqual(ingestConfig({ AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: ' PC-Two , laptop,laptop ' }).machines, ['pc-two', 'laptop'])
})

test('config: short, simple or spaced tokens and bad machine names are errors and keep the mode off', () => {
  for (const env of [
    { AGENT_BOARD_INGEST_TOKEN: 'qwe123' },
    { AGENT_BOARD_INGEST_TOKEN: 'a'.repeat(31) },
    { AGENT_BOARD_INGEST_TOKEN: 'a'.repeat(40) },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN.slice(0, 20) + ' ' + TOKEN.slice(20) },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'local' },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'pc,claude' },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'has space' },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'x'.repeat(17) },
    { AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'a~b' },
  ]) {
    const c = ingestConfig(env)
    assert.equal(c.enabled, false, JSON.stringify(env))
    assert.ok(c.error, JSON.stringify(env))
    assert.ok(!c.error.includes(env.AGENT_BOARD_INGEST_TOKEN), 'the error text never repeats the token')
  }
})

test('machine names: short lower-case names only, nothing that reads as local or as a source', () => {
  for (const ok of ['pc', 'pc-two', 'wsl2', 'a']) assert.equal(machineOk(ok), true, ok)
  for (const bad of ['', 'PC', 'local', 'localhost', 'this', 'all', 'claude', 'codex', 'gemini', '-pc', 'a b', 'a~b', 'a:b', 'x'.repeat(17), null, 5]) assert.equal(machineOk(bad), false, String(bad))
})

test('token check and bearer parsing', () => {
  assert.equal(tokenOk(TOKEN, TOKEN), true)
  assert.equal(tokenOk(TOKEN + 'x', TOKEN), false)
  assert.equal(tokenOk(TOKEN.slice(0, -1), TOKEN), false)
  assert.equal(tokenOk('', TOKEN), false)
  assert.equal(tokenOk('', ''), false)
  assert.equal(tokenOk(undefined, TOKEN), false)
  assert.equal(bearer(`Bearer ${TOKEN}`), TOKEN)
  assert.equal(bearer(`bearer   ${TOKEN}`), TOKEN)
  assert.equal(bearer(TOKEN), '')
  assert.equal(bearer(`Basic ${TOKEN}`), '')
  assert.equal(bearer(undefined), '')
})

test('rate limiter: fixed window per sender, bounded memory', () => {
  const l = createLimiter({ max: 3, windowMs: 1000, maxKeys: 2 })
  assert.deepEqual([1, 2, 3, 4].map(() => l.take('a', 0)), [true, true, true, false])
  assert.equal(l.take('b', 10), true, 'another sender has its own budget')
  assert.equal(l.take('c', 20), false, 'a third sender does not fit while both windows are open')
  assert.equal(l.take('a', 1000), true, 'new window')
  assert.equal(l.take('c', 1500), true, 'expired senders make room')
  assert.ok(l.size() <= 2)
})

// ---------- fields ----------
test('cleanEvent keeps exactly the known fields, with types and lengths checked', () => {
  const out = cleanEvent({
    t: 1700000000000.7, ev: 'PostToolUseFailure', sid: 'abcd1234', aid: 'agent-1', tid: 'AbC123',
    at: 'Explore', proj: '/home/someone/secret-project', src: 'codex', tool: 'Bash', what: 'curl -H "Authorization: Bearer abcdefghijklmnop" x',
    todos: { done: 2.9, progress: '1', open: 1e9, extra: 'x' }, ok: false, len: 12, msg: 'word '.repeat(60), nt: 'idle_prompt', dur: 1234.5, err: 'rate_limit', trig: 'auto', task: 'Fix it',
    machine: 'local', prompt: 'never', cwd: '/home/someone', transcript_path: '/x', __proto__: { evil: 1 }, extra: { a: 1 },
  })
  assert.deepEqual(Object.keys(out).sort(), ['aid', 'at', 'dur', 'err', 'ev', 'len', 'msg', 'nt', 'ok', 'proj', 'sid', 'src', 't', 'task', 'tid', 'todos', 'tool', 'trig', 'what'])
  for (const k of Object.keys(out)) assert.ok(EVENT_FIELDS.includes(k), k)
  assert.equal(out.t, 1700000000000)
  assert.equal(out.proj, 'secret-project', 'only the last path part')
  assert.ok(!out.what.includes('abcdefghijklmnop'), 'secrets are redacted again')
  assert.deepEqual(out.todos, { done: 2, progress: 0, open: 500 })
  assert.equal(out.msg.length, 80)
  assert.equal(out.dur, 1234)
  assert.equal(out.machine, undefined)
})

test('cleanEvent drops wrong types instead of converting them', () => {
  const out = cleanEvent({ t: Date.now(), ev: 'PreToolUse', sid: 'abcd1234', tool: { a: 1 }, what: ['x'], ok: true, len: -1, dur: 'fast', src: 'local', nt: 7, msg: null, at: '   ' })
  assert.deepEqual(Object.keys(out).sort(), ['ev', 'sid', 't'])
})

test('cleanEvent removes control and direction characters and Windows paths', () => {
  const out = cleanEvent(ev({ what: 'a\u0000b\nc\u202Ed\u2028e', proj: 'C:\\Users\\someone\\my-app', msg: '\u001b[31mred' }))
  assert.equal(out.what, 'a b c d e')
  assert.equal(out.proj, 'my-app')
  assert.ok(!/[\u0000-\u001f]/.test(out.msg))
})

test('cleanEvent rejects events without usable t, ev or ids', () => {
  for (const bad of [
    null, 'x', [], {}, ev({ t: '1700000000000' }), ev({ t: NaN }), ev({ t: -5 }), ev({ ev: '__reset' }), ev({ ev: '__end' }), ev({ ev: 'x' }), ev({ ev: 5 }), ev({ ev: 'Pre Tool' }),
    ev({ sid: '' }), ev({ sid: 'abcd12345' }), ev({ sid: 'ab cd' }), ev({ sid: 'pc~abcd' }), ev({ sid: 'a:b' }), ev({ sid: 12345678 }), ev({ sid: undefined }),
    ev({ aid: 'x'.repeat(25) }), ev({ aid: 'a b' }), ev({ aid: 'claude:abcd1234' }), ev({ aid: 7 }),
  ]) assert.equal(cleanEvent(bad), null, JSON.stringify(bad))
  assert.equal(cleanEvent(ev({ tid: 'bad tid!' })).tid, undefined, 'a bad tid only drops the field')
})

test('a real collector record passes the field check unchanged (same field list as local events)', () => {
  const rec = reduce({ hook_event_name: 'PostToolUse', session_id: 'abcd1234-ffff', cwd: '/tmp/demo-proj', tool_name: 'TodoWrite', tool_input: { todos: [{ status: 'completed' }, { status: 'pending' }] }, tool_use_id: 'toolu_01ABCdef', duration_ms: 12 })
  const { aid, at, what, ...rest } = rec // the collector writes aid/at as null on the main agent, and an empty `what`
  assert.equal(aid, null); assert.equal(at, null); assert.equal(what, '')
  assert.deepEqual(cleanEvent(rec), rest)
})

test('stampEvent: machine comes from the server, ids get its namespace, time is bounded', () => {
  const now = 1700000100000
  const r = stampEvent(ev({ t: now - 5000, aid: 'agent-1', tid: 'T1', machine: 'local' }), 'pc-two', now)
  assert.equal(r.machine, 'pc-two')
  assert.equal(r.sid, 'pc-two~abcd1234')
  assert.equal(r.aid, 'pc-two~agent-1')
  assert.equal(r.tid, 'pc-two~T1')
  assert.equal(r.t, now - 5000)
  assert.equal(stampEvent(ev({ t: now + 999999 }), 'pc-two', now).t, now, 'a clock that runs ahead is capped')
  assert.equal(stampEvent(ev({ t: now - LIMITS.maxAgeMs - 1 }), 'pc-two', now), null, 'too old')
  for (const bad of ['local', '', 'PC', 'a~b', undefined]) assert.equal(stampEvent(ev({ t: now }), bad, now), null, String(bad))
})

// ---------- the real server with a token ----------
test('server: wrong or missing token is 401 and writes nothing', async () => {
  for (const token of ['', 'wrong', TOKEN + 'x', TOKEN.slice(1)]) {
    const r = await call(port, { token, body: { events: [ev()] } })
    assert.equal(r.status, 401, token)
  }
  assert.equal(logLines().length, 0)
})

test('server: only POST, only application/json, only allowed machine names', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(port, { method })).status, 405, method)
  assert.equal((await call(port, { type: 'text/plain', body: JSON.stringify({ events: [ev()] }) })).status, 415)
  assert.equal((await call(port, { type: '', body: JSON.stringify({ events: [ev()] }) })).status, 415)
  assert.equal((await call(port, { machine: 'other', body: { events: [ev()] } })).status, 403)
  assert.equal((await call(port, { machine: 'local', body: { events: [ev()] } })).status, 403)
  assert.equal((await call(port, { machine: '', body: { events: [ev()] } })).status, 400, 'two names are allowed, so the header is required')
  assert.equal((await call(port, { host: 'evil.example', body: { events: [ev()] } })).status, 403, 'Host check still applies')
  assert.equal(logLines().length, 0)
})

test('server: other routes stay read-only with ingest switched on', async () => {
  for (const path of ['/', '/events', '/health', '/ingest/x', '/ingest/']) assert.equal((await call(port, { path, body: { events: [ev()] } })).status, 405, path)
})

test('server: bad bodies are refused (size, JSON, shape, count)', async () => {
  assert.equal((await call(port, { body: '{"events":[' })).status, 400)
  assert.equal((await call(port, { body: '[]' })).status, 400)
  assert.equal((await call(port, { body: '{"events":"x"}' })).status, 400)
  assert.equal((await call(port, { body: { events: Array.from({ length: LIMITS.maxEvents + 1 }, () => ev()) } })).status, 413)
  const big = await call(port, { body: JSON.stringify({ events: [ev({ what: 'x'.repeat(LIMITS.maxBody) })] }) })
  assert.ok(big.status === 413 || big.status === 0, `got ${big.status}`)
  // chunked upload without Content-Length: the cap applies while reading
  const chunked = await new Promise((resolve) => {
    const q = request({ host: '127.0.0.1', port, method: 'POST', path: '/ingest', headers: { Host: `localhost:${CFG_PORT}`, Authorization: `Bearer ${TOKEN}`, 'X-Agent-Board-Machine': 'pc-two', 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode) })
    q.on('error', () => resolve(0))
    q.write('{"events":["'); q.write(Buffer.alloc(LIMITS.maxBody + 10, 97)); q.end('"]}')
  })
  assert.ok(chunked === 413 || chunked === 0, `got ${chunked}`)
  assert.equal(logLines().length, 0)
})

test('server: accepted events land in the log stamped and namespaced; a forged machine or local id has no effect', async () => {
  const r = await call(port, { body: { events: [
    ev({ sid: 'abcd1234', machine: 'local', tid: 'T1', proj: '/home/someone/app' }),
    ev({ sid: 'abcd1234', aid: 'sub-1', machine: 'laptop' }),
    ev({ sid: 'pc~abcd12' }), // tries to pick its own namespace
    ev({ ev: '__reset' }),
    'not an object',
  ] } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true, accepted: 2, dropped: 3 })
  const lines = logLines()
  assert.equal(lines.length, 2)
  for (const l of lines) {
    assert.equal(l.machine, 'pc-two')
    assert.ok(l.sid.startsWith('pc-two~'))
    for (const k of Object.keys(l)) assert.ok([...EVENT_FIELDS, 'machine'].includes(k), k)
  }
  assert.equal(lines[0].tid, 'pc-two~T1')
  assert.equal(lines[0].proj, 'app')
  assert.equal(lines[1].aid, 'pc-two~sub-1')
  // a local session with the same short id keeps its own key: remote ids always carry "<machine>~"
  assert.notEqual(lines[0].sid, 'abcd1234')
  const second = await call(port, { machine: 'LAPTOP', body: { events: [ev()] } })
  assert.equal(second.status, 200)
  assert.equal(logLines()[2].machine, 'laptop')
})

test('server: an empty batch is fine and writes nothing', async () => {
  const before = logLines().length
  const r = await call(port, { body: { events: [] } })
  assert.deepEqual(r.json, { ok: true, accepted: 0, dropped: 0 })
  assert.equal(logLines().length, before)
})

// ---------- handler alone: rate limit, single machine default, off ----------
async function withHandler(opts, fn) {
  const got = []
  const handler = createIngest({ append: (recs) => got.push(...recs), ...opts })
  const s = createServer((req, res) => handler(req, res))
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  try { await fn(s.address().port, got) } finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)) }
}

test('handler: rate limit per sender answers 429 with Retry-After, also for wrong tokens', async () => {
  await withHandler({ config: ingestConfig({ AGENT_BOARD_INGEST_TOKEN: TOKEN }), limiter: createLimiter({ max: 3, windowMs: 60000 }) }, async (p, got) => {
    assert.equal((await call(p, { token: 'wrong', machine: '', body: { events: [ev()] } })).status, 401)
    assert.equal((await call(p, { machine: '', body: { events: [ev()] } })).status, 200)
    assert.equal((await call(p, { machine: '', body: { events: [ev()] } })).status, 200)
    const r = await call(p, { machine: '', body: { events: [ev()] } })
    assert.equal(r.status, 429)
    assert.ok(Number(r.headers['retry-after']) > 0)
    assert.equal((await call(p, { token: 'wrong', machine: '', body: { events: [ev()] } })).status, 429, 'guessing tokens is limited too')
    assert.equal(got.length, 2)
    assert.equal(got[0].machine, 'remote', 'with one allowed name the header is optional')
  })
})

test('handler: switched off means 404 for every method, even with a token header', async () => {
  for (const config of [ingestConfig({}), ingestConfig({ AGENT_BOARD_INGEST_TOKEN: 'short' }), null]) {
    await withHandler({ config }, async (p, got) => {
      for (const method of ['POST', 'GET', 'PUT']) assert.equal((await call(p, { method, body: method === 'GET' ? undefined : { events: [ev()] } })).status, 404)
      assert.equal(got.length, 0)
    })
  }
})

test('handler: a failing write answers 500, not a crash', async () => {
  await withHandler({ config: ingestConfig({ AGENT_BOARD_INGEST_TOKEN: TOKEN }), append: () => { throw new Error('disk full') } }, async (p) => {
    assert.equal((await call(p, { machine: '', body: { events: [ev()] } })).status, 500)
  })
})
