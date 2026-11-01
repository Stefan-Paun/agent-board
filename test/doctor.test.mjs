import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { doctor, formatDoctor, apply, samePath, ago } from '../install.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const tmpHome = () => mkdtempSync(join(tmpdir(), 'ab-doctor-'))
const byId = (r, id) => r.find((x) => x.id === id)
// freier Port: kurz einen Server auf Port 0 oeffnen und wieder schliessen
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const writeSettings = (home, codex = false) => {
  const file = codex ? join(home, '.codex', 'hooks.json') : join(home, '.claude', 'settings.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(apply({}, ROOT, { codex })))
  return file
}
const opts = (home, extra = {}) => ({ home, env: {}, port: 1, isPortFree: async () => true, fetchFn: async () => { throw new Error('down') }, ...extra })

test('ohne Hooks: Hooks-Pruefung schlaegt fehl, mit Fix-Hinweis; Codex wird nicht gemeldet', async () => {
  const home = tmpHome()
  const r = await doctor(opts(home))
  assert.equal(byId(r, 'hooks').ok, false)
  assert.match(byId(r, 'hooks').hint, /node install\.mjs/)
  assert.equal(byId(r, 'codex'), undefined)
  assert.match(formatDoctor(r), /\u2717 Claude Code hooks not found/)
})

test('mit installierten Hooks: Hooks ok; Codex nur wenn konfiguriert', async () => {
  const home = tmpHome()
  writeSettings(home)
  let r = await doctor(opts(home))
  assert.equal(byId(r, 'hooks').ok, true)
  assert.equal(byId(r, 'hooks').hint, undefined)
  assert.equal(byId(r, 'codex'), undefined)
  writeSettings(home, true)
  r = await doctor(opts(home))
  assert.equal(byId(r, 'codex').ok, true)
})

test('Hooks zeigen auf eine nicht mehr vorhandene collector.mjs -> Fehler', async () => {
  const home = tmpHome()
  const file = join(home, '.claude', 'settings.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(apply({}, join(home, 'geloescht'))))
  const r = await doctor(opts(home))
  assert.equal(byId(r, 'hooks').ok, false)
  assert.match(byId(r, 'hooks').label, /missing file/)
})

test('kaputte settings.json und fehlende Ereignisse werden gemeldet', async () => {
  const home = tmpHome()
  const file = join(home, '.claude', 'settings.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{ kaputt')
  assert.match(byId(await doctor(opts(home)), 'hooks').label, /not valid JSON/)
  const partial = apply({}, ROOT)
  delete partial.hooks.Stop
  writeFileSync(file, JSON.stringify(partial))
  assert.match(byId(await doctor(opts(home)), 'hooks').label, /1 of 17 events missing \(Stop\)/)
})

test('Datenordner: beschreibbar ok, Testdatei bleibt nicht liegen', async () => {
  const home = tmpHome()
  const r = await doctor(opts(home))
  assert.equal(byId(r, 'data').ok, true)
  assert.match(byId(r, 'data').label, /writable/)
})

test('Datenordner nicht beschreibbar -> Fehler mit Hinweis (nicht unter Windows/als root)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const home = tmpHome()
  const dataDir = join(home, 'ro')
  mkdirSync(dataDir)
  chmodSync(dataDir, 0o500)
  try {
    const d = byId(await doctor(opts(home, { dataDir })), 'data')
    assert.equal(d.ok, false)
    assert.match(d.hint, /AGENT_BOARD_DATA/)
  } finally { chmodSync(dataDir, 0o700); rmSync(home, { recursive: true, force: true }) }
})

test('AGENT_BOARD_DATA aus env wird beruecksichtigt', async () => {
  const home = tmpHome(), dataDir = join(home, 'eigener ordner')
  const r = await doctor(opts(home, { env: { AGENT_BOARD_DATA: dataDir } }))
  assert.ok(byId(r, 'data').label.endsWith(dataDir))
})

test('Port: frei ok, Board laeuft ok, fremdes Programm -> Fehler', async () => {
  const home = tmpHome()
  const port = await freePort()
  const real = { fetchFn: globalThis.fetch, isPortFree: undefined }
  let r = byId(await doctor({ ...opts(home, { port }), ...real, isPortFree: undefined }), 'port')
  assert.equal(r.ok, true); assert.match(r.label, /free/)

  const board = createServer((q, s) => s.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'))
  await new Promise((ok) => board.listen(port, '127.0.0.1', ok))
  r = byId(await doctor({ ...opts(home, { port }), ...real, isPortFree: undefined }), 'port')
  assert.equal(r.ok, true); assert.match(r.label, /Server is running/)
  await new Promise((ok) => board.close(ok))

  const other = createServer((q, s) => s.writeHead(200).end('<html>nginx</html>'))
  await new Promise((ok) => other.listen(port, '127.0.0.1', ok))
  r = byId(await doctor({ ...opts(home, { port }), ...real, isPortFree: undefined }), 'port')
  await new Promise((ok) => other.close(ok))
  assert.equal(r.ok, false); assert.match(r.hint, /AGENT_BOARD_PORT/)
})

test('Port belegt, ohne HTTP-Antwort (fetch scheitert) -> Fehler', async () => {
  const r = byId(await doctor(opts(tmpHome(), { isPortFree: async () => false })), 'port')
  assert.equal(r.ok, false)
})

test('letztes Ereignis: keins = Hinweis, sonst relative Zeit', async () => {
  const home = tmpHome(), now = Date.parse('2026-01-01T12:00:00Z')
  let e = byId(await doctor(opts(home, { now })), 'events')
  assert.equal(e.ok, true); assert.match(e.label, /No events yet/); assert.ok(e.hint)
  const dir = join(home, '.local', 'share', 'agent-board')
  writeFileSync(join(dir, 'events.jsonl'), `{"t":${now - 3_600_000},"ev":"Stop"}\n{"t":${now - 180_000},"ev":"Stop"}\n{"t":12`)
  e = byId(await doctor(opts(home, { now })), 'events')
  assert.equal(e.label, 'Last event 3 min ago')
  assert.equal(ago(5000), '5 s ago'); assert.equal(ago(2 * 3600_000), '2 h ago'); assert.equal(ago(3 * 86400_000), '3 d ago')
})

test('Node-Version unter 20 -> Fehler', async () => {
  const r = await doctor(opts(tmpHome(), { nodeVersion: '18.19.0' }))
  assert.equal(byId(r, 'node').ok, false)
  assert.equal(byId(await doctor(opts(tmpHome(), { nodeVersion: '20.0.0' })), 'node').ok, true)
})

test('Pfadvergleich: Windows-Schreibweisen und Gross-/Kleinschreibung', () => {
  assert.equal(samePath('/a/b/../c', '/a/c'), true)
  assert.equal(samePath('C:\\Users\\Max\\ab', 'c:/users/max/ab/', 'win32'), true)
  assert.equal(samePath('/a/B', '/a/b', 'linux'), false)
})

test('CLI: --doctor mit leerem HOME endet mit Exit-Code 1 und zeigt Fix-Hinweis', () => {
  const home = tmpHome()
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_BOARD_PORT: '1' }
  delete env.CODEX_HOME; delete env.AGENT_BOARD_DATA
  const r = spawnSync(process.execPath, [join(ROOT, 'install.mjs'), '--doctor'], { env, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /\u2717 Claude Code hooks not found/)
  assert.match(r.stdout, /Fix: Run: node install\.mjs/)
})

test('CLI: --doctor mit Hooks, Datenordner und Port ok endet mit Exit-Code 0', async () => {
  const home = tmpHome()
  writeSettings(home)
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_BOARD_PORT: String(await freePort()) }
  delete env.CODEX_HOME; delete env.AGENT_BOARD_DATA
  const r = spawnSync(process.execPath, [join(ROOT, 'install.mjs'), '--doctor'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /All good/)
})
