// Tagesbilanz (public/fx/daystats.js): reine Auswertung eines Tages aus den Board-Ereignissen,
// dazu der Server-Endpunkt /day (daySummary in server.mjs) mit derselben Rechnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
vm.runInNewContext(readFileSync(join(PUB, 'fx', 'daystats.js'), 'utf8'), ctx)
const DS = ctx.window.AgentBoardDayStats
const { dayStart, unionLength, fmtActive } = DS
// Ergebnis aus dem vm-Kontext in normale Objekte dieses Kontexts holen (fuer deepEqual)
const summarize = (...a) => JSON.parse(JSON.stringify(DS.summarize(...a)))

const D0 = new Date(2026, 9, 12, 0, 0, 0).getTime() // 12.10.2026, 00:00 lokale Zeit
const D1 = new Date(2026, 9, 13, 0, 0, 0).getTime()
const at = (h, m = 0, s = 0) => new Date(2026, 9, 12, h, m, s).getTime()
const sec = 1000, min = 60000

test('dayStart liefert lokale Mitternacht', () => {
  assert.equal(dayStart(at(13, 45, 10)), D0)
  assert.equal(dayStart(D0), D0)
  assert.equal(dayStart(D1 - 1), D0)
})

test('unionLength zaehlt Ueberlappungen nur einmal', () => {
  assert.equal(unionLength([]), 0)
  assert.equal(unionLength([[0, 10], [5, 15], [20, 25]]), 20)
  assert.equal(unionLength([[0, 10], [2, 3]]), 10)
  assert.equal(unionLength([[5, 5], [7, 3]]), 0)
})

test('fmtActive ist kurz und lesbar', () => {
  assert.equal(fmtActive(0), '0 s')
  assert.equal(fmtActive(42 * sec), '42 s')
  assert.equal(fmtActive(12 * min + 30 * sec), '12 min')
  assert.equal(fmtActive(65 * min), '1 h 05 min')
})

test('leerer Tag', () => {
  const r = summarize([], D0, D1)
  assert.equal(r.first, 0)
  assert.equal(r.active, 0)
  assert.deepEqual(r.sessions, [])
  assert.deepEqual(r.tools, [])
  assert.equal(r.totals.tools, 0)
})

test('eine Runde: aktive Zeit vom Prompt bis Stop, Werkzeuge, Agents, Fehler', () => {
  const evs = [
    { t: at(9), ev: 'UserPromptSubmit', sid: 'a', proj: 'jarvis' },
    { t: at(9, 0, 5), ev: 'PreToolUse', sid: 'a', tool: 'Read', tid: '1' },
    { t: at(9, 0, 6), ev: 'PostToolUse', sid: 'a', tool: 'Read', tid: '1', dur: 1000 },
    { t: at(9, 1), ev: 'SubagentStart', sid: 'a', aid: 'x1' },
    { t: at(9, 1, 2), ev: 'PreToolUse', sid: 'a', aid: 'x1', tool: 'Bash', tid: '2' },
    { t: at(9, 1, 4), ev: 'PostToolUseFailure', sid: 'a', aid: 'x1', tool: 'Bash', tid: '2' },
    { t: at(9, 1, 5), ev: 'PreToolUse', sid: 'a', aid: 'x1', tool: 'Read', tid: '3' },
    { t: at(9, 1, 6), ev: 'PostToolUse', sid: 'a', aid: 'x1', tool: 'Read', tid: '3' },
    { t: at(9, 2), ev: 'SubagentStop', sid: 'a', aid: 'x1' },
    { t: at(9, 10), ev: 'Stop', sid: 'a', msg: 'fertig' },
  ]
  const r = summarize(evs, D0, D1)
  assert.equal(r.active, 10 * min)
  assert.equal(r.first, at(9))
  assert.equal(r.last, at(9, 10))
  assert.deepEqual(r.totals, { tools: 3, agents: 1, sessions: 1, rounds: 1, prompts: 1, errors: 1 })
  assert.deepEqual(r.tools, [['Read', 2], ['Bash', 1]])
  assert.equal(r.sessions.length, 1)
  const s = r.sessions[0]
  assert.equal(s.name, 'Claude'); assert.equal(s.proj, 'jarvis'); assert.equal(s.active, 10 * min)
  assert.equal(s.rounds, 1); assert.equal(s.tools, 3); assert.equal(s.agents, 1)
})

test('Pause zwischen zwei Runden zaehlt nicht als aktiv', () => {
  const evs = [
    { t: at(8), ev: 'UserPromptSubmit', sid: 'a' }, { t: at(8, 5), ev: 'Stop', sid: 'a' },
    { t: at(14), ev: 'UserPromptSubmit', sid: 'a' }, { t: at(14, 20), ev: 'Stop', sid: 'a' },
  ]
  const r = summarize(evs, D0, D1)
  assert.equal(r.active, 25 * min)
  assert.equal(r.totals.rounds, 2)
})

test('ohne gesehenen Prompt zaehlen Werkzeug-Aufrufe (z.B. Replay mitten in einer Runde)', () => {
  const evs = [
    { t: at(10, 0, 30), ev: 'PostToolUse', sid: 'a', tool: 'Bash', dur: 30000 }, // Pre lag vor dem Ausschnitt
    { t: at(10, 1), ev: 'PreToolUse', sid: 'a', tool: 'Edit', tid: 'e' },
    { t: at(10, 1, 10), ev: 'PostToolUse', sid: 'a', tool: 'Edit', tid: 'e' },
  ]
  const r = summarize(evs, D0, D1)
  assert.equal(r.active, 40 * sec)
})

test('offene Runde zaehlt bis zum letzten Ereignis, nicht bis jetzt', () => {
  const evs = [
    { t: at(11), ev: 'UserPromptSubmit', sid: 'a' },
    { t: at(11, 3), ev: 'PreToolUse', sid: 'a', tool: 'Bash', tid: 'b' },
  ]
  assert.equal(summarize(evs, D0, D1).active, 3 * min)
})

test('nur Ereignisse des Tages zaehlen', () => {
  const evs = [
    { t: D0 - min, ev: 'PreToolUse', sid: 'a', tool: 'Read' },
    { t: at(12), ev: 'PreToolUse', sid: 'a', tool: 'Grep' },
    { t: D1, ev: 'PreToolUse', sid: 'a', tool: 'Edit' },
  ]
  const r = summarize(evs, D0, D1)
  assert.equal(r.totals.tools, 1)
  assert.deepEqual(r.tools, [['Grep', 1]])
})

test('Kommandanten: gleichzeitige Sessions werden nummeriert, nacheinander laufende nicht', () => {
  const evs = [
    { t: at(9), ev: 'UserPromptSubmit', sid: 'a', proj: 'eins' },
    { t: at(9, 5), ev: 'UserPromptSubmit', sid: 'b', proj: 'zwei' },
    { t: at(9, 6), ev: 'UserPromptSubmit', sid: 'c', src: 'codex', proj: 'web' },
    { t: at(9, 20), ev: 'Stop', sid: 'a' },
    { t: at(9, 30), ev: 'Stop', sid: 'b' },
    { t: at(9, 40), ev: 'Stop', sid: 'c', src: 'codex' },
    { t: at(15), ev: 'UserPromptSubmit', sid: 'd', proj: 'drei' },
    { t: at(15, 10), ev: 'Stop', sid: 'd' },
  ]
  const r = summarize(evs, D0, D1)
  assert.deepEqual(r.sessions.map((s) => [s.name, s.proj, s.active]), [
    ['Claude', 'eins', 20 * min], ['Claude 2', 'zwei', 25 * min], ['Codex', 'web', 34 * min], ['Claude', 'drei', 10 * min],
  ])
  // Gesamtzeit: 9:00-9:40 und 15:00-15:10, Ueberlappungen nur einmal
  assert.equal(r.active, 50 * min)
  assert.equal(r.totals.sessions, 4)
})

test('gleiche Subagent-ID in zwei Sessions zaehlt doppelt, kaputte Zeilen werden uebersprungen', () => {
  const evs = [null, { ev: 'Stop' }, { t: 'x', ev: 'Stop' },
    { t: at(9), ev: 'SubagentStart', sid: 'a', aid: 'q' }, { t: at(9, 1), ev: 'SubagentStart', sid: 'b', aid: 'q' }]
  assert.equal(summarize(evs, D0, D1).totals.agents, 2)
})

test('Ausgabe enthaelt keine Ziele, Nachrichten oder Aufgaben', () => {
  const evs = [
    { t: at(9), ev: 'UserPromptSubmit', sid: 'a', len: 120 },
    { t: at(9, 1), ev: 'PreToolUse', sid: 'a', tool: 'Bash', what: 'cat geheim.txt', tid: 't' },
    { t: at(9, 2), ev: 'Stop', sid: 'a', msg: 'Antwort mit Inhalt', task: 'Aufgabe' },
  ]
  const txt = JSON.stringify(summarize(evs, D0, D1))
  for (const s of ['geheim', 'Antwort', 'Aufgabe']) assert.ok(!txt.includes(s), s)
})

test('Server: daySummary liest events.jsonl-Text mit derselben Rechnung', async () => {
  const { daySummary } = await import('../server.mjs')
  const lines = [
    JSON.stringify({ t: at(9), ev: 'UserPromptSubmit', sid: 'a' }),
    'kaputt{',
    JSON.stringify({ t: at(9, 1), ev: 'PreToolUse', sid: 'a', tool: 'Read', what: 'x.js' }),
    JSON.stringify({ t: at(9, 4), ev: 'Stop', sid: 'a' }),
    JSON.stringify({ t: D1 + min, ev: 'PreToolUse', sid: 'a', tool: 'Edit' }),
  ].join('\n') + '\n'
  const r = daySummary(D0, D1, lines)
  assert.equal(r.active, 4 * min)
  assert.equal(r.totals.tools, 1)
  assert.equal(r.sessions[0].name, 'Claude')
})
