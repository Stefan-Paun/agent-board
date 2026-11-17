// fx/tour.js: Erstbesuch-Tour (sechs Schritte mit Hervorhebung) und Zimmer-Legende in der Hilfe (#69).
// Schrittfolge, Zielauswahl, Tasten und Autostart stehen rein in ../tour-logic.js. Hier nur das DOM:
// Knopf "?" in der Kopfzeile (oeffnet die Hilfe aus fx/keys.js), Hervorhebungsrahmen, Tour-Dialog mit
// Fokusfalle und aria-live, Legende als aufklappbarer Teil der Hilfe. Gemerkt wird nur "gesehen"
// (localStorage 'ab-tour-seen'); keine Daten, kein Tracking.
(() => {
'use strict'
const AB = window.AgentBoard
const TL = window.AgentBoardTour
if (!AB || !TL || typeof document === 'undefined') return
const T = AB.t || ((k) => k)
const tryLS = (fn) => { try { return fn() } catch { return null } }
const query = new URLSearchParams(location.search).get('tour') || ''

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const button = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b }

// ---------- Ziele ausmessen (Rechtecke im Fensterraum) ----------
const map = document.getElementById('map')
const mapOn = () => !!map && !map.hidden && map.getBoundingClientRect().width > 0
const mapRect = () => map.getBoundingClientRect()
// Rechteck in Karten-CSS-Pixeln -> Fensterkoordinaten
const fromMap = (x, y, w, h) => { const r = mapRect(); return { left: r.left + x, top: r.top + y, width: w, height: h } }
const around = (p, w, h, dy = 0) => fromMap(p.x - w / 2, p.y - h / 2 + dy, w, h)
const visibleAgents = () => [...AB.S.agents.values()].filter((a) => a.state !== 'done' && a.alpha > 0.5 && Number.isFinite(a.x))
let pinned = null // im Schritt "agent" bleibt die Hervorhebung bei derselben Figur

function actorPos(id) {
  const a = AB.S.agents.get(id)
  if (a && Number.isFinite(a.x)) return { x: a.x, y: a.y }
  if (AB.isLead && AB.isLead(id) && AB.leadsShown().includes(id)) return AB.deskPos(id)
  return null
}
const MEASURE = {
  '@rooms': () => {
    if (!mapOn() || !AB.apartmentBoundsCss) return null
    const b = AB.apartmentBoundsCss()
    return Number.isFinite(b.minX) ? fromMap(b.minX - 4, b.minY - 4, b.maxX - b.minX + 8, b.maxY - b.minY + 8) : null
  },
  '@agent': () => {
    if (!mapOn()) return null
    let a = pinned && AB.S.agents.get(pinned)
    if (!a || a.state === 'done') { a = visibleAgents()[0]; pinned = a ? a.id : null }
    return a ? around(a, 56, 64, -14) : null
  },
  '@desk': () => {
    if (!mapOn() || !AB.leadsShown || !AB.leadsShown().length) return null
    return around(AB.deskPos(AB.leadsShown()[0]), 120, 90)
  },
  '@waiting': () => {
    if (!mapOn() || !AB.waiting) return null
    for (const w of AB.waiting()) { const p = actorPos(w.id); if (p) return around(p, 70, 80, -18) }
    return null
  },
}
function measure(target) {
  if (MEASURE[target]) return MEASURE[target]()
  const n = document.querySelector(target)
  if (!n || !n.getClientRects().length) return null
  const r = n.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

// ---------- Knopf "?" in der Kopfzeile ----------
const tools = document.querySelector('header .tools')
const helpBtn = button('ab-help-btn', '?')
helpBtn.id = 'b-help'
helpBtn.setAttribute('aria-label', T('tour.helpBtn')); helpBtn.title = T('tour.helpBtn')
helpBtn.addEventListener('click', () => {
  if (AB.Snd && AB.Snd.play) AB.Snd.play('click')
  if (AB.toggleHelp) AB.toggleHelp(); else start()
})
if (tools) tools.insertBefore(helpBtn, document.getElementById('lang'))

// ---------- Tour ----------
let steps = [], idx = -1, box = null, hl = null, live = null, opener = null, raf = 0, autoDone = false
let titleN, countN, textN, backB, nextB
const isOpen = () => idx >= 0 && !!box

function build() {
  hl = el('div', 'ab-tour-hl'); hl.setAttribute('aria-hidden', 'true')
  box = el('section', 'ab-tour')
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-labelledby', 'ab-tour-title'); box.setAttribute('aria-describedby', 'ab-tour-text')
  const head = el('div', 'ab-tour-head')
  countN = el('span', 'ab-tour-count')
  const x = button('ab-sum-x ab-tour-x', '×'); x.setAttribute('aria-label', T('tour.close'))
  x.addEventListener('click', () => stop())
  head.append(countN, x)
  titleN = el('h3', null); titleN.id = 'ab-tour-title'
  // Schritttext wird vorgelesen, wenn er wechselt
  live = el('div', 'ab-tour-live'); live.setAttribute('aria-live', 'polite')
  textN = el('p', null); textN.id = 'ab-tour-text'
  live.append(titleN, textN)
  const nav = el('div', 'ab-tour-nav')
  backB = button('ab-tour-back', T('tour.back'))
  nextB = button('ab-tour-next', T('tour.next'))
  backB.addEventListener('click', () => go('prev'))
  nextB.addEventListener('click', () => go('next'))
  nav.append(backB, nextB)
  box.append(head, live, nav)
  document.body.append(hl, box)
}

function place() {
  if (!isOpen()) return
  const r = measure(steps[idx].target)
  if (r) {
    hl.hidden = false
    hl.style.left = Math.round(r.left - 4) + 'px'; hl.style.top = Math.round(r.top - 4) + 'px'
    hl.style.width = Math.round(r.width + 8) + 'px'; hl.style.height = Math.round(r.height + 8) + 'px'
  } else hl.hidden = true
  return r
}
// Dialog neben das Ziel: darunter, sonst darueber, sonst unten in die Mitte (grosse Ziele wie die Karte)
function placeBox(r) {
  const vw = innerWidth, vh = innerHeight, bw = box.offsetWidth, bh = box.offsetHeight, m = 12
  let top
  if (r && r.bottom + m + bh <= vh - m) top = r.bottom + m
  else if (r && r.top - m - bh >= m) top = r.top - m - bh
  else top = vh - bh - m
  const cx = r ? r.left + r.width / 2 : vw / 2
  const left = Math.min(Math.max(m, cx - bw / 2), Math.max(m, vw - bw - m))
  box.style.left = Math.round(left) + 'px'; box.style.top = Math.round(Math.max(m, top)) + 'px'
}
function follow() {
  raf = 0
  if (!isOpen()) return
  place()
  raf = requestAnimationFrame(follow)
}

function show(i) {
  idx = i
  const s = steps[i]
  if (s.id !== 'agent') pinned = null
  // Ziel neu waehlen: inzwischen kann ein besseres da sein (z.B. ein wartender Agent fuer die Abzeichen)
  const def = TL.STEPS.find((d) => d.id === s.id)
  s.target = TL.pickTarget(def, (t) => !!measure(t)) || s.target
  countN.textContent = T('tour.count', { n: i + 1, total: steps.length })
  titleN.textContent = T(s.key + '.title')
  textN.textContent = T(s.key + '.text')
  backB.disabled = i === 0
  nextB.textContent = i === steps.length - 1 ? T('tour.done') : T('tour.next')
  box.dataset.step = s.id
  // Ziel ausserhalb des Fensters (schmale Bildschirme scrollen): erst hinscrollen, dann messen
  const node = MEASURE[s.target] ? map : document.querySelector(s.target)
  if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  placeBox(place())
  if (!box.contains(document.activeElement) || document.activeElement.disabled) nextB.focus()
  if (!raf) raf = requestAnimationFrame(follow)
}

function go(dir) {
  if (!isOpen()) return
  const n = TL.move(idx, dir, steps.length)
  if (n < 0) stop(); else show(n)
}

function start() {
  if (isOpen()) return
  // offene Hilfe/Karten schliessen, damit nichts ueber der Hervorhebung liegt
  if (AB.closeHelp) AB.closeHelp()
  steps = TL.plan(TL.STEPS, (t) => !!measure(t))
  if (!steps.length) return
  tryLS(() => localStorage.setItem(TL.SEEN_KEY, '1'))
  const a = document.activeElement
  opener = a && a !== document.body ? a : helpBtn
  if (!box) build()
  box.hidden = false; hl.hidden = false
  document.body.classList.add('ab-touring')
  show(0)
}

function stop() {
  if (!isOpen()) return
  idx = -1; pinned = null
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  box.hidden = true; hl.hidden = true
  document.body.classList.remove('ab-touring')
  const back = opener; opener = null
  const to = back && back.isConnected && !back.disabled && back.getClientRects().length ? back : helpBtn
  if (to && to.focus) to.focus()
}

const focusables = () => [...box.querySelectorAll('button')].filter((b) => !b.disabled)
// Fenster-Capture: kommt vor fx/keys.js (Esc auf document) und allen Tastenkuerzeln
addEventListener('keydown', (e) => {
  if (!isOpen()) return
  const onBtn = box.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON'
  const a = TL.keyAction(e, onBtn)
  if (a === 'tab' || a === 'tabBack') {
    const f = focusables(), i = f.indexOf(document.activeElement)
    const n = a === 'tab' ? (i + 1) % f.length : (i <= 0 ? f.length - 1 : i - 1)
    f[n].focus()
  } else if (a === 'close') stop()
  else if (a) go(a)
  else if (e.key === 'Enter' || e.key === ' ') return // Knopf im Dialog loest selbst aus
  // keine anderen Tastenkuerzel (H, T, ?, K ...), solange die Tour laeuft
  e.stopPropagation()
  if (a || e.key.length === 1) e.preventDefault()
}, true)
// Fokus bleibt im Dialog (auch nach einem Klick daneben)
document.addEventListener('focusin', (e) => {
  if (isOpen() && !box.contains(e.target)) nextB.focus()
})
addEventListener('resize', () => { if (isOpen()) placeBox(place()) })
addEventListener('scroll', () => { if (isOpen()) placeBox(place()) }, { passive: true })

// Autostart beim ersten Besuch, sobald es etwas zu sehen gibt (kurz nach dem Laden, nicht sofort)
const born = Date.now()
AB.on('ui', () => {
  if (autoDone || isOpen() || Date.now() - born < 2500) return
  const seen = tryLS(() => localStorage.getItem(TL.SEEN_KEY)) === '1'
  if (query === '0' || (seen && query !== '1')) { autoDone = true; return }
  const agents = AB.S.agents.size + AB.S.leads.size
  if (TL.shouldAutoStart({ seen, query, mode: AB.mode(), agents })) { autoDone = true; start() }
})

// ---------- Legende (in der Hilfe aus fx/keys.js) ----------
// kleines Bild je Zimmer: Ausschnitt der aktuellen Karte (immer aktuell, keine eigenen Grafiken)
function thumb(st) {
  const c = el('canvas', 'ab-legend-pic'); c.width = 48; c.height = 36
  c.setAttribute('aria-hidden', 'true')
  const s = AB.stationById && AB.stationById(st.id)
  if (!s || !map || !map.width || !AB.geo || !(AB.geo.w > 0)) return c
  try {
    const k = map.width / AB.geo.w, p = AB.stationPos(s), w = AB.roomWcss(), h = AB.roomHcss()
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false
    g.drawImage(map, (p.x - w / 2) * k, (p.y - h / 2) * k, w * k, h * k, 0, 0, c.width, c.height)
  } catch { /* Karte gerade nicht lesbar: leeres Bild */ }
  return c
}
function legendNode() {
  const d = el('details', 'ab-legend')
  d.append(el('summary', null, T('legend.rooms')))
  const ul = el('ul', 'ab-legend-list')
  for (const e of TL.legend(AB.STATIONS)) {
    const li = el('li'); li.dataset.room = e.id
    const txt = el('div', 'ab-legend-txt')
    txt.append(el('b', null, T(e.nameKey)), el('span', null, T(e.textKey)))
    if (e.tools.length) txt.append(el('small', null, e.tools.join(' · ')))
    li.append(thumb(e), txt)
    ul.append(li)
  }
  d.append(ul)
  return d
}
AB.tourHelp = (card) => {
  const b = button('ab-tour-start', T('tour.start'))
  b.addEventListener('click', () => start())
  card.append(b, legendNode())
}
AB.tour = { start, stop, isOpen, steps: () => steps.map((s) => ({ id: s.id, target: s.target })), index: () => idx }
})()
