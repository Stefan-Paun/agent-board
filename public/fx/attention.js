// fx/attention.js: "Wartet auf dich" - Erlaubnis-Anfragen und Eingabe-Wuensche sofort sichtbar,
// aber ruhig: Figur kommt zum Tisch ihrer Hauptfigur (Claude oder Codex), Pixel-Sprechblase mit "?", sanfter Gong (nur bei Ton an),
// Tab-Titel/Favicon, optionale Browser-Benachrichtigung, Ansage fuer Screenreader.
// Ausserdem (QW3): Hinweis, wenn die Live-Verbindung zum Board weg ist, und "letztes Ereignis vor ...".
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const T = AB.t || ((k) => k)

const PERM_NT = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog'])
const STALE_REPLAY_MS = 30 * 60000 // beim Replay uebernommene, nie aufgeloeste Anfragen verfallen danach
const tryLS = (fn) => { try { return fn() } catch { return null } }

// ---------- Zustand ----------
// waits: Akteur (Lead-ID einer Session wie 'claude:3f9a1c2e', oder aid) -> { kind: 'perm'|'input'|'idle', t, tool, what, tid, loose, silent }
const waits = new Map()
let lastGongAt = 0

const nameOf = (id) => {
  if (AB.isLead(id)) return AB.lead(id).name
  const a = AB.S.agents.get(id)
  return a ? a.name : T('att.someAgent')
}
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

function describe(id, w) {
  const who = nameOf(id)
  if (w.kind === 'idle') return T('att.idle', { who })
  if (w.kind === 'input') return T('att.input', { who })
  const det = w.tool ? ` (${w.tool}${w.what ? ': ' + short(w.what, 60) : ''})` : ''
  return T('att.perm', { who, det })
}

const permWaits = () => [...waits.entries()].filter(([, w]) => w.kind !== 'idle')
const isWaitingPerm = () => permWaits().length > 0

function startWait(id, w, silent) {
  const had = waits.get(id)
  if (had && had.kind === w.kind && had.kind !== 'idle') { // gleicher Zustand: nur Details ergaenzen
    if (!had.tool && w.tool) { had.tool = w.tool; had.what = w.what }
    if (!had.tid && w.tid) had.tid = w.tid
    had.loose = had.loose && w.loose
    return
  }
  w.silent = !!silent
  waits.set(id, w)
  if (silent) return
  const text = describe(id, w)
  announce(text)
  if (w.kind === 'idle') softChime()
  else gong()
  notify(text)
}

function clearWait(id) { waits.delete(id) }
// gehoert der Akteur k zur Hauptfigur lid? (sie selbst oder einer ihrer Subagents; lose Anfragen zaehlen immer)
function ofLead(k, lid) {
  if (AB.isLead(k)) return k === lid
  const a = AB.S.agents.get(k)
  return !a || a.lead === lid
}
function clearPerm(lid) { for (const [id, w] of [...waits]) if (w.kind !== 'idle' && (w.loose || ofLead(id, lid))) waits.delete(id) }
function clearLead(lid) { for (const id of [...waits.keys()]) if (ofLead(id, lid) || waits.get(id).loose) waits.delete(id) }

AB.on('event', (ev, silent) => {
  if (!ev || !ev.ev) return
  const id = AB.actorId(ev), lid = AB.leadOf(ev)
  const t = ev.t || Date.now()
  switch (ev.ev) {
    case '__reset':
      waits.clear(); return
    case 'PermissionRequest': {
      const who = AB.isLead(id) ? AB.lead(id) : AB.S.agents.get(id)
      const ot = who && who.openTool
      const tid = ot && ot.tid && (!ev.tool || ot.tool === ev.tool) ? ot.tid : null
      // eine vorher nur per Notification erkannte (lose) Anfrage gehoert jetzt zu diesem Akteur
      for (const [k, w] of [...waits]) if (w.loose && k !== id) waits.delete(k)
      startWait(id, { kind: 'perm', t, tool: ev.tool || '', what: ev.what || '', tid, loose: false }, silent)
      return
    }
    case 'Notification': {
      const nt = ev.nt || ''
      if (PERM_NT.has(nt)) {
        const kind = nt === 'permission_prompt' ? 'perm' : 'input'
        if (ev.aid) { startWait(id, { kind, t, tool: '', what: '', tid: null, loose: false }, silent); return }
        // ohne aid: gehoert meist zu einer gerade gemeldeten PermissionRequest -> nicht doppeln
        if (isWaitingPerm()) return
        startWait(lid, { kind, t, tool: '', what: '', tid: null, loose: true }, silent)
      } else if (nt === 'idle_prompt') {
        if (!waits.has(lid)) startWait(lid, { kind: 'idle', t, tool: '', what: '', tid: null, loose: false }, silent)
      }
      return
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const w = waits.get(id)
      if (w && w.kind !== 'idle') {
        if (ev.ev === 'PreToolUse') { if (!w.tid && t - w.t > 300) clearWait(id) }
        else if (!w.tid || !ev.tid || ev.tid === w.tid) clearWait(id)
      }
      // lose Anfrage (unbekannter Akteur): irgendein Weiterarbeiten gilt als Antwort
      for (const [k, lw] of [...waits]) if (lw.loose && t - lw.t > 1000) waits.delete(k)
      return
    }
    case 'PermissionDenied':
      if (waits.has(id) && waits.get(id).kind !== 'idle') clearWait(id)
      else for (const [k, w] of [...waits]) if (w.loose) waits.delete(k)
      return
    case 'SubagentStop':
      if (ev.aid) clearWait(ev.aid)
      return
    case 'UserPromptSubmit':
    case 'SessionEnd':
      clearLead(lid); return
    case 'Stop':
    case 'Interrupt':
      clearPerm(lid); waits.delete(lid); return
  }
})

// ---------- Figur: wartender Agent kommt zu Claudes Tisch ----------
// Der Schreibtisch der Hauptfigur steht im Wohnzimmer (AB.deskPos, siehe app.js "Schreibtisch").
// Die Figur stellt sich seitlich neben den Teppich - auf die Seite, auf der ihr Zimmer liegt.
const prevTarget = AB.targetFor
function waitSpot(a) {
  const d = AB.deskPos(a.lead)
  const list = permWaits().map(([k]) => AB.S.agents.get(k)).filter((b) => b && b.lead === a.lead)
  const sideOf = (b) => {
    if (b.st && b.st.col) return b.st.col < 0 ? -1 : 1
    if (Math.abs(b.x - d.x) > 4) return b.x < d.x ? -1 : 1
    return (b.slot || 0) % 2 ? 1 : -1
  }
  const side = sideOf(a)
  const same = list.filter((b) => sideOf(b) === side)
  const idx = Math.max(0, same.indexOf(a))
  const dx = AB.artToCss(40), step = AB.artToCss(15)
  const row = idx % 3, col = Math.floor(idx / 3)
  return { x: d.x + side * (dx + col * AB.artToCss(12)), y: d.y + AB.artToCss(8) + (row === 1 ? -step : row === 2 ? step : 0) }
}
AB.targetFor = (a, time) => {
  const w = a && waits.get(a.id)
  if (w && w.kind !== 'idle' && a.state !== 'done') return waitSpot(a)
  return prevTarget ? prevTarget(a, time) : null
}

// ---------- Pixel-Sprechblase mit "?" (Kunst-Pixel, nur ganzzahlige fillRect) ----------
const Q = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..']
function bubble(actx, x, bottom, time) {
  x = Math.round(x); bottom = Math.round(bottom)
  const w = 11, h = 11, bx = x - 5, by = bottom - h - 2
  const amber = AB.COL.amber, paper = (AB.PX && AB.PX.paper) || '#fbf3e4'
  const a0 = actx.globalAlpha
  if (!AB.reduce) {
    // sanftes Pulsieren: ein heller Saum um die Blase blendet langsam ein und aus
    actx.globalAlpha = a0 * (0.12 + 0.3 * (0.5 + 0.5 * Math.sin(time * 2.4)))
    actx.fillStyle = amber
    actx.fillRect(bx, by - 2, w, 1); actx.fillRect(bx, by + h + 1, w, 1)
    actx.fillRect(bx - 2, by, 1, h); actx.fillRect(bx + w + 1, by, 1, h)
    actx.fillRect(bx - 1, by - 1, 1, 1); actx.fillRect(bx + w, by - 1, 1, 1)
    actx.fillRect(bx - 1, by + h, 1, 1); actx.fillRect(bx + w, by + h, 1, 1)
    actx.globalAlpha = a0
  }
  // Rahmen mit abgeschraegten Ecken, dann Innenflaeche
  actx.fillStyle = amber
  actx.fillRect(bx + 1, by, w - 2, h); actx.fillRect(bx, by + 1, w, h - 2)
  actx.fillStyle = paper
  actx.fillRect(bx + 1, by + 1, w - 2, h - 2)
  // Zipfel nach unten
  actx.fillStyle = amber
  actx.fillRect(x - 1, by + h, 3, 1); actx.fillRect(x, by + h + 1, 1, 1)
  actx.fillStyle = paper; actx.fillRect(x, by + h - 1, 1, 1)
  // Fragezeichen
  actx.fillStyle = amber
  for (let r = 0; r < Q.length; r++) for (let c = 0; c < 5; c++) if (Q[r][c] === '#') actx.fillRect(bx + 3 + c, by + 2 + r, 1, 1)
}

AB.on('scene', (actx, time) => {
  if (!waits.size) return
  for (const [id, w] of waits) {
    if (w.kind === 'idle') continue // "fertig, wartet" zeigt status.js als Abzeichen ueber der Hauptfigur
    if (AB.isLead(id)) {
      const d = AB.deskPos(id), c = AB.toArt(d.x, d.y)
      bubble(actx, c.x - 8, c.y - 9, time) // ueber dem Bildschirm der Hauptfigur
      continue
    }
    const a = AB.S.agents.get(id)
    if (!a || a.state === 'done') continue
    const p = AB.toArt(a.x, a.y)
    actx.globalAlpha = a.alpha == null ? 1 : a.alpha
    bubble(actx, p.x, p.y - 25, time) // knapp ueber dem Kopf (people.js: Kopf endet bei -24)
    actx.globalAlpha = 1
  }
})

// ---------- Klang: sanfter Zwei-Ton-Gong (nur wenn Ton an) ----------
function volume() {
  const v = parseFloat(tryLS(() => localStorage.getItem('ab-vol')))
  const k = v >= 0 && v <= 1 ? v : 0.7
  return k * k * 1.6 // wie sound.js
}
function tone(ac, f, t, dur, v) {
  const t0 = ac.currentTime + t
  const o = ac.createOscillator(), g = ac.createGain()
  o.type = 'sine'; o.frequency.value = f
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + 0.025)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g); g.connect(ac.destination)
  o.start(t0); o.stop(t0 + dur + 0.05)
}
function soundCtx() {
  const Snd = AB.Snd
  if (!Snd || !Snd.on || !Snd.ctx) return null
  if (Snd.ctx.state === 'suspended' && Snd.ctx.resume) { try { Snd.ctx.resume() } catch { /* egal */ } }
  return Snd.ctx
}
function gongNow(ac) {
  const v = 0.06 * volume()
  tone(ac, 659.25, 0, 1.1, v); tone(ac, 1318.5, 0, 0.5, v * 0.18)
  tone(ac, 523.25, 0.32, 1.5, v); tone(ac, 261.6, 0.32, 1.2, v * 0.3)
}
function gong() {
  const now = Date.now()
  if (now - lastGongAt < 3000) return
  const ac = soundCtx(); if (!ac) return
  lastGongAt = now
  try { gongNow(ac) } catch { /* egal */ }
}
function softChime() {
  const ac = soundCtx(); if (!ac) return
  try { tone(ac, 523.25, 0, 1.2, 0.035 * volume()) } catch { /* egal */ }
}

// Der Kern spielt bei jeder Notification 'alert'. Fuer Warte-Notifications ersetzt der Gong diesen
// Ton (statt doppelt zu klingeln). Die Notification liegt beim Aufruf schon in S.events.
let prevPlay = null
function wrappedPlay(art, ac) {
  if (art === 'alert') {
    const e = AB.S.events[AB.S.events.length - 1]
    if (e && e.ev === 'Notification' && PERM_NT.has(e.nt)) {
      if (Date.now() - lastGongAt >= 3000) { lastGongAt = Date.now(); try { gongNow(ac) } catch { /* egal */ } }
      return true
    }
    if (e && e.ev === 'Notification' && e.nt === 'idle_prompt') {
      if (!waits.has(AB.leadOf(e))) { try { tone(ac, 523.25, 0, 1.2, 0.035 * volume()) } catch { /* egal */ } }
      return true
    }
  }
  return prevPlay ? prevPlay(art, ac) : false
}
function wrapSound() {
  if (AB.playSound === wrappedPlay) return
  prevPlay = AB.playSound || null
  AB.playSound = wrappedPlay
}
wrapSound()

// ---------- Screenreader-Ansage ----------
const live = document.createElement('div')
live.className = 'ab-att-live'
live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite')
document.body.append(live)
function announce(text) {
  live.textContent = ''
  setTimeout(() => { live.textContent = text }, 60)
}

// ---------- Browser-Benachrichtigung (optional, Glocken-Knopf im Kopf) ----------
const canNotify = 'Notification' in window
let notifyOn = canNotify && tryLS(() => localStorage.getItem('ab-att-notify')) === '1' && Notification.permission === 'granted'
let bell = null
function bellSync() {
  if (!bell) return
  bell.setAttribute('aria-pressed', String(notifyOn))
  bell.title = notifyOn ? T('att.bellOn')
    : canNotify && Notification.permission === 'denied' ? T('att.bellBlocked')
      : T('att.bellOff')
}
function setNotify(v) {
  notifyOn = v
  tryLS(() => localStorage.setItem('ab-att-notify', v ? '1' : '0'))
  bellSync()
}
if (canNotify) {
  const tools = document.querySelector('header .tools')
  if (tools) {
    bell = document.createElement('button')
    bell.type = 'button'; bell.className = 'ab-att-bell'; bell.setAttribute('aria-label', T('att.bellLabel'))
    // kleine Pixel-Glocke (statisches SVG, keine Daten)
    bell.innerHTML = '<svg viewBox="0 0 10 10" width="20" height="20" aria-hidden="true" shape-rendering="crispEdges">'
      + '<rect x="4" y="0" width="2" height="1"/><rect x="3" y="1" width="4" height="1"/><rect x="2" y="2" width="6" height="4"/>'
      + '<rect x="1" y="6" width="8" height="1"/><rect x="0" y="7" width="10" height="1"/><rect x="4" y="8" width="2" height="2"/></svg>'
    bell.addEventListener('click', async () => {
      if (AB.Snd && AB.Snd.play) AB.Snd.play('click')
      if (notifyOn) { setNotify(false); return }
      let p = Notification.permission
      if (p === 'default') { try { p = await Notification.requestPermission() } catch { p = 'denied' } }
      setNotify(p === 'granted')
    })
    const demo = document.getElementById('b-demo')
    if (demo && demo.parentNode === tools) tools.insertBefore(bell, demo); else tools.append(bell)
    bellSync()
  }
}
function notify(text) {
  if (!notifyOn || !canNotify || !document.hidden || Notification.permission !== 'granted') return
  try {
    const n = new Notification('Agent-Board', { body: text, tag: 'ab-att-wait', silent: true })
    n.onclick = () => { try { window.focus() } catch { /* egal */ } n.close() }
  } catch { /* manche Browser erlauben das nur per Service Worker */ }
}

// ---------- Tab-Titel und Favicon ----------
// status.js schreibt den Titel nur, wenn sich SEIN Wunschtitel aendert. Wir merken uns dessen letzte
// Fassung und setzen beim Warten "(?) " davor (statt dessen Praefix, damit es ruhig bleibt).
let theirTitle = document.title, myTitle = ''
const stripPrefix = (s) => s.replace(/^(\(\?\)|\(\d+\)|⚠|⏸)\s*/, '')
function syncTitle(perm) {
  const cur = document.title
  if (cur !== myTitle) theirTitle = cur
  const want = perm ? '(?) ' + stripPrefix(theirTitle) : theirTitle
  if (want !== cur) document.title = want
  myTitle = want
}

const iconLink = document.querySelector('link[rel~="icon"]')
const iconOrig = iconLink ? iconLink.getAttribute('href') : null
const iconOrigType = iconLink ? iconLink.getAttribute('type') : null
const iconCache = {}
function makeIcon(dot) {
  if (iconCache[dot]) return iconCache[dot]
  const c = document.createElement('canvas'); c.width = 32; c.height = 32
  const x = c.getContext('2d')
  const P = AB.PX || {}
  // Schreibtisch-Kachel in Pixeln: Creme-Grund, Holztisch, kleiner Bildschirm, Farbpunkt oben rechts
  x.fillStyle = '#f4ead7'; x.fillRect(2, 2, 28, 28)
  x.fillStyle = P.wall || '#9c8667'; x.fillRect(2, 2, 28, 2); x.fillRect(2, 28, 28, 2); x.fillRect(2, 2, 2, 28); x.fillRect(28, 2, 2, 28)
  x.fillStyle = P.woodDk || '#8a6744'; x.fillRect(7, 15, 18, 10)
  x.fillStyle = P.wood || '#a9825a'; x.fillRect(8, 16, 16, 8)
  x.fillStyle = AB.COL.amber; x.fillRect(9, 10, 8, 7)
  x.fillStyle = P.screen || '#bfe0d4'; x.fillRect(10, 11, 6, 4)
  x.fillStyle = '#fbf3e4'; x.fillRect(19, 0, 13, 13)
  x.fillStyle = dot; x.fillRect(21, 2, 9, 9)
  x.fillStyle = '#fbf3e4'; x.fillRect(21, 2, 1, 1); x.fillRect(29, 2, 1, 1); x.fillRect(21, 10, 1, 1); x.fillRect(29, 10, 1, 1)
  try { iconCache[dot] = c.toDataURL('image/png') } catch { iconCache[dot] = null }
  return iconCache[dot]
}
let iconState = ''
function syncIcon(state) {
  if (!iconLink || state === iconState) return
  iconState = state
  const url = state === 'perm' ? makeIcon('#c0623a') : state === 'idle' ? makeIcon(AB.COL.mint) : null
  if (url) { iconLink.setAttribute('type', 'image/png'); iconLink.setAttribute('href', url) }
  else if (iconOrig) { if (iconOrigType) iconLink.setAttribute('type', iconOrigType); iconLink.setAttribute('href', iconOrig) }
}

// ---------- QW3: Verbindung und "letztes Ereignis" ----------
const stage = document.querySelector('.stage')
const conn = document.createElement('div')
conn.className = 'ab-att-conn'; conn.hidden = true
conn.setAttribute('role', 'status')
conn.textContent = T('att.connLost')
const seen = document.createElement('div')
seen.className = 'ab-att-seen'; seen.hidden = true
if (stage) stage.append(conn, seen)

const loadAt = Date.now()
let wasLive = false, offSince = 0
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return T('ago.now')
  if (s < 60) return T('ago.s', { n: s })
  if (s < 3600) return T('ago.min', { n: Math.floor(s / 60) })
  if (s < 86400) return T('ago.h', { n: Math.floor(s / 3600) })
  return T('ago.d', { n: Math.floor(s / 86400) })
}
function syncConn(now) {
  const m = AB.mode()
  if (m === 'live') { wasLive = true; offSince = 0 } else if (m === 'off') { if (!offSince) offSince = now } else offSince = 0
  const pingGone = m === 'live' && AB.S.lastPingAt && now - AB.S.lastPingAt > 40000
  const off = m === 'off' && offSince && now - offSince > 3000 && (wasLive || now - loadAt > 6000)
  const show = m !== 'demo' && !!(pingGone || off)
  if (conn.hidden === show) conn.hidden = !show
  // letztes Ereignis: nur live (in der Demo passiert ohnehin dauernd etwas)
  let lastT = AB.S.lastEventAt || 0
  if (!lastT && AB.S.events.length) lastT = AB.S.events[AB.S.events.length - 1].t || 0
  const showSeen = m !== 'demo' && lastT > 0 && (m === 'live' || wasLive)
  if (showSeen) {
    const txt = T('att.lastEvent', { ago: ago(now - lastT) })
    if (seen.textContent !== txt) seen.textContent = txt
  }
  if (seen.hidden === showSeen) seen.hidden = !showSeen
}

// ---------- Takt (alle 500 ms nach dem DOM-Update) ----------
AB.on('ui', () => {
  const now = Date.now()
  wrapSound()
  // aufraeumen: verschwundene/fertige Agents, uralte Replay-Anfragen
  for (const [id, w] of [...waits]) {
    if (!AB.isLead(id)) { const a = AB.S.agents.get(id); if (!a || a.state === 'done') { waits.delete(id); continue } }
    if (w.silent && now - w.t > STALE_REPLAY_MS) waits.delete(id)
  }
  const perm = isWaitingPerm()
  const idle = !perm && AB.leadsShown().some((lid) => waits.has(lid) && waits.get(lid).kind === 'idle')
  syncTitle(perm)
  syncIcon(perm ? 'perm' : idle ? 'idle' : '')
  syncConn(now)
})

// fuer andere Module (z.B. Besatzungsliste): wer wartet gerade?
AB.waiting = () => [...waits.entries()].map(([id, w]) => ({ id, kind: w.kind, t: w.t, tool: w.tool, what: w.what, text: describe(id, w) }))
})()
