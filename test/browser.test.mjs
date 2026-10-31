// Browser-Smoke-Test: laedt die Oberflaeche in headless Chrome (Demo-Modus und gegen den echten Server)
// und prueft, dass sie ohne JS-Fehler rendert. Ohne Chrome oder ohne eingebautes WebSocket (Node < 22)
// werden die Tests uebersprungen. Aufruf: npm run test:browser
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChrome, openPage, waitFor } from './cdp.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = findChrome()
const skip = typeof WebSocket !== 'function' ? 'Node ohne eingebautes WebSocket (braucht Node 22+)'
  : !CHROME ? 'kein Chrome gefunden (CHROME_PATH setzen)' : false
// In der CI soll ein fehlender Chrome auffallen statt still uebersprungen zu werden
if (skip && process.env.AGENT_BOARD_REQUIRE_BROWSER) throw new Error(`Browser-Test verlangt, aber: ${skip}`)

let chrome, server, dataDir, base

// Chrome-Start mit Wiederholung: auf traegen CI-Runnern kommt der Debugport manchmal erst nach dem Timeout.
// launchChrome beendet den fehlgeschlagenen Prozess und raeumt sein Profil selbst auf, bevor es wirft.
async function startChrome(versuche = 3) {
  for (let i = 1; ; i++) {
    try { return await launchChrome(CHROME) } catch (e) {
      if (i >= versuche) throw e
      console.warn(`Chrome-Start ${i}/${versuche} fehlgeschlagen (${e.message}), neuer Versuch`)
    }
  }
}

const freePort = () => new Promise((ok, fail) => {
  const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) })
})

before(async () => {
  if (skip) return
  dataDir = mkdtempSync(join(tmpdir(), 'agent-board-browser-'))
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [join(DIR, 'server.mjs')], {
    stdio: 'ignore', env: { ...process.env, AGENT_BOARD_PORT: String(port), AGENT_BOARD_DATA: dataDir },
  })
  await waitFor(async () => (await fetch(base + '/')).ok, { timeout: 10000, what: 'Server' })
  chrome = await startChrome()
})

after(async () => {
  if (chrome) await chrome.close()
  if (server) server.kill()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

// Seite oeffnen, alle Fehler (Exceptions, console.error, Log-Fehler) mitschreiben
async function load(path) {
  const page = await openPage(chrome.port)
  const errors = []
  page.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`))
  page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`) })
  page.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(`log: ${p.entry.text} ${p.entry.url || ''}`) })
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.send('Page.enable')
  await page.send('Page.navigate', { url: base + path })
  const evaluate = async (expression) => {
    const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await waitFor(() => evaluate(`location.href.startsWith(${JSON.stringify(base)}) && document.readyState === 'complete'`), { what: 'Seite geladen' })
  return { ...page, evaluate, errors }
}

const commanders = `[...document.querySelectorAll('#crew .cc-cmd .cc-name')].map((e) => e.textContent)`
const subCards = `document.querySelectorAll('#crew .crew-card:not(.cc-cmd):not(.cc-empty)').length`
// Anzahl unterschiedlicher Farben in einer Stichprobe der Karte (leer/einfarbig = 1)
const canvasColors = `(() => {
  const c = document.getElementById('map'); if (!c || !c.width || !c.height) return 0
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set()
  for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
  return seen.size
})()`

test('Demo: Seite rendert ohne Fehler, Kommandanten und Agents erscheinen', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=en')
  try {
    assert.equal(await p.evaluate(`document.getElementById('conn').dataset.s`), 'demo')
    await waitFor(async () => (await p.evaluate(canvasColors)) > 20, { what: 'gezeichnete Karte' })
    const names = await waitFor(async () => { const n = await p.evaluate(commanders); return n.length >= 3 && n },
      { timeout: 20000, what: 'drei Kommandanten' })
    assert.deepEqual([...names].sort(), ['Claude', 'Claude 2', 'Codex'])
    await waitFor(() => p.evaluate(`${subCards} > 0`), { timeout: 20000, what: 'Subagents in der Crew-Liste' })
    assert.equal(await p.evaluate(`document.documentElement.lang.slice(0, 2)`), 'en')
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Demo: Kinomodus laesst sich ein- und ausschalten', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=en')
  try {
    await waitFor(() => p.evaluate(`!!document.getElementById('b-kino')`), { what: 'Kino-Knopf' })
    const state = `[document.body.classList.contains('abx-kino'), document.getElementById('b-kino').getAttribute('aria-pressed')]`
    assert.deepEqual(await p.evaluate(state), [false, 'false'])
    await p.evaluate(`document.getElementById('b-kino').click()`)
    assert.deepEqual(await p.evaluate(state), [true, 'true'])
    // ein paar Frames im Kinomodus laufen lassen, damit Zeichenfehler auffallen wuerden
    await p.evaluate(`new Promise((r) => { let n = 0; const f = () => (++n > 10 ? r() : requestAnimationFrame(f)); f() })`)
    await p.evaluate(`document.getElementById('b-kino').click()`)
    assert.deepEqual(await p.evaluate(state), [false, 'false'])
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Demo auf Deutsch: ?lang=de zeigt deutsche Texte', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=de')
  try {
    assert.equal(await p.evaluate(`document.documentElement.lang.slice(0, 2)`), 'de')
    assert.equal(await p.evaluate(`document.getElementById('lang').value`), 'de')
    await waitFor(() => p.evaluate(`[...document.querySelectorAll('#crew .cc-cmd .cc-role')].some((e) => e.textContent === 'Kommandant')`),
      { what: 'deutsche Rollenbezeichnung' })
    assert.equal(await p.evaluate(`document.getElementById('b-kino').textContent`), await p.evaluate(`AgentBoardI18n.table['kino.btn'][1]`))
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Echter Server: Seite verbindet sich per SSE ohne Fehler', { skip, timeout: 60000 }, async () => {
  const p = await load('/?lang=en')
  try {
    await waitFor(async () => (await p.evaluate(`document.getElementById('conn').dataset.s`)) === 'live', { what: 'Live-Verbindung' })
    await waitFor(async () => (await p.evaluate(canvasColors)) > 20, { what: 'gezeichnete Karte' })
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

// echte Tastendruecke ueber CDP (wie ein Mensch, inkl. Fokus und Capture-Handler)
const KEYS = { Escape: { code: 'Escape', windowsVirtualKeyCode: 27 }, t: { code: 'KeyT', windowsVirtualKeyCode: 84, text: 't' }, '?': { code: 'Slash', windowsVirtualKeyCode: 191, text: '?' }, c: { code: 'KeyC', windowsVirtualKeyCode: 67, text: 'c' } }
async function press(p, key) {
  const k = KEYS[key]
  await p.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', key, ...k })
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode })
}

test('Tasten: Hilfe ueber offener Tagesbilanz, Esc und T bleiben im richtigen Zustand (#14)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&lang=en')
  try {
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-day-btn')`), { what: 'Heute-Knopf' })
    const st = `[!!document.querySelector('.ab-day'), document.querySelector('.ab-day-btn').getAttribute('aria-expanded'), !!document.querySelector('.ab-keys'), (document.activeElement || {}).className || '']`
    await press(p, 't')
    assert.deepEqual((await p.evaluate(st)).slice(0, 3), [true, 'true', false])
    // Hilfe schliesst die Tagesbilanz ueber deren eigenen Knopf
    await press(p, '?')
    assert.deepEqual(await p.evaluate(st), [false, 'false', true, 'ab-sum-x'])
    // Esc schliesst die Hilfe, Fokus zurueck auf den Heute-Knopf
    await press(p, 'Escape')
    assert.deepEqual(await p.evaluate(st), [false, 'false', false, 'ab-day-btn'])
    // ein einziges T oeffnet die Tagesbilanz wieder ...
    await press(p, 't')
    assert.deepEqual((await p.evaluate(st)).slice(0, 3), [true, 'true', false])
    // ... und Esc schliesst sie, Fokus auf ihrem Knopf
    await press(p, 'Escape')
    assert.deepEqual(await p.evaluate(st), [false, 'false', false, 'ab-day-btn'])
    // Hilfe ohne andere Karte: Fokus kommt dorthin zurueck, wo er vorher war
    await p.evaluate(`document.getElementById('b-kino').focus()`)
    await press(p, '?')
    assert.equal(await p.evaluate(`!!document.querySelector('.ab-keys')`), true)
    await press(p, '?')
    assert.deepEqual(await p.evaluate(`[!!document.querySelector('.ab-keys'), document.activeElement.id]`), [false, 'b-kino'])
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Demo: "Bewegung reduzieren" wirkt, auch beim Umschalten zur Laufzeit', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=en')
  const media = (v) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] })
  const frames = (n) => p.evaluate(`new Promise((r) => { let n = 0; const f = () => (++n > ${n} ? r() : requestAnimationFrame(f)); f() })`)
  try {
    await waitFor(() => p.evaluate(`!!(window.AgentBoard && window.AgentBoard.ring)`), { what: 'AgentBoard' })
    assert.equal(await p.evaluate(`AgentBoard.reduce`), false)
    await media('reduce')
    await waitFor(() => p.evaluate(`AgentBoard.reduce === true`), { what: 'reduce an' })
    // keine Ringe, nur wenige Funken; danach ein paar Frames zeichnen, um Fehler aufzudecken
    await p.evaluate(`AgentBoard.rings.length = 0; AgentBoard.particles.length = 0; AgentBoard.ring(10, 10, '#fff', 40); AgentBoard.burst(10, 10, '#fff', 30)`)
    assert.deepEqual(await p.evaluate(`[AgentBoard.rings.length, AgentBoard.particles.length]`), [0, 4])
    await frames(10)
    await media('no-preference')
    await waitFor(() => p.evaluate(`AgentBoard.reduce === false`), { what: 'reduce aus' })
    await p.evaluate(`AgentBoard.rings.length = 0; AgentBoard.particles.length = 0; AgentBoard.ring(10, 10, '#fff', 40); AgentBoard.burst(10, 10, '#fff', 30)`)
    assert.deepEqual(await p.evaluate(`[AgentBoard.rings.length, AgentBoard.particles.length]`), [1, 30])
    await frames(10)
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

// Stadtansicht: Knopf, Taste C und ?view=city; das Canvas wird gezeichnet, Figuren erscheinen, keine Fehler
const cityColors = `(() => {
  const c = document.getElementById('city'); if (!c || !c.width || !c.height) return 0
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set()
  for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
  return seen.size
})()`

test('Stadtansicht: Knopf und Taste C schalten um, ?view=city startet darin', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=en')
  try {
    const st = `[document.getElementById('city').hidden, document.getElementById('map').hidden, document.getElementById('b-view').getAttribute('aria-pressed')]`
    assert.deepEqual(await p.evaluate(st), [true, false, 'false'])
    await p.evaluate(`document.getElementById('b-view').click()`)
    assert.deepEqual(await p.evaluate(st), [false, true, 'true'])
    await waitFor(async () => (await p.evaluate(cityColors)) > 20, { what: 'gezeichnete Stadt' })
    await waitFor(() => p.evaluate(`AgentBoard.city.figures().length >= 3`), { timeout: 20000, what: 'Figuren in der Stadt' })
    assert.ok((await p.evaluate(`location.search`)).includes('view=city'))
    await press(p, 'c')
    assert.deepEqual(await p.evaluate(st), [true, false, 'false'])
    await press(p, 'c')
    assert.deepEqual(await p.evaluate(st), [false, true, 'true'])
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
  const q = await load('/?demo=1&view=city&lang=de')
  try {
    assert.equal(await q.evaluate(`document.getElementById('city').hidden`), false)
    assert.equal(await q.evaluate(`document.getElementById('b-view').textContent`), await q.evaluate(`AgentBoardI18n.table['view.city'][1]`))
    await waitFor(async () => (await q.evaluate(cityColors)) > 20, { what: 'gezeichnete Stadt' })
    assert.deepEqual(q.errors, [])
  } finally { await q.close() }
})

test('Leerzustand: Karte "No session yet" ohne Ereignis in Raum und Stadt, weg bei erstem Ereignis und in der Demo (#21)', { skip, timeout: 60000 }, async () => {
  // eigener Server mit leerem Datenordner, damit garantiert kein Ereignis vorliegt
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-empty-'))
  const port = await freePort()
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { stdio: 'ignore', env: { ...process.env, AGENT_BOARD_PORT: String(port), AGENT_BOARD_DATA: dir } })
  const url = `http://127.0.0.1:${port}`
  const visible = `(() => { const e = document.getElementById('empty'); return !e.hidden && e.getBoundingClientRect().height > 0 })()`
  let p
  try {
    await waitFor(async () => (await fetch(url + '/')).ok, { timeout: 10000, what: 'Server' })
    const saved = base; base = url
    try { p = await load('/?lang=en') } finally { base = saved }
    await waitFor(async () => (await p.evaluate(`document.getElementById('conn').dataset.s`)) === 'live', { what: 'Live-Verbindung' })
    assert.equal(await p.evaluate(visible), true)
    assert.equal(await p.evaluate(`document.getElementById('empty-title').textContent`), 'No session yet')
    assert.equal(await p.evaluate(`document.getElementById('empty-code').textContent`), 'node install.mjs')
    assert.equal(await p.evaluate(`document.getElementById('empty-demo').getAttribute('href')`), '?demo=1')
    // gleiche Karte in der Stadtansicht
    await press(p, 'c')
    assert.equal(await p.evaluate(`document.getElementById('city').hidden`), false)
    assert.equal(await p.evaluate(visible), true)
    // Kopieren zeigt die Rueckmeldung
    await p.evaluate(`document.getElementById('b-copy-install').click()`)
    await waitFor(() => p.evaluate(`document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('node install.mjs')`), { what: 'Kopier-Hinweis' })
    // erstes Ereignis: Karte verschwindet
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ t: Date.now(), ev: 'PreToolUse', sid: 'abcd1234', tool: 'Read', what: 'README.md' }) + '\n')
    await waitFor(async () => !(await p.evaluate(visible)), { timeout: 10000, what: 'Karte weg nach erstem Ereignis' })
    assert.deepEqual(p.errors, [])
  } finally { if (p) await p.close(); srv.kill(); rmSync(dir, { recursive: true, force: true }) }
  // Demo-Modus: nie sichtbar
  const d = await load('/?demo=1&lang=de')
  try {
    await waitFor(async () => (await d.evaluate(`document.getElementById('conn').dataset.s`)) === 'demo', { what: 'Demo' })
    await waitFor(() => d.evaluate(`document.getElementById('empty').hidden`), { what: 'Karte im Demo-Modus versteckt' })
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(await d.evaluate(`document.getElementById('empty').hidden`), true)
    assert.deepEqual(d.errors, [])
  } finally { await d.close() }
})
