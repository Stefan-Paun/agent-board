// Hemdfarben nach Agent-Typ (public/agent-types.js)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
vm.runInNewContext(readFileSync(join(PUB, 'agent-types.js'), 'utf8'), ctx)
const { TYPES, OTHER, colorFor, legendFor } = ctx.window.AgentBoardTypes

test('bekannte Typen haben feste, verschiedene Farben', () => {
  const cols = ['Explore', 'Plan', 'general-purpose'].map(colorFor)
  assert.equal(new Set([...cols, OTHER.color]).size, 4)
  for (const c of cols) assert.match(c, /^#[0-9a-f]{6}$/)
})

test('Gross-/Kleinschreibung und Codex-Alias zaehlen nicht', () => {
  assert.equal(colorFor('EXPLORE'), colorFor('Explore'))
  assert.equal(colorFor(' plan '), colorFor('Plan'))
  assert.equal(colorFor('explorer'), colorFor('Explore'))
})

test('unbekannte oder fehlende Typen sind neutral', () => {
  for (const t of ['my-custom', '', null, undefined, 'agent', 42]) assert.equal(colorFor(t), OTHER.color)
})

test('Legende: nur vorkommende Typen, feste Reihenfolge, neutral zuletzt, ohne Duplikate', () => {
  assert.equal(legendFor([]).length, 0)
  const l = legendFor(['foo', 'general-purpose', 'Explore', 'explorer', 'bar'])
  assert.equal(l.map((x) => x.key).join(), 'explore,general-purpose,other')
  assert.equal(l[0].color, colorFor('Explore'))
  assert.equal(TYPES.length, 3)
})
