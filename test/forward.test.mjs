// Second machine, sender side: tools/forward.mjs follows a local log and posts new events in batches to a test
// server on a free local port. It keeps its position, backs off on errors and never sends unknown fields.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = 'test-token-0123456789-abcdefghij-XYZ' // placeholder
const root = mkdtempSync(join(tmpdir(), 'agent-board-forward-'))
process.env.AGENT_BOARD_DATA = join(root, 'default')
after(() => rmSync(root, { recursive: true, force: true }))

const { createForwarder, readBatch, backoffMs, ingestUrl, FORWARD } = await import('../tools/forward.mjs')
const { createIngest, ingestConfig, createLimiter, EVENT_FIELDS, LIMITS } = await import('../ingest.mjs')
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'forward.mjs')

let n = 0
const dir = () => { const d = join(root, `case-${++n}`); return { file: join(d, 'events.jsonl'), stateFile: join(d, 'forward-state.json'), d } }
const line = (over = {}) => JSON.stringify({ t: Date.now(), ev: 'PreToolUse', sid: 'abcd1234', aid: null, at: null, proj: 'demo', tool: 'Bash', what: 'npm test', ...over }) + '\n'

// a receiver like the real one (same handler as the server), on a free local port
async function receiver(opts = {}) {
  const got = []
  const seen = []
  let fail = opts.fail || 0 // answer this many requests with `failStatus` first
  const handler = createIngest({ config: ingestConfig({ AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_INGEST_MACHINES: 'pc-two' }), append: (recs) => got.push(...recs), limiter: createLimiter({ max: 10000 }) })
  const s = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, machine: req.headers['x-agent-board-machine'], type: req.headers['content-type'] })
    if (fail > 0) { fail--; req.resume(); res.writeHead(opts.failStatus || 503).end(); return }
    handler(req, res)
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  return { got, seen, url: ingestUrl(`http://127.0.0.1:${s.address().port}`), close: () => { s.closeAllConnections?.(); return new Promise((r) => s.close(r)) } }
}

const fresh = (text = '') => { const c = dir(); mkdirSync(c.d, { recursive: true }); writeFileSync(c.file, text); return c }

test('ingestUrl: http(s) only, no credentials, always /ingest', () => {
  assert.equal(ingestUrl('http://board.example:4777').href, 'http://board.example:4777/ingest')
  assert.equal(ingestUrl('https://board.example/some/path?x=1').href, 'https://board.example/ingest')
  for (const bad of ['', 'board.example:4777', 'ftp://board.example', 'file:///etc/passwd', 'http://user:pw@board.example', undefined]) assert.equal(ingestUrl(bad), null, String(bad))
})

test('backoff doubles from 1 s up to 60 s', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 8, 100].map((f) => backoffMs(f)), [1000, 2000, 4000, 8000, 60000, 60000, 60000])
})

test('first run starts at the end of the log, then sends only new events', async () => {
  const c = fresh(line({ what: 'old one' }) + line({ what: 'old two' }))
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN, machine: 'pc-two' })
    assert.deepEqual(await fw.step(), { sent: 0, status: 200, idle: true, retry: false })
    appendFileSync(c.file, line({ what: 'new one', tid: 'T1' }) + line({ ev: 'PostToolUse', what: 'new one', tid: 'T1', dur: 5 }))
    const r = await fw.step()
    assert.equal(r.sent, 2)
    assert.deepEqual(rx.got.map((e) => e.what), ['new one', 'new one'])
    assert.equal(rx.got[0].machine, 'pc-two')
    assert.equal(rx.got[0].sid, 'pc-two~abcd1234')
    assert.equal(rx.seen[0].machine, 'pc-two')
    assert.equal(rx.seen[0].url, '/ingest')
    assert.match(rx.seen[0].type, /^application\/json/)
    assert.equal((await fw.step()).idle, true)
    assert.equal(rx.seen.length, 1, 'nothing new, no request')
  } finally { await rx.close() }
})

test('--from-start sends what is already there; a half-written last line waits', async () => {
  const c = fresh(line({ what: 'one' }) + line({ what: 'two' }) + '{"t":1,"ev":"PreTool')
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN, fromStart: true })
    assert.equal((await fw.step()).sent, 2)
    assert.equal((await fw.step()).idle, true)
    appendFileSync(c.file, 'Use","sid":"abcd1234"}\n')
    await fw.step() // the completed line is too old (t = 1) and is skipped, but consumed
    assert.equal(rx.got.length, 2)
    assert.equal(fw.state().offset, readFileSync(c.file).length)
  } finally { await rx.close() }
})

test('only fields from the field list leave the machine: no paths, no prompt text, no foreign events', async () => {
  const c = fresh()
  const rx = await receiver()
  const bodies = []
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN, send: async (url, token, machine, events) => { bodies.push(JSON.stringify(events)); return { status: 200 } } })
    appendFileSync(c.file,
      line({ proj: '/home/someone/private/app', prompt: 'my secret prompt', cwd: '/home/someone/private', transcript_path: '/home/someone/x.jsonl', extra: { deep: 'PRIVATE' } })
      + line({ machine: 'laptop', sid: 'laptop~x' }) // already came from another machine: never forwarded
      + 'not json\n'
      + line({ ev: 'UserPromptSubmit', len: 42, tool: undefined, what: undefined }))
    const r = await fw.step()
    assert.equal(r.sent, 2)
    const sent = JSON.parse(bodies[0])
    for (const e of sent) for (const k of Object.keys(e)) assert.ok(EVENT_FIELDS.includes(k), k)
    assert.ok(!bodies[0].includes('someone'))
    assert.ok(!bodies[0].includes('secret prompt'))
    assert.ok(!bodies[0].includes('PRIVATE'))
    assert.ok(!bodies[0].includes('laptop'))
    assert.equal(sent[0].proj, 'app')
    assert.equal(sent[1].len, 42)
  } finally { await rx.close() }
})

test('batches: at most 50 events and under the size cap per request, in order', async () => {
  const c = fresh()
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    appendFileSync(c.file, Array.from({ length: 120 }, (_, i) => line({ what: `cmd ${i}` })).join(''))
    const sizes = []
    for (;;) { const r = await fw.step(); if (r.idle) break; sizes.push(r.sent) }
    assert.deepEqual(sizes, [50, 50, 20])
    assert.deepEqual(rx.got.map((e) => e.what), Array.from({ length: 120 }, (_, i) => `cmd ${i}`))
    const b = readBatch(c.file, { offset: 0, last: null, lastEnd: 0 }, Date.now(), { ...FORWARD, maxBytes: 300 })
    assert.ok(b.events.length >= 1 && b.events.length < 5, `size cap cuts the batch (${b.events.length})`)
    assert.ok(LIMITS.maxEvents === FORWARD.maxEvents && FORWARD.maxBytes < LIMITS.maxBody)
  } finally { await rx.close() }
})

test('a failed request keeps the position and the same batch is sent again', async () => {
  const c = fresh()
  const rx = await receiver({ fail: 2, failStatus: 503 })
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    appendFileSync(c.file, line({ what: 'keep me' }))
    const before = fw.state()
    assert.deepEqual(await fw.step(), { sent: 0, status: 503, idle: false, retry: true })
    assert.deepEqual(await fw.step(), { sent: 0, status: 503, idle: false, retry: true })
    assert.deepEqual(fw.state(), before)
    assert.equal((await fw.step()).sent, 1)
    assert.deepEqual(rx.got.map((e) => e.what), ['keep me'])
  } finally { await rx.close() }
})

test('receiver not reachable: retry, nothing lost', async () => {
  const c = fresh()
  const rx = await receiver()
  const deadUrl = rx.url
  await rx.close()
  const fw = createForwarder({ ...c, url: deadUrl, token: TOKEN })
  appendFileSync(c.file, line())
  const r = await fw.step()
  assert.equal(r.retry, true)
  assert.equal(r.status, 0)
})

test('wrong token: 401, a hint is logged once, the position stays', async () => {
  const c = fresh()
  const rx = await receiver()
  const logs = []
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: 'wrong-token-0123456789-abcdefghij-XYZ', log: (m) => logs.push(m) })
    appendFileSync(c.file, line())
    assert.equal((await fw.step()).status, 401)
    assert.equal((await fw.step()).retry, true)
    assert.equal(logs.length, 1, 'the same hint is not repeated')
    assert.match(logs[0], /401/)
    assert.ok(!logs[0].includes('wrong-token'), 'the token is never logged')
    assert.equal(rx.got.length, 0)
  } finally { await rx.close() }
})

test('the position survives a restart and a rotated (shortened) log', async () => {
  const c = fresh()
  const rx = await receiver()
  try {
    let fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    const a = line({ what: 'a' }), b = line({ what: 'b' }), d = line({ what: 'd' }), e = line({ what: 'e' })
    appendFileSync(c.file, a + b)
    assert.equal((await fw.step()).sent, 2)
    assert.ok(existsSync(c.stateFile))
    assert.ok(!readFileSync(c.stateFile, 'utf8').includes(TOKEN))
    // restart: a new forwarder continues where the old one stopped
    appendFileSync(c.file, d)
    fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    assert.equal((await fw.step()).sent, 1)
    // rotation: the collector rewrote the file without the oldest lines, then appended
    writeFileSync(c.file, d + e)
    assert.equal((await fw.step()).sent, 1)
    // rotation that removed the last sent line too: start over at the top of the (short) file
    const f = line({ what: 'f' })
    writeFileSync(c.file, f)
    assert.equal((await fw.step()).sent, 1)
    assert.deepEqual(rx.got.map((x) => x.what), ['a', 'b', 'd', 'e', 'f'])
  } finally { await rx.close() }
})

test('events older than the receiver accepts are skipped, not retried forever', async () => {
  const c = fresh()
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    appendFileSync(c.file, line({ t: Date.now() - LIMITS.maxAgeMs - 60000, what: 'stale' }) + line({ what: 'fresh' }))
    assert.equal((await fw.step()).sent, 1)
    assert.deepEqual(rx.got.map((x) => x.what), ['fresh'])
    assert.equal((await fw.step()).idle, true)
  } finally { await rx.close() }
})

test('a 400 from the board (e.g. machine name missing) keeps the events for later instead of dropping them', async () => {
  const c = fresh()
  const logs = []
  let status = 400
  const sent = []
  const fw = createForwarder({ ...c, url: ingestUrl('http://127.0.0.1:9'), token: TOKEN, log: (m) => logs.push(m), send: async (u, t, m, events) => { if (status === 200) sent.push(...events); return { status } } })
  appendFileSync(c.file, line({ what: 'one' }) + line({ what: 'two' }))
  const before = fw.state()
  assert.deepEqual(await fw.step(), { sent: 0, status: 400, idle: false, retry: true })
  assert.deepEqual(fw.state(), before)
  assert.match(logs[0], /AGENT_BOARD_MACHINE/)
  status = 200
  assert.equal((await fw.step()).sent, 2)
  assert.deepEqual(sent.map((e) => e.what), ['one', 'two'])
})

test('a torn line with broken UTF-8 and blank lines neither loop nor resend, and rotation is still noticed', async () => {
  const c = fresh()
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN })
    const a = line({ what: 'a' })
    appendFileSync(c.file, a)
    appendFileSync(c.file, Buffer.concat([Buffer.from('{"t":1,"what":"'), Buffer.from([0xe2, 0x82]), Buffer.from('\n')])) // cut inside a multi-byte character
    appendFileSync(c.file, '\n\n')
    const sizes = []
    for (let i = 0; i < 6; i++) { const r = await fw.step(); sizes.push(r.sent); if (r.idle) break }
    assert.deepEqual(sizes, [1, 0], 'sent once, then idle')
    assert.equal((await fw.step()).idle, true)
    assert.equal(fw.state().offset, readFileSync(c.file).length)
    // a restart reads the saved position (bytes survive as base64) and stays idle
    const again = createForwarder({ ...c, url: rx.url, token: TOKEN })
    assert.equal((await again.step()).idle, true)
    // rotation after blank lines: the file is rewritten shorter, the anchor line is gone -> start at the top
    const d = line({ what: 'd' })
    writeFileSync(c.file, d)
    assert.equal((await again.step()).sent, 1)
    // rotation that keeps the anchor line but moves it: continue right behind it
    const e = line({ what: 'e' }), f = line({ what: 'f' })
    writeFileSync(c.file, line({ what: 'x'.repeat(30) }) + d + '\n' + e)
    assert.equal((await again.step()).sent, 1)
    appendFileSync(c.file, f)
    assert.equal((await again.step()).sent, 1)
    assert.deepEqual(rx.got.map((x) => x.what), ['a', 'd', 'e', 'f'])
  } finally { await rx.close() }
})

test('rotation by the real collector (trimLines): the sender continues behind its last line', async () => {
  const { trimLines } = await import('../collector.mjs')
  const c = fresh()
  const rx = await receiver()
  try {
    const fw = createForwarder({ ...c, url: rx.url, token: TOKEN, fromStart: true })
    const old = Array.from({ length: 1600 }, (_, i) => line({ t: Date.now() - 60 * 3600e3, what: `old ${i}` })).join('')
    appendFileSync(c.file, old + line({ what: 'seen' }))
    while (!(await fw.step()).idle) { /* consume */ }
    assert.deepEqual(rx.got.map((x) => x.what), ['seen'])
    const kept = trimLines(readFileSync(c.file, 'utf8').split('\n').filter(Boolean))
    assert.ok(kept.length < 1601)
    writeFileSync(c.file, kept.join('\n') + '\n' + line({ what: 'after rotation' }))
    assert.equal((await fw.step()).sent, 1)
    assert.deepEqual(rx.got.map((x) => x.what), ['seen', 'after rotation'])
  } finally { await rx.close() }
})

// ---------- the script itself ----------
function run(env, args = ['--once']) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, AGENT_BOARD_FORWARD_URL: '', AGENT_BOARD_INGEST_TOKEN: '', AGENT_BOARD_MACHINE: '', ...env } })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve({ code, err }))
  })
}

test('script: --once --from-start sends the log to the test server and exits 0', async () => {
  const c = fresh(line({ what: 'from the script' }))
  const rx = await receiver()
  try {
    const r = await run({ AGENT_BOARD_DATA: c.d, AGENT_BOARD_FORWARD_URL: rx.url.origin, AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_MACHINE: 'pc-two' }, ['--once', '--from-start'])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(rx.got.map((x) => x.what), ['from the script'])
    assert.ok(!r.err.includes(TOKEN))
  } finally { await rx.close() }
})

test('script: missing or bad settings give a clear message and exit 1', async () => {
  const c = fresh()
  const base = { AGENT_BOARD_DATA: c.d }
  let r = await run(base)
  assert.equal(r.code, 1); assert.match(r.err, /AGENT_BOARD_FORWARD_URL/)
  r = await run({ ...base, AGENT_BOARD_FORWARD_URL: 'http://127.0.0.1:9', AGENT_BOARD_INGEST_TOKEN: 'short' })
  assert.equal(r.code, 1); assert.match(r.err, /AGENT_BOARD_INGEST_TOKEN/)
  r = await run({ ...base, AGENT_BOARD_FORWARD_URL: 'http://127.0.0.1:9', AGENT_BOARD_INGEST_TOKEN: TOKEN, AGENT_BOARD_MACHINE: 'Not OK!' })
  assert.equal(r.code, 1); assert.match(r.err, /AGENT_BOARD_MACHINE/)
})
