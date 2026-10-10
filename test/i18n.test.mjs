// Uebersetzungen: jede Sprache hat jeden Schluessel, Platzhalter stimmen ueberein, und kein Modul
// benutzt einen Schluessel, den es nicht gibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

function load(lang) {
  const store = {}
  const ctx = {
    window: {}, location: { search: `?lang=${lang}` },
    navigator: { languages: [lang], language: lang },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) } },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: () => null },
    URLSearchParams,
  }
  vm.runInNewContext(readFileSync(join(PUB, 'i18n.js'), 'utf8'), ctx)
  return ctx.window.AgentBoardI18n
}

const src = readFileSync(join(PUB, 'i18n.js'), 'utf8')
const rows = [...src.matchAll(/^\s*'([\w.]+)': \[/gm)].map((m) => m[1])

test('Sprache kommt aus ?lang und faellt sonst auf Englisch zurueck', () => {
  assert.equal(load('de').lang, 'de')
  assert.equal(load('en').lang, 'en')
  assert.equal(load('es').lang, 'es')
  assert.equal(load('fr').lang, 'en')
  assert.equal(load('es').t('room.werkstatt'), 'Taller')
  assert.equal(load('de').t('room.werkstatt'), 'Werkstatt')
  assert.equal(load('en').t('room.werkstatt'), 'Workshop')
})

test('jeder Schluessel hat alle Sprachen, alle Platzhalter werden ersetzt', () => {
  const all = ['en', 'de', 'es'].map(load)
  const table = all[0].table
  assert.deepEqual([...all[0].langs], ['en', 'de', 'es'])
  assert.ok(rows.length > 100, `nur ${rows.length} Schluessel gefunden`)
  for (const k of rows) {
    // keine Sprache darf fehlen (sonst faellt sie still auf Englisch zurueck)
    assert.equal(table[k].length, all[0].langs.length, `${k}: ${table[k].length} statt ${all[0].langs.length} Sprachen`)
    const vars = { n: 2, name: 'X', who: 'X', tool: 'T', what: 'w', dur: '1 s', role: 'r', proj: 'p', to: 'A', txt: 't', text: 't', det: '', target: 'g', tok: '', ago: 'a', err: 'e', trig: '', time: '1', tracks: 1, calls: 1, t: '1', verb: 'v', doing: 'd', win: 8 }
    for (const L of all) {
      const v = L.t(k, vars)
      assert.equal(typeof v, 'string', `${k} (${L.lang})`)
      assert.ok(!/\{\w+\}/.test(v), `${k} (${L.lang}): Platzhalter nicht ersetzt: ${v}`)
    }
  }
})

test('alle im Code benutzten Schluessel existieren', () => {
  const files = ['app.js', ...readdirSync(join(PUB, 'fx')).filter((f) => f.endsWith('.js')).map((f) => 'fx/' + f)]
  const keys = new Set(rows)
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  const used = [
    ...files.flatMap((f) => [...readFileSync(join(PUB, f), 'utf8').matchAll(/\bT\('([\w.]+)'/g)].map((m) => [f, m[1]])),
    ...[...html.matchAll(/data-i18n(?:-html|-cmd)?="([\w.]+)"/g)].map((m) => ['index.html', m[1]]),
    ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(';').map((p) => ['index.html', p.split(':')[1]])),
  ]
  assert.ok(used.length > 100)
  for (const [f, k] of used) {
    // zusammengesetzte Schluessel ('h.verb.' + tool): es muss Eintraege mit diesem Anfang geben
    if (k.endsWith('.')) assert.ok(rows.some((r) => r.startsWith(k)), `${f}: keine Schluessel ${k}*`)
    else assert.ok(keys.has(k), `${f}: unbekannter Schluessel ${k}`)
  }
})
