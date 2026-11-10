// Wochenrueckblick: reine Auswertung der Board-Ereignisse der letzten 7 Tage (ohne DOM, Netz, Uhr),
// benutzt von fx/week.js im Browser und von server.mjs fuer /week. Braucht fx/daystats.js
// (window.AgentBoardDayStats) fuer die aktive Zeit. Tage und Stunden zaehlen in der lokalen Zeit
// des Rechners; die Grenzen kommen aus dem Kalender (Date), nicht aus 24-Stunden-Schritten,
// damit die Sommerzeit-Umstellung stimmt (ein Tag mit 23 oder 25 Stunden). Liest nur, was das
// Board ohnehin hat: Zeit, Ereignisart, Session, Werkzeugname, Projektordner. Getestet in
// test/weekstats.test.mjs.
(function (root) {
'use strict'

const DAYS = 7
const MAX_TOOLS = 8, MAX_PROJECTS = 8
const srcOf = (e) => (e && (e.src === 'codex' || e.src === 'gemini') ? e.src : 'claude')
const PERM_NT = 'permission_prompt'
// Eine Notification "permission_prompt" direkt nach einer PermissionRequest derselben Session ist dieselbe Freigabe
const PERM_DEDUPE_MS = 10000

// Mitternacht (lokal) des Tages, in dem t liegt, plus n Kalendertage
function dayStartPlus(t, n) {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

// Nur der letzte Teil eines Namens, gekuerzt: nie Pfade nach aussen
function safeName(v, max) {
  const s = String(v == null ? '' : v).split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '')
  return s.length > max ? s.slice(0, max) : s
}

// Stundengrenzen eines Tages: 25 Werte, [h] bis [h+1] ist die lokale Stunde h.
// Faellt eine Stunde aus (Sommerzeit-Beginn), ist ihr Fach leer; wird eine doppelt (Winterzeit), ist ihr Fach 2 Stunden lang.
function hourBounds(dayStart) {
  const d = new Date(dayStart)
  const b = []
  for (let h = 0; h < 24; h++) b.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime())
  b.push(dayStartPlus(dayStart, 1))
  return b
}

function clipLen(iv, a, b) {
  let total = 0
  for (const [x, y] of iv) { const lo = Math.max(x, a), hi = Math.min(y, b); if (hi > lo) total += hi - lo }
  return total
}

// summarizeWeek(events, now): die 7 lokalen Tage bis einschliesslich heute (now), dazu die 7 Tage davor
// fuer den Vergleich. Ergebnis:
//   days[7]   { start, end, active, sessions, tools, approvals, errors }  (aelteste zuerst)
//   matrix[7][24]  aktive Millisekunden je Tag und lokaler Stunde
//   tools     [[name, count] ...] hoechstens 8
//   projects  [{ proj, active, sessions, tools } ...] hoechstens 8, laengste aktive Zeit zuerst; moreProjects = Rest
//   totals    { active, sessions, tools, approvals, errors }
//   prev      Summen der Vorwoche, null wenn es dort keine Ereignisse gab
function summarizeWeek(events, now) {
  const DS = root.AgentBoardDayStats
  const today = dayStartPlus(now, 0)
  const starts = []
  for (let i = -(2 * DAYS - 1); i <= 1; i++) starts.push(dayStartPlus(today, i)) // 15 Grenzen: 14 Tage
  const from = starts[0], to = starts[starts.length - 1]
  const dayOf = (t) => { // Index 0..13, oder -1
    if (t < from || t >= to) return -1
    let lo = 0, hi = 13
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= t) lo = m; else hi = m - 1 }
    return lo
  }
  const evs = []
  for (const e of events || []) {
    const t = Number(e && e.t)
    if (e && typeof e === 'object' && isFinite(t) && t >= from && t < to) evs.push(t === e.t ? e : { ...e, t })
  }
  evs.sort((a, b) => a.t - b.t)

  const rec = () => ({ sessions: new Set(), tools: 0, approvals: 0, errors: 0 })
  const per = Array.from({ length: 2 * DAYS }, rec)
  const toolCount = new Map() // nur die laufende Woche
  const sesProj = new Map(), lastPerm = new Map()
  const projAgg = new Map() // Name -> { sessions:Set, tools }
  const projOf = (id) => sesProj.get(id) || ''
  for (const e of evs) {
    const d = dayOf(e.t), id = `${srcOf(e)}:${e.sid || ''}`
    if (e.proj && typeof e.proj === 'string') sesProj.set(id, safeName(e.proj, 40))
    const p = per[d]
    p.sessions.add(id)
    if (e.ev === 'PreToolUse') {
      p.tools++
      if (d >= DAYS) {
        const name = safeName(e.tool === 'Skill' && e.what ? `Skill ${e.what}` : (e.tool || '?'), 40)
        toolCount.set(name, (toolCount.get(name) || 0) + 1)
      }
    } else if (e.ev === 'PostToolUseFailure' || e.ev === 'StopFailure') p.errors++
    else if (e.ev === 'PermissionRequest') { p.approvals++; lastPerm.set(id, e.t) }
    else if (e.ev === 'Notification' && e.nt === PERM_NT) {
      const lp = lastPerm.get(id)
      if (lp == null || e.t - lp > PERM_DEDUPE_MS) p.approvals++
      lastPerm.set(id, e.t)
    }
  }
  // Projektsummen der laufenden Woche (Projekt der Session = zuletzt gesehener Name)
  for (const e of evs) {
    if (dayOf(e.t) < DAYS) continue
    const id = `${srcOf(e)}:${e.sid || ''}`, name = projOf(id)
    let a = projAgg.get(name)
    if (!a) { a = { sessions: new Set(), tools: 0 }; projAgg.set(name, a) }
    a.sessions.add(id)
    if (e.ev === 'PreToolUse') a.tools++
  }

  // Aktive Intervalle ueber die ganzen 14 Tage (Runden ueber Mitternacht bleiben ganz), dann je Tag/Stunde zuschneiden
  const sum = DS ? DS.summarize(evs, from, to, { intervals: true, maxRows: 100000 }) : { intervals: [], commanders: [] }
  const iv = sum.intervals
  const mkDay = (i) => {
    const a = starts[i], b = starts[i + 1], p = per[i]
    return { start: a, end: b, active: DS ? DS.unionLength(iv.map(([x, y]) => [Math.max(x, a), Math.min(y, b)])) : 0, sessions: p.sessions.size, tools: p.tools, approvals: p.approvals, errors: p.errors }
  }
  const all = per.map((_, i) => mkDay(i))
  const days = all.slice(DAYS)
  const matrix = days.map((d) => {
    const b = hourBounds(d.start)
    const sub = iv.filter(([x, y]) => y > d.start && x < d.end)
    return Array.from({ length: 24 }, (_, h) => (DS ? DS.unionLength(sub.map(([x, y]) => [Math.max(x, b[h]), Math.min(y, b[h + 1])])) : 0))
  })
  const total = (arr) => ({
    active: arr.reduce((s, d) => s + d.active, 0), sessions: 0, tools: arr.reduce((s, d) => s + d.tools, 0),
    approvals: arr.reduce((s, d) => s + d.approvals, 0), errors: arr.reduce((s, d) => s + d.errors, 0),
  })
  const sessionsIn = (lo, hi) => { const s = new Set(); for (let i = lo; i < hi; i++) per[i].sessions.forEach((x) => s.add(x)); return s.size }
  const totals = total(days); totals.sessions = sessionsIn(DAYS, 2 * DAYS)
  const prevT = total(all.slice(0, DAYS)); prevT.sessions = sessionsIn(0, DAYS)
  const prevHas = per.slice(0, DAYS).some((p) => p.sessions.size > 0)

  // aktive Zeit je Projektname (alle Quellen), nur laufende Woche
  const wk = starts[DAYS]
  const byProj = new Map()
  for (const c of sum.commanders) {
    const name = safeName(c.proj, 40)
    byProj.set(name, (byProj.get(name) || []).concat(c.iv || []))
  }
  const projects = [...projAgg.entries()].map(([proj, a]) => ({
    proj, sessions: a.sessions.size, tools: a.tools,
    active: DS ? DS.unionLength((byProj.get(proj) || []).map(([x, y]) => [Math.max(x, wk), Math.min(y, to)])) : 0,
  })).sort((a, b) => b.active - a.active || b.tools - a.tools || (a.proj < b.proj ? -1 : 1))

  return {
    from: wk, to, days, matrix,
    tools: [...toolCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_TOOLS),
    projects: projects.slice(0, MAX_PROJECTS), moreProjects: Math.max(0, projects.length - MAX_PROJECTS),
    totals, prev: prevHas ? prevT : null,
  }
}

root.AgentBoardWeekStats = { summarizeWeek, dayStartPlus, hourBounds }
})(typeof window !== 'undefined' ? window : globalThis)
