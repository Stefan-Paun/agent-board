// Leerzustand (public/empty-logic.js): wann die Karte "No session yet" zu sehen ist, plus Texte und Einbindung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
ctx.globalThis = ctx.window
vm.runInNewContext(readFileSync(join(PUB, 'empty-logic.js'), 'utf8'), ctx)
const E = ctx.window.AgentBoardEmpty

test('Karte zeigt sich ohne Ereignis, live wie offline', () => {
  assert.equal(E.shouldShow({ agents: 0, log: 0, mode: 'live' }), true)
  assert.equal(E.shouldShow({ agents: 0, log: 0, mode: 'off' }), true)
  assert.equal(E.shouldShow(), true)
})

test('Karte verschwindet beim ersten Agent oder Logeintrag und bleibt im Demo-Modus weg', () => {
  assert.equal(E.shouldShow({ agents: 1, log: 0, mode: 'live' }), false)
  assert.equal(E.shouldShow({ agents: 0, log: 1, mode: 'live' }), false)
  assert.equal(E.shouldShow({ agents: 0, log: 0, mode: 'demo' }), false)
})

test('Installationsbefehl ist node install.mjs', () => {
  assert.equal(E.INSTALL_CMD, 'node install.mjs')
})

test('index.html: Karte hat Titel, Kopierknopf, Demo-Link und laedt das Modul vor app.js', () => {
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  assert.match(html, /<code id="empty-code">node install\.mjs<\/code>/)
  assert.match(html, /id="b-copy-install"/)
  assert.match(html, /<a class="empty-demo" id="empty-demo" href="\?demo=1"/)
  assert.ok(html.indexOf('empty-logic.js') > -1 && html.indexOf('empty-logic.js') < html.indexOf('src="app.js"'))
  assert.match(readFileSync(join(PUB, 'sw.js'), 'utf8'), /'empty-logic\.js'/)
})

test('Texte: Titel in allen drei Sprachen, Platzhalter von empty.copied', () => {
  const src = readFileSync(join(PUB, 'i18n.js'), 'utf8')
  const row = (k) => src.match(new RegExp(`'${k.replace('.', '\\.')}': \\[(.*)\\],`))[1]
  assert.match(row('empty.title'), /'No session yet', 'Noch keine Session', 'Aún no hay sesión'/)
  assert.equal((row('empty.copied').match(/\{text\}/g) || []).length, 3)
})

test('doctorRows: uebersetzt Beschriftung und Hinweis, Detail und Hinweis nur bei warn/fail', () => {
  const dict = { 'doctor.l.hooks': 'Hooks installiert', 'doctor.h.run': 'Ausführen: {cmd}' }
  const t = (k, vars) => (dict[k] ? dict[k].replace(/\{(\w+)\}/g, (m, n) => (vars && vars[n] != null ? vars[n] : m)) : k)
  const rows = E.doctorRows([
    { status: 'ok', id: 'node', label: 'Node.js version', detail: 'v22.1.0' },
    { status: 'fail', id: 'hooks', label: 'Hooks installed', detail: 'no hooks', hint: 'Run: node install.mjs', hintKey: 'run', vars: { cmd: 'node install.mjs' } },
    { status: 'warn', id: 'neu', label: 'New check', detail: 'd', hint: 'English hint', hintKey: 'unbekannt' },
    { status: 'kaputt', id: 'x', label: 'x' }, null,
  ], t)
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { status: 'ok', mark: '✓', label: 'Node.js version', detail: '', hint: '' },
    { status: 'fail', mark: '✗', label: 'Hooks installiert', detail: 'no hooks', hint: 'Ausführen: node install.mjs' },
    // unbekannte Schluessel: der englische Text vom Server bleibt
    { status: 'warn', mark: '!', label: 'New check', detail: 'd', hint: 'English hint' },
  ])
  assert.equal(E.doctorRows(null, t).length, 0)
  assert.equal(E.doctorRows({ results: 1 }, t).length, 0)
})

test('index.html: Selbstcheck-Bereich mit Liste und Knopf "Check again" steht in der Karte', () => {
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  const card = html.slice(html.indexOf('id="empty"'), html.indexOf('</main>'))
  assert.match(card, /id="empty-doctor" hidden/)
  assert.match(card, /<ul class="ed-list" id="doctor-list"/)
  assert.match(card, /id="b-doctor" data-i18n="doctor\.refresh"/)
  // /doctor wird vom Service Worker nie gecacht
  assert.match(readFileSync(join(PUB, 'sw.js'), 'utf8'), /p\.endsWith\('\/doctor'\)/)
})
