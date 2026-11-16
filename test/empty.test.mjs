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

test('Text nennt alle drei Quellen: Claude Code, dazu --codex und --gemini als <code> in EN/DE/ES (#45)', () => {
  const src = readFileSync(join(PUB, 'i18n.js'), 'utf8')
  const row = src.match(/'empty\.text': \[(.*)\],/)[1]
  const langs = [...row.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
  assert.equal(langs.length, 3)
  for (const t of langs) {
    assert.match(t, /Claude.Code/)
    assert.match(t, /Gemini CLI/)
    assert.match(t, /<code>--codex<\/code>/)
    assert.match(t, /<code>--gemini<\/code>/)
    assert.ok(!/\(or Codex\)|oder Codex|\(o Codex\)/.test(t), t)
  }
  // Absatz wird mit <code>-Stellen eingesetzt (data-i18n-html), der Platzhalter in index.html ist der englische Text
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  const p = html.match(/<p data-i18n-html="empty\.text">(.*?)<\/p>/)
  assert.ok(p, 'empty.text in index.html nicht als data-i18n-html eingebunden')
  assert.equal(p[1], langs[0])
})
