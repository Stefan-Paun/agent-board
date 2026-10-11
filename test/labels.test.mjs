// Tisch-Beschriftungen (public/labels.js): passen in die Tischbreite, kuerzen erst die Schrift,
// dann den Projektnamen - der Zustand ("working") bleibt immer ganz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
vm.runInNewContext(readFileSync(join(PUB, 'labels.js'), 'utf8'), ctx)
const { ellipsize, fitLabel, deskSubtitle } = ctx.window.AgentBoardLabels

// Attrappe: jedes Zeichen ist 0.6 * px breit
const measure = (s, px) => s.length * px * 0.6
const m10 = (s) => measure(s, 10)

test('ellipsize laesst passende Texte in Ruhe und kuerzt sonst mit …', () => {
  assert.equal(ellipsize('jarvis', 100, m10), 'jarvis')
  const r = ellipsize('agent-board', 40, m10)
  assert.ok(r.endsWith('…'))
  assert.ok(m10(r) <= 40)
  assert.equal(r, 'agent…') // 6 Zeichen = 36 <= 40, 7 Zeichen = 42 > 40
  assert.equal(ellipsize('abc', 3, m10), '')
})

test('ohne Breitengrenze (ein Tisch) bleibt alles unveraendert', () => {
  assert.deepEqual({ ...fitLabel('Claude', 13, 10, Infinity, measure) }, { text: 'Claude', px: 13 })
  assert.deepEqual({ ...deskSubtitle('agent-board', 'working', 10, 9, Infinity, measure) }, { text: 'agent-board · working', px: 10 })
})

test('was passt, behaelt Text und Schriftgroesse (2 Tische sehen aus wie vorher)', () => {
  assert.deepEqual({ ...fitLabel('Codex', 13, 10, 200, measure) }, { text: 'Codex', px: 13 })
  const full = 'website · working'
  assert.deepEqual({ ...deskSubtitle('website', 'working', 10, 9, measure(full, 10), measure) }, { text: full, px: 10 })
})

test('etwas zu breit: erst kleinere Schrift statt Kuerzen', () => {
  const r = fitLabel('Claude 2', 13, 10, measure('Claude 2', 12), measure)
  assert.deepEqual({ ...r }, { text: 'Claude 2', px: 12 })
})

test('viel zu breit: Projekt wird gekuerzt, der Zustand bleibt ganz', () => {
  const maxW = 80
  const r = deskSubtitle('agent-board', 'working', 10, 9, maxW, measure)
  assert.equal(r.px, 9)
  assert.ok(r.text.endsWith(' · working'), r.text)
  assert.ok(r.text.includes('…'), r.text)
  assert.ok(measure(r.text, r.px) <= maxW)
})

test('kein Platz mehr fuer das Projekt: nur der Zustand, notfalls gekuerzt', () => {
  const r = deskSubtitle('agent-board', 'working', 10, 9, measure('working', 9) + 1, measure)
  assert.deepEqual({ ...r }, { text: 'working', px: 9 })
  const r2 = deskSubtitle('agent-board', 'working', 10, 9, 30, measure)
  assert.ok(measure(r2.text, r2.px) <= 30)
  assert.ok(r2.text.endsWith('…'))
})

test('ohne Projekt wird nur der Zustand eingepasst', () => {
  assert.deepEqual({ ...deskSubtitle('', 'waiting', 10, 9, 500, measure) }, { text: 'waiting', px: 10 })
})

test('vier Tische nebeneinander: keine Beschriftung ragt in den Nachbartisch', () => {
  const step = 66, slotW = step - 8
  const subs = [['agent-board', 'working'], ['website', 'working'], ['jarvis', 'waiting'], ['a-really-long…', 'working']]
  const names = ['Claude', 'Codex', 'Claude 2', 'Codex 2']
  for (let i = 0; i < 4; i++) {
    const n = fitLabel(names[i], 13, 10, slotW, measure)
    const s = deskSubtitle(subs[i][0], subs[i][1], 10, 9, slotW, measure)
    assert.ok(measure(n.text, n.px) <= slotW, n.text)
    assert.ok(measure(s.text, s.px) <= slotW, s.text)
  }
})
