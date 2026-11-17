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
  // Erstbesuch-Tour (#69) nur in ihrem eigenen Test: sonst haelt sie in frischen Profilen den Fokus
  if (!/[?&]tour=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'tour=0'
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

// Puffergroesse der Karte gegen ihre CSS-Groesse: weicht sie ab, wird die Pixelgrafik verzerrt
const canvasFit = `(() => {
  const c = document.getElementById('map'), r = c.getBoundingClientRect(), d = AgentBoard.geo.dpr
  return { dw: Math.abs(c.width - Math.round(r.width * d)), dh: Math.abs(c.height - Math.round(r.height * d)), scale: AgentBoard.artToCss(1), rect: [r.width, r.height], buf: [c.width, c.height] }
})()`

test('Karte: Puffer folgt der Buehne auch ohne Fenster-Resize (hoehere Fusszeile, Kinomodus an und aus)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=en')
  try {
    const fit = (what) => waitFor(async () => { const f = await p.evaluate(canvasFit); return f.dw <= 1 && f.dh <= 1 && f }, { timeout: 5000, what })
    await fit('Puffer passt zur Buehne nach dem Laden')
    // Fusszeile hoeher machen (kein resize-Ereignis am Fenster): die Karte muss trotzdem neu messen
    const h0 = (await p.evaluate(canvasFit)).rect[1]
    await p.evaluate(`document.getElementById('log').style.minHeight = '160px'`)
    await waitFor(async () => (await p.evaluate(canvasFit)).rect[1] < h0 - 20, { what: 'niedrigere Buehne' })
    const before = await fit('Puffer passt nach geaenderter Fusszeile')
    await press(p, 'k')
    await waitFor(() => p.evaluate(`document.body.classList.contains('abx-kino')`), { what: 'Kinomodus an' })
    await fit('Puffer passt im Kinomodus')
    await press(p, 'k')
    await waitFor(() => p.evaluate(`!document.body.classList.contains('abx-kino')`), { what: 'Kinomodus aus' })
    // gleiche Buehne -> gleiche Pixelgroesse wie vorher (frueher war das Haus danach kleiner oder groesser).
    // Gewartet wird, bis die Buehne wieder ihre alte Groesse hat (Vollbild-Ende kann auf CI verzoegert kommen).
    const same = (a, b) => Math.round(a.rect[0]) === Math.round(b.rect[0]) && Math.round(a.rect[1]) === Math.round(b.rect[1])
    const after = await waitFor(async () => { const f = await p.evaluate(canvasFit); return f.dw <= 1 && f.dh <= 1 && same(f, before) && f }, { timeout: 5000, what: 'Buehne und Puffer wie vor dem Kinomodus' })
    assert.equal(after.scale, before.scale)
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
const KEYS = { Escape: { code: 'Escape', windowsVirtualKeyCode: 27 }, ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 }, ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 }, Tab: { code: 'Tab', windowsVirtualKeyCode: 9 }, t: { code: 'KeyT', windowsVirtualKeyCode: 84, text: 't' }, k: { code: 'KeyK', windowsVirtualKeyCode: 75, text: 'k' }, w: { code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' }, '?': { code: 'Slash', windowsVirtualKeyCode: 191, text: '?' }, c: { code: 'KeyC', windowsVirtualKeyCode: 67, text: 'c' } }
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

// Echte Textboxen eines gezeichneten Bildes: fillText auf der Karte mitschneiden (Text, Mitte, Breite, Hoehe in CSS-Pixeln)
const drawnTexts = `new Promise((ok) => {
  const g = document.getElementById('map').getContext('2d'), orig = g.fillText, seen = new Map()
  g.fillText = function (t, x, y) {
    const m = g.measureText(t), tf = g.getTransform(), k = tf.a / AgentBoard.geo.dpr
    const b = { t, x: x * k, y: y * k, w: m.width * k, h: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * k, center: g.textAlign === 'center' }
    seen.set(t + '@' + Math.round(b.x) + ',' + Math.round(b.y), b)
    return orig.apply(this, arguments)
  }
  requestAnimationFrame(() => requestAnimationFrame(() => { g.fillText = orig; ok([...seen.values()]) }))
})`

test('Tisch-Beschriftungen: bei 3 Schreibtischen ueberlappen Namen, Projekte und Tafeln nicht (EN/DE/ES, breit und schmal)', { skip, timeout: 90000 }, async () => {
  const projs = ['jarvis-sprachassistent', 'matura-rallye-mathe', 'agent-board']
  for (const [lang, w, h] of [['en', 1400, 900], ['de', 1024, 700], ['es', 800, 600]]) {
    const p = await load(`/?demo=1&multi=1&lang=${lang}`)
    try {
      await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await waitFor(() => p.evaluate(`AgentBoard.leadsShown().length === 3 && [...AgentBoard.S.leads.values()].every((L) => L.proj)`), { timeout: 20000, what: 'drei Schreibtische mit Projekt' })
      // lange, echte Projektnamen statt der kurzen Demo-Namen
      await p.evaluate(`[...AgentBoard.S.leads.values()].forEach((L, i) => { L.proj = ${JSON.stringify(projs)}[i] })`)
      // Tisch-Beschriftungen ueber ihre Lage finden (auch gekuerzte Texte): Name bei y+22u, Untertitel bei y+36u
      const desks = await p.evaluate(`AgentBoard.leadsShown().map((id) => AgentBoard.deskPos(id))`)
      const u = await p.evaluate(`AgentBoard.geo.u`)
      const step = desks[1].x - desks[0].x
      const near = (b, dy) => desks.findIndex((d) => Math.abs(b.x - d.x) < step / 2 && Math.abs(b.y - (d.y + dy * u)) < 2)
      const all = (await p.evaluate(drawnTexts)).filter((b) => b.center)
      const names = all.filter((b) => near(b, 22) >= 0), subs = all.filter((b) => near(b, 36) >= 0)
      const todos = all.filter((b) => /^\d+\/\d+/.test(b.t))
      // je Tisch genau ein Name und ein Untertitel, keiner faellt still aus der Pruefung
      assert.deepEqual(names.map((b) => near(b, 22)).sort(), [0, 1, 2], `Namen: ${JSON.stringify(names.map((b) => b.t))}`)
      assert.deepEqual(subs.map((b) => near(b, 36)).sort(), [0, 1, 2], `Untertitel: ${JSON.stringify(subs.map((b) => b.t))}`)
      const boxes = [...names, ...subs, ...todos]
      const hits = []
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) hits.push(`"${a.t}" / "${b.t}"`)
      }
      assert.deepEqual(hits, [], `${lang} ${w}x${h}: Beschriftungen ueberlappen`)
      assert.deepEqual(p.errors, [])
    } finally { await p.close() }
  }
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
    // alle drei Quellen: --codex und --gemini als <code> im Text (#45)
    assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('#empty p code')].map((c) => c.textContent)`), ['--codex', '--gemini'])
    assert.equal(await p.evaluate(`document.getElementById('empty-demo').getAttribute('href')`), '?demo=1')
    // Selbstcheck in der Karte (#49): Punkte mit Haken, Knopf laedt neu
    await waitFor(() => p.evaluate(`document.querySelectorAll('#doctor-list li b').length >= 5`), { what: 'Doctor-Liste' })
    assert.match(await p.evaluate(`document.getElementById('doctor-list').textContent`), /Node\.js version/)
    await p.evaluate(`document.getElementById('b-doctor').click()`)
    await waitFor(() => p.evaluate(`document.querySelectorAll('#doctor-list li b').length >= 5`), { what: 'Doctor-Liste nach Refresh' })
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

test('Aufgabentafel: TodoWrite-Zaehler erscheinen neben dem Schreibtisch, in der Demo, EN und DE (#22)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&lang=en')
  try {
    // Demo: die Tafel taucht mit Zaehlern auf ("n/m done"), Hauptfigur traegt nur Zahlen
    const todos = await waitFor(() => p.evaluate(`(() => { const t = AgentBoard.S.main.todos; return t && JSON.stringify(t) })()`), { timeout: 20000, what: 'Todo-Zaehler in der Demo' })
    assert.deepEqual(Object.keys(JSON.parse(todos)).sort(), ['done', 'open', 'progress'])
    const label = await waitFor(() => p.evaluate(`(AgentBoard.labelRects || []).map((r) => r.text).find((t) => /^\\d+\\/\\d+ done$/.test(t))`), { timeout: 10000, what: 'Tafel-Beschriftung' })
    assert.match(label, /^\d+\/\d+ done$/)
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
  // deutsch
  const d = await load('/?demo=1&lang=de')
  try {
    await waitFor(() => d.evaluate(`(AgentBoard.labelRects || []).some((r) => /^\\d+\\/\\d+ erledigt$/.test(r.text))`), { timeout: 20000, what: 'deutsche Tafel' })
    assert.deepEqual(d.errors, [])
  } finally { await d.close() }
})
test('Kurze Werkzeugnamen: AgentBoard.parseTool ist im Browser verfuegbar (#24)', async () => {
  const d = await load('/?demo=1&lang=en')
  try {
    await waitFor(async () => (await d.evaluate(`document.getElementById('conn').dataset.s`)) === 'demo', { what: 'Demo' })
    assert.equal(await d.evaluate(`AgentBoard.parseTool('mcp__github__create_issue').label`), 'github · create_issue')
    assert.equal(await d.evaluate(`AgentBoard.parseTool('Skill', 'jarvis-test').kind`), 'skill')
    assert.equal(await d.evaluate(`AgentBoard.parseTool('Read', 'a.js').label`), 'Read')
    assert.deepEqual(d.errors, [])
  } finally { await d.close() }
})
test('Agent-Typen: Hemdfarbe pro Typ in Raum und Stadt, Legende in EN/DE (#25)', { skip, timeout: 60000 }, async () => {
  const e = await load('/?lang=en') // ohne Demo und ohne Subagents: Legende versteckt
  try {
    assert.equal(await e.evaluate(`document.getElementById('types').hidden`), true)
  } finally { await e.close() }
  const p = await load('/?demo=1&lang=en')
  try {
    // Demo startet Explore, general-purpose und Plan: Legende erscheint mit allen drei Typen
    await waitFor(() => p.evaluate(`document.querySelectorAll('#types li').length >= 3`), { timeout: 20000, what: 'Legende mit drei Typen' })
    assert.equal(await p.evaluate(`document.getElementById('types').hidden`), false)
    const keys = await p.evaluate(`[...document.querySelectorAll('#types li')].map((e) => e.dataset.type)`)
    assert.deepEqual(keys, ['explore', 'plan', 'general-purpose'])
    const sw = await p.evaluate(`[...document.querySelectorAll('#types .sw')].map((e) => getComputedStyle(e).backgroundColor)`)
    assert.equal(new Set(sw).size, 3)
    // Hemdfarben im Raum: verschiedene Typen -> verschiedene Farben, gleicher Typ -> gleiche; Namen bleiben "Agent N"
    const rows = await p.evaluate(`[...AgentBoard.S.agents.values()].map((a) => [a.name, a.role, AgentBoard.types.colorFor(a.role)])`)
    assert.ok(rows.length >= 3 && rows.every((r) => /^Agent \d+$/.test(r[0])))
    const byRole = new Map(rows.map((r) => [r[1], r[2]]))
    assert.equal(new Set(byRole.values()).size, byRole.size)
    // Stadt: dieselben Hemdfarben an den Figuren
    await p.evaluate(`document.getElementById('b-view').click()`)
    await waitFor(() => p.evaluate(`AgentBoard.city.figures().filter((f) => !f.lead).length >= 3`), { timeout: 20000, what: 'Subagent-Figuren in der Stadt' })
    const figs = await p.evaluate(`AgentBoard.city.figures().filter((f) => !f.lead).map((f) => [f.role, f.shirt])`)
    for (const [role, shirt] of figs) assert.equal(shirt, byRole.get(role) || await p.evaluate(`AgentBoard.types.colorFor(${JSON.stringify(role)})`))
    assert.ok(new Set(figs.map((f) => f[1])).size >= 3)
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
  const q = await load('/?demo=1&lang=de')
  try {
    await waitFor(() => q.evaluate(`document.querySelectorAll('#types li').length >= 1`), { timeout: 20000, what: 'Legende' })
    assert.equal(await q.evaluate(`document.querySelector('#types .types-h').textContent`), await q.evaluate(`AgentBoardI18n.table['legend.title'][1]`))
    assert.deepEqual(q.errors, [])
  } finally { await q.close() }
})
test('Gemini: Ereignis mit src gemini bekommt einen eigenen Kommandanten "Gemini" neben Claude', { skip, timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-gemini-'))
  const port = await freePort()
  const now = Date.now()
  appendFileSync(join(dir, 'events.jsonl'), [
    { t: now - 2000, ev: 'PreToolUse', sid: 'claude01', tool: 'Read', what: 'a.js' },
    { t: now - 1000, ev: 'PreToolUse', sid: 'gem00001', src: 'gemini', tool: 'Bash', what: 'npm test' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], { stdio: 'ignore', env: { ...process.env, AGENT_BOARD_PORT: String(port), AGENT_BOARD_DATA: dir } })
  let p
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok, { timeout: 10000, what: 'Server' })
    const saved = base; base = `http://127.0.0.1:${port}`
    try { p = await load('/?lang=en') } finally { base = saved }
    const names = await waitFor(async () => { const n = await p.evaluate(commanders); return n.length >= 2 && n }, { timeout: 15000, what: 'zwei Kommandanten' })
    assert.deepEqual([...names].sort(), ['Claude', 'Gemini'])
    assert.deepEqual(p.errors, [])
  } finally { if (p) await p.close(); srv.kill(); rmSync(dir, { recursive: true, force: true }) }
})

test('Tagesbilanz: PNG-Karte hat Knopf, Pixel und zeigt Projektnamen nur auf Wunsch (#46)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&lang=en')
  try {
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-day-btn')`), { what: 'Heute-Knopf' })
    await p.evaluate(`document.querySelector('.ab-day-btn').click()`)
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-day-png')`), { timeout: 20000, what: 'PNG-Knopf' })
    assert.equal(await p.evaluate(`document.querySelector('.ab-day-png').textContent`), await p.evaluate(`AgentBoardI18n.table['day.png'][0]`))
    // Canvas zeichnen und alle Texte mitschneiden
    const res = await p.evaluate(`(() => {
      const texts = []; let cur = texts; const orig = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { cur.push(String(t)); return orig.call(this, t, ...a) }
      const plain = AgentBoard.dayCanvas(false); const projTexts = []; cur = projTexts; AgentBoard.dayCanvas(true)
      CanvasRenderingContext2D.prototype.fillText = orig
      const px = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return seen.size }
      return { size: [plain.width, plain.height], colors: px(plain), texts, projTexts }
    })()`)
    assert.deepEqual(res.size, [800, 450])
    assert.ok(res.colors > 3, `Karte wirkt leer (${res.colors} Farben)`)
    assert.ok(res.texts.some((t) => /active/.test(t)))
    // ohne Haken: kein Projektname (Zeilen "Name · projekt"); mit Haken: mindestens eine solche Zeile
    const withProj = (l) => l.filter((t) => / · /.test(t) && !t.startsWith('Tools used'))
    assert.deepEqual(withProj(res.texts), [])
    assert.ok(withProj(res.projTexts).length >= 1, 'Projektname fehlt trotz Haken')
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Stadtansicht zeigt Aufgabentafel am Schreibtisch und die Typ-Legende (#41)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&view=city&lang=en')
  try {
    assert.equal(await p.evaluate(`document.getElementById('city').hidden`), false)
    // Tafel: nur Zaehler (done/progress/open), keine Texte
    await waitFor(() => p.evaluate(`AgentBoard.city.boards().some((b) => b && b.done + b.progress + b.open > 0)`), { timeout: 30000, what: 'Aufgabentafel in der Stadt' })
    const b = await p.evaluate(`AgentBoard.city.boards().find(Boolean)`)
    assert.deepEqual(Object.keys(b).sort(), ['done', 'open', 'progress'])
    // Legende bleibt in der Stadtansicht sichtbar, sobald Subagents da sind
    await waitFor(() => p.evaluate(`document.querySelectorAll('#types li').length >= 1`), { timeout: 20000, what: 'Legende in der Stadt' })
    assert.equal(await p.evaluate(`(() => { const e = document.getElementById('types'); return !e.hidden && e.getBoundingClientRect().height > 0 })()`), true)
    await waitFor(async () => (await p.evaluate(cityColors)) > 20, { what: 'gezeichnete Stadt' })
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Screenreader: wartender Agent wird in #sr-live angesagt, ohne Tool-Text (#59)', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&lang=en')
  try {
    assert.equal(await p.evaluate(`document.getElementById('sr-live').getAttribute('aria-live')`), 'polite')
    const txt = await waitFor(async () => { const t = await p.evaluate(`document.getElementById('sr-live').textContent`); return /permission/.test(t) && t },
      { timeout: 30000, what: 'Ansage im Live-Bereich' })
    assert.ok(!/rm -rf|build\/|Bash/.test(txt), `Tool-Text in der Ansage: ${txt}`)
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Wochenrueckblick: Knopf, 7 Balken, Heatmap-Tabelle mit Zahlen, Taste W, Demo-Werte', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&lang=de')
  try {
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-week-btn')`), { what: 'Wochen-Knopf' })
    assert.equal(await p.evaluate(`document.querySelector('.ab-week-btn').textContent`), 'Woche')
    // ein echter Tastendruck: frueher kamen zwei synthetische keydown an (document mit bubbles erreicht auch
    // window, dazu noch einer direkt an window) - die Karte ging auf und sofort wieder zu
    await press(p, 'w')
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-week .ab-week-heat')`), { timeout: 20000, what: 'Wochenkarte' })
    const r = await p.evaluate(`(() => {
      const c = document.querySelector('.ab-week')
      const rows = [...c.querySelectorAll('.ab-week-heat tbody tr')]
      return {
        bars: c.querySelectorAll('.ab-week-bar').length, rows: rows.length, cells: rows.map((t) => t.querySelectorAll('td').length),
        numeric: [...c.querySelectorAll('.ab-week-c')].every((td) => /^\\d+$/.test(td.textContent)),
        anyPositive: [...c.querySelectorAll('.ab-week-c')].some((td) => Number(td.textContent) > 0),
        tools: c.querySelectorAll('ol.ab-week-list li').length, projects: c.querySelectorAll('ul.ab-week-proj li').length,
        expanded: document.querySelector('.ab-week-btn').getAttribute('aria-expanded'), text: c.textContent,
      }
    })()`)
    assert.equal(r.bars, 7)
    assert.equal(r.rows, 7)
    assert.ok(r.cells.every((n) => n === 24))
    assert.ok(r.numeric && r.anyPositive)
    assert.equal(r.tools, 8)
    assert.ok(r.projects >= 1)
    assert.equal(r.expanded, 'true')
    assert.match(r.text, /Vorwoche/)
    assert.match(r.text, /Beispielwerte/)
    // Escape schliesst die Karte wieder
    await p.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(() => p.evaluate(`!document.querySelector('.ab-week')`), { what: 'Karte zu' })
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Zweiter Rechner (#68): Abzeichen an Karte und Figur, Filter alle / dieser Rechner / Name', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&machine=1&lang=de')
  try {
    // ohne zweiten Rechner gibt es keinen Filter; er erscheint mit dem ersten fremden Ereignis
    await waitFor(() => p.evaluate(`AgentBoard.machines.list().includes('pc-two')`), { timeout: 20000, what: 'Ereignis vom zweiten Rechner' })
    await waitFor(() => p.evaluate(`!document.querySelector('.ab-machines').hidden`), { what: 'Filter sichtbar' })
    assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('#ab-machine-filter option')].map((o) => [o.value, o.textContent])`),
      [['all', 'Alle Rechner'], ['this', 'Dieser Rechner'], ['pc-two', 'pc-two']])
    // Abzeichen: nur an der fremden Session
    await waitFor(() => p.evaluate(`[...document.querySelectorAll('.cc-machine')].some((e) => !e.hidden && e.textContent === '@pc-two')`), { what: 'Abzeichen an der Karte' })
    assert.equal(await p.evaluate(`[...AgentBoard.S.leads.values()].filter((L) => L.machine === 'pc-two').length`), 1)
    assert.ok(await p.evaluate(`[...AgentBoard.S.leads.values()].some((L) => L.machine === '')`), 'lokale Session ohne Abzeichen')
    // die Statusline (Kontext, Kosten) gehoert immer einer Session dieses Rechners, auch wenn die fremde zuletzt aktiv war
    assert.equal(await p.evaluate(`AgentBoard.lead(AgentBoard.statusLead()).machine`), '')
    const pick = (v) => p.evaluate(`(() => { const s = document.getElementById('ab-machine-filter'); s.value = '${v}'; s.dispatchEvent(new Event('change')) })()`)
    // dieser Rechner: die fremde Session verschwindet, die lokale bleibt
    await pick('this')
    assert.equal(await p.evaluate(`AgentBoard.machines.filter()`), 'this')
    assert.equal(await p.evaluate(`[...AgentBoard.S.leads.values()].filter((L) => L.machine).length + [...AgentBoard.S.agents.values()].filter((a) => a.machine).length`), 0)
    assert.ok(await p.evaluate(`AgentBoard.S.leads.size >= 1`))
    // nur der zweite Rechner
    await pick('pc-two')
    assert.equal(await p.evaluate(`[...AgentBoard.S.leads.values()].every((L) => L.machine === 'pc-two') && AgentBoard.S.leads.size === 1`), true)
    assert.equal(await p.evaluate(`[...AgentBoard.S.agents.values()].every((a) => a.machine === 'pc-two')`), true)
    // zurueck auf alle: nichts ist verloren gegangen
    await pick('all')
    assert.ok(await p.evaluate(`AgentBoard.S.leads.size >= 2 && [...AgentBoard.S.leads.values()].some((L) => !L.machine)`))
    await new Promise((r) => setTimeout(r, 700)) // ein UI-Takt mit Abzeichen und Filter
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})

test('Erstbesuch-Tour (#69): startet von selbst, Tasten, Fokus, Legende in der Hilfe, Neustart ueber ?', { skip, timeout: 60000 }, async () => {
  const p = await load('/?demo=1&multi=1&lang=de&tour=1')
  try {
    await waitFor(() => p.evaluate(`!!document.querySelector('.ab-tour:not([hidden])')`), { timeout: 15000, what: 'Tour-Dialog' })
    const st = `[document.querySelector('.ab-tour').dataset.step, document.querySelector('.ab-tour-count').textContent, document.activeElement.className, !document.querySelector('.ab-tour-hl').hidden]`
    assert.deepEqual(await p.evaluate(st), ['rooms', 'Schritt 1 von 6', 'ab-tour-next', true])
    assert.deepEqual(await p.evaluate(`[document.querySelector('.ab-tour').getAttribute('role'), document.querySelector('.ab-tour').getAttribute('aria-modal'), document.querySelector('.ab-tour [aria-live]') !== null, localStorage.getItem('ab-tour-seen')]`), ['dialog', 'true', true, '1'])
    await press(p, 'ArrowRight')
    assert.deepEqual((await p.evaluate(st)).slice(0, 2), ['agent', 'Schritt 2 von 6'])
    await press(p, 'ArrowLeft')
    assert.equal((await p.evaluate(st))[0], 'rooms')
    // Fokus bleibt im Dialog, Tastenkuerzel wirken waehrend der Tour nicht
    for (let i = 0; i < 4; i++) await press(p, 'Tab')
    await press(p, 't')
    assert.deepEqual(await p.evaluate(`[document.querySelector('.ab-tour').contains(document.activeElement), !!document.querySelector('.ab-day')]`), [true, false])
    // bis zum Ende durchklicken: "Fertig" schliesst, Fokus auf den Knopf "?"
    for (let i = 0; i < 5; i++) await p.evaluate(`document.querySelector('.ab-tour-next').click()`)
    assert.equal(await p.evaluate(`document.querySelector('.ab-tour-next').textContent`), 'Fertig')
    await p.evaluate(`document.querySelector('.ab-tour-next').click()`)
    assert.deepEqual(await p.evaluate(`[document.querySelector('.ab-tour').hidden, document.activeElement.id]`), [true, 'b-help'])
    // Knopf "?" oeffnet die Hilfe mit Tour-Knopf und Legende (ein Eintrag je Zimmer)
    await p.evaluate(`document.getElementById('b-help').click()`)
    assert.deepEqual(await p.evaluate(`[!!document.querySelector('.ab-keys .ab-tour-start'), [...document.querySelectorAll('.ab-keys .ab-legend li')].map((l) => l.dataset.room)]`),
      [true, ['archiv', 'werkstatt', 'terminal', 'funkturm', 'leitstand', 'pausenraum']])
    assert.equal(await p.evaluate(`document.querySelector('.ab-legend li b').textContent`), 'Archiv')
    // Neustart aus der Hilfe; Esc beendet die Tour (nicht den Kinomodus o.ae.)
    await p.evaluate(`document.querySelector('.ab-tour-start').click()`)
    assert.deepEqual(await p.evaluate(`[!document.querySelector('.ab-tour').hidden, !!document.querySelector('.ab-keys')]`), [true, false])
    await press(p, 'Escape')
    assert.equal(await p.evaluate(`document.querySelector('.ab-tour').hidden`), true)
    // ohne ?tour=1 startet sie beim naechsten Besuch nicht mehr von selbst
    const q = await load('/?demo=1&lang=de&tour=')
    try {
      await waitFor(() => q.evaluate(`AgentBoard.S.agents.size > 0`), { timeout: 20000, what: 'Demo-Agents' })
      await new Promise((r) => setTimeout(r, 3500))
      assert.equal(await q.evaluate(`!!document.querySelector('.ab-tour:not([hidden])')`), false)
      // erster Besuch ohne Schalter: "gesehen" loeschen, neu laden -> Tour startet von selbst
      await q.evaluate(`localStorage.removeItem('ab-tour-seen')`)
      assert.deepEqual(q.errors, [])
    } finally { await q.close() }
    const r = await load('/?demo=1&lang=en&tour=')
    try {
      await waitFor(() => r.evaluate(`!!document.querySelector('.ab-tour:not([hidden])')`), { timeout: 20000, what: 'Tour beim ersten Besuch' })
      // Strg-Kuerzel bleiben frei, ein Klick daneben beendet die Tour
      assert.equal(await r.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }))`), true)
      await r.evaluate(`document.querySelector('.ab-tour-shade').click()`)
      assert.deepEqual(await r.evaluate(`[document.querySelector('.ab-tour').hidden, localStorage.getItem('ab-tour-seen')]`), [true, '1'])
      assert.deepEqual(r.errors, [])
    } finally { await r.close() }
    assert.deepEqual(p.errors, [])
  } finally { await p.close() }
})
