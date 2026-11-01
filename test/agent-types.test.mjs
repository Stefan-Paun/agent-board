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
  const names = ['Explore', 'Plan', 'general-purpose', 'claude-code-guide', 'statusline-setup', 'Bash']
  const cols = names.map(colorFor)
  assert.equal(new Set([...cols, OTHER.color]).size, names.length + 1)
  for (const c of cols) assert.match(c, /^#[0-9a-f]{6}$/)
})

test('Gross-/Kleinschreibung und Codex-Alias zaehlen nicht', () => {
  assert.equal(colorFor('EXPLORE'), colorFor('Explore'))
  assert.equal(colorFor(' plan '), colorFor('Plan'))
  assert.equal(colorFor('explorer'), colorFor('Explore'))
})

test('fehlende oder generische Typen sind neutral', () => {
  for (const t of ['', null, undefined, 'agent', 42]) assert.equal(colorFor(t), OTHER.color)
})

test('eigene Typen: stabile Hash-Farbe, nicht neutral, je Name verschieden', () => {
  const c = colorFor('reviewer')
  assert.match(c, /^#[0-9a-f]{6}$/)
  assert.equal(colorFor('reviewer'), c)
  assert.equal(colorFor(' Reviewer '), c)
  assert.notEqual(c, OTHER.color)
  assert.notEqual(colorFor('recherche'), c)
  // pinned value: fails if the hash or the colour formula changes between releases
  assert.equal(c, '#4d9dcb')
  assert.equal(colorFor('my-custom'), colorFor('MY-CUSTOM'))
})

test('Legende: nur vorkommende Typen, feste Reihenfolge, neutral zuletzt, ohne Duplikate', () => {
  assert.equal(legendFor([]).length, 0)
  const l = legendFor(['agent', 'general-purpose', 'Explore', 'explorer', ''])
  assert.equal(l.map((x) => x.key).join(), 'explore,general-purpose,other')
  assert.equal(l[0].color, colorFor('Explore'))
  assert.equal(TYPES.length, 6)
})

test('Legende: eigene Typen mit Namen und Hash-Farbe, alphabetisch zwischen festen und other', () => {
  const l = legendFor(['zeta', 'agent', 'Plan', 'reviewer', 'Reviewer'])
  assert.equal(l.map((x) => x.key).join(), 'plan,reviewer,zeta,other')
  assert.equal(l[1].label, 'reviewer')
  assert.equal(l[1].color, colorFor('reviewer'))
})

test('Legende bei nur generischem Typ: nur "other"', () => {
  assert.equal(legendFor(['agent']).map((x) => x.key).join(), 'other')
})
