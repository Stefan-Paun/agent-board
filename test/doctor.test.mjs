import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { spawnSync, spawn } from 'node:child_process'
import { apply, EVENTS, GEMINI_EVENTS } from '../install.mjs'
import { diagnose, runDoctor, collectorPath, humanAge, format } from '../doctor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = 1_000_000_000_000
const up = async () => ({ up: true, health: null })
const down = async () => ({ up: false, error: 'ECONNREFUSED' })

// Temporaeres HOME mit Einstellungen und Datenordner; fasst nie das echte ~/.claude an
function sandbox({ settings, dir = ROOT, data = true, eventAgeMs, plugin } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ab-doctor-'))
  const settingsFile = join(home, '.claude', 'settings.json')
  mkdirSync(dirname(settingsFile), { recursive: true })
  if (settings !== null) writeFileSync(settingsFile, JSON.stringify(settings === undefined ? apply({}, dir) : settings))
  const dataDir = join(home, 'data')
  if (data) {
    mkdirSync(dataDir)
    if (eventAgeMs != null) writeFileSync(join(dataDir, 'events.jsonl'), JSON.stringify({ t: NOW - eventAgeMs, type: 'Stop' }) + '\n')
  }
  if (plugin) {
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'agent-board@agent-board': [{}] } }))
  }
  return { home, settingsFile, dataDir, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}
const run = async (sb, extra = {}) => diagnose({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, port: 4777, now: NOW, nodeVersion: '22.1.0', events: EVENTS, probe: up, env: {}, ...extra })
const by = (res, label) => res.find((r) => r.label === label)

test('alles in Ordnung: nur ok, Exit-Code 0', async () => {
  const sb = sandbox({ eventAgeMs: 5000 })
  const res = await run(sb)
  assert.deepEqual(res.map((r) => r.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
  assert.match(by(res, 'Last event').detail, /^5s ago/)
  const r = await runDoctor({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, now: NOW, events: EVENTS, probe: up, env: {} })
  assert.equal(r.code, 0)
  assert.match(r.text, /✓ Node.js version/)
  sb.cleanup()
})

test('Node unter 20 schlaegt fehl', async () => {
  const sb = sandbox({ eventAgeMs: 1 })
  const n = by(await run(sb, { nodeVersion: '18.19.0' }), 'Node.js version')
  assert.equal(n.status, 'fail'); assert.ok(n.hint)
  sb.cleanup()
})

test('Einstellungsdatei fehlt oder ist kein JSON', async () => {
  let sb = sandbox({ settings: null })
  let h = by(await run(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.hint, /node install\.mjs/)
  sb.cleanup()
  sb = sandbox({ settings: undefined })
  writeFileSync(sb.settingsFile, '{ kaputt')
  h = by(await run(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.detail, /not valid JSON/)
  sb.cleanup()
})

test('Hooks zeigen auf eine nicht mehr vorhandene collector.mjs', async () => {
  const sb = sandbox({ settings: apply({}, join(tmpdir(), 'gibt-es-nicht')) })
  const h = by(await run(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.detail, /collector\.mjs not found/)
  sb.cleanup()
})

test('fehlende Ereignisse und Fremd-Hooks ohne unsere Markierung', async () => {
  const s = apply({}, ROOT)
  delete s.hooks.Stop
  let sb = sandbox({ settings: s })
  const h = by(await run(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.detail, /16\/17.*Stop/)
  sb.cleanup()
  sb = sandbox({ settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/x/collector.mjs"' }] }] } } })
  assert.equal(by(await run(sb), 'Hooks installed').status, 'fail')
  sb.cleanup()
})

test('Plugin erkannt: ohne Installer-Hooks ok, mit Installer-Hooks Warnung (Exit 0)', async () => {
  let sb = sandbox({ settings: {}, plugin: true, eventAgeMs: 1 })
  let res = await run(sb)
  assert.equal(by(res, 'Hooks installed').status, 'ok')
  assert.equal(by(res, 'Plugin variant').status, 'ok')
  sb.cleanup()
  sb = sandbox({ plugin: true, eventAgeMs: 1 })
  res = await run(sb)
  assert.equal(by(res, 'Plugin variant').status, 'warn')
  assert.match(by(res, 'Plugin variant').detail, /twice/)
  assert.equal((await runDoctor({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, events: EVENTS, probe: up, env: {} })).code, 0)
  sb.cleanup()
  // enabledPlugins in settings.json zaehlt auch; false = abgeschaltet
  const s = apply({}, ROOT); s.enabledPlugins = { 'agent-board@agent-board': true }
  sb = sandbox({ settings: s, eventAgeMs: 1 })
  assert.equal(by(await run(sb), 'Plugin variant').status, 'warn')
  s.enabledPlugins['agent-board@agent-board'] = false
  writeFileSync(sb.settingsFile, JSON.stringify(s))
  assert.equal(by(await run(sb), 'Plugin variant').status, 'ok')
  sb.cleanup()
})

test('Datenordner: fehlt (wird angelegt) oder nicht beschreibbar', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  let sb = sandbox({ data: false })
  let d = by(await run(sb), 'Data folder writable')
  assert.equal(d.status, 'ok'); assert.match(d.detail, /will be created/)
  sb.cleanup()
  sb = sandbox({ eventAgeMs: 1 })
  chmodSync(sb.dataDir, 0o500)
  d = by(await run(sb), 'Data folder writable')
  assert.equal(d.status, 'fail'); assert.match(d.hint, /AGENT_BOARD_DATA/)
  chmodSync(sb.dataDir, 0o700)
  chmodSync(join(sb.dataDir, 'events.jsonl'), 0o400)
  d = by(await run(sb), 'Data folder writable')
  assert.equal(d.status, 'fail'); assert.match(d.detail, /events\.jsonl/)
  sb.cleanup()
})

test('Server nicht erreichbar -> fail, Exit-Code 1', async () => {
  const sb = sandbox({ eventAgeMs: 1 })
  const s = by(await run(sb, { probe: down }), 'Server running')
  assert.equal(s.status, 'fail'); assert.match(s.hint, /npm start/)
  const r = await runDoctor({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, events: EVENTS, probe: down, env: {} })
  assert.equal(r.code, 1); assert.match(r.text, /✗ Server running/)
  sb.cleanup()
})

test('echter HTTP-Check: Port aus AGENT_BOARD_PORT, /health liefert lastEventAt', async () => {
  const srv = createServer((req, res) => res.end(JSON.stringify({ ok: true, lastEventAt: NOW - 1000 })))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const sb = sandbox({ eventAgeMs: 500_000 }) // Datei waere aelter; /health gewinnt
  const res = await diagnose({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, now: NOW, events: EVENTS, env: { AGENT_BOARD_PORT: String(port) } })
  assert.equal(by(res, 'Server running').status, 'ok')
  assert.equal(by(res, 'Last event').detail, '1s ago')
  const free = srv.address().port
  await new Promise((r) => srv.close(r))
  const res2 = await diagnose({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, now: NOW, events: EVENTS, env: { AGENT_BOARD_PORT: String(free) } })
  assert.equal(by(res2, 'Server running').status, 'fail')
  sb.cleanup()
})

test('letztes Ereignis: keine Datei, zu alt', async () => {
  let sb = sandbox()
  assert.equal(by(await run(sb), 'Last event').status, 'warn')
  sb.cleanup()
  sb = sandbox({ eventAgeMs: 3 * 86400e3 })
  const l = by(await run(sb, { now: NOW }), 'Last event')
  assert.equal(l.status, 'warn'); assert.match(l.detail, /3 d ago/)
  sb.cleanup()
})

test('Hilfsfunktionen: Windows-Pfade, Alter, Ausgabe', () => {
  assert.equal(collectorPath('node "C:/Users/Max Muster/agent-board/collector.mjs" --agent-board'), 'C:/Users/Max Muster/agent-board/collector.mjs')
  assert.equal(collectorPath('node "/a\\$b/collector.mjs" --agent-board'), '/a$b/collector.mjs')
  assert.equal(collectorPath('node "/a/collector.mjs"'), null)
  assert.equal(collectorPath('node "/a/statusline.mjs" --agent-board'), null)
  assert.equal(collectorPath(undefined), null)
  assert.deepEqual([humanAge(5000), humanAge(10 * 60e3), humanAge(5 * 3600e3), humanAge(3 * 86400e3)], ['5s', '10 min', '5 h', '3 d'])
  assert.match(format([{ status: 'fail', label: 'X', detail: 'd', hint: 'h' }]), /✗ X: d\n {4}-> h\n\n1 problem found\./)
})

test('CLI: --doctor mit temporaerem HOME ohne laufenden Server gibt Exit-Code 1', async () => {
  const tmp = createServer()
  await new Promise((r) => tmp.listen(0, '127.0.0.1', r))
  const port = tmp.address().port
  await new Promise((r) => tmp.close(r))
  const sb = sandbox({ eventAgeMs: 1 })
  const env = { ...process.env, HOME: sb.home, USERPROFILE: sb.home, AGENT_BOARD_DATA: sb.dataDir, AGENT_BOARD_PORT: String(port) }
  const r = spawnSync(process.execPath, [join(ROOT, 'install.mjs'), '--doctor'], { env, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✓ Hooks installed/)
  assert.match(r.stdout, /✗ Server running/)
  sb.cleanup()
})

// Gemini-Sandbox: GEMINI_CLI_HOME zeigt auf das temporaere HOME; ~/.claude bleibt leer
function geminiSandbox(mutate) {
  const sb = sandbox({ settings: null, eventAgeMs: 1 })
  const file = join(sb.home, '.gemini', 'settings.json')
  mkdirSync(dirname(file), { recursive: true })
  const s = apply({}, ROOT, { gemini: true })
  if (mutate) mutate(s)
  writeFileSync(file, JSON.stringify(s))
  return sb
}
const gem = (sb) => diagnose({ home: sb.home, dataDir: sb.dataDir, now: NOW, nodeVersion: '22.1.0', events: GEMINI_EVENTS, gemini: true, probe: up, env: { GEMINI_CLI_HOME: sb.home } })

test('--gemini: liest ~/.gemini/settings.json und die Gemini-Ereignisse (ok)', async () => {
  const sb = geminiSandbox()
  const res = await gem(sb)
  assert.equal(by(res, 'Hooks installed').status, 'ok')
  assert.match(by(res, 'Hooks installed').detail, /^6 events/)
  assert.equal(by(res, 'Plugin variant'), undefined)
  assert.deepEqual(res.map((r) => r.status), ['ok', 'ok', 'ok', 'ok', 'ok'])
  sb.cleanup()
})

test('--gemini: fehlender Hook und Hinweis mit --gemini', async () => {
  let sb = geminiSandbox((s) => { delete s.hooks.BeforeTool })
  let h = by(await gem(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.detail, /5\/6.*BeforeTool/); assert.match(h.hint, /install\.mjs --gemini/)
  sb.cleanup()
  // Claude-Hooks in der Gemini-Datei zaehlen nicht
  sb = geminiSandbox((s) => { s.hooks = apply({}, ROOT).hooks })
  h = by(await gem(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.hint, /--gemini/)
  sb.cleanup()
  sb = sandbox({ settings: null })
  h = by(await gem(sb), 'Hooks installed')
  assert.equal(h.status, 'fail'); assert.match(h.detail, /\.gemini/); assert.match(h.hint, /install\.mjs --gemini/)
  sb.cleanup()
})

test('CLI: --gemini --doctor prueft die Gemini-Datei', async () => {
  const sb = geminiSandbox()
  const env = { ...process.env, HOME: sb.home, USERPROFILE: sb.home, GEMINI_CLI_HOME: sb.home, AGENT_BOARD_DATA: sb.dataDir, AGENT_BOARD_PORT: '1' }
  const r = spawnSync(process.execPath, [join(ROOT, 'install.mjs'), '--gemini', '--doctor'], { env, encoding: 'utf8' })
  assert.match(r.stdout, /✓ Hooks installed: 6 events/)
  assert.doesNotMatch(r.stdout, /Plugin variant/)
  sb.cleanup()
})

// ---------- Board: Route /doctor und Karte (#49) ----------
test('doctorReport: gleiche Punkte wie die CLI, mit id, Home als ~, ohne HTTP-Selbstabfrage', async () => {
  const { doctorReport } = await import('../server.mjs')
  const sb = sandbox({ eventAgeMs: 5000 })
  try {
    const rep = await doctorReport({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir, now: NOW })
    assert.deepEqual(rep.map((r) => r.id), ['node', 'hooks', 'plugin', 'data', 'server', 'last'])
    assert.ok(rep.every((r) => ['ok', 'warn', 'fail'].includes(r.status)))
    const data = rep.find((r) => r.id === 'data')
    assert.ok(data.detail.startsWith('~'), data.detail)
    assert.ok(!JSON.stringify(rep).includes(sb.home))
    assert.equal(rep.find((r) => r.id === 'server').status, 'ok')
  } finally { sb.cleanup() }
})

test('doctorReport: fehlende Hooks sind ein fail mit Hinweis', async () => {
  const { doctorReport } = await import('../server.mjs')
  const sb = sandbox({ settings: null })
  try {
    const rep = await doctorReport({ home: sb.home, settingsFile: sb.settingsFile, dataDir: sb.dataDir })
    const hooks = rep.find((r) => r.id === 'hooks')
    assert.equal(hooks.status, 'fail')
    assert.match(hooks.hint, /node install\.mjs/)
  } finally { sb.cleanup() }
})

test('Route /doctor liefert JSON, Karte und Texte sind verdrahtet (EN/DE/ES)', async () => {
  const sb = sandbox({ settings: null })
  const probePort = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], { stdio: 'ignore', env: { ...process.env, AGENT_BOARD_PORT: String(probePort), AGENT_BOARD_DATA: sb.dataDir, HOME: sb.home, USERPROFILE: sb.home } })
  try {
    let r
    for (let i = 0; i < 50 && !r; i++) { try { r = await fetch(`http://127.0.0.1:${probePort}/doctor`) } catch { await new Promise((x) => setTimeout(x, 100)) } }
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /json/)
    const rep = await r.json()
    assert.deepEqual(rep.map((x) => x.id), ['node', 'hooks', 'plugin', 'data', 'server', 'last'])
    assert.equal(rep.find((x) => x.id === 'hooks').status, 'fail') // leeres HOME: keine Hooks
    assert.equal(rep.find((x) => x.id === 'server').status, 'ok')
    assert.ok(!JSON.stringify(rep).includes(sb.home))
  } finally { srv.kill(); sb.cleanup() }
  const pub = join(ROOT, 'public')
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(join(pub, 'index.html'), 'utf8'), app = readFileSync(join(pub, 'app.js'), 'utf8'), i18n = readFileSync(join(pub, 'i18n.js'), 'utf8')
  assert.match(html, /id="doctor-list"/)
  assert.match(html, /id="b-doctor"/)
  assert.match(app, /fetch\('doctor'/)
  for (const k of ['title', 'refresh', 'loading', 'error', 'node', 'hooks', 'plugin', 'data', 'server', 'last', 'hint.node', 'hint.hooks', 'hint.plugin', 'hint.data', 'hint.server', 'hint.last']) {
    assert.match(i18n, new RegExp(`'doctor\\.${k.replace('.', '\\.')}': \\['[^']+', '[^']+', '[^']+'\\]`), k)
  }
})
