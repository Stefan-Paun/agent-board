// Start errors: a taken or invalid port gives a clear message and exit code 1, no stack trace.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { request, createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const envFor = (data, port) => ({ ...process.env, AGENT_BOARD_DATA: data, AGENT_BOARD_PORT: String(port) })

async function freePort() {
  const s = createServer()
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise((r) => s.close(r))
  return port
}
async function waitForServer(port, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const ok = await new Promise((r) => {
      const q = request({ host: '127.0.0.1', port, path: '/health', headers: { Host: `localhost:${port}` } }, (res) => { res.resume(); r(true) })
      q.on('error', () => r(false)); q.end()
    })
    if (ok) return
    await sleep(100)
  }
  throw new Error(`server on port ${port} not ready`)
}
// async spawn, so the event loop keeps serving in tests that host a fake server
async function runAsync(data, port) {
  const child = spawn(process.execPath, [SERVER], { env: envFor(data, port) })
  let err = ''
  child.stderr.on('data', (c) => { err += c })
  const code = await new Promise((r) => child.on('close', r))
  return { code, err }
}

test('second board on the same port exits 1, says it is already running, no stack trace', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-start-'))
  const port = await freePort()
  const first = spawn(process.execPath, [SERVER], { env: envFor(data, port), stdio: 'ignore' })
  t.after(() => { first.kill(); rmSync(data, { recursive: true, force: true }) })
  await waitForServer(port)
  const { code, err } = await runAsync(data, port)
  assert.equal(code, 1)
  assert.match(err, new RegExp(`already running at http://localhost:${port}`))
  assert.doesNotMatch(err, /\n\s+at /)
})

test('port taken by another program: hint with AGENT_BOARD_PORT, exit 1, no stack trace', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-start-'))
  const other = createServer((req, res) => res.end('nope'))
  await new Promise((r) => other.listen(0, '127.0.0.1', r))
  t.after(() => { other.close(); rmSync(data, { recursive: true, force: true }) })
  const { code, err } = await runAsync(data, other.address().port)
  assert.equal(code, 1)
  assert.match(err, /already in use/)
  assert.match(err, /AGENT_BOARD_PORT=<port> npm start/)
  assert.match(err, /old Agent-Board may still be running/)
  assert.doesNotMatch(err, /\n\s+at /)
})

for (const bad of ['abc', '0', '70000', '12.5', '-1']) {
  test(`invalid port "${bad}" exits 1 with a message`, () => {
    const data = mkdtempSync(join(tmpdir(), 'agent-board-start-'))
    try {
      const r = spawnSync(process.execPath, [SERVER], { env: envFor(data, bad), encoding: 'utf8', timeout: 15000 })
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Invalid AGENT_BOARD_PORT/)
      assert.doesNotMatch(r.stderr, /\n\s+at /)
    } finally { rmSync(data, { recursive: true, force: true }) }
  })
}
