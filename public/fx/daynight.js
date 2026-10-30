// fx/daynight.js: Tag/Nacht nach echter Uhrzeit, leiser Stundengong und der Kontext-Papierkorb
// neben Claudes Tisch. Alles in Kunst-Pixeln (actx, ganzzahlige fillRect), nur das Hover-Label
// laeuft ueber den scharfen ctx. Testschalter: ?hour=22 (bzw. 7, 18, auch 19.5) erzwingt die Stunde.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const T = AB.t || ((k) => k)

const params = new URLSearchParams(location.search)
const hourOverride = (() => {
  const h = parseFloat(params.get('hour'))
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null
})()

// ---------- Tageszeit ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v))
// lineare Rampe: 0 bei a, 1 bei b
const ramp = (h, a, b) => clamp01((h - a) / (b - a))

function hourNow() {
  if (hourOverride != null) return hourOverride
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

// Anteile je Stimmung (0..1), weich ueber jeweils eine Stunde um die Grenzen herum ueberblendet:
// Nacht 20-6, Morgen 6-9 (rosa), Tag (nichts), Abend 17-20 (gold).
function mood(h) {
  const night = h < 12 ? 1 - ramp(h, 5.5, 6.5) : ramp(h, 19.5, 20.5)
  const pink = ramp(h, 5.5, 6.5) * (1 - ramp(h, 8.5, 9.5))
  const gold = ramp(h, 16.5, 17.5) * (1 - ramp(h, 19.5, 20.5))
  return { night, pink, gold, light: Math.max(night, gold * 0.45) }
}

// ---------- Geometrie (aus dem Kern abgeleitet, alles in Kunst-Pixeln) ----------
const artPx = (css) => Math.round(css / AB.artToCss(1))
// Lokaler Moebel-Punkt (wie FURN in app.js: Rueckwand = lokal oben) -> Kunst-Pixel-Weltpunkt
function furnPt(st, lx, ly) {
  const p = AB.stationPos(st), o = AB.toArt(p.x, p.y)
  const back = Math.round(artPx(AB.roomHcss()) / 2 - 32)
  return st.row === 'top' ? { x: o.x + lx, y: o.y - back + ly } : { x: o.x + lx, y: o.y + back - ly }
}

// Belegte Zimmer, wie der Kern sie berechnet
function occupancy() {
  const occ = {}
  for (const a of AB.S.agents.values()) {
    if (a.st && a.state === 'active') occ[a.st.id] = true
    if (a.state === 'done') occ.pausenraum = true
  }
  for (const m of AB.leadsShown().map(AB.lead)) if (m && m.station && Date.now() - m.last < 3500) occ[m.station.id] = true
  return occ
}

// ---------- Nacht-Maske ----------
// Eigene kleine Leinwand in Puffergroesse: erst komplett nachtblau, dann werden an den Lampen
// Loecher in 2-3 harten Stufen herausgestanzt. Danach wird sie multiplizierend ueber die Szene gelegt.
const mask = document.createElement('canvas')
const mctx = mask.getContext('2d')
const NIGHT = '#2c3a86' // sattes Tiefblau: multipliziert wirkt es nachtblau statt grau

// Achteck-artiger Pixel-Kreis aus drei Rechtecken
function blob(c, cx, cy, r) {
  const a = Math.round(r), b = Math.round(r * 0.8), d = Math.round(r * 0.55)
  c.fillRect(cx - a, cy - d, a * 2, d * 2)
  c.fillRect(cx - b, cy - b, b * 2, b * 2)
  c.fillRect(cx - d, cy - a, d * 2, a * 2)
}
// Loch mit drei harten Ringen (aussen schwach, innen staerker)
function punch(cx, cy, r, s) {
  const steps = [[1, 0.32], [0.68, 0.34], [0.38, 0.45]]
  for (const [k, a] of steps) {
    mctx.globalAlpha = a * s
    blob(mctx, cx, cy, Math.max(2, r * k))
  }
  mctx.globalAlpha = 1
}

// Alle Lichtquellen der Wohnung: {x, y, r, s} in Kunst-Pixeln
function lights(occ) {
  const out = []
  for (const st of AB.STATIONS) {
    const on = !!occ[st.id]
    const lamp = furnPt(st, 40, -16)
    out.push({ x: lamp.x, y: lamp.y, r: 20, s: on ? 1 : 0.7 })
    if (on) { const c = AB.toArt(AB.stationPos(st).x, AB.stationPos(st).y); out.push({ x: c.x, y: c.y, r: 36, s: 0.75, ceil: true }) }
    if (st.id === 'archiv') { const p = furnPt(st, 9, -20); out.push({ x: p.x, y: p.y, r: 12, s: 0.8 }) }
    if (st.id === 'leitstand') { const p = furnPt(st, -12, -9); out.push({ x: p.x, y: p.y, r: 11, s: 0.8 }) }
    if (st.id === 'terminal') { const p = furnPt(st, -13, -20); out.push({ x: p.x, y: p.y, r: 10, s: 0.6 }) }
    if (st.id === 'pausenraum') for (const lx of [-22, -4, 14]) { const p = furnPt(st, lx, -26); out.push({ x: p.x, y: p.y, r: 9, s: 0.6 }) }
  }
  const cc = AB.toArt(AB.geo.cx, AB.geo.cy)
  const L = AB.toArt(AB.apartmentBoundsCss().minX, AB.geo.cy).x + 4
  // Schreibtischlampe je Hauptfigur (Claude, Codex)
  for (const lid of AB.leadsShown()) {
    const d = AB.deskPos(lid), dc = AB.toArt(d.x, d.y)
    const working = AB.lead(lid).state === 'active' || [...AB.S.agents.values()].some((a) => a.lead === lid && a.state === 'active')
    out.push({ x: dc.x + 10, y: dc.y - 2, r: 28, s: working ? 1 : 0.85 })
  }
  out.push({ x: L + 9, y: cc.y - 26, r: 22, s: 0.9 })
  return out
}

// Fenster in der Aussenwand (gleiche Rechnung wie in app.js)
function outerWindows() {
  const b = AB.apartmentBoundsCss(), m = AB.artToCss(8) * 0.6
  const tl = AB.toArt(b.minX - m, b.minY - m), br = AB.toArt(b.maxX + m, b.maxY + m)
  const wins = []
  let i = 0
  for (let wx = tl.x + 14; wx < br.x - 14; wx += 18) {
    wins.push({ x: wx, y: tl.y + 1, up: true, i: i++ })
    wins.push({ x: wx, y: br.y - 7, up: false, i: i++ })
  }
  return { wins, tl, br }
}

// ---------- Gluehwuermchen im Garten ----------
let flies = [], fliesKey = ''
function ensureFlies(W, H, tl, br) {
  const key = `${W}x${H}:${tl.x},${tl.y},${br.x},${br.y}`
  if (key === fliesKey) return
  fliesKey = key; flies = []
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let tries = 0; tries < 300 && flies.length < 14; tries++) {
    const x = Math.floor(4 + rnd() * (W - 8)), y = Math.floor(4 + rnd() * (H - 8))
    if (x > tl.x - 8 && x < br.x + 8 && y > tl.y - 8 && y < br.y + 8) continue
    flies.push({ x, y, ph: rnd() * 6.28 })
  }
}

AB.on('scene', (actx, time) => {
  const M = mood(hourNow())
  AB.night = M.night
  const W = actx.canvas.width, H = actx.canvas.height
  actx.save()
  actx.setTransform(1, 0, 0, 1, 0, 0)

  // Morgen- und Abendstimmung: leichter Farbschleier ueber alles
  if (M.pink > 0.01) { actx.globalAlpha = 0.12 * M.pink; actx.fillStyle = '#ffa898'; actx.fillRect(0, 0, W, H) }
  if (M.gold > 0.01) {
    actx.globalCompositeOperation = 'multiply'; actx.globalAlpha = 0.18 * M.gold; actx.fillStyle = '#e8b878'; actx.fillRect(0, 0, W, H)
    actx.globalCompositeOperation = 'source-over'; actx.globalAlpha = 0.12 * M.gold; actx.fillStyle = '#ffbe55'; actx.fillRect(0, 0, W, H)
  }
  actx.globalAlpha = 1

  const occ = occupancy()
  const L = lights(occ)
  const { wins, tl, br } = outerWindows()
  // Nur jedes zweite bis dritte Fenster ist "bewohnt" beleuchtet (deterministisch, flackert nicht)
  const lit = (w) => (w.i * 7 + 3) % 5 < 2

  if (M.night > 0.01) {
    if (mask.width !== W || mask.height !== H) { mask.width = W; mask.height = H }
    mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1
    mctx.fillStyle = NIGHT; mctx.fillRect(0, 0, W, H)
    mctx.globalCompositeOperation = 'destination-out'
    mctx.fillStyle = '#000'
    // Wohnzimmer/Flur zwischen den Zimmerreihen: Deckenlicht, damit Beschriftungen lesbar bleiben
    const cc = AB.toArt(AB.geo.cx, AB.geo.cy)
    const band = artPx(AB.livingHalfHcss()) + 8
    const bx0 = tl.x + 8, bx1 = br.x - 8
    mctx.globalAlpha = 0.3; mctx.fillRect(bx0, cc.y - band, bx1 - bx0, band * 2)
    mctx.globalAlpha = 0.22; mctx.fillRect(bx0 + 14, cc.y - band + 8, bx1 - bx0 - 28, band * 2 - 16)
    // Zimmerschilder brauchen kein Licht: der Kern schreibt sie scharf ueber die Szene
    mctx.globalAlpha = 1
    for (const l of L) punch(l.x, l.y, l.r, l.s)
    // Lichtflecken der beleuchteten Fenster draussen auf der Wiese
    for (const w of wins) {
      if (!lit(w)) continue
      const sy = w.up ? w.y - 4 : w.y + 9
      mctx.globalAlpha = 0.3; mctx.fillRect(w.x + 1, w.up ? sy - 1 : sy, 8, 3)
    }
    mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1
    actx.globalCompositeOperation = 'multiply'
    actx.globalAlpha = 0.62 * M.night
    actx.drawImage(mask, 0, 0)
    // ein Hauch Blau auch in den Schatten, damit die Nacht nicht grau, sondern blau wirkt
    actx.globalCompositeOperation = 'source-over'
    actx.globalAlpha = 0.1 * M.night; actx.fillStyle = '#1a2c7a'; actx.fillRect(0, 0, W, H)
    actx.globalAlpha = 1
  }

  // Warmes Lampenlicht (Abend schwach, Nacht voll)
  if (M.light > 0.01) {
    for (const l of L) AB.lightPool(l.x, l.y, l.ceil ? Math.round(l.r * 0.7) : Math.round(l.r * 0.75), M.light * l.s * (l.ceil ? 0.55 : 1))
    // beleuchtete Fenster in der Aussenwand: warmes Glas mit Fensterkreuz
    if (M.light > 0.2) {
      actx.globalAlpha = Math.min(1, M.light * 1.2)
      for (const w of wins) {
        if (!lit(w)) continue
        actx.fillStyle = '#ffd98a'; actx.fillRect(w.x, w.y, 10, 6)
        actx.fillStyle = '#f2b860'; actx.fillRect(w.x + 5, w.y, 1, 6); actx.fillRect(w.x, w.y + 3, 10, 1)
      }
      actx.globalAlpha = 1
    }
  }

  // Gluehwuermchen nur nachts, ruhig; bei reduzierter Bewegung stehen sie still und blinken nicht
  if (M.night > 0.6) {
    ensureFlies(W, H, tl, br)
    for (const f of flies) {
      let x = f.x, y = f.y, on = true
      if (!AB.reduce) {
        x += Math.round(Math.sin(time * 0.35 + f.ph) * 4)
        y += Math.round(Math.cos(time * 0.27 + f.ph * 1.3) * 3)
        on = Math.sin(time * 1.1 + f.ph * 2) > -0.35
      }
      if (!on) continue
      // 2x2-Kern mit kleinem Kreuz-Schein, damit sie auch hochskaliert sichtbar bleiben
      actx.globalAlpha = 0.3 * M.night; actx.fillStyle = '#e8f08a'
      actx.fillRect(x - 1, y, 4, 2); actx.fillRect(x, y - 1, 2, 4)
      actx.globalAlpha = M.night; actx.fillStyle = '#fbffc4'; actx.fillRect(x, y, 2, 2)
    }
    actx.globalAlpha = 1
  }
  actx.restore()
})

// ---------- Stundengong ----------
let lastHour = null
function gong() {
  const Snd = AB.Snd
  if (!Snd || !Snd.on || !Snd.ctx) return
  const ac = Snd.ctx
  let vol = 0.7
  try { const v = parseFloat(localStorage.getItem('ab-vol')); if (v >= 0 && v <= 1) vol = v } catch { /* egal */ }
  if (vol <= 0) return
  const t0 = ac.currentTime + 0.02
  const out = ac.createGain(); out.gain.value = 0.045 * vol * vol * 1.6
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400
  out.connect(lp); lp.connect(ac.destination)
  // warme Glocke: leicht unharmonische Teiltoene, tiefe klingen am laengsten
  const base = 196
  for (const [k, amp, dur] of [[1, 1, 4.5], [2, 0.45, 3], [2.76, 0.28, 2], [4.07, 0.12, 1.1], [0.5, 0.35, 5]]) {
    const o = ac.createOscillator(), g = ac.createGain()
    o.type = 'sine'; o.frequency.value = base * k
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(out)
    o.start(t0); o.stop(t0 + dur + 0.05)
  }
}
AB.on('ui', () => {
  const h = new Date().getHours()
  if (lastHour === null) { lastHour = h; return } // nie beim Laden
  if (h !== lastHour) { lastHour = h; gong() }
})

// ---------- Kontext-Papierkorb neben Claudes Tisch ----------
const BIN_W = 9, BIN_H = 11
let compact = null // null | 'pre' (wird verdichtet) | 'post' (wartet auf frische Statusdaten)
let compactAt = 0
let flying = [], tipStart = -1, tipPending = false
let binArt = null // { x, y, w, h } zuletzt gezeichnet, fuer die Hover-Pruefung
let mouse = null, touchUntil = 0

function shownPct() {
  const s = AB.S.status
  if (!s || typeof s.ctxPct !== 'number' || !Number.isFinite(s.ctxPct)) return null
  if (compact === 'pre' && Date.now() - compactAt > 180000) compact = null // Sicherheitsnetz
  if (compact) return 0
  return Math.max(0, Math.min(100, s.ctxPct))
}
// Wie viele Papierreihen im Korb liegen (0..8) und wie hoch es ueberquillt (0..2)
const fillRows = (pct) => Math.round((Math.min(pct, 80) / 80) * (BIN_H - 1))
const overflow = (pct) => (pct >= 92 ? 2 : pct >= 80 ? 1 : 0)

function ball(actx, x, y) {
  actx.fillStyle = AB.PX.paper; actx.fillRect(x, y, 2, 2)
  actx.fillStyle = '#a89068'; actx.fillRect(x + 1, y + 1, 1, 1)
}

AB.on('event', (ev, silent) => {
  if (ev.ev === '__reset') { compact = null; flying = []; tipStart = -1; tipPending = false; return }
  if (ev.ev === 'PreCompact') {
    const pct = shownPct()
    compact = 'pre'; compactAt = Date.now()
    if (silent || AB.reduce || pct == null || pct <= 0) return
    // Korb kippt kurz, die Papierknaeuel fliegen in kleinen Boegen hinaus (Start im naechsten Frame)
    tipPending = { rows: fillRows(pct), over: overflow(pct) }
  } else if (ev.ev === 'PostCompact') {
    if (compact === 'pre') compact = 'post'
  }
})
AB.on('status', () => { if (compact === 'post') compact = null })

AB.on('under', (actx, time, dt) => {
  const pct = shownPct()
  if (pct == null && !flying.length) { binArt = null; return }
  // Papierkorb (Kontext-Komprimierung) gehoert zur Claude-Session der Statusline
  const dm = AB.deskPos(AB.statusLead()), cc = AB.toArt(dm.x, dm.y)
  const bx = cc.x + 20, by = cc.y + 13 - BIN_H // links oben
  binArt = { x: bx, y: by, w: BIN_W, h: BIN_H }

  if (tipPending) {
    const { rows, over } = tipPending
    tipPending = false
    tipStart = time
    const n = Math.min(14, Math.ceil(rows * 1.2) + over * 3)
    for (let i = 0; i < n; i++) {
      flying.push({
        x: bx + 1 + (i % 3) * 2, y: by - 1 - Math.floor(i / 3),
        vx: 10 + Math.random() * 26, vy: -(26 + Math.random() * 22),
        delay: 0.25 + i * 0.05, end: 1.1 + Math.random() * 0.4,
      })
    }
  }
  const tAnim = tipStart >= 0 ? time - tipStart : -1
  if (tAnim > 1.6) tipStart = -1
  // Neigung in ganzen Pixeln: kippt nach rechts und richtet sich wieder auf
  const tilt = tAnim >= 0 && !AB.reduce ? Math.round(Math.sin(Math.min(1, tAnim / 1.5) * Math.PI) * 3) : 0

  if (pct != null || tAnim >= 0) {
    const p = pct == null ? 0 : pct
    const rows = tAnim >= 0 ? 0 : fillRows(p), over = tAnim >= 0 ? 0 : overflow(p)
    // Schatten am Boden
    actx.fillStyle = AB.PX.shadow; actx.fillRect(bx, by + BIN_H, BIN_W + 1, 1)
    // Korb Zeile fuer Zeile, damit die Neigung als Pixel-Treppe sichtbar wird
    for (let r = 0; r < BIN_H; r++) {
      const off = Math.round((tilt * (BIN_H - 1 - r)) / (BIN_H - 1))
      const x = bx + off, y = by + r
      if (r === 0) { actx.fillStyle = '#6f7c85'; actx.fillRect(x, y, BIN_W, 1); continue }
      const filled = r >= BIN_H - rows
      actx.fillStyle = filled ? ((r + (r >> 1)) % 2 ? AB.PX.paper : AB.PX.paperLine) : '#5d4a36'
      actx.fillRect(x + 1, y, BIN_W - 2, 1)
      if (filled) { actx.fillStyle = AB.PX.paper; actx.fillRect(x + 1 + ((r * 3) % 5), y, 1, 1) }
      actx.fillStyle = AB.PX.metal
      actx.fillRect(x, y, 1, 1); actx.fillRect(x + BIN_W - 1, y, 1, 1)
      actx.fillRect(x + 3, y, 1, 1); actx.fillRect(x + 5, y, 1, 1)
    }
    actx.fillStyle = '#6f7c85'; actx.fillRect(bx, by + BIN_H - 1, BIN_W, 1)
    // ueberquellender Haufen ueber dem Rand, ab ~92 % liegt ein Knaeuel daneben am Boden
    if (over >= 1) { ball(actx, bx + 1, by - 2); ball(actx, bx + 4, by - 2); ball(actx, bx + 6, by - 1); ball(actx, bx + 2, by - 1) }
    if (over >= 2) { ball(actx, bx + 2, by - 4); ball(actx, bx + 5, by - 4); ball(actx, bx + BIN_W + 1, by + BIN_H - 2) }
  }

  // fliegende Knaeuel: Pixelbogen mit Schwerkraft, verschwinden dann einfach
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]
    const t = tAnim - f.delay
    if (tAnim < 0 || t > f.end) { flying.splice(i, 1); continue }
    if (t < 0) { ball(actx, f.x, f.y); continue }
    const x = Math.round(f.x + f.vx * t), y = Math.round(f.y + f.vy * t + 60 * t * t)
    ball(actx, x, y)
  }
})

// Hover-Label (scharf, nur bei Maus ueber dem Korb bzw. kurz nach Antippen)
const canvas = document.getElementById('map')
if (canvas) {
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  canvas.addEventListener('mousemove', (e) => { mouse = pos(e) })
  canvas.addEventListener('mouseleave', () => { mouse = null })
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    mouse = pos(e); touchUntil = Date.now() + 2500
  })
}
function overBin() {
  if (!binArt || !mouse) return false
  if (touchUntil && Date.now() > touchUntil) { touchUntil = 0; mouse = null; return false }
  const k = AB.artToCss(1), pad = 3
  return mouse.x >= binArt.x * k - pad && mouse.x <= (binArt.x + binArt.w) * k + pad &&
    mouse.y >= (binArt.y - 4) * k - pad && mouse.y <= (binArt.y + binArt.h) * k + pad
}

AB.on('top', (ctx) => {
  if (!overBin()) return
  const pct = shownPct()
  if (pct == null) return
  const txt = compact ? T('dn.compacting') : T('dn.context', { n: Math.round(pct) })
  const u = AB.geo.u, k = AB.artToCss(1)
  const px = Math.round(11 * u)
  ctx.save()
  ctx.font = `600 ${px}px "Avenir Next","Helvetica Neue",system-ui,sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const w = Math.ceil(ctx.measureText(txt).width) + Math.round(12 * u), h = Math.round(18 * u)
  const cx = Math.round((binArt.x + binArt.w / 2) * k)
  let x = cx - Math.round(w / 2)
  x = Math.max(4, Math.min(AB.geo.w - w - 4, x))
  const y = Math.round((binArt.y - 5) * k) - h - 4
  ctx.globalAlpha = 1
  ctx.fillStyle = AB.COL.line; ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
  ctx.fillStyle = AB.PX.paper; ctx.fillRect(x, y, w, h)
  ctx.fillStyle = AB.COL.ink; ctx.fillText(txt, x + w / 2, y + h / 2 + 1)
  ctx.restore()
})

AB.dayNight = { mood: () => mood(hourNow()), gong }
})()
