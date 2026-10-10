// fx/health.js: Gesundheits-Hinweise fuer die Szene.
// - "Hängt?"-Abzeichen, wenn ein Werkzeug ungewoehnlich lange offen ist (Bash 120 s, Web 60 s,
//   Rest 45 s; Agent/Task-Aufrufe ausgenommen). Test: ?hang=8 setzt alle Schwellen auf 8 s.
// - "Schleife?"-Abzeichen, wenn ein Akteur dasselbe Werkzeug mit demselben Ziel in seinen letzten
//   8 Aufrufen 3x direkt hintereinander oder insgesamt >= 4x nutzt (und das noch andauert).
// - Hover/Klick auf ein Abzeichen: kleines Popover mit Grund und "Hinweis kopieren".
// - Rate-Limit: Holz-Aufsteller "Pause" neben Claudes Tisch (StopFailure rate_limit oder 5-h-Limit
//   bei 100 %), ab 80 % eine leise Vorwarnung.
// - Ereignis-Pops in Kunst-Pixeln: Stern bei SubagentStop, Gewitterwoelkchen bei Fehlern,
//   drei Sterne ueber Claudes Tisch bei Stop.
//
// Klick-Abstimmung mit anderen Modulen (Phase 'click'): ein Klick, der in einem Abzeichen-Rechteck
// landet, setzt fuer genau diesen Klick AB.__healthHit = true (Capture-Listener am Eltern-Element,
// laeuft also VOR dem Klick-Listener des Kerns). Andere Module sollen dann z.B. keine Karte oeffnen.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return

const params = new URLSearchParams(location.search)
const HANG_OVERRIDE = Math.max(0, Number(params.get('hang')) || 0) // Sekunden, 0 = aus
const LOOP_WIN = 8, LOOP_MIN = 3, LOOP_FRESH_MS = 180000
// Bearbeiten derselben Datei an mehreren Stellen ist normal, keine Schleife
const LOOP_SKIP = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite'])
const POPS_MAX = 12

const FONT = '"Avenir Next","Helvetica Neue",system-ui,sans-serif'
const CREAM = 'rgba(251,243,228,0.96)'

// ---------- Zustand ----------
let permAt = new Map() // Akteur-id -> Zeit der letzten Erlaubnis-Anfrage (wartet dann auf dich, haengt nicht)
let stopAt = 0 // letzter Stop/StopFailure/UserPromptSubmit von Claude: aeltere offene Werkzeuge gelten als erledigt
let rl = null // { since, resetsAt } nach StopFailure rate_limit
let rlDismissedAt = 0
let pops = []
let demoHang = null // nur ?demo=1&hang=N: simuliertes langes Bash bei Claude (die Demo erzeugt sonst keins)
let demoHangTimer = 0
let rects = [] // gezeichnete Abzeichen in CSS-Pixeln: { x, y, w, h, key, info }

function resetAll() {
  permAt = new Map(); stopAt = 0; rl = null; rlDismissedAt = 0; pops = []; demoHang = null; rects = []
  clearTimeout(demoHangTimer)
  hidePop()
}

// ---------- Hilfen ----------
function thresholdMs(tool) {
  if (HANG_OVERRIDE) return HANG_OVERRIDE * 1000
  if (tool === 'Bash') return 120000
  if (tool === 'WebFetch' || tool === 'WebSearch') return 60000
  return 45000
}

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`
}

const VERB = { Read: 'liest', Grep: 'durchsucht', Glob: 'sucht', Bash: 'führt', WebFetch: 'lädt', WebSearch: 'sucht nach' }
function doing(tool, what) {
  if (tool === 'Bash') return `führt „${what}“ wiederholt aus`
  if (VERB[tool]) return `${VERB[tool]} ${what} wiederholt`
  return `nutzt ${tool} (${what}) wiederholt`
}

function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

function actors() {
  const list = [{ id: 'main', name: 'Claude', o: AB.S.main, main: true }]
  for (const a of AB.S.agents.values()) if (a.state !== 'done') list.push({ id: a.id, name: a.name, o: a, main: false })
  return list
}

function openOf(act) {
  let ot = act.o.openTool
  if (!ot && act.main && demoHang) ot = demoHang
  if (!ot) return null
  if (ot.tool === 'Agent' || ot.tool === 'Task') return null // laufen legitim lange
  if (ot !== demoHang && Date.now() - ot.t > 30 * 60000) return null // Post nie angekommen (z.B. Abbruch): nicht ewig "Hängt?"
  if (act.main && stopAt && ot.t <= stopAt && ot !== demoHang) return null // Stop kam danach: Werkzeug ist vorbei
  const p = permAt.get(act.id)
  if (p && p >= ot.t) return null // wartet auf eine Erlaubnis, das zeigt das Aufmerksamkeits-Modul
  return ot
}

function hangInfo(act, now) {
  const ot = openOf(act)
  if (!ot) return null
  const age = now - (ot.t || now)
  if (age < thresholdMs(ot.tool)) return null
  const what = short(ot.what, 40)
  const reason = `${ot.tool || 'Werkzeug'} läuft seit ${fmtDur(age)}${what ? ': ' + what : ''}`
  const hint = `${act.name} scheint zu hängen (${ot.tool || 'Werkzeug'}${what ? ' „' + what + '“' : ''} läuft seit ${fmtDur(age)}). Bitte prüfen und ggf. abbrechen oder anders vorgehen.`
  return { kind: 'hang', label: 'Hängt?', reason, hint }
}

function loopInfo(act, now) {
  const r = act.o.recent
  if (!r || r.length < LOOP_MIN) return null
  const win = r.slice(-LOOP_WIN)
  const key = (e) => e.tool + '\u0000' + e.what
  const cnt = new Map()
  let best = null
  for (const e of win) {
    if (!e.what || LOOP_SKIP.has(e.tool) || e.tool === 'Agent' || e.tool === 'Task') continue
    const k = key(e)
    const c = cnt.get(k) || { k, n: 0, last: 0, tool: e.tool, what: e.what }
    c.n++; c.last = Math.max(c.last, e.t || 0); cnt.set(k, c)
    if (c.n >= LOOP_MIN && (!best || c.n > best.n)) best = c
  }
  if (!best || now - best.last > LOOP_FRESH_MS) return null
  // nur solange die Wiederholung noch andauert: einer der letzten zwei Aufrufe gehoert dazu
  if (!win.slice(-2).some((e) => key(e) === best.k)) return null
  // laengste Serie direkt hintereinander
  let run = 0, maxRun = 0
  for (const e of win) { run = key(e) === best.k ? run + 1 : 0; maxRun = Math.max(maxRun, run) }
  // Gegen Fehlalarme: 3x direkt hintereinander, oder mindestens 4x im Fenster (3 verstreute
  // Lesezugriffe auf dieselbe Datei unter 8 Aufrufen sind meist normales Arbeiten)
  if (maxRun < LOOP_MIN && best.n < LOOP_MIN + 1) return null
  const what = short(best.what, 40)
  return {
    kind: 'loop', label: 'Schleife?',
    reason: maxRun >= LOOP_MIN ? `${best.tool} ${what} ${maxRun}× hintereinander` : `${best.tool} ${what} ${best.n}× in den letzten ${win.length} Aufrufen`,
    hint: `${act.name} scheint in einer Schleife zu sein (${doing(best.tool, what)}). Bitte prüfen und anders vorgehen.`,
  }
}

// ---------- Ereignisse ----------
function addPop(p) {
  pops.push(p)
  if (pops.length > POPS_MAX) pops.splice(0, pops.length - POPS_MAX)
}

AB.on('event', (ev, silent) => {
  if (!ev) return
  const t = ev.t || Date.now()
  switch (ev.ev) {
    case '__reset': resetAll(); return
    case 'PermissionRequest': permAt.set(ev.aid || 'main', t); break
    case 'UserPromptSubmit':
      stopAt = t; rl = null; rlDismissedAt = t; demoHang = null
      if (HANG_OVERRIDE && AB.mode() === 'demo') {
        // Demo: nach den Agent-Aufrufen startet Claude ein "npm test", das bis zum Stop offen bleibt
        clearTimeout(demoHangTimer)
        demoHangTimer = setTimeout(() => { if (AB.mode() === 'demo') demoHang = { t: Date.now(), tool: 'Bash', what: 'npm test', tid: 'demo-hang' } }, 3500)
      }
      break
    case 'Stop': stopAt = t; demoHang = null; break
    case 'StopFailure':
      stopAt = t; demoHang = null
      if (ev.err === 'rate_limit') rl = { since: t }
      break
  }
  if (silent) return
  const now = performance.now() / 1000
  if (ev.ev === 'SubagentStop') {
    const a = AB.S.agents.get(ev.aid)
    if (a) addPop({ kind: 'star', who: a, t0: now, life: 1 })
  } else if (ev.ev === 'PostToolUseFailure') {
    const who = ev.aid ? AB.S.agents.get(ev.aid) : null
    addPop({ kind: 'cloud', who: who || 'main', t0: now, life: 1.2 })
  } else if (ev.ev === 'Stop') {
    for (let i = 0; i < 3; i++) addPop({ kind: 'star', who: 'main', dx: (i - 1) * 9, t0: now + i * 0.15, life: 1 })
  }
})

// Rate-Limit-Zustand aus StopFailure und/oder Statusdaten
function rateState(now) {
  const st = AB.S.status
  const r5 = st && st.rl5h
  const used = r5 && typeof r5.usedPct === 'number' ? r5.usedPct : null
  const resetsAt = r5 && r5.resetsAt > 0 ? r5.resetsAt : 0
  if (resetsAt && now > resetsAt && rl) rl = null
  const statusFull = used != null && used >= 100 && (!resetsAt || now < resetsAt) && (!st.t || st.t >= rlDismissedAt)
  if (rl || statusFull) return { level: 'stop', resetsAt: resetsAt && resetsAt > now ? resetsAt : 0 }
  if (used != null && used >= 80) return { level: 'warn', used }
  return null
}

// ---------- Kunst-Pixel: Pause-Schild (Phase 'stations', liegt hinter den Figuren) ----------
// Position relativ zu Claudes Tisch: AB.toArt(geo.cx, geo.cy) ist die Tischmitte in Kunst-Pixeln,
// der Teppich reicht +-32 Kunst-Pixel, also steht das Schild knapp rechts daneben.
function signOrigin() {
  const cc = AB.toArt(AB.geo.cx, AB.geo.cy)
  return { x: cc.x + 37, y: cc.y - 6 } // linke obere Ecke der Tafel
}

AB.on('stations', (actx) => {
  const rs = rateState(Date.now())
  if (!rs) return
  const P = AB.PX
  const o = signOrigin()
  const small = rs.level === 'warn'
  const w = small ? 10 : 14, h = small ? 7 : 10
  const x = o.x + (small ? 2 : 0), y = o.y + (small ? 3 : 0)
  // Schatten am Boden
  actx.fillStyle = P.shadow; actx.fillRect(x - 1, y + h + 5, w + 3, 2)
  // Beine als Pixel-Treppe (A-Aufsteller)
  actx.fillStyle = P.woodDk
  for (let i = 0; i < 6; i++) {
    const k = Math.floor(i / 2)
    actx.fillRect(x + 1 - k, y + h + i - 1, 1, 1)
    actx.fillRect(x + w - 2 + k, y + h + i - 1, 1, 1)
  }
  // Tafel: Rahmen, Holzflaeche, helles Schild
  actx.fillRect(x, y, w, h)
  actx.fillStyle = P.wood; actx.fillRect(x + 1, y + 1, w - 2, h - 2)
  actx.fillStyle = P.paper; actx.fillRect(x + 2, y + 2, w - 4, h - 4)
  if (small) {
    // Vorwarnung: drei ruhige Punkte statt Pause-Zeichen
    actx.fillStyle = P.paperLine
    actx.fillRect(x + 3, y + 3, 1, 1); actx.fillRect(x + 5, y + 3, 1, 1); actx.fillRect(x + 7, y + 3, 1, 1)
  } else {
    // Pause-Zeichen
    actx.fillStyle = AB.COL.amber
    actx.fillRect(x + 4, y + 3, 2, 4); actx.fillRect(x + 8, y + 3, 2, 4)
  }
  // kleine Aufhaengung oben
  actx.fillStyle = P.woodDk; actx.fillRect(x + Math.floor(w / 2) - 1, y - 1, 2, 1)
})

// ---------- Kunst-Pixel: Ereignis-Pops (Phase 'scene') ----------
// Figur-Fusspunkt: AB.toArt(a.x, a.y) = (round(x * dpr / ART_SCALE), round(y * dpr / ART_SCALE)),
// genau wie der Kern die Figuren zeichnet. Der Kopf (fx/people.js) endet 24 Kunst-Pixel darueber.
function popBase(who) {
  if (who === 'main') { const c = AB.toArt(AB.geo.cx, AB.geo.cy); return { x: c.x, y: c.y - 14 } }
  if (!who || who.x == null) return null
  const f = AB.toArt(who.x, who.y)
  return { x: f.x, y: f.y - 28 }
}

function star(actx, x, y, big) {
  const P = AB.PX
  actx.fillStyle = '#c98a2e'
  actx.fillRect(x - 2, y, 5, 1); actx.fillRect(x, y - 2, 1, 5)
  actx.fillStyle = P.glow
  actx.fillRect(x - 1, y, 3, 1); actx.fillRect(x, y - 1, 1, 3)
  if (big) { actx.fillStyle = P.paper; actx.fillRect(x, y, 1, 1) }
}

function cloud(actx, x, y, bolt) {
  actx.fillStyle = '#8f8a84'
  actx.fillRect(x - 4, y - 1, 9, 3); actx.fillRect(x - 2, y - 3, 4, 2); actx.fillRect(x + 1, y - 2, 3, 1)
  actx.fillStyle = '#b3aea6'; actx.fillRect(x - 2, y - 3, 3, 1); actx.fillRect(x - 3, y - 1, 2, 1)
  actx.fillStyle = '#6f6a64'; actx.fillRect(x - 4, y + 2, 9, 1)
  if (bolt) {
    actx.fillStyle = AB.PX.glow
    actx.fillRect(x, y + 3, 1, 1); actx.fillRect(x - 1, y + 4, 1, 1); actx.fillRect(x, y + 5, 1, 1)
  }
}

AB.on('scene', (actx, time) => {
  if (!pops.length) return
  const now = performance.now() / 1000
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]
    const k = (now - p.t0) / p.life
    if (k >= 1) { pops.splice(i, 1); continue }
    if (k < 0) continue
    const b = popBase(p.who)
    if (!b) { pops.splice(i, 1); continue }
    const rise = AB.reduce ? 0 : Math.round(k * (p.kind === 'star' ? 7 : 3))
    const x = Math.round(b.x + (p.dx || 0)), y = Math.round(b.y - rise)
    // Ein- und Ausblenden in groben Stufen (wirkt pixeliger als weiches Faden)
    const a = k < 0.12 ? 0.5 : k > 0.75 ? (k > 0.88 ? 0.35 : 0.7) : 1
    actx.globalAlpha = a
    if (p.kind === 'star') star(actx, x, y, k < 0.5)
    else cloud(actx, x, y, AB.reduce ? k > 0.3 && k < 0.6 : (k > 0.25 && k < 0.4) || (k > 0.55 && k < 0.65))
  }
  actx.globalAlpha = 1
})

// ---------- Scharfe Ueberlagerung: Abzeichen + Pause-Label (Phase 'top') ----------
// align: 'center' = ax ist die Mitte, 'right' = ax ist die rechte Kante, 'left' = linke Kante.
// avoid: bereits gezeichnete Abzeichen; bei Ueberlappung (zwei Figuren nah beieinander) rueckt
// das neue um eine Zeile in Richtung dir (-1 hoch, +1 runter) weiter.
function pill(ctx, text, ax, by, u, col, align, avoid, dir) {
  ctx.font = `600 ${Math.round(11 * u)}px ${FONT}`
  const w = Math.ceil(ctx.measureText(text).width + 12 * u), h = Math.round(17 * u)
  const x0 = align === 'right' ? ax - w : align === 'left' ? ax : ax - w / 2
  const x = Math.round(Math.max(2, Math.min(AB.geo.w - w - 2, x0)))
  let y = Math.round(by - h)
  if (avoid) {
    for (let i = 0; i < 6; i++) {
      const hit = avoid.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)
      if (!hit) break
      const ny = y + (dir || -1) * (h + 3 * u)
      y = Math.round(ny < 2 ? y + (h + 3 * u) * (i + 1) : ny)
    }
  }
  ctx.fillStyle = CREAM; ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5)
  return { x, y, w, h }
}

let openKey = null
AB.on('top', (ctx) => {
  const now = Date.now()
  const u = AB.geo.u, C = AB.COL
  const next = []
  ctx.save()
  for (const act of actors()) {
    const infos = []
    const h = hangInfo(act, now); if (h) infos.push(h)
    const l = loopInfo(act, now); if (l) infos.push(l)
    if (!infos.length) continue
    let ax, by, align = 'center', step = -1
    if (act.main) { ax = AB.geo.cx; by = AB.geo.cy - AB.artToCss(19) - 4 * u }
    else {
      ax = act.o.x; by = act.o.y - AB.artToCss(25) - 4 * u
      ctx.globalAlpha = act.o.alpha == null ? 1 : act.o.alpha
      // Kein Platz ueber dem Kopf (Figur steht ganz oben): neben die Figur, links vom Kopf,
      // und nach unten stapeln. Ist links auch kein Platz, rechts neben das Status-Abzeichen.
      const overLabel = () => {
        const pw = infos[0].label.length * 6.5 * u + 12 * u, ph = 16 * u, pcy = by - ph / 2
        return (AB.labelRects || []).some((r) => Math.abs(r.x - ax) < (r.w + pw) / 2 && Math.abs(r.y - pcy) < (r.h + ph) / 2)
      }
      if (by - infos.length * 20 * u < 2 || overLabel()) {
        by = act.o.y - AB.artToCss(14); step = 1
        if (act.o.x - AB.artToCss(7) - 80 * u > 2) { ax = act.o.x - AB.artToCss(7) - 3 * u; align = 'right' }
        else { ax = act.o.x + 30 * u; align = 'left' }
        // liegt auch dort noch ein Schild (enge Handy-Ansicht), Zeile fuer Zeile nach unten ruecken
        const pw = infos[0].label.length * 6.5 * u + 12 * u, ph = 16 * u
        const cx = () => align === 'right' ? ax - pw / 2 : align === 'left' ? ax + pw / 2 : ax
        for (let i = 0; i < 4 && (AB.labelRects || []).some((r) => Math.abs(r.x - cx()) < (r.w + pw) / 2 && Math.abs(r.y - (by + ph / 2)) < (r.h + ph) / 2); i++) by += 8 * u
      }
    }
    for (const info of infos) {
      info.who = act.name
      const r = pill(ctx, info.label, ax, by, u, info.kind === 'hang' ? C.amber : C.dim, align, next, step)
      const key = info.kind + ':' + act.id
      next.push({ ...r, key, info })
      by = step < 0 ? r.y - 3 * u : r.y + r.h * 2 + 3 * u
    }
    ctx.globalAlpha = 1
  }
  // Pause-Label ueber dem Holz-Aufsteller
  const rs = rateState(now)
  if (rs) {
    const o = signOrigin()
    // linksbuendig ueber dem Schild, damit das Label nicht ueber Claudes Tisch ragt
    const lx = AB.artToCss(o.x - 1), by = AB.artToCss(o.y - 2) - 2 * u
    if (rs.level === 'stop') {
      const txt = rs.resetsAt ? `Pause bis ${new Date(rs.resetsAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}` : 'Pause – Limit erreicht'
      pill(ctx, txt, lx, by, u, C.amber, 'left')
    } else {
      ctx.globalAlpha = 0.85
      pill(ctx, 'Limit bald erreicht', lx, by, Math.max(1, u * 0.9), C.dim, 'left')
    }
  }
  ctx.restore()
  rects = next
  if (openKey) {
    const r = rects.find((x) => x.key === openKey)
    if (!r) hidePop()
    else placePop(r)
  }
})

// ---------- Popover (DOM) ----------
const canvas = document.getElementById('map')
const host = canvas && canvas.parentElement
let pop = null, popReason = null, popTitle = null, popBtn = null, hideT = 0, pinned = false, overPop = false

function buildPop() {
  if (pop || !host) return
  pop = document.createElement('div')
  pop.className = 'ab-health-pop'
  pop.setAttribute('role', 'dialog')
  pop.setAttribute('aria-label', 'Hinweis zum Agent')
  pop.hidden = true
  popTitle = document.createElement('strong'); popTitle.className = 'ab-health-title'
  popReason = document.createElement('p'); popReason.className = 'ab-health-reason'
  popBtn = document.createElement('button'); popBtn.type = 'button'; popBtn.className = 'ab-health-copy'; popBtn.textContent = 'Hinweis kopieren'
  pop.append(popTitle, popReason, popBtn)
  host.append(pop)
  pop.addEventListener('mouseenter', () => { overPop = true; clearTimeout(hideT) })
  pop.addEventListener('mouseleave', () => { overPop = false; if (!pinned) schedHide() })
  pop.addEventListener('focusout', (e) => { if (!pop.contains(e.relatedTarget) && !pinned) schedHide() })
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hidePop(); canvas.focus && canvas.focus() } })
  popBtn.addEventListener('click', () => {
    const r = rects.find((x) => x.key === openKey)
    if (r) copyText(r.info.hint)
  })
}

async function copyText(text) {
  let ok = true
  try { await navigator.clipboard.writeText(text) } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove()
    } catch { ok = false }
  }
  const t = document.getElementById('toast')
  if (t) {
    t.textContent = ok ? 'Hinweis kopiert. Im Chat einfügen.' : 'Kopieren ging nicht.'
    t.classList.add('show')
    clearTimeout(copyText.h); copyText.h = setTimeout(() => t.classList.remove('show'), 2600)
  }
  if (popBtn) { popBtn.textContent = ok ? 'Kopiert' : 'Hinweis kopieren'; clearTimeout(copyText.b); copyText.b = setTimeout(() => { if (popBtn) popBtn.textContent = 'Hinweis kopieren' }, 1600) }
}

function fillPop(r) {
  popTitle.textContent = `${r.info.who}: ${r.info.label}`
  popReason.textContent = r.info.reason
}

function placePop(r) {
  if (!pop || pop.hidden) return
  const cr = canvas.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const ox = cr.left - hr.left, oy = cr.top - hr.top
  const pw = pop.offsetWidth, ph = pop.offsetHeight
  let x = ox + r.x + r.w / 2 - pw / 2
  x = Math.max(8, Math.min(hr.width - pw - 8, x))
  let y = oy + r.y - ph - 6
  if (y < 8) y = oy + r.y + r.h + 6
  pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
}

function showPop(r, pin) {
  buildPop()
  if (!pop) return
  clearTimeout(hideT)
  openKey = r.key; pinned = !!pin
  pop.hidden = false
  fillPop(r)
  placePop(r)
}

function hidePop() {
  clearTimeout(hideT)
  openKey = null; pinned = false; overPop = false
  if (pop) pop.hidden = true
}
function schedHide() { clearTimeout(hideT); hideT = setTimeout(() => { if (!overPop && !pinned) hidePop() }, 280) }

function hitAt(e) {
  const cr = canvas.getBoundingClientRect()
  const x = e.clientX - cr.left, y = e.clientY - cr.top, pad = 3
  return rects.find((r) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) || null
}

let cursorSet = false
if (canvas && host) {
  canvas.addEventListener('mousemove', (e) => {
    const r = hitAt(e)
    if (r) {
      if (!cursorSet) { canvas.style.cursor = 'help'; cursorSet = true }
      if (openKey !== r.key) showPop(r, false)
      else clearTimeout(hideT)
    } else {
      if (cursorSet) { canvas.style.cursor = ''; cursorSet = false }
      if (openKey && !pinned) schedHide()
    }
  })
  canvas.addEventListener('mouseleave', () => {
    if (cursorSet) { canvas.style.cursor = ''; cursorSet = false }
    if (openKey && !pinned) schedHide()
  })
  // Capture am Eltern-Element: laeuft vor dem Klick-Listener des Kerns (der die Phase 'click' ausloest)
  host.addEventListener('click', (e) => {
    if (e.target !== canvas) return
    const r = hitAt(e)
    if (r) {
      AB.__healthHit = true
      setTimeout(() => { AB.__healthHit = false })
      if (openKey === r.key && pinned) hidePop()
      else { showPop(r, true); if (popBtn && e.detail === 0) popBtn.focus() }
    } else {
      AB.__healthHit = false
      if (openKey) hidePop()
    }
  }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openKey) hidePop() })
}

// Fuer Tests/andere Module: aktuell gezeichnete Abzeichen (CSS-Pixel relativ zum Canvas)
AB.healthRects = () => rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, kind: r.info.kind, who: r.info.who }))

// Popover-Text (laufende Dauer) auch ohne Mausbewegung aktuell halten
AB.on('ui', () => {
  if (!openKey) return
  const r = rects.find((x) => x.key === openKey)
  if (r) fillPop(r)
})
})()
