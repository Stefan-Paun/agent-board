// Server nach dem Kuerzen von events.jsonl: das naechste Ereignis darf nicht verloren gehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumeOffset } from '../server.mjs'

test('nach dem Kuerzen geht der Server hinter der zuletzt gesendeten Zeile weiter', () => {
  // vorher gesendet: ...{"n":2}; gekuerzte Datei behaelt 1-2, danach kam 3 dazu
  const buf = Buffer.from('{"n":1}\n{"n":2}\n{"n":3}\n')
  const off = resumeOffset(buf, '{"n":2}')
  assert.equal(buf.subarray(off).toString(), '{"n":3}\n')
})

test('ist die zuletzt gesendete Zeile nicht mehr da, kommt alles in der Datei als neu', () => {
  assert.equal(resumeOffset(Buffer.from('{"n":7}\n'), '{"n":2}'), 0)
  assert.equal(resumeOffset(Buffer.from('{"n":7}\n'), null), 0)
})

// Kuerzen nach Zeit statt nur nach Zeilenzahl (#55): "Heute" darf durch das Kuerzen nicht schrumpfen.
import { trimLines } from '../collector.mjs'
import { daySummary } from '../server.mjs'

const H = 3600 * 1000
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)
const synth = (n, spanH) => Array.from({ length: n }, (_, i) =>
  JSON.stringify({ t: NOW - spanH * H + Math.floor((i / n) * spanH * H), ev: 'PreToolUse', tool: i % 2 ? 'Bash' : 'Edit', sid: 's1' }))

test('trimLines behaelt alle Zeilen der letzten 48 h und wirft aeltere weg', () => {
  const lines = synth(6000, 72)
  const out = trimLines(lines, NOW)
  const expected = lines.filter((l) => JSON.parse(l).t >= NOW - 48 * H)
  assert.ok(expected.length > 1500)
  assert.deepEqual(out, expected)
})

test('trimLines behaelt mindestens 1500 Zeilen, auch wenn alles aelter als 48 h ist', () => {
  const lines = synth(3000, 200).map((l) => JSON.stringify({ ...JSON.parse(l), t: JSON.parse(l).t - 100 * H }))
  assert.deepEqual(trimLines(lines, NOW), lines.slice(-1500))
})

test('trimLines haelt die harte Obergrenze von 20000 Zeilen ein', () => {
  const lines = synth(25000, 10)
  const out = trimLines(lines, NOW)
  assert.equal(out.length, 20000)
  assert.equal(out.at(-1), lines.at(-1))
})

test('Tagessumme eines Tages bleibt nach dem Kuerzen gleich (alte Regel: nur 1500 Zeilen, schrumpft)', () => {
  const lines = synth(6000, 72)
  const from = Date.UTC(2026, 10, 9, 0, 0, 0), to = from + 24 * H // gestern, liegt in den 48 h
  const before = daySummary(from, to, lines.join('\n') + '\n')
  assert.ok(before.totals.tools > 1000)
  assert.deepEqual(daySummary(from, to, trimLines(lines, NOW).join('\n') + '\n'), before)
  assert.notDeepEqual(daySummary(from, to, lines.slice(-1500).join('\n') + '\n'), before)
})
