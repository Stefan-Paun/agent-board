// Erstbesuch-Tour und Zimmer-Legende (public/tour-logic.js, #69): Schrittfolge, Ausweichziele,
// Tasten, Autostart, Legende deckt STATIONS ab, Texte in allen drei Sprachen, Einbindung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
ctx.globalThis = ctx.window
vm.runInNewContext(readFileSync(join(PUB, 'tour-logic.js'), 'utf8'), ctx)
const TL = ctx.window.AgentBoardTour
const plain = (v) => JSON.parse(JSON.stringify(v))

// Uebersetzungen wie in test/i18n.test.mjs laden
function i18n(lang) {
  const c = {
    window: {}, location: { search: `?lang=${lang}` }, navigator: { languages: [lang], language: lang },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: () => null },
    URLSearchParams,
  }
  vm.runInNewContext(readFileSync(join(PUB, 'i18n.js'), 'utf8'), c)
  return c.window.AgentBoardI18n
}
// Zimmer-IDs direkt aus der STATIONS-Tabelle in app.js
const appSrc = readFileSync(join(PUB, 'app.js'), 'utf8')
const stBlock = appSrc.match(/const STATIONS = \[([\s\S]*?)\n\]/)[1]
const STATIONS = [...stBlock.matchAll(/\{ id: '(\w+)'.*?icon: '(\w+)'.*?tools: \[([^\]]*)\]/g)]
  .map((m) => ({ id: m[1], icon: m[2], tools: [...m[3].matchAll(/'(\w+)'/g)].map((x) => x[1]) }))

test('fuenf bis sechs Schritte in fester Reihenfolge, jeder mit Ziel und Textschluessel', () => {
  const ids = TL.STEPS.map((s) => s.id)
  assert.deepEqual(plain(ids), ['rooms', 'agent', 'badges', 'history', 'today', 'settings'])
  for (const s of TL.STEPS) {
    assert.ok(s.targets.length >= 1, s.id)
    assert.equal(s.key, 'tour.' + s.id)
  }
})

test('plan: alle Ziele da -> erstes Ziel je Schritt', () => {
  const p = TL.plan(TL.STEPS, () => true)
  assert.equal(p.length, TL.STEPS.length)
  assert.deepEqual(plain(p.map((s) => s.target)), plain(TL.STEPS.map((s) => s.targets[0])))
})

test('plan: fehlendes Ziel -> Ausweichziel, fehlen alle -> Schritt entfaellt', () => {
  // Stadtansicht: keine Karte ('@...'), keine Glocke, kein Verlauf
  const has = (t) => !t.startsWith('@') && t !== '.ab-att-bell' && t !== '.ab-tl-btn'
  const p = TL.plan(TL.STEPS, has)
  assert.deepEqual(plain(p.map((s) => [s.id, s.target])), [
    ['rooms', '#city:not([hidden])'], ['agent', '#crew'], ['badges', '#crew'],
    ['today', '.ab-day-btn:not(.ab-week-btn)'], ['settings', 'header .tools'],
  ])
  assert.deepEqual(plain(TL.plan(TL.STEPS, () => false)), [])
  // wirft das Ausmessen, gilt das Ziel als fehlend
  assert.equal(TL.pickTarget({ targets: ['a', 'b'] }, (t) => { if (t === 'a') throw new Error('x'); return true }), 'b')
  assert.equal(TL.pickTarget(null, () => true), null)
})

test('move: vor, zurueck, Anfang, Ende; hinter dem letzten Schritt ist die Tour fertig', () => {
  assert.equal(TL.move(0, 'next', 6), 1)
  assert.equal(TL.move(4, 'next', 6), 5)
  assert.equal(TL.move(5, 'next', 6), -1)
  assert.equal(TL.move(0, 'prev', 6), 0)
  assert.equal(TL.move(3, 'prev', 6), 2)
  assert.equal(TL.move(3, 'first', 6), 0)
  assert.equal(TL.move(1, 'last', 6), 5)
  assert.equal(TL.move(2, 'quatsch', 6), 2)
  assert.equal(TL.move(0, 'next', 0), -1)
})

test('Tasten: Pfeile, Pos1/Ende, Esc, Enter (ausser auf einem Knopf), Tab fuer die Fokusfalle', () => {
  assert.equal(TL.keyAction({ key: 'ArrowRight' }), 'next')
  assert.equal(TL.keyAction({ key: 'ArrowDown' }), 'next')
  assert.equal(TL.keyAction({ key: 'ArrowLeft' }), 'prev')
  assert.equal(TL.keyAction({ key: 'ArrowUp' }), 'prev')
  assert.equal(TL.keyAction({ key: 'Home' }), 'first')
  assert.equal(TL.keyAction({ key: 'End' }), 'last')
  assert.equal(TL.keyAction({ key: 'Escape' }), 'close')
  assert.equal(TL.keyAction({ key: 'Enter' }, false), 'next')
  assert.equal(TL.keyAction({ key: 'Enter' }, true), null)
  assert.equal(TL.keyAction({ key: 'Tab' }), 'tab')
  assert.equal(TL.keyAction({ key: 'Tab', shiftKey: true }), 'tabBack')
  assert.equal(TL.keyAction({ key: 'h' }), null)
  assert.equal(TL.keyAction({ key: 'ArrowRight', ctrlKey: true }), null)
  assert.equal(TL.keyAction(null), null)
})

test('Autostart nur beim ersten Besuch und erst, wenn es etwas zu sehen gibt', () => {
  assert.equal(TL.shouldAutoStart({ mode: 'demo', agents: 3 }), true)
  assert.equal(TL.shouldAutoStart({ mode: 'live', agents: 1 }), true)
  assert.equal(TL.shouldAutoStart({ mode: 'demo', agents: 0 }), false)
  assert.equal(TL.shouldAutoStart({ mode: 'live', agents: 0 }), false, 'Leerzustand erklaert sich selbst')
  assert.equal(TL.shouldAutoStart({ mode: 'off', agents: 2 }), false)
  assert.equal(TL.shouldAutoStart({ seen: true, mode: 'demo', agents: 3 }), false, 'keine Tour bei jedem Besuch')
  assert.equal(TL.shouldAutoStart({ query: '0', mode: 'demo', agents: 3 }), false)
  assert.equal(TL.shouldAutoStart({ query: '1', seen: true, mode: 'off' }), true)
  assert.equal(TL.shouldAutoStart(), false)
  assert.equal(TL.SEEN_KEY, 'ab-tour-seen')
})

test('Legende deckt jeden Eintrag von STATIONS ab, mit Werkzeugen und eigenem Satz', () => {
  assert.ok(STATIONS.length >= 6, `nur ${STATIONS.length} Zimmer in app.js gefunden`)
  const L = TL.legend(STATIONS)
  assert.deepEqual(plain(L.map((e) => e.id)), STATIONS.map((s) => s.id))
  for (const [i, e] of L.entries()) {
    assert.equal(e.nameKey, 'room.' + e.id)
    assert.equal(e.textKey, 'legend.room.' + e.id)
    assert.deepEqual(plain(e.tools), STATIONS[i].tools)
  }
  // Kopie, kein geteiltes Array
  L[0].tools.push('X'); assert.ok(!STATIONS[0].tools.includes('X'))
  assert.deepEqual(plain(TL.legend(null)), [])
})

test('alle Texte der Tour und der Legende gibt es in EN, DE und ES (und sie unterscheiden sich)', () => {
  const langs = ['en', 'de', 'es'].map(i18n)
  const table = langs[0].table
  const keys = ['tour.helpBtn', 'tour.start', 'tour.close', 'tour.back', 'tour.next', 'tour.done', 'tour.count', 'legend.rooms',
    ...TL.STEPS.flatMap((s) => [s.key + '.title', s.key + '.text']),
    ...TL.legend(STATIONS).flatMap((e) => [e.nameKey, e.textKey])]
  for (const k of keys) {
    assert.ok(table[k], `${k} fehlt in i18n.js`)
    assert.equal(table[k].length, 3, k)
    for (const L of langs) assert.ok(L.t(k, { n: 1, total: 6 }).trim().length > 1, `${k} (${L.lang}) leer`)
  }
  for (const s of TL.STEPS) assert.notEqual(langs[0].t(s.key + '.text'), langs[1].t(s.key + '.text'), `${s.key}: DE = EN?`)
  assert.equal(langs[1].t('tour.count', { n: 2, total: 6 }), 'Schritt 2 von 6')
})

test('Einbindung: Logik vor app.js, fx/tour.js nach fx/keys.js, CSS, Service-Worker-Cache', () => {
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  const at = (s) => html.indexOf(s)
  assert.ok(at('src="tour-logic.js"') > -1 && at('src="tour-logic.js"') < at('src="app.js"'))
  assert.ok(at('src="fx/tour.js"') > at('src="fx/keys.js"'))
  assert.ok(at('href="fx/tour.css"') > -1)
  const sw = readFileSync(join(PUB, 'sw.js'), 'utf8')
  for (const f of ["'tour-logic.js'", "'tour.js'", "'tour.css'"]) assert.ok(sw.includes(f), f)
  // fx/tour.js merkt sich nur "gesehen", nichts anderes im Browser
  const fx = readFileSync(join(PUB, 'fx', 'tour.js'), 'utf8')
  assert.deepEqual([...fx.matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1]), ['TL.SEEN_KEY'])
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(fx), 'kein Netzwerk')
  assert.ok(!/innerHTML/.test(fx), 'nur textContent')
})
