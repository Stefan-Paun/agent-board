// fx/day.js: "Tagesbilanz" - Karte mit dem heutigen Tag: aktive Zeit je Kommandant, Runden, Agents,
// benutzte Werkzeuge. Live kommt die Auswertung vom Server (/day, ueber die ganze events.jsonl),
// in der Demo (oder ohne Server) aus den Ereignissen, die diese Seite gesehen hat (S.events).
// Die Rechnung selbst steht in fx/daystats.js. Optik wie die Karte "Runde fertig" (fx/timeline.css).
(() => {
'use strict'
const AB = window.AgentBoard
const DS = window.AgentBoardDayStats
if (!AB || !DS) return
const T = AB.t || ((k) => k)
const stage = document.querySelector('.stage')
if (!stage) return

const ROOM_COL = { archiv: '#5f8f5a', werkstatt: '#b5653a', terminal: '#4f7a96', funkturm: '#7d5f80', leitstand: '#a68a2e', pausenraum: '#8a7a64' }
const roomCol = (st) => (st && (st.color || ROOM_COL[st.id])) || '#8a7a64'
// wie die Tischfarben im Kern: erste Session in der Hausfarbe, weitere in Abwandlungen
const LEAD_COLORS = { claude: ['#96491f', '#8a3f5c', '#7a5a1c', '#a3542f'], codex: ['#3b5a8c', '#2f6f7a', '#4a4f8f', '#2f5f6a'] }
const sesColor = (s) => LEAD_COLORS[s.src][(s.num - 1) % 4]
const MAX_ROWS = 5, MAX_TOOLS = 6, REFETCH_MS = 10000, LOCAL_MS = 2000

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const hhmm = (t) => new Date(t).toLocaleTimeString(AB.locale, { hour: '2-digit', minute: '2-digit' })
const dateLabel = (t) => new Date(t).toLocaleDateString(AB.locale, { weekday: 'short', day: 'numeric', month: 'short' })

// ---------- Knopf neben "Verlauf" ----------
const btn = el('button', 'ab-day-btn', T('day.btn'))
btn.type = 'button'; btn.title = T('day.toggle'); btn.setAttribute('aria-expanded', 'false')
const tlHead = stage.querySelector('.ab-tl-head')
const tlBtn = tlHead && tlHead.querySelector('.ab-tl-btn')
if (tlBtn) tlBtn.after(btn)
else { const w = el('div', 'ab-day-solo'); w.append(btn); stage.append(w) }

// ---------- Daten ----------
let card = null, data = null, source = 'local', lastFetch = 0, fetching = false

function range(now) {
  const from = DS.dayStart(now)
  const d = new Date(from); d.setDate(d.getDate() + 1)
  return { from, to: d.getTime() }
}

function localSummary(now) {
  const { from, to } = range(now)
  return DS.summarize((AB.S && AB.S.events) || [], from, to)
}

async function refresh(force) {
  const now = Date.now()
  if (AB.mode() !== 'live') {
    if (!force && now - lastFetch < LOCAL_MS) return
    lastFetch = now; source = 'local'; data = localSummary(now); render(); return
  }
  if (fetching || (!force && now - lastFetch < REFETCH_MS)) return
  fetching = true; lastFetch = now
  const { from, to } = range(now)
  try {
    const r = await fetch(`day?from=${from}&to=${to}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    data = await r.json(); source = 'file'
  } catch {
    // kein Server (z.B. statische Demo-Seite): nur was diese Seite gesehen hat
    data = localSummary(now); source = 'local'
  } finally { fetching = false }
  render()
}

// ---------- Karte ----------
function markdown(r) {
  const lines = [`## ${T('day.title')} · ${dateLabel(r.from)}`, '',
    `- ${T('day.activeLong')}: ${DS.fmtActive(r.active)}`,
    `- ${T('day.rounds')}: ${r.totals.rounds}`,
    `- ${T('sum.agents')}: ${r.totals.agents}`,
    `- ${T('sum.tools')}: ${r.totals.tools}`,
    `- ${T('sum.errs')}: ${r.totals.errors}`]
  for (const s of r.sessions) lines.push(`- ${s.name}${s.proj ? ` (${s.proj})` : ''}: ${DS.fmtActive(s.active)}`)
  if (r.tools.length) lines.push(`- ${T('day.toolsUsed')}: ${r.tools.map(([n, c]) => `${n} ${c}`).join(', ')}`)
  return lines.join('\n')
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* Fallback unten */ }
  try {
    const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

function close() {
  if (!card) return
  card.remove(); card = null
  btn.setAttribute('aria-expanded', 'false')
}

function open() {
  close()
  // die Karte "Runde fertig" liegt an derselben Stelle: nicht beide uebereinander
  for (const c of stage.querySelectorAll('.ab-sum:not(.ab-day)')) c.remove()
  card = el('section', 'ab-sum ab-day')
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', T('day.label'))
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus() } })
  stage.append(card)
  btn.setAttribute('aria-expanded', 'true')
  data = null
  render()
  refresh(true)
}

let sig = ''
function render() {
  if (!card) return
  const r = data
  // nur neu bauen, wenn sich etwas geaendert hat (sonst springt z.B. der Fokus)
  const s = r ? JSON.stringify([r.active, r.totals, r.sessions.map((x) => [x.name, x.proj, x.active]), r.tools.slice(0, MAX_TOOLS), r.first, source, AB.lang]) : 'loading'
  if (s === sig && card.childElementCount) return
  sig = s
  const hadFocus = card.contains(document.activeElement) ? document.activeElement.className : ''
  card.textContent = ''
  const h = el('div', 'ab-sum-head')
  const x = el('button', 'ab-sum-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('day.close'))
  x.addEventListener('click', () => { close(); btn.focus() })
  h.append(el('h3', null, T('day.title')), el('span', 'ab-sum-dur', dateLabel(r ? r.from : Date.now())), x)
  card.append(h)
  if (!r) { card.append(el('p', 'ab-day-cover', T('day.loading'))); return }
  if (!r.first) {
    card.append(el('p', 'ab-day-empty', T('day.empty')))
  } else {
    const cover = el('p', 'ab-day-cover')
    cover.append(el('b', null, T('day.activeTotal', { dur: DS.fmtActive(r.active) })), document.createTextNode(' · ' + T(source === 'file' ? 'day.since' : 'day.sinceSeen', { time: hhmm(r.first) })))
    card.append(cover)

    const dl = el('dl', 'ab-sum-grid ab-day-grid')
    const add = (k, v, warn) => { const d = el('div', warn ? 'ab-sum-warn' : null); d.append(el('dt', null, k), el('dd', null, String(v))); dl.append(d) }
    add(T('day.rounds'), r.totals.rounds); add(T('sum.agents'), r.totals.agents); add(T('sum.tools'), r.totals.tools)
    add(T('sum.errs'), r.totals.errors, r.totals.errors > 0)
    card.append(dl)

    // aktive Zeit je Kommandant (Session), laengste zuerst, Balken relativ zur laengsten
    const rows = [...r.sessions].sort((a, b) => b.active - a.active)
    const maxA = Math.max(1, ...rows.map((s) => s.active))
    card.append(el('h4', 'ab-day-h', T('day.who')))
    const ul = el('ul', 'ab-day-who')
    for (const s of rows.slice(0, MAX_ROWS)) {
      const li = el('li')
      li.style.setProperty('--c', sesColor(s))
      li.title = T('day.rowTip', { n: s.rounds, calls: s.tools, time: `${hhmm(s.first)}–${hhmm(s.last)}` })
      const nm = el('span', 'ab-day-nm')
      nm.append(el('b', null, s.name))
      if (s.proj) nm.append(el('small', null, s.proj))
      const bar = el('span', 'ab-day-bar'); const fill = el('i'); fill.style.width = `${Math.max(2, Math.round((s.active / maxA) * 100))}%`; bar.append(fill)
      li.append(nm, bar, el('span', 'ab-day-dur', DS.fmtActive(s.active)))
      ul.append(li)
    }
    card.append(ul)
    if (rows.length > MAX_ROWS) card.append(el('p', 'ab-day-more', T('day.more', { n: rows.length - MAX_ROWS })))

    if (r.tools.length) {
      const p = el('p', 'ab-sum-rooms ab-day-tools')
      p.append(el('span', null, `${T('day.toolsUsed')}: `))
      r.tools.slice(0, MAX_TOOLS).forEach(([n, cnt], i) => {
        const b = el('b', null, `${n} ${cnt}`); b.style.setProperty('--c', roomCol(AB.stationFor ? AB.stationFor(n) : null))
        if (i) p.append(document.createTextNode(' · '))
        p.append(b)
      })
      if (r.tools.length > MAX_TOOLS) p.append(document.createTextNode(' · ' + T('day.more', { n: r.tools.length - MAX_TOOLS })))
      card.append(p)
    }
    card.append(el('p', 'ab-day-note', T('day.note')))

    const cp = el('button', 'ab-sum-copy', T('sum.copy')); cp.type = 'button'
    cp.addEventListener('click', async () => {
      const ok = await copyText(markdown(r))
      cp.textContent = ok ? T('sum.copied') : T('sum.copyFailed')
      setTimeout(() => { if (cp.isConnected) cp.textContent = T('sum.copy') }, 1800)
    })
    card.append(cp)
  }
  if (hadFocus) { const f = card.querySelector('.' + hadFocus.split(' ')[0]); if (f) f.focus({ preventScroll: true }) }
}

btn.addEventListener('click', () => (card ? close() : open()))
btn.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) { e.stopPropagation(); close() } })
AB.on('ui', () => { if (card) refresh(false) })
AB.on('event', (ev) => { if (ev && ev.ev === '__reset' && card) { data = null; sig = ''; refresh(true) } })
})()
