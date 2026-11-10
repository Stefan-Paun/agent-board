// Wochenrueckblick (public/fx/weekstats.js): reine Auswertung von 7 Tagen. Zeitzone fest auf Wien,
// damit die Sommerzeit-Faelle auf jedem Rechner dasselbe Ergebnis liefern.
process.env.TZ = 'Europe/Vienna'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
for (const f of ['daystats.js', 'weekstats.js']) vm.runInNewContext(readFileSync(join(PUB, 'fx', f), 'utf8'), ctx)
const WS = ctx.window.AgentBoardWeekStats
const week = (evs, now) => JSON.parse(JSON.stringify(WS.summarizeWeek(evs, now)))
const min = 60000, h = 3600000
const at = (d, hh, mm = 0, ss = 0, mo = 10) => new Date(2026, mo, d, hh, mm, ss).getTime() // November 2026 (mo 10)
const NOW = at(10, 12) // Di 10.11.2026
const round = (d, hh, mm, len, sid = 'a', proj = 'eins', mo = 10) => [
  { t: at(d, hh, mm, 0, mo), ev: 'UserPromptSubmit', sid, proj },
  { t: at(d, hh, mm, 0, mo) + len, ev: 'Stop', sid },
]

test('leere Woche: 7 Tage, Matrix aus Nullen, keine Vorwoche', () => {
  const r = week([], NOW)
  assert.equal(r.days.length, 7)
  assert.equal(r.matrix.length, 7)
  assert.ok(r.matrix.every((row) => row.length === 24 && row.every((v) => v === 0)))
  assert.deepEqual(r.tools, [])
  assert.deepEqual(r.projects, [])
  assert.equal(r.totals.active, 0)
  assert.equal(r.prev, null)
  assert.equal(r.days[6].start, at(10, 0))
  assert.equal(r.days[0].start, at(4, 0))
  assert.equal(r.to, at(11, 0))
})

test('kaputte Eingaben werden uebersprungen', () => {
  const r = week([null, 5, 'x', {}, { t: 'abc', ev: 'Stop' }, { t: NaN }, ...round(10, 9, 0, 10 * min)], NOW)
  assert.equal(r.totals.active, 10 * min)
  assert.equal(r.totals.sessions, 1)
})

test('ein Tag: aktive Zeit, Sitzung, Werkzeuge, Freigaben, Fehler, Projekt', () => {
  const evs = [
    ...round(10, 9, 0, 30 * min),
    { t: at(10, 9, 5), ev: 'PreToolUse', sid: 'a', tool: 'Read', tid: '1' },
    { t: at(10, 9, 6), ev: 'PostToolUse', sid: 'a', tool: 'Read', tid: '1' },
    { t: at(10, 9, 7), ev: 'PreToolUse', sid: 'a', tool: 'Bash', tid: '2', what: '/Users/geheim/x' },
    { t: at(10, 9, 8), ev: 'PostToolUseFailure', sid: 'a', tool: 'Bash', tid: '2' },
    { t: at(10, 9, 9), ev: 'PermissionRequest', sid: 'a', tool: 'Bash' },
    { t: at(10, 9, 9) + 2000, ev: 'Notification', sid: 'a', nt: 'permission_prompt' }, // dieselbe Freigabe
    { t: at(10, 9, 20), ev: 'Notification', sid: 'a', nt: 'permission_prompt' }, // eine zweite, ohne PermissionRequest
    { t: at(10, 9, 21), ev: 'Notification', sid: 'a', nt: 'idle_prompt' },
  ]
  const r = week(evs, NOW)
  const d = r.days[6]
  assert.deepEqual([d.active, d.sessions, d.tools, d.approvals, d.errors], [30 * min, 1, 2, 2, 1])
  assert.equal(r.days[5].active, 0)
  assert.deepEqual(r.projects, [{ proj: 'eins', active: 30 * min, sessions: 1, tools: 2 }])
  assert.deepEqual(r.tools, [['Bash', 1], ['Read', 1]])
  assert.equal(r.matrix[6][9], 30 * min)
  assert.equal(r.matrix[6].reduce((a, b) => a + b, 0), 30 * min)
  assert.equal(JSON.stringify(r).includes('geheim'), false)
})

test('Tagesgrenze: eine Runde ueber Mitternacht wird auf beide Tage verteilt', () => {
  const r = week([
    { t: at(9, 23, 30), ev: 'UserPromptSubmit', sid: 'a', proj: 'eins' },
    { t: at(10, 0, 20), ev: 'Stop', sid: 'a' },
  ], NOW)
  assert.equal(r.days[5].active, 30 * min)
  assert.equal(r.days[6].active, 20 * min)
  assert.equal(r.matrix[5][23], 30 * min)
  assert.equal(r.matrix[6][0], 20 * min)
  assert.equal(r.totals.active, 50 * min)
  assert.equal(r.totals.sessions, 1)
  assert.equal(r.days[5].sessions + r.days[6].sessions, 2) // je Tag mit Aktivitaet gezaehlt, Summe zaehlt einmal
  // genau um 00:00 gehoert das Ereignis zum neuen Tag
  const e = week([{ t: at(10, 0), ev: 'PreToolUse', sid: 'a', tool: 'Read' }], NOW)
  assert.equal(e.days[6].tools, 1); assert.equal(e.days[5].tools, 0)
})

test('Fenster: aelter als 14 Tage und in der Zukunft zaehlt nicht', () => {
  const r = week([...round(10, 9, 0, 10 * min), ...round(26, 9, 0, 10 * min, 'b', 'x', 9), ...round(11, 9, 0, 10 * min, 'c')], NOW)
  assert.equal(r.totals.sessions, 1)
  assert.equal(r.prev, null)
})

test('Vorwoche: Summen, wenn dort Ereignisse liegen', () => {
  const r = week([...round(10, 9, 0, 10 * min), ...round(3, 9, 0, 20 * min, 'b'), { t: at(3, 10), ev: 'PreToolUse', sid: 'b', tool: 'Read' }], NOW)
  assert.deepEqual(r.prev, { active: 20 * min, sessions: 1, tools: 1, approvals: 0, errors: 0 })
  assert.equal(r.totals.active, 10 * min)
  assert.deepEqual(r.tools, []) // Werkzeuge nur der laufenden Woche
})

test('die 8 haeufigsten Werkzeuge, Skills einzeln, Projekte gekuerzt und ohne Pfade', () => {
  const evs = []
  for (let k = 0; k < 10; k++) for (let n = 0; n <= k; n++) evs.push({ t: at(9, 10, k, n), ev: 'PreToolUse', sid: 's', tool: 'T' + k })
  evs.push({ t: at(9, 11), ev: 'PreToolUse', sid: 's', tool: 'Skill', what: 'review' })
  evs.push({ t: at(9, 12), ev: 'UserPromptSubmit', sid: 's', proj: '/Users/jemand/privat/mein-projekt' })
  const r = week(evs, NOW)
  assert.equal(r.tools.length, 8)
  assert.deepEqual(r.tools[0], ['T9', 10])
  assert.equal(r.projects[0].proj, 'mein-projekt')
  const many = []
  for (let k = 0; k < 11; k++) many.push(...round(9, 8, k, (k + 1) * min, 's' + k, 'p' + k))
  const m = week(many, NOW)
  assert.equal(m.projects.length, 8)
  assert.equal(m.moreProjects, 3)
  assert.equal(m.projects[0].proj, 'p10')
})

test('Sommerzeit-Beginn (29.3.2026): Tag mit 23 Stunden, Stunde 2 leer, Runde 1:30-3:30 = 1 Stunde', () => {
  const now = new Date(2026, 2, 29, 12).getTime()
  const t0 = new Date(2026, 2, 29, 1, 30).getTime()
  const t1 = new Date(2026, 2, 29, 3, 30).getTime()
  assert.equal(t1 - t0, 1 * h) // zwischen 1:30 und 3:30 liegt nur eine echte Stunde
  const r = week([{ t: t0, ev: 'UserPromptSubmit', sid: 'a', proj: 'x' }, { t: t1, ev: 'Stop', sid: 'a' }], now)
  const d = r.days[6]
  assert.equal(d.end - d.start, 23 * h)
  assert.equal(d.active, 1 * h)
  assert.equal(r.matrix[6][1], 30 * min)
  assert.equal(r.matrix[6][2], 0)
  assert.equal(r.matrix[6][3], 30 * min)
  assert.equal(r.days[5].end - r.days[5].start, 24 * h)
  assert.equal(r.days[6].start, new Date(2026, 2, 29).getTime())
})

test('Sommerzeit-Ende (25.10.2026): Tag mit 25 Stunden, doppelte Stunde 2 zaehlt komplett', () => {
  const now = new Date(2026, 9, 25, 18).getTime()
  const t0 = new Date(2026, 9, 25, 0, 0).getTime()
  const t1 = new Date(2026, 9, 25, 5, 0).getTime()
  assert.equal(t1 - t0, 6 * h)
  const r = week([{ t: t0, ev: 'UserPromptSubmit', sid: 'a', proj: 'x' }, { t: t1, ev: 'Stop', sid: 'a' }], now)
  const d = r.days[6]
  assert.equal(d.end - d.start, 25 * h)
  assert.equal(d.active, 6 * h)
  assert.equal(r.matrix[6][2], 2 * h) // beide Durchlaeufe der Stunde 2 in einem Fach
  assert.equal(r.matrix[6].reduce((a, b) => a + b, 0), 6 * h)
  // der Folgetag beginnt wieder um lokale Mitternacht
  assert.equal(WS.dayStartPlus(now, 1), new Date(2026, 9, 26).getTime())
})

test('deltaPct: Prozent zur Vorwoche, null ohne Vergleichswert', () => {
  assert.equal(WS.deltaPct(120, 100), 20)
  assert.equal(WS.deltaPct(50, 100), -50)
  assert.equal(WS.deltaPct(5, 0), null)
  assert.equal(WS.deltaPct(NaN, 10), null)
})

test('demoWeek hat dieselbe Form wie summarizeWeek und stimmige Summen', () => {
  const d = JSON.parse(JSON.stringify(WS.demoWeek(NOW)))
  const real = week([], NOW)
  assert.deepEqual(Object.keys(d).filter((k) => k !== 'demo').sort(), Object.keys(real).sort())
  assert.equal(d.days.length, 7)
  assert.equal(d.days[6].start, real.days[6].start)
  assert.equal(d.matrix.length, 7)
  d.days.forEach((day, i) => assert.equal(day.active, d.matrix[i].reduce((a, b) => a + b, 0)))
  assert.equal(d.totals.active, d.days.reduce((a, b) => a + b.active, 0))
  assert.equal(d.tools.length, 8)
  assert.ok(d.prev.active > 0)
})
