// fx/inspect.js: Klick auf eine Figur (oder Claudes Tisch) oeffnet eine kleine Karteikarte
// mit Zustand, Auftrag, aktuellem Werkzeug, den letzten 5 Werkzeugen und der Laufzeit.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return

const stage = document.querySelector('.stage')
if (!stage) return

let card = null, target = null, timer = 0, lastFocus = null, anchor = null

// ---------- Hilfen ----------
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

// Dauer in Worten: "4 s", "2 min 10 s", "1 h 5 min"
function fmtDur(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

// Wartet ein Akteur gerade auf eine Erlaubnis? (PermissionRequest ohne spaetere Aufloesung)
function waitingPermission(aid) {
  // Zentrale Quelle ist fx/attention.js (AB.waiting); die eigene Suche bleibt nur als Ersatz
  if (typeof AB.waiting === 'function') {
    const id = aid || 'main'
    return AB.waiting().some((w) => w.id === id && w.kind !== 'idle')
  }
  const evs = AB.S.events || []
  let i = evs.length - 1
  for (; i >= 0; i--) if (evs[i].ev === 'PermissionRequest' && (evs[i].aid || null) === aid) break
  if (i < 0) return false
  const req = evs[i]
  // tool_use_id des zugehoerigen Aufrufs (juengstes PreToolUse desselben Werkzeugs davor)
  let tid = null
  for (let k = i - 1; k >= 0 && k > i - 400; k--) {
    const e = evs[k]
    if (e.ev === 'PreToolUse' && (e.aid || null) === aid && e.tool === req.tool) { tid = e.tid || null; break }
  }
  // Aufgeloest durch das Ende genau dieses Werkzeugs, eine Ablehnung oder das Ende des Akteurs
  for (let k = i + 1; k < evs.length; k++) {
    const e = evs[k]
    if ((e.aid || null) !== aid) continue
    if ((e.ev === 'PostToolUse' || e.ev === 'PostToolUseFailure') && (tid ? e.tid === tid : (!req.tool || e.tool === req.tool))) return false
    if (e.ev === 'PermissionDenied' || e.ev === 'SubagentStop' || e.ev === 'Stop') return false
  }
  return true
}

// Beginn der aktuellen Runde (letzter Auftrag von dir), sonst das erste Ereignis
function roundStart() {
  const evs = AB.S.events || []
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].ev === 'UserPromptSubmit') return evs[i].t
  return evs.length ? evs[0].t : 0
}

function stateWords(who, isMain) {
  if (waitingPermission(isMain ? null : who.id)) return { text: 'wartet auf dich (Erlaubnis)', k: 'wait' }
  if (isMain) return who.state === 'active' ? { text: 'arbeitet', k: 'active' } : { text: 'wartet auf dich', k: 'wait' }
  // Nach einem Fehler gleich wieder an der Arbeit? Dann zaehlt das neue Werkzeug, nicht der alte Fehler.
  let st = who.state
  if (st === 'error' && who.openTool && who.openTool.t > (who.errAt || 0)) st = 'active'
  switch (st) {
    case 'active': return { text: 'arbeitet', k: 'active' }
    case 'done': return { text: 'fertig', k: 'done' }
    case 'error': return { text: 'Fehler', k: 'error' }
    default: return { text: 'ruht gerade', k: 'idle' }
  }
}

// ---------- Karte ----------
function build() {
  const c = el('section', 'ab-insp')
  c.setAttribute('role', 'dialog')
  c.setAttribute('aria-modal', 'false')
  c.tabIndex = -1
  const head = el('div', 'ab-insp-head')
  const dot = el('span', 'ab-insp-dot'); dot.setAttribute('aria-hidden', 'true')
  const name = el('h3', 'ab-insp-name')
  const close = el('button', 'ab-insp-x', '×')
  close.type = 'button'; close.setAttribute('aria-label', 'Karte schliessen'); close.title = 'Schliessen (Esc)'
  close.addEventListener('click', () => closeCard(true))
  head.append(dot, name, close)
  const state = el('p', 'ab-insp-state')
  state.setAttribute('aria-live', 'polite')
  const body = el('dl', 'ab-insp-body')
  c.append(head, state, body)
  c.addEventListener('pointerdown', (e) => e.stopPropagation())
  return c
}

function row(dl, label, value, cls) {
  const dt = el('dt', null, label)
  const dd = el('dd', cls || null)
  if (typeof value === 'string') dd.textContent = value
  else if (value) dd.append(value)
  dl.append(dt, dd)
  return dd
}

function fill() {
  if (!card || !target) return
  const isMain = target.main
  // Agent neu nachschlagen (falls er inzwischen aus der Karte verschwunden ist, die letzte Kopie zeigen)
  let who = isMain ? AB.S.main : (AB.S.agents.get(target.id) || target.ref)
  if (!who) { closeCard(false); return }
  if (!isMain) target.ref = who
  const now = Date.now()
  const name = isMain ? (AB.S.main.name || 'Claude') : (who.name || 'Agent')
  const color = isMain ? AB.COL.amber : (who.color || AB.COL.dim)
  card.setAttribute('aria-label', `Details zu ${name}`)
  card.style.setProperty('--c', color)
  card.querySelector('.ab-insp-name').textContent = isMain ? name : `${name}`
  const sw = stateWords(who, isMain)
  const st = card.querySelector('.ab-insp-state')
  st.textContent = sw.text + (!isMain && who.role && who.role !== 'agent' ? ` · ${who.role}` : '')
  st.dataset.k = sw.k

  const dl = card.querySelector('.ab-insp-body')
  dl.textContent = ''
  if (!isMain) {
    const task = (who.task || '').trim()
    row(dl, 'Auftrag', task || 'kein Auftrag bekannt', task ? 'ab-insp-task' : 'ab-insp-task ab-insp-none')
  }
  // offenes Werkzeug: das zuletzt gestartete ohne Ende (z.B. eines, das auf Erlaubnis wartet)
  let ot = who.openTool
  if (!ot) { const r = who.recent || []; for (let k = r.length - 1; k >= 0; k--) if (r[k].dur == null) { ot = r[k]; break } }
  if (ot && ot.tool) {
    const v = el('span')
    v.append(el('b', null, ot.tool), document.createTextNode(ot.what ? ` ${ot.what}` : ''))
    v.append(el('span', 'ab-insp-since', now - ot.t < 1000 ? ' · gerade eben' : ` · seit ${fmtDur(now - ot.t)}`))
    row(dl, 'Gerade', v, 'ab-insp-mono')
  } else row(dl, 'Gerade', 'kein Werkzeug offen', 'ab-insp-none')

  const rec = (who.recent || []).slice(-5).reverse()
  if (rec.length) {
    const ol = el('ol', 'ab-insp-recent')
    for (const r of rec) {
      const li = el('li')
      const mark = el('span', 'ab-insp-mark', r.dur == null ? '…' : r.ok === false ? '✗' : '✓')
      mark.dataset.k = r.dur == null ? 'open' : r.ok === false ? 'err' : 'ok'
      mark.setAttribute('aria-label', r.dur == null ? 'laeuft' : r.ok === false ? 'Fehler' : 'erledigt')
      const txt = el('span', 'ab-insp-rt')
      txt.append(el('b', null, r.tool || '?'), document.createTextNode(r.what ? ` ${r.what}` : ''))
      li.append(mark, txt)
      if (r.dur != null) li.append(el('span', 'ab-insp-dur', fmtDur(r.dur)))
      ol.append(li)
    }
    row(dl, 'Zuletzt', ol)
  } else row(dl, 'Zuletzt', 'noch keine Werkzeuge', 'ab-insp-none')

  const start = isMain ? roundStart() : who.born
  const end = !isMain && who.state === 'done' && who.doneAt ? who.doneAt : now
  if (start) row(dl, isMain ? 'Runde' : 'Laufzeit', fmtDur(Math.max(0, end - start)) + (!isMain && who.state === 'done' ? ' (fertig)' : ''), 'ab-insp-mono')
}

// Karte nahe der Figur platzieren und im sichtbaren Bereich der Buehne halten
function place(x, y) {
  if (!card) return
  if (matchMedia('(max-width: 560px)').matches) { card.style.left = ''; card.style.top = ''; return }
  const sw = stage.clientWidth, sh = stage.clientHeight
  const cw = card.offsetWidth, ch = card.offsetHeight
  const pad = 10, gap = 26
  let left = x + gap
  if (left + cw > sw - pad) left = x - gap - cw
  left = Math.max(pad, Math.min(sw - cw - pad, left))
  let top = y - ch * 0.55
  top = Math.max(pad, Math.min(sh - ch - pad, top))
  card.style.left = `${Math.round(left)}px`; card.style.top = `${Math.round(top)}px`
}

function openCard(hit) {
  const isMain = !!hit.main && !hit.agent
  const same = card && target && (isMain ? target.main : target.id === (hit.agent && hit.agent.id))
  if (same) { closeCard(true); return }
  if (!card) {
    card = build()
    stage.append(card)
    lastFocus = document.activeElement
  }
  target = isMain ? { main: true } : { main: false, id: hit.agent.id, ref: hit.agent }
  fill()
  const px = isMain ? AB.geo.cx : hit.agent.x
  const py = isMain ? AB.geo.cy : hit.agent.y - 12 * (AB.geo.u || 1)
  anchor = { x: px, y: py }
  card.classList.toggle('ab-insp-sheet', matchMedia('(max-width: 560px)').matches)
  place(px, py)
  try { card.focus({ preventScroll: true }) } catch { /* alter Browser */ }
  clearInterval(timer)
  timer = setInterval(fill, 1000)
}

function closeCard(restore) {
  clearInterval(timer); timer = 0
  if (card) card.remove()
  card = null; target = null
  if (restore && lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }) } catch { /* egal */ } }
  lastFocus = null
}

// ---------- Ereignisse ----------
AB.on('click', (hit) => {
  if (AB.__healthHit === true) { AB.__healthHit = false; return }
  if (!hit) return
  if (hit.agent || hit.main) openCard(hit)
  else if (card) closeCard(false)
})

AB.on('event', (ev) => {
  if (ev && ev.ev === '__reset' && card) closeCard(false)
})

// Klick daneben (ausserhalb der Karte und nicht auf die Szene, die macht das selbst) schliesst
document.addEventListener('pointerdown', (e) => {
  if (!card) return
  if (card.contains(e.target)) return
  if (e.target && e.target.id === 'map') return
  closeCard(false)
}, true)

// Esc schliesst zuerst die Karte (vor dem Kino-Modus)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !card) return
  e.stopPropagation(); e.preventDefault()
  closeCard(true)
}, true)

AB.onResize.push(() => {
  if (!card || !anchor) return
  card.classList.toggle('ab-insp-sheet', matchMedia('(max-width: 560px)').matches)
  place(anchor.x, anchor.y)
})
})()
