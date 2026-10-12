// Tagesbilanz: reine Auswertung der Ereignisse eines Tages (ohne DOM), benutzt von fx/day.js im
// Browser und von server.mjs fuer /day. Liest nur, was das Board ohnehin hat (events.jsonl bzw.
// S.events): Zeit, Ereignisart, Session, Subagent, Werkzeugname, Projektordner. Getestet in
// test/daystats.test.mjs.
(function (root) {
'use strict'

const SRC_NAME = { claude: 'Claude', codex: 'Codex' }
const srcOf = (e) => (e && e.src === 'codex' ? 'codex' : 'claude')

// Mitternacht (lokale Zeit) des Tages, in dem t liegt
function dayStart(t) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Intervalle [a, b] vereinigen und die Gesamtlaenge liefern
function unionLength(iv) {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0, ca = -Infinity, cb = -Infinity
  for (const [a, b] of s) {
    if (a > cb) { if (cb > ca) total += cb - ca; ca = a; cb = b } else if (b > cb) cb = b
  }
  if (cb > ca) total += cb - ca
  return total
}

// Auswertung aller Ereignisse mit from <= t < to.
// Aktive Zeit je Session = Vereinigung aus Runden (Prompt bis Stop), Werkzeug-Aufrufen und
// Subagent-Laufzeiten. Eine noch offene Runde zaehlt bis zum letzten Ereignis der Session.
function summarize(events, from, to) {
  const sessions = new Map()
  const toolCount = new Map()
  const agents = new Set()
  let tools = 0, errors = 0, rounds = 0, prompts = 0, first = 0, last = 0
  const ses = (e) => {
    const id = `${srcOf(e)}:${e.sid || ''}`
    let s = sessions.get(id)
    if (!s) {
      s = { id, src: srcOf(e), proj: '', first: e.t, last: e.t, iv: [], round: null, open: new Map(), agentStart: new Map(),
        agents: new Set(), tools: 0, rounds: 0 }
      sessions.set(id, s)
    }
    return s
  }
  for (const e of events || []) {
    const t = Number(e && e.t)
    if (!e || !isFinite(t) || t < from || t >= to) continue
    if (!first || t < first) first = t
    if (t > last) last = t
    const s = ses(e)
    if (t < s.first) s.first = t
    if (t > s.last) s.last = t
    if (e.proj && typeof e.proj === 'string') s.proj = e.proj
    if (e.aid) { agents.add(`${s.id}/${e.aid}`); s.agents.add(e.aid) }
    switch (e.ev) {
      case 'UserPromptSubmit':
        prompts++
        if (!s.round) s.round = t
        break
      case 'Stop':
      case 'StopFailure':
      case 'SessionEnd':
        if (e.aid) break
        if (e.ev === 'Stop') { rounds++; s.rounds++ }
        if (e.ev === 'StopFailure') errors++
        if (s.round != null) { s.iv.push([s.round, t]); s.round = null }
        break
      case 'PreToolUse': {
        tools++; s.tools++
        const name = String(e.tool || '?')
        toolCount.set(name, (toolCount.get(name) || 0) + 1)
        s.open.set(e.tid || `${e.aid || ''}:${name}`, t)
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (e.ev === 'PostToolUseFailure') errors++
        const k = e.tid || `${e.aid || ''}:${e.tool || '?'}`
        const t0 = s.open.has(k) ? s.open.get(k) : (Number(e.dur) >= 0 ? t - Number(e.dur) : t)
        s.open.delete(k)
        s.iv.push([Math.max(from, t0), t])
        break
      }
      case 'SubagentStart': if (e.aid) s.agentStart.set(e.aid, t); break
      case 'SubagentStop':
        if (e.aid && s.agentStart.has(e.aid)) { s.iv.push([s.agentStart.get(e.aid), t]); s.agentStart.delete(e.aid) }
        break
    }
  }
  const list = [...sessions.values()].sort((a, b) => a.first - b.first)
  // Namen wie auf dem Board: "Claude", "Claude 2", ... - kleinste Nummer, die keine zeitgleich laufende
  // Session derselben Quelle hat (nacheinander laufende Sessions heissen also beide "Claude")
  const named = []
  for (const s of list) {
    const used = new Set(named.filter((o) => o.src === s.src && o.last >= s.first).map((o) => o.num))
    let num = 1
    while (used.has(num)) num++
    s.num = num
    named.push(s)
  }
  const all = []
  const out = list.map((s) => {
    // offene Runde / Werkzeug / Subagent: bis zum letzten Ereignis der Session
    if (s.round != null) s.iv.push([s.round, s.last])
    for (const t0 of s.open.values()) s.iv.push([t0, s.last])
    for (const t0 of s.agentStart.values()) s.iv.push([t0, s.last])
    all.push(...s.iv)
    return { id: s.id, src: s.src, num: s.num, name: s.num > 1 ? `${SRC_NAME[s.src]} ${s.num}` : SRC_NAME[s.src],
      proj: s.proj, first: s.first, last: s.last, active: unionLength(s.iv), rounds: s.rounds, tools: s.tools, agents: s.agents.size }
  })
  return {
    from, to, first, last,
    active: unionLength(all), sessions: out,
    tools: [...toolCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    totals: { tools, agents: agents.size, sessions: out.length, rounds, prompts, errors },
  }
}

// Dauer kurz und lesbar: "45 s", "12 min", "1 h 05 min"
function fmtActive(ms) {
  const m = Math.floor((ms || 0) / 60000)
  if (m < 1) return `${Math.max(0, Math.round((ms || 0) / 1000))} s`
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

root.AgentBoardDayStats = { summarize, dayStart, unionLength, fmtActive }
})(typeof window !== 'undefined' ? window : globalThis)
