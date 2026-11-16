// Leerlauf-Limit (public/idle-logic.js): Env-Parsing, Ablauf mit festem "Jetzt", Server meldet idleMinutes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = {}
vm.runInNewContext(readFileSync(join(PUB, 'idle-logic.js'), 'utf8'), ctx)
const I = ctx.AgentBoardIdle

test('parseMinutes: Standard 45, gueltige ganze Minuten, Muell faellt zurueck', () => {
  assert.equal(I.parseMinutes(undefined), 45)
  assert.equal(I.parseMinutes(''), 45)
  assert.equal(I.parseMinutes('90'), 90)
  assert.equal(I.parseMinutes(1), 1)
  for (const bad of ['abc', '0', '-5', '2.5', '1441', 'NaN', null]) assert.equal(I.parseMinutes(bad), 45, String(bad))
})

test('isExpired mit festem Jetzt', () => {
  const now = 1_000_000_000
  assert.equal(I.isExpired(now - 44 * 60000, now), false)
  assert.equal(I.isExpired(now - 46 * 60000, now), true)
  assert.equal(I.isExpired(now - 46 * 60000, now, 90), false)
  assert.equal(I.isExpired(now - 5 * 60000, now, 2), true)
})

test('agoParts', () => {
  assert.deepEqual({ ...I.agoParts(2000) }, { unit: 'now', n: 0 })
  assert.deepEqual({ ...I.agoParts(30000) }, { unit: 's', n: 30 })
  assert.deepEqual({ ...I.agoParts(12 * 60000) }, { unit: 'min', n: 12 })
  assert.deepEqual({ ...I.agoParts(3 * 3600e3) }, { unit: 'h', n: 3 })
  assert.deepEqual({ ...I.agoParts(2 * 86400e3) }, { unit: 'd', n: 2 })
})

test('Einbindung: index.html vor app.js, Service Worker', () => {
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  assert.ok(html.indexOf('idle-logic.js') > -1 && html.indexOf('idle-logic.js') < html.indexOf('src="app.js"'))
  assert.match(readFileSync(join(PUB, 'sw.js'), 'utf8'), /'idle-logic\.js'/)
})

test('Server meldet idleMinutes in /health', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawn } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'ab-idle-'))
  const run = (val) => new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000)
    const p = spawn(process.execPath, [join(PUB, '..', 'server.mjs')], { env: { ...process.env, AGENT_BOARD_PORT: String(port), AGENT_BOARD_DATA: dir, AGENT_BOARD_IDLE_MINUTES: val }, stdio: 'ignore' })
    const t0 = Date.now()
    const poll = async () => {
      try { const j = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); p.kill(); resolve(j.idleMinutes) }
      catch { if (Date.now() - t0 > 8000) { p.kill(); reject(new Error('Server startet nicht')) } else setTimeout(poll, 100) }
    }
    poll()
  })
  try {
    assert.equal(await run('90'), 90)
    assert.equal(await run('abc'), 45)
  } finally { (await import('node:fs')).rmSync(dir, { recursive: true, force: true }) }
})
