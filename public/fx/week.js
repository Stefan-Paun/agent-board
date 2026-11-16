// fx/week.js: "Wochenrueckblick" - Karte mit den letzten 7 Tagen: aktive Zeit je Tag (SVG-Balken),
// Heatmap Wochentag x Stunde (als Tabelle mit echten Zahlen, Farbe nur zusaetzlich), meistgenutzte
// Werkzeuge, Summen je Projekt und Vergleich mit der Vorwoche. Live kommt die Auswertung vom Server
// (/week, ueber das ganze Log), in der Demo aus festen Beispielwerten, sonst aus den Ereignissen, die
// diese Seite gesehen hat. Die Rechnung steht in fx/weekstats.js. Optik wie die Tagesbilanz (fx/day.css).
(() => {
'use strict'
const AB = window.AgentBoard
const DS = window.AgentBoardDayStats
const WS = window.AgentBoardWeekStats
if (!AB || !DS || !WS) return
const T = AB.t || ((k) => k)
const stage = document.querySelector('.stage')
if (!stage) return
const SVGNS = 'http://www.w3.org/2000/svg'
const REFETCH_MS = 20000, LOCAL_MS = 3000

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
function svg(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}
const dayName = (t) => new Date(t).toLocaleDateString(AB.locale, { weekday: 'short' })
const dayLong = (t) => new Date(t).toLocaleDateString(AB.locale, { weekday: 'long', day: 'numeric', month: 'short' })
const mins = (ms) => Math.round((ms || 0) / 60000)
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)
const pct = (cur, prev) => { const d = WS.deltaPct(cur, prev); return d == null ? '' : sign(d) + '%' }

// ---------- Knopf neben "Heute" ----------
const btn = el('button', 'ab-week-btn ab-day-btn', T('week.btn'))
btn.type = 'button'; btn.title = T('week.toggle'); btn.setAttribute('aria-expanded', 'false')
const dayBtn = stage.querySelector('.ab-day-btn')
if (dayBtn) dayBtn.after(btn)
else { const w = el('div', 'ab-day-solo'); w.append(btn); stage.append(w) }

// ---------- Daten ----------
let card = null, data = null, source = 'local', lastFetch = 0, fetching = false

function local(now) {
  if (AB.mode() === 'demo') { source = 'demo'; return WS.demoWeek(now) }
  source = 'local'
  return JSON.parse(JSON.stringify(WS.summarizeWeek((AB.S && AB.S.events) || [], now)))
}

async function refresh(force) {
  const now = Date.now()
  if (AB.mode() !== 'live') {
    if (!force && now - lastFetch < LOCAL_MS) return
    lastFetch = now; data = local(now); render(); return
  }
  if (fetching || (!force && now - lastFetch < REFETCH_MS)) return
  fetching = true; lastFetch = now
  try {
    const r = await fetch('week', { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    data = await r.json(); source = 'file'
  } catch { data = local(now) } finally { fetching = false }
  render()
}

// ---------- Teile der Karte ----------
function bars(r) {
  const W = 300, H = 92, base = 70, bw = 28, gap = (W - 7 * bw) / 8
  const max = Math.max(1, ...r.days.map((d) => d.active))
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ab-week-svg', role: 'img', 'aria-label': T('week.days') })
  s.append(svg('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: 'ab-week-axis' }))
  r.days.forEach((d, i) => {
    const x = gap + i * (bw + gap), h = d.active > 0 ? Math.max(2, Math.round((d.active / max) * (base - 14))) : 0
    const g = svg('g', { class: 'ab-week-day' + (i === r.days.length - 1 ? ' is-today' : '') })
    const tip = svg('title', {})
    tip.textContent = T('week.dayTip', { day: dayLong(d.start), dur: DS.fmtActive(d.active), n: d.sessions, calls: d.tools, ok: d.approvals, err: d.errors })
    g.append(tip, svg('rect', { x, y: base - h, width: bw, height: h, class: 'ab-week-bar' }))
    const v = svg('text', { x: x + bw / 2, y: base - h - 3, 'text-anchor': 'middle', class: 'ab-week-val' }); v.textContent = d.active > 0 ? String(mins(d.active)) : ''
    const l = svg('text', { x: x + bw / 2, y: base + 13, 'text-anchor': 'middle', class: 'ab-week-lbl' }); l.textContent = dayName(d.start)
    g.append(v, l); s.append(g)
  })
  return s
}

// Heatmap als Tabelle: jede Zelle hat die Minuten als Text, die Farbe kommt nur zusaetzlich (Stufe 0 bis 4)
function heat(r) {
  const flat = r.matrix.flat(), max = Math.max(1, ...flat)
  const tb = el('table', 'ab-week-heat')
  tb.append(el('caption', 'ab-week-cap', T('week.heat')))
  const hd = el('tr'); const corner = el('th', null, T('week.heatDay')); corner.scope = 'col'; hd.append(corner)
  for (let h = 0; h < 24; h++) {
    const th = el('th', 'ab-week-hr', String(h)); th.scope = 'col'; th.title = T('week.heatHour', { h }); hd.append(th)
  }
  const head = el('thead'); head.append(hd); tb.append(head)
  const body = el('tbody')
  r.days.forEach((d, i) => {
    const tr = el('tr'); const th = el('th', null, dayName(d.start)); th.scope = 'row'; th.title = dayLong(d.start); tr.append(th)
    for (let h = 0; h < 24; h++) {
      const v = mins(r.matrix[i][h]), lvl = v <= 0 ? 0 : Math.min(4, 1 + Math.floor((r.matrix[i][h] / max) * 3.999))
      const td = el('td', `ab-week-c l${lvl}`, String(v)); td.title = `${dayName(d.start)} ${h}:00 – ${v} min`
      tr.append(td)
    }
    body.append(tr)
  })
  tb.append(body)
  const wrap = el('div', 'ab-week-heatwrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', T('week.heat'))
  wrap.append(tb)
  return wrap
}

function stat(dl, k, v, cur, prev, warn) {
  const d = el('div', warn ? 'ab-sum-warn' : null)
  const dd = el('dd', null, String(v))
  const p = prev ? pct(cur, prev) : ''
  if (p) { dd.append(el('small', 'ab-week-d', p)); dd.title = T('week.vs', { delta: p }) }
  d.append(el('dt', null, k), dd); dl.append(d)
}

let sig = ''
function render() {
  if (!card) return
  const r = data
  const s = r ? JSON.stringify([r.totals, r.days, r.matrix, r.tools, r.projects, r.prev, r.truncated, source, AB.lang]) : 'loading'
  if (s === sig && card.childElementCount) return
  sig = s
  const hadFocus = card.contains(document.activeElement) ? document.activeElement.className : ''
  card.textContent = ''
  const h = el('div', 'ab-sum-head')
  const x = el('button', 'ab-sum-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('week.close'))
  x.addEventListener('click', () => { close(); btn.focus() })
  h.append(el('h3', null, T('week.title')), el('span', 'ab-sum-dur', r ? `${dayName(r.from)} ${new Date(r.from).toLocaleDateString(AB.locale, { day: 'numeric', month: 'short' })} – ${new Date(r.days[6].start).toLocaleDateString(AB.locale, { day: 'numeric', month: 'short' })}` : ''), x)
  card.append(h)
  if (!r) { card.append(el('p', 'ab-day-cover', T('week.loading'))); return }
  const has = r.totals.sessions > 0
  if (!has) {
    card.append(el('p', 'ab-day-empty', T('week.empty')))
  } else {
    const cover = el('p', 'ab-day-cover')
    cover.append(el('b', null, T('week.activeTotal', { dur: DS.fmtActive(r.totals.active) })))
    if (r.prev && r.prev.active > 0) cover.append(document.createTextNode(' · ' + T('week.vsActive', { dur: DS.fmtActive(r.prev.active) }) + ` (${pct(r.totals.active, r.prev.active)})`))
    if (source === 'demo') cover.append(document.createTextNode(' · ' + T('week.sample')))
    else if (source === 'local') cover.append(document.createTextNode(' · ' + T('week.seen')))
    card.append(cover)
    const dl = el('dl', 'ab-sum-grid ab-day-grid')
    const p = r.prev
    stat(dl, T('week.sessions'), r.totals.sessions, r.totals.sessions, p && p.sessions)
    stat(dl, T('week.tools'), r.totals.tools, r.totals.tools, p && p.tools)
    stat(dl, T('week.approvals'), r.totals.approvals, r.totals.approvals, p && p.approvals)
    stat(dl, T('week.errors'), r.totals.errors, r.totals.errors, p && p.errors, r.totals.errors > 0)
    card.append(dl)

    card.append(el('h4', 'ab-day-h', T('week.days')), bars(r))
    card.append(heat(r))

    if (r.tools.length) {
      card.append(el('h4', 'ab-day-h', T('week.toolsTop')))
      const max = Math.max(1, ...r.tools.map((t) => t[1]))
      const ol = el('ol', 'ab-week-list')
      for (const [n, c] of r.tools) {
        const sp = n.startsWith('Skill ') ? ['Skill', n.slice(6)] : [n, '']
        const li = el('li'); const bar = el('span', 'ab-day-bar'); const f = el('i'); f.style.width = `${Math.max(2, Math.round(c / max * 100))}%`; bar.append(f)
        li.append(el('span', 'ab-week-nm', AB.parseTool(...sp).label), bar, el('span', 'ab-day-dur', String(c)))
        ol.append(li)
      }
      card.append(ol)
    }
    if (r.projects.length) {
      card.append(el('h4', 'ab-day-h', T('week.projects')))
      const max = Math.max(1, ...r.projects.map((q) => q.active))
      const ul = el('ul', 'ab-week-list ab-week-proj')
      for (const q of r.projects) {
        const li = el('li'); li.title = T('week.projRow', { dur: DS.fmtActive(q.active), n: q.sessions, calls: q.tools })
        const bar = el('span', 'ab-day-bar'); const f = el('i'); f.style.width = `${Math.max(2, Math.round(q.active / max * 100))}%`; bar.append(f)
        li.append(el('span', 'ab-week-nm', q.proj || T('week.noProj')), bar, el('span', 'ab-day-dur', DS.fmtActive(q.active)))
        ul.append(li)
      }
      card.append(ul)
      if (r.moreProjects > 0) card.append(el('p', 'ab-day-note', T('week.moreProj', { n: r.moreProjects })))
    }
    if (r.truncated) card.append(el('p', 'ab-day-note', T('week.truncated')))
    card.append(el('p', 'ab-day-note', T('week.note')))
  }
  if (hadFocus) { const f = card.querySelector('.' + hadFocus.split(' ')[0]); if (f) f.focus({ preventScroll: true }) }
}

function close() {
  if (!card) return
  card.remove(); card = null
  btn.setAttribute('aria-expanded', 'false')
}

function open() {
  close()
  // die Tagesbilanz und andere Karten liegen an derselben Stelle: nicht uebereinander
  const d = document.querySelector('.ab-day-btn[aria-expanded="true"]:not(.ab-week-btn)'); if (d) d.click()
  for (const c of stage.querySelectorAll('.ab-sum:not(.ab-day)')) c.remove()
  card = el('section', 'ab-sum ab-day ab-week')
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', T('week.label'))
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus() } })
  stage.append(card)
  btn.setAttribute('aria-expanded', 'true')
  data = null; sig = ''
  render()
  refresh(true)
}

btn.addEventListener('click', () => (card && card.isConnected ? close() : open()))
if (dayBtn) dayBtn.addEventListener('click', () => { if (card) close() }) // Tagesbilanz oeffnet: Wochenkarte weg
AB.on('ui', () => { if (card && !card.isConnected) close(); else if (card) refresh(false) }) // z.B. von der Hilfe weggeraeumt
AB.on('event', (ev) => { if (ev && ev.ev === '__reset' && card) { data = null; sig = ''; refresh(true) } })
})()
