// Real HTTP requests against the real server: only public/ is served, Host is checked, bad input never crashes it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CFG_PORT = 47000 + Math.floor(Math.random() * 1000) // the port the server believes it has (Host check)
const dataDir = mkdtempSync(join(tmpdir(), 'agent-board-http-'))
process.env.AGENT_BOARD_DATA = dataDir
process.env.AGENT_BOARD_PORT = String(CFG_PORT)
delete process.env.AGENT_BOARD_BIND
delete process.env.AGENT_BOARD_HOSTS
delete process.env.AGENT_BOARD_ALLOW_HOST

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

// raw socket so the request line is sent byte for byte (no client-side path normalisation)
function raw(requestText) {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => s.write(requestText))
    let buf = ''
    s.setEncoding('utf8')
    s.on('data', (d) => { buf += d })
    s.on('error', reject)
    s.on('close', () => {
      const [head, ...rest] = buf.split('\r\n\r\n')
      const lines = head.split('\r\n')
      const headers = {}
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim() }
      resolve({ status: Number(lines[0].split(' ')[1]), headers, body: rest.join('\r\n\r\n') })
    })
    setTimeout(() => s.destroy(), 3000)
  })
}
const get = (path, host = `localhost:${CFG_PORT}`) => raw(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)

for (const path of ['/', '/app.js']) {
  test(`${path} is served with CSP and nosniff`, async () => {
    const r = await get(path)
    assert.equal(r.status, 200)
    assert.match(r.headers['content-security-policy'], /default-src 'self'/)
    assert.equal(r.headers['x-content-type-options'], 'nosniff')
  })
}

for (const path of [
  '/../server.mjs', '/%2e%2e/server.mjs', '/%2E%2E/server.mjs', '/..%5Cserver.mjs', '/..%5c..%5cserver.mjs',
  '//etc/passwd', '/fx/../../package.json', '/fx/%2e%2e/%2e%2e/package.json', '/fx%2f..%2f..%2fpackage.json',
  '/%00', '/app.js%00.png', '/fx/', '/fx', '/nope.js',
]) {
  test(`hostile path ${path} is rejected`, async () => {
    const r = await get(path)
    assert.ok([400, 403, 404].includes(r.status), `status ${r.status}`)
    assert.ok(!r.body.includes('createServer'), 'must not leak server source')
    assert.ok(!r.body.includes('"scripts"'), 'must not leak package.json')
  })
}

test('foreign Host header gets 403', async () => {
  assert.equal((await get('/', 'evil.example')).status, 403)
  assert.equal((await get('/', `evil.example:${CFG_PORT}`)).status, 403)
})

test('malformed request line gets 400 and the server survives', async () => {
  const r = await raw('GARBAGE\r\n\r\n')
  assert.equal(r.status, 400)
  assert.equal((await get('/')).status, 200)
})
