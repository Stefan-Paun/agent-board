// Tastenkuerzel (public/fx/keys.js): Zuordnung Taste -> Aktion und die Zeilen der Hilfe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
ctx.globalThis = ctx.window
vm.runInNewContext(readFileSync(join(PUB, 'fx', 'keys.js'), 'utf8'), ctx)
const { keyAction, ROWS } = ctx.window.AgentBoardKeys

test('H, T und ? loesen ihre Aktion aus (auch grossgeschrieben)', () => {
  assert.equal(keyAction({ key: 'h' }), 'history')
  assert.equal(keyAction({ key: 'H' }), 'history')
  assert.equal(keyAction({ key: 't' }), 'today')
  assert.equal(keyAction({ key: 'T' }), 'today')
  assert.equal(keyAction({ key: '?' }), 'help')
})

test('andere Tasten und Kuerzel mit Strg/Cmd/Alt tun nichts', () => {
  for (const key of ['a', 'k', 'm', 'Escape', 'Enter', ' ']) assert.equal(keyAction({ key }), null, key)
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(keyAction({ key: 'h', [mod]: true }), null, mod)
  assert.equal(keyAction(null), null)
  assert.equal(keyAction({}), null)
})

test('beim Tippen in ein Eingabefeld loest nichts aus', () => {
  for (const key of ['h', 't', '?']) assert.equal(keyAction({ key }, true), null, key)
})

test('jede Hilfezeile hat einen Schluessel in allen drei Sprachen', () => {
  const i18n = readFileSync(join(PUB, 'i18n.js'), 'utf8')
  assert.ok(ROWS.length >= 6)
  for (const [, id] of ROWS) {
    const m = i18n.match(new RegExp(`'${id.replace('.', '\\.')}': \\[('[^']*'|"[^"]*"), ('[^']*'|"[^"]*"), ('[^']*'|"[^"]*")\\]`))
    assert.ok(m, `${id} fehlt in i18n.js`)
  }
})
