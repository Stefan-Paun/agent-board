// Issue-Templates und CONTRIBUTING: ein kleiner Zeilen-Parser (ohne Abhaengigkeit) fuer das YAML-Teilset
// der GitHub Issue Forms prueft Pflichtfelder, Labels und eindeutige ids.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, '.github', 'ISSUE_TEMPLATE')

const scalar = (s) => {
  s = s.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  const q = s.match(/^"(.*)"$|^'(.*)'$/)
  return q ? (q[1] ?? q[2]) : s
}

// Teilset: "key: wert", "key:" mit eingerueckter Map oder Liste, "- item", "- key: wert", "key: |" Textbloecke.
function parse(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((raw, i) => ({ raw, n: i + 1 }))
    .filter(({ raw }) => raw.trim() !== '' && !raw.trim().startsWith('#'))
  let pos = 0
  const indentOf = (l) => l.raw.match(/^ */)[0].length
  function block(indent) {
    const first = lines[pos]
    if (first.raw.trim().startsWith('- ') || first.raw.trim() === '-') return list(indent)
    return map(indent)
  }
  function value(rest, parentIndent, n) {
    if (rest === '|' || rest === '>') {
      const out = []
      while (pos < lines.length && indentOf(lines[pos]) > parentIndent) out.push(lines[pos++].raw.trim())
      return out.join('\n')
    }
    if (rest !== '') return scalar(rest)
    if (pos < lines.length && (indentOf(lines[pos]) > parentIndent ||
        (indentOf(lines[pos]) === parentIndent && lines[pos].raw.trim().startsWith('- ')))) {
      return block(indentOf(lines[pos]))
    }
    return null
  }
  function map(indent, obj = {}) {
    while (pos < lines.length && indentOf(lines[pos]) === indent && !lines[pos].raw.trim().startsWith('- ')) {
      const l = lines[pos++]
      const m = l.raw.trim().match(/^([\w-]+):(?: (.*))?$/)
      if (!m) throw new Error(`Zeile ${l.n}: kein "key: wert": ${l.raw}`)
      if (m[1] in obj) throw new Error(`Zeile ${l.n}: doppelter Schluessel ${m[1]}`)
      obj[m[1]] = value((m[2] ?? '').trim(), indent, l.n)
    }
    if (pos < lines.length && indentOf(lines[pos]) > indent) throw new Error(`Zeile ${lines[pos].n}: unerwartete Einrueckung`)
    return obj
  }
  function list(indent) {
    const arr = []
    while (pos < lines.length && indentOf(lines[pos]) === indent && lines[pos].raw.trim().startsWith('- ')) {
      const l = lines[pos]
      const rest = l.raw.trim().slice(2)
      if (/^[\w-]+:(?: |$)/.test(rest)) {
        // Map-Element: erste Zeile umschreiben, Folgezeilen gehoeren dazu
        lines[pos] = { raw: ' '.repeat(indent + 2) + rest, n: l.n }
        arr.push(map(indent + 2))
      } else { pos++; arr.push(scalar(rest)) }
    }
    return arr
  }
  const doc = map(0)
  if (pos < lines.length) throw new Error(`Zeile ${lines[pos].n}: nicht verarbeitet`)
  return doc
}

test('Parser versteht das benutzte YAML-Teilset', () => {
  const d = parse('a: 1\nl:\n  - x\n  - y\nb:\n  - type: t\n    attributes:\n      v: |\n        z\n        w\n    id: q\n')
  assert.deepEqual(d, { a: '1', l: ['x', 'y'], b: [{ type: 't', attributes: { v: 'z\nw' }, id: 'q' }] })
  assert.throws(() => parse('a: 1\na: 2\n'), /doppelter/)
  assert.throws(() => parse('a: 1\n  b: 2\n'), /Einrueckung/)
})

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'))

test('es gibt bug, feature, language und config', () => {
  for (const f of ['bug.yml', 'feature.yml', 'language.yml', 'config.yml']) assert.ok(files.includes(f), f)
})

test('config.yml schaltet leere Issues aus', () => {
  const c = parse(readFileSync(join(DIR, 'config.yml'), 'utf8'))
  assert.equal(c.blank_issues_enabled, false)
})

for (const f of files.filter((x) => x !== 'config.yml')) {
  test(`${f}: gueltiges Issue Form`, () => {
    const t = parse(readFileSync(join(DIR, f), 'utf8'))
    for (const k of ['name', 'description']) assert.ok(typeof t[k] === 'string' && t[k], `${k} fehlt`)
    assert.ok(Array.isArray(t.labels) && t.labels.length > 0, 'labels muss eine Liste sein')
    assert.ok(Array.isArray(t.body) && t.body.length > 0, 'body braucht Elemente')
    const ids = []
    for (const el of t.body) {
      assert.ok(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'].includes(el.type), `unbekannter type ${el.type}`)
      assert.ok(el.attributes && typeof el.attributes === 'object', 'attributes fehlt')
      if (el.type === 'markdown') { assert.ok(el.attributes.value, 'markdown ohne value'); continue }
      assert.ok(el.id, `${el.type} ohne id`)
      assert.ok(el.attributes.label, `${el.id}: label fehlt`)
      if (el.type === 'dropdown') assert.ok(Array.isArray(el.attributes.options) && el.attributes.options.length, `${el.id}: options`)
      ids.push(el.id)
    }
    assert.equal(new Set(ids).size, ids.length, 'ids nicht eindeutig')
    assert.ok(ids.length > 0, 'kein Eingabefeld')
  })
}

test('CONTRIBUTING.md nennt dependencies, i18n, privacy und Sprach-Anleitung', () => {
  const c = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  for (const re of [/dependenc/i, /i18n/i, /privacy/i, /## Add a language/, /good first issue/]) assert.match(c, re)
  assert.doesNotMatch(c, /\/Users\/|@gmail\./i)
})

test('PR-Template und READMEs verweisen auf CONTRIBUTING', () => {
  assert.match(readFileSync(join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8'), /i18n/)
  for (const r of ['README.md', 'README.de.md']) assert.match(readFileSync(join(ROOT, r), 'utf8'), /CONTRIBUTING\.md/)
})
