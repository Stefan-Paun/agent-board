// fx/crew.js: grosse Besatzungskarten (setzt AB.renderCrew). Baut DOM pro Agent einmal und aktualisiert nur Text.
// Seit Runde "alles": Pixel-Portraet je Agent (nach Zustand getoent), Auftrag aus den Statusdaten,
// Token-Kurve aus tokenSamples (sonst Werkzeug-Aktivitaet), Zusammenfassung ueber der Liste,
// Klick auf eine Karte -> Phase 'click' (Info-Karte).
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const S = AB.S

const BUCKET = 2000, NB = 30 // 30 Balken x 2 s = 60 s
const acts = new Map() // id -> Zeitstempel der Werkzeugaufrufe
let mainStart = 0
const cards = new Map() // id -> { li, refs... }
const subs = new Map() // Agent-id -> letzter Statuseintrag { id, label, status, tokens, tokenSamples, model }
const waiting = new Map() // id ('main' oder aid) -> { kind: 'perm'|'idle', tool, what, tid }

// passt ein Post-Ereignis zum Werkzeug, auf dessen Erlaubnis gewartet wird?
const sameTool = (w, ev) => (w.tid ? ev.tid === w.tid : (!w.tool || ev.tool === w.tool) && (!w.what || ev.what === w.what))

// ---------- Ereignisse: Aktivitaet und "wartet auf dich" ----------
AB.on('event', (ev) => {
  if (ev.ev === '__reset') { acts.clear(); subs.clear(); waiting.clear(); mainStart = 0; return }
  const t = ev.t || Date.now()
  if (!mainStart || t < mainStart) mainStart = t
  const id = ev.aid || 'main'
  const w = waiting.get(id)
  switch (ev.ev) {
    case 'PermissionRequest': {
      const who = ev.aid ? S.agents.get(ev.aid) : S.main
      const open = who && who.openTool && (!ev.tool || who.openTool.tool === ev.tool) ? who.openTool : null
      waiting.set(id, { kind: 'perm', tool: ev.tool || '', what: ev.what || '', tid: (open && open.tid) || '' })
      break
    }
    case 'Notification':
      // ohne aid: gilt fuer Claude selbst - ausser ein Subagent wartet schon auf eine Erlaubnis
      if (ev.aid) { if (!w) waiting.set(id, { kind: 'perm' }); break }
      if (ev.nt === 'idle_prompt') waiting.set('main', { kind: 'idle' })
      else if (ev.nt === 'permission_prompt' && !w && ![...waiting.keys()].some((k) => k !== 'main')) waiting.set('main', { kind: 'perm' })
      break
    case 'PostToolUse': case 'PostToolUseFailure':
      if (w && w.kind === 'perm' && sameTool(w, ev)) waiting.delete(id)
      break
    case 'PermissionDenied': case 'SubagentStop': case 'SubagentStart':
      waiting.delete(id); break
    case 'UserPromptSubmit': case 'SessionStart': case 'SessionEnd':
      waiting.delete('main'); break
  }
  if (ev.ev !== 'PreToolUse') return
  if (w && w.kind === 'idle') waiting.delete(id)
  let a = acts.get(id)
  if (!a) acts.set(id, (a = []))
  a.push(t)
  if (a.length > 600) a.splice(0, a.length - 600)
})

// ---------- Statusdaten: Subagent-Eintraege nur bei exakter id-Uebereinstimmung ----------
AB.on('status', (st) => {
  const list = st && Array.isArray(st.subagents) ? st.subagents : []
  for (const s of list) {
    if (!s || s.id == null) continue
    const id = String(s.id)
    if (!S.agents.has(id)) continue // kein Raten ueber Reihenfolge/Label
    subs.set(id, { ...(subs.get(id) || {}), ...s })
  }
})

const STATE = {
  active: ['▶', 'aktiv'], idle: ['●', 'bereit'], done: ['✓', 'fertig'], error: ['⚠', 'Fehler'], wait: ['?', 'wartet auf dich'],
}
const WAIT_STATUS = /wait|input|perm|block|paus/i
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const setText = (e, t) => { if (e.textContent !== t) e.textContent = t }
const setTitle = (e, t) => { if (e.title !== t) e.title = t }
const pad = (n) => String(n).padStart(2, '0')
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600)
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}
// 12300 -> "12 300" (schmales geschuetztes Leerzeichen als Tausendertrenner)
const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// Anzeige-Zustand: error > wartet > done > active/idle
function viewState(who, id) {
  const base = who.state === 'active' || who.state === 'idle' || who.state === 'done' || who.state === 'error' ? who.state : 'idle'
  if (base === 'error' || base === 'done') return base
  const s = subs.get(id)
  // Zentrale Quelle ist fx/attention.js (AB.waiting); die eigene Erkennung bleibt nur als Ersatz
  const waits = typeof AB.waiting === 'function' ? AB.waiting().some((w) => w.id === id) : waiting.has(id)
  if (waits || (s && typeof s.status === 'string' && WAIT_STATUS.test(s.status))) return 'wait'
  return base
}

// ---------- Pixel-Portraet (16x16, nur ganzzahlige fillRect, per CSS pixelig hochskaliert) ----------
const SKIN = (AB.PX && AB.PX.skin) || '#e8b98a', SKIN_SH = (AB.PX && AB.PX.skinSh) || '#cf9e6e', INK = (AB.PX && AB.PX.ink) || '#3a2c20'
function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0x888888
  const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
function drawPortrait(cv, color, cmd, state) {
  const g = cv.getContext('2d')
  g.clearRect(0, 0, 16, 16)
  const dark = shade(color, -0.35)
  // Schultern/Hemd in Agent-Farbe
  g.fillStyle = color; g.fillRect(2, 13, 12, 3); g.fillRect(3, 12, 10, 1)
  g.fillStyle = dark; g.fillRect(11, 12, 2, 4); g.fillRect(13, 13, 1, 3)
  // Hals
  g.fillStyle = SKIN_SH; g.fillRect(7, 11, 2, 2)
  // Kopf
  g.fillStyle = SKIN; g.fillRect(4, 4, 8, 8)
  g.fillStyle = SKIN_SH; g.fillRect(10, 5, 2, 7)
  // Haar/Kappe in Agent-Farbe
  g.fillStyle = color; g.fillRect(4, 2, 8, 3); g.fillRect(3, 3, 1, 4); g.fillRect(4, 5, 2, 2)
  if (cmd) { g.fillStyle = dark; g.fillRect(3, 7, 1, 3); g.fillRect(4, 10, 2, 1) } // Kommandant: Headset
  // Augen (fertig: geschlossen, als kurzer Strich)
  g.fillStyle = INK
  if (state === 'done') { g.fillRect(6, 8, 2, 1); g.fillRect(9, 8, 2, 1) } else { g.fillRect(6, 7, 1, 2); g.fillRect(9, 7, 1, 2) }
  // Mund
  g.fillStyle = shade(SKIN, -0.4)
  if (state === 'wait') g.fillRect(7, 10, 2, 1)
  else if (state === 'error') { g.fillRect(7, 10, 2, 1); g.fillRect(6, 11, 1, 1); g.fillRect(9, 11, 1, 1) }
  else { g.fillRect(6, 10, 1, 1); g.fillRect(9, 10, 1, 1); g.fillRect(7, 11, 2, 1) }
}

// ---------- Karte ----------
function inspect(c) {
  const a = c.cmd ? null : S.agents.get(c.id)
  if (!c.cmd && !a) return
  const geo = AB.geo || {}
  const hit = a ? { agent: a, main: false, x: a.x, y: a.y } : { agent: null, main: true, x: geo.cx || 0, y: geo.cy || 0 }
  if (typeof AB.run === 'function') AB.run('click', hit)
  else window.dispatchEvent(new CustomEvent('ab:inspect', { detail: hit }))
}

function makeCard(id, cmd) {
  const li = el('li', 'crew-card' + (cmd ? ' cc-cmd' : ''))
  li.tabIndex = 0
  li.setAttribute('role', 'button')
  const badge = el('div', 'cc-badge'); badge.setAttribute('aria-hidden', 'true')
  const face = el('canvas', 'cc-face'); face.width = 16; face.height = 16
  const mark = el('span', 'cc-mark')
  badge.append(face, mark)
  const top = el('div', 'cc-top'), name = el('span', 'cc-name'), state = el('span', 'cc-state')
  top.append(name, state)
  const sub = el('div', 'cc-sub'), role = el('span', 'cc-role'), label = el('span', 'cc-label')
  sub.append(role, label)
  const head = el('div'); head.style.minWidth = '0'; head.append(top, sub)
  const body = el('div', 'cc-body')
  const act = el('div', 'cc-act'), tool = el('span', 'cc-tool'), target = el('span', 'cc-target')
  act.append(tool, target)
  const foot = el('div', 'cc-foot'), stats = el('div', 'cc-stats')
  const time = el('span'), count = el('span')
  stats.append(time, count)
  const spark = el('canvas', 'cc-spark'); spark.setAttribute('aria-hidden', 'true')
  foot.append(stats, spark)
  body.append(act, foot)
  li.append(badge, head, body)
  const c = { id, cmd, li, badge, face, mark, name, state, role, label, tool, target, time, count, spark, key: '', faceKey: '' }
  li.addEventListener('click', () => inspect(c))
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(c) } })
  cards.set(id, c)
  return c
}

// Kurvenpunkte: Token-Zuwachs je Statusmeldung (falls vorhanden), sonst Werkzeugaufrufe je 2 s
function sparkValues(c, endT) {
  const s = subs.get(c.id), ts = s && Array.isArray(s.tokenSamples) ? s.tokenSamples.filter((v) => Number.isFinite(v)) : []
  if (ts.length >= 3) {
    const d = []
    for (let i = 1; i < ts.length; i++) d.push(Math.max(0, ts[i] - ts[i - 1]))
    while (d.length < 8) d.unshift(0)
    return { vals: d, min: 1 }
  }
  const tsA = acts.get(c.id) || []
  const b = new Array(NB).fill(0)
  const start = endT - NB * BUCKET
  for (let i = tsA.length - 1; i >= 0; i--) {
    if (tsA[i] < start) break
    const k = Math.floor((tsA[i] - start) / BUCKET)
    if (k >= 0 && k < NB) b[k]++
  }
  return { vals: b, min: 3 }
}

function drawSpark(c, color, endT) {
  const cv = c.spark, w = cv.clientWidth, h = cv.clientHeight
  if (!w || !h) return
  const dpr = Math.min(devicePixelRatio || 1, 2)
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const { vals, min } = sparkValues(c, endT)
  const n = vals.length
  const mx = Math.max(min, ...vals)
  const step = w / (n - 1), pts = vals.map((v, i) => [i * step, h - 3 - (v / mx) * (h - 8)])
  g.beginPath(); g.moveTo(0, h)
  pts.forEach(([x, y], i) => { if (i) { const [px, py] = pts[i - 1]; g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2) } else g.lineTo(x, y) })
  g.lineTo(w, pts[n - 1][1]); g.lineTo(w, h); g.closePath()
  g.globalAlpha = 0.28; g.fillStyle = color; g.fill()
  g.beginPath()
  pts.forEach(([x, y], i) => { if (i) { const [px, py] = pts[i - 1]; g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2) } else g.moveTo(x, y) })
  g.lineTo(w, pts[n - 1][1])
  g.globalAlpha = 1; g.lineWidth = 1.75; g.strokeStyle = color; g.lineJoin = 'round'; g.stroke()
}

function update(c, who, now) {
  const cmd = c.cmd
  const color = cmd ? AB.COL.amber : who.color
  const state = viewState(who, c.id)
  const name = cmd ? (AB.S.main.name || 'Claude') : who.name
  if (c.li.dataset.state !== state) c.li.dataset.state = state
  if (c.key !== color) { c.li.style.setProperty('--c', color); c.key = color }
  const fk = color + state
  if (c.faceKey !== fk) { drawPortrait(c.face, color, cmd, state); c.faceKey = fk }
  setText(c.mark, state === 'wait' ? '?' : state === 'done' ? '✓' : '')
  setText(c.name, name)
  const st = STATE[state]
  setText(c.state, `${st[0]} ${st[1]}`)
  setText(c.role, cmd ? 'Kommandant' : who.role)

  const s = cmd ? null : subs.get(c.id)
  const label = ((s && typeof s.label === 'string' && s.label) || (!cmd && who.task) || '').trim()
  setText(c.label, label)
  setTitle(c.label, label)

  const wt = state === 'wait' ? ((typeof AB.waiting === 'function' && AB.waiting().find((w) => w.id === c.id)) || waiting.get(c.id)) : null
  const what = ((wt && wt.tool ? `${wt.tool} ${wt.what || ''}` : who.what) || '').trim()
  const sp = what.indexOf(' ')
  const tool = what ? (sp < 0 ? what : what.slice(0, sp)) : ''
  const target = what && sp >= 0 ? what.slice(sp + 1) : ''
  if (state === 'error') { setText(c.tool, '⚠ Fehler'); setText(c.target, what || '') }
  else if (wt && wt.kind === 'idle') { setText(c.tool, '–'); setText(c.target, 'wartet auf deine nächste Nachricht') }
  else if (state === 'wait' && what) { setText(c.tool, tool); setText(c.target, target ? `${target} – braucht dein OK` : 'braucht dein OK') }
  else if (state === 'wait') { setText(c.tool, '–'); setText(c.target, 'wartet auf deine Antwort') }
  else if (what) { setText(c.tool, tool); setText(c.target, target) }
  else { setText(c.tool, '–'); setText(c.target, state === 'idle' ? 'wartet' : '') }
  setTitle(c.target, what)

  const end = (who.state === 'done') && who.doneAt ? who.doneAt : now
  const start = cmd ? (mainStart || now) : who.born || now
  setText(c.time, `⏱ ${fmt(end - start)}`)
  const n = who.count || 0
  const ct = `${n}${n === 1 ? ' Aufruf' : ' Aufrufe'}`
  if (c.count.dataset.v !== ct) {
    c.count.dataset.v = ct
    c.count.textContent = ''
    const b = document.createElement('b'); b.textContent = String(n)
    c.count.append(b, n === 1 ? ' Aufruf' : ' Aufrufe')
  }
  // Tokens nur leise im Tooltip
  const tok = s && Number.isFinite(s.tokens) ? s.tokens : null
  const hasSamples = !!(s && Array.isArray(s.tokenSamples) && s.tokenSamples.length >= 3)
  const tip = (tok != null ? `${fmtN(tok)} Tokens` : '') + (s && s.model ? ` · ${s.model}` : '') +
    (hasSamples ? ' – Kurve: Token-Verbrauch' : (tok != null ? ' – ' : '') + 'Kurve: Werkzeugaufrufe der letzten Minute')
  setTitle(c.spark, tip)
  setTitle(c.li, `${name}${tok != null ? ` · ${fmtN(tok)} Tokens` : ''} – Klick für Details`)
  drawSpark(c, color, end)
}

// ---------- Zusammenfassung ueber der Liste ----------
let sumEl = null
function summary(ul, agents) {
  if (!sumEl) {
    sumEl = el('p', 'ab-crew-sum')
    sumEl.setAttribute('aria-live', 'polite')
    ul.parentNode && ul.parentNode.insertBefore(sumEl, ul)
  }
  let work = 0, wait = 0, done = 0, err = 0, tok = 0, hasTok = false
  for (const a of agents) {
    const v = viewState(a, a.id)
    if (v === 'active') work++; else if (v === 'wait') wait++; else if (v === 'done') done++; else if (v === 'error') err++
    const s = subs.get(a.id)
    if (s && Number.isFinite(s.tokens)) { tok += s.tokens; hasTok = true }
  }
  if (typeof AB.waiting === 'function' ? AB.waiting().some((w) => w.id === 'main') : waiting.has('main')) wait++
  const parts = []
  if (work) parts.push(`${work} ${work === 1 ? 'arbeitet' : 'arbeiten'}`)
  if (wait) parts.push(`${wait} wartet`)
  if (done) parts.push(`${done} fertig`)
  if (err) parts.push(`${err} mit Fehler`)
  setText(sumEl, parts.length ? parts.join(' · ') : (agents.length ? 'alle bereit' : 'noch niemand unterwegs'))
  sumEl.dataset.wait = wait ? '1' : ''
  const st = S.status || {}
  const tip = []
  if (hasTok) tip.push(`Subagents zusammen: ${fmtN(tok)} Tokens`)
  if (Number.isFinite(st.costUsd)) tip.push(`Kosten bisher ca. ${st.costUsd.toFixed(2).replace('.', ',')} $`)
  setTitle(sumEl, tip.join('\n'))
}

const GROUP = { error: 0, wait: 0, active: 1, idle: 2, done: 3 }

AB.renderCrew = (ul, agents, main) => {
  const now = Date.now()
  if (!ul.classList.contains('crew-fx')) ul.classList.add('crew-fx')
  summary(ul, agents)
  const want = []

  let mc = cards.get('main') || makeCard('main', true)
  update(mc, main, now); want.push(mc.li)

  const ordered = [...agents].sort((a, b) => (GROUP[viewState(a, a.id)] ?? 2) - (GROUP[viewState(b, b.id)] ?? 2) || a.born - b.born)
  const live = new Set(['main'])
  for (const a of ordered) {
    live.add(a.id)
    const c = cards.get(a.id) || makeCard(a.id, false)
    update(c, a, now); want.push(c.li)
  }
  for (const [id, c] of cards) if (id !== '_empty' && !live.has(id)) { c.li.remove(); cards.delete(id); acts.delete(id); subs.delete(id); waiting.delete(id) }

  let empty = cards.get('_empty')
  if (!ordered.length) {
    if (!empty) {
      const li = el('li', 'crew-card cc-empty', 'Noch keine Subagents. Der Kommandant wartet auf Verstärkung.')
      empty = { li }; cards.set('_empty', empty)
    }
    want.push(empty.li)
  } else if (empty) { empty.li.remove(); cards.delete('_empty') }

  // nur umsortieren, wenn sich die Reihenfolge geaendert hat (Fokus/Hover bleibt erhalten)
  for (let i = 0; i < want.length; i++) {
    if (ul.children[i] !== want[i]) ul.insertBefore(want[i], ul.children[i] || null)
  }
  while (ul.children.length > want.length) ul.lastChild.remove()
}
})()
