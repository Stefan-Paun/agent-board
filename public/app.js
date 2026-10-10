(() => {
'use strict'

const $ = (s) => document.querySelector(s)
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const tryLS = (fn) => { try { return fn() } catch { return null } }

// ---------- Namen, Farben, Stationen ----------
const HUES = ['#4f7a96', '#7d5f80', '#a68a2e', '#5f8f87', '#a14f62', '#6b7a4f', '#8a5a3a', '#5a6b8a']
const COL = { amber: '#96491f', mint: '#3f6048', coral: '#9c3f30', dim: '#6f5a40', line: '#ddc9a3', ink: '#3a2c20' }

// Pixel-Palette (fuer die Kunst-Pixel-Zeichnung, getrennt von den UI-Farbtokens oben)
const PX = {
  ink: '#3a2c20', paper: '#fbf3e4',
  floorA: '#e6cda3', floorB: '#d9bd8f', floorOnA: '#f0d6a8', floorOnB: '#e5c592',
  livA: '#d8b98b', livB: '#c9a87a', seam: '#ccab7f',
  lawn: '#d0d9b4', lawnDk: '#b4c293', glow: '#ffd27a',
  wall: '#9c8667', wood: '#a9825a', woodDk: '#8a6744',
  skin: '#e8b98a', skinSh: '#cf9e6e',
  metal: '#8a97a0', screen: '#bfe0d4', paperLine: '#c9b791',
  rug: '#d99a6c', plant: '#5f8f5a', plantPot: '#a9825a',
  // Fuer das "3D"-Wandrelief: helle Deckkante oben, dunkle Schattenkante unten an jeder Wand.
  wallTop: '#c3af8a', wallBase: '#6e5842',
  shadow: 'rgba(74,56,36,0.26)', shadowSoft: 'rgba(74,56,36,0.14)',
}

// Wohnungs-Grundriss: 3 Zimmer oben, 3 unten, das Wohnzimmer (Claudes Schreibtisch) in der Mitte.
// row/col bestimmen die Gitterposition; row legt auch fest, auf welcher Seite die Tuer liegt.
// Der Pausenraum ist nicht ueber ein Werkzeug erreichbar: fertige Agents gehen dort automatisch hin.
const STATIONS = [
  { id: 'archiv', label: 'Archiv', icon: 'archiv', row: 'top', col: -1, tools: ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'] },
  { id: 'werkstatt', label: 'Werkstatt', icon: 'werkstatt', row: 'top', col: 0, tools: ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'] },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', row: 'top', col: 1, tools: ['Bash', 'BashOutput', 'KillShell'] },
  { id: 'funkturm', label: 'Funkturm', icon: 'funkturm', row: 'bottom', col: -1, tools: ['WebSearch', 'WebFetch'] },
  { id: 'leitstand', label: 'Leitstand', icon: 'leitstand', row: 'bottom', col: 0, tools: [] },
  { id: 'pausenraum', label: 'Pausenraum', icon: 'pausenraum', row: 'bottom', col: 1, tools: [] },
]
const stationById = (id) => STATIONS.find((s) => s.id === id)
const stationFor = (tool) => {
  if (!tool) return null
  if (tool.startsWith('mcp__')) return stationById('funkturm')
  return STATIONS.find((s) => s.tools.includes(tool)) || stationById('leitstand')
}

// ---------- Zustand ----------
// name: wer gerade der Hauptagent ist - 'Claude' oder 'Codex' (aus ev.src, siehe collector.mjs)
const newMain = () => ({ name: 'Claude', last: 0, tool: null, station: null, flash: 0, ping: 0, what: '', count: 0, state: 'idle', recent: [], openTool: null })
const S = {
  agents: new Map(), names: new Set(), nameIdx: 0,
  main: newMain(),
  tools: 0, log: [], hueIdx: 0,
  stCount: Object.fromEntries(STATIONS.map((s) => [s.id, 0])),
  // Rohe Ereignisse (auch Replay) fuer Verlauf/Inspektion, Statusline-Daten, Auftraege fuer Subagents
  events: [], status: null, pendingTasks: [], lastEventAt: 0,
}
const EVENTS_MAX = 4000
const REPLAY_MAX_AGE = 6 * 3600e3 // Replay beim Laden: nur Ereignisse der letzten 6 Stunden
const particles = [], rings = []
// Erweiterungen setzen optional: AB.drawShip(ctx, agent, farbe, time, u), AB.renderCrew(ul, agents, main), AB.playSound(art, audioCtx)
const AB = (window.AgentBoard = { onResize: [] })

// ---------- Erweiterungen (public/fx/*.js) ----------
// Phasen: event(ev, silent) | bg/stations/under/scene(actx, time, dt) | agents/top(ctx, time, dt)
// | ui() | status(data) | click(hit)
const HOOKS = { event: [], bg: [], stations: [], under: [], scene: [], agents: [], top: [], ui: [], status: [], click: [] }
const hookErr = new Set()
function run(phase, ...args) {
  for (const fn of HOOKS[phase]) {
    try { fn(...args) } catch (e) {
      if (!hookErr.has(fn)) { hookErr.add(fn); console.error('[AgentBoard] Erweiterung fehlgeschlagen in', phase, e) }
    }
  }
}

let fxErrLogged = false
function reportFx(e) { if (!fxErrLogged) { fxErrLogged = true; console.error('[AgentBoard] Erweiterung fehlgeschlagen', e) } }

function nextName() {
  S.nameIdx++
  return `Agent ${S.nameIdx}`
}

function ensureAgent(id, role, t) {
  let a = S.agents.get(id)
  if (!a) {
    a = {
      id, name: nextName(), role: role || 'agent', color: HUES[S.hueIdx++ % HUES.length],
      x: geo.cx, y: geo.cy, vx: 0, vy: 0, st: null, stIdx: 0, state: 'active', born: t, last: t, doneAt: 0,
      what: '', count: 0, slot: S.agents.size, alpha: 1, recent: [], openTool: null, task: '',
    }
    S.agents.set(id, a)
    refreshTargets()
  } else if (role && a.role === 'agent') a.role = role
  return a
}

// ---------- Ereignisse ----------
function logLine(t, who, text, color) {
  S.log.push({ t, who, text, color })
  if (S.log.length > 60) S.log.shift()
}

// Schliesst das offene Werkzeug eines Agents: traegt Dauer/Ergebnis in den passenden recent-Eintrag
// ein (per tool_use_id, sonst der juengste offene Eintrag mit gleichem Werkzeug).
function closeTool(who, ev, t, ok) {
  const r = who.recent
  let hit = null
  for (let i = r.length - 1; i >= 0; i--) {
    if (r[i].dur != null) continue
    if ((ev.tid && r[i].tid === ev.tid) || (!ev.tid && (!ev.tool || r[i].tool === ev.tool))) { hit = r[i]; break }
  }
  if (hit) { hit.dur = ev.dur != null ? ev.dur : t - hit.t; hit.ok = ok }
  else if (ev.tid) rememberEarlyPost(ev, ok) // Post kam vor seinem Pre an (Hooks laufen parallel)
  if (who.openTool && (!ev.tid || who.openTool.tid === ev.tid || !who.openTool.tid)) who.openTool = null
}

// Jeder Hook startet einen eigenen Prozess, daher landet ein Post gelegentlich vor seinem Pre in der
// Datei. Solche Posts merken wir uns kurz (per tool_use_id) und verrechnen sie, sobald das Pre kommt.
const earlyPosts = new Map()
function rememberEarlyPost(ev, ok) {
  earlyPosts.set(ev.tid, { dur: ev.dur, ok })
  if (earlyPosts.size > 200) earlyPosts.delete(earlyPosts.keys().next().value)
}

function handle(ev, silent) {
  if (!ev || typeof ev !== 'object' || typeof ev.ev !== 'string') return
  const t = ev.t || Date.now()
  const id = ev.aid || 'main'
  const isMain = !ev.aid
  const fx = !silent
  if (!silent) S.lastEventAt = Date.now()
  if (isMain) S.main.name = ev.src === 'codex' ? 'Codex' : 'Claude'
  S.events.push(ev); if (S.events.length > EVENTS_MAX) S.events.splice(0, S.events.length - EVENTS_MAX)

  switch (ev.ev) {
    case 'UserPromptSubmit':
      S.main.last = t; S.main.state = 'active'; S.main.ping = 1
      logLine(t, S.main.name, 'Neuer Auftrag von dir', COL.amber)
      if (fx) { Snd.play('prompt'); burst(geo.cx, geo.cy, COL.amber, 10) }
      break

    case 'SubagentStart': {
      if (!ev.aid) break
      const a = ensureAgent(ev.aid, ev.at, t)
      a.state = 'active'; a.last = t
      // Auftrag: die Beschreibung des Agent/Task-Aufrufs, den Claude kurz vorher gemacht hat
      if (!a.task) { const p = S.pendingTasks.shift(); a.task = (p && p.what) || '' }
      logLine(t, a.name, `gestartet (${a.role})`, a.color)
      if (fx) { Snd.play('spawn'); burst(geo.cx, geo.cy, a.color, 8); ring(geo.cx, geo.cy, a.color, 70) }
      break
    }

    case 'PreToolUse': {
      const st = stationFor(ev.tool)
      S.tools++; if (st) S.stCount[st.id]++
      const who = isMain ? S.main : ensureAgent(id, ev.at, t)
      who.last = t; who.count++; who.what = `${ev.tool || ''} ${ev.what || ''}`.trim()
      const early = ev.tid && earlyPosts.get(ev.tid)
      if (early) earlyPosts.delete(ev.tid)
      who.recent.push({ t, tool: ev.tool || '', what: ev.what || '', tid: ev.tid || null, dur: early ? (early.dur != null ? early.dur : 0) : null, ok: early ? early.ok : true })
      if (who.recent.length > 20) who.recent.shift()
      who.openTool = early ? null : { t, tool: ev.tool || '', what: ev.what || '', tid: ev.tid || null }
      if (isMain && (ev.tool === 'Agent' || ev.tool === 'Task')) { S.pendingTasks.push({ tid: ev.tid || null, what: ev.what || '' }); if (S.pendingTasks.length > 20) S.pendingTasks.shift() }
      if (isMain) { S.main.tool = ev.tool; S.main.station = st; S.main.state = 'active' }
      else {
        if (st && (!who.st || who.st.id !== st.id)) {
          who.stIdx = 0
          for (const other of S.agents.values()) if (other !== who && other.st && other.st.id === st.id && other.state === 'active') who.stIdx++
        }
        who.st = st
        who.state = 'active' // ein neuer Aufruf beendet auch einen Fehler-Zustand sofort
      }
      logLine(t, isMain ? S.main.name : who.name, who.what, isMain ? COL.amber : who.color)
      if (fx && st) {
        const p = stationPos(st)
        ring(p.x, p.y, isMain ? COL.amber : who.color, 34)
        Snd.play('tool')
      }
      break
    }

    case 'PostToolUse': {
      const who = isMain ? S.main : S.agents.get(id)
      if (who) closeTool(who, ev, t, true)
      break
    }

    case 'PermissionDenied':
      dropPendingTask(ev)
      break

    case 'PostToolUseFailure': {
      dropPendingTask(ev)
      const who = isMain ? S.main : ensureAgent(id, ev.at, t)
      who.last = t
      closeTool(who, ev, t, false)
      if (!isMain) { who.state = 'error'; who.errAt = t }
      logLine(t, isMain ? S.main.name : who.name, `Fehler bei ${ev.tool || 'Werkzeug'}`, COL.coral)
      if (fx) {
        const p = isMain ? { x: geo.cx, y: geo.cy } : who
        ring(p.x, p.y, COL.coral, 50); burst(p.x, p.y, COL.coral, 6)
        Snd.play('error')
      }
      break
    }

    case 'SubagentStop': {
      const a = S.agents.get(ev.aid)
      if (!a) break // Phantom-Ticks ohne Start ignorieren
      a.pauseIdx = 0
      for (const other of S.agents.values()) if (other !== a && other.state === 'done') a.pauseIdx++
      a.state = 'done'; a.doneAt = t; a.last = t; a.st = null
      logLine(t, a.name, 'fertig', COL.mint)
      if (fx) { Snd.play('done'); ring(a.x, a.y, COL.mint, 50) }
      break
    }

    case 'Stop':
      S.main.state = 'idle'; S.main.last = t
      logLine(t, S.main.name, 'wartet auf dich', COL.amber)
      if (fx) { Snd.play('stop'); ring(geo.cx, geo.cy, COL.amber, 80) }
      break

    case 'Interrupt': // nur Codex: Lauf vom Nutzer abgebrochen
      S.main.state = 'idle'; S.main.last = t; S.main.openTool = null
      logLine(t, S.main.name, 'abgebrochen', COL.amber)
      break

    case 'Notification':
      logLine(t, S.main.name, ev.msg || 'Benachrichtigung', COL.amber)
      if (fx) { Snd.play('alert'); ring(geo.cx, geo.cy, COL.amber, 90) }
      break

    case 'SessionStart':
      logLine(t, 'System', `Session gestartet${ev.proj ? ' in ' + ev.proj : ''}`, COL.dim)
      break
    case 'SessionEnd':
      logLine(t, 'System', 'Session beendet', COL.dim)
      for (const a of S.agents.values()) if (a.state !== 'done') { a.state = 'done'; a.doneAt = t; a.openTool = null; a.st = null }
      S.main.openTool = null; S.pendingTasks = []
      break
  }
  run('event', ev, silent)
}

// Ein Agent-Aufruf, der abgelehnt wurde oder scheiterte, startet keinen Subagent: seinen Auftrag nicht vergeben
function dropPendingTask(ev) {
  if (ev.aid || (ev.tool !== 'Agent' && ev.tool !== 'Task')) return
  const i = ev.tid ? S.pendingTasks.findIndex((p) => p.tid === ev.tid) : S.pendingTasks.length - 1
  if (i >= 0) S.pendingTasks.splice(i, 1)
}

function sweep(now) {
  for (const [id, a] of S.agents) {
    if (a.state === 'active' && now - a.last > 90000) { a.state = 'idle'; a.st = null }
    if (a.state === 'error' && now - (a.errAt || a.last) > 5000) a.state = now - a.last < 20000 ? 'active' : 'idle'
    if (a.state === 'done' && now - a.doneAt > 60000) S.agents.delete(id)
    // ohne SubagentStop verwaist (Abbruch, abgestuerzte Session): nach 10 min Stille aufraeumen
    else if (a.state === 'idle' && now - a.last > 600000) S.agents.delete(id)
  }
  if (S.main.state === 'active' && now - S.main.last > 120000) S.main.state = 'idle'
}

// ---------- Geometrie ----------
// Alles Layout/Physik bleibt in CSS-Pixeln (geo.cx/cy, ...). Nur die eigentliche Zeichnung laeuft
// durch einen kleinen, niedrig aufgeloesten Puffer (artBuf), der dann unscharf-frei hochskaliert
// wird - das ergibt echte, scharfe Pixelgrafik statt geglaetteter Vektorformen.
const geo = { w: 800, h: 600, cx: 400, cy: 300, u: 1, dpr: 1 }
const canvas = $('#map')
const ctx = canvas.getContext('2d')
const artBuf = document.createElement('canvas')
const actx = artBuf.getContext('2d')
let ART_SCALE = 3 // echte Bildschirmpixel pro Kunst-Pixel (responsiv in resize() gesetzt)

// Rechnet eine CSS-Pixel-Weltkoordinate in eine ganzzahlige Kunst-Pixel-Koordinate im artBuf um.
function toArt(x, y) { return { x: Math.round((x * geo.dpr) / ART_SCALE), y: Math.round((y * geo.dpr) / ART_SCALE) } }

// Wohnungs-Grundriss in Kunst-Pixeln (TILE = eine Kachel, wie in einem klassischen Tile-Spiel)
const TILE = 8
const ROOM_W_PX = TILE * 13, ROOM_H_PX = TILE * 10, DOOR_W_PX = TILE * 2, GAP_PX = TILE, LIVING_H_PX = TILE * 11
const artToCss = (v) => (v * ART_SCALE) / geo.dpr
const roomWcss = () => artToCss(ROOM_W_PX)
const roomHcss = () => artToCss(ROOM_H_PX)
const gapCss = () => artToCss(GAP_PX)
const livingHalfHcss = () => artToCss(LIVING_H_PX / 2)

function stationPos(st) {
  const x = geo.cx + st.col * (roomWcss() + gapCss())
  const sign = st.row === 'top' ? -1 : 1
  const y = geo.cy + sign * (livingHalfHcss() + gapCss() + roomHcss() / 2)
  return { x, y }
}

// Ein lokaler Punkt (Ursprung = Raummitte, +y lokal = von der Tuer weg, ins Zimmer hinein) in
// Weltkoordinaten. Oben liegende Zimmer haben die Tuer unten, untere Zimmer die Tuer oben (180 Grad).
function roomPoint(st, lx, ly) {
  const p = stationPos(st)
  return st.row === 'top' ? { x: p.x + lx, y: p.y - ly } : { x: p.x - lx, y: p.y + ly }
}

// Aussengrenze der ganzen Wohnung (alle Zimmer umschliessend), in CSS-Pixeln.
function apartmentBoundsCss() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const st of STATIONS) {
    const p = stationPos(st)
    minX = Math.min(minX, p.x - roomWcss() / 2); maxX = Math.max(maxX, p.x + roomWcss() / 2)
    minY = Math.min(minY, p.y - roomHcss() / 2); maxY = Math.max(maxY, p.y + roomHcss() / 2)
  }
  return { minX, maxX, minY, maxY }
}

function resize() {
  const r = canvas.getBoundingClientRect()
  setTimeout(() => AB.onResize.forEach((f) => { try { f(geo) } catch (e) { console.error(e) } }))
  geo.dpr = Math.min(devicePixelRatio || 1, 2)
  geo.w = r.width; geo.h = r.height
  canvas.width = Math.round(r.width * geo.dpr); canvas.height = Math.round(r.height * geo.dpr)
  geo.cx = r.width / 2; geo.cy = r.height / 2 - 6
  geo.u = Math.max(1, Math.min(2, Math.min(r.width, r.height) / 440))
  // Zielgroesse an der tatsaechlichen Wohnungsgroesse ausgerichtet (+Luft fuer Kopf-/Fusszeile
  // der Stage), damit groessere Zimmer weder oben/unten noch links/rechts abgeschnitten werden.
  // Die kleinere der beiden Skalen (Breite/Hoehe) gewinnt, egal wie schmal/hoch die Stage ist.
  const apartmentArtH = ROOM_H_PX * 2 + LIVING_H_PX + GAP_PX * 2
  const apartmentArtW = ROOM_W_PX * 3 + GAP_PX * 2
  // Math.floor statt round: die Skala darf den sicheren Wert nie ueberschreiten, sonst passt der
  // Inhalt nicht mehr in den Puffer. Untergrenze 1 (nicht 2) - auf sehr schmalen Bildschirmen
  // zaehlt "passt rein" mehr als "bleibt grobpixelig".
  ART_SCALE = Math.max(1, Math.floor(Math.min(canvas.height / (apartmentArtH * 1.08), canvas.width / (apartmentArtW * 1.06))))
  artBuf.width = Math.max(1, Math.round(canvas.width / ART_SCALE))
  artBuf.height = Math.max(1, Math.round(canvas.height / ART_SCALE))
  actx.imageSmoothingEnabled = false
  refreshTargets()
}

function refreshTargets() {
  let i = 0
  for (const a of S.agents.values()) a.slot = i++
}

// ---------- Effekte ----------
function ring(x, y, color, max) {
  if (reduce) return
  rings.push({ x, y, color, r: 4, max: max * geo.u, life: 1 })
}
function burst(x, y, color, n) {
  if (reduce) n = Math.min(n, 4)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 90
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, size: 1.5 + Math.random() * 1.5 })
  }
}

// ---------- Zeichnen ----------
let last = performance.now()

function targetFor(a, time) {
  // Erweiterungen duerfen das Ziel uebersteuern (z.B. "wartet auf dich" -> zu Claudes Tisch gehen)
  if (AB.targetFor) { try { const r = AB.targetFor(a, time); if (r) return r } catch (e) { console.error(e) } }
  if (a.state === 'done') {
    // geht in den Pausenraum statt offen im Wohnzimmer zu schweben, faechert sich dort auf
    const pause = stationById('pausenraum')
    const idx = a.pauseIdx || 0
    const row = Math.floor(idx / 2), col = idx % 2
    const lx = (col - 0.5) * 16
    const ly = roomHcss() * 0.28 + row * 13
    return roomPoint(pause, lx, ly)
  }
  if (a.st) {
    // steht drinnen im Raum, von der Tuer weg gefaechert, statt die Station zu umkreisen
    const idx = a.stIdx || 0
    const row = Math.floor(idx / 2), col = idx % 2
    const lx = (col - 0.5) * 16
    const ly = roomHcss() * 0.3 + row * 14
    const sway = reduce ? 0 : Math.sin(time * 0.6 + idx * 1.7) * 2
    return roomPoint(a.st, lx + sway, ly)
  }
  // kein Werkzeug gerade aktiv: ruhig im Wohnzimmer warten
  const ang = a.slot * 1.9
  const sway = reduce ? 0 : Math.sin(time * 0.4 + a.slot) * 4
  return { x: geo.cx + Math.cos(ang) * livingHalfHcss() * 0.55 + sway, y: geo.cy + Math.sin(ang) * livingHalfHcss() * 0.4 }
}

// Tuer-Offenzustand je Station (0 zu, 1 offen), naehert sich jeden Frame dem Ziel an
const doorState = {}
function updateDoor(id, target, dt) {
  const d = (doorState[id] = doorState[id] || { a: 0 })
  d.a += (target - d.a) * Math.min(1, dt * 5)
  return d.a
}

// Zeichnet ein Zimmer von oben in Kunst-Pixeln: Boden, Waende MIT Hoehe (helle Deckkante +
// dunkle Schattenkante, wie ein kleines Relief statt einer flachen Linie - das "3D"-Gefuehl),
// Tueroeffnung, eine Schiebetuer, die beim Betreten zurueckfaehrt. Gibt die Raummitte zurueck.
function wallBlock(x, y, w, h, on) {
  // Zeichnet einen Wandabschnitt mit drei Baendern - helle Deckkante (oben/aussen), satte
  // Mittelflaeche, dunkle Schattenkante (unten/innen) - statt eines flachen Streifens. Deutlich
  // dickere Baender als vorher, damit die Wandhoehe von oben betrachtet klar ablesbar ist.
  const mainCol = on ? COL.amber : PX.wall
  const topH = Math.max(1, Math.round(h * 0.3)), baseH = Math.max(1, Math.round(h * 0.22))
  const midH = Math.max(1, h - topH - baseH)
  actx.fillStyle = PX.wallTop; actx.fillRect(x, y, w, topH)
  actx.fillStyle = mainCol; actx.fillRect(x, y + topH, w, midH)
  actx.fillStyle = on ? '#6b350f' : PX.wallBase; actx.fillRect(x, y + topH + midH, w, baseH)
}
// Holzdielen: waagrechte Fugen alle 5 Pixel, Stossfugen je Reihe versetzt wie echtes Parkett.
function planks(x, y, w, h, base, seam) {
  actx.fillStyle = base; actx.fillRect(x, y, w, h)
  actx.fillStyle = seam
  for (let yy = 0; yy < h; yy += 5) {
    actx.fillRect(x, y + yy, w, 1)
    const off = ((yy / 5) % 3) * 9
    for (let xx = off; xx < w; xx += 27) actx.fillRect(x + xx, y + yy, 1, Math.min(5, h - yy))
  }
}
// Warmer Lichtschein als gestufte, halbtransparente Rechtecke (pixelig statt Verlauf): zwei
// ueberlagerte Rechtecke pro Stufe ergeben eine abgerundete, zur Mitte hin hellere Form.
function lightPool(cx, cy, r, strength) {
  const a0 = actx.globalAlpha
  actx.fillStyle = PX.glow
  for (let i = 3; i >= 1; i--) {
    actx.globalAlpha = a0 * strength * 0.18
    const rr = Math.max(2, Math.round((r * i) / 3)), hh = Math.max(1, Math.round(rr * 0.55))
    actx.fillRect(cx - rr, cy - hh, rr * 2, hh * 2)
    actx.fillRect(cx - Math.round(rr * 0.7), cy - Math.round(hh * 1.4), Math.round(rr * 1.4), Math.round(hh * 2.8))
  }
  actx.globalAlpha = a0
}
function drawRoom(st, on, doorOpen) {
  const o = toArt(stationPos(st).x, stationPos(st).y)
  const w2 = ROOM_W_PX / 2, h2 = ROOM_H_PX / 2, dw2 = DOOR_W_PX / 2, wt = 7
  const floorA = on ? PX.floorOnA : PX.floorA, floorB = on ? PX.floorOnB : PX.floorB
  planks(o.x - w2, o.y - h2, w2 * 2, h2 * 2, floorA, floorB)
  // Schlagschatten, den die (hoeheren) Waende auf den Boden werfen - verstaerkt den Hoehen-Eindruck
  actx.fillStyle = PX.shadow
  actx.fillRect(o.x - w2 + wt, o.y - h2 + wt, w2 * 2 - wt * 2, 3)
  actx.fillRect(o.x - w2 + wt, o.y - h2 + wt, 3, h2 * 2 - wt * 2)
  actx.fillStyle = PX.shadowSoft
  actx.fillRect(o.x - w2 + wt, o.y - h2 + wt + 3, w2 * 2 - wt * 2, 3)
  wallBlock(o.x - w2, o.y - h2, w2 * 2, wt, on) // oben
  wallBlock(o.x - w2, o.y + h2 - wt, w2 * 2, wt, on) // unten
  wallBlock(o.x - w2, o.y - h2, wt, h2 * 2, on) // links
  wallBlock(o.x + w2 - wt, o.y - h2, wt, h2 * 2, on) // rechts
  // Tuerwand: oben liegende Zimmer -> Tuer unten; untere Zimmer -> Tuer oben
  const doorY = st.row === 'top' ? o.y + h2 - wt : o.y - h2
  actx.fillStyle = floorA
  actx.fillRect(o.x - dw2, doorY, dw2 * 2, wt)
  const doorFullW = dw2 * 2
  const doorNowW = Math.max(2, Math.round(doorFullW * (1 - doorOpen * 0.85)))
  actx.fillStyle = on ? COL.amber : PX.woodDk
  actx.fillRect(o.x - dw2, doorY, doorNowW, wt - 1)
  actx.fillStyle = PX.shadow
  actx.fillRect(o.x - dw2, doorY + wt - 1, doorNowW, 1)
  return o
}

const furnColsFor = (i) => [HUES[i % HUES.length], HUES[(i + 3) % HUES.length], HUES[(i + 5) % HUES.length]]

// Moebel-Register: eine Funktion pro Zimmer, in LOKALEN Kunst-Pixel-Koordinaten (0,0 = Zimmermitte).
// Konvention fuer alle Funktionen: die Rueckwand (weg von der Tuer) liegt lokal "oben" (negatives y),
// die Tuer lokal "unten" (positives y) - der Aufrufer dreht untere Zimmer per Spiegelung automatisch
// richtig herum, siehe drawFurniture(). `on` = Zimmer gerade belegt (fuer Akzentfarben). Nur
// ganzzahlige fillRect-Aufrufe, keine Kurven (siehe docs/FX-API.md).
const FURN = {
  archiv(on) { // Grosses Regal + Zeitschriftenstaender an der Rueckwand, Lesesessel mit Stehlampe
    // und Beistelltisch auf einem Teppich mit Rand, Tritthocker, lehnende Schriftrollen, gerahmtes
    // Bild, verstreute Buecher/Papierstapel und eine zusammengerollte Katze - jetzt viel voller.
    const accent = on ? COL.amber : PX.woodDk
    const cols = furnColsFor(0)
    const cols2 = furnColsFor(2)
    // Teppich mit Rand (Border-Muster) unter der ganzen Leseecke
    actx.fillStyle = accent; actx.fillRect(-10, -20, 38, 17)
    actx.fillStyle = PX.rug; actx.fillRect(-9, -19, 36, 15)
    // Grosses Regal an der Rueckwand links, drei Fachboeden voller Buecher
    actx.fillStyle = PX.woodDk; actx.fillRect(-31, -29, 21, 19)
    actx.fillStyle = PX.wood; actx.fillRect(-29, -27, 17, 15)
    actx.fillStyle = accent; actx.fillRect(-29, -21, 17, 1)
    actx.fillStyle = accent; actx.fillRect(-29, -15, 17, 1)
    for (let i = 0; i < 4; i++) { actx.fillStyle = cols[i % cols.length]; actx.fillRect(-28 + i * 4, -26, 3, 5) }
    for (let i = 0; i < 4; i++) { actx.fillStyle = cols[(i + 2) % cols.length]; actx.fillRect(-28 + i * 4, -20, 3, 5 - (i % 2)) }
    for (let i = 0; i < 4; i++) { actx.fillStyle = cols[(i + 1) % cols.length]; actx.fillRect(-28 + i * 4, -14, 3, 3 + (i % 2)) }
    // Zeitschriftenstaender / zweites kleineres Regal direkt daneben
    actx.fillStyle = PX.woodDk; actx.fillRect(-7, -29, 13, 11)
    actx.fillStyle = PX.wood; actx.fillRect(-6, -28, 11, 9)
    for (let i = 0; i < 3; i++) { actx.fillStyle = cols2[i % cols2.length]; actx.fillRect(-5 + i * 3, -27, 2, 7 - (i % 2)) }
    // Tritthocker vor dem grossen Regal
    actx.fillStyle = PX.woodDk; actx.fillRect(-30, -9, 7, 6)
    actx.fillStyle = PX.wood; actx.fillRect(-29, -8, 5, 2)
    actx.fillStyle = accent; actx.fillRect(-29, -8, 5, 1)
    // Schriftrollen, die am Regal lehnen
    actx.fillStyle = PX.paper; actx.fillRect(-21, -10, 2, 7)
    actx.fillStyle = PX.ink; actx.fillRect(-21, -10, 2, 1)
    actx.fillStyle = PX.paperLine; actx.fillRect(-18, -9, 2, 6)
    actx.fillStyle = PX.ink; actx.fillRect(-18, -9, 2, 1)
    // gerahmtes Bild an der Wand rechts
    actx.fillStyle = PX.woodDk; actx.fillRect(16, -29, 12, 8)
    actx.fillStyle = PX.paper; actx.fillRect(17, -28, 10, 6)
    actx.fillStyle = cols[3 % cols.length]; actx.fillRect(19, -27, 6, 4)
    // Stehlampe neben dem Sessel
    actx.fillStyle = PX.metal; actx.fillRect(9, -20, 1, 13)
    actx.fillStyle = PX.wood; actx.fillRect(7, -7, 5, 1)
    actx.fillStyle = accent; actx.fillRect(7, -23, 5, 4)
    actx.fillStyle = PX.paper; actx.fillRect(8, -22, 3, 2)
    // Lesesessel
    actx.fillStyle = PX.woodDk; actx.fillRect(11, -16, 12, 10)
    actx.fillStyle = cols[1]; actx.fillRect(13, -14, 8, 7)
    actx.fillStyle = accent; actx.fillRect(13, -14, 8, 1)
    // Beistelltisch mit Tasse und Sukkulente
    actx.fillStyle = PX.wood; actx.fillRect(25, -13, 5, 5)
    actx.fillStyle = PX.ink; actx.fillRect(26, -12, 2, 2)
    actx.fillStyle = PX.plantPot; actx.fillRect(28, -11, 2, 2)
    actx.fillStyle = PX.plant; actx.fillRect(28, -13, 2, 2)
    // Papierstapel auf dem Boden zwischen Regal und Sessel
    actx.fillStyle = PX.paperLine; actx.fillRect(-4, -7, 7, 3)
    actx.fillStyle = PX.paper; actx.fillRect(-3, -9, 5, 2)
    actx.fillStyle = PX.ink; actx.fillRect(-2, -10, 3, 1)
    // weitere Buecher locker auf dem Boden verstreut
    actx.fillStyle = cols2[0]; actx.fillRect(-15, -5, 4, 2)
    actx.fillStyle = cols2[1]; actx.fillRect(-10, -4, 5, 2)
    // schlafende Katze, zusammengerollt auf dem Teppich (gestufte Rechtecke statt Kurven)
    actx.fillStyle = PX.woodDk
    actx.fillRect(1, -6, 6, 3); actx.fillRect(0, -5, 8, 2); actx.fillRect(1, -3, 6, 1)
    actx.fillStyle = PX.ink
    actx.fillRect(2, -6, 2, 1); actx.fillRect(6, -4, 1, 1)
  },
  werkstatt(on) { // Werkbank mit Schraubstock, ein randvolles Pegboard, zweite Saegebock-Werkbank,
    // Rollwagen, Werkzeugkiste auf dem Boden, Fenster, angepinnter Bauplan, kleiner Ventilator und
    // Sand/Spaene-Kleinkram - jetzt eine richtig vollgestopfte Werkstatt.
    const accent = on ? COL.amber : PX.woodDk
    // Matte auf dem Boden, zieht sich unter Werkbank, Wagen und Saegebock durch
    actx.fillStyle = PX.rug; actx.fillRect(-29, -4, 56, 2)
    // Fenster oben links
    actx.fillStyle = PX.screen; actx.fillRect(-31, -29, 11, 8)
    actx.fillStyle = PX.wall; actx.fillRect(-21, -29, 1, 8); actx.fillRect(-31, -25, 11, 1)
    // angepinnter Bauplan neben dem Fenster
    actx.fillStyle = PX.screen; actx.fillRect(-18, -29, 13, 9)
    actx.fillStyle = PX.paper; actx.fillRect(-16, -27, 9, 1); actx.fillRect(-16, -24, 9, 1); actx.fillRect(-13, -29, 1, 9)
    actx.fillStyle = accent; actx.fillRect(-18, -29, 1, 1); actx.fillRect(-6, -29, 1, 1)
    // randvolles Pegboard an der Rueckwand rechts, mit Lochraster und vielen Werkzeugen
    actx.fillStyle = PX.wood; actx.fillRect(-5, -29, 32, 12)
    actx.fillStyle = PX.ink
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) actx.fillRect(-4 + i * 4, -27 + j * 3, 1, 1)
    // Hammer
    actx.fillStyle = PX.metal; actx.fillRect(-5, -26, 6, 3)
    actx.fillStyle = PX.woodDk; actx.fillRect(-3, -24, 2, 7)
    // Schraubenzieher
    actx.fillStyle = accent; actx.fillRect(3, -26, 2, 4)
    actx.fillStyle = PX.woodDk; actx.fillRect(3, -22, 2, 5)
    // Schraubenschluessel
    actx.fillStyle = PX.metal; actx.fillRect(8, -26, 4, 2); actx.fillRect(9, -26, 2, 9); actx.fillRect(8, -19, 4, 2)
    // Zange
    actx.fillStyle = PX.metal; actx.fillRect(14, -25, 2, 6); actx.fillRect(16, -25, 2, 6)
    actx.fillStyle = PX.ink; actx.fillRect(14, -19, 4, 1)
    // Saege
    actx.fillStyle = PX.woodDk; actx.fillRect(19, -27, 4, 4)
    actx.fillStyle = PX.metal; actx.fillRect(19, -24, 8, 2)
    // Maßband
    actx.fillStyle = accent; actx.fillRect(23, -20, 4, 4)
    actx.fillStyle = PX.ink; actx.fillRect(24, -19, 2, 2)
    // Hauptwerkbank an der Rueckwand links
    actx.fillStyle = PX.wood; actx.fillRect(-31, -16, 22, 6)
    actx.fillStyle = PX.woodDk; actx.fillRect(-31, -10, 22, 3)
    // Schraubstock auf der Werkbank
    actx.fillStyle = accent; actx.fillRect(-24, -22, 8, 6)
    actx.fillStyle = PX.metal; actx.fillRect(-23, -24, 6, 2)
    actx.fillStyle = PX.ink; actx.fillRect(-21, -21, 1, 4)
    // loses Werkzeug und Tasse auf der Werkbank
    actx.fillStyle = PX.ink; actx.fillRect(-29, -15, 3, 1)
    actx.fillStyle = PX.metal; actx.fillRect(-20, -15, 1, 2)
    actx.fillStyle = PX.ink; actx.fillRect(-15, -14, 2, 2)
    // zweite Werkbank: Planke auf zwei Saegeboecken, mit liegender Saege
    actx.fillStyle = PX.wood; actx.fillRect(-6, -13, 26, 3)
    actx.fillStyle = PX.woodDk; actx.fillRect(-4, -10, 2, 2); actx.fillRect(16, -10, 2, 2)
    actx.fillStyle = PX.metal; actx.fillRect(0, -13, 10, 1)
    actx.fillStyle = PX.woodDk; actx.fillRect(8, -14, 4, 4)
    // Werkzeugkiste auf dem Boden
    actx.fillStyle = accent; actx.fillRect(-31, -7, 8, 4)
    actx.fillStyle = PX.ink; actx.fillRect(-31, -8, 8, 1)
    actx.fillStyle = PX.metal; actx.fillRect(-28, -9, 1, 2); actx.fillRect(-25, -9, 1, 2); actx.fillRect(-28, -9, 4, 1)
    // Rollwagen mit Schubladen
    actx.fillStyle = PX.metal; actx.fillRect(2, -9, 15, 6)
    actx.fillStyle = PX.ink; actx.fillRect(3, -8, 13, 1); actx.fillRect(3, -5, 13, 1)
    actx.fillStyle = accent; actx.fillRect(8, -8, 2, 1); actx.fillRect(8, -5, 2, 1)
    actx.fillStyle = PX.ink; actx.fillRect(3, -3, 2, 1); actx.fillRect(14, -3, 2, 1)
    // kleiner Ventilator
    actx.fillStyle = PX.metal; actx.fillRect(-9, -13, 5, 5)
    actx.fillStyle = PX.ink; actx.fillRect(-7, -13, 1, 5); actx.fillRect(-9, -11, 5, 1)
    actx.fillStyle = PX.metal; actx.fillRect(-7, -8, 1, 4)
    actx.fillStyle = accent; actx.fillRect(-9, -4, 5, 2)
    // Sand/Spaene auf dem Boden verstreut
    actx.fillStyle = PX.wood
    actx.fillRect(-21, -3, 2, 1); actx.fillRect(-18, -2, 1, 1); actx.fillRect(6, -2, 2, 1)
    actx.fillRect(13, -3, 1, 1); actx.fillRect(20, -2, 2, 1); actx.fillRect(-3, -2, 1, 1)
    actx.fillStyle = PX.woodDk
    actx.fillRect(-19, -2, 1, 1); actx.fillRect(9, -3, 1, 1); actx.fillRect(18, -3, 1, 1)
  },
  terminal(on) { // Hauptschreibtisch mit Dual-Monitor, Pinnwand mit Klebezetteln, Whiteboard mit
    // Kritzeleien, Aktenschrank mit Ordnern, Serverrack mit Blinklichtern, Stehpult mit Laptop,
    // zwei Stuehlen, Pflanze und reichlich Kabelgewirr - alles "Kommandozeile/Coding"-Thema fuer
    // die Bash-Station (Raum jetzt deutlich groesser, darum viele zusaetzliche Einzelteile).
    const accent = on ? COL.amber : PX.woodDk

    // Teppich vor dem Hauptschreibtisch (zuerst, damit das Moebel darueber liegt)
    actx.fillStyle = PX.rug; actx.fillRect(-32, -7, 34, 5)
    // Hauptschreibtisch, durchgehend unter beiden Monitoren
    actx.fillStyle = PX.wood; actx.fillRect(-32, -11, 34, 4)

    // Zweiter, kleinerer Monitor links (Dual-Setup)
    actx.fillStyle = PX.ink; actx.fillRect(-32, -24, 9, 13)
    actx.fillStyle = PX.screen; actx.fillRect(-31, -23, 7, 11)
    actx.fillStyle = PX.ink; actx.fillRect(-29, -18, 4, 1)

    // Hauptmonitor mit Terminal-Textzeilen und Cursor auf dem Bildschirm
    actx.fillStyle = PX.ink; actx.fillRect(-21, -28, 16, 17)
    actx.fillStyle = PX.screen; actx.fillRect(-19, -26, 12, 13)
    actx.fillStyle = accent; actx.fillRect(-19, -26, 12, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-17, -23, 8, 1); actx.fillRect(-17, -20, 6, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-13, -16, 4, 2)

    // Tastatur und Maus
    actx.fillStyle = PX.metal; actx.fillRect(-19, -10, 14, 2)
    actx.fillStyle = PX.metal; actx.fillRect(-3, -9, 3, 2)

    // Notizblock mit Stift unter dem zweiten Monitor
    actx.fillStyle = PX.paper; actx.fillRect(-32, -8, 5, 3)
    actx.fillStyle = PX.paperLine; actx.fillRect(-31, -7, 3, 1); actx.fillRect(-31, -6, 2, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-26, -8, 1, 3)

    // Kabelgewirr, zieht vom Schreibtisch zum Boden
    actx.fillStyle = PX.ink
    actx.fillRect(-24, -7, 1, 3); actx.fillRect(-23, -4, 2, 1); actx.fillRect(-21, -6, 1, 2)

    // Kaffeetasse
    actx.fillStyle = PX.rug; actx.fillRect(-9, -7, 3, 3)
    actx.fillStyle = PX.ink; actx.fillRect(-6, -6, 1, 1)

    // Kopfhoerer haengen am rechten Schreibtischrand
    actx.fillStyle = PX.ink; actx.fillRect(-2, -7, 4, 1)
    actx.fillStyle = accent; actx.fillRect(-2, -5, 2, 2); actx.fillRect(1, -5, 2, 2)

    // Stuhl vor dem Hauptschreibtisch
    actx.fillStyle = PX.ink; actx.fillRect(-16, -5, 6, 3)
    actx.fillStyle = accent; actx.fillRect(-15, -5, 4, 1)

    // --- Stehpult / zweiter Arbeitsplatz mit Laptop ---
    actx.fillStyle = PX.woodDk; actx.fillRect(2, -14, 13, 3)
    actx.fillStyle = PX.wood; actx.fillRect(2, -14, 13, 1)
    actx.fillStyle = PX.ink; actx.fillRect(5, -20, 7, 7)
    actx.fillStyle = PX.screen; actx.fillRect(6, -19, 5, 5)
    actx.fillStyle = PX.ink; actx.fillRect(5, -14, 7, 1)
    // Stuhl davor (zweiter Stuhl)
    actx.fillStyle = PX.ink; actx.fillRect(5, -5, 6, 3)
    actx.fillStyle = accent; actx.fillRect(6, -5, 4, 1)
    // kleine Pflanze neben dem Stehpult
    actx.fillStyle = PX.plantPot; actx.fillRect(13, -7, 3, 2)
    actx.fillStyle = PX.plant; actx.fillRect(13, -10, 1, 3); actx.fillRect(15, -9, 1, 3)

    // --- Pinnwand mit bunten Klebezetteln ---
    actx.fillStyle = PX.woodDk; actx.fillRect(16, -29, 12, 5)
    actx.fillStyle = PX.paper; actx.fillRect(17, -28, 10, 3)
    actx.fillStyle = HUES[0]; actx.fillRect(18, -27, 2, 2)
    actx.fillStyle = HUES[3]; actx.fillRect(21, -27, 2, 2)
    actx.fillStyle = HUES[5]; actx.fillRect(24, -27, 2, 2)

    // --- Whiteboard mit Kritzeleien ---
    actx.fillStyle = PX.woodDk; actx.fillRect(16, -23, 12, 8)
    actx.fillStyle = PX.paper; actx.fillRect(17, -22, 10, 6)
    actx.fillStyle = PX.ink
    actx.fillRect(18, -21, 4, 1); actx.fillRect(18, -19, 3, 1); actx.fillRect(23, -20, 2, 1)
    actx.fillRect(19, -17, 6, 1)
    actx.fillStyle = accent; actx.fillRect(25, -17, 1, 1)

    // --- Aktenschrank mit bunten Ordnern ---
    actx.fillStyle = PX.woodDk; actx.fillRect(16, -14, 12, 11)
    actx.fillStyle = PX.wood; actx.fillRect(18, -12, 10, 7)
    actx.fillStyle = accent; actx.fillRect(18, -9, 10, 1)
    actx.fillStyle = HUES[2]; actx.fillRect(19, -12, 2, 3)
    actx.fillStyle = HUES[4]; actx.fillRect(22, -12, 2, 3)
    actx.fillStyle = HUES[6]; actx.fillRect(25, -12, 2, 3)
    actx.fillStyle = PX.metal; actx.fillRect(19, -6, 3, 3)
    actx.fillStyle = HUES[1]; actx.fillRect(23, -6, 3, 3)

    // --- Serverrack / NAS-Box mit Blinklichtern ---
    actx.fillStyle = PX.ink; actx.fillRect(28, -29, 4, 26)
    actx.fillStyle = PX.metal; actx.fillRect(29, -28, 2, 24)
    for (let i = 0; i < 6; i++) {
      actx.fillStyle = i % 2 === 0 ? accent : HUES[(i + 2) % HUES.length]
      actx.fillRect(29, -26 + i * 4, 1, 1)
    }
  },
  funkturm(on) { // Funkkonsole mit Teleskopantenne und Signal-Blips, zweite Bedienstation mit
    // Headset und Blinklichtern, Weltkarte mit Stecknadeln, Weltuhr mit mehreren Zeitzonen,
    // Pinnwand mit Notizen, Kopfhoerer am Haken und ein kleines Sofa fuer die Ueberwachungsschicht -
    // "Kommunikation/Netzwerk"-Thema fuer WebSearch/WebFetch (Raum jetzt deutlich groesser).
    const accent = on ? COL.amber : PX.woodDk

    // --- Hauptfunkkonsole links ---
    actx.fillStyle = PX.rug; actx.fillRect(-32, -9, 20, 6)
    actx.fillStyle = PX.wood; actx.fillRect(-32, -11, 17, 3)
    // Radiokorpus mit Anzeige und Zeiger
    actx.fillStyle = accent; actx.fillRect(-30, -24, 16, 13)
    actx.fillStyle = PX.paper; actx.fillRect(-27, -21, 6, 7)
    actx.fillStyle = PX.ink; actx.fillRect(-25, -18, 2, 2)
    // Lautsprechergitter (Punktraster)
    actx.fillStyle = PX.ink
    actx.fillRect(-19, -20, 1, 1); actx.fillRect(-17, -20, 1, 1)
    actx.fillRect(-19, -17, 1, 1); actx.fillRect(-17, -17, 1, 1)
    actx.fillRect(-19, -14, 1, 1); actx.fillRect(-17, -14, 1, 1)
    // Teleskopantenne, treppenfoermig gezeichnet (Diagonale als gestufte Rechtecke, siehe FX-API)
    actx.fillStyle = PX.ink
    actx.fillRect(-24, -25, 2, 2)
    actx.fillRect(-22, -27, 2, 2)
    actx.fillRect(-20, -28, 1, 1)
    // Signal-Blips, die von der Antennenspitze wegfliegen
    actx.fillStyle = HUES[0]; actx.fillRect(-17, -28, 1, 1)
    actx.globalAlpha = 0.55; actx.fillRect(-15, -27, 1, 1); actx.globalAlpha = 1

    // --- Zweite Bedienstation rechts daneben: Konsole, Headset-Mikro, Blinklichter, Stuhl ---
    actx.fillStyle = PX.wood; actx.fillRect(-14, -11, 15, 3)
    actx.fillStyle = PX.metal; actx.fillRect(-12, -20, 11, 9)
    actx.fillStyle = PX.screen; actx.fillRect(-10, -18, 7, 4)
    actx.fillStyle = HUES[2]; actx.fillRect(-10, -13, 2, 2)
    actx.fillStyle = HUES[4]; actx.fillRect(-7, -13, 2, 2)
    actx.fillStyle = accent; actx.fillRect(-4, -13, 2, 2)
    actx.fillStyle = PX.metal; actx.fillRect(-2, -20, 3, 2)
    actx.fillStyle = PX.ink; actx.fillRect(-1, -19, 1, 6)
    actx.fillStyle = PX.ink; actx.fillRect(-10, -5, 6, 3)
    actx.fillStyle = accent; actx.fillRect(-9, -5, 4, 1)

    // --- Weltkarte mit bunten Stecknadeln ---
    actx.fillStyle = PX.woodDk; actx.fillRect(3, -29, 15, 6)
    actx.fillStyle = PX.screen; actx.fillRect(4, -28, 13, 4)
    actx.fillStyle = PX.plant
    actx.fillRect(5, -27, 3, 1); actx.fillRect(10, -26, 4, 1); actx.fillRect(15, -27, 2, 1); actx.fillRect(8, -25, 2, 1)
    actx.fillStyle = HUES[1]; actx.fillRect(6, -27, 1, 1)
    actx.fillStyle = HUES[3]; actx.fillRect(12, -26, 1, 1)
    actx.fillStyle = HUES[5]; actx.fillRect(16, -27, 1, 1)
    actx.fillStyle = HUES[7]; actx.fillRect(9, -25, 1, 1)
    actx.fillStyle = HUES[0]; actx.fillRect(14, -25, 1, 1)

    // --- Weltuhr: drei kleine Uhren fuer verschiedene Zeitzonen, unter der Weltkarte ---
    actx.fillStyle = PX.woodDk; actx.fillRect(3, -21, 4, 6)
    actx.fillStyle = PX.paper; actx.fillRect(4, -20, 2, 4)
    actx.fillStyle = PX.ink; actx.fillRect(5, -18, 1, 2)
    actx.fillStyle = PX.woodDk; actx.fillRect(9, -21, 4, 6)
    actx.fillStyle = PX.paper; actx.fillRect(10, -20, 2, 4)
    actx.fillStyle = PX.ink; actx.fillRect(11, -19, 1, 3)
    actx.fillStyle = PX.woodDk; actx.fillRect(15, -21, 4, 6)
    actx.fillStyle = PX.paper; actx.fillRect(16, -20, 2, 4)
    actx.fillStyle = accent; actx.fillRect(17, -17, 1, 2)

    // --- Pinnwand mit mehr Stecknadeln und Notizzetteln ---
    actx.fillStyle = PX.woodDk; actx.fillRect(20, -29, 12, 7)
    actx.fillStyle = PX.paper; actx.fillRect(21, -28, 10, 5)
    actx.fillStyle = HUES[1]; actx.fillRect(22, -27, 2, 2)
    actx.fillStyle = HUES[4]; actx.fillRect(26, -27, 2, 2)
    actx.fillStyle = HUES[6]; actx.fillRect(29, -26, 1, 1)
    actx.fillStyle = PX.paper; actx.fillRect(22, -24, 4, 3)
    actx.fillStyle = PX.ink; actx.fillRect(23, -23, 2, 1)
    actx.fillStyle = PX.paper; actx.fillRect(27, -25, 3, 3)
    actx.fillStyle = PX.ink; actx.fillRect(28, -24, 1, 1)

    // --- Kopfhoerer an einem Haken neben der Pinnwand ---
    actx.fillStyle = PX.ink; actx.fillRect(30, -21, 1, 2)
    actx.fillStyle = PX.ink; actx.fillRect(28, -19, 4, 1)
    actx.fillStyle = accent; actx.fillRect(28, -18, 2, 2); actx.fillRect(30, -18, 2, 2)

    // --- Kleines Sofa fuer die Ueberwachungsschicht ---
    actx.fillStyle = PX.rug; actx.fillRect(20, -7, 11, 4)
    actx.fillStyle = PX.woodDk; actx.fillRect(20, -14, 11, 7)
    actx.fillStyle = accent; actx.fillRect(20, -13, 11, 1)
    actx.fillStyle = PX.wood; actx.fillRect(20, -11, 5, 4)
    actx.fillStyle = PX.wood; actx.fillRect(25, -11, 5, 4)
    actx.fillStyle = PX.woodDk; actx.fillRect(24, -11, 2, 4)
    actx.fillStyle = PX.woodDk; actx.fillRect(20, -13, 1, 6); actx.fillRect(30, -13, 1, 6)
  },
  leitstand(on) { // Empfangstresen: Wanduhr, Buerostuhl, Banker-Lampe, Glocke, Ablagekoerbe,
    // zwei Wartestuehle, Topfpflanze, Wasserspender, Pinnwand mit Anmeldeformular, Teppich, Garderobe.
    const accent = on ? COL.amber : PX.woodDk

    // Teppich, der Tresen UND beide Wartestuehle einrahmt
    actx.fillStyle = PX.rug; actx.fillRect(-30, -13, 60, 10)

    // Wanduhr an der Rueckwand, mittig - quadratischer Rahmen, Ziffernblatt mit vier Markierungen
    // (12/3/6/9) und einem einzelnen Zeiger Richtung 12, der im "on"-Zustand aufleuchtet.
    actx.fillStyle = PX.woodDk; actx.fillRect(-5, -22, 10, 9)
    actx.fillStyle = PX.paper; actx.fillRect(-4, -21, 8, 7)
    actx.fillStyle = PX.ink
    actx.fillRect(0, -21, 1, 1) // 12-Uhr-Markierung
    actx.fillRect(0, -15, 1, 1) // 6-Uhr-Markierung
    actx.fillRect(-3, -18, 1, 1) // 9-Uhr-Markierung
    actx.fillRect(3, -18, 1, 1) // 3-Uhr-Markierung
    actx.fillRect(0, -18, 1, 1) // Mittelpunkt
    actx.fillStyle = accent; actx.fillRect(0, -20, 1, 2) // Zeiger Richtung 12

    // Pinnwand mit angepinntem Besucher-Anmeldeformular, rechts von der Uhr an der Rueckwand
    actx.fillStyle = PX.wood; actx.fillRect(10, -29, 15, 8)
    actx.fillStyle = PX.paper; actx.fillRect(12, -27, 11, 5)
    actx.fillStyle = PX.paperLine; actx.fillRect(13, -26, 9, 1); actx.fillRect(13, -25, 7, 1); actx.fillRect(13, -24, 8, 1)
    actx.fillStyle = PX.ink; actx.fillRect(16, -28, 1, 1) // Reisszwecke
    actx.fillStyle = HUES[3]; actx.fillRect(21, -28, 1, 1) // zweite, bunte Reisszwecke
    actx.fillStyle = PX.ink; actx.fillRect(23, -24, 1, 3) // Stift an einer Schnur

    // Wasserspender links an der Rueckwand: Standfuss, "durchsichtige" Flasche, Zapfhahn
    actx.fillStyle = PX.metal; actx.fillRect(-31, -24, 6, 7)
    actx.fillStyle = PX.screen; actx.fillRect(-30, -29, 4, 5)
    actx.fillStyle = accent; actx.fillRect(-30, -29, 4, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-29, -20, 2, 1)

    // Garderobenstaender darunter, mit deutlichem Abstand zum Wartestuhl: Standfuss, Stange,
    // zwei Haken mit haengendem Mantel und Schal
    actx.fillStyle = PX.wood; actx.fillRect(-32, -10, 6, 1)
    actx.fillStyle = PX.woodDk; actx.fillRect(-30, -17, 2, 8)
    actx.fillStyle = PX.ink; actx.fillRect(-31, -16, 1, 1); actx.fillRect(-28, -14, 1, 1)
    actx.fillStyle = HUES[5]; actx.fillRect(-32, -15, 3, 4)
    actx.fillStyle = HUES[6]; actx.fillRect(-29, -13, 2, 2)

    // Buerostuhl hinter dem Tresen - lehnt an der Wand, direkt unter der Uhr.
    actx.fillStyle = PX.ink; actx.fillRect(-3, -13, 7, 3)

    // Empfangstresen: dunkler Korpus, helle Deckplatte, dunkle Blende zu den Besuchern hin
    actx.fillStyle = PX.woodDk; actx.fillRect(-18, -11, 36, 9)
    actx.fillStyle = PX.wood; actx.fillRect(-17, -10, 34, 6)
    actx.fillStyle = PX.woodDk; actx.fillRect(-17, -4, 34, 2)

    // Banker-Lampe links auf dem Tresen: gruener Schirm (immer sichtbar), leuchtet amber im "on"-Zustand
    actx.fillStyle = PX.plant; actx.fillRect(-15, -10, 6, 2)
    actx.fillStyle = PX.plant; actx.fillRect(-14, -11, 4, 1)
    actx.fillStyle = PX.metal; actx.fillRect(-13, -9, 2, 2)
    actx.fillStyle = on ? COL.amber : PX.paper; actx.fillRect(-14, -10, 2, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-12, -9, 1, 1)

    // Kleine Glocke in der Mitte des Tresens
    actx.fillStyle = PX.metal; actx.fillRect(-2, -8, 5, 2)
    actx.fillStyle = PX.metal; actx.fillRect(-1, -9, 3, 1)
    actx.fillStyle = PX.ink; actx.fillRect(0, -9, 1, 1)

    // Ablagekoerbe rechts: Eingang oben, Ausgang darunter, mit Papierstapeln
    actx.fillStyle = PX.metal; actx.fillRect(8, -10, 10, 3)
    actx.fillStyle = PX.paper; actx.fillRect(9, -9, 8, 2)
    actx.fillStyle = PX.paperLine; actx.fillRect(9, -9, 8, 1)
    actx.fillStyle = PX.metal; actx.fillRect(8, -6, 10, 3)
    actx.fillStyle = PX.paper; actx.fillRect(9, -5, 8, 2)
    actx.fillStyle = PX.paperLine; actx.fillRect(9, -5, 8, 1)

    // Wartestuhl links, ausserhalb des Tresens
    actx.fillStyle = PX.woodDk; actx.fillRect(-23, -8, 5, 5)
    actx.fillStyle = PX.wood; actx.fillRect(-22, -7, 3, 3)

    // Zweiter Wartestuhl rechts, symmetrisch zum ersten, ausserhalb des Tresens
    actx.fillStyle = PX.woodDk; actx.fillRect(18, -8, 5, 5)
    actx.fillStyle = PX.wood; actx.fillRect(19, -7, 3, 3)

    // Kleine Topfpflanze in der rechten Ecke
    actx.fillStyle = PX.plantPot; actx.fillRect(27, -6, 4, 3)
    actx.fillStyle = PX.plant; actx.fillRect(27, -10, 2, 5); actx.fillRect(29, -9, 2, 4)
  },
  pausenraum(on) { // Gemuetliche Ecke: Sofa (mit zusammengerollter Katze), Couchtisch mit Tasse &
    // Teller, Buecherregal (plus Buecherstapel am Boden), zweiter Sessel, gemusterter Teppich,
    // Kuechenzeile, Dartboard, Lichterkette, Fenster mit Topfpflanze - der Lohn fuer fertige Agents,
    // das gemuetlichste Zimmer der Wohnung.
    const accent = on ? COL.amber : PX.woodDk

    // Teppich vor dem Sofa, mit gewebtem Rahmen und Rauten-Akzenten an den sichtbaren Raendern
    actx.fillStyle = PX.rug; actx.fillRect(-13, -10, 26, 7)
    actx.fillStyle = PX.wood
    actx.fillRect(-13, -10, 26, 1); actx.fillRect(-13, -4, 26, 1)
    actx.fillRect(-13, -10, 1, 7); actx.fillRect(12, -10, 1, 7)
    actx.fillStyle = HUES[0]
    actx.fillRect(-12, -8, 2, 2); actx.fillRect(-12, -6, 2, 2)
    actx.fillRect(10, -8, 2, 2); actx.fillRect(10, -6, 2, 2)

    // Buecherregal links in der Ecke, zwei Faecher mit bunten Buechern
    actx.fillStyle = PX.woodDk; actx.fillRect(-23, -21, 7, 12)
    actx.fillStyle = PX.wood; actx.fillRect(-22, -20, 5, 10)
    actx.fillStyle = accent; actx.fillRect(-22, -15, 5, 1)
    const bcols = furnColsFor(2)
    actx.fillStyle = bcols[0]; actx.fillRect(-21, -19, 1, 4)
    actx.fillStyle = bcols[1]; actx.fillRect(-20, -19, 1, 4)
    actx.fillStyle = bcols[2]; actx.fillRect(-19, -19, 1, 4)
    actx.fillStyle = bcols[1]; actx.fillRect(-21, -13, 1, 3)
    actx.fillStyle = bcols[2]; actx.fillRect(-20, -13, 1, 3)
    actx.fillStyle = bcols[0]; actx.fillRect(-19, -13, 1, 3)

    // Dartboard an der Rueckwand ueber dem Regal, inklusive ein paar (auch verfehlten) Pfeilen
    actx.fillStyle = PX.woodDk; actx.fillRect(-22, -29, 8, 7)
    actx.fillStyle = HUES[4]; actx.fillRect(-21, -28, 6, 5)
    actx.fillStyle = PX.paper; actx.fillRect(-20, -27, 4, 3)
    actx.fillStyle = HUES[4]; actx.fillRect(-19, -26, 2, 1)
    actx.fillStyle = PX.ink; actx.fillRect(-18, -27, 1, 2); actx.fillRect(-23, -26, 1, 2); actx.fillRect(-17, -25, 1, 1)

    // Weiterer Buecherstapel am Boden vor dem Regal (mehr Buecher)
    actx.fillStyle = HUES[3]; actx.fillRect(-24, -4, 6, 2)
    actx.fillStyle = HUES[5]; actx.fillRect(-23, -6, 5, 2)
    actx.fillStyle = HUES[1]; actx.fillRect(-22, -8, 4, 2)

    // Zweiter Sessel links, mit Akzentstreifen und kleinem Fusskissen davor (kraeftige Polsterfarbe,
    // damit er sich vom Holzrahmen abhebt)
    actx.fillStyle = PX.woodDk; actx.fillRect(-31, -15, 7, 11)
    actx.fillStyle = HUES[0]; actx.fillRect(-29, -13, 5, 7)
    actx.fillStyle = accent; actx.fillRect(-29, -13, 5, 1)
    actx.fillStyle = PX.wood; actx.fillRect(-29, -4, 4, 2)

    // Fenster mit Topfpflanze rechts in der Ecke
    actx.fillStyle = PX.woodDk; actx.fillRect(16, -21, 8, 9)
    actx.fillStyle = PX.screen; actx.fillRect(17, -20, 6, 7)
    actx.fillStyle = PX.wall; actx.fillRect(17, -17, 6, 1)
    actx.fillStyle = PX.wall; actx.fillRect(19, -20, 1, 7)
    actx.fillStyle = PX.plantPot; actx.fillRect(17, -11, 6, 4)
    actx.fillStyle = PX.plant
    actx.fillRect(17, -15, 2, 5); actx.fillRect(20, -16, 2, 6); actx.fillRect(19, -13, 2, 4)

    // Kleine Kuechenzeile rechts vom Fenster: Wandregal mit Tassen, Wasserkocher auf der
    // Arbeitsplatte, Unterschrank mit Griffen
    actx.fillStyle = PX.wood; actx.fillRect(25, -21, 7, 2)
    actx.fillStyle = HUES[0]; actx.fillRect(26, -23, 2, 2)
    actx.fillStyle = HUES[2]; actx.fillRect(29, -23, 2, 2)
    actx.fillStyle = PX.wood; actx.fillRect(24, -11, 9, 2)
    actx.fillStyle = PX.metal; actx.fillRect(26, -15, 4, 4)
    actx.fillStyle = accent; actx.fillRect(26, -15, 4, 1)
    actx.fillStyle = PX.ink; actx.fillRect(30, -14, 1, 1)
    actx.fillStyle = PX.woodDk; actx.fillRect(25, -10, 7, 7)
    actx.fillStyle = PX.ink; actx.fillRect(27, -7, 1, 3); actx.fillRect(29, -7, 1, 3)

    // Sofa an der Rueckwand: Rueckenlehne mit Ziernaht, zwei Sitzkissen mit Ritze, Armlehnen
    actx.fillStyle = PX.woodDk; actx.fillRect(-14, -21, 28, 11)
    actx.fillStyle = accent; actx.fillRect(-13, -19, 26, 1)
    actx.fillStyle = PX.wood; actx.fillRect(-13, -18, 26, 2)
    actx.fillStyle = PX.wood; actx.fillRect(-13, -16, 12, 6)
    actx.fillStyle = PX.wood; actx.fillRect(1, -16, 12, 6)
    actx.fillStyle = PX.woodDk; actx.fillRect(-1, -16, 2, 6)
    actx.fillStyle = PX.woodDk; actx.fillRect(-14, -18, 2, 7)
    actx.fillStyle = PX.woodDk; actx.fillRect(12, -18, 2, 7)

    // Katze, zusammengerollt auf dem rechten Sofakissen
    actx.fillStyle = PX.woodDk
    actx.fillRect(5, -14, 6, 4) // Koerper
    actx.fillRect(9, -15, 3, 2) // Schwanzansatz
    actx.fillRect(11, -13, 2, 2) // Schwanzspitze, um den Koerper gelegt
    actx.fillStyle = PX.ink
    actx.fillRect(4, -15, 1, 1); actx.fillRect(6, -16, 1, 1) // Ohren
    actx.fillStyle = HUES[2]; actx.fillRect(6, -12, 2, 2) // helleres Bauchfell

    // Couchtisch mit Tasse und Teller
    actx.fillStyle = PX.woodDk; actx.fillRect(-9, -9, 18, 5)
    actx.fillStyle = PX.wood; actx.fillRect(-8, -8, 16, 3)
    actx.fillStyle = PX.paper; actx.fillRect(-6, -7, 4, 2)
    actx.fillStyle = HUES[1]; actx.fillRect(2, -8, 3, 3)
    actx.fillStyle = PX.ink; actx.fillRect(5, -7, 1, 1)

    // Lichterkette, leicht durchhaengend an der Rueckwand entlang gespannt (umgeht das Dartboard)
    const sagY = (x) => (x <= -20 || x >= 20) ? -29 : (x <= -10 || x >= 10) ? -28 : -27
    const overDart = (x) => x >= -23 && x <= -14
    actx.fillStyle = PX.ink
    for (let x = -29; x <= 28; x += 2) if (!overDart(x)) actx.fillRect(x, sagY(x), 2, 1)
    const bulbHueIdx = [0, 2, 4, 6, 1, 3, 5, 7, 0, 2]
    let bi = 0
    for (let x = -28; x <= 28; x += 6) {
      if (overDart(x)) continue
      actx.fillStyle = HUES[bulbHueIdx[bi++ % bulbHueIdx.length]]
      actx.fillRect(x, sagY(x) + 1, 1, 1)
    }
  },
}

// Zeichnet die Moebel fuer st.icon an ox/oy (Zimmermitte in Kunst-Pixeln). Untere Zimmer werden
// gespiegelt, damit jede FURN-Funktion unabhaengig von row nur "Rueckwand = oben" kennen muss.
function drawFurniture(st, ox, oy, on) {
  const fn = FURN[st.icon] || FURN.leitstand
  actx.save()
  // Die FURN-Funktionen wurden fuer ein kleineres Zimmer gezeichnet (Rueckwand bei lokal -32);
  // die Zimmer sind seither groesser geworden (Rueckwand jetzt bei -40) - hier um die Differenz
  // verschieben, damit die Moebel wieder buendig an der Rueckwand stehen statt mittig zu schweben.
  // Vorzeichen haengt von row ab, weil untere Zimmer nach dem Verschieben noch gespiegelt werden.
  const backShift = ROOM_H_PX / 2 - 32
  actx.translate(ox, st.row === 'top' ? oy - backShift : oy + backShift)
  if (st.row === 'bottom') actx.scale(1, -1)
  // generischer Bodenschatten unter dem ganzen Moebel-Cluster, leicht nach "vorne" (zur Tuer, +y)
  // versetzt - gibt den Objekten Gewicht/Tiefe, ohne dass jedes FURN-Stueck einen eigenen braucht.
  actx.fillStyle = PX.shadowSoft
  actx.fillRect(-32, -16, 64, 15)
  // Laeufer-Teppich in der jetzt groesseren, sonst leeren Mittelzone zwischen Moebeln und Tuer -
  // faerbiger Rahmen je Station, damit die vergroesserten Zimmer nicht leer/unmoebliert wirken.
  const rugHue = HUES[(st.id.charCodeAt(0) + st.id.length) % HUES.length]
  actx.fillStyle = on ? COL.amber : rugHue
  actx.globalAlpha *= 0.55
  actx.fillRect(-26, -13, 52, 15)
  actx.globalAlpha /= 0.55
  actx.fillStyle = PX.rug
  actx.fillRect(-23, -10, 46, 9)
  actx.fillStyle = rugHue
  for (let x = -20; x < 22; x += 6) actx.fillRect(x, -6, 2, 1)
  fn(on)
  // Gemuetliche Ecken, in jedem Zimmer gleich: Zimmerpflanze hinten links, Stehlampe hinten
  // rechts mit warmem Lichtkegel auf dem Boden (heller, wenn das Zimmer gerade belegt ist).
  actx.fillStyle = PX.plantPot; actx.fillRect(-44, -24, 6, 6)
  actx.fillStyle = PX.woodDk; actx.fillRect(-44, -19, 6, 1)
  actx.fillStyle = PX.plant
  actx.fillRect(-45, -30, 3, 7); actx.fillRect(-42, -31, 3, 8); actx.fillRect(-39, -29, 3, 6)
  actx.fillStyle = '#4a7a48'; actx.fillRect(-42, -27, 1, 3); actx.fillRect(-44, -26, 1, 2)
  lightPool(40, -16, 14, on ? 1 : 0.55)
  actx.fillStyle = PX.woodDk; actx.fillRect(38, -21, 6, 2)
  actx.fillStyle = PX.ink; actx.fillRect(40, -28, 2, 7)
  actx.fillStyle = on ? PX.glow : '#e9cf9a'; actx.fillRect(37, -31, 8, 3)
  actx.fillStyle = PX.woodDk; actx.fillRect(37, -31, 8, 1)
  actx.restore()
}

// Richtet im Kunst-Pixel-Puffer Text an, misst ihn aber ueber den scharfen ctx (Metriken sind
// aufloesungsunabhaengig). Das eigentliche Zeichnen passiert erst nach dem Hochskalieren.
function measureLabel(text, px) {
  ctx.font = `700 ${px}px "Avenir Next","Helvetica Neue",system-ui,sans-serif`
  return ctx.measureText(text).width
}

function frame(now) {
  requestAnimationFrame(frame)
  if (document.hidden) { last = now; return }
  const dt = Math.min((now - last) / 1000, 0.05); last = now
  const time = now / 1000
  const wall = Date.now()

  // ---- Kunst-Pixel-Durchgang: die ganze Szene in niedriger Aufloesung ----
  actx.setTransform(1, 0, 0, 1, 0, 0)
  actx.clearRect(0, 0, artBuf.width, artBuf.height)
  // Garten rund ums Haus: weiche Wiese mit Grasbueschelchen und ein paar Blumen (deterministisch
  // aus der Position gehasht, damit nichts flackert).
  actx.fillStyle = PX.lawn; actx.fillRect(0, 0, artBuf.width, artBuf.height)
  const FLOWERS = ['#f2d27a', '#e8a0a8', '#fbf3e4', '#b9a3d6']
  for (let y = 2; y < artBuf.height; y += 6) {
    for (let x = ((((y - 2) / 6) | 0) % 2) * 4; x < artBuf.width; x += 8) {
      const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0
      if (hsh % 5 === 0) { actx.fillStyle = PX.lawnDk; actx.fillRect(x, y, 1, 2); actx.fillRect(x + 2, y + 1, 1, 1) }
      else if (hsh % 23 === 0) { actx.fillStyle = FLOWERS[hsh % FLOWERS.length]; actx.fillRect(x, y, 1, 1); actx.fillStyle = PX.plant; actx.fillRect(x, y + 1, 1, 1) }
    }
  }
  run('bg', actx, time, dt)

  // Aussenwand der ganzen Wohnung, mit ein paar Fenstern - damit alle Zimmer sichtbar zu EINEM
  // Gebaeude gehoeren statt lose auf dem Boden zu stehen. Innen warme Holzdielen im Wohnzimmer.
  {
    const b = apartmentBoundsCss(), m = gapCss() * 0.6
    const tl = toArt(b.minX - m, b.minY - m), br = toArt(b.maxX + m, b.maxY + m)
    // weicher Schlagschatten des Hauses auf die Wiese (nach rechts unten versetzt)
    actx.fillStyle = PX.shadow; actx.fillRect(tl.x + 4, br.y, br.x - tl.x, 4); actx.fillRect(br.x, tl.y + 4, 4, br.y - tl.y)
    planks(tl.x, tl.y, br.x - tl.x, br.y - tl.y, PX.livA, PX.seam)
    const wt = 8
    wallBlock(tl.x, tl.y, br.x - tl.x, wt, false)
    wallBlock(tl.x, br.y - wt, br.x - tl.x, wt, false)
    wallBlock(tl.x, tl.y, wt, br.y - tl.y, false)
    wallBlock(br.x - wt, tl.y, wt, br.y - tl.y, false)
    actx.fillStyle = PX.screen
    const winW = 10, gap2 = 18
    for (let wx = tl.x + 14; wx < br.x - 14; wx += gap2) { actx.fillRect(wx, tl.y + 1, winW, wt - 2); actx.fillRect(wx, br.y - wt + 1, winW, wt - 2) }
    actx.fillStyle = PX.wallBase
    for (let wx = tl.x + 14; wx < br.x - 14; wx += gap2) { actx.fillRect(wx, tl.y + wt - 2, winW, 1); actx.fillRect(wx, br.y - 2, winW, 1) }
  }

  const occ = {}
  for (const a of S.agents.values()) {
    if (a.st && a.state === 'active') occ[a.st.id] = (occ[a.st.id] || 0) + 1
    if (a.state === 'done') occ.pausenraum = (occ.pausenraum || 0) + 1
  }
  const mainStation = S.main.station && wall - S.main.last < 3500 ? S.main.station : null
  // Sammelt belegte Textbereiche (Stationen, Claude, dann Agent-Namen) UND die eigentlichen
  // Texte, die erst nach dem Hochskalieren scharf gezeichnet werden.
  const labelRects = []
  const pendingLabels = []

  for (const st of STATIONS) {
    const on = occ[st.id] || (mainStation && mainStation.id === st.id)
    const doorPt = toArt(roomPoint(st, 0, 0).x, roomPoint(st, 0, 0).y)
    const hallA = toArt(geo.cx, geo.cy)
    actx.strokeStyle = on ? COL.amber : '#cdb98f'; actx.globalAlpha = on ? 0.6 : 0.4; actx.lineWidth = 1
    actx.beginPath(); actx.moveTo(hallA.x, hallA.y); actx.lineTo(doorPt.x, doorPt.y); actx.stroke(); actx.globalAlpha = 1
    const doorOpen = updateDoor(st.id, on ? 1 : 0, dt)
    const o = drawRoom(st, on, doorOpen)
    drawFurniture(st, o.x, o.y, on)

    const labelPt = roomPoint(st, 0, roomHcss() / 2 + 12)
    const labelPx = 11 * geo.u
    const lw = measureLabel(st.label, labelPx)
    pendingLabels.push({ text: st.label, x: labelPt.x, y: labelPt.y, px: labelPx, color: on ? COL.amber : COL.ink, weight: 600 })
    labelRects.push({ x: labelPt.x, w: lw + 8 * geo.u, y: labelPt.y, h: 15 * geo.u })
    if (S.stCount[st.id]) {
      const countPt = roomPoint(st, 0, roomHcss() / 2 + 25)
      const txt = '×' + S.stCount[st.id]
      pendingLabels.push({ text: txt, x: countPt.x, y: countPt.y, px: 10 * geo.u, color: COL.dim, weight: 600 })
      labelRects.push({ x: countPt.x, w: 30 * geo.u, y: countPt.y, h: 14 * geo.u })
    }
  }

  if (mainStation) {
    const p = toArt(roomPoint(mainStation, 0, 0).x, roomPoint(mainStation, 0, 0).y)
    const c = toArt(geo.cx, geo.cy)
    actx.strokeStyle = COL.amber; actx.globalAlpha = 0.6; actx.lineWidth = 1
    actx.beginPath(); actx.moveTo(c.x, c.y); actx.lineTo(p.x, p.y); actx.stroke(); actx.globalAlpha = 1
  }

  run('stations', actx, time, dt)

  // Claude: Schreibtisch, Stuhl, Lampe und ein kleiner Teppich in der Mitte des Wohnzimmers
  const working = S.main.state === 'active' || [...S.agents.values()].some((a) => a.state === 'active')
  const pulse = 1 + Math.sin(time * 1.6) * 0.03 + S.main.ping * 0.14
  S.main.ping = Math.max(0, S.main.ping - dt * 1.5)
  const cc = toArt(geo.cx, geo.cy)
  const ab = apartmentBoundsCss()
  const L = toArt(ab.minX, geo.cy).x + 4, R = toArt(ab.maxX, geo.cy).x - 4
  // grosser Teppich mit Rand und Muster unter Claudes Schreibtisch
  actx.fillStyle = COL.amber; actx.globalAlpha = 0.45; actx.fillRect(cc.x - 32, cc.y - 19, 64, 38); actx.globalAlpha = 1
  actx.fillStyle = PX.rug; actx.fillRect(cc.x - 29, cc.y - 16, 58, 32)
  actx.fillStyle = '#c4835a'
  for (let x = -26; x < 27; x += 6) { actx.fillRect(cc.x + x, cc.y - 14, 2, 1); actx.fillRect(cc.x + x, cc.y + 13, 2, 1) }
  // Pflanze links daneben
  actx.fillStyle = PX.plantPot; actx.fillRect(cc.x - 30, cc.y + 6, 7, 6)
  actx.fillStyle = PX.plant
  actx.fillRect(cc.x - 32, cc.y - 2, 4, 8); actx.fillRect(cc.x - 27, cc.y - 4, 4, 9); actx.fillRect(cc.x - 29, cc.y - 7, 4, 7)
  // warmer Schein der Schreibtischlampe
  lightPool(cc.x + 10, cc.y - 2, 16, working ? 1 : 0.5)
  // Schreibtisch
  const deskGlow = Math.round(pulse * 1.5)
  actx.fillStyle = PX.woodDk; actx.fillRect(cc.x - 18, cc.y - 11, 36, 24)
  actx.fillStyle = PX.wood; actx.fillRect(cc.x - 16, cc.y - 9, 32, 20)
  actx.fillStyle = '#c29a6c'; actx.fillRect(cc.x - 16, cc.y - 9, 32, 1)
  // Stuhl (unten)
  actx.fillStyle = PX.ink; actx.fillRect(cc.x - 6, cc.y + 14, 12, 3)
  // Monitor + Lampe auf dem Tisch
  actx.fillStyle = COL.amber; actx.fillRect(cc.x - 13, cc.y - 7, 10, 8)
  actx.fillStyle = PX.screen; actx.fillRect(cc.x - 12, cc.y - 6, 8, 5)
  actx.fillStyle = working ? '#ffd9a0' : COL.amber
  actx.fillRect(cc.x + 8, cc.y - 9, 3 + deskGlow, 3 + deskGlow)
  actx.fillStyle = COL.amber; actx.fillRect(cc.x + 9, cc.y - 2, 2, 5)
  // Kaffeetasse mit dampfendem Faden (2 Bilder)
  actx.fillStyle = PX.paper; actx.fillRect(cc.x + 1, cc.y + 3, 3, 3)
  actx.fillStyle = '#6b4a2f'; actx.fillRect(cc.x + 2, cc.y + 3, 1, 1)
  if (!reduce) {
    const sf = Math.floor(time * 2.5) % 2
    actx.fillStyle = PX.paper; actx.globalAlpha = 0.75
    actx.fillRect(cc.x + 2 + sf, cc.y, 1, 1); actx.fillRect(cc.x + 3 - sf, cc.y - 2, 1, 1)
    actx.globalAlpha = 1
  }

  // Leseecke am linken Ende des Wohnzimmers: Sofa an der Wand, Beistelltisch, Stehlampe
  lightPool(L + 9, cc.y - 26, 18, working ? 0.9 : 0.6)
  actx.fillStyle = PX.woodDk; actx.fillRect(L, cc.y - 18, 11, 36)
  actx.fillStyle = HUES[0]; actx.fillRect(L, cc.y - 16, 4, 32)
  actx.fillStyle = '#6f93ad'; actx.fillRect(L + 4, cc.y - 15, 6, 14); actx.fillRect(L + 4, cc.y + 1, 6, 14)
  actx.fillStyle = PX.woodDk; actx.fillRect(L + 1, cc.y - 18, 9, 3); actx.fillRect(L + 1, cc.y + 15, 9, 3)
  actx.fillStyle = COL.amber; actx.fillRect(L + 5, cc.y - 12, 3, 3)
  actx.fillStyle = '#e8a0a8'; actx.fillRect(L + 5, cc.y + 9, 3, 3)
  actx.fillStyle = PX.wood; actx.fillRect(L + 14, cc.y - 5, 7, 10)
  actx.fillStyle = PX.paper; actx.fillRect(L + 16, cc.y - 3, 2, 2)
  actx.fillStyle = HUES[4]; actx.fillRect(L + 15, cc.y + 1, 5, 2)
  actx.fillStyle = PX.woodDk; actx.fillRect(L + 6, cc.y - 26, 6, 2)
  actx.fillStyle = PX.ink; actx.fillRect(L + 8, cc.y - 33, 2, 7)
  actx.fillStyle = working ? PX.glow : '#e9cf9a'; actx.fillRect(L + 5, cc.y - 36, 8, 3)

  // Rechtes Ende: hohes Buecherregal an der Wand, Ohrensessel, grosse Zimmerpflanze
  actx.fillStyle = PX.woodDk; actx.fillRect(R - 11, cc.y - 22, 11, 44)
  actx.fillStyle = PX.wood; actx.fillRect(R - 10, cc.y - 21, 9, 42)
  for (let s = 0; s < 4; s++) {
    const sy = cc.y - 21 + s * 10
    actx.fillStyle = PX.woodDk; actx.fillRect(R - 10, sy + 9, 9, 1)
    for (let k = 0; k < 4; k++) { actx.fillStyle = HUES[(s * 3 + k) % HUES.length]; actx.fillRect(R - 10 + k * 2 + (k > 1 ? 1 : 0), sy + 2 + ((s + k) % 3), 2, 7 - ((s + k) % 3)) }
  }
  actx.fillStyle = PX.woodDk; actx.fillRect(R - 27, cc.y - 8, 11, 14)
  actx.fillStyle = HUES[1]; actx.fillRect(R - 26, cc.y - 7, 9, 12)
  actx.fillStyle = '#9a7c9d'; actx.fillRect(R - 24, cc.y - 5, 6, 8)
  actx.fillStyle = PX.plantPot; actx.fillRect(R - 20, cc.y + 26, 7, 7)
  actx.fillStyle = PX.plant
  actx.fillRect(R - 22, cc.y + 17, 4, 10); actx.fillRect(R - 18, cc.y + 15, 4, 12); actx.fillRect(R - 14, cc.y + 19, 3, 8)
  actx.fillStyle = '#4a7a48'; actx.fillRect(R - 17, cc.y + 18, 1, 6); actx.fillRect(R - 21, cc.y + 21, 1, 4)

  const claudePt = { x: geo.cx, y: geo.cy + 22 * geo.u }
  pendingLabels.push({ text: S.main.name, x: claudePt.x, y: claudePt.y, px: 13 * geo.u, color: COL.amber, weight: 700 })
  labelRects.push({ x: claudePt.x, w: 60 * geo.u, y: claudePt.y, h: 17 * geo.u })
  if (geo.w > 600) {
    const statusPt = { x: geo.cx, y: geo.cy + 36 * geo.u }
    pendingLabels.push({ text: S.main.state === 'active' ? 'arbeitet' : 'wartet', x: statusPt.x, y: statusPt.y, px: 10 * geo.u, color: COL.dim, weight: 500 })
    labelRects.push({ x: statusPt.x, w: 60 * geo.u, y: statusPt.y, h: 13 * geo.u })
  }

  run('under', actx, time, dt)

  // Agents: erst bewegen, dann nach Fuss-y sortiert zeichnen (weiter unten = weiter vorne)
  for (const a of S.agents.values()) {
    const tg = targetFor(a, time)
    const k = 1 - Math.exp(-dt * (a.state === 'done' ? 2.2 : 3.2))
    const px = a.x, py = a.y
    if (reduce) { a.x = tg.x; a.y = tg.y } else { a.x += (tg.x - a.x) * k; a.y += (tg.y - a.y) * k }
    a.vx = a.x - px; a.vy = a.y - py
    a.alpha = a.state === 'done' ? Math.max(0.25, 1 - (wall - a.doneAt) / 60000) : 1
  }
  for (const a of [...S.agents.values()].sort((p, q) => p.y - q.y)) {
    const col = a.state === 'error' ? COL.coral : a.state === 'done' ? COL.mint : a.color
    const ap = toArt(a.x, a.y)
    actx.globalAlpha = a.alpha
    let drawn = false
    if (AB.drawShip) { try { AB.drawShip(actx, a, col, time, ap.x, ap.y); drawn = true } catch (e) { reportFx(e) } }
    if (!drawn) { actx.fillStyle = col; actx.fillRect(ap.x - 3, ap.y - 10, 6, 10) }
    actx.globalAlpha = 1

    const label = a.name.toUpperCase()
    const labelPx = 12 * geo.u
    const lw = measureLabel(label, labelPx)
    const lineH = 15 * geo.u
    let ly = a.y + 23 * geo.u
    // Mehrere Agents koennen an derselben Station eng beieinander stehen: Namen, die sich mit
    // bereits gezeichneten Texten (Stationen, Claude, andere Agents) ueberlappen wuerden, ruecken
    // eine Zeile tiefer statt sich zu stapeln.
    for (let tries = 0; tries < 6; tries++) {
      const cyv = ly + lineH / 2
      const hit = labelRects.find((r) => Math.abs(r.x - a.x) < (r.w + lw) / 2 + 4 * geo.u && Math.abs(r.y - cyv) < (r.h + lineH) / 2)
      if (!hit) break
      ly += lineH
    }
    labelRects.push({ x: a.x, w: lw, y: ly + lineH / 2, h: lineH })
    pendingLabels.push({ text: label, x: a.x, y: ly + lineH / 2, px: labelPx, color: col, weight: 700, alpha: a.alpha })
  }
  AB.labelRects = labelRects

  // Ringe und Partikel, chunky in Kunst-Pixeln
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.r += (r.max - r.r) * Math.min(1, dt * 4); r.life -= dt * 1.6
    if (r.life <= 0) { rings.splice(i, 1); continue }
    const rp = toArt(r.x, r.y), rr = Math.max(1, Math.round((r.r * geo.dpr) / ART_SCALE))
    actx.globalAlpha = r.life * 0.8; actx.strokeStyle = r.color; actx.lineWidth = 1
    actx.beginPath(); actx.arc(rp.x, rp.y, rr, 0, Math.PI * 2); actx.stroke()
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt * 1.4
    if (p.life <= 0) { particles.splice(i, 1); continue }
    const pp = toArt(p.x, p.y)
    actx.globalAlpha = p.life; actx.fillStyle = p.color
    actx.fillRect(pp.x, pp.y, 1, 1)
  }
  actx.globalAlpha = 1
  // letzte Kunst-Pixel-Phase: Licht/Tageszeit-Ueberlagerungen, Ereignis-Pops usw.
  run('scene', actx, time, dt)
  actx.setTransform(1, 0, 0, 1, 0, 0); actx.globalAlpha = 1; actx.globalCompositeOperation = 'source-over'

  // ---- Hochskalieren: der kleine Puffer wird unscharf-frei auf die volle Canvas-Groesse gezogen ----
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(artBuf, 0, 0, artBuf.width, artBuf.height, 0, 0, canvas.width, canvas.height)

  // ---- Scharfe Ueberlagerung: Texte und Status-Abzeichen (fx/status.js), gut lesbar ----
  ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const l of pendingLabels) {
    ctx.globalAlpha = l.alpha == null ? 1 : l.alpha
    ctx.font = `${l.weight} ${Math.round(l.px)}px "Avenir Next","Helvetica Neue",system-ui,sans-serif`
    // Nachts (fx/daynight.js setzt AB.night 0..1) bekommen Beschriftungen einen hellen Rand,
    // sonst gehen dunkle Namen auf dem nachtblauen Garten unter
    if ((AB.night || 0) > 0.3) {
      ctx.lineJoin = 'round'; ctx.lineWidth = 3 * geo.u; ctx.strokeStyle = 'rgba(251,243,228,0.85)'
      ctx.strokeText(l.text, l.x, l.y)
    }
    ctx.fillStyle = l.color
    ctx.fillText(l.text, l.x, l.y)
  }
  ctx.globalAlpha = 1
  run('agents', ctx, time, dt)
  run('top', ctx, time, dt)
}

// ---------- Oberfläche (DOM) ----------
const crewEl = $('#crew'), logEl = $('#log'), selTo = $('#msg-to')
const fmtT = (t) => new Date(t).toLocaleTimeString('de-AT', { hour12: false })
const STATE_TXT = { active: 'aktiv', idle: 'bereit', done: 'fertig', error: 'Fehler' }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

function unitNode(name, role, color, state, what, count, cls) {
  const li = el('li', 'unit' + (cls ? ' ' + cls : ''))
  li.dataset.state = state
  li.style.setProperty('--c', color)
  li.append(el('span', 'dot'))
  const nm = el('span', 'nm', name); nm.append(el('small', null, role))
  li.append(nm, el('span', 'st', STATE_TXT[state] || state), el('span', 'what', what || '–'))
  li.lastChild.title = `${count} Werkzeug-Aufrufe`
  return li
}

function renderUI() {
  const wall = Date.now()
  sweep(wall)
  const list = [...S.agents.values()].sort((a, b) => (a.state === 'done') - (b.state === 'done') || b.last - a.last)
  if (AB.renderCrew) { try { AB.renderCrew(crewEl, list, S.main) } catch (e) { reportFx(e) } }
  else {
    crewEl.replaceChildren(unitNode(S.main.name, 'Kommandant', COL.amber, S.main.state, S.main.what, S.main.count, 'cmd'))
    for (const a of list) crewEl.append(unitNode(a.name, a.role, a.color, a.state, a.what, a.count))
    if (!list.length) crewEl.append(el('li', 'unit', 'Noch keine Subagents.'))
  }

  let act = 0, done = 0, err = 0
  for (const a of S.agents.values()) { if (a.state === 'active') act++; if (a.state === 'done') done++; if (a.state === 'error') err++ }
  $('#n-active').textContent = act; $('#n-done').textContent = done; $('#n-err').textContent = err; $('#n-tools').textContent = S.tools

  logEl.replaceChildren(...S.log.slice(-5).map((l) => {
    const d = el('div'); d.append(`${fmtT(l.t)}  `)
    const b = el('b', null, l.who); b.style.color = l.color; d.append(b, `  ${l.text}`)
    return d
  }))

  const cur = selTo.value
  const want = ['', ...[...S.agents.values()].filter((a) => a.state !== 'done').map((a) => a.name)]
  if (want.join('|') !== [...selTo.options].map((o) => o.value).join('|')) {
    selTo.replaceChildren(...want.map((n) => { const o = el('option', null, n || 'alle Agents'); o.value = n; return o }))
    selTo.value = want.includes(cur) ? cur : ''
  }
  run('ui')
  $('#empty').hidden = S.agents.size > 0 || S.log.length > 0 || mode !== 'live' && mode !== 'off'
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show')
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600)
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text) }
  catch {
    const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
  toast(`Kopiert: „${text.length > 60 ? text.slice(0, 57) + '…' : text}“. Im Chat einfügen.`)
}

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => { Snd.play('click'); copy(b.dataset.cmd) }))
$('#msg').addEventListener('submit', (e) => {
  e.preventDefault()
  const txt = $('#msg-text').value.trim(); if (!txt) return
  const to = selTo.value
  Snd.play('click')
  copy(to ? `Sag ${to}: ${txt}` : `Sag allen laufenden Agents: ${txt}`)
  $('#msg-text').value = ''
})

// ---------- Ton (WebAudio, synthetisch) ----------
const Snd = {
  ctx: null, on: false, lastTool: 0,
  setOn(v) {
    this.on = v
    if (v && !this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { this.on = false } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume()
    const b = $('#b-sound'); b.textContent = this.on ? 'Ton an' : 'Ton aus'; b.setAttribute('aria-pressed', String(this.on))
    tryLS(() => localStorage.setItem('ab-sound', this.on ? '1' : '0'))
    if (this.on) this.play('click')
  },
  tone(f, d, type, vol, to, delay) {
    const c = this.ctx, t0 = c.currentTime + (delay || 0)
    const o = c.createOscillator(), g = c.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + d + 0.02)
  },
  play(kind) {
    if (!this.on || !this.ctx) return
    if (AB.playSound) { try { if (AB.playSound(kind, this.ctx) !== false) return } catch (e) { console.error(e) } }
    switch (kind) {
      case 'tool': { const n = performance.now(); if (n - this.lastTool < 140) return; this.lastTool = n; this.tone(1180, 0.05, 'square', 0.018); break }
      case 'click': this.tone(520, 0.06, 'triangle', 0.05); break
      case 'spawn': this.tone(300, 0.22, 'sawtooth', 0.04, 900); this.tone(600, 0.2, 'triangle', 0.03, 1500, 0.08); break
      case 'done': this.tone(660, 0.16, 'sine', 0.06); this.tone(830, 0.16, 'sine', 0.06, 0, 0.1); this.tone(990, 0.3, 'sine', 0.06, 0, 0.2); break
      case 'error': this.tone(140, 0.28, 'sawtooth', 0.07, 70); this.tone(110, 0.28, 'square', 0.04, 60, 0.05); break
      case 'prompt': this.tone(440, 0.12, 'sine', 0.06); this.tone(660, 0.18, 'sine', 0.06, 0, 0.09); break
      case 'stop': this.tone(520, 0.2, 'triangle', 0.06, 390); break
      case 'alert': this.tone(880, 0.12, 'square', 0.04); this.tone(880, 0.12, 'square', 0.04, 0, 0.18); break
    }
  },
}
$('#b-sound').addEventListener('click', () => Snd.setOn(!Snd.on))
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'm' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) Snd.setOn(!Snd.on) })

// ---------- Datenquellen: live (SSE) oder Demo ----------
let mode = 'off', es = null, demoTimers = []

function setMode(m) {
  mode = m
  const c = $('#conn'); c.dataset.s = m
  c.textContent = m === 'live' ? 'Live' : m === 'demo' ? 'Demo' : 'Offline'
  for (const id of ['#b-demo']) { $(id).setAttribute('aria-pressed', String(m === 'demo')) }
}

function resetState() {
  S.agents.clear(); S.nameIdx = 0; S.hueIdx = 0; S.tools = 0; S.log = []
  S.main = newMain()
  S.events = []; S.status = null; S.pendingTasks = []; S.lastEventAt = 0
  for (const k in S.stCount) S.stCount[k] = 0
  run('event', { ev: '__reset', t: Date.now() }, true)
}

// Statusline-/Subagent-Daten (Kontext-Fuellstand, Kosten, Limits, Token je Subagent), siehe docs/FX-API.md
function setStatus(data) {
  S.status = { ...(S.status || {}), ...data }
  run('status', S.status)
}

function connect() {
  if (es) es.close()
  es = new EventSource('/events')
  es.addEventListener('open', () => { if (mode !== 'demo') setMode('live') })
  es.addEventListener('error', () => { if (mode !== 'demo') setMode('off') })
  es.addEventListener('replay', (m) => {
    if (mode === 'demo') return
    resetState()
    let evs = []
    try { evs = JSON.parse(m.data) } catch { /* kaputter Block: leer starten */ }
    // alte Sessions (von gestern) nicht wieder aufleben lassen
    const since = Date.now() - REPLAY_MAX_AGE
    for (const e of Array.isArray(evs) ? evs : []) if (e && (Number(e.t) || 0) >= since) handle(e, true)
    sweep(Date.now())
  })
  es.addEventListener('ev', (m) => { if (mode !== 'demo') { let e = null; try { e = JSON.parse(m.data) } catch { return } handle(e, false) } })
  es.addEventListener('status', (m) => { if (mode !== 'demo') { try { setStatus(JSON.parse(m.data)) } catch { /* kaputte Zeile ignorieren */ } } })
  // Herzschlag vom Server (alle 15 s), damit "Verbindung weg" von "einfach ruhig" unterscheidbar ist
  es.addEventListener('ping', () => { S.lastPingAt = Date.now() })
}

function stopDemo() { demoTimers.forEach(clearTimeout); demoTimers = [] }

function startDemo() {
  stopDemo(); resetState(); setMode('demo')
  const roles = ['Explore', 'general-purpose', 'general-purpose', 'Plan']
  const tools = {
    Explore: [['Read', 'brain.py'], ['Grep', 'def ask'], ['Glob', '*.py'], ['Read', 'main.py'], ['Read', 'router.py'], ['Grep', 'import requests']],
    'general-purpose': [['Edit', 'notify.py'], ['Write', 'test_notify.py'], ['Bash', 'python -m unittest'], ['Read', 'config.py'], ['Edit', 'brain.py'], ['Read', 'utils.py']],
    Plan: [['WebSearch', 'free weather api'], ['WebFetch', 'open-meteo.com'], ['Read', 'budget_plan.md'], ['WebFetch', 'docs.python.org'], ['Read', 'README.md']],
  }
  const tasks = ['Code nach ask() durchsuchen', 'Benachrichtigung bauen', 'Tests fuer notify schreiben', 'Wetter-API recherchieren']
  const params = new URLSearchParams(location.search)
  const at = (ms, fn) => demoTimers.push(setTimeout(fn, ms))
  const emit = (o) => handle({ t: Date.now(), ...o }, false)
  let tidN = 0
  // ein Werkzeugaufruf als Paar Pre/Post (mit tool_use_id und Dauer), optional fehlschlagend
  const call = (aid, role, tool, what, dur, fail) => {
    const tid = `toolu_demo${++tidN}`
    emit({ ev: 'PreToolUse', aid, at: role, tool, what, tid })
    at(dur, () => emit({ ev: fail ? 'PostToolUseFailure' : 'PostToolUse', aid, at: role, tool, what, tid, dur, ok: !fail }))
  }
  // Statusline-Simulation: Kontext steigt, bei ~85 % wird kompaktiert; Kosten und Limits wachsen
  let ctx = 12, cost = 0, rl = 20
  const tick = () => {
    if (mode !== 'demo') return
    ctx += 1.6 + Math.random() * 1.4; cost += 0.004 + Math.random() * 0.006; rl = Math.min(97, rl + 0.15)
    if (ctx > 85) {
      emit({ ev: 'PreCompact', trig: 'auto' })
      at(2500, () => { ctx = 28; emit({ ev: 'PostCompact', trig: 'auto' }); pushStatus() })
      ctx = 85
    }
    pushStatus()
    at(2000, tick)
  }
  const pushStatus = () => {
    const subs = [...S.agents.values()].filter((a) => a.state !== 'done').map((a) => {
      a._demoTok = (a._demoTok || 2000) + Math.round(Math.random() * 1800)
      a._demoSamples = [...(a._demoSamples || []), a._demoTok].slice(-30)
      return { id: a.id, label: a.task || a.role, status: 'running', tokens: a._demoTok, tokenSamples: a._demoSamples, model: 'claude-sonnet-5' }
    })
    setStatus({ t: Date.now(), ctxPct: Math.round(ctx), costUsd: +cost.toFixed(3), model: 'claude-opus-5-5',
      rl5h: { usedPct: Math.round(rl), resetsAt: Date.now() + 2 * 3600e3 }, rl7d: { usedPct: Math.round(rl / 3), resetsAt: Date.now() + 4 * 86400e3 }, subagents: subs })
  }
  const wave = (base) => {
    at(base, () => { emit({ ev: 'UserPromptSubmit' }); emit({ ev: 'TaskCreated', task: 'Benachrichtigungen einbauen' }) })
    roles.forEach((role, i) => {
      const aid = `demo-${base}-${i}`
      at(base + 600 + i * 700, () => call(null, null, 'Agent', tasks[i], 300, false))
      at(base + 900 + i * 700, () => emit({ ev: 'SubagentStart', aid, at: role }))
      const life = 16000 + Math.random() * 14000
      let t = base + 1800 + i * 700
      // Agent 1 (Explore) liest einmal dieselbe Datei mehrfach hintereinander -> "Schleife?"
      if (i === 0) for (let k = 0; k < 4; k++) at(base + 6000 + k * 1100, () => call(aid, role, 'Read', 'config.js', 300, false))
      // Werkzeuge reihum aus einer gemischten Liste, damit sich zufaellig nichts wie eine Schleife haeuft
      const deck = [...tools[role]].sort(() => Math.random() - 0.5)
      let n = 0
      while (t < base + 900 + life) {
        if (i === 0 && t > base + 5500 && t < base + 10500) { t += 900; continue }
        const pick = deck[n++ % deck.length]
        const fail = Math.random() < 0.02
        const dur = pick[0] === 'Bash' ? 1500 + Math.random() * 2500 : 200 + Math.random() * 700
        at(t, () => call(aid, role, pick[0], pick[1], Math.round(dur), fail))
        t += 900 + Math.random() * 1700
      }
      at(base + 900 + life, () => emit({ ev: 'SubagentStop', aid, at: role }))
    })
    // Agent 2 braucht einmal eine Erlaubnis fuer einen Bash-Befehl: ~7 s "Wartet auf dich"
    const permAid = `demo-${base}-1`, permTid = `toolu_demoperm${base}`
    at(base + 8000, () => {
      emit({ ev: 'PreToolUse', aid: permAid, at: 'general-purpose', tool: 'Bash', what: 'rm -rf build/', tid: permTid })
      emit({ ev: 'PermissionRequest', aid: permAid, at: 'general-purpose', tool: 'Bash', what: 'rm -rf build/' })
      emit({ ev: 'Notification', nt: 'permission_prompt', msg: 'Claude needs your permission to use Bash' })
    })
    at(base + 15000, () => emit({ ev: 'PostToolUse', aid: permAid, at: 'general-purpose', tool: 'Bash', what: 'rm -rf build/', tid: permTid, dur: 7000 }))
    if (params.get('ratelimit') === '1') at(base + 25000, () => emit({ ev: 'StopFailure', err: 'rate_limit', msg: 'Rate limit reached' }))
    at(base + 30000, () => emit({ ev: 'TaskCompleted', task: 'Benachrichtigungen einbauen' }))
    at(base + 33000, () => { emit({ ev: 'Stop', msg: 'Benachrichtigungen sind eingebaut, 4 Tests gruen.' }) })
    at(base + 37000, () => { emit({ ev: 'Notification', nt: 'idle_prompt', msg: 'Claude is waiting for your input' }) })
    at(base + 42000, () => wave(0))
  }
  wave(300)
  at(1000, tick)
}

function stopDemoAndReconnect() { stopDemo(); resetState(); setMode('off'); connect() }
const toggleDemo = () => (mode === 'demo' ? stopDemoAndReconnect() : startDemo())
$('#b-demo').addEventListener('click', toggleDemo)
$('#b-demo2').addEventListener('click', startDemo)

// ---------- Öffentliche Schnittstelle für Erweiterungen ----------
// Treffer-Test fuer Klicks: naechster Agent (Fusspunkt, etwas nach oben versetzt) oder Claudes Tisch
function hitTest(x, y) {
  let best = null, bd = 22 * geo.u
  for (const a of S.agents.values()) {
    const d = Math.hypot(a.x - x, a.y - 12 * (ART_SCALE / geo.dpr) - y)
    if (d < bd) { bd = d; best = a }
  }
  const onDesk = Math.abs(x - geo.cx) < 40 * geo.u && Math.abs(y - geo.cy) < 30 * geo.u
  // Claudes Tisch gewinnt, ausser der Klick sitzt wirklich direkt auf einer Figur davor
  if (best && !(onDesk && bd > 10 * geo.u)) return { agent: best, main: false, x, y }
  if (onDesk) return { agent: null, main: true, x, y }
  return { agent: null, main: false, x, y }
}
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect()
  run('click', hitTest(e.clientX - r.left, e.clientY - r.top))
})

Object.assign(AB, { run,
  S, geo, COL, PX, STATIONS, HUES, stationPos, stationById, stationFor, roomPoint, toArt, artToCss, ring, burst, Snd, reduce, particles, rings,
  lightPool, apartmentBoundsCss, roomWcss, roomHcss, livingHalfHcss, hitTest, setStatus, logLine,
  on(phase, fn) { if (!HOOKS[phase]) throw new Error('Unbekannte Phase: ' + phase); HOOKS[phase].push(fn) },
  mode: () => mode,
})

// ---------- Start ----------
addEventListener('resize', resize)
resize()
setInterval(renderUI, 500)
requestAnimationFrame(frame)
Snd.setOn(false)
const saved = tryLS(() => localStorage.getItem('ab-sound'))
if (saved === '1') { const b = $('#b-sound'); b.textContent = 'Ton aus'; b.title = 'Ton ist gespeichert an; ein Klick aktiviert ihn (Browser-Regel).' }
// Testschalter: ?fx=glow,banners laedt public/fx/<name>.js (und .css, falls vorhanden) nach
for (const name of (new URLSearchParams(location.search).get('fx') || '').split(',')) {
  if (!/^[a-z0-9-]+$/.test(name)) continue
  const sc = document.createElement('script'); sc.src = `fx/${name}.js`; document.body.append(sc)
  const ln = document.createElement('link'); ln.rel = 'stylesheet'; ln.href = `fx/${name}.css`; document.head.append(ln)
}
// Datenquelle erst nach DOMContentLoaded starten: dann sind alle fx-Skripte (laden nach app.js) registriert,
// sonst kann das Replay vor status.js/crew.js eintreffen und deren Hooks verpassen.
const begin = () => { if (new URLSearchParams(location.search).get('demo') === '1') startDemo(); else connect() }
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', begin); else begin()
renderUI()
})()
